// Repro probe #2 (2026-08-05): the EXACT user flow — extract in the
// demo, then respawn — with measurements. The rejoin-only probe shows
// state + onAdd are healthy, so this one (a) actually extracts (steer
// to the zone, channel 4s), (b) rejoins zombie-style (the client's
// stop() bug: session ended, room never left), and (c) reports every
// player's DISTANCE from our spawn — testing the "bots exist but are
// all off-screen" illusion theory (minimap shows self+extract only).
//
// Usage: npx tsx src/demo-extract-probe.ts   (server must be running)

import { Client, type Room } from "@colyseus/sdk";
import { DEMO_ROOM, PROTOCOL_VERSION } from "@nimbo/shared";

const ENDPOINT = process.env.ENDPOINT ?? "ws://localhost:2567";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function joinDemo(client: Client): Promise<Room> {
    const room = await client.joinOrCreate(DEMO_ROOM, {
        protocol: PROTOCOL_VERSION,
        name: "probe",
        stake: 0,
    });
    room.onMessage("*", () => {});
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
    return room;
}

function survey(tag: string, room: Room) {
    const state = room.state as any;
    const me = state.players.get(room.sessionId);
    const lines: string[] = [];
    state.players.forEach((p: any, id: string) => {
        if (id === room.sessionId) return;
        const d = me ? Math.hypot(p.x - me.x, p.y - me.y) : NaN;
        lines.push(`    ${p.name}@(${p.x.toFixed(0)},${p.y.toFixed(0)}) dist=${d.toFixed(0)}px`);
    });
    console.log(`${tag}: roomId=${room.roomId} players=${state.players.size} me=${me ? "yes" : "GONE"}`);
    for (const l of lines) console.log(l);
}

const client = new Client(ENDPOINT);
const roomA = await joinDemo(client);
console.log(`joined ${roomA.roomId} as ${roomA.sessionId}`);

// steer toward the extract zone (wait for one to spawn), then let the
// spatial channel rule do the rest — 4s inside = extracted
let extracted = false;
roomA.onMessage("extracted", () => (extracted = true));
const steer = setInterval(() => {
    const state = roomA.state as any;
    const me = state.players.get(roomA.sessionId);
    const zone = state.extract;
    if (!me || !zone?.active) return;
    const angle = Math.atan2(zone.y - me.y, zone.x - me.x);
    roomA.send("input", { angle, boost: false });
}, 100);

const deadline = Date.now() + 90_000;
while (!extracted && Date.now() < deadline) await sleep(250);
clearInterval(steer);
if (!extracted) {
    console.log("FAIL: never managed to extract within 90s");
    process.exit(1);
}
console.log("extracted from the demo — now the zombie respawn");
survey("post-extract (old room object)", roomA);

// the client bug flavor: the session ended, the room was NEVER left
const roomB = await joinDemo(client);
await sleep(1500);
survey("respawn session", roomB);

await roomA.leave().catch(() => {});
await roomB.leave().catch(() => {});
process.exit(0);
