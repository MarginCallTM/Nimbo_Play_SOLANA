-- =====================================================================
-- A3.4 — ARENA mirror tables. Same doctrine as the lottery (D9):
-- a RECONSTRUCTIBLE cache of on-chain events, zero critical logic.
-- Wipe everything, replay the chain, get the same rows back.
--
-- Idempotence anchors (the key design choice of phase 9, reused):
--   arena_joins        -> (signature, event_index): a tx normally holds
--                         one join, but nothing on-chain forbids two —
--                         the event's position in the tx disambiguates.
--   arena_extractions  -> (round_id, nonce): the chain's own anti-replay
--                         key (one ExtractReceipt PDA per pair) — free.
--   arena_rounds       -> round_id. NOTE: the program emits no event at
--                         initialize_round (A2.7 gap, backlog) — a round
--                         appears here at its FIRST observed event.
-- =====================================================================

CREATE TABLE arena_rounds (
    round_id BIGINT PRIMARY KEY,
    -- mirror of the on-chain state we can OBSERVE via events:
    -- 'Open' until a RoundEnded event arrives.
    state TEXT NOT NULL DEFAULT 'Open',
    swept_lamports BIGINT,          -- set by RoundEnded (orphan SOL, D50)
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE arena_joins (
    signature VARCHAR(88) NOT NULL,
    event_index SMALLINT NOT NULL,  -- position of the event within the tx
    round_id BIGINT NOT NULL REFERENCES arena_rounds(round_id),
    player VARCHAR(44) NOT NULL,    -- base58 wallet
    stake_lamports BIGINT NOT NULL, -- gross deposit
    spawn_value_lamports BIGINT NOT NULL, -- net after on-chain split
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (signature, event_index)
);
CREATE INDEX idx_arena_joins_round ON arena_joins(round_id);
CREATE INDEX idx_arena_joins_player ON arena_joins(player);

CREATE TABLE arena_extractions (
    round_id BIGINT NOT NULL REFERENCES arena_rounds(round_id),
    nonce BIGINT NOT NULL,          -- u64 on-chain; ours are ~1.8e15, far
                                    -- below the 9.2e18 BIGINT ceiling
    player VARCHAR(44) NOT NULL,
    amount_lamports BIGINT NOT NULL,
    signature VARCHAR(88) NOT NULL, -- settle tx (audit trail)
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (round_id, nonce)
);
CREATE INDEX idx_arena_extractions_player ON arena_extractions(player);

-- Net flow per wallet: what A3.4 calls "les soldes". Deposits are what
-- players put in (gross), payouts what the authority settled to them.
CREATE VIEW arena_wallet_flows AS
SELECT
    player, -- USING(player) merges both sides (FULL JOIN semantics)
    -- SUM(BIGINT) yields NUMERIC in Postgres (overflow-proof); cast
    -- back to BIGINT for clean i64 decoding client-side
    COALESCE(j.total_staked, 0)::BIGINT     AS total_staked_lamports,
    COALESCE(e.total_extracted, 0)::BIGINT  AS total_extracted_lamports,
    (COALESCE(e.total_extracted, 0) - COALESCE(j.total_staked, 0))::BIGINT
                                            AS net_lamports
FROM
    (SELECT player, SUM(stake_lamports) AS total_staked
     FROM arena_joins GROUP BY player) j
FULL OUTER JOIN
    (SELECT player, SUM(amount_lamports) AS total_extracted
     FROM arena_extractions GROUP BY player) e
USING (player);
