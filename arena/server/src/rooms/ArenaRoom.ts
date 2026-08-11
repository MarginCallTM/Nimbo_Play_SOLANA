import { Room, type Client } from "colyseus";
import { ArraySchema, Schema, MapSchema, StateView, type, view } from "@colyseus/schema";
import {
    AOI_RADIUS,
    ARENA_ROOM,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    DEATH_ORB_VALUE,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    PROTOCOL_VERSION,
    RECYCLE_RATIO,
    SPAWN_GRACE_TICKS,
    SERVER_TICK_RATE,
    FIRST_INPUT_TTL_TICKS,
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_SPAWN_COOLDOWN,
    EXTRACT_TTL,
    MIN_LIVE_PLAYERS,
    WAITING_TTL_TICKS,
    SNAKE_BOOST_COST,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    TICK_DT,
    WORLD_RADIUS,
    describeSnakeFromScore,
    turnTowards,
    lamportsFromScore,
    MIN_REFUNDABLE_LAMPORTS,
    type ArenaPhase,
    type DeathKind,
    type DiedMessage,
    type ExtractedMessage,
    type InputMessage,
    type JoinedMessage,
    type JoinOptions,
    type RefundedMessage,
} from "@nimbo/shared";
import { SpatialGrid } from "../grid";
import { verifyAuthToken } from "../auth";
import { DepositRejected, releaseDeposit, roundInfo, verifyDeposit } from "../chain";
import { nextNonce, pendingClaims, recordClaim } from "../outbox";
import { notifyDepositorJoined, registerArenaRoom, unregisterArenaRoom } from "../arena-registry";
import { RttTracker } from "../rtt";

// What onAuth hands to onJoin once the SIWS proof checks out.
export interface AuthResult {
    wallet: string; // base58 address, the on-chain identity (A3.2+)
    // A3.2 — bought by the verified on-chain deposit, computed in
    // onAuth from the TX BYTES, never from options. pelletScore is
    // materialized on the map at join (D73/D75).
    spawnScore: number;
    pelletScore: number;
    // the RAW stake decoded from the tx bytes (before rake + pellet
    // cut) — what the join feed announces. Absent in the demo.
    stakeLamports?: string;
    // kept so a failed onJoin can release the consumed signature
    txSig?: string;
}

export class Player extends Schema {
    // --- synced fields: what every client needs to render ---
    @type("string") name = "";
    @type("float32") x = 0;      // float32: half the bandwidth of the
    @type("float32") y = 0;      // default float64, plenty of precision
    @type("float32") angle = 0;
    @type("boolean") boosting = false;
    @type("float32") score = 0;  // the single source of truth: body
                                 // size derives from it on BOTH sides
    // Epoch marker: bumped on every respawn. A respawn is a TELEPORT —
    // when gen changes, clients must throw away everything that
    // assumes continuous motion (interp buffers, prediction, bodies).
    @type("uint8") gen = 0;
    @type("boolean") graced = true; // synced for translucent rendering
    // DEAD since 2026-08-06 (anti rage-quit: disconnect = instant
    // death, no frozen-snake state anymore). Kept only to avoid a
    // protocol bump mid-playtest — remove both, plus the client's
    // gray-rendering path, at the next PROTOCOL_VERSION change.
    @type("boolean") connected = true;
    @type(["float32"]) frozenBody = new ArraySchema<number>();

    // Extraction channel progress, in frames (0..EXTRACT_CHANNEL_
    // FRAMES). Synced ON PURPOSE: a channeling snake is announcing
    // "my value is about to leave" — everyone seeing the bar climb is
    // the kill window the design promises (A0.6).
    @type("float32") channel = 0;

    // --- NOT decorated -> never leaves the server ---
    // The authenticated wallet (A3.1). Deliberately NOT synced: other
    // players seeing your address would enable wallet-targeted griefing
    // and deanonymization. The name is the public identity; the wallet
    // is between you, the server and the chain.
    wallet = "";
    sessionId = ""; // back-reference: lets death cleanup find the maps
    // 2026-08-03 blind-client bug: until the FIRST input arrives the
    // snake is held completely (no movement, grace frozen) — a snake
    // only ever moves under its player's control.
    hasInput = false;
    noInputTicks = 0;
    // A4.2a/D80 — the deposit's pellet cut, HELD until the room goes
    // live: materializing at join would leave orphan pellets to sweep
    // back if the launch gate times out and refunds this player.
    pendingPellets = 0;
    waitingTicks = 0; // time spent waiting behind the launch gate
    desiredAngle = 0;
    wantsBoost = false;
    graceTicks = SPAWN_GRACE_TICKS;
    // ticks spent waiting for room to materialize once the timer is up
    graceHoldTicks = 0;
    // DIAGNOSTIC (2026-08-05, user report "one-shot by a translucent
    // snake"): when this snake stopped being a ghost, and how much
    // daylight it had. A kill by a freshly materialized snake is the
    // signature of a grace exploit.
    materializedAt = 0;
    materializedClearance = 0;
    boostDebt = 0; // score burned by boosting, not yet dropped as an orb
    // The body lives here for collisions (A1.7bis.d) but is NEVER
    // synced: head + score is enough, every client regrows the body
    // locally (the A1.4 bandwidth decision). A 400-segment snake
    // costs the same wire bytes as a dot.
    tracers: { x: number; y: number }[] = [];
    // A4.0 lag-compensation rewind: a short ring of recent body snapshots
    // (head + tracers + radius), one per tick, so a lethal collision can
    // be re-checked against where the VICTIM actually saw this snake
    // (its RTT/2 ago). Server-only, never synced. Bounded by the max
    // rewind window, not by body length — cheap.
    history: { pts: { x: number; y: number }[]; radius: number }[] = [];
}

// A pellet never changes: it is born and it dies. Wire cost = one
// add + one remove per meal (~20 bytes), nothing in between.
export class Food extends Schema {
    @type("float32") x = 0;
    @type("float32") y = 0;
    @type("float32") value = FOOD_VALUE; // corpse orbs are worth more
                                         // (and drawn bigger client-side)

    // NOT synced: the server needs the map key to delete the entry;
    // clients identify pellets by their map key already
    id = "";
}

// One collision segment: a slice of a snake, tagged with its owner so
// self-crossing stays legal (proto rule).
interface Segment {
    x: number;
    y: number;
    radius: number;
    owner: Player;
    isHead: boolean; // A4.9 [death-geo]: head vs body-tracer of the killer
}

// Why a snake died — kept structured through the collision phase so
// the log can name the killer. "Who killed me?" was unanswerable
// before (2026-08-05): the death log printed a sessionId and a score.
type DeathCause =
    | { kind: "border" }
    // we ran into a live body; hit* records WHICH segment (for [death-geo])
    | { kind: "collision"; killer: Player; hitX: number; hitY: number; hitIsHead: boolean };

// What resolveDeath needs: one line for the log, and the same truth in
// the shape the client is told (A4.6d).
interface DeathInfo {
    text: string;
    kind: DeathKind;
    killedBy?: string;
    killer?: Player; // server-side only: for the grace diagnostic
}

// Shortest absolute angular difference — a snake TURNING hard has a big
// gap between where it points and where it wants to (its desiredAngle).
// The [death-geo] tell: client body reconstruction diverges most here.
function angleGap(a: number, b: number): number {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
}

