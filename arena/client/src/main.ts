import { Client, Callbacks } from "@colyseus/sdk";
import {
    ARENA_ROOM,
    DEMO_ROOM,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    FOOD_EAT_RANGE,
    PROTOCOL_VERSION,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SNAKE_TURN_SPEED,
    describeSnakeFromScore,
    turnTowards,
    WORLD_RADIUS,
    SCORE_PER_SOL,
    type DiedMessage,
    type ExtractedMessage,
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
import { sendJoinDeposit, signInWithSolana } from "./wallet";
import { showGameOver, showMenu } from "./menu";

// Shape of the live schema references received from the server
interface NetPlayer {
    name: string;
    x: number;
    y: number;
    angle: number;
    boosting: boolean;
    score: number;
    gen: number;     // epoch marker: changes on respawn (teleport)
    channel: number; // extraction channel progress, frames (public!)
    graced: boolean; // spawn protection: rendered translucent
    connected: boolean; // A1.9: false = frozen, harmless, rendered gray
    // synced ONLY while frozen (flattened x,y pairs): lets clients
    // that joined after the disconnect see the frozen body
    frozenBody: ArrayLike<number>;
}

const statusEl = document.getElementById("status")!;
const netEl = document.getElementById("net")!;

const players = new Map<string, NetPlayer>();
// AoI-local food data (positions/values), mirrored from the server
// state — the render layer holds the sprites, this holds the numbers
const foods = new Map<string, { x: number; y: number; value: number }>();
// --- Eat prediction ---------------------------------------------------
// A1.5 applied to the WORLD: a pellet entering the PREDICTED head's
// mouth range is hidden immediately (the world must react to you this
// frame, not one RTT later). The server confirms by actually removing
// it; if no confirmation lands within the timeout (we swerved at the
// last instant and never ate it server-side), the pellet pops back.
const predictedEaten = new Map<string, number>(); // food id -> hidden at
const EAT_CONFIRM_TIMEOUT_MS = 1000;
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

    // A3.2 — the player sequence, in the order the player lives it:
    // pick a stake -> prove wallet ownership (SIWS) -> deposit on
    // chain (paid tiers) -> join the room with both proofs.
    // FREE routes to the DEMO room instead (D72/D76): off-chain,
    // bots, fake value — no wallet involved at any point.
    const SERVER_URL = "http://localhost:2567";
    const { stakeSol } = await showMenu();
    const isDemo = stakeSol === 0;

    const client = new Client(SERVER_URL);
    let txSig: string | undefined;
    if (!isDemo) {
        // A3.1 — SIWS before anything touches the paid room: the
        // server's static onAuth rejects tokenless joins.
        statusEl.textContent = "sign in with your wallet…";
        // the SDK sends this token with the matchmaking request; the
        // server's onAuth receives it as its first argument
        client.auth.token = await signInWithSolana(SERVER_URL);

        // The deposit tx must be CONFIRMED before we knock on the
        // room's door — the server verifies it on-chain at join time.
        statusEl.textContent = `depositing ${stakeSol} SOL — approve in Phantom…`;
        txSig = await sendJoinDeposit(SERVER_URL, stakeSol);
        statusEl.textContent = "deposit confirmed — joining…";
    } else {
        statusEl.textContent = "joining the demo — no wallet needed…";
    }

    const options: JoinOptions = {
        protocol: PROTOCOL_VERSION,
        name: "tester",
        stake: stakeSol,
        txSig,
    };
    const room = await client.joinOrCreate(isDemo ? DEMO_ROOM : ARENA_ROOM, options);
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
    callbacks.onAdd("food", (food, id) => {
        const f = food as { x: number; y: number; value: number };
        foods.set(String(id), f);
        view.addFood(String(id), f.x, f.y, f.value);
    });
    callbacks.onRemove("food", (_food, id) => {
        foods.delete(String(id));
        predictedEaten.delete(String(id)); // server confirmed our bite
        view.removeFood(String(id));       // no-op if already hidden
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
            `rtt ${Math.round(rttMs)}ms — net in: ${netBytes} B/s (${netPackets} msg, avg ${avg} B/msg)` +
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

    // Send intent at a fixed 30Hz, aligned with the server tick rate
    // (sending slower than the sim adds up to a whole tick of intent
    // lag) — and never per mousemove (that can fire at 1000Hz)
    setInterval(() => room.send("input", input), 33);

    // A3.2+ — YOUR extraction succeeded: the value left the arena and
    // is now a settlement claim. Reload = clean slate back to the
    // menu (playing again = depositing again, by design).
    room.onMessage("extracted", async (msg: ExtractedMessage) => {
        const sol = (Number(msg.lamports) / 1e9).toFixed(4);
        await showGameOver({
            title: "EXTRACTED",
            amount: isDemo
                ? `score ${msg.score.toFixed(1)} — demo, nothing real`
                : `◎${sol} secured`,
            detail: isDemo
                ? "stake real SOL to extract real SOL"
                : `payout pending — claim #${msg.nonce}`,
            color: "#50fa7b",
        });
        location.reload();
    });

    // Death is game over (D72): the corpse stayed on the field, the
    // run is done. Show the loss, then back to the menu.
    room.onMessage("died", async (msg: DiedMessage) => {
        const sol = (Number(msg.lamports) / 1e9).toFixed(4);
        await showGameOver({
            title: "GAME OVER",
            amount: isDemo
                ? `score ${msg.score.toFixed(1)} lost — demo, nothing real`
                : `◎${sol} left on the field`,
            color: "#f63963",
        });
        location.reload();
    });

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

        // extract zone: live schema ref, drawn every frame (it pulses
        // and counts down). Our own channel bar comes from OUR synced
        // player — the server is the only one who counts.
        const zone = room.state.extract;
        view.drawExtract(
            zone.active, zone.x, zone.y, zone.ttl,
            players.get(myId)?.channel ?? 0,
        );

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
            // the label above every head shows LIVE SOL (proto's
            // mock-◎ rule): score is the ledger, ◎ is what it means
            const label =
                `${p.name} ◎${(p.score / SCORE_PER_SOL).toFixed(4)}${offline ? " (offline)" : ""}`;
            view.drawSnake(id, drawn, px, py, body, dims.radius, alpha, label);

            if (isMe) {
                // smoothed camera: ease toward the predicted head
                const rate = Math.min(CAMERA_RATE * dtFrames, 1);
                cam.x += (px - cam.x) * rate;
                cam.y += (py - cam.y) * rate;
                cam.initialized = true;
                view.camera(cam.x, cam.y);
                view.drawDebug(px, py, p.x, p.y, dims.radius);
                view.drawMinimap(px, py, zone.active ? zone : undefined);

                // eat prediction: hide pellets the PREDICTED head is
                // eating right now — the server's removal confirms it
                // ~RTT later. Mirror the server's gates exactly
                // (graced eats nothing, range from the same dims).
                if (!p.graced) {
                    const eatRange = dims.radius + FOOD_EAT_RANGE;
                    for (const [fid, f] of foods) {
                        if (predictedEaten.has(fid)) continue;
                        const dx = f.x - px;
                        const dy = f.y - py;
                        if (dx * dx + dy * dy <= eatRange * eatRange) {
                            predictedEaten.set(fid, now);
                            view.removeFood(fid);
                        }
                    }
                }
            }
        }

        // eat mispredictions: the server never confirmed — the pellet
        // is still alive, put its sprite back
        for (const [fid, hiddenAt] of predictedEaten) {
            if (now - hiddenAt <= EAT_CONFIRM_TIMEOUT_MS) continue;
            predictedEaten.delete(fid);
            const f = foods.get(fid);
            if (f) view.addFood(fid, f.x, f.y, f.value);
        }
    });
}

main().catch((err) => (statusEl.textContent = `ERROR: ${(err as Error).message}`));
