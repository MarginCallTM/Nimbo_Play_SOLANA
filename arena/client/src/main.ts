// A4.2a — the orchestrator. All netcode lives in session.ts, the
// queue traversal in lobby.ts; this file only tells the story:
//
//   FREE  : menu -> demo session -> end screen -> reload
//   PAID  : menu -> SIWS -> free queue (D77) -> demo warm-up loop
//           -> matchFound/accept (D81) -> depositNow -> SIWS again
//           -> deposit -> arena session (launch gate, then live)
//           -> end screen (extracted / died / refunded) -> reload
//
// The page reloads ONLY at the very end of a run: in between, rooms
// are entered and left within one page (reloading while queued would
// close the lobby socket = desertion, and the partner would be sent
// back to the queue).
//
// TWO SIWS popups on the paid path is by design, not an oversight:
// nonces are single-use (the replay protection auth-attack.ts
// proves) — the lobby join consumed the first one, the arena door
// needs a fresh proof.

import { Client } from "@colyseus/sdk";
import {
    ARENA_ROOM,
    DEMO_ROOM,
    PROTOCOL_VERSION,
    type DiedMessage,
    type JoinOptions,
} from "@nimbo/shared";
import { GameView } from "./render";
import { sendJoinDeposit, signInWithSolana } from "./wallet";
import { showGameOver, showMenu } from "./menu";
import { enterQueue } from "./lobby";
import { startGameSession, type SessionEnd } from "./session";

const statusEl = document.getElementById("status")!;
// Baked in at BUILD time by Vite (import.meta.env.VITE_*). Localhost is
// the dev default; a Docker/VPS build passes VITE_SERVER_URL so the
// browser reaches the real game server instead of the visitor's own
// machine. The SIWS domain is separate — the client always signs with
// window.location.host (wallet.ts), so the SERVER's AUTH_DOMAIN must
// match wherever this bundle is served from.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:2567";
const NAME = "tester";

const solOf = (lamports: string) => (Number(lamports) / 1e9).toFixed(4);

// Phantom's transaction simulation is unreliable on devnet against a
// custom program (our escrow): it often shows a scary "simulation
// failed" warning even when the transaction is valid and lands fine
// (proven via a clean RPC simulation — the deposit really goes through).
// Say so at the wallet popup so a first-time tester does not bail.
const depositStatus = (sol: number) =>
    `depositing ${sol} SOL — approve in Phantom.` +
    ` A devnet “simulation failed” warning is normal — the transaction is valid.`;

// A4.6d — the server knows who ended your run; say it. Before this the
// answer only existed in a server log line. The name is rendered with
// textContent (menu.ts), so a hostile name is inert markup here.
function deathDetail(msg: DiedMessage): string {
    const who = msg.killedBy || "someone";
    switch (msg.kind) {
        case "border": return "you hit the world border";
        case "bomb": return "the extract zone closed on you";
        case "collision": return `you ran into ${who}`;
        case "head-on": return `head-on with ${who} — you both died`;
        default: return "";
    }
}

// One end screen per ending, then a clean slate: the reload kills
// every buffer, handler and room handle with the page — exactly what
// we want after leaving a run.
async function endScreens(end: SessionEnd, isDemo: boolean): Promise<never> {
    if (end.kind === "extracted") {
        await showGameOver({
            title: "EXTRACTED",
            amount: isDemo
                ? `score ${end.msg.score.toFixed(1)} — demo, nothing real`
                : `◎${solOf(end.msg.lamports)} secured`,
            detail: isDemo
                ? "stake real SOL to extract real SOL"
                : `payout pending — claim #${end.msg.nonce}`,
            color: "#50fa7b",
        });
    } else if (end.kind === "died") {
        await showGameOver({
            title: "GAME OVER",
            amount: isDemo
                ? `score ${end.msg.score.toFixed(1)} lost — demo, nothing real`
                : `◎${solOf(end.msg.lamports)} left on the field`,
            detail: deathDetail(end.msg),
            color: "#f63963",
        });
    } else if (end.kind === "refunded") {
        // A4.2a — the launch gate timed out: nothing was at risk, the
        // deposit (minus the on-chain rake) rides the settlement rails
        await showGameOver({
            title: "REFUNDED",
            amount: `◎${solOf(end.msg.lamports)} on its way back`,
            detail: `no opponent showed up — claim #${end.msg.nonce}`,
            color: "#ffcc66",
        });
    } else {
        await showGameOver({
            title: "DISCONNECTED",
            amount: "connection to the room was lost",
            color: "#ffcc66",
        });
    }
    location.reload();
    return new Promise<never>(() => {}); // the reload never returns
}