function explainDeath(
    cause: DeathCause,
    victim: Player,
    deaths: Map<Player, DeathCause>,
): DeathInfo {
    if (cause.kind === "border") return { text: "border", kind: "border" };
    const name = cause.killer.name;
    const who = `${name} (${cause.killer.sessionId})`;
    // mutual = both heads met in the same tick: a genuine head-on, not
    // one player driving into the other's flank
    const theirs = deaths.get(cause.killer);
    const mutual = theirs?.kind === "collision" && theirs.killer === victim;
    return mutual
        ? { text: `head-on with ${who}`, kind: "head-on", killedBy: name, killer: cause.killer }
        : { text: `ran into ${who}`, kind: "collision", killedBy: name, killer: cause.killer };
}

// Emergence (2026-08-05) — spawn grace made offensive was a real
// exploit: a translucent snake could park inside you and materialize
// on top of you. Grace now ends only in clear space; while blocked the
// snake stays a harmless ghost, and past the hold it is moved away.
// Daylight (surface to surface) needed to materialize. 90px looked
// reasonable and was measured catastrophic on 2026-08-05: 13 of 27
// kills were landed within 2s of materializing, every one of them
// emerging at the bare threshold. A snake covers 120px/s, 240px
// boosting — 90px is a third of a second, i.e. no reaction at all.
const EMERGENCE_CLEARANCE = 300;
// A ghost that cannot find room is RELOCATED — fast. 5s of hold let a
// translucent snake hover on your screen (user report 2026-08-06);
// 1.5s keeps relocation from firing on a brief squeeze while making
// ghost-tailgating pointless.
const EMERGENCE_HOLD_TICKS = Math.round(SERVER_TICK_RATE * 1.5);
const SPAWN_CLEARANCE = 400; // px: a fresh spawn lands in open field
const SPAWN_TRIES = 24;

// A snake already in view is kept until 15% past the bubble: without
// hysteresis one pacing the boundary would flicker in and out.
const PLAYER_AOI_HYSTERESIS = 1.15;

// The single extract point (proto model: one at a time). Always
// present in the state; `active` flips its phases — cooldown (false)
// and live (true). ttl counts down in frames so every client renders
// the same bomb countdown without extra messages.
export class ExtractZone extends Schema {
    @type("boolean") active = false;
    @type("float32") x = 0;
    @type("float32") y = 0;
    @type("float32") ttl = 0;
}

export class ArenaState extends Schema {
    // A4.6c (2026-08-05) — players are AoI-filtered too. They used to
    // be global ("16 heads are cheap"), which handed every client a
    // free wallhack: the sparring bot read name/x/y/score of a player
    // 2800px away, bubble = 1200px, with no modified client at all.
    // Bandwidth was never the point of @view() here; secrecy is.
    @view() @type({ map: Player }) players = new MapSchema<Player>();
    @view() @type({ map: Food }) food = new MapSchema<Food>();
    @type(ExtractZone) extract = new ExtractZone();
    // A4.2a launch gate (D77): "waiting" until MIN_LIVE_PLAYERS
    // verified deposits are present, then "live" forever (the gate
    // exists at launch only). Synced so the client can show a
    // "waiting for opponent" screen instead of a frozen snake.
    @type("string") phase: ArenaPhase = "waiting";
}


export class ArenaRoom extends Room<{ state: ArenaState }> {
    state = new ArenaState();
    maxClients = 16;

    // Whitelist of accepted client messages: anything not listed here
    // is dropped.
    // A4.0 — server-authoritative RTT per client (protected: DemoRoom
    // inherits it, and lag-compensation rewind will read it too).
    protected rtt = new RttTracker();
    private rttCounter = 0;
    private rttLogCounter = 0;
    // A4.9 — how often the authoritative body of each in-view enemy is
    // pushed to clients. The client used to reconstruct it from head
    // motion between AoI-entry seeds (every ~333ms), and that recon
    // DIVERGES in tight turns (post-alpha "far death"). Re-syncing the
    // real tracers ~15Hz stops the divergence from ever accumulating.
    private bodyCounter = 0;
    private static readonly BODY_SYNC_TICKS = 2; // ~15Hz

    messages = {
        // A4.0 — trustworthy RTT: the client echoes our server-stamped
        // ping. The client-side ping/pong below stays for the HUD only.
        srvpong: (client: Client, t: number) => this.rtt.record(client.sessionId, t),
        input: (client: Client, input: InputMessage) => {
            const player = this.state.players.get(client.sessionId);
            if (!player) return;
            // NEVER trust the client: a hostile one can send "pwned",
            // NaN or Infinity — and NaN propagates through the whole
            // simulation. Validate every field before it touches state.
            if (typeof input?.angle !== "number" || !Number.isFinite(input.angle)) return;
            player.hasInput = true; // the pilot is alive: snake may move
            player.desiredAngle = input.angle;
            player.wantsBoost = input.boost === true;
        },
        // RTT probe (A1.7): echo the client's timestamp back so it can
        // measure how old the server state it receives really is
        ping: (client: Client, t: number) => {
            if (typeof t !== "number" || !Number.isFinite(t)) return;
            client.send("pong", t);
        },
    };

    // Fixed-timestep accumulator (A1.3): real elapsed time only
    // decides HOW MANY ticks to run; each tick advances the simulation
    // by exactly the same quantum. Deterministic: same inputs -> same
    // outputs, whatever the server load.
    private accumulator = 0;
    private static readonly STEP_MS = 1000 / SERVER_TICK_RATE;

    // A4.0 lag-compensation rewind: how many ticks of body history to
    // keep, and the hard cap on how far a collision may be rewound (a
    // fast attacker must not be "hit in the past" without bound; the
    // ping gate keeps real RTT well under this anyway).
    private static readonly HISTORY_TICKS = 12;   // ~400ms of history
    private static readonly MAX_REWIND_TICKS = 8; // cap ~265ms one-way

    // "Spiral of death" guard: after a long stall (GC pause, debugger)
    // we DROP time instead of trying to catch up with hundreds of
    // ticks — which would stall the loop further, accumulating more
    // debt, forever. The server's MAX_DT, in spirit.
    private static readonly MAX_FRAME_MS = 250;

    // Food is STATIC: inserted at birth, removed when eaten — its grid
    // is never rebuilt per tick. The SEGMENT grid is the opposite:
    // bodies move every tick, so it is cleared and refilled each tick
    // (a moved item's cell key is stale — proto lesson).
    protected foodGrid = new SpatialGrid<Food>();
    private segmentGrid = new SpatialGrid<Segment>();
    private nextFoodId = 0;

    // AoI bookkeeping: what each client's view currently contains.
    // Refreshed every AOI_UPDATE_TICKS (the bubble doesn't need 30Hz).
    protected inView = new Map<string, Set<Food>>();
    // same, for players (A4.6c: they are AoI-filtered now too)
    protected playersInView = new Map<string, Set<Player>>();
    // biggest snake radius in the collision grid this tick (query range)
    private maxSegmentRadius = 0;

    // --- extraction (A0.6 state machine, multiplayer flavor) --------
    private extractCooldown = EXTRACT_SPAWN_COOLDOWN;
    // Settlement nonces come from the OUTBOX, process-wide (2026-08-07).
    // This used to be a per-room counter seeded from Date.now(): two
    // rooms created in the same millisecond minted the same sequence,
    // and a duplicate (round_id, nonce) is a permanently unpayable
    // claim that the settlement service acks as "already settled".

