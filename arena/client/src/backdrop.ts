// The living menu backdrop: a small, self-contained simulation of snakes
// going about their business behind the launch screen.
//
// WHY IT IS LOCAL AND NOT THE REAL DEMO ROOM. The obvious design was to
// spectate the running DemoRoom — it would be authentically the game. It
// was rejected for three reasons, in order:
//
//   1. Every visitor idling on the menu would hold a socket and receive
//      state at 30Hz. On a showcase site, people who look without playing
//      are the majority, and today they cost nothing.
//   2. Spectating needs a server-side view anchor: `updateViews()` filters
//      state per PLAYER (`if (!player || !client.view) continue`), so a
//      client without a snake sees an empty world. That is real server
//      work on the room that also handles money.
//   3. The one that settles it: a backdrop wired to a room is a backdrop
//      that COULD one day be pointed at the paid arena — free
//      reconnaissance of where the big snakes are before staking, i.e.
//      the map hack A1.8 exists to prevent. With no room to point at, that
//      mistake becomes structurally impossible.
//
// It also means the menu stays alive when the game server is down, which
// on a portfolio site is worth more than authenticity.
//
// It draws through GameView exactly like a real session: same hex floor,
// same shaded segments, same eyes, same skins. The backdrop is not an
// imitation of the game's look — it IS the game's renderer.

import {
    SKINS,
    SNAKE_RADIUS,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SNAKE_TURN_SPEED,
    turnTowards,
} from "@nimbo/shared";
import { GameView, colorsFromSkin } from "./render";

// How far from the centre the snakes are allowed to roam. The visible
// half-diagonal at the reference viewport is ~1101 units, so 900 keeps
// them inside the frame while still letting them drift near its edges —
// a full picture, without a hard wall the eye can spot.
const ROAM_RADIUS = 900;
const PELLET_COUNT = 90;
const PELLET_SPREAD = 1000;

// HARD CEILING on the pellet field, and this is the real fix rather than
// the periodic reset below.
//
// Ambient pellets self-regulate: one is only respawned while the field
// sits under its baseline. Corpse loot does NOT — a death adds 14 to 28
// pellets unconditionally. So if snakes die faster than the scavengers
// eat, the count climbs with no bound at all. The cap makes that
// impossible instead of merely unlikely: past the ceiling, the OLDEST
// pellet makes way for the new one (a Map iterates in insertion order,
// so the oldest is simply the first key).
const PELLET_MAX = PELLET_COUNT * 3;

// Full reset every three minutes (user call).
//
// With the ceiling above, nothing is known to drift any more — this is a
// safety net for what we have NOT thought of. A backdrop runs unattended
// for as long as a tab stays open, which is exactly the regime where a
// slow accumulation nobody predicted turns into a mess nobody witnesses.
//
// Cheap to make graceful: snakes already re-enter from off-screen, so a
// reset reads as the scene starting over rather than as a glitch.
const RESET_INTERVAL_MS = 3 * 60 * 1000;

// Hard-coded cast, rather than sizes derived from a score.
//
// WHY NOT SCORES. The first version ran scores from 60 to 900, which the
// shared curve turns into 58 to 310 tracers — and 310 tracers is 3100
// units of body inside a window ~1130 units wide. Each snake wrapped the
// frame nearly three times: not an arena, a plate of spaghetti. Bodies
// overlapping is LEGAL in this game (the server tests head-vs-segment
// only, `ArenaRoom` collision phase: "crossing yourself is legal"), so
// nothing was actually wrong — it was simply unreadable.
//
// Lengths now sit between 37% and 75% of the visible width, so a whole
// snake fits on screen and the eye can follow one.
//
// Radius is chosen directly instead of through a score because the two
// are welded together in the real curve: a visibly thicker snake would
// also have to be far longer. A backdrop needs the thickness variety
// without the length that comes with it.
//
// Deliberately no giants: the bigger a snake, the slower it turns (the
// turn-speed formula below), and a sluggish snake in a crowded frame is
// exactly what makes avoidance fail.
//
// `scavenger` gives a snake one extra drive: it hunts CORPSE loot across
// the whole arena instead of grazing on whatever happens to be nearby.
// Two of the seven have it, deliberately — the contrast is the point. A
// scavenger crossing the frame towards a fresh kill reads as intent,
// where seven identical wanderers read as a screensaver.
const CAST: { radius: number; length: number; scavenger?: boolean }[] = [
    { radius: 11, length: 42, scavenger: true },
    { radius: 13, length: 55 },
    { radius: 15, length: 70, scavenger: true },
    { radius: 17, length: 60 },
    { radius: 19, length: 85 },
    { radius: 12, length: 48, scavenger: true },
    { radius: 16, length: 75 },
];

