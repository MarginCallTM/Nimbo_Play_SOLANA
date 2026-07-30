// programs/arena/src/lib.rs
use anchor_lang::prelude::*;
use anchor_lang::system_program;

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

    /// Variable buy-in (D71 split): rake -> treasury, reserve share ->
    /// FoodReserve, remainder -> vault as the player's spawn value.
    /// Permissionless: joining a round is the player's choice.
    pub fn join(ctx: Context<JoinRound>, stake: u64) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(round.state == RoundState::Open, ArenaError::RoundNotOpen);
        // The state only flips when end_round is CALLED: also refuse joins
        // past the deadline, or they would be swept by the pending sweep.
        let now = Clock::get()?.unix_timestamp;
        require!(now < round.end_timestamp, ArenaError::RoundNotOpen);
        require!(stake > 0, ArenaError::InvalidStake);

        // D71 split. Integer division truncates, so the remainder of BOTH
        // fee shares lands in spawn_value: the three parts always sum
        // EXACTLY to stake. Division by a non-zero constant cannot fail.
        let rake = stake
            .checked_mul(round.rake_bps as u64)
            .ok_or(ArenaError::MathOverflow)?
            / BPS_DENOMINATOR;
        let reserve_share = stake
            .checked_mul(round.reserve_bps as u64)
            .ok_or(ArenaError::MathOverflow)?
            / BPS_DENOMINATOR;
        let spawn_value = stake
            .checked_sub(rake)
            .ok_or(ArenaError::MathOverflow)?
            .checked_sub(reserve_share)
            .ok_or(ArenaError::MathOverflow)?;

        // The player's wallet is System-owned: only the System Program may
        // debit it, with the player's signature - hence CPI transfers.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            spawn_value,
        )?;
        // Tiny stakes can truncate a share to 0: skip the empty CPI.
        if rake > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                rake,
            )?;
        }
        if reserve_share > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.reserve.to_account_info(),
                    },
                ),
                reserve_share,
            )?;
        }

        let round = &mut ctx.accounts.round;
        round.total_staked = round
            .total_staked
            .checked_add(stake)
            .ok_or(ArenaError::MathOverflow)?;
        round.total_deposited = round
            .total_deposited
            .checked_add(spawn_value)
            .ok_or(ArenaError::MathOverflow)?;
        let reserve = &mut ctx.accounts.reserve;
        reserve.total_swept_in = reserve
            .total_swept_in
            .checked_add(reserve_share)
            .ok_or(ArenaError::MathOverflow)?;

        emit!(Joined {
            round_id: round.round_id,
            player: ctx.accounts.player.key(),
            stake,
            spawn_value,
        });
        Ok(())
    }

    /// Pays `amount` from the round vault to `player`. Authority-signed
    /// (Model A): the server's signature IS the proof of extraction.
    /// Anti-replay: the ExtractReceipt init fails if (round_id, nonce)
    /// was already settled - the runtime itself refuses the replay.
    pub fn settle_extraction(
        ctx: Context<SettleExtraction>,
        amount: u64,
        nonce: u64,
    ) -> Result<()> {
        let round = &ctx.accounts.round;
        // Only the sweep (end_round) closes the door: a legit extraction
        // settled just after end_timestamp must still be payable
        require!(round.state == RoundState::Open, ArenaError::RoundNotOpen);

        // Even a compromised server cannot pay out more than the vault
        // holds above its rent-exempt floor (solvency guarantee, D55)
        let vault_info = ctx.accounts.vault.to_account_info();
        let vault_floor = Rent::get()?.minimum_balance(0);
        let available = vault_info.lamports().saturating_sub(vault_floor);
        require!(amount <= available, ArenaError::InsufficientVault);

        // The vault is a SYSTEM-owned PDA: direct debit is illegal (we are
        // not its owner) and it has no private key. invoke_signed: we hand
        // the runtime the vault's seeds + bump, it re-derives the address
        // with OUR program id and grants signer status for this CPI only.
        let round_id_bytes = round.round_id.to_le_bytes();
        let vault_seeds: &[&[u8]] = &[
            VAULT_SEED,
            round_id_bytes.as_ref(),
            &[round.vault_bump],
        ];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.player.to_account_info(),
                },
                &[vault_seeds],
            ),
            amount,
        )?;

        let receipt = &mut ctx.accounts.receipt;
        receipt.round_id = round.round_id;
        receipt.player = ctx.accounts.player.key();
        receipt.amount = amount;
        receipt.nonce = nonce;
        receipt.settled_at = Clock::get()?.unix_timestamp;
        receipt.bump = ctx.bumps.receipt;

        let round = &mut ctx.accounts.round;
        round.total_paid = round
            .total_paid
            .checked_add(amount)
            .ok_or(ArenaError::MathOverflow)?;

        emit!(Extracted {
            round_id: round.round_id,
            player: ctx.accounts.player.key(),
            amount,
            nonce,
        });
        Ok(())
    }

    /// Closes the round: flips the state (which shuts join, inject and
    /// settle all at once) and sweeps the ENTIRE remaining vault balance
    /// - orphan SOL, D50 - into the FoodReserve. Authority-only: a
    /// permissionless close could race and block legit last-second
    /// settlements; the server settles everything, THEN sweeps
    pub fn end_round(ctx: Context<EndRound>) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(round.state == RoundState::Open, ArenaError::RoundNotOpen);
        // Not even the authority can close early: a compromised server
        // must not be able to freeze pending extractions ahead of time.
        let now = Clock::get()?.unix_timestamp;
        require!(now >= round.end_timestamp, ArenaError::RoundNotEnded);

        // Sweep ALL of it, rent floor included: a balance of exactly 0 is
        // legal (the account gets reaped) - only 0 < balance < rent_floor
        // is forbidden. This vault is round-bound and never reused.
        let swept = ctx.accounts.vault.lamports();
        if swept > 0 {
            let round_id_bytes = round.round_id.to_le_bytes();
            let vault_seeds: &[&[u8]] = &[
                VAULT_SEED,
                round_id_bytes.as_ref(),
                &[round.vault_bump],
            ];
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.reserve.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                swept,
            )?;
        }

        let reserve = &mut ctx.accounts.reserve;
        reserve.total_swept_in = reserve
            .total_swept_in
            .checked_add(swept)
            .ok_or(ArenaError::MathOverflow)?;

        let round = &mut ctx.accounts.round;
        round.state = RoundState::Ended;

        emit!(RoundEnded {
            round_id: round.round_id,
            swept,
        });
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

