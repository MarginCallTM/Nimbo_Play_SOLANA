// A4.0 — probe of the PING GATE (server-authoritative RTT refuses
// real-money entry above PING_GATE_MS). Headless, SIWS-only, no money:
// the gate fires in the LOBBY, before any deposit.
//
// Two lobby clients per scenario. Each echoes the server's srvping — but
// one can DELAY its echo to fake a high RTT. After a short settle (the
// server measures RTT at 1Hz), both accept; we then assert who reached
// the deposit window and who was gated.
//
//   S1 gate FIRES : fast + slow(220ms) -> slow gets pingTooHigh,
//                   fast is requeued (matchCancelled, no penalty).
//   S2 gate PASSES: fast + fast        -> both reach depositNow.
//
// Run (server must have the A4.0 gate):  npx tsx src/ping-gate-probe.ts

import { Client, type Room } from "@colyseus/sdk";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    LOBBY_ROOM,
    PING_GATE_MS,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    buildSiwsMessage,
    type AuthChallenge,
    type AuthTokenPayload,
} from "@nimbo/shared";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name: string, ok: boolean) {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

async function makeToken(keys: nacl.SignKeyPair): Promise<string> {
    const challenge: AuthChallenge = await (await fetch(`${SERVER_URL}/auth/challenge`)).json();
    const message = buildSiwsMessage({
        domain: AUTH_DOMAIN,
        address: bs58.encode(keys.publicKey),
        statement: SIWS_STATEMENT,
        nonce: challenge.nonce,
    });
    const bytes = new TextEncoder().encode(message);
    const payload: AuthTokenPayload = {
        pk: bs58.encode(keys.publicKey),
        msg: Buffer.from(bytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(bytes, keys.secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// A lobby client that echoes the server's RTT probe, optionally delayed
// to fake a high ping. Records the FIRST decisive outcome it receives.
async function joinLobby(name: string, srvpongDelayMs: number) {
    const client = new Client(SERVER_URL);
    client.auth.token = await makeToken(nacl.sign.keyPair());
    const room: Room = await client.joinOrCreate(LOBBY_ROOM, { protocol: PROTOCOL_VERSION, name, stake: 0 });
    room.onMessage("*", () => {});
    room.onMessage("srvping", (t: number) => {
        const echo = () => { try { room.send("srvpong", t); } catch { /* gone */ } };
        if (srvpongDelayMs > 0) setTimeout(echo, srvpongDelayMs); else echo();
    });
    const outcome = { type: "" as "" | "depositNow" | "matchCancelled" | "pingTooHigh", requeued: false };
    room.onMessage("depositNow", () => { if (!outcome.type) outcome.type = "depositNow"; });
    room.onMessage("pingTooHigh", () => { if (!outcome.type) outcome.type = "pingTooHigh"; });
    room.onMessage("matchCancelled", (m: { requeued?: boolean }) => {
        if (!outcome.type) { outcome.type = "matchCancelled"; outcome.requeued = m?.requeued === true; }
    });
    room.onMessage("matchFound", () => {});
    return { room, outcome };
}

async function scenario(label: string, slowDelayMs: number) {
    // fast player first (queue head), then the (maybe) slow one.
    const fast = await joinLobby(`${label}-fast`, 0);
    const slow = await joinLobby(`${label}-slow`, slowDelayMs);

    // let the match form AND the server measure RTT (1Hz srvping; the
    // slow echo needs a few cycles to push the smoothed value up).
    await sleep(4000);
    fast.room.send("accept");
    slow.room.send("accept");
    await sleep(1500); // openDeposits + gate resolution

    const result = { fast: fast.outcome, slow: slow.outcome };
    // Fire-and-forget: leave() can hang on a room the server put into a
    // pending match, and an awaited hang kills the run (Node exits 13).
    // Fresh keys each scenario mean stale players never collide.
    void fast.room.leave(true).catch(() => {});
    void slow.room.leave(true).catch(() => {});
    await sleep(1200); // let the leaves land before the next scenario
    return result;
}

// Safety net: a hung room socket must never leave the run stuck forever.
setTimeout(() => { console.log("\n[ping-gate] hard timeout"); process.exit(failures ? 1 : 2); }, 40000);

console.log(`[ping-gate] gate = ${PING_GATE_MS}ms, server ${SERVER_URL}\n`);

// S2 control first (clean queue): both fast -> both pay.
const pass = await scenario("ctrl", 0);
check("S2 both fast -> fast reaches depositNow", pass.fast.type === "depositNow");
check("S2 both fast -> slow(=fast) reaches depositNow", pass.slow.type === "depositNow");

// S1: one slow -> gated out, the other requeued.
const gated = await scenario("gate", 220);
check("S1 slow player -> pingTooHigh (gated before paying)", gated.slow.type === "pingTooHigh");
check("S1 fast partner -> matchCancelled, requeued (no penalty)", gated.fast.type === "matchCancelled" && gated.fast.requeued);

console.log(failures === 0 ? "\nall scenarios behaved" : `\n${failures} FAILING scenario(s)`);
process.exit(failures === 0 ? 0 : 1);