    // --- conservation ledger (D73 invariant, logged as [eco]) --------
    // Everything that ever ENTERED this arena (spawn + pellet scores
    // of verified deposits) vs everything currently in it or out of
    // it. in-play + on-ground + extracted == injected, always — any
    // drift is minting or evaporation, i.e. a bug.
    protected injectedScore = 0;
    protected extractedScore = 0;
    private ecoCounter = 0;

    // A1.10 load instrumentation: tick duration is THE health metric
    // of an authoritative room. Blow the budget (STEP_MS) and the
    // accumulator falls behind — the whole game slows down for
    // everyone. Summarized every 5s.
    private tickMsSum = 0;
    private tickMsMax = 0;
    private tickCount = 0;
    private aoiCounter = 0;
    private static readonly AOI_UPDATE_TICKS = 10; // ~333ms

    // Who this client is allowed to know about. Three sources, and the
    // second one matters more than it looks: a whale's flank crossing
    // your screen while its head is 2000px away must NOT be an
    // invisible wall — so any BODY segment in the bubble reveals its
    // owner. The collision grid already indexes exactly that.
    private visiblePlayers(me: Player, prev?: Set<Player>): Set<Player> {
        const wanted = new Set<Player>([me]); // always yourself
        const addR2 = AOI_RADIUS * AOI_RADIUS;
        const keepR2 = (AOI_RADIUS * PLAYER_AOI_HYSTERESIS) ** 2;
        for (const seg of this.segmentGrid.queryNear(me.x, me.y, AOI_RADIUS)) {
            // the grid is built at the top of the tick: if its owner
            // died since, the segment points at a detached Player —
            // view.add() on one of those crashes the encoder
            if (this.state.players.get(seg.owner.sessionId) !== seg.owner) continue;
            const dx = seg.x - me.x;
            const dy = seg.y - me.y;
            if (dx * dx + dy * dy <= addR2) wanted.add(seg.owner);
        }
        this.state.players.forEach((p) => {
            // heads, with hysteresis so a snake pacing the boundary
            // does not flicker in and out. Ghosts (graced) live only
            // here: they are absent from the collision grid, and you
            // must still see someone materializing next to you.
            const dx = p.x - me.x;
            const dy = p.y - me.y;
            if (dx * dx + dy * dy <= (prev?.has(p) ? keepR2 : addR2)) wanted.add(p);
        });
        return wanted;
    }

    private updateViews() {
        for (const client of this.clients) {
            const player = this.state.players.get(client.sessionId);
            if (!player || !client.view) continue;

            // --- players (A4.6c) ---
            const prevPlayers = this.playersInView.get(client.sessionId);
            const wantedPlayers = this.visiblePlayers(player, prevPlayers);
            if (prevPlayers) {
                for (const p of prevPlayers) {
                    // the dead already left the state on their own
                    if (!wantedPlayers.has(p) && this.state.players.has(p.sessionId)) {
                        client.view.remove(p);
                    }
                }
            }
            for (const p of wantedPlayers) {
                if (prevPlayers?.has(p)) continue;
                client.view.add(p);
                // A4.6f — seed the entrant's REAL trail, one shot. The
                // client regrows bodies from observed head motion (A1.4:
                // bodies are never synced), so a snake ENTERING the
                // bubble mid-life would render bodyless while its very
                // real server trail kills — the "phantom hitbox" deaths
                // of 2026-08-06 in one sentence.
                if (p !== player && p.tracers.length > 0) {
                    const points: number[] = [];
                    for (const t of p.tracers) points.push(t.x, t.y);
                    client.send("body", { id: p.sessionId, points });
                }
            }
            this.playersInView.set(client.sessionId, wantedPlayers);

            // --- food ---
            // wanted bubble, via the same spatial grid as eating
            const wanted = new Set<Food>();
            for (const food of this.foodGrid.queryNear(player.x, player.y, AOI_RADIUS)) {
                const dx = food.x - player.x;
                const dy = food.y - player.y;
                if (dx * dx + dy * dy <= AOI_RADIUS * AOI_RADIUS) wanted.add(food);
            }
            const prev = this.inView.get(client.sessionId);
            if (prev) {
                for (const food of prev) {
                    // eaten pellets already left the state on their
                    // own; only live ones need an explicit unsubscribe
                    if (!wanted.has(food) && this.state.food.has(food.id)) {
                        client.view.remove(food);
                    }
                }
            }
            for (const food of wanted) {
                if (!prev || !prev.has(food)) client.view.add(food);
            }
            this.inView.set(client.sessionId, wanted);
        }
    }

    protected addFood(x: number, y: number, value: number) {
        const food = new Food();
        food.x = x;
        food.y = y;
        food.value = value;
        food.id = `f${this.nextFoodId++}`;
        this.state.food.set(food.id, food);
        this.foodGrid.insert(food);
    }

    // Anti-concentration (RECYCLE_RATIO): a released orb lands at a
    // random map spot instead of where it was lost — keeps the ambient
    // supply alive everywhere. One-shot like any non-ambient orb.
    protected scatterRandom(value: number) {
        const angle = Math.random() * 2 * Math.PI;
        const dist = WORLD_RADIUS * 0.95 * Math.sqrt(Math.random());
        this.addFood(Math.cos(angle) * dist, Math.sin(angle) * dist, value);
    }

    onCreate(_options: JoinOptions) {
        console.log(`[room] created — sim ${SERVER_TICK_RATE}Hz fixed, broadcast ${BROADCAST_RATE}Hz`);
        // A4.2a — visible to the lobby's matchmaking. PAID arena only:
        // the demo inherits this method but must never receive a
        // queue member (fake value, D72).
        if (this.roomName === ARENA_ROOM) {
            registerArenaRoom(this.roomId, () => ({
                phase: this.state.phase,
                connectedDepositors: this.connectedCount(),
                capacity: this.maxClients,
            }));
        }
        // D73: NO boot-time food. Every pellet on this map is backed
        // by deposited lamports — the arena starts empty and fills
        // with the players' own money.
        // Simulation rate and broadcast rate are independent knobs:
        // collision precision does not cost bandwidth, and vice versa.
        this.setPatchRate(1000 / BROADCAST_RATE);
        this.setSimulationInterval((deltaMs) => {
            this.accumulator += Math.min(deltaMs, ArenaRoom.MAX_FRAME_MS);
            while (this.accumulator >= ArenaRoom.STEP_MS) {
                this.accumulator -= ArenaRoom.STEP_MS;
                const t0 = performance.now();
                this.tick();
                const ms = performance.now() - t0;
                this.tickMsSum += ms;
                if (ms > this.tickMsMax) this.tickMsMax = ms;
                if (++this.tickCount >= SERVER_TICK_RATE * 5) {
                    const avg = (this.tickMsSum / this.tickCount).toFixed(2);
                    console.log(
                        `[perf] tick avg=${avg}ms max=${this.tickMsMax.toFixed(2)}ms` +
                        ` budget=${ArenaRoom.STEP_MS.toFixed(1)}ms` +
                        ` players=${this.state.players.size} food=${this.state.food.size}`,
                    );
                    this.tickMsSum = this.tickMsMax = this.tickCount = 0;
                }
            }
        });
    }

    // How many piloted, socket-alive depositors are in this room —
    // the lobby's matchmaking unit (frozen A1.9 snakes don't count:
    // they are on their way out, not a game you can join).
    private connectedCount(): number {
        let count = 0;
        this.state.players.forEach((p) => {
            if (p.connected) count += 1;
        });
        return count;
    }