// How far a scavenger will travel for loot. Effectively the whole roam
// area: the behaviour only means something if it crosses the frame.
const SCAVENGE_RANGE = 1400;
// Loot is scored by the SIZE OF THE PILE around it, not by raw distance:
// this radius is what counts as "around". A corpse trail drops a pellet
// every 3 tracers, i.e. every 30 units, so 160 gathers a good stretch of
// one trail without merging two separate kills into one phantom target.
const CLUSTER_RADIUS = 160;
// Distance still matters, it just stops being the only thing. Score is
// cluster size divided by (1 + distance / this), so a pile twice as big
// is worth travelling roughly this much further for.
const DISTANCE_WEIGHT = 500;

// The game's own agility law, applied to a chosen radius: bigger turns
// slower. Keeping this relationship is what makes the backdrop move like
// the game rather than like a screensaver.
function turnSpeedFor(radius: number): number {
    return SNAKE_TURN_SPEED * Math.sqrt(SNAKE_RADIUS / radius);
}

// Wander steering. A snake picks a heading and keeps it for a while, so
// the motion reads as intent rather than as noise — the same reason the
// server's bots commit to a target instead of re-deciding every tick.
const WANDER_MIN_MS = 900;
const WANDER_MAX_MS = 2600;

// Avoidance. The backdrop was showing snakes passing THROUGH each other,
// which is the exact opposite of the one rule the game is built on.
//
// Solved by steering, not by collisions. Killing them would have shown
// clumsiness — a snake vanishing and respawning behind a menu reads as a
// glitch, and every death would thin out the density. Steering shows the
// opposite: snakes that read each other and slip past. The game sells
// skill, so the backdrop should show skill.
//
// It is never perfect, and that is the point. Turn rate comes from
// `s.turnSpeed`, which the shared curve penalises with size, so big
// snakes swerve heavily and small ones dart. Near-misses come out of that
// for free — tension without a single death.
//
// HOW FAR AHEAD TO LOOK, and the first version got this wrong in a way
// worth writing down: it probed at 3.2x the BODY radius, a number picked
// by eye. The quantity that actually governs avoidance is the TURN
// RADIUS — speed / turnSpeed — which has nothing to do with thickness.
//
// Measured: a snake needs 48 to 63 units just to complete a 90 degree
// turn, so it must see an obstacle at 70 to 101 units. The old probe
// reached 35 to 61. Snakes were not being careless; they were physically
// unable to avoid what they saw that late, and heads went through bodies.
//
// 1.8 turn radii puts detection at 97 to 132 units — enough to start the
// turn, complete it, and clear the obstacle.
const LOOK_AHEAD_TURNS = 1.8;
// How close a foreign segment has to be, on top of both radii, before the
// swerve starts.
const CLEARANCE = 26;
// The probe is a RAY, not a point. A single point ahead of the head was
// blind to anything arriving from the side — the second reason the old
// version let heads slide into bodies. Five samples from the head out to
// the full reach cover the whole path.
const PROBE_STEPS = 5;

