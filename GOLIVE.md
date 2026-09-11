# GOLIVE.md — the road from devnet showcase to live mainnet product

> **What this file is.** The ordered, finite list of work that stands between
> today's devnet deployment and a Nimbo Arena that holds real money for real
> players. Written 2026-09-11.
>
> **What this file is NOT.** The feature backlog. Gameplay, visuals, lottery,
> SEO and the rest live in `TODO.txt` / `ArenaVisualsTODO.md` / `FrontTODO.txt`.
> Nothing here is an enhancement. Every item is a way the product is currently
> unfit to hold someone else's SOL, or a lie the site currently tells.
>
> **Scope note.** Legal/regulatory positioning is parked by explicit decision
> (D68) and is deliberately absent from this document.

---

## The one ordering rule

**G5 (delete every "devnet" mention) happens LAST, in the same deploy window as
the mainnet switch — never before.**

Removing the devnet disclaimers while still running on devnet does not make the
site truer, it makes it false in the opposite direction: visitors would be told
they are risking real money when they are not, and would be asked to connect a
wallet under that belief. That is the exact category of misleading content that
`AF.2(g)` was opened for and that is *still outstanding today* (the site claims
"mainnet" and "VRF"; both are false). Do not add a second instance of the same
debt while clearing the first.

Everything else can proceed in parallel. The dependency spine is:

```
G1 servers ──────────────┐
G2 stake calibration ────┼──> G4 mainnet switch ──> G5 truth pass
G3 security & custody ───┘         (one window)     (same window)
```

---

## G1 — Finish the three regions (EU / US / Asia)

**Status: designed, not built. One region (EU, Hetzner Nuremberg) is live.**

The client already carries a deliberately inert `🌐 CHOOSE SERVER · SOON`
button (`arena/client/src/menu.ts`). The client side of this is small:
`SERVER_URL` is a build-time constant used in exactly four places —
`new Client()`, `signInWithSolana()`, `sendJoinDeposit()` and `POST /report`
(`arena/client/src/main.ts`). Making it a runtime choice is hours, not days.

**The hard part is not the client. It is that all money state is per-process.**

`consumed-deposits.jsonl` (deposit anti-replay), `settlement-outbox.jsonl`
(debts *and* the nonce allocator) and the round manager are local files in one
container's volume. All three carry the same comment: *assumes ONE server
process; sharding moves it to Postgres/Redis (APROD.7)*. Three regions is that
shard.

### The three ways players lose money if regions share a round

| # | Failure | Why |
|---|---|---|
| **H1** | **Cross-region deposit replay.** One 1 SOL deposit buys three snakes. | `verifyDeposit()` binds the tx to the round, the amount and the SIWS wallet — to nothing server-specific. Uniqueness comes only from the *local* `isConsumed()`. Present the same `txSig` to EU, US and AP inside the 10-minute window and all three accept it. The vault holds one stake, the arena issues three. That is minting, and it drains by extraction. |
| **H2** | **Nonce collision.** A real payout vanishes with a success message. | `nonceCursor` is seeded per process from `Date.now()*1000`. Two processes can emit the same nonce for the same round; `ExtractReceipt(round_id, nonce)` then refuses the second payout permanently, and the settlement service reads the existing receipt, concludes "already settled" and acks a debt it never paid. This is the A4.6 red-team bug, re-opened by multi-process. |
| **H3** | **Concurrent round closure.** Happens on its own, no attacker needed. | `drainOldRounds()` closes a round when it sees no rooms and no debts — *of its own*. EU drains, requests `end_round`, the vault is swept into the FoodReserve while five players are still mid-run in Asia. Their extractions fail forever (`state != Open`). |

Note that the round id is derived as `floor(t / DURATION) * DURATION` — pure,
deterministic, **identical on every box**. Sharing is therefore the *default*
behaviour, not a risk that requires bad luck.

### The fix: one region = one round. Zero lines of Rust.

`round_id` is a free `u64` chosen by the authority; it is only a PDA seed.

```
round_id = slot + regionIndex          // eu = 0, us = 1, ap = 2
```

