import { Room, type Client, type Deferred } from "colyseus";
import { ArraySchema, Schema, MapSchema, StateView, type, view } from "@colyseus/schema";
import {
    AOI_RADIUS,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    DEATH_ORB_VALUE,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    PROTOCOL_VERSION,
    RECYCLE_RATIO,
    SPAWN_GRACE_TICKS,
    SERVER_TICK_RATE,
    DISCONNECT_TTL_TICKS,
    FIRST_INPUT_TTL_TICKS,
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_SPAWN_COOLDOWN,
    EXTRACT_TTL,
    SNAKE_BOOST_COST,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    TICK_DT,
    WORLD_RADIUS,
    describeSnakeFromScore,
    turnTowards,
    lamportsFromScore,
    type DiedMessage,
    type ExtractedMessage,
    type InputMessage,
    type JoinOptions,
} from "@nimbo/shared";
import { SpatialGrid } from "../grid";
import { verifyAuthToken } from "../auth";
import { releaseDeposit, verifyDeposit } from "../chain";
import { pendingClaims, recordClaim } from "../outbox";

// What onAuth hands to onJoin once the SIWS proof checks out.
export interface AuthResult {
    wallet: string; // base58 address, the on-chain identity (A3.2+)
    // A3.2 — bought by the verified on-chain deposit, computed in
    // onAuth from the TX BYTES, never from options. pelletScore is
    // materialized on the map at join (D73/D75).
    spawnScore: number;
    pelletScore: number;
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
    // Disconnect rule (A1.9): a disconnected snake freezes, gray and
    // HARMLESS — out of the collision world entirely — then turns
    // into corpse orbs after DISCONNECT_TTL_TICKS. Synced so clients
    // can render it grayed out.
    @type("boolean") connected = true;
    // The ONE exception to "never sync bodies": a frozen body cannot
    // be regrown by observing head movement (there is none), so late
    // joiners would see a bare head over a very real hitbox. Filled
    // once at disconnect (flattened x,y pairs), cleared on return —
    // costs zero bytes while everyone is connected.
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
    disconnectTicks = 0; // countdown to corpse while disconnected
    // 2026-08-03 blind-client bug: until the FIRST input arrives the
    // snake is held completely (no movement, grace frozen) — a snake
    // only ever moves under its player's control.
    hasInput = false;
    noInputTicks = 0;
    desiredAngle = 0;
    wantsBoost = false;
    graceTicks = SPAWN_GRACE_TICKS;
    boostDebt = 0; // score burned by boosting, not yet dropped as an orb
    // The body lives here for collisions (A1.7bis.d) but is NEVER
    // synced: head + score is enough, every client regrows the body
    // locally (the A1.4 bandwidth decision). A 400-segment snake
    // costs the same wire bytes as a dot.
    tracers: { x: number; y: number }[] = [];
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
}

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
    // Players stay globally synced: 16 heads are cheap, and the
    // minimap will need them. Food is the volume — @view() takes it
    // out of global broadcast: each client only receives the pellets
    // its StateView subscribed to (its AoI bubble).
    @type({ map: Player }) players = new MapSchema<Player>();
    @view() @type({ map: Food }) food = new MapSchema<Food>();
    @type(ExtractZone) extract = new ExtractZone();
}


export class ArenaRoom extends Room<{ state: ArenaState }> {
    state = new ArenaState();
    maxClients = 16;

