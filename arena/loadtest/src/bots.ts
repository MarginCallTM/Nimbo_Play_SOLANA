// A1.10 — headless load-test clients.
//
// Each bot speaks the EXACT same protocol as the browser client
// (join options, "input" intents at 20Hz, nothing else) but has no
// canvas, no prediction, no interpolation: rendering concerns are
// client-side luxuries the server never sees. If the room cannot
// tell a bot from a human, the authoritative boundary is airtight.
//
// This is also, deliberately, the SKELETON of the A4.6 red-team bot:
// replace the naive steering below with optimal play and you get the
// adversary the economy must survive.
//
// Usage: npm run bots [count]   (default 10, server must be running)

import { Client, Callbacks } from "@colyseus/sdk";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
    ARENA_ROOM,
    BOOST_ORB_VALUE,
    FOOD_EAT_RANGE,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    SNAKE_BOOST_SPEED,
    SNAKE_SPEED,
    WORLD_RADIUS,
    buildSiwsMessage,
    describeSnakeFromScore,
    type AuthChallenge,
    type AuthTokenPayload,
    type InputMessage,
    type JoinOptions,
} from "@nimbo/shared";

const BOT_COUNT = Number(process.argv[2] ?? 10);
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";

interface NetPlayer { x: number; y: number; angle: number; score: number }
interface NetFood { x: number; y: number; value: number }

// Turning-radius geometry: a snake moving at v px/frame that turns at
// most w rad/frame sweeps a circle of radius v/w (~50px at base size).
// Any point INSIDE one of its two current turning circles (one on
// each side of the head) can never be reached by steering alone — the
// snake orbits it forever. That was the naive bot's death spiral:
// "nearest pellet" is exactly the one that just slipped inside.
function isReachable(me: NetPlayer, f: NetFood, turnRadius: number, eatReach: number): boolean {
    const lx = me.x - Math.sin(me.angle) * turnRadius; // left circle center
    const ly = me.y + Math.cos(me.angle) * turnRadius;
    const rx = me.x + Math.sin(me.angle) * turnRadius; // right circle center
    const ry = me.y - Math.cos(me.angle) * turnRadius;
    const margin = turnRadius - eatReach; // deep enough that the mouth can't graze it
    return Math.hypot(f.x - lx, f.y - ly) > margin
        && Math.hypot(f.x - rx, f.y - ry) > margin;
}

// A3.1 — bots authenticate like everyone else, minus the wallet UI:
// an ephemeral ed25519 keypair (tweetnacl = the same curve as a Solana
// wallet), the canonical SIWS message built by hand from a real server
// challenge, a detached signature. If a headless client can pass the
// door with 15 lines of crypto, the door demands exactly what it
// should: key ownership — nothing about being a browser. (Red-team
// note for A4.6: this also means keys are FREE — SIWS identifies, it
// does not anti-Sybil. That was never its job; see A4.4.)
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";

