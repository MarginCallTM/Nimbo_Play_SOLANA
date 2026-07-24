import { Client, Callbacks } from "@colyseus/sdk";
import {
    AOI_RADIUS,
    ARENA_ROOM,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    PROTOCOL_VERSION,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SNAKE_TURN_SPEED,
    describeSnakeFromScore,
    turnTowards,
    WORLD_RADIUS,
    type InputMessage,
    type JoinOptions,
} from "@nimbo/shared";

// Shape of the live schema references received from the server
interface NetPlayer {
    name: string;
    x: number;
    y: number;
    angle: number;
    boosting: boolean;
    score: number;
    gen: number;     // epoch marker: changes on respawn (teleport)
    graced: boolean; // spawn protection: rendered translucent
    connected: boolean; // A1.9: false = frozen prey, rendered gray
    // synced ONLY while frozen (flattened x,y pairs): lets clients
    // that joined after the disconnect see the frozen body
    frozenBody: ArrayLike<number>;
}

const statusEl = document.getElementById("status")!;
const netEl = document.getElementById("net")!;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// whole-world view: world (0,0) at canvas center
const scale = canvas.width / (WORLD_RADIUS * 2);
const half = canvas.width / 2;

const players = new Map<string, NetPlayer>();
const foods = new Map<string, { x: number; y: number; value: number }>();
// last seen gen per player: a change means TELEPORT — every system
// that assumes continuous motion must reset for that player
const lastGen = new Map<string, number>();
let myId = "";

// Local input intent, shared between capture (main) and the local
// prediction simulation (A1.5)
const input: InputMessage = { angle: 0, boost: false };

// World-px radius around the head where mouse aim is ignored (~7
// screen px at whole-world zoom). Purely a client input concern.
const AIM_DEADZONE = 60;

// --- A1.6: entity interpolation --------------------------------------
// Other players are rendered ~100ms in the PAST, blended between the
// two snapshots that bracket that instant: 20 teleports/s become a
// continuous motion. We trade a fixed delay for perfect smoothness —
// extrapolating their future would guess wrong on every turn.
interface Snap {
    t: number; // performance.now() when the patch arrived
    x: number;
    y: number;
    angle: number;
    boosting: boolean;
}
const snapshots = new Map<string, Snap[]>();
const INTERP_DELAY_MS = 100;
const SNAPSHOT_KEEP_MS = 1000;

// --- A1.7bis: local body reconstruction ------------------------------
// Bodies are NEVER synced (the A1.4 bandwidth decision): the server
// sends head + score only, and every client regrows the body locally
// by chasing the RENDERED head (predicted for self, interpolated for
// others) with the proto's pre-update follow-the-leader.
const bodies = new Map<string, { x: number; y: number }[]>();

function updateBody(
    id: string,
    headX: number,
    headY: number,
    score: number,
    boosting: boolean,
    dtFrames: number,
): { x: number; y: number }[] {
    let body = bodies.get(id);
    if (!body) {
        body = [];
        bodies.set(id, body);
    }
    const dims = describeSnakeFromScore(score);
    while (body.length < dims.length) {
        const tail = body[body.length - 1] ?? { x: headX, y: headY };
        body.push({ x: tail.x, y: tail.y });
    }
    while (body.length > dims.length) {
        body.pop();
    }
    const speed = boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
    const alpha = Math.min((speed * dtFrames) / SNAKE_SPACING, 1);
    let prevX = headX;
    let prevY = headY;
    for (const tracer of body) {
        const keepX = tracer.x;
        const keepY = tracer.y;
        tracer.x += (prevX - tracer.x) * alpha;
        tracer.y += (prevY - tracer.y) * alpha;
        prevX = keepX;
        prevY = keepY;
    }
    return body;
}


// --- A1.5: client-side prediction -----------------------------------
// Your own snake must respond THIS frame, not one round-trip later.
// The client runs the SAME steering math as the server (shared/),
// driven by the LOCAL input — while the server stays authoritative:
// its state is the truth we correct against.
const predicted = { x: 0, y: 0, angle: 0, initialized: false };

// --- A1.7: server reconciliation ------------------------------------
// The server's truth always describes the PAST (half a round-trip of
// travel + up to one patch interval of staleness). Honest comparison
// therefore needs OUR OWN PAST: a timestamped history of predictions,
// and an RTT estimate to know how far back to look.
let rttMs = 0; // EMA-smoothed by the ping loop in main()
const predictedHistory: { t: number; x: number; y: number }[] = [];

// What did we believe our position was at time `t`? Entries are
// chronological: return the newest one that is not younger than t.
function sampleHistory(t: number): { x: number; y: number } | undefined {
    let best: { x: number; y: number } | undefined;
    for (const h of predictedHistory) {
        if (h.t <= t) best = h;
        else break;
    }
    return best;
}

