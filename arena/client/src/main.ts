import { Client, Callbacks } from "@colyseus/sdk";
import {
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
import {
    GameView,
    OFFLINE_COLORS,
    OTHER_PALETTES,
    PLAYER_COLORS,
    type SnakeColors,
} from "./render";

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
    connected: boolean; // A1.9: false = frozen, harmless, rendered gray
    // synced ONLY while frozen (flattened x,y pairs): lets clients
    // that joined after the disconnect see the frozen body
    frozenBody: ArrayLike<number>;
}

const statusEl = document.getElementById("status")!;
const netEl = document.getElementById("net")!;

const players = new Map<string, NetPlayer>();
// last seen gen per player: a change means TELEPORT — every system
// that assumes continuous motion must reset for that player
const lastGen = new Map<string, number>();
let myId = "";

// Local input intent, shared between capture (main) and the local
// prediction simulation (A1.5)
const input: InputMessage = { angle: 0, boost: false };

// The camera keeps the predicted head at screen CENTER, so aiming is
// simply "screen center -> mouse" (proto input model). Inside this
// radius atan2 is noise (the head overshoots the cursor and the angle
// flips) — we keep the previous heading instead.
const AIM_DEADZONE = 60;
let mouseX = 0;
let mouseY = 0;

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
const SNAPSHOT_KEEP_MS = 1000;

// --- Dead reckoning (replaces pure interpolation at render time) ----
// Interpolation (A1.6) renders others in the exact PAST: smooth, but
// at 200ms RTT the gap between MY predicted head (~RTT/2 in the
// future) and THEIR interpolated body (~RTT/2 + interp delay in the
// past) reaches ~300ms — several body-widths. You visually clear an
// enemy and the server says you died. Dead reckoning PROJECTS their
// estimated present instead: last known position + heading + constant
// speed x age of the info. Snakes are the ideal case (constant speed,
// bounded turn): the projection is only wrong during their turns, and
// the error is bounded by their turning radius. Corrections from each
// new snapshot are absorbed gradually (same pattern as A1.7).
const MAX_EXTRAP_MS = 300;          // stop projecting on packet loss
const REMOTE_CORRECTION_RATE = 0.15; // error absorbed per 60fps frame
const REMOTE_SNAP_DISTANCE = 200;    // beyond this: teleport, just snap
const remoteRender = new Map<string, { x: number; y: number; angle: number; boosting: boolean }>();

function sampleDeadReckoned(id: string, now: number, dtFrames: number): Snap | undefined {
    const buf = snapshots.get(id);
    if (!buf || buf.length === 0) return undefined;
    const newest = buf[buf.length - 1];

    let r = remoteRender.get(id);
    if (!r) {
        r = { x: newest.x, y: newest.y, angle: newest.angle, boosting: newest.boosting };
        remoteRender.set(id, r);
    }
    // 1) advance our local copy with the shared motion model — it
    // moves every frame, so there is nothing patch-shaped to smooth
    r.angle = lerpAngle(r.angle, newest.angle, Math.min(0.25 * dtFrames, 1));
    r.boosting = newest.boosting;
    const speed = r.boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
    r.x += Math.cos(r.angle) * speed * dtFrames;
    r.y += Math.sin(r.angle) * speed * dtFrames;

    // 2) converge toward the PROJECTED truth: newest snapshot pushed
    // forward by its age (capped: extrapolating through packet loss
    // would send ghosts through walls)
    const ageFrames = Math.min(now - newest.t, MAX_EXTRAP_MS) / (1000 / 60);
    const tx = newest.x + Math.cos(newest.angle) * speed * ageFrames;
    const ty = newest.y + Math.sin(newest.angle) * speed * ageFrames;
    const errX = tx - r.x;
    const errY = ty - r.y;
    if (Math.hypot(errX, errY) > REMOTE_SNAP_DISTANCE) {
        r.x = tx;
        r.y = ty;
        r.angle = newest.angle;
    } else {
        const rate = Math.min(REMOTE_CORRECTION_RATE * dtFrames, 1);
        r.x += errX * rate;
        r.y += errY * rate;
    }
    return { t: now, x: r.x, y: r.y, angle: r.angle, boosting: r.boosting };
}

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

// Smoothed camera: eases toward the predicted head instead of hard-
// locking onto it. Reconciliation corrections then nudge the HEAD a
// few px on screen instead of sloshing the entire world — at scale 1
// a locked camera turns every correction into visible screen shake.
const cam = { x: 0, y: 0, initialized: false };
const CAMERA_RATE = 0.15; // catch-up fraction per 60fps frame

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

