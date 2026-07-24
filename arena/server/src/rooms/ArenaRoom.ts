import { Room, type Client } from "colyseus";
import { Schema, MapSchema, StateView, type, view } from "@colyseus/schema";
import {
    AOI_RADIUS,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    DEATH_ORB_VALUE,
    FOOD_COUNT,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    PROTOCOL_VERSION,
    RECYCLE_RATIO,
    SPAWN_GRACE_TICKS,
    SERVER_TICK_RATE,
    SNAKE_BOOST_COST,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SPAWN_SCORE,
    TICK_DT,
    WORLD_RADIUS,
    describeSnakeFromScore,
    turnTowards,
    type InputMessage,
    type JoinOptions,
} from "@nimbo/shared";
import { SpatialGrid } from "../grid";

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

    // --- NOT decorated -> never leaves the server ---
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

export class ArenaState extends Schema {
    // Players stay globally synced: 16 heads are cheap, and the
    // minimap will need them. Food is the volume — @view() takes it
    // out of global broadcast: each client only receives the pellets
    // its StateView subscribed to (its AoI bubble).
    @type({ map: Player }) players = new MapSchema<Player>();
    @view() @type({ map: Food }) food = new MapSchema<Food>();
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
    private foodGrid = new SpatialGrid<Food>();
    private segmentGrid = new SpatialGrid<Segment>();
    private nextFoodId = 0;

    // AoI bookkeeping: what each client's view currently contains.
    // Refreshed every AOI_UPDATE_TICKS (the bubble doesn't need 30Hz).
    private inView = new Map<string, Set<Food>>();
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

    private addFood(x: number, y: number, value: number) {
        const food = new Food();
        food.x = x;
        food.y = y;
        food.value = value;
        food.id = `f${this.nextFoodId++}`;
        this.state.food.set(food.id, food);
        this.foodGrid.insert(food);
    }

    private spawnAmbient() {
        // sqrt on the radius = uniform density over the DISC (plain
        // random would pile everything up near the center)
        const angle = Math.random() * 2 * Math.PI;
        const dist = WORLD_RADIUS * 0.98 * Math.sqrt(Math.random());
        this.addFood(Math.cos(angle) * dist, Math.sin(angle) * dist, FOOD_VALUE);
    }

    // Anti-concentration (RECYCLE_RATIO): a released orb lands at a
    // random map spot instead of where it was lost — keeps the ambient
    // supply alive everywhere. One-shot like any non-ambient orb.
    private scatterRandom(value: number) {
        const angle = Math.random() * 2 * Math.PI;
        const dist = WORLD_RADIUS * 0.95 * Math.sqrt(Math.random());
        this.addFood(Math.cos(angle) * dist, Math.sin(angle) * dist, value);
    }

    onCreate(_options: JoinOptions) {
        console.log(`[room] created — sim ${SERVER_TICK_RATE}Hz fixed, broadcast ${BROADCAST_RATE}Hz`);
        for (let i = 0; i < FOOD_COUNT; i++) this.spawnAmbient();
        // Simulation rate and broadcast rate are independent knobs:
        // collision precision does not cost bandwidth, and vice versa.
        this.setPatchRate(1000 / BROADCAST_RATE);
        this.setSimulationInterval((deltaMs) => {
            this.accumulator += Math.min(deltaMs, ArenaRoom.MAX_FRAME_MS);
            while (this.accumulator >= ArenaRoom.STEP_MS) {
                this.accumulator -= ArenaRoom.STEP_MS;
                this.tick();
            }
        });
    }

    // One simulation step. dt is CONSTANT (TICK_DT "60fps frames", the
    // proto's time unit, so every constant keeps its meaning) — never
    // derived from wall-clock time.
    tick() {
        const dt = TICK_DT;
        this.state.players.forEach((player) => {
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
                        // only ambient pellets respawn elsewhere;
                        // corpse orbs are one-shot loot
                        if (food.value === FOOD_VALUE) this.spawnAmbient();
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

        // --- collision phase (ported from the proto, A0.4) ----------
        // Rebuild the segment grid from scratch: bodies moved, every
        // cell key is stale. Heads are inserted too — that makes
        // head-to-head = double death fall out for free.
        this.segmentGrid.clear();
        let maxRadius = 0;
        this.state.players.forEach((player) => {
            if (player.graced) return; // intangible: kills nothing
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

        // AoI refresh, decimated: every N ticks, not every tick
        this.aoiCounter += 1;
        if (this.aoiCounter >= ArenaRoom.AOI_UPDATE_TICKS) {
            this.aoiCounter = 0;
            this.updateViews();
        }
    }

    // Death resolution: the corpse seeds the arena (the kill IS the
    // loot — strict conservation, nothing evaporates), then the player
    // restarts small. The 70/30 economy split will live HERE.
    private resolveDeath(player: Player) {
        // corpse: score becomes big orbs spread along the body
        const orbCount = Math.floor(player.score / DEATH_ORB_VALUE);
        const tracers = player.tracers;
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

        // respawn fresh ("repay to respawn" arrives with the economy)
        player.score = SPAWN_SCORE;
        player.tracers = [];
        const angle = Math.random() * 2 * Math.PI;
        const dist = Math.random() * WORLD_RADIUS * 0.5;
        player.x = Math.cos(angle) * dist;
        player.y = Math.sin(angle) * dist;
        player.angle = Math.random() * 2 * Math.PI;
        player.desiredAngle = player.angle;
        player.graceTicks = SPAWN_GRACE_TICKS;
        player.graced = true;

        // epoch bump: tells every client "this was a teleport, reset
        // your continuity assumptions". uint8 wraps at 256 — equality
        // comparison only, never ordering.
        player.gen = (player.gen + 1) % 256;
    }

    onJoin(client: Client, options: JoinOptions) {
        // Throwing here rejects the join: stale clients bounce cleanly
        if (options.protocol !== PROTOCOL_VERSION) {
            throw new Error("protocol mismatch: refresh your browser");
        }
        const player = new Player();
        player.name = options.name || "anonymous";
        player.score = SPAWN_SCORE; // fixed for now; variable buy-in later
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
        console.log(`[join] ${client.sessionId} name=${player.name} stake=${options.stake}`);
    }

    onLeave(client: Client) {
        this.state.players.delete(client.sessionId);
        this.inView.delete(client.sessionId);
        console.log(`[leave] ${client.sessionId}`);
    }

    onDispose() {
        console.log("[room] disposed (empty)");
    }
}