// Fraction of the measured error absorbed per 60fps frame: ~5%/frame
// spreads a correction over roughly a second — invisible to the eye.
const CORRECTION_RATE = 0.05;
// Beyond this, don't smooth anything: it's a teleport (huge packet
// loss, server-side event) — give up and snap.
const HARD_SNAP_DISTANCE = 400;

function predictTick(dtFrames: number, now: number) {
    const me = players.get(myId);
    if (!me) return;
    if (!predicted.initialized) {
        predicted.x = me.x;
        predicted.y = me.y;
        predicted.angle = me.angle;
        predicted.initialized = true;
    }

    // Same math as ArenaRoom.tick(): same function, same constants,
    // same units — shared/ exists precisely so these two simulations
    // cannot drift apart by accident.
    predicted.angle = turnTowards(predicted.angle, input.angle, SNAKE_TURN_SPEED * dtFrames);
    // mirror the server's boost gating: below one orb of score the
    // sprint cuts off — predicting otherwise means rubber-banding
    const boosting = input.boost && me.score >= BOOST_ORB_VALUE;
    const speed = boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
    predicted.x += Math.cos(predicted.angle) * speed * dtFrames;
    predicted.y += Math.sin(predicted.angle) * speed * dtFrames;
    // border clamp must MIRROR the server's: radius derives from score
    const dist = Math.hypot(predicted.x, predicted.y);
    const max = WORLD_RADIUS - describeSnakeFromScore(me.score).radius;
    if (dist > max) {
        predicted.x *= max / dist;
        predicted.y *= max / dist;
    }

    // Record what we believed our position was at this instant — the
    // raw material reconciliation compares against.
    predictedHistory.push({ t: now, x: predicted.x, y: predicted.y });
    while (predictedHistory.length > 0 && now - predictedHistory[0].t > 1000) {
        predictedHistory.shift();
    }

    // A1.7 reconciliation. How old is the server state we are looking
    // at? Half a round-trip of travel, plus up to one patch interval.
    const stateAge = rttMs / 2 + 1000 / BROADCAST_RATE;
    const past = sampleHistory(now - stateAge);
    if (past) {
        // TRUE prediction error: the server's truth vs our belief AT
        // THAT SAME MOMENT. Hovers near zero during honest play, even
        // at full boost — it only grows when we actually mispredicted.
        const errX = me.x - past.x;
        const errY = me.y - past.y;
        if (Math.hypot(errX, errY) > HARD_SNAP_DISTANCE) {
            predicted.x = me.x;
            predicted.y = me.y;
            predicted.angle = me.angle;
        } else {
            // absorb a sliver of the error every tick: firm enough to
            // never drift away, gentle enough to never yank
            predicted.x += errX * CORRECTION_RATE * dtFrames;
            predicted.y += errY * CORRECTION_RATE * dtFrames;
        }
    }
}

// Blend two angles along the SHORTEST arc: naively lerping 3.1 -> -3.1
// would sweep through 0 (the long way around) instead of crossing PI.
function lerpAngle(a: number, b: number, alpha: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * alpha;
}

// Where was this player at `renderTime`? Finds the two snapshots that
// bracket that instant and blends them. Edge cases: not enough data ->
// oldest; renderTime beyond the newest snapshot (network starvation) -> 
// HOLD the newest, never extrapolate
function sampleInterpolated(id: string, renderTime: number): Snap | undefined {
    const buf = snapshots.get(id);
    if (!buf || buf.length === 0) return undefined;

    if (renderTime <= buf[0].t) return buf[0];
    const newest = buf[buf.length - 1];
    if (renderTime >= newest.t) return newest;

    // walk from the newest pair backwards: renderTime is only ~100ms
    // old, so the bracketing pair is almost always near the end
    for (let i = buf.length - 1; i > 0; i--) {
        const before = buf[i - 1];
        const after = buf[i];
        if (renderTime >= before.t && renderTime <= after.t) {
            const alpha = (renderTime - before.t) / (after.t - before.t);
            return {
                t: renderTime,
                x: before.x + (after.x - before.x) * alpha,
                y: before.y + (after.y - before.y) * alpha,
                angle: lerpAngle(before.angle, after.angle, alpha),
                boosting: after.boosting,
            };
        }
    }
    return newest;
}


