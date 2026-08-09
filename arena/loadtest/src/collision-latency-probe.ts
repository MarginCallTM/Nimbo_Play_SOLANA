// A4.0 — MEASURE the "phantom hitbox" before fixing it. The residual
// complaint (playtest 2026-08-06): at high RTT the server kills you while
// your screen still shows the other snake a body-width away. This probe
// quantifies exactly that, so the ping-gate threshold is set on data, not
// on feel.
//
// HOW. Several bots hunt each other in the demo room (free, same
// simulation as the paid arena — DemoRoom extends ArenaRoom, so collision
// geometry is identical). Colyseus syncs SERVER TRUTH, so every bot's
// view of every snake is the authoritative trajectory, sampled at the
// broadcast rate. On each collision death we REPLAY the client's own
// dead-reckoning (session.ts sampleDeadReckoned: others are extrapolated
// STRAIGHT along their last-known heading, age capped at MAX_EXTRAP_MS)
// for a range of RTTs, and measure how far the killer APPEARED from the
// victim's head at the instant of the real collision.
//
//   perceived clearance(RTT) =
//       dist(victim's true head, killer AS THE CLIENT WOULD RENDER IT)
//       - (victim radius + killer radius)
//   > 0  => the victim's screen showed daylight when it actually died.
//           That gap IS the phantom hitbox, in pixels.
//
// The killer's rendered shape = [head extrapolated straight from the
// sample the victim had ~RTT/2 ago] + [the true trail up to that sample]
// (the body the client had already drawn). This is a faithful, slightly
// CONSERVATIVE model of the client: it captures the dominant effect — the
// head dead-reckoned straight while the real head curves away in a turn —
// without re-simulating the per-frame smoothing.
//
// Run from arena/:
//   npm run collision-probe                 4 bots, 90s
//   BOTS=5 DURATION_S=120 npm run collision-probe

import { Client, Callbacks, type Room } from "@colyseus/sdk";
import {
    BROADCAST_RATE,
    DEMO_ROOM,
    PROTOCOL_VERSION,
    SNAKE_SPACING,
    describeSnakeFromScore,
    type InputMessage,
} from "@nimbo/shared";

const SERVER_URL = process.env.SERVER_URL ?? "http://localhost:2567";
const NBOTS = Number(process.env.BOTS ?? 4);
const DURATION_MS = Number(process.env.DURATION_S ?? 90) * 1000;

// Mirror session.ts exactly — these ARE the client's numbers.
const MAX_EXTRAP_MS = 300;              // session.ts:81
const STATE_PATCH_MS = 1000 / BROADCAST_RATE; // session.ts:283 (+RTT/2)

const RTTS = [0, 50, 100, 150, 200, 300]; // ms round-trip to sweep
const SAMPLE_MS = 50;                      // trajectory resolution (~broadcast)
const STEER_MS = 60;                       // how often a bot sends input
const BOOST_RANGE = 450;                   // boost when the prey is this close
const BODY_TRAIL_MS = 1500;                // how far back to keep body samples

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sample { t: number; x: number; y: number; angle: number; score: number }
interface NetPlayer { name: string; x: number; y: number; angle: number; score: number }

// Global, server-truth trajectory per snake id (any observer's view is
// the same authoritative state). id -> { name, samples[] }.
const traj = new Map<string, { name: string; samples: Sample[] }>();

function record(id: string, name: string, p: NetPlayer, now: number) {
    let entry = traj.get(id);
    if (!entry) { entry = { name, samples: [] }; traj.set(id, entry); }
    const last = entry.samples[entry.samples.length - 1];
    if (last && now - last.t < SAMPLE_MS - 5) return; // one sample per tick
    entry.samples.push({ t: now, x: p.x, y: p.y, angle: p.angle, score: p.score });
    // bound memory: keep a little over the longest body we care about
    const cutoff = now - (BODY_TRAIL_MS + MAX_EXTRAP_MS + 500);
    while (entry.samples.length > 2 && entry.samples[0].t < cutoff) entry.samples.shift();
}

