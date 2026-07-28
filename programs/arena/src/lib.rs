// programs/arena/src/lib.rs
use anchor_lang::prelude::*;

declare_id!("8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d");

// --- PDA seed prefixes -------------------------------------------------------
// Single source of truth to avoid typos across instructions.
//
// PDA derivations:
//  Round:          [ROUND_SEED, round_id.to_le_bytes()]
//  Vault:          [VAULT_SEED, round_id.to_le_bytes()]   (lamport-only, no struct — D20bis)
//  FoodReserve:    [FOOD_RESERVE_SEED]                    (global singleton)
//  ExtractReceipt: [EXTRACT_SEED, round_id.to_le_bytes(), nonce.to_le_bytes()]
pub const ROUND_SEED: &[u8] = b"round";
pub const VAULT_SEED: &[u8] = b"vault";
pub const FOOD_RESERVE_SEED: &[u8] = b"food_reserve";
pub const EXTRACT_SEED: &[u8] = b"extract";

/// Basis-point denominator: 550 bps = 5.50%. All fee math uses u64 bps.
pub const BPS_DENOMINATOR: u64 = 10_000;



/// Game-agnostic escrow primitive for Nimbo Play.
///
/// TRUST MODEL (locked, D44/D45/D54): real-time gameplay lives OFF-CHAIN on an
/// authoritative game server. This program never sees the game. It only does:
///   1. escrow    — variable buy-ins deposited into a per-round vault,
///   2. settlement — payouts signed by the round authority (the game server),
///   3. anti-replay — one ExtractReceipt PDA per settlement nonce.
/// Guarantees that hold EVEN IF the server key is compromised: payouts are
/// capped by the vault balance, a settlement can never be replayed, and no one
/// but the authority can settle. What is NOT protected: a compromised server
/// can settle fictitious extractions up to the vault balance (accepted for MVP,
/// hardened later via multisig / ed25519 attestation — Model B).
#[program]
pub mod arena {
    use super::*;

    /// One-time creation of the global FoodReserve singleton.
    /// The caller becomes its authority - MUST be called by the team right
    /// at deployment: rounds are permissionless, so a squatter holding this
    /// authority could inject the reserve into his own round and drain it
    pub fn initialize_reserve(ctx: Context<InitializeReserve>) ->
    Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.authority = ctx.accounts.payer.key();
        reserve.total_swept_in = 0;
        reserve.total_injected_out = 0;
        reserve.bump = ctx.bumps.reserve;
        Ok(())
    }

    /// Opens a new round. Permissionless: anyone can create a round by paying
    /// its rent - players only deposit into rounds they choose to join (the
    /// official server only lists its own rounds), so a squatted or hostile
    /// round is a self-funded nuisance, not a theft vector.
    pub fn initialize_round(
        ctx: Context<InitializeRound>,
        round_id: u64,
        end_timestamp: i64,
        authority: Pubkey,
        treasury: Pubkey,
        rake_bps: u16,
        reserve_bps: u16,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(end_timestamp > now, ArenaError::InvalidDuration);
        // Cast BEFORE adding: u16 + u16 can exceed u16::MAX, never u64's
        require!(
            (rake_bps as u64) + (reserve_bps as u64) < BPS_DENOMINATOR,
            ArenaError::InvalidSplit
        );

        let round = &mut ctx.accounts.round;
        round.round_id = round_id;
        round.authority = authority;
        round.treasury = treasury;
        round.rake_bps = rake_bps;
        round.reserve_bps = reserve_bps;
        round.end_timestamp = end_timestamp;
        round.state = RoundState::Open;
        round.total_staked = 0;
        round.total_deposited = 0;
        round.total_injected = 0;
        round.total_paid = 0;
        round.bump = ctx.bumps.round;
        round.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Moves real lamports from the global FoodReserve into a round's vault
    /// (bounded marketing injections, D71). Reserve-authority only. The
    /// reserve is program-owned, so this is a DIRECT lamport debit/credit —
    /// the System Program can only debit accounts it owns, not ours.
    pub fn inject_reserve(ctx: Context<InjectReserve>, amount: u64) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(round.state == RoundState::Open, ArenaError::RoundNotOpen);

        // The reserve must never drop below its own rent-exempt minimum
        // or the runtime could reap the account (data included)
        let reserve_info = ctx.accounts.reserve.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(FoodReserve::LEN);
        let available = reserve_info.lamports().saturating_sub(rent_floor);
        require!(amount <= available, ArenaError::InsufficientReserve);

        // Direct move, allowed because our program owns the reserve. The
        // runtime enforces lamport conservation across the instruction.
        **reserve_info.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? += amount;

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_injected_out = reserve
            .total_injected_out
            .checked_add(amount)
            .ok_or(ArenaError::MathOverflow)?;
        round.total_injected = round
            .total_injected
            .checked_add(amount)
            .ok_or(ArenaError::MathOverflow)?;
        Ok(())
    }

}

