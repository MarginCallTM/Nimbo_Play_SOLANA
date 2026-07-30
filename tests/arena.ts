import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Arena } from "../target/types/arena";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SendTransactionError,
  SystemProgram,
} from "@solana/web3.js";
import { assert, expect } from "chai";

describe("arena", () => {
  // Provider + program, wired from Anchor.toml (localnet + wallet).
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.arena as Program<Arena>;

  // --- PDA derivation helpers ------------------------------------------
  // Client-side mirror of the on-chain seeds. Little-endian over 8 bytes,
  // exactly like round_id.to_le_bytes() in Rust — anything else derives a
  // different address and every test dies on ConstraintSeeds.

  const pdasFor = (roundId: anchor.BN) => {
    const roundBytes = roundId.toArrayLike(Buffer, "le", 8);
    const [round] = PublicKey.findProgramAddressSync(
      [Buffer.from("round"), roundBytes],
      program.programId
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), roundBytes],
      program.programId
    );
    return { round, vault };
  };

  // Global singleton: no per-round seed, derived once for the whole suite.
  const [reservePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("food_reserve")],
    program.programId
  );

  const receiptPdaFor = (roundId: anchor.BN, nonce: anchor.BN) => {
    const [receipt] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("extract"),
        roundId.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    return receipt;
  };

  // --- Test actors and constants ----------------------------------------

  // The provider wallet plays the round authority (the "game server").
  const authority = provider.wallet;
  // Rake destination: a dedicated keypair so balance deltas stay clean.
  const treasury = Keypair.generate();

  const RAKE_BPS = 550; // 5.5%
  const RESERVE_BPS = 200; // 2%
  const BPS = 10_000;

  // --- Generic helpers ---------------------------------------------------

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const lamportsOf = (pubkey: PublicKey) =>
    provider.connection.getBalance(pubkey);

  // VALIDATOR clock, not wall clock: end_timestamp is compared on-chain
  // against Clock::get(), so building deadlines from Date.now() would make
  // the suite flaky whenever the two clocks drift apart.
  const chainNow = async (): Promise<number> => {
    const slot = await provider.connection.getSlot();
    const t = await provider.connection.getBlockTime(slot);
    if (t === null) throw new Error("validator returned no block time");
    return t;
  };

  // Poll the validator clock until the round's deadline has passed.
  const waitUntilExpired = async (round: PublicKey) => {
    const r = await program.account.round.fetch(round);
    const deadline = r.endTimestamp.toNumber();
    while ((await chainNow()) <= deadline) {
      await sleep(400);
    }
  };

  // Airdrop a fresh, funded player wallet.
  const fundedPlayer = async (sol = 10): Promise<Keypair> => {
    const player = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      player.publicKey,
      sol * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
    return player;
  };

  // Each test gets its own round: no shared state between tests (the
  // reserve singleton is the accepted exception — assert in DELTAS only).
  let nextRoundId = 1;
  const freshRoundId = () => new anchor.BN(nextRoundId++);

  // Create an Open round. Defaults: far-future deadline, standard split.
  const initRound = async (
    opts: { duration?: number; rakeBps?: number; reserveBps?: number } = {}
  ) => {
    const roundId = freshRoundId();
    const { round, vault } = pdasFor(roundId);
    const endTs = new anchor.BN((await chainNow()) + (opts.duration ?? 3600));
    await program.methods
      .initializeRound(
        roundId,
        endTs,
        authority.publicKey,
        treasury.publicKey,
        opts.rakeBps ?? RAKE_BPS,
        opts.reserveBps ?? RESERVE_BPS
      )
      // accountsPartial: since Anchor 0.30 the client auto-resolves PDA
      // accounts from IDL seeds; passing them explicitly (clearer for a
      // test suite) requires this variant of the typed builder.
      .accountsPartial({
        payer: authority.publicKey,
        round,
        vault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { roundId, round, vault, endTs };
  };

  // --- Suite-wide setup --------------------------------------------------

  before(async () => {
    // Rent rule: after any tx, every account must be rent-exempt or empty.
    // A small rake sent to an EMPTY treasury would leave it below the
    // floor (~0.00089 SOL) and fail the whole join — pre-fund it once.
    const sig = await provider.connection.requestAirdrop(
      treasury.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // The FoodReserve is a global singleton: create it once. The guard
    // makes reruns against a persistent validator safe (re-init would
    // fail — that IS the anti-squat design, tested later).
    const existing = await program.account.foodReserve.fetchNullable(
      reservePda
    );
    if (existing === null) {
      await program.methods
        .initializeReserve()
        .accountsPartial({
          payer: authority.publicKey,
          reserve: reservePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  });

  // --- Action helpers ----------------------------------------------------
  // Thin wrappers so each test reads as a scenario, not as account plumbing.

  const join = async (
    round: PublicKey,
    vault: PublicKey,
    player: Keypair,
    stake: number
  ) =>
    program.methods
      .join(new anchor.BN(stake))
      .accountsPartial({
        player: player.publicKey,
        round,
        vault,
        treasury: treasury.publicKey,
        reserve: reservePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();

  const settle = async (
    roundId: anchor.BN,
    round: PublicKey,
    vault: PublicKey,
    player: PublicKey,
    amount: number,
    nonce: number
  ) =>
    program.methods
      .settleExtraction(new anchor.BN(amount), new anchor.BN(nonce))
      .accountsPartial({
        authority: authority.publicKey,
        round,
        vault,
        player,
        receipt: receiptPdaFor(roundId, new anchor.BN(nonce)),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const endRound = async (round: PublicKey, vault: PublicKey) =>
    program.methods
      .endRound()
      .accountsPartial({
        authority: authority.publicKey,
        round,
        vault,
        reserve: reservePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  // Client-side mirror of the on-chain D71 split (integer division
  // truncates, dust lands in spawnValue — same math, same order).
  const expectedSplit = (
    stake: number,
    rakeBps = RAKE_BPS,
    reserveBps = RESERVE_BPS
  ) => {
    const rake = Math.floor((stake * rakeBps) / BPS);
    const reserveShare = Math.floor((stake * reserveBps) / BPS);
    return { rake, reserveShare, spawnValue: stake - rake - reserveShare };
  };

  // Resolve the next occurrence of an event, or fail loudly after 30s
  // (never hang the suite on a silent websocket). CAUTION: anchor shares
  // ONE log subscription across listeners and tears it down when the
  // count hits zero — arm every listener a test needs UP FRONT, or the
  // teardown races the next add and events are silently lost.
  const eventOnce = (name: any): Promise<any> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${name} event within 30s`)),
        30_000
      );
      const id = program.addEventListener(name, (ev) => {
        clearTimeout(timer);
        void program.removeEventListener(id);
        resolve(ev);
      });
    });

  // --- Success path ------------------------------------------------------

  describe("success path", () => {
    it("holds the reserve singleton with the deployer as authority", async () => {
      const reserve = await program.account.foodReserve.fetch(reservePda);
      assert.isTrue(reserve.authority.equals(authority.publicKey));
      // Counters are lifetime values on a shared singleton: never assert
      // absolutes here — deltas are asserted in the tests that move value.
    });

    it("initializes a round with the requested parameters", async () => {
      const { roundId, round, vault, endTs } = await initRound();
      const r = await program.account.round.fetch(round);

      assert.isTrue(r.roundId.eq(roundId));
      assert.isTrue(r.authority.equals(authority.publicKey));
      assert.isTrue(r.treasury.equals(treasury.publicKey));
      assert.strictEqual(r.rakeBps, RAKE_BPS);
      assert.strictEqual(r.reserveBps, RESERVE_BPS);
      assert.isTrue(r.endTimestamp.eq(endTs));
      expect(r.state).to.deep.equal({ open: {} });
      // The four ledger counters start at zero on a fresh round.
      assert.strictEqual(r.totalStaked.toNumber(), 0);
      assert.strictEqual(r.totalDeposited.toNumber(), 0);
      assert.strictEqual(r.totalInjected.toNumber(), 0);
      assert.strictEqual(r.totalPaid.toNumber(), 0);

      // Stored bumps must be the canonical ones the client derives.
      const roundBytes = roundId.toArrayLike(Buffer, "le", 8);
      const [, roundBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("round"), roundBytes],
        program.programId
      );
      const [, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), roundBytes],
        program.programId
      );
      assert.strictEqual(r.bump, roundBump);
      assert.strictEqual(r.vaultBump, vaultBump);
      // The vault does not exist yet: lazily funded by the first join.
      assert.strictEqual(await lamportsOf(vault), 0);
    });

    it("join splits the stake exactly — rake, reserve share, spawn, dust", async () => {
      const { roundId, round, vault } = await initRound();
      const player = await fundedPlayer();
      // NON-divisible stake: forces truncation dust into spawnValue, so
      // this test proves conservation in the worst case, not the easy one.
      const stake = 1_000_000_001;
      const { rake, reserveShare, spawnValue } = expectedSplit(stake);

      const before = {
        vault: await lamportsOf(vault),
        treasury: await lamportsOf(treasury.publicKey),
        reserve: await lamportsOf(reservePda),
      };

      await join(round, vault, player, stake);

      const deltaVault = (await lamportsOf(vault)) - before.vault;
      const deltaTreasury =
        (await lamportsOf(treasury.publicKey)) - before.treasury;
      const deltaReserve = (await lamportsOf(reservePda)) - before.reserve;

      // Each destination got its exact share, at lamport precision...
      assert.strictEqual(deltaVault, spawnValue);
      assert.strictEqual(deltaTreasury, rake);
      assert.strictEqual(deltaReserve, reserveShare);
      // ...and the three shares reassemble the stake: value conservation
      // (D71) — nothing minted, nothing lost, dust included.
      assert.strictEqual(deltaVault + deltaTreasury + deltaReserve, stake);

      // The on-chain ledger recorded the same story.
      const r = await program.account.round.fetch(round);
      assert.strictEqual(r.totalStaked.toNumber(), stake);
      assert.strictEqual(r.totalDeposited.toNumber(), spawnValue);
    });

    it("join accepts a tiny stake whose fee shares truncate to zero", async () => {
      const { round, vault } = await initRound();
      const player = await fundedPlayer();
      // A first join must clear the vault's rent-exempt floor (~0.00089
      // SOL): a 10-lamport deposit into an EMPTY vault would be rejected
      // by the runtime's rent rule, not by our program. Fund it first.
      await join(round, vault, player, 1_000_000_000);

      const before = {
        vault: await lamportsOf(vault),
        treasury: await lamportsOf(treasury.publicKey),
        reserve: await lamportsOf(reservePda),
      };

      // 10 lamports: rake = floor(10 * 550 / 10000) = 0, reserve = 0.
      // The program must skip the empty CPIs, not fail on them.
      await join(round, vault, player, 10);

      assert.strictEqual((await lamportsOf(vault)) - before.vault, 10);
      assert.strictEqual(
        (await lamportsOf(treasury.publicKey)) - before.treasury,
        0
      );
      assert.strictEqual((await lamportsOf(reservePda)) - before.reserve, 0);
    });

    it("inject_reserve moves value from the reserve into the round vault", async () => {
      const { round, vault } = await initRound();
      const player = await fundedPlayer();
      // The join feeds the reserve (2% of the stake) and, crucially,
      // lifts the vault above its rent floor before the injection lands.
      await join(round, vault, player, 2_000_000_000);

      const amount = 10_000;
      const before = {
        vault: await lamportsOf(vault),
        reserve: await lamportsOf(reservePda),
        injectedOut: (
          await program.account.foodReserve.fetch(reservePda)
        ).totalInjectedOut.toNumber(),
      };

      await program.methods
        .injectReserve(new anchor.BN(amount))
        .accountsPartial({
          authority: authority.publicKey,
          reserve: reservePda,
          round,
          vault,
        })
        .rpc();

      assert.strictEqual((await lamportsOf(vault)) - before.vault, amount);
      assert.strictEqual(
        (await lamportsOf(reservePda)) - before.reserve,
        -amount
      );
      const reserve = await program.account.foodReserve.fetch(reservePda);
      assert.strictEqual(
        reserve.totalInjectedOut.toNumber() - before.injectedOut,
        amount
      );
      const r = await program.account.round.fetch(round);
      assert.strictEqual(r.totalInjected.toNumber(), amount);
    });

    it("settle_extraction pays the player and writes the receipt", async () => {
      const { roundId, round, vault } = await initRound();
      const player = await fundedPlayer();
      await join(round, vault, player, 2_000_000_000);

      const amount = 500_000_000;
      const nonce = 1;
      const before = {
        vault: await lamportsOf(vault),
        player: await lamportsOf(player.publicKey),
      };

      await settle(roundId, round, vault, player.publicKey, amount, nonce);

      // The payout moved vault -> player, exactly.
      assert.strictEqual((await lamportsOf(vault)) - before.vault, -amount);
      assert.strictEqual(
        (await lamportsOf(player.publicKey)) - before.player,
        amount
      );

      // The receipt is the anti-replay proof AND the audit trail.
      const receipt = await program.account.extractReceipt.fetch(
        receiptPdaFor(roundId, new anchor.BN(nonce))
      );
      assert.isTrue(receipt.roundId.eq(roundId));
      assert.isTrue(receipt.player.equals(player.publicKey));
      assert.strictEqual(receipt.amount.toNumber(), amount);
      assert.strictEqual(receipt.nonce.toNumber(), nonce);
      assert.isAbove(receipt.settledAt.toNumber(), 0);

      // total_paid is the D55 ledger entry for this payout.
      const r = await program.account.round.fetch(round);
      assert.strictEqual(r.totalPaid.toNumber(), amount);
    });

    it("end_round sweeps the whole vault into the reserve and closes", async () => {
      const { round, vault } = await initRound({ duration: 4 });
      const player = await fundedPlayer();
      await join(round, vault, player, 1_500_000_000);

      await waitUntilExpired(round);

      const before = {
        vault: await lamportsOf(vault),
        reserve: await lamportsOf(reservePda),
        sweptIn: (
          await program.account.foodReserve.fetch(reservePda)
        ).totalSweptIn.toNumber(),
      };

      await endRound(round, vault);

      // The vault is drained to EXACTLY zero (account reaped): the whole
      // balance — orphan SOL, rent floor included — is now reserve money.
      assert.strictEqual(await lamportsOf(vault), 0);
      assert.strictEqual(
        (await lamportsOf(reservePda)) - before.reserve,
        before.vault
      );
      const reserve = await program.account.foodReserve.fetch(reservePda);
      assert.strictEqual(
        reserve.totalSweptIn.toNumber() - before.sweptIn,
        before.vault
      );
      const r = await program.account.round.fetch(round);
      expect(r.state).to.deep.equal({ ended: {} });
    });

    it("emits Joined, Extracted and RoundEnded with faithful payloads", async () => {
      const { roundId, round, vault } = await initRound({ duration: 4 });
      const player = await fundedPlayer();
      const stake = 1_000_000_000;
      const { spawnValue } = expectedSplit(stake);

      // Arm ALL listeners up front: the shared log subscription must stay
      // alive from the first event to the last (see eventOnce caution).
      const pJoined = eventOnce("joined");
      const pExtracted = eventOnce("extracted");
      const pEnded = eventOnce("roundEnded");

      await join(round, vault, player, stake);
      const joined = await pJoined;
      assert.isTrue(joined.roundId.eq(roundId));
      assert.isTrue(joined.player.equals(player.publicKey));
      assert.strictEqual(joined.stake.toNumber(), stake);
      assert.strictEqual(joined.spawnValue.toNumber(), spawnValue);

      await settle(roundId, round, vault, player.publicKey, 300_000_000, 1);
      const extracted = await pExtracted;
      assert.isTrue(extracted.roundId.eq(roundId));
      assert.isTrue(extracted.player.equals(player.publicKey));
      assert.strictEqual(extracted.amount.toNumber(), 300_000_000);
      assert.strictEqual(extracted.nonce.toNumber(), 1);

      await waitUntilExpired(round);
      const vaultBalance = await lamportsOf(vault);
      await endRound(round, vault);
      const roundEnded = await pEnded;
      assert.isTrue(roundEnded.roundId.eq(roundId));
      // The event advertises the exact swept amount: this is what the
      // indexer will trust to rebuild the reserve history.
      assert.strictEqual(roundEnded.swept.toNumber(), vaultBalance);
    });
  });

  // --- Failure paths -----------------------------------------------------
  // One test per lock. Each proves an ATTACK is refused, so every test
  // must fail for the RIGHT reason: always assert the exact error code —
  // a test that passes on the wrong error is a lock left open.

  describe("failure paths", () => {
    // Small helper: run a promise that MUST reject with the given Anchor
    // error code, and fail the test loudly if it succeeds instead.
    const expectAnchorError = async (p: Promise<any>, code: string) => {
      try {
        await p;
        assert.fail(`expected the instruction to throw ${code}`);
      } catch (err) {
        expect(err).to.be.instanceOf(anchor.AnchorError);
        assert.equal(err.error.errorCode.code, code);
      }
    };

    it("rejects a round whose deadline is in the past", async () => {
      const roundId = freshRoundId();
      const { round, vault } = pdasFor(roundId);
      const pastTs = new anchor.BN((await chainNow()) - 10);
      await expectAnchorError(
        program.methods
          .initializeRound(
            roundId,
            pastTs,
            authority.publicKey,
            treasury.publicKey,
            RAKE_BPS,
            RESERVE_BPS
          )
          .accountsPartial({
            payer: authority.publicKey,
            round,
            vault,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidDuration"
      );
    });

    it("rejects a fee split at or above 100%", async () => {
      const roundId = freshRoundId();
      const { round, vault } = pdasFor(roundId);
      const endTs = new anchor.BN((await chainNow()) + 3600);
      // 9800 + 200 = exactly 10_000 bps: the check is STRICT (< not <=),
      // a 100% fee round would be a stake shredder with an empty vault.
      await expectAnchorError(
        program.methods
          .initializeRound(
            roundId,
            endTs,
            authority.publicKey,
            treasury.publicKey,
            9_800,
            200
          )
          .accountsPartial({
            payer: authority.publicKey,
            round,
            vault,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "InvalidSplit"
      );
    });

    it("rejects re-initializing the reserve singleton (anti-squat)", async () => {
      // The singleton was created in before(): a second init must die on
      // "account already in use" — PDA existence is the protection, the
      // same mechanism that makes settlement replays impossible.
      try {
        await program.methods
          .initializeReserve()
          .accountsPartial({
            payer: authority.publicKey,
            reserve: reservePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("expected the re-init to throw");
      } catch (err) {
        expect(err).to.be.instanceOf(SendTransactionError);
      }
    });

    it("rejects a zero-lamport stake", async () => {
      const { round, vault } = await initRound();
      const player = await fundedPlayer(1);
      await expectAnchorError(
        join(round, vault, player, 0),
        "InvalidStake"
      );
    });

    it("rejects joining past the deadline while the round is still Open", async () => {
      // The DOUBLE time lock: state is still Open (end_round not called),
      // but the deadline has passed — a deposit now would be swept by the
      // pending sweep, so join must refuse on the clock alone.
      const { round, vault } = await initRound({ duration: 4 });
      const player = await fundedPlayer(1);
      await waitUntilExpired(round);
      await expectAnchorError(
        join(round, vault, player, 100_000_000),
        "RoundNotOpen"
      );
    });

    it("rejects settling more than the vault holds (insolvency)", async () => {
      const { roundId, round, vault } = await initRound();
      const player = await fundedPlayer();
      await join(round, vault, player, 1_000_000_000);
      // Ask for the FULL balance: the rent floor makes it exceed the
      // available amount. Even the true authority cannot overdraw —
      // this is the guarantee that survives a stolen server key.
      const balance = await lamportsOf(vault);
      await expectAnchorError(
        settle(roundId, round, vault, player.publicKey, balance, 1),
        "InsufficientVault"
      );
    });

    it("rejects a replayed settlement (same round, same nonce)", async () => {
      const { roundId, round, vault } = await initRound();
      const player = await fundedPlayer();
      await join(round, vault, player, 1_000_000_000);
      await settle(roundId, round, vault, player.publicKey, 100_000_000, 7);
      // Same (round_id, nonce), different amount: the receipt PDA already
      // exists, init fails — the runtime itself refuses the replay.
      try {
        await settle(roundId, round, vault, player.publicKey, 50_000_000, 7);
        assert.fail("expected the replay to throw");
      } catch (err) {
        expect(err).to.be.instanceOf(SendTransactionError);
      }
    });

    it("rejects a settlement signed by a non-authority", async () => {
      const { roundId, round, vault } = await initRound();
      const player = await fundedPlayer();
      await join(round, vault, player, 1_000_000_000);
      // Mallory signs a payout to himself: has_one = authority on the
      // round must kill it — no signature, no settlement, Model A.
      const mallory = await fundedPlayer(1);
      await expectAnchorError(
        program.methods
          .settleExtraction(new anchor.BN(100_000_000), new anchor.BN(1))
          .accountsPartial({
            authority: mallory.publicKey,
            round,
            vault,
            player: mallory.publicKey,
            receipt: receiptPdaFor(roundId, new anchor.BN(1)),
            systemProgram: SystemProgram.programId,
          })
          .signers([mallory])
          .rpc(),
        "Unauthorized"
      );
    });

    it("rejects end_round before the deadline", async () => {
      const { round, vault } = await initRound();
      await expectAnchorError(endRound(round, vault), "RoundNotEnded");
    });

    it("rejects end_round by a non-authority", async () => {
      const { round, vault } = await initRound({ duration: 4 });
      const player = await fundedPlayer(1);
      await join(round, vault, player, 500_000_000);
      await waitUntilExpired(round);
      const mallory = await fundedPlayer(1);
      await expectAnchorError(
        program.methods
          .endRound()
          .accountsPartial({
            authority: mallory.publicKey,
            round,
            vault,
            reserve: reservePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([mallory])
          .rpc(),
        "Unauthorized"
      );
    });

    it("closes every door at once: no join, settle or re-end after end_round", async () => {
      const { roundId, round, vault } = await initRound({ duration: 4 });
      const player = await fundedPlayer();
      await join(round, vault, player, 1_000_000_000);
      await waitUntilExpired(round);
      await endRound(round, vault);

      // One state flip, three doors: everything answers RoundNotOpen.
      await expectAnchorError(
        join(round, vault, player, 100_000_000),
        "RoundNotOpen"
      );
      await expectAnchorError(
        settle(roundId, round, vault, player.publicKey, 1_000, 99),
        "RoundNotOpen"
      );
      await expectAnchorError(endRound(round, vault), "RoundNotOpen");
    });

    it("rejects injecting more than the available reserve", async () => {
      const { round, vault } = await initRound();
      const player = await fundedPlayer();
      // Lift the vault above its rent floor so the failure can only come
      // from the reserve guard, not from the vault's own rent rule.
      await join(round, vault, player, 1_000_000_000);
      const reserveBalance = await lamportsOf(reservePda);
      // The full balance exceeds available (rent floor must stay), and
      // the reserve data account must survive: InsufficientReserve.
      await expectAnchorError(
        program.methods
          .injectReserve(new anchor.BN(reserveBalance))
          .accountsPartial({
            authority: authority.publicKey,
            reserve: reservePda,
            round,
            vault,
          })
          .rpc(),
        "InsufficientReserve"
      );
    });

    it("rejects inject_reserve by a non-authority", async () => {
      const { round, vault } = await initRound();
      const player = await fundedPlayer();
      await join(round, vault, player, 1_000_000_000);
      const mallory = await fundedPlayer(1);
      await expectAnchorError(
        program.methods
          .injectReserve(new anchor.BN(1_000))
          .accountsPartial({
            authority: mallory.publicKey,
            reserve: reservePda,
            round,
            vault,
          })
          .signers([mallory])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  // --- Solvency invariant (D55) ------------------------------------------
  // The whole point of the escrow: run a full round with every flow at
  // once — variable buy-ins (dust included), an injection, several
  // settlements, the final sweep — then account for EVERY lamport.

  describe("solvency invariant (D55)", () => {
    it("a full round conserves value lamport by lamport", async () => {
      // Fund the players BEFORE opening the round: airdrops are slow and
      // joins must beat the deadline (settle and inject do not need to —
      // they only require the state to still be Open).
      const p1 = await fundedPlayer();
      const p2 = await fundedPlayer();
      const p3 = await fundedPlayer();
      const { roundId, round, vault } = await initRound({ duration: 10 });

      // Varied, non-divisible stakes: the dust from every split must be
      // conserved too, or the final equation will be off by a few lamports.
      const stakes = [2_000_000_001, 1_500_000_000, 3_333_333_337];
      const totalStaked = stakes.reduce((a, b) => a + b, 0);
      const splits = stakes.map((s) => expectedSplit(s));
      const totalRake = splits.reduce((a, s) => a + s.rake, 0);
      const totalShare = splits.reduce((a, s) => a + s.reserveShare, 0);
      const totalSpawn = splits.reduce((a, s) => a + s.spawnValue, 0);

      const injected = 50_000;
      const payouts: [Keypair, number][] = [
        [p1, 1_000_000_000],
        [p2, 2_500_000_000],
      ];
      const totalPaid = payouts.reduce((a, [, amt]) => a + amt, 0);

      // External snapshot BEFORE any flow: the conservation equation is
      // asserted on real balances, not on what the program claims.
      const before = {
        treasury: await lamportsOf(treasury.publicKey),
        reserve: await lamportsOf(reservePda),
      };

      // The round lives: three buy-ins, one injection, two extractions.
      await join(round, vault, p1, stakes[0]);
      await join(round, vault, p2, stakes[1]);
      await join(round, vault, p3, stakes[2]);
      await program.methods
        .injectReserve(new anchor.BN(injected))
        .accountsPartial({
          authority: authority.publicKey,
          reserve: reservePda,
          round,
          vault,
        })
        .rpc();
      let nonce = 1;
      for (const [player, amount] of payouts) {
        await settle(roundId, round, vault, player.publicKey, amount, nonce++);
      }

      // p3 never extracted: his value is the orphan SOL of this round.
      await waitUntilExpired(round);
      const sweptExpected = totalSpawn + injected - totalPaid;
      await endRound(round, vault);

      // 1) The on-chain ledger recorded the exact story...
      const r = await program.account.round.fetch(round);
      assert.strictEqual(r.totalStaked.toNumber(), totalStaked);
      assert.strictEqual(r.totalDeposited.toNumber(), totalSpawn);
      assert.strictEqual(r.totalInjected.toNumber(), injected);
      assert.strictEqual(r.totalPaid.toNumber(), totalPaid);

      // 2) ...the D55 invariant holds on the counters...
      assert.isAtMost(
        r.totalPaid.toNumber(),
        r.totalDeposited.toNumber() + r.totalInjected.toNumber()
      );

      // 3) ...and the REAL balances close the loop. Vault at zero, and:
      //    treasury took the rakes, the reserve took the shares plus the
      //    sweep minus its injection, players took the payouts.
      assert.strictEqual(await lamportsOf(vault), 0);
      assert.strictEqual(
        (await lamportsOf(treasury.publicKey)) - before.treasury,
        totalRake
      );
      assert.strictEqual(
        (await lamportsOf(reservePda)) - before.reserve,
        totalShare - injected + sweptExpected
      );

      // 4) The punchline — every staked lamport ended in exactly one of
      //    three pockets: the house, the reserve, or a player's wallet.
      //    No value minted, no value lost: strict conservation (D71/D55).
      const deltaTreasury =
        (await lamportsOf(treasury.publicKey)) - before.treasury;
      const deltaReserve = (await lamportsOf(reservePda)) - before.reserve;
      assert.strictEqual(
        deltaTreasury + deltaReserve + totalPaid,
        totalStaked
      );
    });
  });
});