async function main() {
    // Pixi first: if the GPU init fails there is nothing to play on
    const view = await GameView.create();
    const { stakeSol } = await showMenu();
    const client = new Client(SERVER_URL);

    // D72/D76 — FREE routes to the demo: off-chain, bots, fake value,
    // no wallet involved at any point.
    if (stakeSol === 0) {
        statusEl.textContent = "joining the demo — no wallet needed…";
        const demo = await startGameSession(
            client,
            DEMO_ROOM,
            { protocol: PROTOCOL_VERSION, name: NAME, stake: 0 },
            view,
        );
        await endScreens(await demo.ended, true);
        return;
    }

    // --- paid path: queue first, money only when a match is certain --
    statusEl.textContent = "sign in with your wallet…";
    client.auth.token = await signInWithSolana(SERVER_URL);

    // Dev escape hatch (?direct): skip the queue and walk straight to
    // the arena door, old-flow style. LEGITIMATE by design — the lobby
    // is matchmaking, not a security gate; the arena's real door stays
    // the verified deposit. Lets a single wallet test the launch gate
    // and the solo fast-path drain (the lobby's one-seat-per-wallet
    // guard makes those untestable alone otherwise).
    if (new URLSearchParams(location.search).has("direct")) {
        statusEl.textContent = depositStatus(stakeSol);
        const directSig = await sendJoinDeposit(SERVER_URL, stakeSol);
        statusEl.textContent = "deposit confirmed — joining the arena…";
        const direct = await startGameSession(
            client,
            ARENA_ROOM,
            { protocol: PROTOCOL_VERSION, name: NAME, stake: stakeSol, txSig: directSig },
            view,
        );
        await endScreens(await direct.ended, false);
        return;
    }

    statusEl.textContent = "joining the queue…";
    const lobby = await enterQueue(client, NAME);

    // Track the queue outcome WITHOUT awaiting it: the warm-up loop
    // below races it against demo sessions. (Two separate flags — TS
    // cannot follow a union mutated from promise callbacks.)
    let matchReady = false;
    let dropped: Error | undefined;
    lobby.depositNow.then(
        () => (matchReady = true),
        (err: Error) => (dropped = err),
    );
    // a settled twin of depositNow that never throws inside the race
    const queueSettled = lobby.depositNow.catch(() => {});

    // D77 — the wait IS the demo: play against the bots until the
    // lobby says pay (or drops us). A demo death here just respawns a
    // fresh session — we never leave the queue.
    while (!matchReady && !dropped) {
        const warmup = await startGameSession(
            client,
            DEMO_ROOM,
            { protocol: PROTOCOL_VERSION, name: NAME, stake: 0 },
            view,
        );
        await Promise.race([warmup.ended, queueSettled]);
        await warmup.stop(); // no-op if the demo run already ended
    }
    if (dropped) {
        // A4.0 — the ping gate is its OWN outcome, not a missed match:
        // a distinct, non-punitive screen that points to free play.
        const pingGated = dropped.name === "PingGate";
        await showGameOver({
            title: pingGated ? "PING TOO HIGH" : "MATCH MISSED",
            amount: dropped.message,
            detail: pingGated
                ? "you can still play FREE — or use a wired / closer connection for real-money games"
                : "rejoin the queue from the menu",
            color: "#ffcc66",
        });
        location.reload();
        return;
    }

    // --- deposit window (D81 step 2): 30s to sign and confirm --------
    let txSig: string;
    try {
        statusEl.textContent = "match ready — sign in for the arena…";
        client.auth.token = await signInWithSolana(SERVER_URL);
        statusEl.textContent = depositStatus(stakeSol);
        txSig = await sendJoinDeposit(SERVER_URL, stakeSol);
    } catch (err) {
        // Phantom rejected / tx failed / window expired server-side:
        // no deposit happened, nothing is lost — back to the menu.
        await showGameOver({
            title: "DEPOSIT FAILED",
            amount: (err as Error).message,
            detail: "nothing was spent — rejoin the queue from the menu",
            color: "#f63963",
        });
        location.reload();
        return;
    }

    statusEl.textContent = "deposit confirmed — joining the arena…";
    const arena = await startGameSession(
        client,
        ARENA_ROOM,
        { protocol: PROTOCOL_VERSION, name: NAME, stake: stakeSol, txSig },
        view,
    );
    // the lobby removes us by itself once the deposit spawns
    // (fulfillment, server truth) — nothing to do with the handle here
    await endScreens(await arena.ended, false);
}

main().catch((err) => (statusEl.textContent = `ERROR: ${(err as Error).message}`));