async function main() {
    // Pixi first: if the GPU init fails there is nothing to play on
    const view = await GameView.create();

    const client = new Client("http://localhost:2567");
    const options: JoinOptions = { protocol: PROTOCOL_VERSION, name: "tester", stake: 0 };
    const room = await client.joinOrCreate(ARENA_ROOM, options);
    myId = room.sessionId;
    statusEl.textContent = `connected — sessionId=${myId}`;

    // cheat-test hook: try room.send from the browser console
    (window as unknown as { room: typeof room }).room = room;

    // opponent palettes, assigned in order of first appearance
    const palettes = new Map<string, SnakeColors>();
    let paletteCursor = 0;

    // Schema objects are LIVE references: Colyseus mutates them in
    // place on every patch, so storing them once keeps them fresh.
    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", (player, id) => {
        players.set(String(id), player as NetPlayer);
        if (String(id) !== myId) {
            palettes.set(String(id), OTHER_PALETTES[paletteCursor++ % OTHER_PALETTES.length]);
        }
    });
    callbacks.onRemove("players", (_player, id) => {
        players.delete(String(id));
        snapshots.delete(String(id));
        bodies.delete(String(id));
        lastGen.delete(String(id));
        palettes.delete(String(id));
        remoteRender.delete(String(id));
        view.removeSnake(String(id));
    });
    // food add/remove drives the sprite pool directly — no local map:
    // the render layer IS the client-side representation of food
    callbacks.onAdd("food", (food, id) => {
        const f = food as { x: number; y: number; value: number };
        view.addFood(String(id), f.x, f.y, f.value);
    });
    callbacks.onRemove("food", (_food, id) => {
        view.removeFood(String(id));
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
                remoteRender.delete(id);
                if (id === myId) {
                    predicted.initialized = false;
                    predictedHistory.length = 0;
                    cam.initialized = false; // respawn: snap, don't slide
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

    // --- input capture: intent only (proto input model) ------------
    window.addEventListener("pointermove", (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });
    window.addEventListener("pointerdown", (e) => {
        if (e.button === 0) input.boost = true;
    });
    window.addEventListener("pointerup", (e) => {
        if (e.button === 0) input.boost = false;
    });
    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") input.boost = true;
    });
    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") input.boost = false;
    });

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

    // --- render loop -----------------------------------------------
    view.app.ticker.add((ticker) => {
        const now = performance.now();
        // ticker.deltaTime is already in "60fps frames"; clamp so a
        // backgrounded tab can't become one giant simulation step
        const dtFrames = Math.min(ticker.deltaTime, 3);

        // aim: from the head's SCREEN position (near — not exactly —
        // the center, since the camera is smoothed) toward the mouse
        const cx = view.app.screen.width / 2;
        const cy = view.app.screen.height / 2;
        const headSX = cam.initialized ? cx + (predicted.x - cam.x) : cx;
        const headSY = cam.initialized ? cy + (predicted.y - cam.y) : cy;
        if (Math.hypot(mouseX - headSX, mouseY - headSY) >= AIM_DEADZONE) {
            input.angle = Math.atan2(mouseY - headSY, mouseX - headSX);
        }

        predictTick(dtFrames, now);

        // camera fallback for the first frames, before prediction has
        // its first server state to initialize from
        const self = players.get(myId);
        if (self && !predicted.initialized) {
            cam.x = self.x;
            cam.y = self.y;
            cam.initialized = true;
            view.camera(cam.x, cam.y);
        }

        for (const [id, p] of players) {
            // self renders from the PREDICTION (A1.5); everyone else
            // from their DEAD-RECKONED estimated present, falling back
            // to raw state until a first snapshot exists. Offline
            // snakes are frozen: raw server position, no projection.
            const isMe = id === myId && predicted.initialized;
            const offline = p.connected === false;
            const other = isMe || offline ? undefined : sampleDeadReckoned(id, now, dtFrames);
            const px = isMe ? predicted.x : (other?.x ?? p.x);
            const py = isMe ? predicted.y : (other?.y ?? p.y);
            const boosting = isMe
                ? input.boost && p.score >= BOOST_ORB_VALUE
                : (other?.boosting ?? p.boosting);

            // A1.9: an offline snake's body must FREEZE too — the
            // server stopped moving its tracers, so we stop
            // follow-the-leader locally.
            let body = offline
                ? (bodies.get(id) ?? [])
                : updateBody(id, px, py, p.score, boosting, dtFrames);
            // late joiner: no local history for this frozen snake —
            // build the body once from the server's snapshot
            if (offline && body.length === 0 && p.frozenBody.length > 0) {
                body = [];
                for (let i = 0; i + 1 < p.frozenBody.length; i += 2) {
                    body.push({ x: p.frozenBody[i], y: p.frozenBody[i + 1] });
                }
                bodies.set(id, body);
            }

            const dims = describeSnakeFromScore(p.score);
            const colors = offline
                ? OFFLINE_COLORS
                : id === myId
                    ? PLAYER_COLORS
                    : (palettes.get(id) ?? OTHER_PALETTES[0]);
            // boost feedback: white-hot head while sprinting
            const drawn = boosting ? { body: colors.body, head: "#ffffff" } : colors;
            const alpha = p.graced || offline ? 0.4 : 1;
            const label =
                `${p.name} (${Math.round(p.score)})${offline ? " (offline)" : ""}`;
            view.drawSnake(id, drawn, px, py, body, dims.radius, alpha, label);

            if (isMe) {
                // smoothed camera: ease toward the predicted head
                const rate = Math.min(CAMERA_RATE * dtFrames, 1);
                cam.x += (px - cam.x) * rate;
                cam.y += (py - cam.y) * rate;
                cam.initialized = true;
                view.camera(cam.x, cam.y);
                view.drawDebug(px, py, p.x, p.y, dims.radius);
                view.drawMinimap(px, py);
            }
        }
    });
}

main().catch((err) => (statusEl.textContent = `ERROR: ${(err as Error).message}`));
