// A3.3 — the settlement service: the arena's paymaster (Model A, D54).
// Holds the round authority keypair (hot wallet at MVP — KMS/multisig
// before mainnet, D70/APROD.2), polls the game server's outbox and
// submits settle_extraction for every pending claim.
//
// Crash-safety comes from OUTSIDE this process: the outbox file holds
// the debts, the ExtractReceipt PDA holds the payments. This loop can
// die at any line and be restarted — it re-reads both and converges.

mod chain;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair},
    signer::Signer,
    transaction::Transaction,
};
use std::{str::FromStr, thread::sleep, time::Duration};

/// One pending debt, as served by GET /settlement/pending.
/// Amounts and nonces travel as STRINGS (u64 > JS safe integers).
#[derive(Deserialize)]
struct Claim {
    wallet: String,
    lamports: String,
    nonce: String,
}

struct Config {
    game_server: String,
    rpc_url: String,
    round_id: u64,
    secret: Option<String>,
    poll: Duration,
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn load_config() -> Result<Config> {
    Ok(Config {
        game_server: env_or("GAME_SERVER_URL", "http://localhost:2567"),
        rpc_url: env_or("RPC_URL", "https://api.devnet.solana.com"),
        round_id: std::env::var("ROUND_ID")
            .context("ROUND_ID is required (same value as the game server)")?
            .parse()
            .context("ROUND_ID must be a u64")?,
        secret: std::env::var("SETTLEMENT_SECRET").ok(),
        poll: Duration::from_secs(env_or("POLL_INTERVAL_S", "5").parse().unwrap_or(5)),
    })
}

fn load_authority() -> Result<Keypair> {
    let default = format!(
        "{}/.config/solana/id.json",
        std::env::var("HOME").context("HOME not set")?
    );
    let path = env_or("AUTHORITY_KEYPAIR", &default);
    // read_keypair_file returns a Box<dyn Error> that anyhow can't
    // absorb through `?` directly — hence the explicit map_err
    read_keypair_file(&path).map_err(|e| anyhow!("read keypair {path}: {e}"))
}

fn fetch_pending(cfg: &Config, http: &reqwest::blocking::Client) -> Result<Vec<Claim>> {
    let mut req = http.get(format!("{}/settlement/pending", cfg.game_server));
    if let Some(s) = &cfg.secret {
        req = req.header("x-settlement-secret", s);
    }
    let res = req.send().context("GET /settlement/pending")?;
    if !res.status().is_success() {
        return Err(anyhow!("pending: HTTP {}", res.status()));
    }
    res.json().context("pending: bad JSON")
}

fn ack(cfg: &Config, http: &reqwest::blocking::Client, nonce: &str, tx_sig: &str) -> Result<()> {
    let mut req = http.post(format!("{}/settlement/ack", cfg.game_server));
    if let Some(s) = &cfg.secret {
        req = req.header("x-settlement-secret", s);
    }
    let res = req
        .json(&serde_json::json!({ "nonce": nonce, "txSig": tx_sig }))
        .send()
        .context("POST /settlement/ack")?;
    if !res.status().is_success() {
        return Err(anyhow!("ack: HTTP {}", res.status()));
    }
    Ok(())
}

/// Settle ONE claim. Three outcomes:
///  - already paid (receipt exists)  -> Ok(None): just ack;
///  - paid now                       -> Ok(Some(sig)): ack with it;
///  - anything failed                -> Err: leave the claim pending,
///    the next loop iteration retries from scratch. Never ack an Err.
fn settle(
    cfg: &Config,
    rpc: &RpcClient,
    authority: &Keypair,
    claim: &Claim,
) -> Result<Option<String>> {
    let player = Pubkey::from_str(&claim.wallet).context("claim.wallet is not base58")?;
    let amount: u64 = claim.lamports.parse().context("claim.lamports is not u64")?;
    let nonce: u64 = claim.nonce.parse().context("claim.nonce is not u64")?;

    // idempotence: the chain remembers payments, not this process
    if chain::receipt_exists(rpc, cfg.round_id, nonce)? {
        return Ok(None);
    }

    let ix = chain::build_settle_instruction(
        authority.pubkey(),
        cfg.round_id,
        player,
        amount,
        nonce,
    );
    let blockhash = rpc
        .get_latest_blockhash()
        .context("rpc: latest blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[authority],
        blockhash,
    );
    // send_and_confirm blocks until the cluster confirms (or errors):
    // slow but unambiguous — right trade-off for a paymaster
    let sig = rpc
        .send_and_confirm_transaction(&tx)
        .context("settle_extraction failed")?;
    Ok(Some(sig.to_string()))
}

fn main() -> Result<()> {
    let cfg = load_config()?;
    let authority = load_authority()?;
    let rpc = RpcClient::new_with_commitment(cfg.rpc_url.clone(), CommitmentConfig::confirmed());
    let http = reqwest::blocking::Client::new();

    println!(
        "[settlement] up — authority {}, round {}, polling {} every {:?}",
        authority.pubkey(),
        cfg.round_id,
        cfg.game_server,
        cfg.poll,
    );

    loop {
        match fetch_pending(&cfg, &http) {
            Err(e) => eprintln!("[settlement] poll failed: {e:#}"),
            Ok(claims) => {
                for claim in &claims {
                    match settle(&cfg, &rpc, &authority, claim) {
                        Ok(Some(sig)) => {
                            println!(
                                "[settlement] paid {} lamports to {} (nonce {}) — {}",
                                claim.lamports, claim.wallet, claim.nonce, sig
                            );
                            if let Err(e) = ack(&cfg, &http, &claim.nonce, &sig) {
                                // harmless: we'll re-see the claim, find
                                // the receipt, and ack again
                                eprintln!("[settlement] ack failed (will retry): {e:#}");
                            }
                        }
                        Ok(None) => {
                            println!("[settlement] nonce {} already settled — acking", claim.nonce);
                            let _ = ack(&cfg, &http, &claim.nonce, "already-settled");
                        }
                        Err(e) => eprintln!(
                            "[settlement] claim nonce {} failed (will retry): {e:#}",
                            claim.nonce
                        ),
                    }
                }
            }
        }
        sleep(cfg.poll);
    }
}
