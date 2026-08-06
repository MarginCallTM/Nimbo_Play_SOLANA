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
//   radar    play NOTHING, just print what room.state hands us. It
//            PROVED the player-radar leak (read a player at 2800px for
//            a 1200px bubble); since A4.6c closed it, this is the
//            REGRESSION TEST — a "LEAK" line means the filter broke
//
// Tip: DEMO_BOTS=0 on the server gives a clean 1v1 (no tutorial bots).
//
// Note: hunt and cannibal attack ANYONE, squadmates included (a live
// free-for-all); dodge, feed and contest target the HUMAN only — they
// recognise squadmates by the "spar-" name prefix and ignore them;
// racoon attacks nobody and runs from everybody.
//
// Since A4.6c the bots see only their own AoI bubble, like you. With
// nobody in sight they rally on the extract zone (global state by
// design) instead of wandering — that is what keeps them findable now
// that they cannot read the whole roster.

import { Client, Callbacks, type Room } from "@colyseus/sdk";
import {
    AOI_RADIUS,
    BOOST_ORB_VALUE,
    DEMO_ROOM,
    EXTRACT_RADIUS,
    FOOD_EAT_RANGE,
    FOOD_VALUE,
    PROTOCOL_VERSION,
    SNAKE_BOOST_SPEED,
    SNAKE_SPEED,
    WORLD_RADIUS,
    describeSnakeFromScore,
    type InputMessage,
} from "@nimbo/shared";

type Behavior = "hunt" | "cannibal" | "dodge" | "feed" | "contest" | "racoon" | "radar";
const BEHAVIORS: Behavior[] = ["hunt", "cannibal", "dodge", "feed", "contest", "racoon", "radar"];
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

// how long the bot stays dead before rejoining (short: the human is
// waiting for a partner, not watching an empty map)
const RESPAWN_DELAY_MS = Number(process.env.SPAR_RESPAWN_MS ?? 2000);

// racoon tuning: anyone closer than FLEE_PX breaks the farming (run
// away, boosting under PANIC_PX), and GREED is the eaten value that
// turns the run into a dash for the extract zone
const RACOON_FLEE_PX = 500;
const RACOON_PANIC_PX = 250;
const RACOON_GREED = FOOD_VALUE * 8;

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

async function run(BEHAVIOR: Behavior, slot: number) {
    // tag = stable identity across respawns, so a squad's logs stay
    // readable ("hunt#2 died" tells you which one)
    const tag = `${BEHAVIOR}#${slot}`;
    const client = new Client(SERVER_URL);
    let room: Room = await client.joinOrCreate(DEMO_ROOM, {
        protocol: PROTOCOL_VERSION,
        name: `${SPAR_PREFIX}${BEHAVIOR}${slot}`,
        stake: 0,
    });

    let me: NetPlayer | undefined;
    const others = new Map<string, NetPlayer>();
    const foods = new Map<string, NetFood>();

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
    async function restart(reason: string) {
        if (restarting) return;
        restarting = true;
        if (loop) clearInterval(loop);
        if (watch) clearInterval(watch);
        me = undefined;
        console.log(`[spar:${tag}] ${reason} — rejoining in ${RESPAWN_DELAY_MS}ms`);
        await room.leave().catch(() => {});
        await sleep(RESPAWN_DELAY_MS);
        run(BEHAVIOR, slot).catch((err) =>
            console.error(`[spar:${tag}] rejoin failed: ${(err as Error).message}`));
    }

    // (Re)wire every callback — a reconnect hands us a NEW room object,
    // so this runs again on the fresh one.
    function wire(r: Room) {
        me = undefined;
        others.clear();
        foods.clear();
        r.onMessage("*", (type, message) => {
            if (type !== "died" && type !== "extracted") return;
            // A4.6d: "died" now names the killer — printing it here
            // makes the bot log a killfeed of its own
            const m = message as { kind?: string; killedBy?: string } | undefined;
            const detail = m?.kind ? ` (${m.kind}${m.killedBy ? ` with ${m.killedBy}` : ""})` : "";
            void restart(`${String(type)}${detail}`);
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
            else others.delete(String(id));
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
    const HUNTS_ANYONE = BEHAVIOR === "hunt" || BEHAVIOR === "cannibal";
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
                let best: NetFood | undefined;
                let bestD = Infinity;
                for (const f of foods.values()) {
                    if (!isReachable(me, f, turnRadius, eatReach)) continue;
                    const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
                    if (d < bestD) { bestD = d; best = f; }
                }
                if (best) {
                    input.angle = Math.atan2(best.y - me.y, best.x - me.x);
                } else if (Math.random() < 0.05) {
                    input.angle = Math.random() * 2 * Math.PI;
                }
            }
            room.send("input", input);
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
            let best: NetFood | undefined;
            let bestD = Infinity;
            for (const f of foods.values()) {
                if (!isReachable(me, f, turnRadius, eatReach)) continue;
                const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2;
                if (d < bestD) { bestD = d; best = f; }
            }
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
    // "fetch failed" is node-speak for "nobody is listening" — spell it
    // out, it is by far the most common way to run this script wrong.
    if (/fetch failed|ECONNREFUSED/.test(msg)) {
        console.error(`  no arena server answering at ${SERVER_URL}`);
        console.error(`  start one first:  cd arena && DEMO_BOTS=0 npm run dev:server`);
    }
    process.exit(1);
}

// Launch the roster. Joins are staggered: a burst of simultaneous
// joinOrCreate calls can race into separate rooms, and a squad split
// across two rooms spars with nobody.
(async () => {
    console.log(`[spar] squad: ${ROSTER.join(", ")} — ${SERVER_URL}`);
    const counters = new Map<Behavior, number>();
    for (const behavior of ROSTER) {
        const slot = (counters.get(behavior) ?? 0) + 1;
        counters.set(behavior, slot);
        try {
            await run(behavior, slot);
        } catch (err) {
            const msg = (err as Error).message;
            console.error(`[spar:${behavior}#${slot}] failed: ${msg}`);
            fatal(msg); // the first join failing means none will work
        }
        await sleep(250);
    }
})();