One round, one vault, one nonce space per region. And the closing argument:
`verifyDeposit()` already refuses any round this server did not itself register
(`byPda` → *"deposit went to a different round"*). So an EU deposit presented to
the US server is rejected **by code that already exists**. H1, H2 and H3 were
one disease — "two processes, one vault" — and this cures all three
structurally.

Accepted trade-off: liquidity is partitioned per region. That is inherent; your
stake sits in the vault of the region you play in.

Rejected alternative: a central money service with the game servers as pure
gameplay nodes. Architecturally cleaner, much larger, and it puts an
intercontinental round-trip on the `join` path. Revisit only if regions ever
need shared liquidity.

### Tasks

- [ ] **G1.1** Region registry, shared and typed: `{ id, label, url }`.
      Build-time default = today's single local region so `localhost` dev is
      unchanged.
- [ ] **G1.2** `round_id = slot + regionIndex` in `round-manager.ts`
      (`slotOf` / `freshSlotAfter` / `plannedEndTs`). `REGION_INDEX` from env,
      **refuse to boot if unset in paid mode** — a default of 0 silently
      recreates the shared-round bug.
- [ ] **G1.3** Nonce namespacing by region (belt and braces on H2, even though
      G1.2 already separates the receipt PDA space).
- [ ] **G1.4** `GET /ping` (204, CORS-open, no state) and `GET /status`
      (`{ region, players, paidPlayers, roundOpen }`) on the game server.
- [ ] **G1.5** Client region picker: probe each region 3× on `/ping`, keep the
      minimum, rank; show **latency AND population** per region; auto-select
      best ping on first visit, persist the choice, let the player override.
      A region that fails its probe renders as unavailable, never as an option
      that hangs on click.
- [ ] **G1.6** `SERVER_URL` becomes the selected region everywhere (4 call
      sites). **`AUTH_DOMAIN` on every regional server stays the domain the
      page is served from** (`arena.nimboplay.dev`), *not* the regional
      hostname — the client signs with `window.location.host`. Getting this
      wrong refuses every paid game on that region with no clear message.
- [ ] **G1.7** Per-region Caddy hostname (`eu.` / `us.` / `ap.`) + DNS, grey
      cloud (no proxy — latency), certificates verified per box.
- [ ] **G1.8** `docker-compose` parameterised by region; `DEPLOY.md` updated to
      "deploy to N boxes" including the `restart ≠ up -d ≠ --build` trap.
- [ ] **G1.9** Provision the two extra boxes. **Hetzner has no APAC region —
      verify before assuming** (Vultr / Linode Tokyo or Singapore are the
      likely candidates). Budget ~€8–25/month each.
- [ ] **G1.10** Settlement topology — **decide before writing G1.2**:
      - *Central* (recommended): one copy of the authority key; the Rust
        settlement service polls a **list** of servers instead of one
        `GAME_SERVER_URL` (~30 lines). Each game server exposes
        `/settlement/*` through Caddy, restricted by source IP **and** a
        distinct secret per region. Consistent with G3: APROD.2 then has one
        key consumer to harden, not three.
      - *Per-region*: simpler to deploy, no inbound port, one region failing
        does not stop the others — but the signing key goes from one machine
        to three, immediately before a security audit.

**Product warning, to design for rather than discover in production.** Paid
matches are already scarce (the launch gate needs ≥2 depositors). Dividing that
by three risks three empty arenas instead of one thin one. G1.5's population
display is the mitigation, and it is not optional.

**Unrelated but adjacent:** the latency that motivated extra regions was
measured **at low ping** — it is `A4.14` (~20px prediction divergence), not
geography. Both are worth doing; neither fixes the other.

**Done when:** a player in three different continents each completes a paid
run — deposit, play, extract, payout received — against their own region, and
a deposit made on one region is *refused* by the other two.

---

## G2 — Recalibrate the stakes for a real-money beta

**Status: not started. Current tiers are devnet-sized.**

