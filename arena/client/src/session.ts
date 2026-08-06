// A4.2a — the game session, extracted from main.ts and given a
// LIFECYCLE. One session = one room (demo or arena): it joins, wires
// the whole netcode (prediction, dead reckoning, local bodies, eat
// prediction), runs the render loop, and RETURNS how it ended instead
// of reloading the page. The orchestrator (main.ts) decides what an
// ending means — reload after a paid run, instant respawn while
// warming up in the queue, clean handoff from demo to arena.
//
// Everything that used to be module-level state in main.ts lives in
// the session closure: two sessions can run back to back in the same
// page without ghosts from the previous room. Teardown removes the
// ticker callback, the intervals, the input listeners and every
// sprite (view.clear()).
//
// New in the arena flavor: while room.state.phase === "waiting"
// (launch gate, morceau 1), the server HOLDS the snake — so the
// client must NOT predict (prediction vs held server = the rubber-
// band we measured on devnet). We render the raw server truth under a
// "waiting for opponent" overlay, and restart prediction from scratch
// the instant the phase flips to live.

import { Client, Callbacks, type Room } from "@colyseus/sdk";
import {
    ARENA_ROOM,
    BOOST_ORB_VALUE,
    BROADCAST_RATE,
    FOOD_EAT_RANGE,
    SNAKE_BOOST_SPEED,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SNAKE_TURN_SPEED,
    WORLD_RADIUS,
    SCORE_PER_SOL,
    describeSnakeFromScore,
    turnTowards,
    type DiedMessage,
    type ExtractedMessage,
    type InputMessage,
    type JoinOptions,
    type RefundedMessage,
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
    channel: number; // extraction channel progress, frames (public!)
    graced: boolean; // spawn protection: rendered translucent
    connected: boolean; // A1.9: false = frozen, harmless, rendered gray
    frozenBody: ArrayLike<number>;
}

// How a session ends — the session never decides what happens next.
export type SessionEnd =
    | { kind: "died"; msg: DiedMessage }
    | { kind: "extracted"; msg: ExtractedMessage }
    | { kind: "refunded"; msg: RefundedMessage }
    | { kind: "stopped" }; // external stop() or connection lost

export interface GameSession {
    ended: Promise<SessionEnd>;
    stop(): Promise<void>; // leave the room + teardown (idempotent)
}

// Netcode tunables (A1.5/A1.6/A1.7/A1.11) — proven values, unchanged.
const AIM_DEADZONE = 60;
const SNAPSHOT_KEEP_MS = 1000;
const MAX_EXTRAP_MS = 300;
const REMOTE_CORRECTION_RATE = 0.15;
const REMOTE_SNAP_DISTANCE = 200;
const CAMERA_RATE = 0.15;
const CORRECTION_RATE = 0.05;
const HARD_SNAP_DISTANCE = 400;
const EAT_CONFIRM_TIMEOUT_MS = 1000;

interface Snap {
    t: number;
    x: number;
    y: number;
    angle: number;
    boosting: boolean;
}

// Blend two angles along the SHORTEST arc: naively lerping 3.1 -> -3.1
// would sweep through 0 (the long way around) instead of crossing PI.
function lerpAngle(a: number, b: number, alpha: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return a + diff * alpha;
}

