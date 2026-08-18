// Shared client/server contract. This package is the ONLY place where
// message names and payload shapes are defined: if the client and the
// server ever disagree on the protocol, the compiler catches it here
// instead of a runtime bug catching it in production.

// Bumped on every breaking protocol change; the server rejects clients
// that present a different version (stale browser tabs after a deploy).
// v2: SIWS authentication required to join (A3.1).
// 7 = players are AoI-filtered (A4.6c): a client no longer receives
// the whole roster, only what its bubble can see. Not an additive
// change — an older client would silently believe the world is empty.
// 8 = the "died" message names the killer (A4.6d).
// 9 = AoI body seeding + no-boost-while-graced (A4.6f): the server now
// sends a one-shot "body" message on bubble entry, and boost prediction
// must gate on graced — an old client renders phantom-hitbox worlds.
export const PROTOCOL_VERSION = 9;

export * from "./siws";
export * from "./arena-chain";

// Room identifier used by the matchmaker on both sides.
export const ARENA_ROOM = "arena";
// D72/D76 — the free demo: a SEPARATE room, fully off-chain, bots
// only, no wallet required. A paying player never meets a demo one.
export const DEMO_ROOM = "demo";
// A4.2a — the FREE matchmaking queue in front of the paid arena
// (D77). SIWS identity required, zero money: nobody deposits before
// a match is all but certain. NOT a security gate — the arena's real
// door stays the verified deposit.
export const LOBBY_ROOM = "lobby";
export const DEMO_SPAWN_SCORE = 30;   // tutorial snake, mid-size feel
export const DEMO_FOOD_COUNT = 800;   // abundant FAKE food (learning space)
export const DEMO_BOT_COUNT = 6;      // same population as the proto

// --- Simulation constants -------------------------------------------
// Shared because the client will PREDICT its own movement (A1.5) with
// the exact same numbers the server simulates with. Units are "per
// 60fps frame", inherited from the proto so every value keeps meaning.
// A4.10: shrunk 3000 -> 1400 for the low-population beta. A 3000 disc is
// sized for a ~500-player portal; at 4-8 players nobody ever crosses paths
// (AoI ~1200px = you see ~1/5 of the width). Smaller map packs players AND
// deposit-backed pellets denser per screen WITHOUT minting value (same
// pellets, less area). Later: make this a function of live population.
export const WORLD_RADIUS = 1400;
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
// A4.10: softened 0.25 -> 0.08 for the beta. At 0.25 (15 score/s) sprint
// felt too expensive to ever use, so movement stayed slow. This is a FEEL
// knob, not an economy change: what's burned is dropped as eatable orbs at
// the tail (BOOST_ORB_VALUE), so the value stays in the world.
export const SNAKE_BOOST_COST = 0.08;  // score per 60fps frame
export const BOOST_ORB_VALUE = 1.5;    // orb size dropped at the tail

// AF.3bis (2026-08-17) — THE REFERENCE VIEWPORT, in WORLD units: how
// much of the world a player may see, whatever their screen or browser
// zoom. Before this existed the renderer mapped 1 world unit to 1 CSS
// pixel, so the field of view was whatever the window happened to be —
// and Ctrl+- literally bought map awareness in a real-money PvP game
// (user report: a friend on a zoomed-out window saw the ENTIRE arena).
//
// The client scales the world by max(w/W, h/H) — "cover" — so nobody
// ever sees more than this in EITHER dimension; an unusual aspect ratio
// sees LESS, never more. 1920x1080 is chosen to preserve the current
// feel: it is exactly what the most common screen already shows at 100%
// zoom, so this closes the exploit without changing how the game plays.
export const REFERENCE_VIEW_W = 1920;
export const REFERENCE_VIEW_H = 1080;
// The furthest a player can see from their own head: the screen corner.
// ~1101 units at the reference viewport.
export const REFERENCE_VIEW_CORNER = Math.hypot(REFERENCE_VIEW_W / 2, REFERENCE_VIEW_H / 2);