async function main() {
    const client = new Client("http://localhost:2567");
    const options: JoinOptions = { protocol: PROTOCOL_VERSION, name: "tester", stake: 0 };
    const room = await client.joinOrCreate(ARENA_ROOM, options);
    myId = room.sessionId;
    statusEl.textContent = `connected — sessionId=${myId}`;

    // cheat-test hook: try room.send from the browser console
    (window as unknown as { room: typeof room }).room = room;

    // Schema objects are LIVE references: Colyseus mutates them in
    // place on every patch, so storing them once keeps them fresh.
    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", (player, id) => {
        players.set(String(id), player as NetPlayer);
    });
    callbacks.onRemove("players", (_player, id) => {
        players.delete(String(id));
        snapshots.delete(String(id));
        bodies.delete(String(id));
        lastGen.delete(String(id));
    });
    callbacks.onAdd("food", (food, id) => {
        foods.set(String(id), food as { x: number; y: number; value: number });
    });
    callbacks.onRemove("food", (_food, id) => {
        foods.delete(String(id));
    });

    // A1.6: photograph every OTHER player on each incoming patch —
    // these timestamped snapshots are what interpolation blends
    room.onStateChange(() => {
        const t = performance.now();
        for (const [id, p] of players) {
            // A1.7bis.d — epoch check FIRST, for everyone (self
            // included): a respawn voids interpolation, body and
            // prediction in one stroke
            if (lastGen.get(id) !== p.gen) {
                lastGen.set(id, p.gen);
                snapshots.delete(id);
                bodies.delete(id);
                if (id === myId) {
                    predicted.initialized = false;
                    predictedHistory.length = 0;
                }
            }
            if (id === myId) continue;
            let buf = snapshots.get(id);
            if (!buf) {
                buf = [];
                snapshots.set(id, buf);
            }
            buf.push({ t, x: p.x, y: p.y, angle: p.angle, boosting: p.boosting });
            while (buf.length > 0 && t - buf[0].t > SNAPSHOT_KEEP_MS) buf.shift();
        }
    });

    // --- A1.4: network meter (throwaway instrumentation) -----------
    // Schema patches are already binary deltas; we don't rewrite the
    // serialization, we MEASURE it on the wire. The SDK transport
    // re-reads its handlers on every message, so we can wrap
    // onmessage: count incoming bytes, then forward to the original.
    let netBytes = 0;
    let netPackets = 0;
    const events = room.connection.events;
    const forward = events.onmessage;
    events.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        netBytes += ev.data.byteLength ?? 0;
        netPackets += 1;
        forward?.(ev);
    };
    setInterval(() => {
        // cost of the naive alternative: full state as JSON, sent at
        // the same broadcast rate
        const snapshot: Record<string, unknown> = {};
        for (const [id, p] of players) {
            snapshot[id] = { name: p.name, x: p.x, y: p.y, angle: p.angle, boosting: p.boosting };
        }
        const jsonPerSec = new TextEncoder().encode(JSON.stringify(snapshot)).length * BROADCAST_RATE;
        const avg = netPackets ? Math.round(netBytes / netPackets) : 0;
        netEl.textContent =
            `net in: ${netBytes} B/s (${netPackets} msg, avg ${avg} B/msg)` +
            ` — naive full-state JSON: ~${jsonPerSec} B/s`;
        netBytes = 0;
        netPackets = 0;
    }, 1000);

    // --- input capture: intent only ---
    canvas.addEventListener("mousemove", (e) => {
        // aim FROM the predicted position: the input->display loop
        // must be fully local, or aiming lags by one RTT too
        const me = predicted.initialized ? predicted : players.get(myId);
        if (!me) return;
        const rect = canvas.getBoundingClientRect();
        // mouse position back into world coordinates
        const wx = (e.clientX - rect.left - half) / scale;
        const wy = (e.clientY - rect.top - half) / scale;
        // Aim dead zone: with the cursor close to the head, atan2
        // becomes noise — the head overshoots the cursor and the angle
        // flips 180°, breaking tight circles. Inside the zone we KEEP
        // the previous heading instead of recomputing it.
        if (Math.hypot(wx - me.x, wy - me.y) < AIM_DEADZONE) return;
        input.angle = Math.atan2(wy - me.y, wx - me.x);
    });
    window.addEventListener("mousedown", () => (input.boost = true));
    window.addEventListener("mouseup", () => (input.boost = false));

    // Send intent at a fixed 20Hz — never per mousemove (that can
    // fire at 1000Hz and flood the server)
    setInterval(() => room.send("input", input), 50);

    // A1.7: RTT probe. EMA smoothing (80/20) so one weird sample
    // doesn't jerk the reconciliation window around.
    room.onMessage("pong", (t: number) => {
        const sample = performance.now() - t;
        rttMs = rttMs === 0 ? sample : rttMs * 0.8 + sample * 0.2;
    });
    setInterval(() => room.send("ping", performance.now()), 1000);

    requestAnimationFrame(render);
}

let lastTime = performance.now();

