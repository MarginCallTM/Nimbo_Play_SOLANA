// A4.6 — adversarial probe of the MONEY PATH (the deposit-door and
// lobby counterpart of auth-attack.ts). A lock is only proven by trying
// it: the SIWS door has auth-attack.ts (7/7), but every check that stands
// between a real deposit and a spawn — replay, cross-room reuse, the
// wallet binding, the entry floor, the amount read from the tx bytes —
// had NO proof by measurement. This file is that proof.
//
// Unlike sparring.ts (which plays the game with money), this file only
// RINGS the door: each scenario is an attack the escrow must refuse, and
// the honest deposit is the control proving the door still opens for a
// legitimate player. It costs real (devnet) SOL — that is the point: a
// funded fleet is what makes the money-path attacks reachable at all.
//
// Two execution contexts, because the attacks live in two places:
//   PART A — the DEPOSIT DOOR. Needs a live round (server started with
//     ROUND_ID) and a funded fleet (MONEY_WALLETS=<dir>, from fleet.ts).
//     Skipped loudly, not faked, when either is missing.
//   PART B — the LOBBY (D81 desertion cooldown). SIWS only, no money,
//     no round — always runs.
//
// Two of the TODO's six money attacks are NOT reachable from here, and
// are documented rather than faked (honesty over a green line):
//   - "deposit to a different round" needs a SECOND initialized round
//     PDA; a join tx to a non-existent round never confirms, so there is
//     no signature to present. Give one via OTHER_ROUND_TXSIG to test it.
//   - "refund claimed twice" is guarded at the SETTLEMENT + on-chain
//     layer (the ExtractReceipt PDA is single-init; the outbox is
//     idempotent by nonce), not at the join door — it belongs to a
//     settlement-level test, and the on-chain PDA is its own proof.
//
// Usage (from arena/):
//   npm run money-attack                    PART B only (lobby, free)
//   MONEY_WALLETS=wallets npm run money-attack   PART A + B (needs ROUND_ID)