// Area of Interest (A1.8): each client is only subscribed to entities
// inside this bubble around its head. Per-client cost becomes
// independent of world size — and clients never even RECEIVE distant
// state, which makes maphacks physically impossible (a must for a
// real-money game).
//
// ⚠ INVARIANT — AOI_RADIUS >= REFERENCE_VIEW_CORNER (~1101), or honest
// players get POP-IN: snakes materialising at the edge of a screen that
// was already showing that spot. The margin above the corner is what
// lets a body enter view before it can reach you.
//
// ⚠ AND KEEP IT TIGHT. This bubble is the ONLY bound a MODIFIED client
// cannot escape (the scale clamp above lives in the browser; an attacker
// patches it). Every unit above the corner distance is map awareness
// handed to a cheater. Do NOT raise it "for comfort".
//
// HISTORY (why this comment is long): the old note here claimed the AoI
// showed "~1/5 of the width". True at WORLD_RADIUS 3000 — A4.10 shrank
// the map to 1400 and nobody revisited this, so the bubble silently grew
// to 86% of the world. It is correctly sized for the viewport above; the
// weak fog of war is now a property of the SMALL MAP, not of this value.
// Shrinking the fog further means a tighter reference viewport (a feel
// change) or a bigger map (undoing A4.10) — a gameplay call, not a
// constant to quietly nudge.
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
// 1.5s intangible after spawn (2026-08-06, was 3s): spawn protection
// is mostly the guaranteed clearance around a fresh spawn, not the
// timer — and every extra graced second is flight time for a
// translucent snake charging someone (the "charging ghost" report).
export const SPAWN_GRACE_TICKS = Math.round(SERVER_TICK_RATE * 1.5);
// Disconnect rule (user, 2026-08-06 — replaces the 2026-07-24 frozen-
// carrion window): disconnecting IS dying, instantly. The corpse drops
// where the snake stood, so rage-quitting hands your value to the
// field instead of freezing you out of danger. A genuine network blip
// costs the run — the assumed price of making the exploit impossible.

// A snake that has NEVER received an input from its client does not
// move at all (2026-08-03 bug: a crashed client's snake auto-marched
// its 0.5 SOL stake into the lethal border). Past this window the
// client is kicked — the anti rage-quit rule then settles the snake
// on the spot (corpse in a live room, refund behind the launch gate).
export const FIRST_INPUT_TTL_TICKS = SERVER_TICK_RATE * 30; // 30s to wake up

// --- Launch gate (A4.2a / D77) --------------------------------------
// A paid arena never goes LIVE with fewer than 2 verified deposits: a
// lone player under the D73 economy is a guaranteed loss (their own
// stake minus rake) — the worst possible first experience. While
// "waiting", snakes are held where they spawned, grace and first-input
// timers are frozen and the extract machine is off. The gate exists at
// LAUNCH only: once live, a lone survivor keeps playing.
export const MIN_LIVE_PLAYERS = 2;
// How long a depositor waits for a partner before being refunded
// (stake minus the on-chain rake, via the settlement outbox).
export const WAITING_TTL_TICKS = SERVER_TICK_RATE * 60; // 60s
export type ArenaPhase = "waiting" | "live";

// --- Matchmaking lobby (A4.2a / D77 + D81) --------------------------
// Two-step ready-check (D81): a FREE accept click filters the AFK
// before anyone pays; only when every member accepted does the
// deposit window open. In seconds — the lobby coordinates humans at
// 1Hz, not physics at sim rate.
export const LOBBY_ACCEPT_SECONDS = 15;  // free click window
export const LOBBY_DEPOSIT_SECONDS = 30; // D77 ready-check: sign + confirm

// A4.0 PING GATE — the RTT ceiling for REAL-MONEY entry. Above it, the
// phantom-hitbox gap (others rendered ~RTT/2 behind) grows past a snake
// radius and deaths start to feel unfair. Measured: at 200ms the gap is
// ~30-50px (multiple radii); at this 130ms it falls to ~15px (~1 radius),
// keeping the vast majority of players in while making unfair deaths
// rare. Enforced server-side on the SERVER-measured RTT (rtt.ts), never
// on the client's HUD number. The server may override via env
// (PING_GATE_MS); this shared value is the default AND the client's
// display fallback. NB: plain constant on purpose — `process.env` here
// would crash the browser bundle (no `process` in Vite).
// A4.11 (2026-08-11): raised 130 -> 300 as a LIVE TEST so the user's
// overseas friends (KL ~180ms, Bali ~200ms) can play PAID and report
// whether high-latency collisions feel unfair. The rewind's fairness at
// this latency is NOT yet validated — this test IS the measurement
// (A4.11.b). Revert / retune once the feedback is in.
export const PING_GATE_MS = 300;
// What a lobby member is doing right now (synced on LobbyPlayer).
export type LobbyStatus = "queued" | "accepting" | "depositing";

// --- Extract points (A0.6 rules, ported to the authoritative server) --
// All durations in 60fps FRAMES (the proto's time unit — the server
// tick advances by TICK_DT frames, so these transpose unchanged).
export const EXTRACT_RADIUS = 200;         // px, zone radius (A4.10: 130 -> 200, easier to hold)
export const EXTRACT_SPAWN_COOLDOWN = 600; // ~10s between extract points
export const EXTRACT_TTL = 2400;           // ~40s: the zone's full lifetime
export const EXTRACT_WARNING_FRAMES = 180; // last 3s: bomb blink, then it KILLS
export const EXTRACT_CHANNEL_FRAMES = 720; // 12s of channeling to cash out (A4.10: 4s -> 12s, riskier)

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
    // AF.1 — which round this deposit funded, taken from the SAME
    // GET /round response the tx was built from (never re-fetched: a
    // rotation between the deposit and the join would send the player
    // to a room of the wrong round).
    //
    // Its job here is ROUTING, not authority: the matchmaker filters
    // rooms on it so one room only ever hosts one round. The server
    // still reads the true round out of the transaction and refuses the
    // join if the two disagree — a lie only gets you bounced.
    roundId?: string;
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

