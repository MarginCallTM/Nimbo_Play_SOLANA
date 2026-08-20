# Nimbo Play
Still under construction ➡️ https://nimboplay.dev/ 🦺🚧


Web3 gaming experiments on Solana — a learning and portfolio project exploring
on-chain programs, real-time games, and the infrastructure that connects them.

The repository currently hosts two workstreams:

1. **On-chain lottery** — a complete decentralized lottery (Anchor program,
   indexer, database, frontend). The original project, kept as a reference
   implementation of the on-chain patterns used across the codebase.
2. **Game prototype** (`proto/`) — an early-stage arcade game prototype built
   with PixiJS + TypeScript. Gameplay exploration in progress; details to be
   announced.

> ⚠️ **Devnet only.** The lottery MVP uses simple on-chain pseudo-randomness,
> which a validator can influence. It is **not secure** and must be replaced by
> a VRF (e.g. Switchboard) before any real use. Do not deploy to mainnet as-is.

## Architecture (lottery)

```
Frontend (Next.js + wallet) --RPC--> Solana devnet (Anchor program)
        |                                   | emits events
        | reads history                     v
        +-------------------------->  Indexer  -->  PostgreSQL (cache)
```

- **On-chain program** (`programs/lottery`): the source of truth. Instructions
  `initialize_lottery`, `buy_ticket`, `draw_winner`, `payout`.
- **Indexer** (Rust): decodes program events, fills the cache idempotently
  (replayable backfill, polling daemon with a persisted cursor).
- **PostgreSQL**: a reconstructible cache mirroring on-chain state. Never holds
  critical logic.
- **Backend** (Rust/Axum): read-only API over the cache (work in progress).
- **Frontend** (`app/`, Next.js 16 + Tailwind): wallet connection, on-chain
  reads via the Anchor client (write flows in progress).

Program ID (devnet): `DD5CPAQWUtKSBajtNT9w4QbJysQnuWeDZ6yCdXKAYwro`

## Tech stack

| Layer        | Choice                            |
|--------------|-----------------------------------|
| On-chain     | Rust + Anchor 0.31.1              |
| Currency     | Native SOL (lamports)             |
| Backend      | Rust + Axum + sqlx                |
| Database     | PostgreSQL 16                     |
| Frontend     | Next.js 16 (App Router, Tailwind) |
| Game client  | PixiJS 8 + TypeScript (Vite)      |
| Network      | Solana devnet                     |

## Prerequisites

- Rust toolchain + Solana CLI + Anchor (for the on-chain program)
- Docker (for the local PostgreSQL service)
- `sqlx-cli` (for migrations): `cargo install sqlx-cli --no-default-features --features postgres`
- Node.js 20+ (frontend and game prototype)

## Getting started

### 1. Database (Docker)

The database runs as a container described in `docker-compose.yml`.

```bash
cp .env.example .env          # local config (gitignored)
docker compose up -d          # start PostgreSQL in the background
docker compose ps             # wait until the service is "healthy"
```

PostgreSQL is exposed on host port **5433** (port 5432 is left free for any
native install). The connection string lives in `.env`:

```
DATABASE_URL=postgres://lottery:lottery@localhost:5433/lottery_db
```

Apply the schema:

```bash
cd backend && sqlx migrate run
```

### 2. On-chain program

```bash
make build        # anchor build
make test         # anchor test (localnet, runs the full test suite)
```

Deploy to devnet (rebuild with the v0 arch first):

```bash
cargo build-sbf --manifest-path programs/lottery/Cargo.toml --arch v0
solana program deploy target/deploy/lottery.so \
  --program-id target/deploy/lottery-keypair.json \
  --url devnet
```

### 3. Frontend

```bash
cd app && npm install && npm run dev
```

### 4. Game prototype

```bash
cd proto && npm install && npm run dev
```

### 5. Backend tests

Integration tests use `#[sqlx::test]`, which spins up an ephemeral database per
test. Point `DATABASE_URL` at the running PostgreSQL server:

```bash
cd backend && DATABASE_URL="postgres://lottery:lottery@localhost:5433/lottery_db" cargo test
```

## Status

**Lottery**
- [x] On-chain program + tests (green on localnet), deployed on devnet
- [x] Database schema + repositories + tests, local PostgreSQL via Docker
- [x] Indexer (event decoding, idempotent dispatch, backfill, polling daemon)
- [x] Frontend shell: wallet connection, on-chain reads, themed UI
- [ ] Frontend write flows (buy ticket, claim), read API, history pages

**Game prototype**
- [x] Playable single-player prototype (client-only, no blockchain)
- [ ] Next steps: to be announced

## Security

- All critical logic (winner selection, fund movements) is on-chain.
- The `Vault` PDA holds funds, kept separate from the `Lottery` state account.
- On-chain randomness is **insecure** and devnet-only — see the warning above.