    // Whitelist of accepted client messages: anything not listed here
    // is dropped.
    messages = {
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
    // Pending reconnection windows (A1.9), held so the tick can
    // cancel them when the disconnect TTL expires
    private pendingReconnections = new Map<string, Deferred<Client>>();

    // --- extraction (A0.6 state machine, multiplayer flavor) --------
    private extractCooldown = EXTRACT_SPAWN_COOLDOWN;
    // Nonce = boot-time ms * 1000 + counter: unique per round even
    // across restarts (two boots in the same millisecond don't happen;
    // 1000 extractions in one ms don't either).
    private nextNonce = BigInt(Date.now()) * 1000n;

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

    private updateViews() {
        for (const client of this.clients) {
            const player = this.state.players.get(client.sessionId);
            if (!player || !client.view) continue;
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

    // One simulation step. dt is CONSTANT (TICK_DT "60fps frames", the
    // proto's time unit, so every constant keeps its meaning) — never
    // derived from wall-clock time.
    tick() {
        const dt = TICK_DT;
        // disconnected snakes whose window expired this tick — never
        // delete from a map while iterating it
        const expired: Player[] = [];
        this.state.players.forEach((player) => {
            // A1.9 disconnect rule: a disconnected snake is FROZEN
            // and harmless — no steering, no movement, no eating, no
            // collisions. The TICK is the single authority on its
            // fate: when the window runs out, it becomes corpse orbs
            // where it stood (its score returns to the arena).
            if (!player.connected) {
                player.disconnectTicks -= 1;
                if (player.disconnectTicks <= 0) expired.push(player);
                return;
            }

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

            // spawn grace counts down in server ticks
            if (player.graceTicks > 0) {
                player.graceTicks -= 1;
                if (player.graceTicks <= 0) player.graced = false;
            }

            // boost gating + drain (proto A0.3): sprinting burns score
            // in ORB QUANTA — the debt accumulates continuously, and
            // every full orb of debt leaves the snake as an eatable
            // orb at the tail. Nothing evaporates. Below one orb of
            // score, the sprint cuts off.
            const boosting = player.wantsBoost && player.score >= BOOST_ORB_VALUE;
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
        });

        expired.forEach((player) => this.expireDisconnected(player));

        // --- collision phase (ported from the proto, A0.4) ----------
        // Rebuild the segment grid from scratch: bodies moved, every
        // cell key is stale. Heads are inserted too — that makes
        // head-to-head = double death fall out for free.
        this.segmentGrid.clear();
        let maxRadius = 0;
        this.state.players.forEach((player) => {
            if (player.graced) return; // intangible: kills nothing
            if (!player.connected) return; // frozen: harmless (A1.9)
            const radius = describeSnakeFromScore(player.score).radius;
            if (radius > maxRadius) maxRadius = radius;
            this.segmentGrid.insert({ x: player.x, y: player.y, radius, owner: player });
            for (const t of player.tracers) {
                this.segmentGrid.insert({ x: t.x, y: t.y, radius, owner: player });
            }
        });

        const deaths = new Set<Player>();
        this.state.players.forEach((player) => {
            if (player.graced) return; // intangible: cannot die
            if (!player.connected) return; // frozen: immobile, only
                                           // the TTL can end it (A1.9)
            const radius = describeSnakeFromScore(player.score).radius;
            // lethal border
            if (Math.hypot(player.x, player.y) > WORLD_RADIUS - radius) {
                deaths.add(player);
                return;
            }
            // head vs enemy segments; crossing yourself is legal
            for (const seg of this.segmentGrid.queryNear(player.x, player.y, radius + maxRadius)) {
                if (seg.owner === player) continue;
                const dx = seg.x - player.x;
                const dy = seg.y - player.y;
                const reach = radius + seg.radius;
                if (dx * dx + dy * dy < reach * reach) {
                    deaths.add(player);
                    break;
                }
            }
        });
        deaths.forEach((player) => this.resolveDeath(player));

        this.extractTick(dt);

        // AoI refresh, decimated: every N ticks, not every tick
        this.aoiCounter += 1;
        if (this.aoiCounter >= ArenaRoom.AOI_UPDATE_TICKS) {
            this.aoiCounter = 0;
            this.updateViews();
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
            victims.forEach((p) => this.resolveDeath(p));
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
        const nonce = this.nextNonce++;
        this.extractedScore += player.score; // ledger: left the arena
        // A3.3 — the debt is written to DISK before the player hears
        // about it: a crash after this line owes correctly, a crash
        // before it never told the player they extracted.
        recordClaim({
            wallet: player.wallet,
            lamports: lamports.toString(),
            nonce: nonce.toString(),
            at: Date.now(),
        });

        const msg: ExtractedMessage = {
            score: player.score,
            lamports: lamports.toString(),
            nonce: nonce.toString(),
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("extracted", msg);

        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
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

    // A1.9: the disconnect window ran out — the frozen snake becomes
    // corpse orbs where it stood (strict conservation: its score
    // returns to the arena) and the player is removed for good. Only
    // the TICK calls this: the simulation is the single authority on
    // death, the reconnection window just follows (manual reject).
    private expireDisconnected(player: Player) {
        this.dropCorpse(player);
        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.pendingReconnections.get(player.sessionId)?.reject(new Error("disconnect window expired"));
        console.log(`[expired] ${player.sessionId} — corpse dropped`);
    }

    // D72 — in the paid arena, death is GAME OVER: the corpse drops
    // (value stays on the field, strict conservation) and the player
    // LEAVES the room. No auto-respawn — playing again = depositing
    // again. The client shows the loss and returns to the menu.
    protected resolveDeath(player: Player) {
        this.dropCorpse(player);

        const msg: DiedMessage = {
            score: player.score,
            lamports: lamportsFromScore(player.score).toString(),
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("died", msg);

        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        console.log(
            `[death] ${player.sessionId} — ${player.score.toFixed(1)} score left on the field`,
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
            throw new Error("deposit verification failed");
        }
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
        player.name = options.name || "anonymous";
        // A3.2 — variable buy-in is real: the verified deposit bought
        // this starting score
        player.score = auth.spawnScore;

        // D73/D75 — materialize this deposit's pellet cut, map-wide:
        // whole pellets scattered, sub-pellet remainder onto the
        // snake itself (exact conservation, same rule as corpse dust)
        let pellets = auth.pelletScore;
        while (pellets >= FOOD_VALUE) {
            this.scatterRandom(FOOD_VALUE);
            pellets -= FOOD_VALUE;
        }
        player.score += pellets;
        this.injectedScore += auth.spawnScore + auth.pelletScore;
        // random spawn inside half the world radius
        const spawnAngle = Math.random() * 2 * Math.PI;
        const spawnDist = Math.random() * WORLD_RADIUS * 0.5;
        player.x = Math.cos(spawnAngle) * spawnDist;
        player.y = Math.sin(spawnAngle) * spawnDist;
        // tracers start empty: the grow loop in tick() unfolds the
        // body from the spawn point over the first seconds
        this.state.players.set(client.sessionId, player);
        // AoI: this client only ever receives what its view contains
        client.view = new StateView();
        console.log(
            `[join] ${client.sessionId} name=${player.name}` +
            ` wallet=${auth.wallet.slice(0, 4)}..${auth.wallet.slice(-4)} stake=${options.stake}`,
        );
    }

    // A1.9: disconnection freezes the snake — gray, harmless, out of
    // the collision world — and arms a countdown IN THE SIMULATION
    // (disconnectTicks). Come back before it runs out (network blip)
    // and you resume; otherwise the tick turns the snake into corpse
    // orbs and rejects this window ("manual" mode: no second timer
    // that could disagree with the simulation).
    async onLeave(client: Client) {
        const player = this.state.players.get(client.sessionId);
        if (!player) return;

        player.connected = false;
        player.wantsBoost = false; // stale intent must not survive
        player.disconnectTicks = DISCONNECT_TTL_TICKS;
        // one-shot body snapshot for late joiners (see Player field)
        for (const t of player.tracers) {
            player.frozenBody.push(t.x, t.y);
        }
        console.log(`[leave] ${client.sessionId} — ${DISCONNECT_TTL_TICKS} ticks to reconnect`);

        try {
            // resolves with the NEW client if the player comes back
            // in time; rejected by expireDisconnected() otherwise
            const reconnection = this.allowReconnection(client, "manual");
            this.pendingReconnections.set(client.sessionId, reconnection);
            const newClient = await reconnection;
            player.connected = true;
            player.frozenBody.clear(); // moving again: back to local regrow
            // the returning socket is brand new: fresh AoI view, and
            // clearing inView makes the next diff resubscribe the
            // whole bubble
            newClient.view = new StateView();
            this.inView.delete(client.sessionId);
            console.log(`[rejoin] ${client.sessionId}`);
        } catch {
            // the simulation already resolved this snake's fate
            // (corpse + removal in expireDisconnected) — nothing to do
            console.log(`[gone] ${client.sessionId}`);
        } finally {
            this.pendingReconnections.delete(client.sessionId);
        }
    }

    onDispose() {
        console.log("[room] disposed (empty)");
    }
}
