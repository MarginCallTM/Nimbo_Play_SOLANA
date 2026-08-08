import { defineServer, defineRoom } from "colyseus";
import express from "express";
import { ARENA_ROOM, DEMO_ROOM, LOBBY_ROOM } from "@nimbo/shared";
import { ArenaRoom } from "./rooms/ArenaRoom";
import { DemoRoom } from "./rooms/DemoRoom";
import { LobbyRoom } from "./rooms/LobbyRoom";
import { issueChallenge } from "./auth";
import { loadRound, roundInfo } from "./chain";
import { loadDepositLog } from "./deposit-log";
import { ackClaim, loadOutbox, pendingClaims } from "./outbox";

// A3.2 — know which round we escrow against BEFORE accepting anyone:
// a misconfigured round must kill the boot, not the first paid join.
await loadRound();
// A3.3 — reload unsettled claims: debts survive restarts.
loadOutbox();
// A4.6 — reload consumed deposit signatures: so must the anti-replay
// set, or every restart re-opens the last 10 minutes of deposits for a
// free second spawn.
loadDepositLog();

// Shared secret for the settlement endpoints (MVP: same box, same
// operator). These two routes are the softest part of the money path:
// /pending lists every wallet we owe and how much, and /ack marks a
// debt settled — an unauthenticated ack makes a player's payout vanish
// with no on-chain trace to appeal to.
//
// Unset used to mean "open to anyone who can reach the port". It now
// means "open to LOOPBACK only" (2026-08-07): the dev convenience of
// running the settlement service on the same box is preserved, and the
// day this server gets a public interface it does not silently expose
// the debt ledger. A real deployment sets the secret.
const SETTLEMENT_SECRET = process.env.SETTLEMENT_SECRET;
if (!SETTLEMENT_SECRET) {
    console.log("[settlement] no SETTLEMENT_SECRET — /settlement/* restricted to loopback");
}

function isLoopback(req: express.Request): boolean {
    const ip = req.socket.remoteAddress ?? "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function settlementAuthorized(req: express.Request): boolean {
    if (!SETTLEMENT_SECRET) return isLoopback(req);
    return req.get("x-settlement-secret") === SETTLEMENT_SECRET;
}

const server = defineServer({
    rooms: {
        [ARENA_ROOM]: defineRoom(ArenaRoom),
        // D72/D76 — the free tutorial world: bots, fake value, no
        // wallet. Physically separate from the paid arena.
        [DEMO_ROOM]: defineRoom(DemoRoom),
        // A4.2a — the free matchmaking queue (D77/D81): SIWS identity,
        // zero money until a match is all but certain.
        [LOBBY_ROOM]: defineRoom(LobbyRoom),
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
        // A3.3 — the settlement service's two endpoints. NO CORS on
        // purpose: these are server-to-server, a browser has no
        // business here.
        app.get("/settlement/pending", (req, res) => {
            if (!settlementAuthorized(req)) {
                res.status(401).json({ error: "unauthorized" });
                return;
            }
            res.json(pendingClaims());
        });
        app.post("/settlement/ack", express.json(), (req, res) => {
            if (!settlementAuthorized(req)) {
                res.status(401).json({ error: "unauthorized" });
                return;
            }
            const { nonce, txSig } = req.body ?? {};
            if (typeof nonce !== "string" || typeof txSig !== "string") {
                res.status(400).json({ error: "nonce and txSig required" });
                return;
            }
            if (!ackClaim(nonce, txSig)) {
                res.status(404).json({ error: "unknown claim" });
                return;
            }
            console.log(`[outbox] claim ${nonce} settled — tx ${txSig.slice(0, 16)}…`);
            res.json({ ok: true });
        });
    },
});

// listen() is async: the WebSocket transport only exists once it
// resolves — anything touching the transport (simulateLatency!) must
// come AFTER the await, or it crashes on a half-built server.
// PORT lets a second instance run alongside yours (a sparring sandbox
// next to the session you are playing) — clients follow with
// SERVER_URL / VITE_SERVER_URL.
const PORT = Number(process.env.PORT ?? 2567);
await server.listen(PORT);
console.log(`arena server listening on ws://localhost:${PORT}`);

// Artificial latency for netcode testing (A1.5+): localhost has ~0ms
// RTT, so prediction/interpolation can only be SEEN with fake lag.
// Usage: SIMULATE_LATENCY_MS=200 npm run dev:server
const latency = Number(process.env.SIMULATE_LATENCY_MS ?? 0);
if (latency > 0) {
    server.simulateLatency(latency);
    console.log(`[net] simulating ${latency}ms of latency`);
}
