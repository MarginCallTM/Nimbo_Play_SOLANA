// D72/D76 — the FREE demo: a tutorial arena, fully off-chain.
// Same simulation as the paid room (it IS the paid room, inherited),
// three differences only:
//   1. the door: no SIWS, no deposit — anyone can walk in;
//   2. the population: server-driven bots (steering ported from the
//      A1.10 loadtest bots) + abundant FAKE food, freely respawned;
//   3. the exits: extraction pays NOTHING (no settlement outbox) —
//      the game-over screens teach the loop, the value is fiction.
// A paying player never meets a demo one: separate room type, only
// fake value inside (D72 — free-riders can't farm what isn't real).

import {
    DEMO_BOT_COUNT,
    DEMO_FOOD_COUNT,
    DEMO_SPAWN_SCORE,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    SNAKE_BOOST_SPEED,
    SNAKE_SPEED,
    WORLD_RADIUS,
    describeSnakeFromScore,
    type ExtractedMessage,
    type JoinOptions,
    type RefundedMessage,
} from "@nimbo/shared";
import {
    ArenaRoom,
    Player,
    type AuthResult,
} from "./ArenaRoom";

const BOT_NAMES = ["nibbler", "coily", "wormy", "noodle", "slinky", "zigzag", "loopy", "twisty"];

// Sparring override (2026-08-05): DEMO_BOTS=0 empties the tutorial
// population so a human and ONE scripted sparring bot can rehearse a
// clean 1v1 (A4.6 adversarial testing). Unset = the tutorial default.
//
// A4.10 fix: EMPTY string means "default", NOT zero. The .env(.example)
// ships `DEMO_BOTS=` empty as a placeholder for "unset", but Number("")
// is 0 — which silently emptied the FREE world (the "free doesn't work"
// report). Only an EXPLICIT number (including 0 for sparring) overrides.
const rawBots = process.env.DEMO_BOTS;
const BOT_COUNT = rawBots === undefined || rawBots === "" ? DEMO_BOT_COUNT : Number(rawBots);

export class DemoRoom extends ArenaRoom {
    // Bots by sessionId, with their target commitment (the loadtest
    // lesson: re-picking "nearest pellet" every tick orbits midpoints).
    private bots = new Map<string, { targetFoodId?: string }>();
    private botCounter = 0;

    // The demo door is open: no wallet, no deposit (D76). The demo
    // snake spawns mid-size so the tutorial shows real handling.
    static override async onAuth(_token: string, _options: JoinOptions): Promise<AuthResult> {
        return {
            wallet: "demo",
            spawnScore: DEMO_SPAWN_SCORE,
            pelletScore: 0,
        } satisfies AuthResult;
    }

    override onCreate(options: JoinOptions) {
        super.onCreate(options);
        // populate BEFORE the first join: a fresh room's first player
        // arrives ahead of the first tick — without this they would
        // spawn into an empty world (and anchored spawn needs a bot)
        this.maintainBots();
        console.log(`[demo] room up — ${BOT_COUNT} bots, ${DEMO_FOOD_COUNT} fake pellets`);
    }

    // Tutorial rule (2026-08-05, after the "bots disparus" report):
    // spawn NEAR the action, never in a desert. 6 bots on a large
    // disc = a sliver of the map on screen — a random spawn lands out
    // of sight of everyone almost every time (measured: nearest bot
    // 1000-2500px away). The demo exists to SHOW the game; anchor
    // every human spawn within sight of a bot. Demo-only: in the paid
    // arena a chosen spawn point would be an information/positioning
    // edge (D72 keeps the two rooms apart).
    override onJoin(client: Parameters<ArenaRoom["onJoin"]>[0], options: JoinOptions, auth: AuthResult) {
        super.onJoin(client, options, auth);
        const player = this.state.players.get(client.sessionId);
        const anchors = [...this.bots.keys()]
            .map((id) => this.state.players.get(id))
            .filter((b): b is Player => b !== undefined);
        if (!player || anchors.length === 0) return;
        const anchor = anchors[Math.floor(Math.random() * anchors.length)];
        const a = Math.random() * 2 * Math.PI;
        const d = 400 + Math.random() * 300; // in sight, not on top
        player.x = anchor.x + Math.cos(a) * d;
        player.y = anchor.y + Math.sin(a) * d;
        // stay well inside the lethal border
        const r = Math.hypot(player.x, player.y);
        const max = WORLD_RADIUS * 0.9;
        if (r > max) {
            player.x *= max / r;
            player.y *= max / r;
        }
    }

    override tick() {
        this.maintainFood();
        this.maintainBots();
        this.steerBots();
        super.tick();
    }

    // Fake food is allowed to respawn freely here — and it is still
    // fed into the [eco] ledger as "injected", so the conservation
    // audit keeps meaning something even in the demo.
    private maintainFood() {
        let budget = 20; // per tick, so a fresh room fills in ~1.3s
        while (this.state.food.size < DEMO_FOOD_COUNT && budget-- > 0) {
            const angle = Math.random() * 2 * Math.PI;
            const dist = WORLD_RADIUS * 0.98 * Math.sqrt(Math.random());
            this.addFood(Math.cos(angle) * dist, Math.sin(angle) * dist, FOOD_VALUE);
            this.injectedScore += FOOD_VALUE;
        }
    }