interface Death { victimId: string; killerName: string; kind: string; t: number }
const deaths: Death[] = [];

// --- one probe bot: joins the demo, hunts the nearest other ----------
class Bot {
    room!: Room;
    me: NetPlayer | undefined;
    others = new Map<string, NetPlayer>();
    id = "";
    alive = false;
    constructor(readonly name: string) {}

    async start() {
        const client = new Client(SERVER_URL);
        this.room = await client.joinOrCreate(DEMO_ROOM, {
            protocol: PROTOCOL_VERSION, name: this.name, stake: 0,
        });
        this.id = this.room.sessionId;
        this.wire();
        this.alive = true;
    }

    private wire() {
        this.me = undefined;
        this.others.clear();
        this.room.onMessage("*", (type, msg) => {
            if (type !== "died") return;
            const m = msg as { kind?: string; killedBy?: string } | undefined;
            // only body/head collisions carry a phantom-hitbox question;
            // border/bomb/disconnect are not about seeing another snake
            if (m?.kind === "collision" || m?.kind === "head-on") {
                deaths.push({
                    victimId: this.id,
                    killerName: m.killedBy ?? "",
                    kind: m.kind,
                    t: Date.now(),
                });
            }
            this.alive = false;
            void this.respawn();
        });
        const cb = Callbacks.get(this.room);
        cb.onAdd("players", (p, id) => {
            if (String(id) === this.room.sessionId) this.me = p as NetPlayer;
            else this.others.set(String(id), p as NetPlayer);
        });
        cb.onRemove("players", (_p, id) => {
            if (String(id) === this.room.sessionId) this.me = undefined;
            else this.others.delete(String(id));
        });
    }

    private async respawn() {
        try { await this.room.leave(true); } catch { /* already gone */ }
        await sleep(700);
        if (Date.now() > deadline) return; // run is over
        try {
            const client = new Client(SERVER_URL);
            this.room = await client.joinOrCreate(DEMO_ROOM, {
                protocol: PROTOCOL_VERSION, name: this.name, stake: 0,
            });
            this.id = this.room.sessionId;
            this.wire();
            this.alive = true;
        } catch { /* server busy; the sampler will retry via next death */ }
    }

    // hunt the nearest other; boost when close -> curved, colliding
    // approaches (the turns are exactly where dead-reckoning breaks)
    steer() {
        if (!this.me || !this.alive) return;
        let prey: NetPlayer | undefined;
        let best = Infinity;
        for (const p of this.others.values()) {
            const d = (p.x - this.me.x) ** 2 + (p.y - this.me.y) ** 2;
            if (d < best) { best = d; prey = p; }
        }
        const input: InputMessage = this.me
            ? { angle: prey ? Math.atan2(prey.y - this.me.y, prey.x - this.me.x) : 0,
                boost: prey ? best < BOOST_RANGE ** 2 : false }
            : { angle: 0, boost: false };
        try { this.room.send("input", input); } catch { /* between rooms */ }
    }

    sample(now: number) {
        if (this.me) record(this.id, this.name, this.me, now);
        for (const [id, p] of this.others) record(id, p.name, p, now);
    }
}

// --- geometry ---------------------------------------------------------
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function distToPolyline(px: number, py: number, pts: { x: number; y: number }[]): number {
    if (pts.length === 0) return Infinity;
    if (pts.length === 1) return Math.hypot(px - pts[0].x, py - pts[0].y);
    let min = Infinity;
    for (let i = 0; i + 1 < pts.length; i += 1) {
        const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        if (d < min) min = d;
    }
    return min;
}
function sampleAt(samples: Sample[], t: number): Sample | undefined {
    // last sample at or before t (what a client would already have)
    let found: Sample | undefined;
    for (const s of samples) { if (s.t <= t) found = s; else break; }
    return found;
}
// px/ms around a sample, from finite differences (models the speed the
// client dead-reckons with, turn included)
function speedAt(samples: Sample[], idx: number): number {
    const a = samples[Math.max(0, idx - 2)];
    const b = samples[idx];
    const dt = b.t - a.t;
    return dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0.24; // ~240px/s fallback
}

