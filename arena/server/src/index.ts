import { defineServer, defineRoom } from "colyseus";
import { ARENA_ROOM, DEMO_ROOM } from "@nimbo/shared";
import { ArenaRoom } from "./rooms/ArenaRoom";
import { DemoRoom } from "./rooms/DemoRoom";
import { issueChallenge } from "./auth";
import { loadRound, roundInfo } from "./chain";

// A3.2 — know which round we escrow against BEFORE accepting anyone:
// a misconfigured round must kill the boot, not the first paid join.
await loadRound();

const server = defineServer({
    rooms: {
        [ARENA_ROOM]: defineRoom(ArenaRoom),
        // D72/D76 — the free tutorial world: bots, fake value, no
        // wallet. Physically separate from the paid arena.
        [DEMO_ROOM]: defineRoom(DemoRoom),
    },
    // A3.1 — SIWS challenge endpoint. The nonce lives server-side from
    // birth: the client never chooses it, it only signs it.
    express: (app) => {
        app.get("/auth/challenge", (_req, res) => {
            // the game client runs on another origin (vite :5173);
            // a GET with no custom headers needs only this one header
            res.set("Access-Control-Allow-Origin", "*");
            res.json(issueChallenge());
        });
        // A3.2 — the round the arena currently escrows on. The client
        // builds its deposit tx from this; it hardcodes nothing.
        app.get("/round", (_req, res) => {
            res.set("Access-Control-Allow-Origin", "*");
            const info = roundInfo();
            if (!info) {
                res.status(503).json({ error: "no active round (free-only mode)" });
                return;
            }
            res.json(info);
        });
    },
});

// listen() is async: the WebSocket transport only exists once it
// resolves — anything touching the transport (simulateLatency!) must
// come AFTER the await, or it crashes on a half-built server.
await server.listen(2567);
console.log("arena server listening on ws://localhost:2567");

// Artificial latency for netcode testing (A1.5+): localhost has ~0ms
// RTT, so prediction/interpolation can only be SEEN with fake lag.
// Usage: SIMULATE_LATENCY_MS=200 npm run dev:server
const latency = Number(process.env.SIMULATE_LATENCY_MS ?? 0);
if (latency > 0) {
    server.simulateLatency(latency);
    console.log(`[net] simulating ${latency}ms of latency`);
}