    private maintainBots() {
        // dead bots vanish through resolveDeath like anyone else;
        // detect the gap and refill (churn, like the proto's bots)
        for (const id of this.bots.keys()) {
            if (!this.state.players.has(id)) this.bots.delete(id);
        }
        while (this.bots.size < BOT_COUNT) {
            const bot = new Player();
            bot.sessionId = `bot-${this.botCounter++}`;
            bot.name = BOT_NAMES[this.botCounter % BOT_NAMES.length];
            bot.score = 20 + Math.random() * 60; // proto spawn range
            const a = Math.random() * 2 * Math.PI;
            const d = Math.random() * WORLD_RADIUS * 0.7;
            bot.x = Math.cos(a) * d;
            bot.y = Math.sin(a) * d;
            bot.angle = Math.random() * 2 * Math.PI;
            bot.desiredAngle = bot.angle;
            // bots have no socket: they are their own pilot
            bot.hasInput = true;
            this.state.players.set(bot.sessionId, bot);
            this.injectedScore += bot.score;
            this.bots.set(bot.sessionId, {});
        }
    }

    // Loadtest steering (A1.10), server-side: priority ladder is
    // survive (border) > flee (nearest head) > eat (reachable pellet,
    // committed) > wander. Bots write INTENT (desiredAngle/wantsBoost)
    // exactly like a client would — the shared tick does the rest.
    private steerBots() {
        for (const [id, brain] of this.bots) {
            const me = this.state.players.get(id);
            if (!me) continue;

            const dims = describeSnakeFromScore(me.score);
            const speed = me.wantsBoost ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
            const turnRadius = speed / dims.turnSpeed;
            const eatReach = dims.radius + FOOD_EAT_RANGE;

            // nearest other head (bodies too, one day — A4.6)
            let threat: Player | undefined;
            let threatD = Infinity;
            this.state.players.forEach((p) => {
                if (p === me || p.graced) return;
                const d = (p.x - me.x) ** 2 + (p.y - me.y) ** 2;
                if (d < threatD) {
                    threatD = d;
                    threat = p;
                }
            });

            if (Math.hypot(me.x, me.y) > WORLD_RADIUS * 0.8) {
                me.desiredAngle = Math.atan2(-me.y, -me.x);
                brain.targetFoodId = undefined;
            } else if (threat && threatD < (turnRadius * 3) ** 2) {
                me.desiredAngle = Math.atan2(me.y - threat.y, me.x - threat.x);
                brain.targetFoodId = undefined;
            } else {
                // committed target, dropped only when gone/unreachable
                let target = brain.targetFoodId
                    ? this.state.food.get(brain.targetFoodId)
                    : undefined;
                if (target && !this.reachable(me, target.x, target.y, turnRadius, eatReach)) {
                    target = undefined;
                }
                if (!target) {
                    brain.targetFoodId = undefined;
                    let bestD = Infinity;
                    // perception radius mirrors the loadtest bots' AoI
                    for (const f of this.foodGrid.queryNear(me.x, me.y, 500)) {
                        if (!this.reachable(me, f.x, f.y, turnRadius, eatReach)) continue;
                        const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
                        if (d < bestD) {
                            bestD = d;
                            target = f;
                            brain.targetFoodId = f.id;
                        }
                    }
                }
                if (target) {
                    me.desiredAngle = Math.atan2(target.y - me.y, target.x - me.x);
                } else if (Math.random() < 0.05) {
                    me.desiredAngle = Math.random() * 2 * Math.PI;
                }
            }

            // occasional sprint burst (visual churn for the tutorial)
            if (me.wantsBoost) {
                if (Math.random() < 0.1) me.wantsBoost = false;
            } else if (me.score > 30 && Math.random() < 0.02) {
                me.wantsBoost = true;
            }
        }
    }

    // Turning-circle geometry (the A1.10 lesson): a point inside one
    // of the two current turning circles can never be reached by
    // steering — chasing it is an infinite orbit.
    private reachable(me: Player, fx: number, fy: number, turnRadius: number, eatReach: number): boolean {
        const lx = me.x - Math.sin(me.angle) * turnRadius;
        const ly = me.y + Math.cos(me.angle) * turnRadius;
        const rx = me.x + Math.sin(me.angle) * turnRadius;
        const ry = me.y - Math.cos(me.angle) * turnRadius;
        const margin = turnRadius - eatReach;
        return Math.hypot(fx - lx, fy - ly) > margin
            && Math.hypot(fx - rx, fy - ry) > margin;
    }

    // The refund twin of extractPlayer, and it was MISSING (found by the
    // 2026-08-07 money red-team, confirmed in the outbox file). A demo
    // player who left during the launch-gate `waiting` phase — routine
    // with DEMO_BOTS=0, i.e. the whole sparring setup — fell through to
    // ArenaRoom.refundPlayer and wrote a REAL claim: wallet "demo",
    // 0.03 SOL, against the live round. The settlement service parses
    // that wallet with Pubkey::from_str, fails, and retries the same
    // unpayable row every five seconds forever. Five such rows had been
    // poisoning the loop since 2026-08-05. Demo value is theater and
    // must never reach the debt ledger — by either exit.
    protected override refundPlayer(player: Player, reason: string) {
        this.extractedScore += player.score;
        const msg: RefundedMessage = { lamports: "0", nonce: "demo" };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("refunded", msg);
        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.playersInView.delete(player.sessionId);
        this.bots.delete(player.sessionId);
        console.log(`[demo] ${player.sessionId} refunded (fake) — ${reason}`);
    }

    // Demo extraction: same theater, zero claim. Nothing reaches the
    // settlement outbox — there is nothing real to settle.
    protected override extractPlayer(player: Player) {
        this.extractedScore += player.score;
        const msg: ExtractedMessage = {
            score: player.score,
            lamports: "0",
            nonce: "demo",
        };
        this.clients.find((c) => c.sessionId === player.sessionId)?.send("extracted", msg);
        this.state.players.delete(player.sessionId);
        this.inView.delete(player.sessionId);
        this.bots.delete(player.sessionId); // a bot can cash out too
        this.closeZone();
        console.log(`[demo] ${player.sessionId} extracted (fake) ${player.score.toFixed(1)}`);
    }
}
