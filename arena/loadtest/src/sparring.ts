// A4.6 (embryo) — THE SPARRING PARTNER: one scripted opponent you can
// aim at yourself, because two snakes cannot be driven by one mouse.
// Every adversarial scenario below needs precise timing on BOTH sides
// (dodge at the exact moment of the kill, ram the channeler at second
// 3 of 4) — impossible by hand, trivial for a script.
//
// It plays in the DEMO room, and that is the whole trick: DemoRoom
// EXTENDS ArenaRoom, so the simulation under test — collisions, the
// A1.9 disconnect rule, corpses, the extract state machine — is the
// SAME code the paid arena runs. Gameplay exploits therefore cost
// ZERO SOL to reproduce. Only money-path scenarios (deposit reuse,
// ready-check desertion, refunds) need a funded wallet; those come
// later, on these same foundations.
//
// Usage (server running, then join the demo from the browser):
//   npm run spar <behavior>[:count] ...        (from arena/)
//   npm run spar hunt:3 contest:2 dodge        (a whole squad, one process)
//
//   hunt     chase the NEAREST snake — human or bot alike (2026-08-06:
//            was human-only, which made every roster a firing squad).
//            A live free-for-all: collision fairness under latency,
//            corpses, 70/30, [eco] drift under real predation
//   cannibal alias of hunt (kept for muscle memory — the distinction
//            died when hunt went nearest-enemy)
//   dodge    play, and CUT THE SOCKET whenever the human's head closes
//            in, then reconnect: the "disconnect dodge" exploit. CLOSED
//            2026-08-06 (disconnect = instant death) — this bot is now
//            the REGRESSION TEST: it must die on every cut, and a
//            "body intact — exploit CONFIRMED" line means the rule broke
//   feed     drive straight into the human on purpose: collusion
//            feeding — watch how much of the corpse the killer keeps
//            (70/30, D71) and that [eco] drift stays 0
//   contest  camp the extract zone and ram whoever starts channeling:
//            is D79's "kill window by design" actually playable?
//   racoon   farm pellets in the quiet, FLEE anything that moves, and
//            cash out at the extract zone the moment the take is worth
//            it — the rat run. Tests whether pure avoidance is a
//            viable strategy (and gives contest bots someone to punish)
//   circle   two lives in one snake: farm in peace (flee like a racoon)
//            until CIRCLE_HUNT_AT score, then flip predator — close on
//            the nearest snake and ORBIT it on a tightening ring, the
//            slither constriction play. Tests the buy-in curve's core
//            promise: does size actually convert into kills?
//   camping  the SCAVENGER: never leaves the extract point (orbits
//            just outside it, on a leash), and flips to apex-grade
//            hunting the moment someone approaches — DENYING the
//            cash-out (interposing between the mark and the zone)
//            until the mark channels or closes, then cutting it off.
//            v1 charged head-on and died 4/4 lives without regulating
//            anyone (user observation 2026-08-06); v2 shares the apex
//            toolkit. Tests whether extraction stays playable under
//            permanent zone control
//   apex     the PIRATE bot (red-team, user ask 2026-08-06): a hunt
//            with everything a human cannot sustain — perfect trail
//            memory of every snake in the bubble (seeded by the AoI
//            "body" message, then extended head-sample by head-sample),
//            collision-aware steering (a heading whose projected path
//            clips a known body is rejected before it is ever sent),
//            cut-off aim at the prey's FUTURE path, cold target
//            selection (only smaller snakes, flees bigger ones).
//            NO cheats: it reads exactly what a browser client reads.
//            The question under test (D78): is LEGAL perfection
//            survivable for a human, or does it need containment
//            (tiers A4.2 / heuristics A4.3)?
//   radar    play NOTHING, just print what room.state hands us. It
//            PROVED the player-radar leak (read a player at 2800px for
//            a 1200px bubble); since A4.6c closed it, this is the
//            REGRESSION TEST — a "LEAK" line means the filter broke
//
// Tip: DEMO_BOTS=0 on the server gives a clean 1v1 (no tutorial bots).
//
// MONEY MODE (A4.6 red-team économique, user plan 2026-08-06):
//   npm run fleet                                  (create/fund wallets)
//   SPAR_WALLETS=wallets SPAR_STAKE=0.1 npm run spar hunt:2 racoon:2
// The squad plays the PAID arena with real devnet SOL: SIWS + on-chain
// deposit + txSig each life, respawn 3-4min (a death leaves a hole —
// the question under test: does the D73 economy put enough pellets on
// the map to be FUN?). Extractions/refunds return to the bot wallets
// via the settlement service — keep it running or the fleet bleeds dry.
//
// Note: hunt, cannibal, circle and camping attack ANYONE, squadmates
// included (a live free-for-all); dodge, feed and contest target the
// HUMAN only — they recognise squadmates by the "spar-" name prefix
// and ignore them; racoon attacks nobody and runs from everybody.
//
// Since A4.6c the bots see only their own AoI bubble, like you. With
// nobody in sight they rally on the extract zone (global state by
// design) instead of wandering — that is what keeps them findable now
// that they cannot read the whole roster.

import { Client, Callbacks, type Room } from "@colyseus/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import nacl from "tweetnacl";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    AOI_RADIUS,
    ARENA_ROOM,
    BOOST_ORB_VALUE,
    DEMO_ROOM,
    EXTRACT_RADIUS,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    PROTOCOL_VERSION,
    SIWS_STATEMENT,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    WORLD_RADIUS,
    buildJoinInstruction,
    buildSiwsMessage,
    describeSnakeFromScore,
    type AuthChallenge,
    type AuthTokenPayload,
    type InputMessage,
    type RoundInfoResponse,
} from "@nimbo/shared";

type Behavior =
    | "hunt" | "cannibal" | "dodge" | "feed" | "contest"
    | "racoon" | "circle" | "camping" | "apex" | "radar";
const BEHAVIORS: Behavior[] = [
    "hunt", "cannibal", "dodge", "feed", "contest",
    "racoon", "circle", "camping", "apex", "radar",
];
const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";

