// A4.2a — probe of the free matchmaking lobby (D77/D81), happy path
// AND desertions. Proves headless everything that needs no SOL:
//   queue position -> pairing -> free ACCEPT -> deposit window ->
//   no-deposit ghosts dropped; decline -> innocent requeued at HEAD;
//   one lobby seat per wallet.
// NOT provable here: the fulfilled path (verified deposit spawning in
// the arena) — a headless wallet has nothing to deposit. That is the
// browser E2E of morceau 3.
//
// Usage: npx tsx src/lobby-probe.ts   (server must be running)
// NB: the no-deposit scenario waits out the real 30s window.

import { Client, type Room } from "@colyseus/sdk";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    LOBBY_DEPOSIT_SECONDS,
    LOBBY_ROOM,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    buildSiwsMessage,
    type AuthChallenge,
    type AuthTokenPayload,
    type MatchCancelledMessage,
} from "@nimbo/shared";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";

async function freshNonce(): Promise<string> {
    const res = await fetch(`${SERVER_URL}/auth/challenge`);
    const challenge: AuthChallenge = await res.json();
    return challenge.nonce;
}

// Honest token only — the hostile forgeries live in auth-attack.ts.
// Accepts a keypair so the same wallet can try to take two seats.
async function makeToken(keys: nacl.SignKeyPair): Promise<string> {
    const address = bs58.encode(keys.publicKey);
    const message = buildSiwsMessage({
        domain: AUTH_DOMAIN,
        address,
        statement: SIWS_STATEMENT,
        nonce: await freshNonce(),
    });
    const messageBytes = new TextEncoder().encode(message);
    const payload: AuthTokenPayload = {
        pk: address,
        msg: Buffer.from(messageBytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(messageBytes, keys.secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function joinLobby(name: string, keys = nacl.sign.keyPair()): Promise<Room> {
    const client = new Client(SERVER_URL);
    client.auth.token = await makeToken(keys);
    const room = await client.joinOrCreate(LOBBY_ROOM, {
        protocol: PROTOCOL_VERSION,
        name,
        stake: 0,
    });
    room.onMessage("*", () => {}); // silence unhandled-type warnings
    return room;
}

// Arm BEFORE triggering the behavior under test, await after — a
// handler registered too late proves nothing.
function waitMessage<T>(room: Room, type: string, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`timeout waiting for "${type}"`)),
            timeoutMs,
        );
        room.onMessage(type, (payload: T) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const positionOf = (room: Room) =>
    (room.state as any).players.get(room.sessionId)?.position;

let failures = 0;
function check(name: string, ok: boolean) {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

// --- S1: alone in line = position 1, no match ------------------------
const alice = await joinLobby("alice");
await sleep(1500); // > one lobby tick
check("alone in queue -> position 1", positionOf(alice) === 1);

// --- S2: second player -> pairing (both notified) --------------------
const aliceFound = waitMessage(alice, "matchFound", 5000);
const bob = await joinLobby("bob");
const bobFound = waitMessage(bob, "matchFound", 5000);
await Promise.all([aliceFound, bobFound]);
check("two in queue -> matchFound to both", true);

// --- S3: both accept (free) -> deposit window opens ------------------
const aliceDeposit = waitMessage(alice, "depositNow", 5000);
const bobDeposit = waitMessage(bob, "depositNow", 5000);
alice.send("accept");
bob.send("accept");
await Promise.all([aliceDeposit, bobDeposit]);
check("both accepted -> depositNow to both", true);

// --- S4: nobody deposits -> both are ghosts, both dropped ------------
console.log(`      (waiting out the real ${LOBBY_DEPOSIT_SECONDS}s deposit window…)`);
const cancels = await Promise.all([
    waitMessage<MatchCancelledMessage>(alice, "matchCancelled", (LOBBY_DEPOSIT_SECONDS + 5) * 1000),
    waitMessage<MatchCancelledMessage>(bob, "matchCancelled", (LOBBY_DEPOSIT_SECONDS + 5) * 1000),
]);
check(
    "deposit window expired -> both dropped (requeued=false)",
    cancels.every((c) => c.requeued === false),
);
await sleep(1000); // let the server-side leave() land

// --- S5: decline -> innocent back at the HEAD, deserter dropped ------
const carolKeys = nacl.sign.keyPair();
const carol = await joinLobby("carol", carolKeys);
const carolFound = waitMessage(carol, "matchFound", 5000);
const dave = await joinLobby("dave");
const daveFound = waitMessage(dave, "matchFound", 5000);
await Promise.all([carolFound, daveFound]);

const carolCancel = waitMessage<MatchCancelledMessage>(carol, "matchCancelled", 5000);
const daveCancel = waitMessage<MatchCancelledMessage>(dave, "matchCancelled", 5000);
carol.send("accept"); // the innocent even accepted already
dave.send("decline");
const [cc, dc] = await Promise.all([carolCancel, daveCancel]);
check("decline -> innocent requeued (requeued=true)", cc.requeued === true);
check("decline -> deserter dropped (requeued=false)", dc.requeued === false);
await sleep(1500);
check("innocent is back at position 1", positionOf(carol) === 1);

// --- S6: one lobby seat per wallet -----------------------------------
try {
    await joinLobby("carol-again", carolKeys); // same wallet, second tab
    check("same wallet twice -> rejected", false);
} catch {
    check("same wallet twice -> rejected", true);
}

await carol.leave();
console.log(failures === 0 ? "\nall scenarios behaved" : `\n${failures} FAILING scenario(s)`);
process.exit(failures === 0 ? 0 : 1);