```
arena/shared/src/index.ts:267       STAKE_TIERS_SOL = [0, 0.1, 0.25, 0.5, 1]
arena/shared/src/arena-chain.ts:201 MIN_STAKE_LAMPORTS = 100_000_000n  // 0.1 SOL
```

On devnet those are free tokens. On mainnet, **1 SOL is real money and 0.1 SOL
is a real loss** — the wrong entry price for a beta whose whole purpose is to
find out what breaks. The tiers must come down a lot.

### The floor is NOT a matter of taste — it is set by on-chain cost

`settle_extraction` opens an `ExtractReceipt` PDA with **`payer = authority`**
(`programs/arena/src/lib.rs`), 73 bytes, **and the account is never closed**.

| Item | Value |
|---|---|
| Rent-exempt reserve, 73-byte account | `(128 + 73) × 3480 × 2` ≈ **1 398 960 lamports ≈ 0.0014 SOL** |
| Transaction fee | ~5 000 lamports |
| **Cost to the house, per settlement** | **≈ 0.0014 SOL, permanently locked** |
| Rake collected on a 0.01 SOL stake (5.5%) | 0.00055 SOL |

**At a 0.01 SOL stake the house loses roughly 2.5× the rake on every
extraction.** Break-even is around **0.026 SOL** per settled run
(`0.001405 / 0.055`). Refunds settle through the same rails, so a launch-gate
timeout on a tiny stake also burns 0.0014 SOL of locked rent for a run that
never happened.

> ⚠ Verify the rent figure against the live cluster (`solana rent 73`) before
> fixing any number. The formula above is the standard one but the constants
> are a chain parameter, not a law.

### Tasks

- [ ] **G2.1** Confirm the real rent + fee cost per settlement on mainnet.
- [ ] **G2.2** Decide the beta tier ladder against that floor. A ladder whose
      bottom rung sits below break-even is a subsidy — which is a legitimate
      choice for a beta, but it must be a **chosen, budgeted** subsidy with a
      cap, not an accident discovered in the settlement wallet's balance.
- [ ] **G2.3** Re-derive `MIN_STAKE_LAMPORTS`. Its current job (A4.6) is to
      stop a 1-lamport kamikaze: score 0 is the smallest, fastest-turning
      snake there is, so a near-zero join is a free weapon against a whale.
      Lowering the tiers **weakens that guard** — the floor must stay
      meaningfully above zero relative to the new top tier, not just above the
      new bottom one. The relevant ratio is top ÷ floor, and it should not grow.
- [ ] **G2.4** Re-check the rake split arithmetic at small numbers:
      `splitStake()` with 5.5% rake + 2% pellet fund on a small stake — verify
      integer rounding never produces a 0-lamport pellet fund or a spawn value
      that rounds to nothing.
- [ ] **G2.5** Re-check the SOL↔score rate and the soft cap knee (1 SOL, A4.12)
      against the new ladder. The knee is expressed in SOL; if the top tier
      drops 10×, the cap never binds and the anti-snowball brake is gone.
- [ ] **G2.6** Fund and **monitor the authority wallet**. It pays every receipt
      rent and every fee out of its own balance. If it runs dry, **no player
      gets paid** and debts silently pile up in the outbox. Needs a balance
      alert with a threshold measured in days of runway, not in SOL.
- [ ] **G2.7** *(optional, program change → re-audit)* A `close_receipt`
      instruction to reclaim receipt rent after a round ends. Turns a
      permanent per-extraction cost into a temporary one. Real money, but it
      re-opens the program and therefore G3's audit. Sequence it accordingly:
      either before the audit or not at all.

**Done when:** the tier ladder, the floor and the house's per-run cost are
written down together and the arithmetic balances at the *lowest* rung.

---

## G3 — Security and custody (the actual mainnet blockers)

**Status: none of this is started.** These are not finishing touches. They are
four distinct ways to lose players' money, and they gate everything.

- [ ] **G3.1 — `AF.6` full security audit.** Adversarial pass over the whole
      stack: the program, the server's money paths, SIWS, the settlement rails,
      the deposit/nonce ledgers, the newly multi-region surface from G1. Run
      the existing `arena/loadtest/money-attack.ts` against the final
      configuration.
