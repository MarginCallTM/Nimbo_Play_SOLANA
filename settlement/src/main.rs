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
    // The round whose vault owes this claim — rounds are sealed pots
    // (2026-08-04 gap: settling against the WRONG round would pay old
    // debts with new depositors' money; the outbox now carries it).
    #[serde(rename = "roundId")]
    round_id: String,
}

/// AF.1 — one requested round operation, as served by
/// GET /settlement/rounds. The game server decides WHEN rounds rotate;
/// this service is the only thing that can sign, and it verifies every
/// request against the chain before doing so.
#[derive(Deserialize)]
struct RoundOp {
    kind: String, // "open" | "end"
    #[serde(rename = "roundId")]
    round_id: String,
    /// "open" only: the on-chain deadline to set (unix seconds).
    #[serde(rename = "endTimestamp")]
    end_timestamp: Option<String>,
}

impl RoundOp {
    /// Mirrors the server's opKey(): what an ack is keyed by.
    fn key(&self) -> String {
        format!("{}:{}", self.kind, self.round_id)
    }
}

struct Config {
    game_server: String,
    rpc_url: String,
    secret: Option<String>,
    poll: Duration,
    /// Where the rake goes on rounds this service opens. Defaults to the
    /// authority itself (devnet convention, same as init-arena-devnet).
    treasury: Option<String>,
    rake_bps: u16,
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

fn load_config() -> Result<Config> {
    Ok(Config {
        game_server: env_or("GAME_SERVER_URL", "http://localhost:2567"),
        rpc_url: env_or("RPC_URL", "https://api.devnet.solana.com"),
        secret: std::env::var("SETTLEMENT_SECRET").ok(),
        poll: Duration::from_secs(env_or("POLL_INTERVAL_S", "5").parse().unwrap_or(5)),
        // An env var set to "" is NOT absent (docker-compose passes empty
        // strings for unset values — the DEMO_BOTS="" trap of A4.10).
        // Empty must mean "use the authority", not "parse '' as a key".
        treasury: std::env::var("TREASURY_PUBKEY")
            .ok()
            .filter(|s| !s.trim().is_empty()),
        rake_bps: env_or("RAKE_BPS", "550").parse().unwrap_or(550),
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

fn fetch_pending_rounds(cfg: &Config, http: &reqwest::blocking::Client) -> Result<Vec<RoundOp>> {
    let mut req = http.get(format!("{}/settlement/rounds", cfg.game_server));
    if let Some(s) = &cfg.secret {
        req = req.header("x-settlement-secret", s);
    }
    let res = req.send().context("GET /settlement/rounds")?;
    if !res.status().is_success() {
        return Err(anyhow!("rounds: HTTP {}", res.status()));
    }
    res.json().context("rounds: bad JSON")
}

fn ack_round(cfg: &Config, http: &reqwest::blocking::Client, key: &str, tx_sig: &str) -> Result<()> {
    let mut req = http.post(format!("{}/settlement/rounds/ack", cfg.game_server));
    if let Some(s) = &cfg.secret {
        req = req.header("x-settlement-secret", s);
    }
    let res = req
        .json(&serde_json::json!({ "key": key, "txSig": tx_sig }))
        .send()
        .context("POST /settlement/rounds/ack")?;
    if !res.status().is_success() {
        return Err(anyhow!("rounds ack: HTTP {}", res.status()));
    }
    Ok(())
}

/// Execute ONE round operation, idempotently. Same three outcomes as
/// settle(), and the same rule: the CHAIN decides what has already
/// happened, never our own record of what we asked for.
///
/// This is why round ids must be deterministic: after an ambiguous RPC
/// failure we re-derive the identical PDA and simply find our own round
/// sitting there. A clock-derived id would derive a NEW address instead,
/// and quietly open a second round next to the first.
fn run_round_op(
    rpc: &RpcClient,
    authority: &Keypair,
    cfg: &Config,
    op: &RoundOp,
) -> Result<Option<String>> {
    let round_id: u64 = op.round_id.parse().context("op.roundId is not u64")?;
    let state = chain::round_state(rpc, round_id)?;

    let ix = match op.kind.as_str() {
        "open" => {
            if state.is_some() {
                return Ok(None); // already opened (possibly by our own retry)
            }
            let end_timestamp: i64 = op
                .end_timestamp
                .as_deref()
                .ok_or_else(|| anyhow!("open op without endTimestamp"))?
                .parse()
                .context("op.endTimestamp is not i64")?;
            let treasury = match &cfg.treasury {
                Some(t) => Pubkey::from_str(t).context("TREASURY_PUBKEY is not base58")?,
                None => authority.pubkey(),
            };
            chain::build_initialize_round_instruction(
                authority.pubkey(),
                round_id,
                end_timestamp,
                treasury,
                cfg.rake_bps,
            )
        }
        "end" => match state {
            // Nothing to end, or already ended: both mean done. Note the
            // first case is also what an operator sees if a round was
            // never opened — acking is right either way, the game server
            // has already stopped routing anyone to it.
            None | Some(chain::RoundState::Ended) => return Ok(None),
            Some(chain::RoundState::Open) => {
                chain::build_end_round_instruction(authority.pubkey(), round_id)
            }
        },
        other => return Err(anyhow!("unknown round op kind {other:?}")),
    };

    let blockhash = rpc.get_latest_blockhash().context("rpc: latest blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&authority.pubkey()),
        &[authority],
        blockhash,
    );
    let sig = rpc
        .send_and_confirm_transaction(&tx)
        // end_round before the deadline, or open before the successor is
        // due, both land here — and both are retried, not acked.
        .with_context(|| format!("{} round {} failed", op.kind, round_id))?;
    Ok(Some(sig.to_string()))
}

/// Settle ONE claim. Three outcomes:
///  - already paid (receipt exists)  -> Ok(None): just ack;
///  - paid now                       -> Ok(Some(sig)): ack with it;
///  - anything failed                -> Err: leave the claim pending,
///    the next loop iteration retries from scratch. Never ack an Err.
fn settle(
    rpc: &RpcClient,
    authority: &Keypair,
    claim: &Claim,
) -> Result<Option<String>> {
    let player = Pubkey::from_str(&claim.wallet).context("claim.wallet is not base58")?;
    let amount: u64 = claim.lamports.parse().context("claim.lamports is not u64")?;
    let nonce: u64 = claim.nonce.parse().context("claim.nonce is not u64")?;
    // each claim is settled against ITS OWN round's vault, never a
    // globally configured one
    let round_id: u64 = claim.round_id.parse().context("claim.roundId is not u64")?;

    // idempotence: the chain remembers payments, not this process
    if chain::receipt_exists(rpc, round_id, nonce)? {
        return Ok(None);
    }

    let ix = chain::build_settle_instruction(
        authority.pubkey(),
        round_id,
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
        "[settlement] up — authority {}, polling {} every {:?}",
        authority.pubkey(),
        cfg.game_server,
        cfg.poll,
    );

    loop {
        // AF.1 — round operations first: an extraction claim is worth
        // nothing if the round that owes it was never opened.
        match fetch_pending_rounds(&cfg, &http) {
            Err(e) => eprintln!("[settlement] round poll failed: {e:#}"),
            Ok(ops) => {
                for op in &ops {
                    let key = op.key();
                    match run_round_op(&rpc, &authority, &cfg, op) {
                        Ok(Some(sig)) => {
                            println!("[settlement] {key} done — {sig}");
                            if let Err(e) = ack_round(&cfg, &http, &key, &sig) {
                                eprintln!("[settlement] round ack failed (will retry): {e:#}");
                            }
                        }
                        Ok(None) => {
                            println!("[settlement] {key} already done on chain — acking");
                            let _ = ack_round(&cfg, &http, &key, "already-done");
                        }
                        Err(e) => {
                            eprintln!("[settlement] {key} failed (will retry): {e:#}")
                        }
                    }
                }
            }
        }

        match fetch_pending(&cfg, &http) {
            Err(e) => eprintln!("[settlement] poll failed: {e:#}"),
            Ok(claims) => {
                for claim in &claims {
                    match settle(&rpc, &authority, claim) {
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
