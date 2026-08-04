// A3.4 — off-chain decoding of the ARENA program's Anchor events.
// Same discipline as the lottery decoder (events.rs): discriminators
// copied verbatim from the IDL, CPI-safe log scoping, and every decode
// failure is a "skip", never a panic — log data is UNTRUSTED input.
//
// The three events mirror the money flow, not the gameplay (the chain
// never sees the game — D44): Joined = deposit split, Extracted =
// authority-settled payout, RoundEnded = orphan sweep (D50).

use base64::prelude::*;
use borsh::{BorshDeserialize, BorshSerialize};

// -- Event discriminators, copied verbatim from target/idl/arena.json --
const DISC_JOINED: [u8; 8] = [16, 20, 44, 48, 132, 189, 68, 98];
const DISC_EXTRACTED: [u8; 8] = [39, 93, 179, 61, 60, 155, 22, 54];
const DISC_ROUND_ENDED: [u8; 8] = [70, 113, 6, 162, 176, 78, 201, 19];

// Raw 32-byte pubkey, converted to base58 in the dispatch layer only —
// the decoder stays free of solana-sdk types (same choice as lottery).
type RawPubkey = [u8; 32];

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone, PartialEq)]
pub struct Joined {
    pub round_id: u64,
    pub player: RawPubkey,
    pub stake: u64,       // gross deposit
    pub spawn_value: u64, // net after on-chain split (rake, reserve)
}

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone, PartialEq)]
pub struct Extracted {
    pub round_id: u64,
    pub player: RawPubkey,
    pub amount: u64,
    pub nonce: u64, // the anti-replay key: unique per round, on-chain
}

#[derive(BorshDeserialize, BorshSerialize, Debug, Clone, PartialEq)]
pub struct RoundEnded {
    pub round_id: u64,
    pub swept: u64, // orphan SOL moved to the FoodReserve (D50)
}

#[derive(Debug, Clone, PartialEq)]
pub enum ArenaEvent {
    Joined(Joined),
    Extracted(Extracted),
    RoundEnded(RoundEnded),
}

// Decode one "Program data:" payload (prefix already stripped).
fn decode_event_payload(b64: &str) -> Option<ArenaEvent> {
    let bytes = BASE64_STANDARD.decode(b64).ok()?;
    if bytes.len() < 8 {
        return None;
    }
    let (disc, payload) = bytes.split_at(8);
    let disc: [u8; 8] = disc.try_into().ok()?;

    let event = if disc == DISC_JOINED {
        ArenaEvent::Joined(Joined::try_from_slice(payload).ok()?)
    } else if disc == DISC_EXTRACTED {
        ArenaEvent::Extracted(Extracted::try_from_slice(payload).ok()?)
    } else if disc == DISC_ROUND_ENDED {
        ArenaEvent::RoundEnded(RoundEnded::try_from_slice(payload).ok()?)
    } else {
        return None;
    };
    Some(event)
}

// Walk a transaction's logs and decode every event OUR program emitted,
// in order. Same invoke/success stack as the lottery walker: a
// "Program data:" line only counts while OUR program is executing.
pub fn decode_arena_events(logs: &[String], program_id: &str) -> Vec<ArenaEvent> {
    let mut events = Vec::new();
    let mut stack: Vec<&str> = Vec::new();

    for line in logs {
        if let Some(rest) = line.strip_prefix("Program ") {
            if let Some(pos) = rest.find(" invoke [") {
                stack.push(&rest[..pos]);
                continue;
            }
            if rest.ends_with(" success") || rest.contains(" failed") {
                stack.pop();
                continue;
            }
        }
        if let Some(b64) = line.strip_prefix("Program data: ") {
            if stack.last().copied() == Some(program_id) {
                if let Some(ev) = decode_event_payload(b64) {
                    events.push(ev);
                }
            }
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program_data_line(disc: [u8; 8], payload: Vec<u8>) -> String {
        let mut bytes = disc.to_vec();
        bytes.extend(payload);
        format!("Program data: {}", BASE64_STANDARD.encode(bytes))
    }

    #[test]
    fn decodes_all_three_events_in_order() {
        let prog = "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d";
        let joined = Joined { round_id: 9, player: [7u8; 32], stake: 100, spawn_value: 84 };
        let extracted = Extracted { round_id: 9, player: [7u8; 32], amount: 50, nonce: 42 };
        let ended = RoundEnded { round_id: 9, swept: 34 };
        let logs = vec![
            format!("Program {prog} invoke [1]"),
            program_data_line(DISC_JOINED, borsh::to_vec(&joined).unwrap()),
            program_data_line(DISC_EXTRACTED, borsh::to_vec(&extracted).unwrap()),
            program_data_line(DISC_ROUND_ENDED, borsh::to_vec(&ended).unwrap()),
            format!("Program {prog} success"),
        ];
        assert_eq!(
            decode_arena_events(&logs, prog),
            vec![
                ArenaEvent::Joined(joined),
                ArenaEvent::Extracted(extracted),
                ArenaEvent::RoundEnded(ended),
            ]
        );
    }

    #[test]
    fn ignores_foreign_program_data() {
        let ours = "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d";
        let other = "11111111111111111111111111111111";
        let joined = Joined { round_id: 1, player: [1u8; 32], stake: 1, spawn_value: 1 };
        let logs = vec![
            format!("Program {ours} invoke [1]"),
            format!("Program {other} invoke [2]"),
            program_data_line(DISC_JOINED, borsh::to_vec(&joined).unwrap()),
            format!("Program {other} success"),
            format!("Program {ours} success"),
        ];
        assert!(decode_arena_events(&logs, ours).is_empty());
    }

    #[test]
    fn garbage_never_panics() {
        let prog = "8qGdXYu3prvvvhCEfMnatdv5BAQyVL5NWsh7v5esEF2d";
        let logs = vec![
            format!("Program {prog} invoke [1]"),
            "Program data: not-base64!!!".to_string(),
            "Program data: AAAA".to_string(), // < 8 bytes once decoded
            program_data_line(DISC_JOINED, vec![1, 2, 3]), // truncated borsh
            format!("Program {prog} success"),
        ];
        assert!(decode_arena_events(&logs, prog).is_empty());
    }
}
