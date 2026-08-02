// Shared client/server contract. This package is the ONLY place where
// message names and payload shapes are defined: if the client and the
// server ever disagree on the protocol, the compiler catches it here
// instead of a runtime bug catching it in production.

// Bumped on every breaking protocol change; the server rejects clients
// that present a different version (stale browser tabs after a deploy).
// v2: SIWS authentication required to join (A3.1).
export const PROTOCOL_VERSION = 3; // 3 = A3.2: deposit-gated joins (txSig)

export * from "./siws";
export * from "./arena-chain";

// Room identifier used by the matchmaker on both sides.
export const ARENA_ROOM = "arena";

// --- Simulation constants -------------------------------------------
// Shared because the client will PREDICT its own movement (A1.5) with
// the exact same numbers the server simulates with. Units are "per
// 60fps frame", inherited from the proto so every value keeps meaning.
export const WORLD_RADIUS = 3000;
export const SNAKE_SPEED = 4;
export const SNAKE_BOOST_SPEED = 8;
export const SNAKE_TURN_SPEED = 0.08; // rad per frame
export const SNAKE_RADIUS = 12;

// Body growth (ported from the proto, A0.3): score is the single
// source of truth, the body is a pure function of it. Clients need
// these too — they rebuild bodies locally from the synced head.
export const SNAKE_BASE_LENGTH = 40;   // tracer count at score 0
export const SNAKE_SPACING = 10;       // px between tracers
export const GROWTH_LENGTH_PER_SCORE = 0.3;
export const GROWTH_RADIUS_FACTOR = 0.02;
// Base spawn = ZERO score (user rule, 2026-07-24): score is a capital
// EARNED by playing — base size, no sprint until you have eaten at
// least one orb. Only a higher buy-in (0.25/0.50/1 SOL, ported with
// the economy/menu) will purchase a bigger spawn score.
export const SPAWN_SCORE = 0;

// Ambient food (proto A0.3 playtest values). Score-only for now: the
// economy (worth, FoodReserve) is ported later — ARENA-1 has no money.
export const FOOD_COUNT = 2200;
export const FOOD_RADIUS = 5;
export const FOOD_VALUE = 1;           // score gained per pellet
export const FOOD_EAT_RANGE = 25;      // magnet reach beyond body radius

// Death (proto A0.4 values). The corpse seeds the arena: the kill IS
// the loot. Economy split (70/30) comes with the economy port.
// (grace lives below the timing block: it is measured in server ticks)
export const DEATH_ORB_VALUE = 5;      // score per corpse orb

// Boost drain (proto A0.3 playtest values): sprinting burns score in
// ORB QUANTA — what the snake loses exists in the world as eatable
// orbs at its tail. Below one orb of score, the sprint cuts off.
export const SNAKE_BOOST_COST = 0.25;  // score per 60fps frame
export const BOOST_ORB_VALUE = 1.5;    // orb size dropped at the tail

// Area of Interest (A1.8): each client is only subscribed to entities
// inside this bubble around its head. Per-client cost becomes
// independent of world size — and clients never even RECEIVE distant
// state, which makes maphacks physically impossible (a must for a
// real-money game).
export const AOI_RADIUS = 1200;

// Anti-concentration rule (user, 2026-07-24 — the proto's A0.7/D71
// spirit): whenever value is RELEASED (death corpse OR sprint drain),
// each orb has this probability of scattering to a random map spot
// instead of dropping in place. Keeps the ambient supply alive and
// spreads wealth away from where it was lost. Exact conservation:
// whole orbs are routed, never split.
export const RECYCLE_RATIO = 0.3;

// --- Timing (A1.3) --------------------------------------------------
// The simulation advances by FIXED quanta: same inputs -> same outputs
// no matter the server load. Deterministic by construction — the whole
// "depends on the framerate" bug class (proto's vanishing body) cannot
// exist. Broadcast rate is a SEPARATE knob: simulation precision and
// network bandwidth are tuned independently.
export const SERVER_TICK_RATE = 30;              // simulation steps per second
export const BROADCAST_RATE = 20;                // state patches per second
export const TICK_DT = 60 / SERVER_TICK_RATE;    // "60fps frames" per tick — CONSTANT
export const SPAWN_GRACE_TICKS = SERVER_TICK_RATE * 3; // 3s intangible after spawn
// Disconnect rule (user, 2026-07-24): a disconnected snake freezes,
// gray and HARMLESS (out of the collision world entirely), and turns
// into corpse orbs where it stood after this window. Long enough to
// survive a network blip, short enough that rage-quitting is never a
// strategy — the money always returns to the arena.
export const DISCONNECT_TTL_TICKS = SERVER_TICK_RATE * 5; // 5s then corpse

// --- Messages -------------------------------------------------------

// What the client presents when joining a room (menu screen data).
export interface JoinOptions {
    protocol: number;
    name: string;
    stake: number; // SOL tier chosen in the menu; 0 = free play
    // A3.2 — signature of the on-chain join (deposit) transaction.
    // Required when stake > 0: the server reads the tx back from the
    // chain and verifies it before letting the snake spawn. Like the
    // SIWS token, this is a CLAIM until the server checks it.
    txSig?: string;
}

// Menu tiers (SOL). FREE plays with zero value; in production free
// play lives on a SEPARATE server (A0.7bis: free-riders = bot faucet).
export const STAKE_TIERS_SOL = [0, 0.1, 0.25, 0.5, 1];

// The server's answer to GET /round: which round the arena is
// currently playing on. The client builds its deposit tx from this —
// it never hardcodes round coordinates.
export interface RoundInfoResponse {
    roundId: string;   // u64 as decimal string (JS numbers lose precision)
    treasury: string;  // base58 — must match round.treasury (has_one)
}

// The ONLY thing a client is ever allowed to send during play:
// its intent. Never a position, never a score, never a kill.
export interface InputMessage {
    angle: number;  // desired heading, radians
    boost: boolean; // sprint intent
}

// --- Shared math ----------------------------------------------------
// Lives here (not server-only) because client-side prediction (A1.5)
// must run the EXACT same steering math or the simulations diverge.

export interface SnakeDims {
    length: number;    // tracer count
    radius: number;    // px per segment
    turnSpeed: number; // rad per frame
}

// Ported from the proto (A0.3): sqrt growth = fast early, diminishing
// later; bigger snake = slower turning (the weight feel, and the
// balance lever against big buy-ins).
export function describeSnakeFromScore(score: number): SnakeDims {
    const growth = Math.sqrt(score);
    const radius = SNAKE_RADIUS * (1 + growth * GROWTH_RADIUS_FACTOR);
    return {
        length: Math.round(SNAKE_BASE_LENGTH + score * GROWTH_LENGTH_PER_SCORE),
        radius,
        turnSpeed: SNAKE_TURN_SPEED * Math.sqrt(SNAKE_RADIUS / radius),
    };
}

// Turns `angle` toward `target` by at most `maxStep` per call: the
// snake cannot turn around instantly (the slither feel).
export function turnTowards(angle: number, target: number, maxStep: number): number {
    let diff = target - angle;
    // wrap into [-PI, PI], otherwise we would turn 350 degrees the
    // wrong way instead of -10
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (diff > maxStep) diff = maxStep;
    if (diff < -maxStep) diff = -maxStep;
    return angle + diff;
}