function render(now: number) {
    // rAF gives wall-clock ms -> convert to 60fps frames and CLAMP
    // (the proto's MAX_DT lesson: a backgrounded tab or a stall must
    // not become one giant simulation step)
    const dtFrames = Math.min((now - lastTime) / (1000 / 60), 3);
    lastTime = now;
    predictTick(dtFrames, now);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // world border
    ctx.beginPath();
    ctx.arc(half, half, WORLD_RADIUS * scale, 0, 2 * Math.PI);
    ctx.strokeStyle = "#444";
    ctx.stroke();

    // food: squares (cheaper than arcs at this count), drawn under
    // the snakes; corpse orbs are bigger and golden
    for (const f of foods.values()) {
        const big = f.value > 1;
        ctx.fillStyle = big ? "#fc6" : "#586";
        const s = big ? 3 : 1.5;
        ctx.fillRect(half + f.x * scale - s / 2, half + f.y * scale - s / 2, s, s);
    }

    for (const [id, p] of players) {
        // self renders from the PREDICTION (A1.5); everyone else from
        // the interpolated past (A1.6), falling back to raw state
        // until their snapshot buffer has enough photos
        const isMe = id === myId && predicted.initialized;
        const other = isMe ? undefined : sampleInterpolated(id, now - INTERP_DELAY_MS);
        const px = isMe ? predicted.x : (other?.x ?? p.x);
        const py = isMe ? predicted.y : (other?.y ?? p.y);
        const pAngle = isMe ? predicted.angle : (other?.angle ?? p.angle);
        const boosting = isMe ? input.boost : (other?.boosting ?? p.boosting);

        const cx = half + px * scale;
        const cy = half + py * scale;
        const dims = describeSnakeFromScore(p.score);
        const r = Math.max(dims.radius * scale, 2.5);
        // A1.9: an offline snake is frozen, gray and harmless — it
        // will turn into orbs if the owner doesn't come back. Its
        // body must FREEZE too: the server stops moving its tracers,
        // so we stop running follow-the-leader locally, otherwise our
        // copy collapses onto the still head in ~2s.
        const offline = p.connected === false;
        // translucent = intangible, one visual signal for both spawn
        // grace and disconnection
        ctx.globalAlpha = p.graced || offline ? 0.4 : 1;
        // body: locally regrown, chasing the rendered head — except
        // when frozen: redraw the last known body untouched
        let body = offline
            ? (bodies.get(id) ?? [])
            : updateBody(id, px, py, p.score, boosting, dtFrames);
        // late joiner: no local history for this frozen snake — build
        // the body once from the server's snapshot and cache it (it
        // also seeds follow-the-leader if the player comes back)
        if (offline && body.length === 0 && p.frozenBody.length > 0) {
            body = [];
            for (let i = 0; i + 1 < p.frozenBody.length; i += 2) {
                body.push({ x: p.frozenBody[i], y: p.frozenBody[i + 1] });
            }
            bodies.set(id, body);
        }
        ctx.fillStyle = offline ? "#555" : id === myId ? "#2a2" : "#a50";
        for (const tracer of body) {
            ctx.beginPath();
            ctx.arc(half + tracer.x * scale, half + tracer.y * scale, r, 0, 2 * Math.PI);
            ctx.fill();
        }

        // head: me in green, others in orange, boosting in white
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.fillStyle = offline ? "#777" : boosting ? "#fff" : id === myId ? "#4f4" : "#f80";
        ctx.fill();
        // name + score label
        ctx.fillStyle = offline ? "#999" : "#8f8";
        ctx.fillText(
            `${p.name} (${Math.round(p.score)})${offline ? " (offline)" : ""}`,
            cx + r + 2,
            cy - r - 2,
        );

        ctx.globalAlpha = 1;
        // debug: my AoI bubble — pellets only exist inside it, which
        // makes the server-side filtering literally visible
        if (isMe) {
            ctx.beginPath();
            ctx.setLineDash([4, 6]);
            ctx.arc(cx, cy, AOI_RADIUS * scale, 0, 2 * Math.PI);
            ctx.strokeStyle = "#358";
            ctx.stroke();
            ctx.setLineDash([]);
        }
        // debug ghost: where the SERVER thinks I am (the truth the
        // prediction is being corrected against). The gap between the
        // solid dot and this hollow circle IS the round-trip time.
        if (isMe) {
            ctx.beginPath();
            ctx.arc(half + p.x * scale, half + p.y * scale, r, 0, 2 * Math.PI);
            ctx.strokeStyle = "#4f4";
            ctx.stroke();
        }
    }
    requestAnimationFrame(render);
}

main().catch((err) => (statusEl.textContent = `ERROR: ${(err as Error).message}`))