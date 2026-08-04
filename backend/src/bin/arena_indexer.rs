// A3.4 — the arena indexer daemon: mirrors the arena program's events
// (Joined / Extracted / RoundEnded) into Postgres. Same skeleton as the
// lottery indexer (bin/indexer.rs, phase 9), different program and
// cursor — the indexer_state table is keyed by name, the two daemons
// coexist without touching each other.

use std::str::FromStr;

use lottery_api::db::{self, repositories::IndexerStateRepository};
use lottery_api::indexer::arena_dispatch::dispatch_arena_event;
use lottery_api::indexer::arena_events::decode_arena_events;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_client::rpc_client::GetConfirmedSignaturesForAddress2Config;
use solana_client::rpc_config::RpcTransactionConfig;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signature;
use solana_transaction_status_client_types::UiTransactionEncoding;

const CURSOR_ID: &str = "arena-devnet";
// declare_id! of the arena program — env override for other clusters.
const DEFAULT_PROGRAM_ID: &str = "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_target(false).compact().init();
    dotenv::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let program_id_str =
        std::env::var("ARENA_PROGRAM_ID").unwrap_or_else(|_| DEFAULT_PROGRAM_ID.to_string());
    let program_id = Pubkey::from_str(&program_id_str)?;

    let pool = db::create_pool(&database_url, 5).await?;
    let rpc = RpcClient::new(rpc_url.clone());
    let slot = rpc.get_slot().await?;
    tracing::info!("arena indexer up — {rpc_url} (slot {slot}), watching {program_id}");

    let cursor_repo = IndexerStateRepository::new(pool.clone());
    match cursor_repo.get(CURSOR_ID).await? {
        Some(state) => tracing::info!("resuming after {:?}", state.last_signature),
        None => tracing::info!("no cursor yet — full backfill from program history"),
    }

    let poll_secs: u64 = std::env::var("POLL_INTERVAL_SECS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    tracing::info!("polling every {poll_secs}s (Ctrl+C to stop)");

    loop {
        match run_cycle(&rpc, &pool, &program_id, &program_id_str, &cursor_repo).await {
            Ok(0) => tracing::debug!("no new events"),
            Ok(n) => tracing::info!("indexed {n} event(s)"),
            Err(e) => tracing::error!("cycle failed (will retry next tick): {e:#}"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(poll_secs)).await;
    }
}

// One cycle: everything newer than the cursor, oldest -> newest, then
// advance the cursor — only after the whole batch landed (a crash
// mid-batch replays it next time; the upserts make that free).
async fn run_cycle(
    rpc: &RpcClient,
    pool: &sqlx::PgPool,
    program_id: &Pubkey,
    program_id_str: &str,
    cursor_repo: &IndexerStateRepository,
) -> anyhow::Result<usize> {
    let until = cursor_repo.get(CURSOR_ID).await?.and_then(|s| s.last_signature);
    let until_sig = match &until {
        Some(s) => Some(Signature::from_str(s)?),
        None => None,
    };

    // collect all new signatures (newest -> oldest), paging backwards
    let mut new_sigs = Vec::new();
    let mut before: Option<Signature> = None;
    loop {
        let config = GetConfirmedSignaturesForAddress2Config {
            before,
            until: until_sig,
            limit: Some(1000),
            commitment: Some(CommitmentConfig::confirmed()),
        };
        let page = rpc
            .get_signatures_for_address_with_config(program_id, config)
            .await?;
        let Some(oldest) = page.last() else { break };
        before = Some(Signature::from_str(&oldest.signature)?);
        let full_page = page.len() == 1000;
        new_sigs.extend(page);
        if !full_page {
            break;
        }
    }
    if new_sigs.is_empty() {
        return Ok(0);
    }

    let new_cursor_sig = new_sigs[0].signature.clone();
    let new_cursor_slot = new_sigs[0].slot as i64;

    let tx_config = RpcTransactionConfig {
        encoding: Some(UiTransactionEncoding::Json),
        commitment: Some(CommitmentConfig::confirmed()),
        max_supported_transaction_version: Some(0),
    };
    let mut processed = 0usize;
    for status in new_sigs.iter().rev() {
        if status.err.is_some() {
            continue;
        }
        let signature = Signature::from_str(&status.signature)?;
        let tx = rpc.get_transaction_with_config(&signature, tx_config).await?;
        let logs: Option<Vec<String>> = tx
            .transaction
            .meta
            .and_then(|meta| Option::from(meta.log_messages));
        let Some(logs) = logs else { continue };
        // enumerate: the event's position in the tx is part of the
        // arena_joins idempotence anchor
        for (idx, event) in decode_arena_events(&logs, program_id_str).iter().enumerate() {
            dispatch_arena_event(pool, &status.signature, idx as i16, event).await?;
            processed += 1;
        }
    }

    cursor_repo
        .save_cursor(CURSOR_ID, &new_cursor_sig, new_cursor_slot)
        .await?;
    Ok(processed)
}
