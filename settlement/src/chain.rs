// A3.3 — chain side of the settlement service: derive the PDAs and
// build the settle_extraction instruction BY HAND (discriminator +
// borsh args + IDL account order) — the exact Rust mirror of what
// shared/arena-chain.ts does in TypeScript. The IDL is the source of
// truth: re-check discriminator and account order after ANY change
// to the on-chain program.

use anyhow::{anyhow, Context, Result};
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
/// AF.1 — the two round-lifecycle instructions, same source (the IDL).
const INIT_ROUND_DISCRIMINATOR: [u8; 8] = [43, 135, 19, 93, 14, 225, 131, 188];
const END_ROUND_DISCRIMINATOR: [u8; 8] = [54, 47, 1, 200, 250, 6, 144, 63];

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

/// The FoodReserve singleton: sweep destination of every ended round.
pub fn reserve_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"food_reserve"], &program_id()).0
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

/// AF.1 — what a round looks like from here. `None` = the account does
/// not exist yet.
#[derive(Debug, PartialEq)]
pub enum RoundState {
    Open,
    Ended,
}

/// Read a round's state, or None if it was never created. This is what
/// makes both round operations IDEMPOTENT: the chain, not our op file,
/// answers "has this already been done?". An RPC timeout leaves us
/// unsure whether our tx landed, and asking again is the only honest
/// way to find out.
///
/// Layout after the 8-byte account discriminator (mirror of
/// shared/arena-chain.ts): round_id u64 | authority 32 | treasury 32 |
/// rake_bps u16 | reserve_bps u16 | end_timestamp i64 | state u8 -> the
/// state byte sits at offset 92, 0 = Open.
pub fn round_state(rpc: &RpcClient, round_id: u64) -> Result<Option<RoundState>> {
    let account = rpc
        .get_account_with_commitment(&round_pda(round_id), rpc.commitment())
        .context("rpc: get round account")?;
    let Some(account) = account.value else {
        return Ok(None);
    };
    let byte = *account
        .data
        .get(92)
        .ok_or_else(|| anyhow!("round {round_id} account is too short to be a Round"))?;
    Ok(Some(if byte == 0 {
        RoundState::Open
    } else {
        RoundState::Ended
    }))
}

/// data = discriminator ++ round_id:u64le ++ end_timestamp:i64le ++
/// authority:32 ++ treasury:32 ++ rake_bps:u16le ++ reserve_bps:u16le.
///
/// The service signs as PAYER and names ITSELF as the round authority —
/// the same key that settles extractions. Automating the opening adds no
/// new trust: this key already moves money every few seconds. Splitting
/// it (KMS/multisig) is a separate mainnet hardening step (APROD.2).
///
/// reserve_bps is 0 and must stay 0 (D74): every non-rake lamport has to
/// sit in the Vault or extractions become unpayable. The game server
/// refuses to run a paid round with any other value.
pub fn build_initialize_round_instruction(
    payer: Pubkey,
    round_id: u64,
    end_timestamp: i64,
    treasury: Pubkey,
    rake_bps: u16,
) -> Instruction {
    let mut data = Vec::with_capacity(92);
    data.extend_from_slice(&INIT_ROUND_DISCRIMINATOR);
    data.extend_from_slice(&round_id.to_le_bytes());
    data.extend_from_slice(&end_timestamp.to_le_bytes());
    data.extend_from_slice(payer.as_ref()); // authority = us
    data.extend_from_slice(treasury.as_ref());
    data.extend_from_slice(&rake_bps.to_le_bytes());
    data.extend_from_slice(&0u16.to_le_bytes()); // reserve_bps, D74

    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(round_pda(round_id), false),
            // read-only on purpose: the vault is a lamport-only PDA that
            // springs into existence when the first join funds it
            AccountMeta::new_readonly(vault_pda(round_id), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

/// No args: the round is identified by its account. Sweeps the whole
/// remaining vault into the FoodReserve (D50) and flips the state, which
/// shuts join, inject AND settle at once — hence the game server only
/// asks for this once the round owes nothing and hosts nobody.
pub fn build_end_round_instruction(authority: Pubkey, round_id: u64) -> Instruction {
    Instruction {
        program_id: program_id(),
        accounts: vec![
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new(round_pda(round_id), false),
            AccountMeta::new(vault_pda(round_id), false),
            AccountMeta::new(reserve_pda(), false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data: END_ROUND_DISCRIMINATOR.to_vec(),
    }
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