- [ ] **G3.2 — `APROD.4` escrow program audit.** The program has never been
      audited by anyone but us. It is the only thing standing between a bug and
      the vault.
- [ ] **G3.3 — `APROD.2` custody: authority key → multisig / KMS.** Today **one
      key on one VPS signs every payout**, and G1 threatens to make that three.
      Covers both signing keys *and* the program's **upgrade authority** —
      an upgradeable program whose upgrade key sits on a game server is a
      full-custody risk regardless of how good the program is. Squads is the
      standard Solana answer; verify current practice rather than trusting this
      line.
- [ ] **G3.4 — `APROD.5` resilience: a crashed server must not strand funds.**
      Today a server that dies mid-round leaves stakes escrowed with no path
      out except the operator. Needs an on-chain timeout/refund so players can
      recover their own money without us.
- [ ] **G3.5 — Back up `/data`.** `settlement-outbox.jsonl` **is** the debt
      ledger. Losing that volume means losing the record of who is owed what —
      unrecoverable, and on mainnet that is other people's money. Off-box,
      automated, and *restore-tested*.
- [ ] **G3.6 — Kill switch.** The ability to stop accepting new paid joins
      **without** killing rooms in progress (disconnecting a live player is a
      death and a lost stake). The free-only degradation path already exists —
      make it a deliberate, documented operator action.
- [ ] **G3.7 — Monitoring & alerting.** At minimum: authority balance,
      unacked claim age (a debt older than N minutes means settlement is
      broken), per-region server liveness, RPC error rate.

**Done when:** G3.1–G3.4 are closed, not deferred. This is the section that
decides whether go-live is responsible or reckless.

---

## G4 — The mainnet switch

**Status: not started. Do not begin until G3 closes.**

- [ ] **G4.1** Deploy the audited program to mainnet-beta → **new program id**.
      Propagate: `Anchor.toml`, `NEXT_PUBLIC_PROGRAM_ID`, the arena shared
      constants, the settlement service, `.env.example`.
- [ ] **G4.2** Upgrade authority set to the G3.3 multisig **at deploy time**,
      not afterwards.
- [ ] **G4.3** Paid RPC endpoint for mainnet (Helius/QuickNode) on every
      region + the settlement box. The public endpoint will not carry this,
      and an RPC failure on the join path reads to a player as "my deposit
      vanished". Note `arena/client/src/wallet.ts:27` hardcodes
      `https://api.devnet.solana.com` — that one is **not** env-driven today.
- [ ] **G4.4** `initialize_reserve` + first rounds opened on mainnet, per
      region, with the real treasury pubkey.
- [ ] **G4.5** Fund the authority wallet with real SOL (see G2.6) and verify
      the alert fires below threshold.
- [ ] **G4.6** End-to-end rehearsal **on mainnet with the smallest tier**,
      per region: sign in → deposit → play → extract → payout received. Then
      the same for a death and for a launch-gate refund. This is the
      `AF.2(h)` lesson — the paid path was never exercised on the current
      domain, and an untested paid path fails silently for everyone at once.
- [ ] **G4.7** Decide the devnet deployment's fate: keep it as a public
      sandbox (clearly labelled) or retire it. If kept, it needs its own
      hostname so nothing about it can be mistaken for the live product.

---

## G5 — The truth pass: delete every "devnet" claim

**Status: not started. LAST. Same deploy window as G4 — see the ordering rule.**

Every one of these currently tells the visitor the game is free-money play.
The day the switch flips, every one of them becomes a lie in the dangerous
direction.

### Portal (`app/`)

- [ ] `src/components/site/footer.tsx:30` — legal line, *"runs on Solana
      devnet… holds no monetary value"*. **The highest-stakes string on the
      site.**
- [ ] `src/components/site/footer.tsx:96` — "Running on Solana devnet."
- [ ] `src/components/site/hero.tsx` — the status-pill comment block says a
      badge, if ever restored, *states devnet*. Update the instruction, not
      just the copy.