// Server -> client, once, when YOUR channel completes: your value has
// left the arena and become a settlement claim. Amount/nonce as
// STRINGS (u64 territory). The payout itself lands later (A3.3).
export interface ExtractedMessage {
    score: number;    // what left the arena, in game units
    lamports: string; // score converted at SCORE_PER_SOL — the claim
    nonce: string;    // unique per round: the on-chain anti-replay key
}

// Server -> client, once, when YOUR snake dies (border, collision,
// zone detonation). In the paid arena death is GAME OVER: no auto-
// respawn (D72 — playing again = depositing again). The lamports are
// what your corpse left on the field — the "moins-value".
// How a run ended. The server knows it at the exact moment it sends
// "died"; before A4.6d the answer only existed in a server log line,
// so the player had to read a terminal to learn what just happened.
export type DeathKind =
    | "border"    // ran into the world edge
    | "collision" // ran into someone's body
    | "head-on"   // both heads met in the same tick: both died
    | "disconnect" // the socket closed: instant death (anti rage-quit).
                   // Sent into the void — that client is gone — but the
                   // kind keeps logs and future killfeeds honest.
    | "bomb"      // still inside the extract zone when it expired
    | "drain"     // AF.1(f) backstop: still playing an escrow round long
                  // after its deadline, through two warnings. The run
                  // ends as a death (corpse -> round economy -> swept to
                  // the FoodReserve) because paying survivors out at a
                  // round boundary would be a risk-free cash-out.
    | "unknown";

// Server -> everyone already in a PAID arena, when someone spawns in:
// the lobby drain can drop an opponent into a survivor's room with no
// warning (user report 2026-08-06). Name + spawn value, never the
// wallet (A3.1). The demo stays silent (bot respawn spam).
export interface JoinedMessage {
    name: string;
    lamports: string; // RAW stake (gross buy-in, pre rake/pellet cut)
}

export interface DiedMessage {
    score: number;    // value lost, in game units
    lamports: string; // same, in lamports (display: what it was worth)
    kind: DeathKind;
    killedBy?: string; // killer's display NAME (never the wallet), when
                       // there is one — absent for border and bomb
}

// Server -> client, once, if the launch gate gives up (no partner
// within WAITING_TTL_TICKS, or you left while still waiting): your
// deposit comes back as a settlement claim on the SAME rails as an
// extraction. The on-chain rake taken at join is the one part a
// refund cannot recover (D77: documented edge case).
// AF.1 — server -> every client in a room whose escrow round is past
// its deadline. Rounds are normally INVISIBLE to players (joins route
// themselves, nobody is ever pulled out of a live run), so this is the
// one moment the boundary has to be shown: the room WILL close, and a
// snake still on the field when it does dies. Two of these are sent
// before the backstop fires.
export interface CycleNoticeMessage {
    secondsLeft: number;
}

export interface RefundedMessage {
    lamports: string; // the claim: spawn + pellet value, in lamports
    nonce: string;    // unique per round: the on-chain anti-replay key
}

// --- Lobby messages (A4.2a) -----------------------------------------
// Client -> server: "accept" and "decline", no payload (D81 clicks).

// Server -> client: a match formed — click ACCEPT (free) within
// `seconds` or be dropped from the lobby.
export interface MatchFoundMessage {
    seconds: number;
}
// Server -> client: everyone accepted (or a joinable arena already
// exists — solo fast-path, no partner to coordinate): deposit and
// join the arena within `seconds`. The lobby marks you fulfilled when
// your VERIFIED deposit spawns (server truth, reported by the arena),
// never on a client claim.
export interface DepositNowMessage {
    seconds: number;
}
// Server -> client: your pending match dissolved. requeued=true — you
// are back at the HEAD of the queue at zero cost (D77: a partner's
// desertion never costs the innocent anything). requeued=false — you
// were the deserter (decline, AFK, or no deposit): rejoin to play.
export interface MatchCancelledMessage {
    requeued: boolean;
    reason: string;
}
// Server -> client (A4.0): refused entry to real-money play because the
// SERVER-measured RTT is above the ceiling. Not a desertion — no strike,
// no penalty. The player can still play FREE; the numbers let the UI
// explain exactly why and by how much.
export interface PingTooHighMessage {
    rttMs: number;  // this player's measured round-trip
    limitMs: number; // the ceiling they exceeded (PING_GATE_MS or env)
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
