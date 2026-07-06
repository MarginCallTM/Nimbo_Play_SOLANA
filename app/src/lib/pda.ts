import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

// Seed prefixes - must match the on-chain constants in lib.rs byte for byte.
const LOTTERY_SEED = "lottery";
const VAULT_SEED = "vault";
const TICKET_SEED = "ticket";

const encoder = new TextEncoder();

// Rust writes round_id.to_le_bytes(): u64, little-endian, 8 bytes.
// JS numbers are f64 (exact only up to 2^53) so we go through BigInt;
// `true` in setBigUint64 = little-endian.
function u64ToLeBytes(value: number | bigint): Uint8Array {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
    return bytes;
}

// Same algorithm as Pubkey::find_program_address on-chain: hash the seeds
// + program id + bump, walking bump down from 255 until the result is
// off-curve. We only need the address; Anchor re-checks the bump on-chain.
export function deriveLotteryPda(roundId: number | bigint): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [encoder.encode(LOTTERY_SEED), u64ToLeBytes(roundId)],
        PROGRAM_ID,
    );
    return pda;
}

export function deriveVaultPda(roundId: number | bigint): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [encoder.encode(VAULT_SEED), u64ToLeBytes(roundId)],
        PROGRAM_ID,
    );
    return pda;
}

// Ticket PDA: one account per ticket, indexed within its round.
export function deriveTicketPda(
    roundId: number | bigint,
    ticketIndex: number | bigint,
): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [
            encoder.encode(TICKET_SEED),
            u64ToLeBytes(roundId),
            u64ToLeBytes(ticketIndex),
        ],
        PROGRAM_ID,
    );
    return pda;
}

// TEMP check - round 1782381011 exists on devnet at this address:
console.log(
    deriveLotteryPda(1782381011).toBase58() ===
        "3r5DSTtjBr3bEcSdySsqPJtM1LaRZ3muFC8SUBTV6H3J",
);