// The phantom clearance for one death at one RTT. undefined if we lack
// the trajectory to judge it honestly.
function perceivedClearance(d: Death, killerId: string, rtt: number): number | undefined {
    const victim = traj.get(d.victimId);
    const killer = traj.get(killerId);
    if (!victim || !killer) return undefined;
    const vHead = sampleAt(victim.samples, d.t) ?? victim.samples[victim.samples.length - 1];
    if (!vHead) return undefined;

    const vR = describeSnakeFromScore(vHead.score).radius;

    // what the victim's client HAD of the killer: newest sample ~RTT/2 ago
    const tSeen = d.t - rtt / 2;
    const seenIdx = (() => {
        let idx = -1;
        for (let i = 0; i < killer.samples.length; i += 1) {
            if (killer.samples[i].t <= tSeen) idx = i; else break;
        }
        return idx;
    })();
    if (seenIdx < 0) return undefined;
    const newest = killer.samples[seenIdx];
    const kR = describeSnakeFromScore(newest.score).radius;

    // extrapolate the head STRAIGHT along its last-known heading, aged by
    // how stale the sample is at render time (capped) — session.ts:316-318
    const age = Math.min(d.t - newest.t, MAX_EXTRAP_MS);
    const speed = speedAt(killer.samples, seenIdx);
    const headX = newest.x + Math.cos(newest.angle) * speed * age;
    const headY = newest.y + Math.sin(newest.angle) * speed * age;

    // perceived body = the true trail the client already had (up to tSeen)
    const body: { x: number; y: number }[] = [{ x: headX, y: headY }];
    for (let i = seenIdx; i >= 0 && newest.t - killer.samples[i].t <= BODY_TRAIL_MS; i -= 1) {
        body.push({ x: killer.samples[i].x, y: killer.samples[i].y });
    }
    const perceivedDist = distToPolyline(vHead.x, vHead.y, body);
    return perceivedDist - (vR + kR);
}

// resolve killedBy (a NAME) to the id nearest the victim at death time
function resolveKiller(d: Death): string | undefined {
    const vHead = traj.get(d.victimId)?.samples.slice(-1)[0];
    let bestId: string | undefined;
    let bestD = Infinity;
    for (const [id, e] of traj) {
        if (id === d.victimId || e.name !== d.killerName) continue;
        const s = sampleAt(e.samples, d.t);
        if (!s || !vHead) { if (!bestId) bestId = id; continue; }
        const dd = Math.hypot(s.x - vHead.x, s.y - vHead.y);
        if (dd < bestD) { bestD = dd; bestId = id; }
    }
    return bestId;
}

// --- run --------------------------------------------------------------
let deadline = 0;
const bots: Bot[] = [];
for (let i = 0; i < NBOTS; i += 1) bots.push(new Bot(`probe-${i}`));

console.log(`[collision-probe] ${NBOTS} bots vs demo @ ${SERVER_URL}, ${DURATION_MS / 1000}s`);
await Promise.all(bots.map((b) => b.start().catch((e) => console.error(`join failed: ${(e as Error).message}`))));
deadline = Date.now() + DURATION_MS;

const sampler = setInterval(() => bots.forEach((b) => b.sample(Date.now())), SAMPLE_MS);
const steerer = setInterval(() => bots.forEach((b) => b.steer()), STEER_MS);

while (Date.now() < deadline) {
    await sleep(5000);
    console.log(`[collision-probe] ${Math.round((deadline - Date.now()) / 1000)}s left — ${deaths.length} collision deaths so far`);
}
clearInterval(sampler);
clearInterval(steerer);
// Fire-and-forget close: leave() can HANG on a room mid-reconnect, and
// an awaited hang here drains the loop before the analysis runs (Node
// exits 13). We don't need a clean close — process.exit(0) at the end
// tears every socket down anyway.
for (const b of bots) { try { void b.room?.leave(true); } catch { /* gone */ } }