    // One simulation step. dt is CONSTANT (TICK_DT "60fps frames", the
    // proto's time unit, so every constant keeps its meaning) — never
    // derived from wall-clock time.
    tick() {
        // A4.2a launch gate: while waiting, NOTHING simulates — snakes
        // are held where they spawned (grace and first-input timers
        // frozen), nothing can eat, die or extract. The D77 invariant
        // — never live with < MIN_LIVE_PLAYERS verified deposits — is
        // enforced by construction: this is the only path to "live".
        if (this.state.phase === "waiting") {
            this.waitingTick();
            return;
        }
        const dt = TICK_DT;
        this.state.players.forEach((player) => {
            // Never-piloted snake (2026-08-03 bug): held completely,
            // grace INCLUDED — it stays intangible where it spawned.
            // Past the TTL, kick the socket; the A1.9 path above then
            // resolves the snake by its usual rules.
            if (!player.hasInput) {
                player.noInputTicks += 1;
                if (player.noInputTicks > FIRST_INPUT_TTL_TICKS) {
                    this.clients.find((c) => c.sessionId === player.sessionId)?.leave();
                }
                return;
            }

            // spawn grace counts down in server ticks; dropping it is
            // emergenceTick's call, not the timer's — see below
            if (player.graceTicks > 0) player.graceTicks -= 1;

            // boost gating + drain (proto A0.3): sprinting burns score
            // in ORB QUANTA — the debt accumulates continuously, and
            // every full orb of debt leaves the snake as an eatable
            // orb at the tail. Nothing evaporates. Below one orb of
            // score, the sprint cuts off.
            // A ghost cannot boost (2026-08-06): grace is a shield,
            // never an engine. Boosting translucent at 240px/s was THE
            // "charging ghost" experience — and the symmetry is clean:
            // graced snakes already neither eat, kill nor die.
            const boosting =
                !player.graced && player.wantsBoost && player.score >= BOOST_ORB_VALUE;
            if (boosting) {
                player.boostDebt += SNAKE_BOOST_COST * dt;
                while (player.boostDebt >= BOOST_ORB_VALUE && player.score >= BOOST_ORB_VALUE) {
                    player.boostDebt -= BOOST_ORB_VALUE;
                    player.score -= BOOST_ORB_VALUE;
                    // 30% of drained orbs recycle map-wide (anti-
                    // concentration), the rest trail at the tail
                    if (Math.random() < RECYCLE_RATIO) {
                        this.scatterRandom(BOOST_ORB_VALUE);
                    } else {
                        const tail = player.tracers[player.tracers.length - 1] ?? player;
                        this.addFood(tail.x, tail.y, BOOST_ORB_VALUE);
                    }
                }
            }
            player.boosting = boosting; // the REAL (gated) boost state

            // body characteristics derive from the (post-drain) score
            const dims = describeSnakeFromScore(player.score);
            player.angle = turnTowards(player.angle, player.desiredAngle, dims.turnSpeed * dt);
            const speed = player.boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
            player.x += Math.cos(player.angle) * speed * dt;
            player.y += Math.sin(player.angle) * speed * dt;

            // (no border clamp anymore: the border KILLS — see the
            // collision phase below)

            // grow / shrink toward the target length: new segments
            // unfold from the tail instead of popping in
            while (player.tracers.length < dims.length) {
                const tail = player.tracers[player.tracers.length - 1] ?? { x: player.x, y: player.y };
                player.tracers.push({ x: tail.x, y: tail.y });
            }
            while (player.tracers.length > dims.length) {
                player.tracers.pop();
            }

            // eat: broad phase via the grid, narrow phase on squared
            // distance (no sqrt in the hot loop). Graced snakes
            // collect nothing (proto fairness rule).
            if (!player.graced) {
                const eatRange = dims.radius + FOOD_EAT_RANGE;
                for (const food of this.foodGrid.queryNear(player.x, player.y, eatRange)) {
                    const dx = food.x - player.x;
                    const dy = food.y - player.y;
                    if (dx * dx + dy * dy <= eatRange * eatRange) {
                        this.foodGrid.remove(food);
                        this.state.food.delete(food.id);
                        player.score += food.value;
                        // D73: NO free respawn — eaten value moved
                        // into the eater, nothing is minted. The map
                        // refills through joins, corpses and boost
                        // trails only.
                    }
                }
            }

            // follow-the-leader, PRE-UPDATE flavor (the proto's
            // collapse-bug fix): each tracer chases where its leader
            // WAS at the start of this tick, never where it just moved
            const alpha = Math.min((speed * dt) / SNAKE_SPACING, 1);
            let prevX = player.x;
            let prevY = player.y;
            for (const tracer of player.tracers) {
                const keepX = tracer.x;
                const keepY = tracer.y;
                tracer.x += (prevX - tracer.x) * alpha;
                tracer.y += (prevY - tracer.y) * alpha;
                prevX = keepX;
                prevY = keepY;
            }

            // A4.0 — snapshot this tick's body (head + tracers + radius)
            // for the lag-compensation rewind. Ring bounded by the max
            // rewind window, so memory is a few hundred KB even at scale.
            const snapPts: { x: number; y: number }[] = [{ x: player.x, y: player.y }];
            for (const t of player.tracers) snapPts.push({ x: t.x, y: t.y });
            player.history.push({ pts: snapPts, radius: dims.radius });
            if (player.history.length > ArenaRoom.HISTORY_TICKS) player.history.shift();
        });

        // --- collision phase (ported from the proto, A0.4) ----------
        // Rebuild the segment grid from scratch: bodies moved, every
        // cell key is stale. Heads are inserted too — that makes
        // head-to-head = double death fall out for free.
        this.segmentGrid.clear();
        let maxRadius = 0; // mirrored into maxSegmentRadius for emergenceGap
        this.state.players.forEach((player) => {
            if (player.graced) return; // intangible: kills nothing
            const radius = describeSnakeFromScore(player.score).radius;
            if (radius > maxRadius) maxRadius = radius;
            this.segmentGrid.insert({ x: player.x, y: player.y, radius, owner: player, isHead: true });
            for (const t of player.tracers) {
                this.segmentGrid.insert({ x: t.x, y: t.y, radius, owner: player, isHead: false });
            }
        });

        // Emergence gate: grace only ends where there is room to
        // materialize (see emergenceGap) — a ghost must never pop into
        // existence inside somebody.
        this.maxSegmentRadius = maxRadius;
        this.emergenceTick();

        const deaths = new Map<Player, DeathCause>();
        this.state.players.forEach((player) => {
            if (player.graced) return; // intangible: cannot die
            const radius = describeSnakeFromScore(player.score).radius;
            // lethal border
            if (Math.hypot(player.x, player.y) > WORLD_RADIUS - radius) {
                deaths.set(player, { kind: "border" });
                return;
            }
            // head vs enemy segments; crossing yourself is legal
            for (const seg of this.segmentGrid.queryNear(player.x, player.y, radius + maxRadius)) {
                if (seg.owner === player) continue;
                const dx = seg.x - player.x;
                const dy = seg.y - player.y;
                const reach = radius + seg.radius;
                if (dx * dx + dy * dy >= reach * reach) continue;
                deaths.set(player, {
                    kind: "collision",
                    killer: seg.owner,
                    hitX: seg.x,
                    hitY: seg.y,
                    hitIsHead: seg.isHead,
                });
                break;
            }
        });
        // A4.0 LAG-COMPENSATION REWIND — FAVOR THE VICTIM. A collision
        // death only stands if the victim ALSO saw the contact: rewind
        // the killer's body to where the victim saw it (its RTT/2 ago)
        // and re-test the victim's CURRENT head against it. No contact
        // there = a phantom hit (the killer's real body was ahead of what
        // the victim's screen showed) -> save the victim. Border deaths
        // and zero-latency / unmeasured players (bots) are never vetoed.
        // Head-on is symmetric: each rewinds the other, both may survive.
        // HEAD-ON is never vetoed. A mutual crash (A kills B and B kills
        // A in the same tick) would otherwise save whoever is laggier —
        // each "saw" the other further back — so LATENCY would win every
        // head-on (an exploit: add lag, win face-to-face). Both die.
        // Captured from the ORIGINAL deaths, before the veto mutates it.
        const headOn = new Set<Player>();
        for (const [victim, cause] of deaths) {
            if (cause.kind !== "collision" || !cause.killer) continue;
            const other = deaths.get(cause.killer);
            if (other?.kind === "collision" && other.killer === victim) headOn.add(victim);
        }
        for (const [victim, cause] of [...deaths]) {
            if (cause.kind !== "collision" || !cause.killer) continue;
            if (headOn.has(victim)) continue; // mutual crash: both die
            const rttMs = this.rtt.get(victim.sessionId);
            if (rttMs === undefined) continue; // unmeasured -> no compensation
            const rewindTicks = Math.min(
                Math.round((rttMs / 2) / ArenaRoom.STEP_MS),
                ArenaRoom.MAX_REWIND_TICKS,
            );
            if (rewindTicks <= 0) continue; // sub-tick latency: nothing to rewind
            const hist = cause.killer.history;
            const past = hist[hist.length - 1 - rewindTicks];
            if (!past) continue; // not enough history yet — leave the death
            const reach = describeSnakeFromScore(victim.score).radius + past.radius;
            const reach2 = reach * reach;
            let sawContact = false;
            for (const p of past.pts) {
                const dx = p.x - victim.x;
                const dy = p.y - victim.y;
                if (dx * dx + dy * dy < reach2) { sawContact = true; break; }
            }
            if (!sawContact) {
                deaths.delete(victim); // phantom — the victim never saw it
                console.log(
                    `[rewind] saved ${victim.sessionId.slice(0, 4)} from ` +
                    `${cause.killer.sessionId.slice(0, 4)} — rtt ${Math.round(rttMs)}ms, ` +
                    `rewound ${rewindTicks} ticks`,
                );
            }
        }

        // A4.9 [death-geo] — geometry of every REAL collision death (after
        // the veto), so the post-alpha "far death" reports get measured.
        // dist is always < reach (the detector guarantees it) — the tell is
        // rtt (low = NOT latency) and the TURN gaps (client body recon
        // diverges most in sharp turns/loops = the pretzel in the report).
        for (const [victim, cause] of deaths) {
            if (cause.kind !== "collision") continue;
            const vR = describeSnakeFromScore(victim.score).radius;
            const kR = describeSnakeFromScore(cause.killer.score).radius;
            const dist = Math.hypot(cause.hitX - victim.x, cause.hitY - victim.y);
            const rtt = this.rtt.get(victim.sessionId);
            console.log(
                `[death-geo] victim=${victim.name}[${victim.sessionId.slice(0, 4)}]` +
                ` killer=${cause.killer.name}[${cause.killer.sessionId.slice(0, 4)}]` +
                ` hit=${cause.hitIsHead ? "HEAD" : "body"} dist=${dist.toFixed(1)} reach=${(vR + kR).toFixed(1)}` +
                ` rtt=${rtt !== undefined ? Math.round(rtt) : "?"}ms` +
                ` vTurn=${angleGap(victim.angle, victim.desiredAngle).toFixed(2)}` +
                ` kTurn=${angleGap(cause.killer.angle, cause.killer.desiredAngle).toFixed(2)}`,
            );
        }

        deaths.forEach((cause, player) => {
            this.resolveDeath(player, explainDeath(cause, player, deaths));
        });

        this.extractTick(dt);

        // A4.0 — server-authoritative RTT: stamp a ping for everyone once
        // a second (echoed as srvpong). The [rtt] line every ~10s is the
        // proof the server sees each player's true latency — with the
        // client's ?lat=200 injection it should read ~200ms.
        this.rttCounter += 1;
        if (this.rttCounter >= SERVER_TICK_RATE) {
            this.rttCounter = 0;
            this.broadcast("srvping", RttTracker.stamp());
            this.rttLogCounter += 1;
            if (this.rttLogCounter >= 10) {
                this.rttLogCounter = 0;
                const rtts: string[] = [];
                this.state.players.forEach((_p, id) => {
                    const ms = this.rtt.get(id);
                    if (ms !== undefined) rtts.push(`${id.slice(0, 4)}=${Math.round(ms)}`);
                });
                if (rtts.length) console.log(`[rtt] ${rtts.join(" ")}`);
            }
        }

        // AoI refresh, decimated: every N ticks, not every tick
        this.aoiCounter += 1;
        if (this.aoiCounter >= ArenaRoom.AOI_UPDATE_TICKS) {
            this.aoiCounter = 0;
            this.updateViews();
        }

        // A4.9 — CONTINUOUS body sync (~15Hz). The client renders the
        // authoritative server tracers instead of a reconstruction that
        // drifts in tight turns/loops. Uses the same "body" message as
        // the AoI-entry seed; the client already resets to it on receipt,
        // so the drift is bounded to BODY_SYNC_TICKS instead of the whole
        // snake's time in view. (Scale later: only NEAR snakes + decimate
        // — the collision-relevant ones — cf D85 / A4.9.)
        this.bodyCounter += 1;
        if (this.bodyCounter >= ArenaRoom.BODY_SYNC_TICKS) {
            this.bodyCounter = 0;
            for (const client of this.clients) {
                const self = this.state.players.get(client.sessionId);
                const inView = this.playersInView.get(client.sessionId);
                if (!self || !inView) continue;
                for (const p of inView) {
                    if (p === self || p.tracers.length === 0) continue;
                    const points: number[] = [];
                    for (const t of p.tracers) points.push(t.x, t.y);
                    client.send("body", { id: p.sessionId, points });
                }
            }
        }

        // [eco] conservation audit, every 10s. drift != 0 = a bug
        // minting or evaporating value somewhere (float32 sums may
        // wobble by hundredths — anything beyond that, investigate).
        this.ecoCounter += 1;
        if (this.ecoCounter >= SERVER_TICK_RATE * 10) {
            this.ecoCounter = 0;
            let inPlay = 0;
            this.state.players.forEach((p) => (inPlay += p.score));
            let onGround = 0;
            this.state.food.forEach((f) => (onGround += f.value));
            const drift = inPlay + onGround + this.extractedScore - this.injectedScore;
            console.log(
                `[eco] in-play=${inPlay.toFixed(1)} ground=${onGround.toFixed(1)}` +
                ` extracted=${this.extractedScore.toFixed(1)}` +
                ` injected=${this.injectedScore.toFixed(1)} drift=${drift.toFixed(3)}`,
            );
        }
    }