// Every sparring bot carries this name prefix. It is how the squad
// tells "one of us" from the human — sessionIds cannot: only the
// server's tutorial bots get the "bot-" prefix, a scripted client
// looks exactly like a browser to the server (which is the point).
const SPAR_PREFIX = "spar-";

// Roster: "hunt:3 contest:2 dodge" or plain repeats "hunt hunt dodge".
// All of them live in ONE process — run() holds its own client, room
// and state, so N bots are just N calls.
function parseRoster(argv: string[]): Behavior[] {
    if (argv.length === 0) return ["hunt"];
    const roster: Behavior[] = [];
    for (const arg of argv) {
        const [name, rawCount] = arg.split(":");
        const behavior = name as Behavior;
        if (!BEHAVIORS.includes(behavior)) {
            console.error(`unknown behavior "${name}" — pick one of: ${BEHAVIORS.join(", ")}`);
            process.exit(1);
        }
        const count = rawCount === undefined ? 1 : Number(rawCount);
        if (!Number.isInteger(count) || count < 1 || count > 16) {
            console.error(`bad count "${rawCount}" for ${name} — expected an integer 1..16`);
            process.exit(1);
        }
        for (let i = 0; i < count; i += 1) roster.push(behavior);
    }
    return roster;
}
const ROSTER = parseRoster(process.argv.slice(2));

// dodge tuning: how close the human's head must get before we pull
// the plug, and how long we stay unplugged (A1.9 window is 5s —
// staying under it means the snake survives intact)
const DODGE_TRIGGER_PX = 220;
const DODGE_OFFLINE_MS = 3000;

// --- A4.6 MONEY MODE (red-team économique, user plan 2026-08-06) ----
// SPAR_WALLETS=<dir> flips the squad into the PAID arena: bot #i takes
// <dir>/bot-0i.json (fleet.ts creates and funds them), signs in with
// SIWS, deposits SPAR_STAKE on-chain and joins with the txSig — the
// EXACT protocol the browser speaks, no server-side favors. Deaths
// cost real (devnet) SOL; extractions and refunds flow back to the
// bot's wallet through the settlement service.
const WALLETS_DIR = process.env.SPAR_WALLETS;
const PAID = WALLETS_DIR !== undefined;
// SPAR_STAKE accepts "0.1" (fixed) or "0.1-0.5" (uniform random per
// LIFE): the variable buy-in is part of what the red-team simulates —
// a mixed-size population, big spawns paying for big power.
const STAKE_SPEC = process.env.SPAR_STAKE ?? "0.05";
const [STAKE_MIN, STAKE_MAX] = (() => {
    const parts = STAKE_SPEC.split("-").map(Number);
    const min = parts[0];
    const max = parts.length > 1 ? parts[1] : parts[0];
    if (!(min > 0) || !(max >= min)) {
        console.error(`bad SPAR_STAKE "${STAKE_SPEC}" — expected "0.1" or "0.1-0.5"`);
        process.exit(1);
    }
    return [min, max];
})();
// rounded to whole SOL cents: readable in logs and explorers
const rollStake = () =>
    Math.round((STAKE_MIN + Math.random() * (STAKE_MAX - STAKE_MIN)) * 100) / 100;
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost:5173";
const chain = PAID ? new Connection(RPC_URL, "confirmed") : undefined;

// How long the bot stays dead before rejoining. FREE: short (the human
// is waiting for a partner). PAID: ~2 min (user setting 2026-08-06,
// was 3-4) — a death must leave a hole; the pellet supply between
// respawns IS what the red-team run measures. The small jitter breaks
// respawn-wave synchronization.
function respawnDelay(): number {
    const forced = process.env.SPAR_RESPAWN_MS;
    if (forced !== undefined) return Number(forced);
    return PAID ? 120_000 + Math.random() * 20_000 : 2000;
}

// racoon tuning: anyone closer than FLEE_PX breaks the farming (run
// away, boosting under PANIC_PX), and GREED is the eaten value that
// turns the run into a dash for the extract zone
const RACOON_FLEE_PX = 500;
const RACOON_PANIC_PX = 250;
const RACOON_GREED = FOOD_VALUE * 8;

// circle tuning: the score where the farmer becomes the constrictor,
// the range where it stops intercepting and starts orbiting, and how
// far ahead on the ring it aims (bigger = faster lap, looser circle)
const CIRCLE_HUNT_AT = Number(process.env.SPAR_CIRCLE_HUNT_AT ?? 150);
const CIRCLE_ENGAGE_PX = 550;
const CIRCLE_LEAD_RAD = 0.5;

// camping tuning: everything inside GUARD of the ZONE (not of the bot)
// is a mark — the booth charges by proximity to the money, not to the
// guard. LEASH caps how far a chase may drag it from its post: a
// scavenger that wanders off has stopped being one.
const CAMP_GUARD_PX = 800;
const CAMP_LEASH_PX = 1100;

// apex tuning: trail sampling step (px between stored head samples),
// extra clearance beyond the two radii when rejecting a heading, and
// the size ratio above which a neighbor is a bully to run from
const APEX_SAMPLE_PX = 14;
const APEX_MARGIN_PX = 18;
const APEX_EVADE_RATIO = 1.25;

interface NetPlayer {
    name: string;
    x: number;
    y: number;
    angle: number;
    score: number;
    channel: number;
    connected: boolean;
}
interface NetFood { x: number; y: number; value: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A public devnet RPC rate-limits (429) and times out under a squad of
// depositing bots — that is normal weather, not a reason to lose a
// run. Retry with exponential backoff + jitter; give up loudly after
// the last attempt and let the caller decide (a bot skips this life,
// the squad plays on).
async function rpcRetry<T>(what: string, fn: () => Promise<T>, tries = 5): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= tries; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === tries) break;
            const wait = Math.round(800 * 2 ** (attempt - 1) * (1 + Math.random()));
            console.log(`[rpc] ${what} failed (${(err as Error).message}) — retry ${attempt}/${tries - 1} in ${wait}ms`);
            await sleep(wait);
        }
    }
    throw lastErr;
}