async function makeAuthToken(): Promise<string> {
    const keys = nacl.sign.keyPair();
    const address = bs58.encode(keys.publicKey);
    const res = await fetch(`${SERVER_URL}/auth/challenge`);
    if (!res.ok) throw new Error(`auth challenge failed (${res.status})`);
    const challenge: AuthChallenge = await res.json();
    const message = buildSiwsMessage({
        domain: AUTH_DOMAIN,
        address,
        statement: SIWS_STATEMENT,
        nonce: challenge.nonce,
        issuedAt: new Date().toISOString(),
    });
    const messageBytes = new TextEncoder().encode(message);
    const payload: AuthTokenPayload = {
        pk: address,
        msg: Buffer.from(messageBytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(messageBytes, keys.secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function spawnBot(n: number) {
    const client = new Client(SERVER_URL);
    client.auth.token = await makeAuthToken();
    const options: JoinOptions = { protocol: PROTOCOL_VERSION, name: `bot-${n}`, stake: 0 };
    const room = await client.joinOrCreate(ARENA_ROOM, options);

    // Live schema references: Colyseus mutates them in place on every
    // patch, so holding them once keeps them fresh (same trick as the
    // browser client).
    let me: NetPlayer | undefined;
    const foods = new Map<string, NetFood>();
    const others = new Map<string, NetPlayer>();
    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", (p, id) => {
        if (String(id) === room.sessionId) me = p as NetPlayer;
        else others.set(String(id), p as NetPlayer);
    });
    callbacks.onRemove("players", (_p, id) => others.delete(String(id)));
    callbacks.onAdd("food", (f, id) => foods.set(String(id), f as NetFood));
    callbacks.onRemove("food", (_f, id) => foods.delete(String(id)));

    const input: InputMessage = { angle: Math.random() * 2 * Math.PI, boost: false };
    // Target COMMITMENT: chase one pellet until it is gone (eaten,
    // possibly by someone else) or falls out of reach. Re-picking
    // "the nearest" every tick flip-flops between equidistant pellets
    // and orbits the midpoint — the other half of the ball-of-bots bug.
    let targetId: string | undefined;

    // Same cadence as the browser client: intent at 20Hz, never more.
    const loop = setInterval(() => {
        if (!me) return;

        const dims = describeSnakeFromScore(me.score);
        // boosting DOUBLES the turning radius — judging reachability
        // with the walking radius while sprinting is how you orbit
        const speed = input.boost ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
        const turnRadius = speed / dims.turnSpeed;
        const eatReach = dims.radius + FOOD_EAT_RANGE;

        // threat scan: nearest OTHER head. Honest limitation: bodies
        // are never synced (A1.4), so a bot can only fear heads — it
        // will still die on unseen bodies. Good enough to break the
        // death-ball; real perception is A4.6 work.
        let threat: NetPlayer | undefined;
        let threatD = Infinity;
        for (const p of others.values()) {
            const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
            if (d < threatD) { threatD = d; threat = p; }
        }

        const distFromCenter = Math.hypot(me.x, me.y);
        if (distFromCenter > WORLD_RADIUS * 0.8) {
            // survival first: the border kills
            input.angle = Math.atan2(-me.y, -me.x);
            targetId = undefined;
        } else if (threat && threatD < (turnRadius * 3) ** 2) {
            // flee second: another head closing in — its body trails
            // right behind it, this whole area is lethal
            input.angle = Math.atan2(me.y - threat.y, me.x - threat.x);
            targetId = undefined;
        } else {
            // greed second: chase a pellet from our AoI bubble (bots
            // only ever SEE nearby food — A1.8 applies to them too)
            let target = targetId ? foods.get(targetId) : undefined;
            if (target && !isReachable(me, target, turnRadius, eatReach)) target = undefined;
            if (!target) {
                targetId = undefined;
                let bestD = Infinity;
                for (const [id, f] of foods) {
                    if (!isReachable(me, f, turnRadius, eatReach)) continue;
                    const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
                    if (d < bestD) { bestD = d; target = f; targetId = id; }
                }
            }
            if (target) {
                input.angle = Math.atan2(target.y - me.y, target.x - me.x);
            } else if (Math.random() < 0.05) {
                // wander: occasional random heading change
                input.angle = Math.random() * 2 * Math.PI;
            }
        }

        // occasional sprint burst when we can afford it — generates
        // orb churn (drop + recycle) on top of pure movement load
        if (input.boost) {
            if (Math.random() < 0.1 || me.score < BOOST_ORB_VALUE) input.boost = false;
        } else if (me.score > 30 && Math.random() < 0.02) {
            input.boost = true;
        }

        room.send("input", input);
    }, 50);

    room.onLeave(() => {
        clearInterval(loop);
        console.log(`[bot-${n}] left`);
    });
    console.log(`[bot-${n}] joined as ${room.sessionId}`);
}

// Staggered joins: 16 simultaneous handshakes is a thundering herd
// the matchmaker would survive but real players never produce.
for (let i = 0; i < BOT_COUNT; i++) {
    setTimeout(() => {
        spawnBot(i).catch((err) => console.error(`[bot-${i}] FAILED: ${(err as Error).message}`));
    }, i * 150);
}
console.log(`spawning ${BOT_COUNT} bots against ${SERVER_URL} — Ctrl+C to disconnect all`);