// DEATH, added after steering alone proved insufficient. Better probing
// cut the collisions down but could not make them impossible: two snakes
// can corner each other, which is exactly why the server's own bots die
// and get replaced rather than avoiding forever.
//
// The point is not the drama. It is that the backdrop must never show an
// IMPOSSIBLE state. A head resting inside a body contradicts the one rule
// the whole game is built on, and a visitor who plays five minutes later
// will have been taught something false. With death in place there are
// only two outcomes on screen, and both are true: the snake avoids, or
// the rule applies.
//
// The kill test mirrors `ArenaRoom`'s collision phase exactly: this
// snake's HEAD against foreign segments, never body against body — which
// stays legal here as it is in the game.
//
// Sampled finer than the avoidance probe: this one decides life and
// death, so a head must not be able to slip between two tested points.
const KILL_SAMPLING = 2;
// A corpse becomes food, as it does in the arena. One pellet every few
// tracers reads as a trail without flooding the field.
const CORPSE_PELLET_EVERY = 3;
const RESPAWN_MIN_MS = 600;
const RESPAWN_MAX_MS = 1600;
// Respawns happen on the RIM, never in the middle of the frame.
//
// Measured: the window shows 1477 x 831 units, so anything past 738 from
// the centre is already off-screen at the sides. Spawning in the
// 765..900 ring therefore puts a snake OUT OF SIGHT, and it walks into
// the frame instead of appearing inside it.
//
// The reason is not only aesthetic. Respawning mid-frame dropped a snake
// into the busiest part of the arena, where the traffic is — which
// caused pile-ups and the chain deaths the rim avoids entirely.
const SPAWN_RIM = 0.85;
// A fresh snake heads roughly inward, with spread. Aimed randomly it
// would often walk straight back out and bounce off the roam boundary,
// which reads as indecision rather than as an entrance.
const SPAWN_INWARD_SPREAD = 0.9; // radians either side of "towards centre"
// Spawn protection, mirroring the real thing: a fresh snake is
// translucent, cannot kill and cannot die. Without it a respawn could
// materialise inside someone and die instantly, forever.
const GRACE_MS = 1400;
// Only every Nth tracer is tested. They sit SNAKE_SPACING apart while a
// body is at least 24 units wide, so sampling one in four still cannot
// miss a body — it just costs four times less.
const BODY_SAMPLING = 4;

interface BackdropSnake {
    id: string;
    skinIndex: number;
    radius: number;
    length: number;
    turnSpeed: number;
    x: number;
    y: number;
    angle: number;
    desiredAngle: number;
    nextTurnAt: number;
    body: { x: number; y: number }[];
    // 0 while alive; otherwise the moment this snake comes back
    respawnAt: number;
    // when it last spawned, for the grace fade (see GRACE_MS)
    bornAt: number;
    // AV: scavengers hunt corpse loat across the arena; the others graze
    scavenger: boolean;
    // The loot currently being chased. Held until it is eaten rather than
    // re-picked every frame — the server's own bots carry the same note:
    // re-deciding "nearest pellet" every tick makes a bot orbit the
    // midpoint between two of them instead of reaching either.
    targetId?: string;
}

function rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

export interface Backdrop {
    stop(): void;
}

