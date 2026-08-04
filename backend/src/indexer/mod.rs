// Off-chain side of both programs: decoding on-chain events and the
// polling loops that mirror them into Postgres.
pub mod events;
pub mod dispatch;
// A3.4 — same pattern, arena program (Joined/Extracted/RoundEnded)
pub mod arena_events;
pub mod arena_dispatch;