// --- Instruction accounts ----------------------------------------------------

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    /// Pays the rent and becomes the reserve authority
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = FoodReserve::LEN,
        seeds = [FOOD_RESERVE_SEED],
        bump
    )]
    pub reserve: Account<'info, FoodReserve>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct InitializeRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = Round::LEN,
        seeds = [ROUND_SEED, round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    /// Lamport-only vault (D20bis): no struct, no init. Declared here ONLY so
    /// Anchor verifies the derivation and hands us the bump to store; the
    /// account springs into existence when the first join funds it.
    #[account(
        seeds = [VAULT_SEED, round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InjectReserve<'info> {
    /// Checked against reserve.authority by the has_one constraint.
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [FOOD_RESERVE_SEED],
        bump = reserve.bump,
        has_one = authority @ ArenaError::Unauthorized
    )]
    pub reserve: Account<'info, FoodReserve>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
}

// --- State accounts ----------------------------------------------------------

/// Lifecycle of a round. No "drawing" intermediate state here (unlike the
/// lottery): settlement happens continuously while Open, then the round is
/// swept and closed in one step.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RoundState {
    Open,
    Ended,
}

/// Per-round escrow state. PDA seeds: [ROUND_SEED, round_id.to_le_bytes()].
/// The lamports themselves live in the separate Vault PDA (money / logic split).
#[account]
pub struct Round {
    /// Unique round identifier, chosen by the caller at initialization.
    pub round_id: u64,
    /// The game server's hot wallet: the ONLY signer allowed to settle
    /// extractions and end the round (Model A trust).
    pub authority: Pubkey,
    /// Destination of the house rake, fixed at initialization.
    pub treasury: Pubkey,
    /// Rake taken on every join, in basis points (550 = 5.5%).
    pub rake_bps: u16,
    /// Share of every join routed to the FoodReserve, in basis points (~200).
    pub reserve_bps: u16,
    /// Unix timestamp after which the round can be ended.
    pub end_timestamp: i64,
    pub state: RoundState,
    /// Accounting ledger — these four counters exist to PROVE the solvency
    /// invariant (D55): total_paid <= total_deposited + total_injected.
    /// Gross sum of all stakes (before split).
    pub total_staked: u64,
    /// Net amount actually deposited into the vault (after rake + reserve).
    pub total_deposited: u64,
    /// Amount injected into the vault from the FoodReserve.
    pub total_injected: u64,
    /// Sum of all settled extractions paid out of the vault.
    pub total_paid: u64,
    pub bump: u8,
    /// Bump of the Vault PDA, stored so instructions never re-derive it.
    pub vault_bump: u8,
}

impl Round {
    /// 8 (discriminator) + 8 + 32 + 32 + 2 + 2 + 8 + 1 (enum) + 8*4 + 1 + 1
    pub const LEN: usize = 8 + 8 + 32 + 32 + 2 + 2 + 8 + 1 + 8 + 8 + 8 + 8 + 1 + 1;
}

/// Global persistent reserve funding ambient pellets (D71). PDA seeds:
/// [FOOD_RESERVE_SEED] — a singleton, it survives across rounds.
/// UNLIKE the Round/Vault pair, data and lamports live in the SAME account:
/// the program owns it, so it can debit lamports directly. Instructions must
/// NEVER let its balance drop below its own rent-exempt minimum.
#[account]
pub struct FoodReserve {
    /// Only signer allowed to inject reserve funds into a round vault.
    pub authority: Pubkey,
    /// Lifetime lamports swept in (round leftovers + reserve share of joins)
    pub total_swept_in: u64,
    /// Lifetime lamports injected out into round vaults
    pub total_injected_out: u64,
    pub bump: u8,
}

impl FoodReserve {
    /// 8 (discriminator) + 32 + 8 + 8 + 1
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1;
}

/// Anti-replay receipt: one PDA per settlement. PDA seeds:
/// [EXTRACT_SEED, round_id.to_le_bytes(), nonce.to_le_bytes()].
/// The PDA's EXISTENCE is the protection: `init` fails if the account already
/// exists, so a (round_id, nonce) pair can never be settled twice.
#[account]
pub struct ExtractReceipt {
    pub round_id: u64,
    /// Wallet that received the payout.
    pub player: Pubkey,
    /// Lamports paid out
    pub amount: u64,
    /// Server-chosen nonce, unique PER round.
    pub nonce: u64,
    /// Unix timestamp of the settlement (audit trail)
    pub settled_at: i64,
    pub bump: u8,
}

impl ExtractReceipt {
    /// 8 (discriminator) + 8 + 32 + 8 + 8 + 8 + 1
    pub const LEN: usize = 8 + 8 + 32 + 8 + 8 + 8 + 1;
}

// --- Errors ------------------------------------------------------------------

#[error_code]
pub enum ArenaError {
    #[msg("End timestamp must be in the future")]
    InvalidDuration,
    #[msg("Stake must be greater than zero")]
    InvalidStake,
    #[msg("rake_bps + reserve_bps must be strictly below 10000")]
    InvalidSplit,
    #[msg("Round is not open")]
    RoundNotOpen,
    #[msg("Round has not ended yet")]
    RoundNotEnded,
    #[msg("Payout exceeds vault balance")]
    InsufficientVault,
    #[msg("Injection exceeds available reserve")]
    InsufficientReserve,
    #[msg("Signer is not the expected authority")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