export function startBackdrop(view: GameView): Backdrop {
    const snakes: BackdropSnake[] = [];
    // `corpse` is what a scavenger hunts: loot dropped by a death, as
    // opposed to the ambient food that is always lying around.
    const pellets = new Map<string, { x: number; y: number; corpse: boolean }>();
    let pelletSeq = 0;

    const addPellet = (x: number, y: number, corpse = false) => {
        // make room first: the oldest pellet goes, so the field can never
        // grow past the ceiling however many corpses pile up
        while (pellets.size >= PELLET_MAX) {
            const oldest = pellets.keys().next().value;
            if (oldest === undefined) break;
            pellets.delete(oldest);
            view.removeFood(oldest);
        }
        const id = `bd-food-${pelletSeq++}`;
        pellets.set(id, { x, y, corpse });
        // value > FOOD_VALUE renders as a golden orb: corpse loot already
        // looks different from ambient food in the real game, so the
        // backdrop inherits that reading for free.
        view.addFood(id, x, y, corpse ? 3 : 1, corpse);
    };

    const spawnPellet = () => {
        const a = Math.random() * Math.PI * 2;
        const d = PELLET_SPREAD * Math.sqrt(Math.random());
        addPellet(Math.cos(a) * d, Math.sin(a) * d);
    };

    CAST.forEach((cast, i) => {
        snakes.push({
            id: `bd-snake-${i}`,
            // one skin each, walked in order: the backdrop doubles as a
            // showcase of what a player can pick in the menu behind it
            skinIndex: i % SKINS.length,
            radius: cast.radius,
            length: cast.length,
            turnSpeed: turnSpeedFor(cast.radius),
            x: 0,
            y: 0,
            angle: 0,
            desiredAngle: 0,
            nextTurnAt: 0,
            body: [],
            respawnAt: 0,
            bornAt: 0,
            scavenger: cast.scavenger === true,
        });
    });

    // The closest OTHER snake's segment to where `s` is heading, or
    // undefined when the way is clear. Heads are included: a head is the
    // first segment of a body, and it is the part that moves towards you.
    const nearestForeignSegment = (
        s: BackdropSnake,
        radius: number,
    ): { x: number; y: number } | undefined => {
        // Reach derived from the TURN RADIUS, not from the body: a snake
        // must see far enough to have room to turn, and how far that is
        // depends on how fast it turns.
        const reach = LOOK_AHEAD_TURNS * (SNAKE_SPEED / s.turnSpeed) + radius;
        const cos = Math.cos(s.angle);
        const sin = Math.sin(s.angle);
        let best: { x: number; y: number } | undefined;
        let bestD = Infinity;

        for (const other of snakes) {
            if (other === s) continue;
            const danger = radius + other.radius + CLEARANCE;
            const danger2 = danger * danger;

            // The head is its own segment, and it is the part coming
            // towards us — test it first, then the sampled body.
            const targets: { x: number; y: number }[] = [other];
            for (let i = 0; i < other.body.length; i += BODY_SAMPLING) {
                targets.push(other.body[i]);
            }

            for (const t of targets) {
                // Distance from the segment to the PATH, not to one point:
                // walk the ray and keep the closest approach. This is what
                // catches a body drifting in from the side.
                for (let step = 0; step <= PROBE_STEPS; step++) {
                    const along = (step / PROBE_STEPS) * reach;
                    const dx = t.x - (s.x + cos * along);
                    const dy = t.y - (s.y + sin * along);
                    const d = dx * dx + dy * dy;
                    if (d < danger2 && d < bestD) {
                        bestD = d;
                        best = t;
                    }
                }
            }
        }
        return best;
    };

    // The kill rule, copied from the server's collision phase: this
    // snake's HEAD against foreign SEGMENTS. Body against body is not
    // tested, because in this game it is not lethal.
    const isKilled = (s: BackdropSnake, now: number): boolean => {
        if (now - s.bornAt < GRACE_MS) return false; // intangible while grace lasts
        for (const other of snakes) {
            if (other === s || other.respawnAt > 0) continue;
            if (now - other.bornAt < GRACE_MS) continue; // a ghost kills nobody
            const reach = s.radius + other.radius;
            const reach2 = reach * reach;
            if ((other.x - s.x) ** 2 + (other.y - s.y) ** 2 < reach2) return true;
            for (let i = 0; i < other.body.length; i += KILL_SAMPLING) {
                const seg = other.body[i];
                if ((seg.x - s.x) ** 2 + (seg.y - s.y) ** 2 < reach2) return true;
            }
        }
        return false;
    };

    // A corpse turns into food, exactly as it does in the arena — which
    // is also what keeps a death from simply subtracting from the scene.
    const kill = (s: BackdropSnake, now: number) => {
        for (let i = 0; i < s.body.length; i += CORPSE_PELLET_EVERY) {
            addPellet(s.body[i].x, s.body[i].y, true);
        }
        view.removeSnake(s.id);
        s.body = [];
        s.respawnAt = now + rand(RESPAWN_MIN_MS, RESPAWN_MAX_MS);
    };

    // Come back somewhere with room. Ten tries then take what we get:
    // grace covers the rest, and an infinite search on a crowded frame
    // would be a worse bug than a tight spawn.
    // Put a snake on the rim, facing in. Shared by the opening cast and
    // by every respawn, deliberately: two spawn paths would drift apart,
    // and the whole point is that a snake is NEVER seen materialising.
    const placeAtRim = (s: BackdropSnake, now: number, bearing: number) => {
        const d = rand(ROAM_RADIUS * SPAWN_RIM, ROAM_RADIUS);
        s.x = Math.cos(bearing) * d;
        s.y = Math.sin(bearing) * d;
        // face the centre, give or take: it enters the arena rather than
        // hovering on the boundary
        s.angle = bearing + Math.PI + rand(-SPAWN_INWARD_SPREAD, SPAWN_INWARD_SPREAD);
        s.desiredAngle = s.angle;
        s.body = [];
        s.nextTurnAt = 0;
        s.respawnAt = 0;
        s.bornAt = now;
        s.targetId = undefined; // the loot it was chasing is a life ago
    };

    const respawn = (s: BackdropSnake, now: number) => {
        let bearing = Math.random() * Math.PI * 2;
        for (let attempt = 0; attempt < 10; attempt++) {
            bearing = Math.random() * Math.PI * 2;
            const d = ROAM_RADIUS * SPAWN_RIM;
            const x = Math.cos(bearing) * d;
            const y = Math.sin(bearing) * d;
            const clear = snakes.every((o) => {
                if (o === s || o.respawnAt > 0) return true;
                const need = (s.radius + o.radius + 90) ** 2;
                if ((o.x - x) ** 2 + (o.y - y) ** 2 < need) return false;
                return o.body.every((seg) => (seg.x - x) ** 2 + (seg.y - y) ** 2 >= need);
            });
            if (clear) break;
        }
        placeAtRim(s, now, bearing);
    };

    // The opening cast enters from the rim too, so a hard refresh never
    // shows snakes popping into an empty frame. Bearings are spread
    // evenly around the circle rather than drawn at random: seven random
    // angles cluster often, and a whole cast arriving from one side reads
    // as a glitch. They walk in from all around, and the frame fills in
    // about a second.
    // Seed (or re-seed) the whole scene. Boot and the periodic reset go
    // through this same function on purpose: two paths would drift apart,
    // and the invariant to hold — snakes are never SEEN appearing — has
    // to survive both.
    const seedScene = (now: number) => {
        for (const id of [...pellets.keys()]) view.removeFood(id);
        pellets.clear();
        for (const s of snakes) {
            view.removeSnake(s.id);
            s.targetId = undefined;
        }
        for (let i = 0; i < PELLET_COUNT; i++) spawnPellet();
        snakes.forEach((s, i) => {
            const spread = (i / snakes.length) * Math.PI * 2;
            placeAtRim(s, now, spread + rand(-0.35, 0.35));
        });
    };

    seedScene(performance.now());
    let nextResetAt = performance.now() + RESET_INTERVAL_MS;

    // Loot for a scavenger: keep the current target while it exists,
    // otherwise take the nearest corpse pellet in range. Returns undefined
    // when there is nothing to scavenge, which drops the snake back into
    // ordinary grazing.
    //
    // COMMITMENT is the whole trick. Re-picking "nearest" every frame
    // makes a snake orbit the midpoint between two pellets instead of
    // reaching either — the exact failure the server's bots carry a
    // comment about. Holding the target until it is eaten is what turns
    // the behaviour into a visible decision.
    // A point is UNREACHABLE when it sits inside one of the two circles
    // the snake would trace by turning as hard as it can, left or right.
    // From there no steering can ever touch it: the snake orbits at
    // exactly its turn radius, forever — which is precisely the snake
    // seen looping around a single pellet it could not catch.
    //
    // This is the geometric root of that bug, so it is tested both when
    // choosing a target AND every frame afterwards: a target can become
    // unreachable as the snake turns, long after it was picked.
    const unreachable = (s: BackdropSnake, tx: number, ty: number): boolean => {
        const r = SNAKE_SPEED / s.turnSpeed;
        const nx = -Math.sin(s.angle);
        const ny = Math.cos(s.angle);
        for (const side of [1, -1]) {
            const cx = s.x + nx * side * r;
            const cy = s.y + ny * side * r;
            if ((tx - cx) ** 2 + (ty - cy) ** 2 < r * r) return true;
        }
        return false;
    };

    // Pick the best PILE, not the nearest pellet.
    //
    // Nearest-pellet targeting has two failures, and the user hit the
    // second one on screen. First, it ignores value: a lone crumb next to
    // a whole corpse wins simply by being closer. Second, a lone crumb is
    // exactly the kind of target that ends up inside the turn radius,
    // where it becomes an orbit rather than a meal.
    //
    // Scoring by cluster size fixes the first and largely avoids the
    // second, since a pile is big enough that some of it is always
    // reachable. `unreachable` handles the rest.
    const keepOrPickLoot = (s: BackdropSnake): string | undefined => {
        const held = s.targetId ? pellets.get(s.targetId) : undefined;
        if (held && !unreachable(s, held.x, held.y)) return s.targetId;

        const loot = [...pellets.entries()].filter(([, p]) => p.corpse);
        let bestId: string | undefined;
        let bestScore = 0;
        for (const [id, p] of loot) {
            const d2 = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
            if (d2 > SCAVENGE_RANGE * SCAVENGE_RANGE) continue;
            if (unreachable(s, p.x, p.y)) continue;
            let cluster = 0;
            for (const [, q] of loot) {
                if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 <= CLUSTER_RADIUS * CLUSTER_RADIUS) {
                    cluster++;
                }
            }
            const score = cluster / (1 + Math.sqrt(d2) / DISTANCE_WEIGHT);
            if (score > bestScore) {
                bestScore = score;
                bestId = id;
            }
        }
        return bestId;
    };

    const tick = (ticker: { deltaTime: number }) => {
        // dtFrames, clamped exactly as the real session does: a tab
        // returning from the background must not teleport everyone
        const dt = Math.min(ticker.deltaTime, 3);
        const now = performance.now();

        // The camera never moves. That is the whole design: a fixed
        // window onto the arena, so nothing behind the menu can slide,
        // drift or swim — the failure mode that made the floor nauseating
        // when the camera chased a jittering prediction (AV.3e).
        view.camera(0, 0);

        if (now >= nextResetAt) {
            seedScene(now);
            nextResetAt = now + RESET_INTERVAL_MS;
            return; // nothing to simulate on the frame everything moved
        }

        for (const s of snakes) {
            if (s.respawnAt > 0) {
                if (now >= s.respawnAt) respawn(s, now);
                continue;
            }

            // Priority ladder, the same one the server's bots use:
            // survive > avoid > eat > wander. The first two are checked
            // EVERY frame because danger will not wait for the wander
            // timer; the last two only when that timer expires, so a
            // snake commits to a heading instead of twitching.

            // 1. the border wins over everything: aim back inside well
            //    before reaching it, so the turn looks deliberate
            const distFromCentre = Math.hypot(s.x, s.y);
            const threat = nearestForeignSegment(s, s.radius);
            if (distFromCentre > ROAM_RADIUS) {
                s.desiredAngle = Math.atan2(-s.y, -s.x) + rand(-0.5, 0.5);
                s.nextTurnAt = now + rand(WANDER_MIN_MS, WANDER_MAX_MS);
            } else if (threat) {
                // 2. swerve PERPENDICULAR to the threat, away from the
                //    side it sits on — never a U-turn. Turning your back
                //    on a body keeps you next to it for longer; sliding
                //    past is both safer and what a good player does.
                let bearing = Math.atan2(threat.y - s.y, threat.x - s.x) - s.angle;
                while (bearing > Math.PI) bearing -= 2 * Math.PI;
                while (bearing < -Math.PI) bearing += 2 * Math.PI;
                s.desiredAngle = s.angle - Math.sign(bearing || 1) * (Math.PI / 2);
                // re-decide as soon as the danger clears, rather than
                // staying locked on an evasive heading
                s.nextTurnAt = now + 120;
            } else if (s.scavenger && (s.targetId = keepOrPickLoot(s))) {
                // 3. SCAVENGER: chase corpse loot, and chase it EVERY
                //    frame rather than on the wander timer — a target
                //    across the arena needs continuous correction, not a
                //    heading set once every two seconds.
                const loot = pellets.get(s.targetId)!;
                s.desiredAngle = Math.atan2(loot.y - s.y, loot.x - s.x);
            } else if (now >= s.nextTurnAt) {
                // 4. otherwise head for a pellet when one is close enough
                //    to be worth it, else pick a new drift
                let best: { x: number; y: number } | undefined;
                let bestD = 420 * 420;
                for (const p of pellets.values()) {
                    const d = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
                    if (d < bestD) {
                        bestD = d;
                        best = p;
                    }
                }
                s.desiredAngle = best
                    ? Math.atan2(best.y - s.y, best.x - s.x)
                    : s.angle + rand(-1.2, 1.2);
                s.nextTurnAt = now + rand(WANDER_MIN_MS, WANDER_MAX_MS);
            }

            // turn rate comes from the shared curve, so a big backdrop
            // snake handles like a big real one
            s.angle = turnTowards(s.angle, s.desiredAngle, s.turnSpeed * dt);
            s.x += Math.cos(s.angle) * SNAKE_SPEED * dt;
            s.y += Math.sin(s.angle) * SNAKE_SPEED * dt;

            // Eat: a pellet vanishes and a fresh one appears elsewhere —
            // but ONLY while the field is below its baseline. Without that
            // condition every corpse would inflate the population for
            // good: 25 pellets dropped, each replaced when eaten, forever.
            // With it, a corpse is a temporary feast that the arena
            // absorbs back to its normal density.
            const reach = s.radius + 12;
            for (const [id, p] of pellets) {
                if ((p.x - s.x) ** 2 + (p.y - s.y) ** 2 > reach * reach) continue;
                pellets.delete(id);
                view.removeFood(id);
                if (pellets.size < PELLET_COUNT) spawnPellet();
            }

            // Body: the same trailing-tracer scheme session.ts uses, so
            // the shape and spacing match the real thing rather than
            // approximating it.
            const alpha = Math.min((SNAKE_SPEED * dt) / SNAKE_SPACING, 1);
            while (s.body.length < s.length) {
                const tail = s.body[s.body.length - 1] ?? { x: s.x, y: s.y };
                s.body.push({ x: tail.x, y: tail.y });
            }
            while (s.body.length > s.length) s.body.pop();
            let prevX = s.x;
            let prevY = s.y;
            for (const t of s.body) {
                const keepX = t.x;
                const keepY = t.y;
                t.x += (prevX - t.x) * alpha;
                t.y += (prevY - t.y) * alpha;
                prevX = keepX;
                prevY = keepY;
            }

            if (isKilled(s, now)) {
                kill(s, now);
                continue;
            }

            // Grace fades in, the same translucency the arena uses to say
            // "this one is not tangible yet".
            const age = now - s.bornAt;
            const drawAlpha = age >= GRACE_MS ? 1 : 0.3 + 0.7 * (age / GRACE_MS);

            // No label: a name tag through a tinted overlay is unreadable
            // clutter, and the backdrop is scenery, not information.
            view.drawSnake(
                s.id,
                colorsFromSkin(SKINS[s.skinIndex]),
                s.x,
                s.y,
                s.body,
                s.radius,
                drawAlpha,
                "",
            );
        }
    };

    view.app.ticker.add(tick);

    return {
        stop() {
            view.app.ticker.remove(tick);
            for (const s of snakes) view.removeSnake(s.id);
            for (const id of pellets.keys()) view.removeFood(id);
            pellets.clear();
        },
    };
}