    // A4.2a — the pre-launch tick. Two jobs only: open the gate the
    // moment enough deposits are present, and refund anyone whose
    // partner never showed up. Every player in this room IS a verified
    // deposit (onAuth is the door), so the invariant reduces to a
    // head count.
    private waitingTick() {
        // leavers are refunded and removed the instant onLeave fires
        // (anti rage-quit rule), so everyone still here is present
        if (this.state.players.size >= MIN_LIVE_PLAYERS) {
            this.goLive();
            return;
        }

        const timedOut: Player[] = [];
        this.state.players.forEach((player) => {
            player.waitingTicks += 1;
            if (player.waitingTicks > WAITING_TTL_TICKS) timedOut.push(player);
        });
        timedOut.forEach((player) => this.refundPlayer(player, "no partner arrived"));
    }

    // The launch — one-way (a lone survivor later keeps playing, D77).
    // The REAL game starts here for the whole cohort: fresh spawn
    // grace, fresh first-input window, and the held pellet cuts
    // finally hit the map (D80).
    private goLive() {
        this.state.phase = "live";
        this.state.players.forEach((player) => {
            player.graceTicks = SPAWN_GRACE_TICKS;
            player.graced = true;
            player.noInputTicks = 0;
            this.materializePellets(player);
        });
        console.log(`[phase] live — ${this.state.players.size} players`);
    }

