// A3.4 — mirror a decoded ArenaEvent into Postgres, idempotently.
// Same doctrine as the lottery dispatch (D9): we RECOPY what the chain
// decided, we never compute anything financial here. Inline sqlx (no
// repository layer): three small tables, one writer — the indirection
// would cost more than it buys at this size.

use anyhow::Result;
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;

use crate::indexer::arena_events::ArenaEvent;

fn to_base58(raw: &[u8; 32]) -> String {
    Pubkey::new_from_array(*raw).to_string()
}

// Every event proves its round exists on-chain — and the program emits
// nothing at initialize_round (A2.7 gap), so this lazy insert is how
// rounds enter the cache at all.
async fn ensure_round(pool: &PgPool, round_id: i64) -> Result<()> {
    sqlx::query("INSERT INTO arena_rounds (round_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(round_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Idempotently mirror one decoded event. `event_index` is the event's
/// position within its transaction — part of the joins anchor (one tx
/// COULD carry several join instructions; nothing on-chain forbids it).
pub async fn dispatch_arena_event(
    pool: &PgPool,
    signature: &str,
    event_index: i16,
    event: &ArenaEvent,
) -> Result<()> {
    match event {
        ArenaEvent::Joined(e) => {
            ensure_round(pool, e.round_id as i64).await?;
            sqlx::query(
                "INSERT INTO arena_joins
                   (signature, event_index, round_id, player, stake_lamports, spawn_value_lamports)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT DO NOTHING",
            )
            .bind(signature)
            .bind(event_index)
            .bind(e.round_id as i64)
            .bind(to_base58(&e.player))
            .bind(e.stake as i64)
            .bind(e.spawn_value as i64)
            .execute(pool)
            .await?;
        }
        ArenaEvent::Extracted(e) => {
            ensure_round(pool, e.round_id as i64).await?;
            sqlx::query(
                "INSERT INTO arena_extractions
                   (round_id, nonce, player, amount_lamports, signature)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING",
            )
            .bind(e.round_id as i64)
            .bind(e.nonce as i64)
            .bind(to_base58(&e.player))
            .bind(e.amount as i64)
            .bind(signature)
            .execute(pool)
            .await?;
        }
        ArenaEvent::RoundEnded(e) => {
            ensure_round(pool, e.round_id as i64).await?;
            // last write wins on replay: the chain only ever emits ONE
            // RoundEnded per round (state flip forbids a second), so
            // "last" and "only" are the same value.
            sqlx::query(
                "UPDATE arena_rounds SET state = 'Ended', swept_lamports = $2
                 WHERE round_id = $1",
            )
            .bind(e.round_id as i64)
            .bind(e.swept as i64)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::arena_events::{Extracted, Joined, RoundEnded};

    // A full round as the chain would emit it: two joins (one player
    // twice — respawn = redeposit), one extraction, the final sweep.
    fn sample_round() -> Vec<(&'static str, i16, ArenaEvent)> {
        vec![
            ("sig_j1", 0, ArenaEvent::Joined(Joined {
                round_id: 5, player: [10u8; 32], stake: 100_000_000, spawn_value: 84_500_000,
            })),
            ("sig_j2", 0, ArenaEvent::Joined(Joined {
                round_id: 5, player: [11u8; 32], stake: 250_000_000, spawn_value: 211_250_000,
            })),
            ("sig_e1", 0, ArenaEvent::Extracted(Extracted {
                round_id: 5, player: [10u8; 32], amount: 90_000_000, nonce: 777,
            })),
            ("sig_end", 0, ArenaEvent::RoundEnded(RoundEnded {
                round_id: 5, swept: 205_750_000,
            })),
        ]
    }

    async fn replay(pool: &PgPool) {
        for (sig, idx, event) in sample_round() {
            dispatch_arena_event(pool, sig, idx, &event).await.unwrap();
        }
    }

    async fn count(pool: &PgPool, table: &str) -> i64 {
        let (n,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();
        n
    }

    #[sqlx::test]
    async fn replay_is_deterministic_and_idempotent(pool: PgPool) {
        replay(&pool).await;
        replay(&pool).await; // second replay must change NOTHING

        assert_eq!(count(&pool, "arena_rounds").await, 1);
        assert_eq!(count(&pool, "arena_joins").await, 2, "no double-counted joins");
        assert_eq!(count(&pool, "arena_extractions").await, 1);

        let (state, swept): (String, Option<i64>) = sqlx::query_as(
            "SELECT state, swept_lamports FROM arena_rounds WHERE round_id = 5",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(state, "Ended");
        assert_eq!(swept, Some(205_750_000));

        // the balances view: player 10 net = +90 -100 = -10 M lamports
        let p10 = Pubkey::new_from_array([10u8; 32]).to_string();
        let (net,): (i64,) = sqlx::query_as(
            "SELECT net_lamports FROM arena_wallet_flows WHERE player = $1",
        )
        .bind(&p10)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(net, -10_000_000);
    }
}
