// A3.3 — chain side of the settlement service: derive the PDAs and
// build the settle_extraction instruction BY HAND (discriminator +
// borsh args + IDL account order) — the exact Rust mirror of what
// shared/arena-chain.ts does in TypeScript. The IDL is the source of
// truth: re-check discriminator and account order after ANY change
// to the on-chain program.

use anyhow::{Context, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};
use solana_system_interface::program as system_program;
use std::str::FromStr;

/// Fixed by declare_id! at the program's first build - never changes.
pub const ARENA_PROGRAM_ID: &str = "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d";

/// sha256("global:settle_extraction")[0..8], copied from the IDL
const SETTLE_DISCRIMINATOR: [u8; 8] = [24, 131, 181, 22, 152, 185, 8, 197];

pub fn program_id() -> Pubkey {
    Pubkey::from_str(ARENA_PROGRAM_ID).expect("hardcoded program id is valid base58")
}

/// Byte-exact mirrors of the on-chain seeds (and of arena-chain.ts).
/// find_program_address returns (address, bump); the runtime re-runs
/// the same derivation on-chain, so only the address matters here.
pub fn round_pda(round_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"round", &round_id.to_le_bytes()], &program_id()).0
}

pub fn vault_pda(round_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"vault", &round_id.to_le_bytes()], &program_id()).0
}

pub fn receipt_pda(round_id: u64, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"extract", &round_id.to_le_bytes(), &nonce.to_le_bytes()],
        &program_id(),
    )
    .0
}

/// Has this claim already been paid? The ExtractReceipt PDA is created
/// BY settle_extraction — its existence IS the proof of payment
/// (anti-replay, A2.5). Checking it BEFORE submitting makes the whole
/// service idempotent: kill it anywhere, restart it, the chain
/// remembers. get_account_with_commitment returns Ok(None) for a
/// missing account — no error-string parsing.
pub fn receipt_exists(rpc: &RpcClient, round_id: u64, nonce: u64) -> Result<bool> {
    let pda = receipt_pda(round_id, nonce);
    let account = rpc
        .get_account_with_commitment(&pda, rpc.commitment())
        .context("rpc: get receipt account")?;
    Ok(account.value.is_some())
}

/// data = discriminator ++ amount:u64le ++ nonce:u64le (borsh layout).
/// Account order is the IDL CONTRACT — authority pays the receipt's
/// rent (hence writable) and must sign (Model A: the server IS the
/// authority, D54)
pub fn build_settle_instruction(
    authority: Pubkey,
    round_id: u64,
    player: Pubkey,
    amount: u64,
    nonce: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&SETTLE_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&nonce.to_le_bytes());

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(authority, true), // writable + signer
            AccountMeta::new(round_pda(round_id), false),
            AccountMeta::new(vault_pda(round_id), false),
            AccountMeta::new(player, false), // payout destination
            AccountMeta::new(receipt_pda(round_id, nonce), false),
            AccountMeta::new_readonly(system_program::id(), false), 
        ],
        data,
    }
}