export async function startGameSession(
    client: Client,
    roomName: string,
    options: JoinOptions,
    view: GameView,
): Promise<GameSession> {
    const statusEl = document.getElementById("status")!;
    const netEl = document.getElementById("net")!;

    // Only the paid arena has a launch gate worth showing: the demo
    // inherits the phase field but flips to live within one tick.
    const gated = roomName === ARENA_ROOM;

    // --- per-session netcode state (was module-level in main.ts) ----
    const players = new Map<string, NetPlayer>();
    const foods = new Map<string, { x: number; y: number; value: number }>();
    const predictedEaten = new Map<string, number>();
    const lastGen = new Map<string, number>();
    const snapshots = new Map<string, Snap[]>();
    const remoteRender = new Map<string, { x: number; y: number; angle: number; boosting: boolean }>();
    const bodies = new Map<string, { x: number; y: number }[]>();
    const predicted = { x: 0, y: 0, angle: 0, initialized: false };
    const cam = { x: 0, y: 0, initialized: false };
    const predictedHistory: { t: number; x: number; y: number }[] = [];
    const input: InputMessage = { angle: 0, boost: false };
    let rttMs = 0;
    let mouseX = 0;
    let mouseY = 0;
    let myId = "";

    const room: Room = await client.joinOrCreate(roomName, options);

    // joinOrCreate resolves BEFORE the first full state arrives —
    // touching room.state in that window reads undefined children,
    // and ONE exception in a Pixi ticker callback kills the ticker
    // FOR GOOD (the 2026-08-03 blind-client bug). Wait, then wire.
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));

    myId = room.sessionId;
    statusEl.textContent = `connected — sessionId=${myId}`;
    // cheat-test hook: try room.send from the browser console
    (window as unknown as { room: typeof room }).room = room;

    // --- session ending ---------------------------------------------
    let finish!: (end: SessionEnd) => void;
    let finished = false;
    const ended = new Promise<SessionEnd>((r) => (finish = r));
    const intervals: ReturnType<typeof setInterval>[] = [];

    // --- launch gate overlay (arena only) ---------------------------
    // `held` mirrors the server's waiting phase: while true we render
    // the raw server truth and freeze prediction entirely — predicting
    // a snake the server refuses to move only manufactures error.
    let held = gated && (room.state as { phase?: string }).phase === "waiting";
    let waitOverlay: HTMLElement | undefined;
    function showWaiting() {
        if (waitOverlay) return;
        waitOverlay = document.createElement("div");
        waitOverlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:15", "pointer-events:none",
            "display:flex", "flex-direction:column", "align-items:center",
            "justify-content:center", "gap:10px",
            "background:rgba(11,16,32,0.55)", "color:#e2e8f0", "font-family:monospace",
        ].join(";");
        const t = document.createElement("div");
        t.textContent = "WAITING FOR OPPONENT…";
        t.style.cssText = "font-size:28px;letter-spacing:5px;color:#ffcc66";
        const s = document.createElement("div");
        s.textContent = "your snake is held safe — deposit refunded if nobody shows up (~60s)";
        s.style.cssText = "font-size:13px;opacity:0.7";
        waitOverlay.append(t, s);
        document.body.appendChild(waitOverlay);
    }
    function hideWaiting() {
        waitOverlay?.remove();
        waitOverlay = undefined;
    }
    if (held) showWaiting();

    // --- input capture: intent only (proto input model) -------------
    // Registered per session and removed at teardown so two sessions
    // never stack duplicate listeners.
    const onMove = (e: PointerEvent) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
    };
    const onDown = (e: PointerEvent) => {
        if (e.button === 0) input.boost = true;
    };
    const onUp = (e: PointerEvent) => {
        if (e.button === 0) input.boost = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === "Space") input.boost = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === "Space") input.boost = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function teardown() {
        view.app.ticker.remove(tickerFn);
        for (const i of intervals) clearInterval(i);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        hideWaiting();
        view.clear();
        netEl.textContent = "";
    }

    function end(e: SessionEnd) {
        if (finished) return;
        finished = true;
        teardown();
        // ALWAYS sever the connection: a session that ended but stayed
        // connected is a ZOMBIE — its room object keeps receiving
        // patches, and its stale food callbacks paint ghost sprites
        // over the next session's canvas (found chasing the
        // 2026-08-05 "demo bots" report). No-op if the leave already
        // happened (server kick / connection lost).
        room.leave().catch(() => {});
        finish(e);
    }

    // --- prediction / reconciliation (A1.5 + A1.7, proven code) -----
    function sampleHistory(t: number): { x: number; y: number } | undefined {
        let best: { x: number; y: number } | undefined;
        for (const h of predictedHistory) {
            if (h.t <= t) best = h;
            else break;
        }
        return best;
    }

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
        // same units — shared/ exists precisely so these two
        // simulations cannot drift apart by accident.
        predicted.angle = turnTowards(predicted.angle, input.angle, SNAKE_TURN_SPEED * dtFrames);
        // !graced mirrors the server's 2026-08-06 rule (a ghost cannot
        // boost). Predicting a denied boost ran the whole screen up to
        // 180px ahead of the server during spawn grace — every enemy
        // looked safely far while really on top of us.
        const boosting = input.boost && me.score >= BOOST_ORB_VALUE && !me.graced;
        const speed = boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
        predicted.x += Math.cos(predicted.angle) * speed * dtFrames;
        predicted.y += Math.sin(predicted.angle) * speed * dtFrames;
        const dist = Math.hypot(predicted.x, predicted.y);
        const max = WORLD_RADIUS - describeSnakeFromScore(me.score).radius;
        if (dist > max) {
            predicted.x *= max / dist;
            predicted.y *= max / dist;
        }

        predictedHistory.push({ t: now, x: predicted.x, y: predicted.y });
        while (predictedHistory.length > 0 && now - predictedHistory[0].t > 1000) {
            predictedHistory.shift();
        }

        // A1.7 reconciliation: the server's truth vs our belief AT THE
        // SAME MOMENT (half a round-trip + up to one patch of age).
        const stateAge = rttMs / 2 + 1000 / BROADCAST_RATE;
        const past = sampleHistory(now - stateAge);
        if (past) {
            const errX = me.x - past.x;
            const errY = me.y - past.y;
            if (Math.hypot(errX, errY) > HARD_SNAP_DISTANCE) {
                predicted.x = me.x;
                predicted.y = me.y;
                predicted.angle = me.angle;
            } else {
                predicted.x += errX * CORRECTION_RATE * dtFrames;
                predicted.y += errY * CORRECTION_RATE * dtFrames;
            }
        }
    }

    // --- dead reckoning for others (A1.11, proven code) -------------
    function sampleDeadReckoned(id: string, now: number, dtFrames: number): Snap | undefined {
        const buf = snapshots.get(id);
        if (!buf || buf.length === 0) return undefined;
        const newest = buf[buf.length - 1];

        let r = remoteRender.get(id);
        if (!r) {
            r = { x: newest.x, y: newest.y, angle: newest.angle, boosting: newest.boosting };
            remoteRender.set(id, r);
        }
        r.angle = lerpAngle(r.angle, newest.angle, Math.min(0.25 * dtFrames, 1));
        r.boosting = newest.boosting;
        const speed = r.boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
        r.x += Math.cos(r.angle) * speed * dtFrames;
        r.y += Math.sin(r.angle) * speed * dtFrames;

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

    // --- local body reconstruction (A1.7bis, proven code) -----------
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

    // --- schema wiring ----------------------------------------------
    const palettes = new Map<string, SnakeColors>();
    let paletteCursor = 0;

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
        predictedEaten.delete(String(id));
        view.removeFood(String(id));
    });

    room.onStateChange(() => {
        // A4.2a — launch gate transition. The gen marker does NOT
        // change at launch (same snake, same spot), so prediction must
        // be restarted BY HAND: it was frozen all along and its
        // history describes a snake that never moved.
        const phase = (room.state as { phase?: string }).phase;
        const nowHeld = gated && phase === "waiting";
        if (held && !nowHeld) {
            predicted.initialized = false;
            predictedHistory.length = 0;
            cam.initialized = false;
            hideWaiting();
            statusEl.textContent = "opponent found — match is LIVE";
        }
        held = nowHeld;

        // A1.6: photograph every OTHER player on each incoming patch
        const t = performance.now();
        for (const [id, p] of players) {
            // epoch check FIRST, for everyone (self included): a
            // respawn voids interpolation, body and prediction
            if (lastGen.get(id) !== p.gen) {
                lastGen.set(id, p.gen);
                snapshots.delete(id);
                bodies.delete(id);
                remoteRender.delete(id);
                if (id === myId) {
                    predicted.initialized = false;
                    predictedHistory.length = 0;
                    cam.initialized = false;
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

    // --- network meter (A1.4 instrumentation) -----------------------
    let netBytes = 0;
    let netPackets = 0;
    const events = room.connection.events;
    const forward = events.onmessage;
    events.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        netBytes += ev.data.byteLength ?? 0;
        netPackets += 1;
        forward?.(ev);
    };
    intervals.push(setInterval(() => {
        const avg = netPackets ? Math.round(netBytes / netPackets) : 0;
        netEl.textContent =
            `rtt ${Math.round(rttMs)}ms — net in: ${netBytes} B/s (${netPackets} msg, avg ${avg} B/msg)`;
        netBytes = 0;
        netPackets = 0;
    }, 1000));

    // Send intent at a fixed 30Hz, aligned with the server tick rate —
    // and never per mousemove (that can fire at 1000Hz).
    intervals.push(setInterval(() => room.send("input", input), 33));

    // A4.6f — one-shot body seed, sent by the server whenever a snake
    // enters our AoI bubble: its real trail replaces the local regrowth
    // start (a stack of segments at its head). Without this the entrant
    // renders bodyless while its server trail kills — see updateViews.
    room.onMessage("body", (msg: { id: string; points: number[] }) => {
        if (msg.id === myId) return; // our own trail is our own history
        const body: { x: number; y: number }[] = [];
        for (let i = 0; i + 1 < msg.points.length; i += 2) {
            body.push({ x: msg.points[i], y: msg.points[i + 1] });
        }
        bodies.set(msg.id, body);
    });

    // --- endings ----------------------------------------------------
    room.onMessage("extracted", (msg: ExtractedMessage) => end({ kind: "extracted", msg }));
    room.onMessage("died", (msg: DiedMessage) => end({ kind: "died", msg }));
    // A4.2a — the launch gate gave up (no partner): the deposit is on
    // its way back through the settlement outbox.
    room.onMessage("refunded", (msg: RefundedMessage) => end({ kind: "refunded", msg }));

    // RTT probe (A1.7): EMA smoothing so one weird sample doesn't jerk
    // the reconciliation window around.
    room.onMessage("pong", (t: number) => {
        const sample = performance.now() - t;
        rttMs = rttMs === 0 ? sample : rttMs * 0.8 + sample * 0.2;
    });
    intervals.push(setInterval(() => room.send("ping", performance.now()), 1000));

    // connection lost / server kicked us: the session is over either
    // way (guarded: a voluntary stop() already finished it)
    room.onLeave(() => end({ kind: "stopped" }));

    // --- render loop ------------------------------------------------
    const tickerFn = (ticker: { deltaTime: number }) => {
        const now = performance.now();
        const dtFrames = Math.min(ticker.deltaTime, 3);

        // aim: from the head's SCREEN position toward the mouse
        const cx = view.app.screen.width / 2;
        const cy = view.app.screen.height / 2;
        const headSX = cam.initialized ? cx + (predicted.x - cam.x) : cx;
        const headSY = cam.initialized ? cy + (predicted.y - cam.y) : cy;
        if (Math.hypot(mouseX - headSX, mouseY - headSY) >= AIM_DEADZONE) {
            input.angle = Math.atan2(mouseY - headSY, mouseX - headSX);
        }

        // launch gate: while the server holds the snake, predicting it
        // is pure error manufacturing — skip entirely
        if (!held) predictTick(dtFrames, now);

        const zone = (room.state as { extract?: { active: boolean; x: number; y: number; ttl: number } }).extract;
        if (zone) {
            view.drawExtract(
                zone.active, zone.x, zone.y, zone.ttl,
                players.get(myId)?.channel ?? 0,
            );
        }

        // camera fallback for the first frames (and the whole held
        // phase): center on the server's position
        const self = players.get(myId);
        if (self && !predicted.initialized) {
            cam.x = self.x;
            cam.y = self.y;
            cam.initialized = true;
            view.camera(cam.x, cam.y);
        }

        for (const [id, p] of players) {
            const isSelfHeld = id === myId && held;
            const isMe = id === myId && predicted.initialized && !held;
            const offline = p.connected === false;
            // held self renders the raw server truth (static by
            // definition); others keep their dead-reckoned present
            const other = isMe || isSelfHeld || offline
                ? undefined
                : sampleDeadReckoned(id, now, dtFrames);
            const px = isMe ? predicted.x : (other?.x ?? p.x);
            const py = isMe ? predicted.y : (other?.y ?? p.y);
            const boosting = isMe
                ? input.boost && p.score >= BOOST_ORB_VALUE && !p.graced
                : (other?.boosting ?? p.boosting);

            let body = offline
                ? (bodies.get(id) ?? [])
                : updateBody(id, px, py, p.score, boosting, dtFrames);
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
            const drawn = boosting ? { body: colors.body, head: "#ffffff" } : colors;
            const alpha = p.graced || offline ? 0.4 : 1;
            const label =
                `${p.name} ◎${(p.score / SCORE_PER_SOL).toFixed(4)}${offline ? " (offline)" : ""}`;
            view.drawSnake(id, drawn, px, py, body, dims.radius, alpha, label);

            if (isMe) {
                const rate = Math.min(CAMERA_RATE * dtFrames, 1);
                cam.x += (px - cam.x) * rate;
                cam.y += (py - cam.y) * rate;
                cam.initialized = true;
                view.camera(cam.x, cam.y);
                view.drawDebug(px, py, p.x, p.y, dims.radius);
                view.drawMinimap(px, py, zone?.active ? zone : undefined);

                // eat prediction: hide pellets the PREDICTED head is
                // eating right now — the server confirms ~RTT later
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

        // eat mispredictions: server never confirmed — pellet is
        // still alive, put its sprite back
        for (const [fid, hiddenAt] of predictedEaten) {
            if (now - hiddenAt <= EAT_CONFIRM_TIMEOUT_MS) continue;
            predictedEaten.delete(fid);
            const f = foods.get(fid);
            if (f) view.addFood(fid, f.x, f.y, f.value);
        }
    };
    view.app.ticker.add(tickerFn);

    return {
        ended,
        // end() severs the connection itself — stop() just names the
        // ending. Idempotent: a session that already ended stays ended.
        async stop() {
            end({ kind: "stopped" });
        },
    };
}