import { Client, type Room } from "@colyseus/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    ARENA_ROOM,
    LOBBY_ROOM,
    MIN_STAKE_LAMPORTS,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    buildJoinInstruction,
    buildSiwsMessage,
    scoreFromLamports,
    type AuthChallenge,
    type AuthTokenPayload,
    type RoundInfoResponse,
} from "@nimbo/shared";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WALLETS_DIR = process.env.MONEY_WALLETS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let skipped = 0;
function check(name: string, ok: boolean) {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
function skip(name: string, why: string) {
    skipped += 1;
    console.log(`SKIP  ${name} — ${why}`);
}

// --- SIWS, headless (same canonical message the browser signs) --------
async function freshNonce(): Promise<string> {
    const res = await fetch(`${SERVER_URL}/auth/challenge`);
    if (!res.ok) throw new Error(`auth challenge failed (${res.status})`);
    const challenge: AuthChallenge = await res.json();
    return challenge.nonce;
}

async function makeToken(addressB58: string, secretKey: Uint8Array): Promise<string> {
    const message = buildSiwsMessage({
        domain: AUTH_DOMAIN,
        address: addressB58,
        statement: SIWS_STATEMENT,
        nonce: await freshNonce(),
    });
    const bytes = new TextEncoder().encode(message);
    const payload: AuthTokenPayload = {
        pk: addressB58,
        msg: Buffer.from(bytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(bytes, secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// Attempt an arena join with a given SIWS token + join options; resolve
// with the outcome (never throw) so the scenario table reads as
// assertions. On success, returns the room so the caller can inspect the
// seated score and leave cleanly.
type JoinOutcome =
    | { result: "accepted"; room: Room }
    | { result: "rejected" };
async function tryArenaJoin(
    token: string,
    options: Record<string, unknown>,
    fresh = false, // create() forces a NEW room instance (isolation / two-rooms)
): Promise<JoinOutcome> {
    const client = new Client(SERVER_URL);
    client.auth.token = token;
    const opts = { protocol: PROTOCOL_VERSION, ...options };
    try {
        const room = fresh
            ? await client.create(ARENA_ROOM, opts)
            : await client.joinOrCreate(ARENA_ROOM, opts);
        room.onMessage("*", () => {}); // silence unhandled-type warnings
        return { result: "accepted", room };
    } catch {
        return { result: "rejected" };
    }
}

const seatedScore = (room: Room) =>
    (room.state as { players: Map<string, { score: number }> })
        .players.get(room.sessionId)?.score ?? 0;

// ======================================================================
// PART A — THE DEPOSIT DOOR (needs a funded fleet + a live round)
// ======================================================================
async function depositDoor() {
    if (!WALLETS_DIR) {
        skip("PART A (deposit door)", "set MONEY_WALLETS=<dir> (a funded fleet, see fleet.ts)");
        return;
    }

    const chain = new Connection(RPC_URL, "confirmed");

    // The round the server escrows against. Free-only mode = nothing to
    // attack here; that is a skip, not a failure.
    const roundRes = await fetch(`${SERVER_URL}/round`);
    if (!roundRes.ok) {
        skip("PART A (deposit door)", "server in free-only mode (start it with ROUND_ID)");
        return;
    }
    const round: RoundInfoResponse = await roundRes.json();
    console.log(`\n[money] PART A — deposit door, round ${round.roundId}`);

    const loadWallet = (idx: number): Keypair => {
        const file = path.join(WALLETS_DIR, `bot-${String(idx + 1).padStart(2, "0")}.json`);
        if (!fs.existsSync(file)) {
            console.error(`missing wallet ${file} — create the fleet first:  npm run fleet ${idx + 1}`);
            process.exit(1);
        }
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
    };

    // Build + send a real join deposit; return the confirmed signature.
    // Nothing here is trusted by the server — it re-reads the exact
    // lamports from the confirmed tx.
    const deposit = async (keys: Keypair, stakeSol: number): Promise<string> => {
        const tx = new Transaction().add(
            buildJoinInstruction({
                player: keys.publicKey,
                roundId: BigInt(round.roundId),
                treasury: new PublicKey(round.treasury),
                stakeLamports: BigInt(Math.round(stakeSol * LAMPORTS_PER_SOL)),
            }),
        );
        return sendAndConfirmTransaction(chain, tx, [keys], { commitment: "confirmed" });
    };

    const alice = loadWallet(0); // primary attacker/depositor
    const bob = loadWallet(1);   // second identity (wallet-binding test)
    const aliceTok = () => makeToken(alice.publicKey.toBase58(), alice.secretKey);
    const bobTok = () => makeToken(bob.publicKey.toBase58(), bob.secretKey);

    // Guard: both wallets must be funded enough for the deposits below
    // (~0.3 SOL of headroom covers every scenario's stake + fees).
    for (const [name, kp] of [["bot-01", alice], ["bot-02", bob]] as const) {
        const bal = await chain.getBalance(kp.publicKey);
        if (bal < 0.3 * LAMPORTS_PER_SOL) {
            skip("PART A (deposit door)", `${name} underfunded (◎${(bal / LAMPORTS_PER_SOL).toFixed(3)}) — npm run fleet`);
            return;
        }
    }

    // --- A0 control + amount binding + A1 replay + A2 two rooms --------
    // One honest deposit funds four assertions. It is ALSO the
    // "deposit < announced" attack: alice deposits 0.1 but ANNOUNCES 1.0
    // in options.stake. The door must open (control) AND seat her at the
    // 0.1 snake, because the amount is read from the TX BYTES, never from
    // what the client claimed. Then the SAME signature must be refused
    // everywhere after.
    const deposited = 0.1;
    const announced = 1.0; // the lie: 10x what actually moved
    const sig = await deposit(alice, deposited);
    console.log(`[money] alice deposited ◎${deposited}, will announce ◎${announced} (${sig.slice(0, 8)}…)`);

    const first = await tryArenaJoin(await aliceTok(), { name: "atk", stake: announced, txSig: sig }, true);
    check("A0 honest deposit -> arena join accepted (control)", first.result === "accepted");

    if (first.result === "accepted") {
        await sleep(600); // let the initial state sync land
        const score = seatedScore(first.room);
        // The 0.1 spawn is ~1/10th of the announced 1.0 spawn: anything
        // under a 0.3-SOL score proves the lie was ignored, with room to
        // spare on both sides of the rake/pellet split.
        const ceiling = scoreFromLamports(BigInt(Math.round(0.3 * LAMPORTS_PER_SOL)));
        check(
            "A0b seated score matches the DEPOSIT, not options.stake",
            score > 0 && score < ceiling,
        );
    }

    const secondRoom = await tryArenaJoin(await aliceTok(), { name: "atk", stake: deposited, txSig: sig }, true);
    check("A2 same txSig, a SECOND room -> rejected (consumed set is process-wide)", secondRoom.result === "rejected");

    const replay = await tryArenaJoin(await aliceTok(), { name: "atk", stake: deposited, txSig: sig }, false);
    check("A1 same txSig replayed -> rejected", replay.result === "rejected");

    if (first.result === "accepted") await first.room.leave();

    // --- A3 wallet binding: alice pays, bob presents her signature -----
    // The tx signature is public; the ONLY thing tying a deposit to a
    // player is SIWS + the on-chain depositor field. A small sacrificial
    // stake — the wallet check fires before the amount is even read, so
    // the deposit is burned to the vault (sweepable, D50), not refunded.
    const sacrificial = 0.02;
    const aliceSig = await deposit(alice, sacrificial);
    console.log(`[money] alice deposited ◎${sacrificial} (${aliceSig.slice(0, 8)}…) — bob will try to steal it`);
    const stolen = await tryArenaJoin(await bobTok(), { name: "thief", stake: sacrificial, txSig: aliceSig }, true);
    check("A3 wallet B presents wallet A's deposit -> rejected (SIWS binding)", stolen.result === "rejected");

    // --- A4 under-floor deposit -> rejected AND refunded ---------------
    // A stake below MIN_STAKE_LAMPORTS is a real payment we refuse to
    // seat (score 0 = the smallest, fastest-turning kamikaze). It must
    // be rejected at the door AND queued for refund on the D80 rails.
    const underFloor = 0.05; // < 0.1 floor, > 0.002 refund threshold
    const floorSig = await deposit(alice, underFloor);
    console.log(`[money] alice deposited ◎${underFloor} (${floorSig.slice(0, 8)}…) — below the ◎${Number(MIN_STAKE_LAMPORTS) / LAMPORTS_PER_SOL} floor`);
    const floor = await tryArenaJoin(await aliceTok(), { name: "dust", stake: underFloor, txSig: floorSig }, true);
    check("A4 under-floor deposit -> rejected", floor.result === "rejected");
    console.log("      (refund of the under-floor stake is server-side — verify a claim appears in the outbox)");

    // --- A5 malformed signature -> rejected, never touches the log -----
    // A non-base58 / wrong-length txSig is a probe. It must be refused on
    // shape ALONE, before any RPC call or any write to consumed-deposits.
    const malformed = await tryArenaJoin(await aliceTok(), { name: "probe", stake: 0.1, txSig: "not-a-real-signature" }, true);
    check("A5 malformed txSig -> rejected (shape check, no RPC, no log write)", malformed.result === "rejected");

    // --- documented gap: deposit to a different round -----------------
    const otherSig = process.env.OTHER_ROUND_TXSIG;
    if (otherSig) {
        const wrongRound = await tryArenaJoin(await aliceTok(), { name: "xround", stake: 0.1, txSig: otherSig }, true);
        check("A6 deposit into a DIFFERENT round -> rejected", wrongRound.result === "rejected");
    } else {
        skip("A6 deposit into a different round", "needs a 2nd round's txSig via OTHER_ROUND_TXSIG");
    }
}

// ======================================================================
// PART B — LOBBY DESERTION COOLDOWN (D81, SIWS only, no money)
// ======================================================================
// The rake-pump attack the cooldown closes: queue -> match -> accept ->
// never deposit -> requeue, forever, free. We drive it with ONE griefer
// wallet against a persistent victim. The desertion move is a CLIENT-
// initiated leave() while matched — onLeave -> resolve() marks the
// leaver the deserter (same strike as a decline), but consented, so the
// SDK does not treat it as a dropped connection and try to reconnect
// (which a server-initiated decline close does).
//
// The ladder (lobby-conduct COOLDOWN_MS = [0, 0, 60s, 5m, 15m], indexed
// by strike count after increment): strike 1 -> 0, strike 2 -> 60s. So
// ONLY the first desertion is free (a dropped connection is indistin-
// guishable from malice at n=1). The griefer therefore gets TWO clean
// queue entries — join, desert (free); join, desert (this one arms the
// 60s cooldown) — and its THIRD queue attempt must be refused.
async function lobbyDesertion() {
    console.log("\n[money] PART B — lobby desertion cooldown (D81)");

    const griefer = nacl.sign.keyPair();
    const grieferAddr = bs58.encode(griefer.publicKey);

    const joinLobby = async (name: string, kp: nacl.SignKeyPair): Promise<Room> => {
        const client = new Client(SERVER_URL);
        client.auth.token = await makeToken(bs58.encode(kp.publicKey), kp.secretKey);
        const room = await client.joinOrCreate(LOBBY_ROOM, { protocol: PROTOCOL_VERSION, name, stake: 0 });
        room.onMessage("*", () => {});
        return room;
    };

    const waitMatch = (room: Room, timeoutMs: number): Promise<void> =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("no matchFound")), timeoutMs);
            room.onMessage("matchFound", () => { clearTimeout(timer); resolve(); });
        });

    // The victim stays connected across cycles: as the innocent of each
    // dissolved match it is requeued at the head, ready to pair again.
    const victim = await joinLobby("victim", nacl.sign.keyPair());

    // Two deliberate desertions by the same wallet: #1 is free, #2 arms
    // the 60s cooldown.
    for (let strike = 1; strike <= 2; strike += 1) {
        let grieferRoom: Room;
        try {
            grieferRoom = await joinLobby("griefer", griefer);
        } catch (err) {
            check(`B desertion #${strike} -> queue still open (only #1 is free)`, false);
            console.log(`      (unexpected early cooldown: ${(err as Error).message})`);
            return;
        }
        check(`B desertion #${strike} -> queue still open`, true);

        await waitMatch(grieferRoom, 6000).catch(() => {});
        await waitMatch(victim, 6000).catch(() => {});
        // The desertion: a consented leave while matched. onLeave ->
        // resolve() pins the strike on the leaver; no server-initiated
        // close, so no SDK reconnect storm.
        await grieferRoom.leave(true).catch(() => {});
        await sleep(1000); // let the dissolution + strike + requeue land
    }

    // Third attempt: desertion #2 armed a cooldown, the door must refuse.
    let refused = false;
    let message = "";
    try {
        const blocked = await joinLobby("griefer", griefer);
        await blocked.leave().catch(() => {});
    } catch (err) {
        refused = true;
        message = (err as Error).message;
    }
    check("B 2 desertions -> 3rd queue attempt refused (cooldown armed)", refused);
    check("B refusal explains itself (D78: police abuse, tell the honest player)", /queue reopens in \d+s/.test(message));

    await victim.leave().catch(() => {});
    console.log(`      (griefer ${grieferAddr.slice(0, 4)}.. is now cooling down)`);
}

// ----------------------------------------------------------------------
await depositDoor();
await lobbyDesertion();

console.log(
    `\n${failures === 0 ? "all scenarios behaved" : `${failures} FAILING scenario(s)`}` +
    `${skipped ? ` (${skipped} skipped)` : ""}`,
);
process.exit(failures === 0 ? 0 : 1);