#[derive(Accounts)]
pub struct JoinRound<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    /// has_one: the treasury account below MUST be the one recorded at
    /// initialization - a joiner cannot substitute his own wallet.
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.bump,
        has_one = treasury
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [FOOD_RESERVE_SEED],
        bump = reserve.bump
    )]
    pub reserve: Account<'info, FoodReserve>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: u64)]
pub struct SettleExtraction<'info> {
    /// The round authority (game server). Signs the settlement AND pays
    /// the receipt rent (operational cost, reclaimable via close later)
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.bump,
        has_one = authority @ ArenaError::Unauthorized
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    /// Payout recipient, designated by the server (Model A trust)
    #[account(mut)]
    pub player: SystemAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = ExtractReceipt::LEN,
        seeds = [
            EXTRACT_SEED,
            round.round_id.to_le_bytes().as_ref(),
            nonce.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub receipt: Account<'info, ExtractReceipt>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct EndRound<'info> {
    /// The round authority (game server): the only one allowed to sweep.
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [ROUND_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.bump,
        has_one = authority @ ArenaError::Unauthorized
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [VAULT_SEED, round.round_id.to_le_bytes().as_ref()],
        bump = round.vault_bump
    )]
    pub vault: SystemAccount<'info>,
    /// Sweep destination, pinned by its seeds: no substitution possible.
    #[account(
        mut,
        seeds = [FOOD_RESERVE_SEED],
        bump = reserve.bump
    )]
    pub reserve: Account<'info, FoodReserve>,
    pub system_program: Program<'info, System>,
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

// --- Events ------------------------------------------------------------------

#[event]
pub struct Joined {
    pub round_id: u64,
    pub player: Pubkey,
    pub stake: u64,
    pub spawn_value: u64,
}

#[event]
pub struct Extracted {
    pub round_id: u64,
    pub player: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct RoundEnded {
    pub round_id: u64,
    pub swept: u64,
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