import { defineServer, defineRoom } from "colyseus";
import { ARENA_ROOM } from "@nimbo/shared";
import { ArenaRoom } from "./rooms/ArenaRoom";

const server = defineServer({
    rooms: {
        [ARENA_ROOM]: defineRoom(ArenaRoom),
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