    // Distance from (x, y) to the nearest OTHER snake's surface —
    // ghosts included. Ghosts count because two of them materializing
    // on the same spot would kill each other the tick grace ends.
    private clearanceAt(x: number, y: number, self?: Player): number {
        let min = Infinity;
        this.state.players.forEach((p) => {
            if (p === self) return;
            const radius = describeSnakeFromScore(p.score).radius;
            const check = (px: number, py: number) => {
                const d = Math.hypot(px - x, py - y) - radius;
                if (d < min) min = d;
            };
            check(p.x, p.y);
            for (const t of p.tracers) check(t.x, t.y);
        });
        return min;
    }

    // A spawn point with room around it. Best-effort: in a crowded room
    // we take the roomiest candidate rather than loop forever — the
    // emergence gate below is what actually guarantees safety.
    private findClearSpawn(): { x: number; y: number } {
        let best = { x: 0, y: 0 };
        let bestClearance = -Infinity;
        for (let i = 0; i < SPAWN_TRIES; i += 1) {
            const angle = Math.random() * 2 * Math.PI;
            const dist = Math.random() * WORLD_RADIUS * 0.5;
            const point = { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
            const clearance = this.clearanceAt(point.x, point.y);
            if (clearance >= SPAWN_CLEARANCE) return point;
            if (clearance > bestClearance) {
                bestClearance = clearance;
                best = point;
            }
        }
        return best;
    }

    // The end of grace, gated on space. A snake whose timer has run out
    // stays intangible until it has daylight around it: that is what
    // makes spawn grace purely defensive. Sitting inside someone for
    // EMERGENCE_HOLD_TICKS costs the ghost its position — it is moved
    // to open field, so camping is a waste of time rather than a free
    // kill. A ghost eats nothing and kills nothing meanwhile.
    // The smallest gap between MY WHOLE BODY and anyone else's, surface
    // to surface. Symmetric on purpose: the first version measured the
    // ghost's HEAD against other bodies only, which let a ghost lay its
    // body across your path and materialize under your head — you died
    // to something you never touched.
    private emergenceGap(me: Player): number {
        const myRadius = describeSnakeFromScore(me.score).radius;
        let min = Infinity;
        const probe = (x: number, y: number) => {
            const range = EMERGENCE_CLEARANCE + myRadius + this.maxSegmentRadius;
            for (const seg of this.segmentGrid.queryNear(x, y, range)) {
                if (seg.owner === me) continue;
                const gap = Math.hypot(seg.x - x, seg.y - y) - myRadius - seg.radius;
                if (gap < min) min = gap;
            }
        };
        probe(me.x, me.y);
        for (const t of me.tracers) probe(t.x, t.y);
        // other ghosts are absent from the collision grid — heads only
        // (they just spawned, their bodies are stubs)
        this.state.players.forEach((p) => {
            if (p === me || !p.graced) return;
            const gap = Math.hypot(p.x - me.x, p.y - me.y)
                - myRadius - describeSnakeFromScore(p.score).radius;
            if (gap < min) min = gap;
        });
        return min;
    }

    private emergenceTick() {
        this.state.players.forEach((player) => {
            if (!player.graced || player.graceTicks > 0) return;
            const gap = this.emergenceGap(player);
            if (gap >= EMERGENCE_CLEARANCE) {
                player.graced = false;
                player.graceHoldTicks = 0;
                player.materializedAt = Date.now();
                player.materializedClearance = gap;
                return;
            }
            player.graceHoldTicks += 1;
            if (player.graceHoldTicks > EMERGENCE_HOLD_TICKS) {
                const spot = this.findClearSpawn();
                player.x = spot.x;
                player.y = spot.y;
                player.tracers.length = 0; // body re-unfolds from the new point
                player.graceHoldTicks = 0;
                // A relocation is a TELEPORT, and gen is how a client is
                // told to throw away everything that assumes continuous
                // motion. Without this bump it interpolates the snake
                // ACROSS the map: rendered where it is not, lethal where
                // it really is. (First in-place teleport in the code —
                // death has always been "leave the room" until now.)
                player.gen = (player.gen + 1) % 256;
                console.log(`[emerge] ${player.sessionId} was stuck inside someone — relocated`);
            }
        });
    }

    // D73/D75 — materialize a deposit's pellet cut, map-wide: whole
    // pellets scattered, sub-pellet remainder onto the snake itself
    // (exact conservation, same rule as corpse dust). Deferred to the
    // live transition (D80); a join into a live room runs it on the
    // spot. The ledger counts this value as injected only NOW — held
    // pellets are neither in play nor on the ground.
    protected materializePellets(player: Player) {
        let pellets = player.pendingPellets;
        if (pellets <= 0) return;
        this.injectedScore += pellets;
        player.pendingPellets = 0;
        while (pellets >= FOOD_VALUE) {
            this.scatterRandom(FOOD_VALUE);
            pellets -= FOOD_VALUE;
        }
        player.score += pellets;
    }

    // A4.2a — the waiting room's only exit besides launch: the deposit
    // comes back as a settlement claim on the SAME rails as an
    // extraction (outbox -> settle_extraction, anti-replay by nonce).
    // The rake was taken on-chain at join and is NOT recovered (D77:
    // documented edge case, treasury gesture possible). Ledger: the
    // spawn part entered at join and leaves now; the held pellet part
    // never entered at all.
    protected refundPlayer(player: Player, reason: string) {
        const lamports = lamportsFromScore(player.score + player.pendingPellets);
        const nonce = nextNonce();
        this.extractedScore += player.score;
        // No `?? "0"` fallback (2026-08-07): it FIRED in practice — the
        // outbox holds five rows written with roundId "0" by the demo
        // room while the server ran free-only. roundId picks the paying
        // vault, so a wrong one spends another round's pot. A paid arena
        // always has a round; without one we owe nothing on this chain.
        const round = roundInfo();
        if (round) {
            recordClaim({
                wallet: player.wallet,
                lamports: lamports.toString(),
                nonce: nonce.toString(),
                roundId: round.roundId,
                at: Date.now(),
            });
        } else {
            console.error(
                `[refund] NO ACTIVE ROUND — ${player.sessionId} removed without a claim`,
            );
        }

        const msg: RefundedMessage = {
            lamports: lamports.toString(),
            nonce: nonce.toString(),
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("refunded", msg);

        // The removal happens whatever the claim did: leaving a refunded
        // snake in the state would hold the launch gate open on a player
        // who is no longer paying for a seat.
        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.playersInView.delete(player.sessionId);
        console.log(
            `[refund] ${player.sessionId} wallet=${player.wallet.slice(0, 4)}..` +
            ` ${lamports} lamports, nonce=${nonce} (${reason})` +
            ` (outbox: ${pendingClaims().length} pending)`,
        );
    }

    // A0.6 state machine, multiplayer flavor: ONE zone at a time, but
    // EVERY eligible player runs their own channel — first to 4s wins
    // the point, everyone else resets. The channel rule stays purely
    // SPATIAL (inside = climb, outside = hard zero): having to sit 4s
    // in a circle every client renders IS the vulnerability.
    private extractTick(dt: number) {
        const zone = this.state.extract;

        // cooldown phase: nothing on the map
        if (!zone.active) {
            this.extractCooldown -= dt;
            if (this.extractCooldown <= 0) {
                // uniform over the disc, kept away from the lethal border
                const r = WORLD_RADIUS * 0.75 * Math.sqrt(Math.random());
                const a = Math.random() * 2 * Math.PI;
                zone.x = r * Math.cos(a);
                zone.y = r * Math.sin(a);
                zone.ttl = EXTRACT_TTL;
                zone.active = true;
                console.log(`[extract] zone up at (${zone.x.toFixed(0)}, ${zone.y.toFixed(0)})`);
            }
            return;
        }

        // expiry: the zone closes like a BOMB — anyone still inside
        // dies a normal death (corpse where they stood, A0.6 rule)
        zone.ttl -= dt;
        if (zone.ttl <= 0) {
            const victims: Player[] = [];
            this.state.players.forEach((p) => {
                if (p.graced || !p.connected) return;
                if (Math.hypot(p.x - zone.x, p.y - zone.y) <= EXTRACT_RADIUS) victims.push(p);
            });
            victims.forEach((p) => this.resolveDeath(p, { text: "caught by the extract bomb", kind: "bomb" }));
            this.closeZone();
            console.log(`[extract] zone detonated — ${victims.length} caught inside`);
            return;
        }

        // channel phase — winners resolved AFTER the sweep so a tie
        // inside one tick cannot double-spend the zone
        let winner: Player | undefined;
        this.state.players.forEach((player) => {
            // graced snakes collect nothing (proto fairness rule) and
            // frozen ones are out of the world entirely (A1.9)
            if (player.graced || !player.connected) {
                player.channel = 0;
                return;
            }
            const inside =
                Math.hypot(player.x - zone.x, player.y - zone.y) <= EXTRACT_RADIUS;
            if (!inside) {
                player.channel = 0;
                return;
            }
            player.channel += dt;
            if (player.channel >= EXTRACT_CHANNEL_FRAMES && !winner) {
                winner = player;
            }
        });
        if (winner) this.extractPlayer(winner);
    }

    // Cash-out: the value LEAVES the arena (no corpse — this is the
    // one exit where conservation crosses the chain boundary). The
    // score becomes a lamport claim in the settlement outbox; the
    // snake despawns; playing again = depositing again.
    protected extractPlayer(player: Player) {
        const lamports = lamportsFromScore(player.score);
        const nonce = nextNonce();
        this.extractedScore += player.score; // ledger: left the arena
        // A3.3 — the debt is written to DISK before the player hears
        // about it: a crash after this line owes correctly, a crash
        // before it never told the player they extracted.
        const round = roundInfo();
        if (round) {
            recordClaim({
                wallet: player.wallet,
                lamports: lamports.toString(),
                nonce: nonce.toString(),
                roundId: round.roundId, // never "0": see refundPlayer
                at: Date.now(),
            });
        } else {
            console.error(
                `[extract] NO ACTIVE ROUND — ${player.sessionId} left without a claim`,
            );
        }

        const msg: ExtractedMessage = {
            score: player.score,
            lamports: lamports.toString(),
            nonce: nonce.toString(),
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("extracted", msg);

        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.playersInView.delete(player.sessionId);
        this.closeZone();
        console.log(
            `[extract] ${player.sessionId} wallet=${player.wallet.slice(0, 4)}..` +
            ` score=${player.score.toFixed(1)} -> ${lamports} lamports, nonce=${nonce}` +
            ` (outbox: ${pendingClaims().length} pending)`,
        );
    }

    protected closeZone() {
        const zone = this.state.extract;
        zone.active = false;
        zone.ttl = 0;
        this.extractCooldown = EXTRACT_SPAWN_COOLDOWN;
        this.state.players.forEach((p) => (p.channel = 0));
    }

    // Corpse drop, shared by two exits: death (then respawn) and the
    // reconnection window expiring (then removal). The kill IS the
    // loot — strict conservation, nothing evaporates. The 70/30
    // economy split will live HERE.
    private dropCorpse(player: Player) {
        // corpse: score becomes big orbs spread along the body
        const orbCount = Math.floor(player.score / DEATH_ORB_VALUE);
        const tracers = player.tracers;
        // conservation fix (2026-08-03, exposed by the [eco] ledger):
        // the sub-orb remainder used to evaporate — up to 5 score per
        // death. D47: the dust goes back to the corpse.
        const remainder = player.score - orbCount * DEATH_ORB_VALUE;
        if (remainder > 0.001) {
            this.addFood(player.x, player.y, remainder);
        }
        for (let i = 0; i < orbCount; i++) {
            // 30% of corpse orbs recycle map-wide (anti-concentration:
            // a whale dying must not mint a local jackpot only)
            if (Math.random() < RECYCLE_RATIO) {
                this.scatterRandom(DEATH_ORB_VALUE);
                continue;
            }
            // walk the body from head to tail so orbs trace the corpse
            const at = tracers.length > 0
                ? tracers[Math.floor((i / orbCount) * tracers.length)]
                : player;
            // small jitter so orbs don't stack into one indistinct blob
            this.addFood(
                at.x + (Math.random() - 0.5) * 20,
                at.y + (Math.random() - 0.5) * 20,
                DEATH_ORB_VALUE,
            );
        }
    }

    // D72 — in the paid arena, death is GAME OVER: the corpse drops
    // (value stays on the field, strict conservation) and the player
    // LEAVES the room. No auto-respawn — playing again = depositing
    // again. The client shows the loss and returns to the menu.
    protected resolveDeath(
        player: Player,
        death: DeathInfo = { text: "unknown", kind: "unknown" },
    ) {
        this.dropCorpse(player);

        const msg: DiedMessage = {
            score: player.score,
            lamports: lamportsFromScore(player.score).toString(),
            kind: death.kind,
            killedBy: death.killedBy,
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("died", msg);

        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.playersInView.delete(player.sessionId);
        // DIAGNOSTIC: a kill landed by a snake that stopped being a
        // ghost less than 2s ago is the fingerprint of a grace exploit.
        // Print the age and the daylight it emerged with.
        let suspicion = "";
        const age = death.killer ? Date.now() - death.killer.materializedAt : Infinity;
        if (death.killer && death.killer.materializedAt > 0 && age < 2000) {
            suspicion =
                ` [!! killer materialized ${age}ms ago with` +
                ` ${death.killer.materializedClearance.toFixed(0)}px of clearance]`;
        }
        console.log(
            `[death] ${player.name} (${player.sessionId}) — ${death.text}` +
            ` — ${player.score.toFixed(1)} score left on the field${suspicion}`,
        );
    }

    // A3.1 — SIWS gate. STATIC (Colyseus 0.17 recommendation): runs
    // during matchmaking, before any room instance is touched. Falsy
    // return or throw = the client never reaches onJoin. The truthy
    // return value becomes client.auth / onJoin's third argument.
    // A3.2 — the deposit gate lives here too: both proofs (identity,
    // then money) are checked before any room instance is involved.
    static async onAuth(token: string, options: JoinOptions): Promise<AuthResult> {
        // EVERY cheap check runs BEFORE the deposit is consumed
        // (2026-08-03 flaw: a post-verification failure burned the
        // deposit — "deposit already used" on retry).
        if (options.protocol !== PROTOCOL_VERSION) {
            throw new Error("protocol mismatch: refresh your browser");
        }
        const wallet = verifyAuthToken(token);
        if (!wallet) throw new Error("sign-in required: connect your wallet");
        // D72 — this room is the PAID arena, full stop: no deposit,
        // no entry. Free play lives in the separate off-chain demo.
        // options.stake is DISPLAY-ONLY and options.txSig is a claim:
        // everything is derived from the verified on-chain tx alone.
        if (!options.txSig) {
            throw new Error("deposit required: this is the paid arena");
        }
        try {
            const deposit = await verifyDeposit(options.txSig, wallet);
            return { wallet, ...deposit, txSig: options.txSig } satisfies AuthResult;
        } catch (err) {
            // reason stays server-side (never help a probe); the
            // client gets a generic rejection
            console.log(`[chain] deposit rejected: ${(err as Error).message}`);
            // A4.6 (2026-08-07) — a deposit below the entry floor is a
            // real payment we refuse to seat. Refusing it AND keeping it
            // would be theft, so it goes straight back out on the D80
            // refund rails. Paid exactly once: the rejection is permanent
            // in chain.ts, so the signature stays consumed and a retry
            // never reaches this line again.
            if (err instanceof DepositRejected && err.refundableLamports !== undefined) {
                ArenaRoom.refundRejectedDeposit(wallet, err.refundableLamports);
            }
            throw new Error("deposit verification failed");
        }
    }

    // Static because onAuth is: there is no room instance yet — the
    // player never got a seat. The claim rides the same outbox rails as
    // an extraction, so the settlement service needs no new code path.
    private static refundRejectedDeposit(wallet: string, lamports: bigint) {
        const round = roundInfo();
        if (!round) return; // free-only mode never verifies a deposit
        if (lamports < MIN_REFUNDABLE_LAMPORTS) {
            // Below this, the ExtractReceipt rent + fee cost the house
            // MORE than the refund returns — which would turn dust-
            // deposit spam into a treasury drain. Kept and logged.
            console.log(
                `[chain] under-floor deposit by ${wallet.slice(0, 4)}..` +
                ` — ${lamports} lamports is below the refund threshold, kept`,
            );
            return;
        }
        const nonce = nextNonce();
        recordClaim({
            wallet,
            lamports: lamports.toString(),
            nonce: nonce.toString(),
            roundId: round.roundId,
            at: Date.now(),
        });
        console.log(
            `[chain] under-floor deposit by ${wallet.slice(0, 4)}..` +
            ` refunded ${lamports} lamports, nonce=${nonce}`,
        );
    }

    onJoin(client: Client, options: JoinOptions, auth: AuthResult) {
        try {
            this.spawnPlayer(client, options, auth);
        } catch (err) {
            // the deposit paid for a spawn that never happened: free
            // the signature so the SAME tx can buy the retry
            if (auth.txSig) releaseDeposit(auth.txSig);
            throw err;
        }
    }

    private spawnPlayer(client: Client, options: JoinOptions, auth: AuthResult) {
        // Throwing here rejects the join: stale clients bounce cleanly
        // (kept for the demo room, whose onAuth does not check it)
        if (options.protocol !== PROTOCOL_VERSION) {
            throw new Error("protocol mismatch: refresh your browser");
        }
        const player = new Player();
        player.sessionId = client.sessionId;
        player.wallet = auth.wallet; // session <-> wallet binding (A3.1)
        // Clamped: the name is client-chosen and now travels into other
        // players' end screens. Length is the part the server owes
        // everyone (the client renders with textContent, never HTML).
        player.name = String(options.name ?? "").trim().slice(0, 24) || "anonymous";
        // A3.2 — variable buy-in is real: the verified deposit bought
        // this starting score
        player.score = auth.spawnScore;

        // D73/D75/D80 — the deposit's pellet cut is HELD until the
        // room is live: a refund behind the launch gate must not have
        // orphan pellets to sweep back. Only the spawn part enters
        // the ledger now; materializePellets() injects the rest.
        player.pendingPellets = auth.pelletScore;
        this.injectedScore += auth.spawnScore;
        // spawn inside half the world radius, in the clearest spot we
        // can find: landing on top of someone is how grace turned into
        // a weapon (2026-08-05)
        const spot = this.findClearSpawn();
        player.x = spot.x;
        player.y = spot.y;
        // tracers start empty: the grow loop in tick() unfolds the
        // body from the spawn point over the first seconds
        this.state.players.set(client.sessionId, player);
        // join into a LIVE room: no gate to wait behind, the pellet
        // cut hits the map immediately (pre-D80 behavior)
        if (this.state.phase === "live") this.materializePellets(player);
        // A4.2a — tell the lobby this wallet's deposit really spawned
        // (fulfills its ready-check membership, server truth)
        if (this.roomName === ARENA_ROOM) notifyDepositorJoined(auth.wallet);
        // Join feed (user request 2026-08-06): the lobby DRAIN drops an
        // opponent into a survivor's arena with zero warning — announce
        // every entrance to everyone already in. Name + spawn value
        // only, NEVER the wallet (A3.1: the address stays between the
        // player, the server and the chain). Paid arena only: demo
        // sparring bots respawn every 2s and would flood the feed.
        if (this.roomName === ARENA_ROOM) {
            this.broadcast(
                "joined",
                {
                    name: player.name,
                    // raw stake (user call 2026-08-06): "0.1" reads
                    // better than the post-cut spawn value. Fallback
                    // covers nothing in practice (every paid join has
                    // a verified deposit).
                    lamports: auth.stakeLamports
                        ?? lamportsFromScore(player.score).toString(),
                } satisfies JoinedMessage,
                { except: client },
            );
        }
        // AoI: this client only ever receives what its view contains.
        // Seed it with its own snake — updateViews only runs every
        // AOI_UPDATE_TICKS, and until then the client would not even
        // see itself (players are @view()-filtered since A4.6c).
        client.view = new StateView();
        client.view.add(player);
        console.log(
            `[join] ${client.sessionId} name=${player.name}` +
            ` wallet=${auth.wallet.slice(0, 4)}..${auth.wallet.slice(-4)} stake=${options.stake}`,
        );
    }

    async onLeave(client: Client) {
        this.rtt.forget(client.sessionId); // before the early return below
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        // Anti rage-quit (user call, 2026-08-06 — amends A1.9): leaving
        // IS dying, on the spot. The frozen-carrion window looked fair
        // on paper but played as an invulnerability flash: killing the
        // socket froze you out of danger, and claiming the body needed
        // a physical touch within 5s. Now the corpse drops immediately
        // (strict conservation: the value returns to the field) and a
        // genuine network blip costs the run — the assumed price.
        if (this.state.phase === "waiting") {
            // behind the launch gate nothing was ever at risk — leaving
            // costs the rake, not the stake
            this.refundPlayer(player, "left while waiting");
        } else {
            this.resolveDeath(player, {
                text: "disconnected — instant death (anti rage-quit)",
                kind: "disconnect",
            });
        }
    }

    onDispose() {
        unregisterArenaRoom(this.roomId); // no-op for the demo
        console.log("[room] disposed (empty)");
    }
}