// --- analysis ---------------------------------------------------------
console.log(`\n=== ${deaths.length} collision deaths recorded ===`);
let resolved = 0;
const perRtt = new Map<number, number[]>(RTTS.map((r) => [r, []]));
for (const d of deaths) {
    const killerId = resolveKiller(d);
    if (!killerId) continue;
    let any = false;
    for (const rtt of RTTS) {
        const c = perceivedClearance(d, killerId, rtt);
        if (c !== undefined) { perRtt.get(rtt)!.push(c); any = true; }
    }
    if (any) resolved += 1;
}

console.log(`resolved ${resolved}/${deaths.length} (had both trajectories)\n`);

// --- DEBUG: dump the raw geometry of the first deaths at RTT=0 so a
// bogus control (gap should be ~0 with no latency) is diagnosable.
if (process.env.DEBUG) {
    let shown = 0;
    for (const d of deaths) {
        if (shown >= 8) break;
        const killerId = resolveKiller(d);
        if (!killerId) continue;
        const victim = traj.get(d.victimId)!;
        const killer = traj.get(killerId)!;
        const vHead = sampleAt(victim.samples, d.t) ?? victim.samples.slice(-1)[0];
        const kNew = sampleAt(killer.samples, d.t) ?? killer.samples.slice(-1)[0];
        if (!vHead || !kNew) continue;
        const vR = describeSnakeFromScore(vHead.score).radius;
        const kR = describeSnakeFromScore(kNew.score).radius;
        const headDist = Math.hypot(vHead.x - kNew.x, vHead.y - kNew.y);
        const bodyDist = distToPolyline(vHead.x, vHead.y, killer.samples.filter((s) => s.t <= d.t).slice(-40));
        console.log(
            `[dbg] ${d.kind} victim vAge=${(d.t - vHead.t)}ms kAge=${(d.t - kNew.t)}ms` +
            ` head-head=${headDist.toFixed(0)} head-body=${bodyDist.toFixed(0)}` +
            ` reach=${(vR + kR).toFixed(0)} kSamples=${killer.samples.length}`,
        );
        shown += 1;
    }
    console.log("");
}

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(0) : "0").padStart(3);
const quant = (arr: number[], q: number) =>
    arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0;

console.log("RTT     n   looked-safe   >body-width   median gap   p90 gap");
console.log("            (killer appeared clear of the victim's head at the real hit)");
for (const rtt of RTTS) {
    const gaps = perRtt.get(rtt)!;
    if (gaps.length === 0) { console.log(`${String(rtt).padStart(3)}ms    0   (no data)`); continue; }
    const positive = gaps.filter((g) => g > 0);              // looked clear
    const bodyWidth = gaps.filter((g) => g > 20).length;      // by > ~a body width
    console.log(
        `${String(rtt).padStart(3)}ms  ${String(gaps.length).padStart(3)}   ` +
        `${pct(positive.length, gaps.length)}%           ` +
        `${pct(bodyWidth, gaps.length)}%          ` +
        `${(positive.length ? "+" + quant(positive, 0.5).toFixed(0) : "0").padStart(5)}px    ` +
        `${(positive.length ? "+" + quant(positive, 0.9).toFixed(0) : "0").padStart(5)}px`,
    );
}
console.log("\nlooked-safe %  = share of collision deaths where, on the victim's screen,");
console.log("                 the killer rendered CLEAR of its head (positive gap)");
console.log(">body-width %  = share where that apparent gap exceeded ~20px (one body width)");
console.log("gap px         = median / p90 apparent clearance among the looked-safe deaths");
console.log("(RTT 0 is the control: any 'safe' there is measurement noise, not latency)");
process.exit(0);