// --- money-mode helpers (mirror of client/src/wallet.ts, headless) --
function loadWallet(walletIdx: number): Keypair {
    const file = path.join(WALLETS_DIR!, `bot-${String(walletIdx + 1).padStart(2, "0")}.json`);
    if (!fs.existsSync(file)) {
        console.error(`missing wallet ${file} — create the fleet first:  npm run fleet ${walletIdx + 1}`);
        process.exit(1);
    }
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

// SIWS without a wallet UI: we build the canonical message ourselves
// (shared/siws.ts exists for exactly this) and sign with the bot's
// keypair — a Solana secret key IS a 64-byte ed25519 secret, tweetnacl
// signs with it directly.
async function makeToken(keys: Keypair): Promise<string> {
    const res = await fetch(`${SERVER_URL}/auth/challenge`);
    if (!res.ok) throw new Error(`auth challenge failed (${res.status})`);
    const challenge: AuthChallenge = await res.json();
    const address = keys.publicKey.toBase58();
    const message = buildSiwsMessage({
        domain: AUTH_DOMAIN,
        address,
        statement: SIWS_STATEMENT,
        nonce: challenge.nonce,
    });
    const bytes = new TextEncoder().encode(message);
    const payload: AuthTokenPayload = {
        pk: address,
        msg: Buffer.from(bytes).toString("base64"),
        sig: Buffer.from(nacl.sign.detached(bytes, keys.secretKey)).toString("base64"),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// The join deposit, self-signed and self-sent. The server re-reads the
// EXACT lamports from the confirmed tx — nothing here is trusted.
async function sendDeposit(keys: Keypair, stakeSol: number): Promise<string> {
    const res = await fetch(`${SERVER_URL}/round`);
    if (!res.ok) {
        throw new Error(`round info failed (${res.status}) — server in free-only mode? set ROUND_ID`);
    }
    const round: RoundInfoResponse = await res.json();
    const tx = new Transaction().add(
        buildJoinInstruction({
            player: keys.publicKey,
            roundId: BigInt(round.roundId),
            treasury: new PublicKey(round.treasury),
            stakeLamports: BigInt(Math.round(stakeSol * LAMPORTS_PER_SOL)),
        }),
    );
    // NB: a retry re-signs with a fresh blockhash (sendAndConfirm does
    // it internally), so a timed-out attempt cannot double-spend — the
    // first tx either landed (and the second fails as duplicate) or
    // never existed.
    return await rpcRetry("join deposit", () =>
        sendAndConfirmTransaction(chain!, tx, [keys], { commitment: "confirmed" }));
}

// Turning-radius geometry (A1.10 lesson): a point inside one of the
// two current turning circles can never be reached by steering.
function isReachable(me: NetPlayer, f: { x: number; y: number }, turnRadius: number, reach: number): boolean {
    const lx = me.x - Math.sin(me.angle) * turnRadius;
    const ly = me.y + Math.cos(me.angle) * turnRadius;
    const rx = me.x + Math.sin(me.angle) * turnRadius;
    const ry = me.y - Math.cos(me.angle) * turnRadius;
    const margin = turnRadius - reach;
    return Math.hypot(f.x - lx, f.y - ly) > margin && Math.hypot(f.x - rx, f.y - ry) > margin;
}

// Lead the target instead of chasing its tail lights: aim where it
// WILL be, given its heading and our closing time. Pure geometry —
// the same trick a good human uses to cut someone off.
function interceptAngle(me: NetPlayer, target: NetPlayer, speed: number): number {
    const dist = Math.hypot(target.x - me.x, target.y - me.y);
    const eta = dist / Math.max(speed, 0.001); // in frames
    const tx = target.x + Math.cos(target.angle) * SNAKE_SPEED * eta * 0.6;
    const ty = target.y + Math.sin(target.angle) * SNAKE_SPEED * eta * 0.6;
    return Math.atan2(ty - me.y, tx - me.x);
}

async function run(BEHAVIOR: Behavior, slot: number, walletIdx: number) {
    // tag = stable identity across respawns, so a squad's logs stay
    // readable ("hunt#2 died" tells you which one)
    const tag = `${BEHAVIOR}#${slot}`;
    const client = new Client(SERVER_URL);
    let room: Room;
    if (PAID) {
        // Money path: SIWS + on-chain deposit + txSig, every life —
        // nonces and deposit signatures are single-use by design, so a
        // respawn repeats the whole ritual, exactly like a human would.
        const keys = loadWallet(walletIdx);
        const stakeSol = rollStake(); // fresh roll every life
        const balance = await rpcRetry("getBalance", () => chain!.getBalance(keys.publicKey));
        const need = Math.round((stakeSol + 0.005) * LAMPORTS_PER_SOL); // stake + fee headroom
        if (balance < need) {
            console.log(
                `[spar:${tag}] wallet ${keys.publicKey.toBase58().slice(0, 4)}..` +
                ` is dry (◎${(balance / LAMPORTS_PER_SOL).toFixed(4)} < ◎${stakeSol}+fees) — RETIRING.` +
                ` The economy defeated this bot; refill with npm run fleet if that wasn't the point.`,
            );
            return;
        }
        client.auth.token = await makeToken(keys);
        const txSig = await sendDeposit(keys, stakeSol);
        console.log(
            `[spar:${tag}] deposited ◎${stakeSol} (${txSig.slice(0, 8)}…,` +
            ` wallet ◎${((balance - stakeSol * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL).toFixed(4)} left)` +
            ` — joining the PAID arena`,
        );
        room = await client.joinOrCreate(ARENA_ROOM, {
            protocol: PROTOCOL_VERSION,
            name: `${SPAR_PREFIX}${BEHAVIOR}${slot}`,
            stake: stakeSol,
            txSig,
        });
    } else {
        room = await client.joinOrCreate(DEMO_ROOM, {
            protocol: PROTOCOL_VERSION,
            name: `${SPAR_PREFIX}${BEHAVIOR}${slot}`,
            stake: 0,
        });
    }

    let me: NetPlayer | undefined;
    const others = new Map<string, NetPlayer>();
    const foods = new Map<string, NetFood>();
    // apex: per-enemy body estimate — a point cloud, seeded by the AoI
    // "body" message and extended with observed head samples. Order
    // does not matter (it is a hazard field, not a rendering), so seed
    // and samples can mix freely.
    const trails = new Map<string, { x: number; y: number }[]>();

    // Declared up-front: restart() runs from inside a room callback and
    // has to be able to stop the loops that outlive the dead body.
    let loop: ReturnType<typeof setInterval> | undefined;
    let watch: ReturnType<typeof setInterval> | undefined;
    let restarting = false;

    // D72 — death is GAME OVER: the server deletes the player and sends
    // "died", but it does NOT close the socket (the browser needs it to
    // paint its end screen). So a bot that only watches the connection
    // never notices it died and keeps steering a corpse. Rejoin instead:
    // a sparring partner the human has to relaunch is a bad partner.
    async function restart(reason: string, delayMs = respawnDelay()) {
        if (restarting) return;
        restarting = true;
        if (loop) clearInterval(loop);
        if (watch) clearInterval(watch);
        me = undefined;
        console.log(`[spar:${tag}] ${reason} — rejoining in ${Math.round(delayMs / 1000)}s`);
        await room.leave().catch(() => {});
        await sleep(delayMs);
        run(BEHAVIOR, slot, walletIdx).catch((err) =>
            console.error(`[spar:${tag}] rejoin failed: ${(err as Error).message}`));
    }

    // (Re)wire every callback — a reconnect hands us a NEW room object,
    // so this runs again on the fresh one.
    function wire(r: Room) {
        me = undefined;
        others.clear();
        foods.clear();
        trails.clear();
        r.onMessage("*", (type, message) => {
            // AoI body seed (A4.6f): the server hands us the REAL trail
            // of every snake entering our bubble — the browser uses it
            // to render, apex uses it to never touch one
            if (type === "body") {
                const m = message as { id: string; points: number[] };
                const tr: { x: number; y: number }[] = [];
                for (let i = 0; i + 1 < m.points.length; i += 2) {
                    tr.push({ x: m.points[i], y: m.points[i + 1] });
                }
                trails.set(m.id, tr);
                return;
            }
            // launch gate gave up (paid arena, alone for 60s): the SOL
            // is on its way back through settlement — retry SOON, not
            // in 3-4min, or two lonely bots ping-pong refunds forever
            if (type === "refunded") {
                void restart("refunded (launch gate gave up)", 20_000);
                return;
            }
            if (type !== "died" && type !== "extracted") return;
            // A4.6d: "died" now names the killer — printing it here
            // makes the bot log a killfeed of its own. Lamports shown
            // in money mode: the red-team run reads as a ledger.
            const m = message as
                | { kind?: string; killedBy?: string; lamports?: string }
                | undefined;
            const detail = m?.kind ? ` (${m.kind}${m.killedBy ? ` with ${m.killedBy}` : ""})` : "";
            const money = PAID && m?.lamports
                ? ` ◎${(Number(m.lamports) / LAMPORTS_PER_SOL).toFixed(4)}`
                : "";
            void restart(`${String(type)}${money}${detail}`);
        });
        const cb = Callbacks.get(r);
        cb.onAdd("players", (p, id) => {
            if (String(id) === r.sessionId) me = p as NetPlayer;
            else others.set(String(id), p as NetPlayer);
        });
        cb.onRemove("players", (_p, id) => {
            // our own body being removed = we are dead, whatever the
            // reason; never steer a ghost while "died" is in flight
            if (String(id) === r.sessionId) me = undefined;
            else {
                others.delete(String(id));
                trails.delete(String(id));
            }
        });
        cb.onAdd("food", (f, id) => foods.set(String(id), f as NetFood));
        cb.onRemove("food", (_f, id) => foods.delete(String(id)));
    }
    wire(room);

    // Prey selection — the nearest player we are willing to attack.
    //   hunt / cannibal: everyone in sight, squadmates included (user
    //   call 2026-08-06: a whole roster beelining the human was a
    //   firing squad, not a simulation — nearest-enemy is realistic)
    //   dodge / feed / contest: the human only, i.e. neither a server
    //   tutorial bot (sessionId "bot-") nor a squadmate (name "spar-")
    const HUNTS_ANYONE =
        BEHAVIOR === "hunt" || BEHAVIOR === "cannibal" ||
        BEHAVIOR === "circle" || BEHAVIOR === "camping";
    const attackable = (id: string, p: NetPlayer) =>
        HUNTS_ANYONE || !(id.startsWith("bot-") || p.name.startsWith(SPAR_PREFIX));
    function prey(): NetPlayer | undefined {
        let best: NetPlayer | undefined;
        let bestD = Infinity;
        for (const [id, p] of others) {
            if (!attackable(id, p)) continue;
            // NB: disconnected snakes stay on the list on purpose — a
            // hunter still closing on a frozen body IS the dodge proof
            if (!me) return p;
            const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
            if (d < bestD) { bestD = d; best = p; }
        }
        return best;
    }

    // Nearest pellet the current turning circles can actually reach —
    // shared by every behavior that farms (racoon, circle, camping,
    // and the hunt fallback when the bubble is empty).
    function nearestFood(turnRadius: number, eatReach: number): NetFood | undefined {
        if (!me) return undefined;
        let best: NetFood | undefined;
        let bestD = Infinity;
        for (const f of foods.values()) {
            if (!isReachable(me, f, turnRadius, eatReach)) continue;
            const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
            if (d < bestD) { bestD = d; best = f; }
        }
        return best;
    }

    // --- predator toolkit (apex + camping's hunt mode) --------------
    // Perfect trail memory: every visible enemy's body, rebuilt from
    // the AoI "body" seed plus observed head samples. This is what
    // separates a bot that never clips a body from one that dies to
    // the flank it could not see.
    function rememberTrails() {
        for (const [id, p] of others) {
            let tr = trails.get(id);
            if (!tr) { tr = []; trails.set(id, tr); }
            const last = tr[tr.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= APEX_SAMPLE_PX) {
                tr.push({ x: p.x, y: p.y });
            }
            const bodyLen = describeSnakeFromScore(p.score).length * SNAKE_SPACING;
            const maxPts = Math.ceil(bodyLen / APEX_SAMPLE_PX) + 4;
            while (tr.length > maxPts) tr.shift();
        }
    }

    // Worst surface-to-surface clearance along a candidate heading,
    // sampled at three horizons. Negative = that heading kills us.
    function clearanceOf(self: NetPlayer, angle: number, speed: number, myR: number): number {
        let minClear = Infinity;
        for (const step of [10, 22, 34]) { // frames ahead
            const px = self.x + Math.cos(angle) * speed * step;
            const py = self.y + Math.sin(angle) * speed * step;
            const borderClear = WORLD_RADIUS - myR - Math.hypot(px, py);
            if (borderClear < minClear) minClear = borderClear;
            for (const [id, p] of others) {
                const reach = describeSnakeFromScore(p.score).radius + myR + APEX_MARGIN_PX;
                const dh = Math.hypot(p.x - px, p.y - py) - reach;
                if (dh < minClear) minClear = dh;
                const tr = trails.get(id);
                if (tr) {
                    for (const pt of tr) {
                        const d = Math.hypot(pt.x - px, pt.y - py) - reach;
                        if (d < minClear) minClear = d;
                    }
                }
            }
            if (minClear < -40) break; // hopeless, stop probing
        }
        return minClear;
    }

    // The heading closest to what we WANT that does not clip anything.
    // Nothing safe -> the least bad one (dying facing the exit beats
    // dying frozen).
    function safeSteer(self: NetPlayer, desired: number, speed: number, myR: number): number {
        let fallback = desired;
        let fallbackClear = -Infinity;
        for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
            const a = desired + off;
            const clear = clearanceOf(self, a, speed, myR);
            if (clear > 0) return a;
            if (clear > fallbackClear) { fallbackClear = clear; fallback = a; }
        }
        return fallback;
    }

    // Aim ACROSS the prey's future path: our body arrives where its
    // head is going, so the kill is the prey touching us — never a
    // head-on trade (the mistake that made hunt an extinction event).
    function cutOffAngle(self: NetPlayer, prey: NetPlayer, dist: number): number {
        const ahead = Math.min(dist * 0.9, 320);
        const cx = prey.x + Math.cos(prey.angle) * ahead;
        const cy = prey.y + Math.sin(prey.angle) * ahead;
        return Math.atan2(cy - self.y, cx - self.x);
    }

    const input: InputMessage = { angle: Math.random() * 2 * Math.PI, boost: false };
    let dodging = false;
    let dodgeCount = 0;
    let lastLog = 0;
    // racoon bookkeeping: the score we were born with — profit is
    // measured against it, and profit is when the rat runs for the exit
    let spawnScore: number | undefined;

    console.log(`[spar:${tag}] joined ${room.roomId} as ${room.sessionId} — waiting for a human…`);

    // Same cadence as the browser client: intent at 20Hz, nothing else.
    loop = setInterval(async () => {
        if (dodging || restarting || !me) return;
        const target = prey();
        const now = Date.now();

        // radar: no steering at all, just a printout of what the state
        // hands us. Since A4.6c closed the leak this is a REGRESSION
        // TEST — any line saying "OUTSIDE our AoI bubble" means the
        // player filter has come undone.
        if (BEHAVIOR === "radar") {
            if (now - lastLog > 1000) {
                lastLog = now;
                if (!target) {
                    console.log(`[${tag}] nobody in state — AoI holding (${others.size} entries)`);
                } else {
                    const d = Math.hypot(target.x - me.x, target.y - me.y);
                    console.log(
                        `[${tag}] ${target.name} at (${target.x.toFixed(0)}, ${target.y.toFixed(0)})` +
                        ` score=${target.score.toFixed(1)} dist=${d.toFixed(0)}px` +
                        ` — ${d > AOI_RADIUS ? "!! OUTSIDE our AoI bubble — LEAK !!" : "inside AoI"}`,
                    );
                }
            }
            // It observes, but it must still LOOK piloted: a snake that
            // never sends an input is held and then kicked by the
            // server's anti-AFK rule (FIRST_INPUT_TTL), and the SDK
            // reconnects into the same kick forever — that was the
            // "reconnection successful" storm in the 2026-08-05 run.
            // Lazy circling keeps it alive without going anywhere.
            input.angle = me.angle + 0.05;
            input.boost = false;
            room.send("input", input);
            return;
        }

        const dims = describeSnakeFromScore(me.score);
        const speed = input.boost ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
        const turnRadius = speed / dims.turnSpeed;
        const eatReach = dims.radius + FOOD_EAT_RANGE;
        const distToHuman = target ? Math.hypot(target.x - me.x, target.y - me.y) : Infinity;

        // survival always comes first: the border kills regardless of
        // what we are rehearsing
        if (Math.hypot(me.x, me.y) > WORLD_RADIUS * 0.85) {
            input.angle = Math.atan2(-me.y, -me.x);
            input.boost = false;
            room.send("input", input);
            return;
        }

        if (BEHAVIOR === "dodge" && target && distToHuman < DODGE_TRIGGER_PX) {
            // THE (closed) EXPLOIT: cut the socket mid-duel. Under the
            // old A1.9 window the snake froze intangible and came back
            // untouched; since 2026-08-06 the server kills it on the
            // spot, so the reconnect below MUST be refused — reaching
            // "body intact" again means the anti rage-quit rule broke.
            dodging = true;
            dodgeCount += 1;
            console.log(
                `[${tag}] prey at ${distToHuman.toFixed(0)}px — CUTTING THE SOCKET` +
                ` (#${dodgeCount}, back in ${DODGE_OFFLINE_MS}ms)`,
            );
            const token = room.reconnectionToken;
            await room.leave(false);
            await sleep(DODGE_OFFLINE_MS);
            try {
                room = await client.reconnect(token);
                wire(room); // re-registers messages AND schema callbacks
                console.log(`[${tag}] back online, body intact — exploit ${"CONFIRMED"}`);
            } catch (err) {
                // refused = the exploit is closed (good news, one day).
                // Rejoin rather than kill the process: in a squad, one
                // bot giving up must not take the others down.
                dodging = false;
                void restart(`reconnect refused (${(err as Error).message})`);
                return;
            }
            dodging = false;
            return;
        }

        if (BEHAVIOR === "feed" && target) {
            // deliberate suicide into the human: the collusion move
            input.angle = Math.atan2(target.y - me.y, target.x - me.x);
            input.boost = me.score > BOOST_ORB_VALUE * 2;
            room.send("input", input);
            if (now - lastLog > 2000) {
                lastLog = now;
                console.log(`[${tag}] ramming ${target.name} — my score ${me.score.toFixed(1)}`);
            }
            return;
        }

        if (BEHAVIOR === "contest") {
            const zone = (room.state as { extract?: { active: boolean; x: number; y: number } }).extract;
            // someone channeling inside the zone is the prey; otherwise
            // camp the zone and wait for one
            // squadmates are not prey (same rule as prey(), 2026-08-05:
            // three contest bots were ramming the hunt bots instead of
            // camping for the human)
            const channeler = [...others.entries()]
                .filter(([id, p]) => attackable(id, p))
                .map(([, p]) => p)
                .find((p) => p.channel > 0 && p.connected);
            if (channeler) {
                input.angle = interceptAngle(me, channeler, speed);
                input.boost = me.score > BOOST_ORB_VALUE * 2;
                if (now - lastLog > 1000) {
                    lastLog = now;
                    console.log(
                        `[${tag}] ${channeler.name} is channeling (${(channeler.channel / 60).toFixed(1)}s)` +
                        ` — closing in, ${Math.hypot(channeler.x - me.x, channeler.y - me.y).toFixed(0)}px`,
                    );
                }
            } else if (zone?.active) {
                // orbit just outside the zone: visible bait, ready to strike
                const d = Math.hypot(zone.x - me.x, zone.y - me.y);
                input.angle = d > EXTRACT_RADIUS * 2
                    ? Math.atan2(zone.y - me.y, zone.x - me.x)
                    : me.angle + 0.15; // lazy circling
                input.boost = false;
            } else if (Math.random() < 0.05) {
                input.angle = Math.random() * 2 * Math.PI;
            }
            room.send("input", input);
            return;
        }

        if (BEHAVIOR === "racoon") {
            if (spawnScore === undefined) spawnScore = me.score;
            const zone = (room.state as { extract?: { active: boolean; x: number; y: number } }).extract;

            // a racoon has no friends: the nearest snake of ANY kind is
            // a threat, and running away always beats whatever else this
            // tick had in mind
            let threat: NetPlayer | undefined;
            let threatD = Infinity;
            for (const p of others.values()) {
                const d = Math.hypot(p.x - me.x, p.y - me.y);
                if (d < threatD) { threatD = d; threat = p; }
            }
            if (threat && threatD < RACOON_FLEE_PX) {
                input.angle = Math.atan2(me.y - threat.y, me.x - threat.x);
                input.boost = threatD < RACOON_PANIC_PX && me.score > BOOST_ORB_VALUE * 2;
                room.send("input", input);
                if (now - lastLog > 2000) {
                    lastLog = now;
                    console.log(`[${tag}] fleeing ${threat.name} (${threatD.toFixed(0)}px)`);
                }
                return;
            }

            input.boost = false;
            const profit = me.score - spawnScore;
            if (zone?.active && profit >= RACOON_GREED) {
                // cash out: sit in the zone and let the server channel —
                // "extracted" lands in the message handler and restarts
                // us. The flee block above stays the priority: a contest
                // bot showing up mid-channel makes the racoon bail, which
                // is exactly the D79 kill-window working as designed.
                const d = Math.hypot(zone.x - me.x, zone.y - me.y);
                input.angle = d > EXTRACT_RADIUS * 0.4
                    ? Math.atan2(zone.y - me.y, zone.x - me.x)
                    : me.angle + 0.1; // gentle circling inside the zone
                if (now - lastLog > 2000) {
                    lastLog = now;
                    console.log(
                        `[${tag}] cashing out +${profit.toFixed(1)}` +
                        ` — ${d.toFixed(0)}px from the zone, channel ${(me.channel / 60).toFixed(1)}s`,
                    );
                }
            } else {
                // farm: nearest reachable pellet, drift when the bubble
                // is bare (racoons don't rally on the zone — that is
                // where the fighting is)
                const best = nearestFood(turnRadius, eatReach);
                if (best) {
                    input.angle = Math.atan2(best.y - me.y, best.x - me.x);
                } else if (Math.random() < 0.05) {
                    input.angle = Math.random() * 2 * Math.PI;
                }
            }
            room.send("input", input);
            return;
        }

        if (BEHAVIOR === "circle") {
            // Two lives in one snake. Below the threshold: a racoon
            // without the cash-out — flee close threats, farm pellets.
            if (me.score < CIRCLE_HUNT_AT) {
                let threat: NetPlayer | undefined;
                let threatD = Infinity;
                for (const p of others.values()) {
                    const d = Math.hypot(p.x - me.x, p.y - me.y);
                    if (d < threatD) { threatD = d; threat = p; }
                }
                if (threat && threatD < RACOON_FLEE_PX * 0.8) {
                    input.angle = Math.atan2(me.y - threat.y, me.x - threat.x);
                    input.boost = threatD < RACOON_PANIC_PX && me.score > BOOST_ORB_VALUE * 2;
                } else {
                    input.boost = false;
                    const best = nearestFood(turnRadius, eatReach);
                    if (best) {
                        input.angle = Math.atan2(best.y - me.y, best.x - me.x);
                    } else if (Math.random() < 0.05) {
                        input.angle = Math.random() * 2 * Math.PI;
                    }
                }
                room.send("input", input);
                return;
            }
            // Big enough: constrictor. Far target -> intercept like a
            // hunt; close target -> stop aiming AT it and orbit — aim
            // at a point AHEAD on a ring around it, and let the ring
            // follow the shrinking distance so every lap tightens.
            if (target) {
                if (distToHuman > CIRCLE_ENGAGE_PX) {
                    input.angle = interceptAngle(me, target, speed);
                    input.boost = me.score > BOOST_ORB_VALUE * 4 && distToHuman < 900;
                } else {
                    const around = Math.atan2(me.y - target.y, me.x - target.x);
                    const ring = Math.max(dims.radius * 3 + 40, distToHuman * 0.9);
                    input.angle = Math.atan2(
                        target.y + Math.sin(around + CIRCLE_LEAD_RAD) * ring - me.y,
                        target.x + Math.cos(around + CIRCLE_LEAD_RAD) * ring - me.x,
                    );
                    // lap faster than the prey can run: the whole play
                    input.boost = me.score > BOOST_ORB_VALUE * 4;
                }
                if (now - lastLog > 2000) {
                    lastLog = now;
                    const mode = distToHuman > CIRCLE_ENGAGE_PX ? "closing on" : "CIRCLING";
                    console.log(`[${tag}] ${mode} ${target.name} — ${distToHuman.toFixed(0)}px, me ${me.score.toFixed(0)}`);
                }
            } else {
                input.boost = false;
                const best = nearestFood(turnRadius, eatReach);
                if (best) input.angle = Math.atan2(best.y - me.y, best.x - me.x);
                else if (Math.random() < 0.05) input.angle = Math.random() * 2 * Math.PI;
            }
            room.send("input", input);
            return;
        }

        if (BEHAVIOR === "camping") {
            // The scavenger (rewritten 2026-08-06 after the user watched
            // v1 in game: it charged head-on and died 4 times in 4 lives
            // without regulating anyone). Now: NEVER leaves the extract
            // point, and switches to apex-grade hunting the moment
            // someone approaches — killing AND denying the cash-out.
            const self = me;
            const myR = dims.radius;
            rememberTrails();
            const zone = (room.state as { extract?: { active: boolean; x: number; y: number } }).extract;

            let desired: number;
            let wantBoost = false;
            let mode = "grazing";

            if (!zone?.active) {
                // between zones: graze where we stand, stay alive
                const best = nearestFood(turnRadius, eatReach);
                desired = best
                    ? Math.atan2(best.y - self.y, best.x - self.x)
                    : self.angle + 0.05;
            } else {
                const myZoneD = Math.hypot(zone.x - self.x, zone.y - self.y);
                // the mark is whoever is nearest THE MONEY, not nearest
                // us: the booth charges by proximity to the zone
                let mark: NetPlayer | undefined;
                let markD = Infinity;
                for (const p of others.values()) {
                    const d = Math.hypot(p.x - zone.x, p.y - zone.y);
                    if (d < markD) { markD = d; mark = p; }
                }
                const dMe = mark ? Math.hypot(mark.x - self.x, mark.y - self.y) : Infinity;

                if (myZoneD > CAMP_LEASH_PX) {
                    // the leash: a scavenger that wanders off is not a
                    // scavenger. Chases end at the leash, always.
                    desired = Math.atan2(zone.y - self.y, zone.x - self.x);
                    mode = "back to station";
                } else if (mark && markD < CAMP_GUARD_PX) {
                    // CHANNELING or already on top of us = kill window
                    // (D79 by design): full apex cut-off, no hesitation
                    if (mark.channel > 0 || dMe < 300) {
                        desired = cutOffAngle(self, mark, dMe);
                        wantBoost = self.score > BOOST_ORB_VALUE * 3 && dMe < 600;
                        mode = mark.channel > 0
                            ? `KILLING ${mark.name} mid-channel (${(mark.channel / 60).toFixed(1)}s)`
                            : `killing ${mark.name}`;
                    } else {
                        // DENIAL: interpose between the mark and the
                        // money — it has to come through us to channel.
                        // Aiming at the zone side of the segment keeps
                        // us on the inside track (shorter arc, we win
                        // the race to the point it wants to reach).
                        const t = 0.35; // 0 = zone centre, 1 = the mark
                        const bx = zone.x + (mark.x - zone.x) * t;
                        const by = zone.y + (mark.y - zone.y) * t;
                        desired = Math.atan2(by - self.y, bx - self.x);
                        mode = `denying ${mark.name} (${markD.toFixed(0)}px from the zone)`;
                    }
                } else {
                    // ON STATION: orbit JUST OUTSIDE the zone. Outside
                    // matters twice — sitting inside would channel our
                    // own extraction (we would cash out and leave), and
                    // the expiry bomb kills whoever is in there.
                    const around = Math.atan2(self.y - zone.y, self.x - zone.x);
                    const ring = EXTRACT_RADIUS * 1.35;
                    desired = Math.atan2(
                        zone.y + Math.sin(around + 0.45) * ring - self.y,
                        zone.x + Math.cos(around + 0.45) * ring - self.x,
                    );
                    mode = "on station";
                }
            }

            const chosen = safeSteer(self, desired, speed, myR);
            input.angle = chosen;
            input.boost = wantBoost && Math.abs(chosen - desired) < 0.5;
            room.send("input", input);
            if (now - lastLog > 2000) {
                lastLog = now;
                console.log(`[${tag}] ${mode} — score ${self.score.toFixed(0)}`);
            }
            return;
        }

        if (BEHAVIOR === "apex") {
            const self = me; // non-null capture
            const myR = dims.radius;
            rememberTrails();

            // cold target selection: prey = nearest STRICTLY smaller
            // snake; bully = a meaningfully bigger one close enough to
            // matter. Running from bullies outranks everything.
            let prey: NetPlayer | undefined;
            let preyD = Infinity;
            let bully: NetPlayer | undefined;
            let bullyD = Infinity;
            for (const p of others.values()) {
                const d = Math.hypot(p.x - self.x, p.y - self.y);
                if (p.score < self.score * 0.9 && d < preyD) { preyD = d; prey = p; }
                if (p.score > self.score * APEX_EVADE_RATIO && d < bullyD) { bullyD = d; bully = p; }
            }

            let desired: number;
            let wantBoost = false;
            let mode = "farm";
            if (bully && bullyD < 420) {
                desired = Math.atan2(self.y - bully.y, self.x - bully.x);
                wantBoost = bullyD < 260 && self.score > BOOST_ORB_VALUE * 3;
                mode = `evade ${bully.name}`;
            } else if (prey && preyD < 1100) {
                desired = cutOffAngle(self, prey, preyD);
                wantBoost = preyD < 650 && self.score > BOOST_ORB_VALUE * 6;
                mode = `cut-off ${prey.name}`;
            } else {
                const best = nearestFood(turnRadius, eatReach);
                desired = best
                    ? Math.atan2(best.y - self.y, best.x - self.x)
                    : self.angle + (Math.random() < 0.05 ? Math.random() - 0.5 : 0);
            }

            const chosen = safeSteer(self, desired, speed, myR);
            // boosting into a swerve is how apex would die — the boost
            // is only spent when the safe heading IS the attack heading
            input.angle = chosen;
            input.boost = wantBoost && Math.abs(chosen - desired) < 0.5;
            room.send("input", input);
            if (now - lastLog > 2000) {
                lastLog = now;
                console.log(`[${tag}] ${mode} — score ${self.score.toFixed(0)}, ${others.size} in bubble`);
            }
            return;
        }

        // hunt (default): intercept whatever the bubble shows us.
        // Until A4.6c the roster was global, so this bot came straight
        // at you from 2800px — that was the RADAR LEAK, not a cheat we
        // granted ourselves. Now it hunts blind like a player, which is
        // the point but makes encounters rarer: hence the rally below.
        if (target) {
            input.angle = interceptAngle(me, target, speed);
            input.boost = me.score > BOOST_ORB_VALUE * 2 && distToHuman < 400;
            if (now - lastLog > 2000) {
                lastLog = now;
                console.log(`[${tag}] closing on ${target.name} — ${distToHuman.toFixed(0)}px`);
            }
        } else {
            // Nobody in sight. The extract zone is the one thing every
            // client legitimately knows the position of (it is global
            // state ON PURPOSE, A0.6) — so converge on it, exactly as a
            // real player looking for a fight would. This is how the
            // sparring partner stays findable without a wallhack.
            const zone = (room.state as { extract?: { active: boolean; x: number; y: number } }).extract;
            const best = nearestFood(turnRadius, eatReach);
            const zoneDist = zone?.active ? Math.hypot(zone.x - me.x, zone.y - me.y) : Infinity;
            if (zone?.active && zoneDist > EXTRACT_RADIUS) {
                input.angle = Math.atan2(zone.y - me.y, zone.x - me.x);
            } else if (best) {
                input.angle = Math.atan2(best.y - me.y, best.x - me.x);
            } else if (Math.random() < 0.05) {
                input.angle = Math.random() * 2 * Math.PI;
            }
            input.boost = false;
        }
        room.send("input", input);
    }, 50);

    // Second net, for the deaths that never send us a message: kicked
    // for idling, room disposed, server restarted.
    watch = setInterval(() => {
        if (dodging || restarting) return;
        if (room.connection?.isOpen) return;
        void restart("connection closed");
    }, 1000);
}

function fatal(msg: string): never {
    // "fetch failed" is node-speak for "the connection never happened"
    // — say WHICH connection, the two failure modes have nothing in
    // common (2026-08-06: an RPC outage wore the "start a server"
    // hint and sent the user debugging the wrong machine).
    if (/balance|blockhash|transaction|airdrop/i.test(msg)) {
        console.error(`  the Solana RPC (${RPC_URL}) is unreachable — check network/VPN, then retry`);
    } else if (/fetch failed|ECONNREFUSED/.test(msg)) {
        console.error(`  no arena server answering at ${SERVER_URL}`);
        console.error(`  start one first:  cd arena && DEMO_BOTS=0 npm run dev:server`);
    }
    process.exit(1);
}

// Launch the roster. Joins are staggered: a burst of simultaneous
// joinOrCreate calls can race into separate rooms, and a squad split
// across two rooms spars with nobody.
// A red-team run lasts hours; ONE bad RPC promise must never take the
// squad down with it (2026-08-06: a devnet connect-timeout killed 8
// live bots mid-run, and their stakes with them). Node's default is to
// exit on an unhandled rejection — override it: log, keep playing.
process.on("unhandledRejection", (reason) => {
    console.error(`[spar] unhandled rejection (ignored): ${String(reason)}`);
});
process.on("uncaughtException", (err) => {
    console.error(`[spar] uncaught exception (ignored): ${err.message}`);
});

(async () => {
    console.log(
        `[spar] squad: ${ROSTER.join(", ")} — ${SERVER_URL}` +
        (PAID ? ` — MONEY MODE (◎${STAKE_SPEC}/life, wallets in ${WALLETS_DIR})` : ""),
    );
    if (PAID && ROSTER.length > 0) {
        console.log(
            `[spar] ${ROSTER.length} bots -> the fleet needs ${ROSTER.length} wallets` +
            ` (npm run fleet ${ROSTER.length})`,
        );
    }
    const counters = new Map<Behavior, number>();
    // walletIdx = position in the roster: bot-01.json goes to the first
    // bot, whatever its behavior — the fleet is behavior-agnostic
    for (let walletIdx = 0; walletIdx < ROSTER.length; walletIdx += 1) {
        const behavior = ROSTER[walletIdx];
        const slot = (counters.get(behavior) ?? 0) + 1;
        counters.set(behavior, slot);
        try {
            await run(behavior, slot, walletIdx);
        } catch (err) {
            const msg = (err as Error).message;
            console.error(`[spar:${behavior}#${slot}] failed: ${msg}`);
            // Money mode: a squadmate failing (RPC hiccup, dry wallet,
            // missing keypair) must not abort a run whose other bots
            // already paid to be here. Free mode keeps the old rule —
            // the first join failing means the setup is wrong.
            if (!PAID) fatal(msg);
        }
        // paid joins hit the RPC hard (balance + tx + confirm): give
        // the public devnet endpoint room to breathe, it 429s otherwise
        await sleep(PAID ? 1500 : 250);
    }
})();