- [ ] `src/components/site/faq.tsx:27` — the "Is this real money?" answer.
- [ ] `src/components/vaults/dashboard-card.tsx:229` — "Solana Devnet".
- [ ] `src/components/vaults/lottery-debug.tsx:27` — "fetching devnet…".
- [ ] `src/app/layout.tsx:30` — **the shared-link meta description** ("Live on
      devnet"). This is what appears in every Discord/Twitter preview.
- [ ] `src/lib/constants.ts:16` — `https://api.devnet.solana.com` fallback.
- [ ] `src/lib/anchor.ts`, `src/app/providers.tsx` — devnet-tuned comments and
      RPC assumptions.

### Documentation (`docs/`)

- [ ] `index.mdx` — frontmatter `description` + the top callout.
- [ ] `quickstart.mdx` — **the largest rewrite**: "switch Phantom to devnet",
      "get devnet SOL", the faucet steps and the `solana airdrop` command all
      become *"fund a mainnet wallet"*. A quickstart that still teaches the
      faucet is a quickstart for a product that no longer exists.
- [ ] `game-rules.mdx` — the denomination callout.
- [ ] `security.mdx` — the deployment callout **and** the "devnet is a testbed /
      moving to real money requires work" section, which must be rewritten to
      state what was actually done (G3), not what remains to do.
- [ ] `trust-model.mdx` — the callout, the "holds nothing of value" line, and
      the `Cluster` row of the summary table.

### Game client (`arena/client/`)

- [ ] `wallet.ts:25-27,162` — `DEVNET_RPC` constant and the `Connection` built
      from it. **Functional, not cosmetic** (see G4.3).
- [ ] `main.ts:54-61` — the *"a devnet 'simulation failed' warning is normal"*
      reassurance shown at the wallet popup. On mainnet, telling a player to
      ignore a simulation warning is **actively dangerous advice**. Delete it;
      do not soften it.
- [ ] `session.ts:18` — devnet-measured latency comment.

### While you are in there — the outstanding `AF.2(g)` debt

The site currently claims **"mainnet"** and **"VRF"**, both false today. G4
makes the first one true. **The VRF claim does not become true** — the lottery
still uses simple on-chain randomness, which is validator-manipulable. Either
ship VRF or delete the claim; do not let G4 launder it.

- [ ] Audit every "mainnet" / "VRF" / "provably fair" claim against what the
      code actually does, once, at the end.
- [ ] Un-wire or clearly label the lottery buttons that lead nowhere.

**Done when:** `grep -ri "devnet\|faucet\|airdrop\|no monetary value" app/src docs arena/client/src`
returns only deliberate, accurate hits.

---

## Pre-flight sign-off

Do not announce the launch until every line below is true and verified by
someone actually looking, not by someone remembering.

- [ ] A real paid run completed on **mainnet**, in **each** region, with the
      payout confirmed in the wallet (G4.6).
- [ ] A deposit from one region **rejected** by the other two (G1, H1).
- [ ] The authority key is **not** on any game server (G3.3).
- [ ] `/data` backup **restored** into a scratch environment and verified
      (G3.5).
- [ ] The authority balance alert has fired at least once, on purpose (G2.6).
- [ ] The stake ladder's lowest rung is above — or knowingly subsidised
      below — the per-settlement cost (G2.2).
- [ ] No page, doc, meta tag or in-game string mentions devnet, a faucet, or
      an airdrop (G5).
- [ ] No page claims VRF or provably-fair randomness that the code does not
      implement (G5).
- [ ] The kill switch has been exercised in a rehearsal (G3.6).

---

## Open decisions

1. **Settlement topology** — central (one key, exposed `/settlement/*`) vs
    per-region (three keys, no inbound port). Blocks G1.2. See G1.10.
2. **APAC host** — Hetzner has no Asia region. Which provider, and does it
    change the deploy procedure? Blocks G1.9.
3. **Beta tier ladder** — the actual numbers, once G2.1 gives the real cost.
4. **Receipt rent reclaim (G2.7)** — worth re-opening the program before the
    audit, or accept the permanent cost?
5. **Devnet deployment's fate after the switch** (G4.7).
