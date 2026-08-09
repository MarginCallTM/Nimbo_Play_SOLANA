// A4.2a — client side of the free matchmaking queue (D77/D81). The
// whole traversal is condensed into ONE promise: `depositNow`
// resolves when it is time to pay (everyone accepted, or solo
// fast-path into an existing game), and rejects when the lobby drops
// us (decline, AFK, missed deposit). main.ts races that promise
// against demo warm-up sessions.
//
// UI pieces, all DOM overlays above the canvas (menu.ts rule):
//   - queue chip (top center): position in line, always visible
//   - matchFound overlay: ACCEPT / DECLINE + countdown (D81 free click)
//   - toast: partner deserted -> back at the head of the queue

import { Client, type Room } from "@colyseus/sdk";
import {
    LOBBY_ROOM,
    PROTOCOL_VERSION,
    type DepositNowMessage,
    type MatchCancelledMessage,
    type MatchFoundMessage,
    type PingTooHighMessage,
} from "@nimbo/shared";

export interface LobbyHandle {
    // resolves: deposit window open — go pay and join the arena.
    // rejects: we were dropped from the queue (reason in the Error).
    depositNow: Promise<void>;
    leave(): Promise<void>;
}

function makeChip(): HTMLElement {
    const chip = document.createElement("div");
    chip.style.cssText = [
        "position:fixed", "top:14px", "left:50%", "transform:translateX(-50%)",
        "z-index:25", "padding:8px 16px", "border-radius:8px",
        "background:rgba(26,35,64,0.92)", "border:1px solid #6a9bf5",
        "color:#e2e8f0", "font:13px monospace",
    ].join(";");
    chip.textContent = "joining the queue…";
    document.body.appendChild(chip);
    return chip;
}

function toast(text: string) {
    const el = document.createElement("div");
    el.style.cssText = [
        "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
        "z-index:25", "padding:10px 18px", "border-radius:8px",
        "background:rgba(26,35,64,0.95)", "border:1px solid #ffcc66",
        "color:#e2e8f0", "font:13px monospace",
    ].join(";");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
}

export async function enterQueue(client: Client, name: string): Promise<LobbyHandle> {
    // SIWS token already on the client (set by main.ts): the lobby's
    // onAuth wants identity, never money.
    const room: Room = await client.joinOrCreate(LOBBY_ROOM, {
        protocol: PROTOCOL_VERSION,
        name,
        stake: 0,
    });
    room.onMessage("*", () => {}); // silence unhandled-type warnings
    // A4.0 — bounce the server's RTT probe back so the ping gate (which
    // runs HERE, before the deposit) measures this player's latency on
    // the server's own clock. Specific handlers win over the "*" above.
    room.onMessage("srvping", (t: number) => room.send("srvpong", t));

    const chip = makeChip();
    let acceptOverlay: HTMLElement | undefined;
    let countdown: ReturnType<typeof setInterval> | undefined;

    function clearAccept() {
        if (countdown) clearInterval(countdown);
        countdown = undefined;
        acceptOverlay?.remove();
        acceptOverlay = undefined;
    }

    // D81 two-step ready-check, step 1: the FREE click. Declining (or
    // ignoring it) costs us the seat, never the partner's money.
    function showAccept(seconds: number) {
        clearAccept();
        acceptOverlay = document.createElement("div");
        acceptOverlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:26",
            "display:flex", "flex-direction:column",
            "align-items:center", "justify-content:center", "gap:16px",
            "background:rgba(11,16,32,0.85)",
            "color:#e2e8f0", "font-family:monospace",
        ].join(";");

        const title = document.createElement("div");
        title.textContent = "MATCH FOUND";
        title.style.cssText = "font-size:34px;letter-spacing:6px;color:#50fa7b";

        const timer = document.createElement("div");
        timer.style.cssText = "font-size:15px;opacity:0.8";
        let left = seconds;
        timer.textContent = `accept within ${left}s — accepting is free`;
        countdown = setInterval(() => {
            left -= 1;
            if (left >= 0) timer.textContent = `accept within ${left}s — accepting is free`;
        }, 1000);

        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:12px";
        const mkBtn = (label: string, color: string) => {
            const b = document.createElement("button");
            b.textContent = label;
            b.style.cssText = [
                "padding:14px 26px", "font:16px monospace", "cursor:pointer",
                "color:#e2e8f0", "background:#1a2340",
                `border:1px solid ${color}`, "border-radius:8px",
            ].join(";");
            return b;
        };
        const accept = mkBtn("ACCEPT", "#50fa7b");
        accept.onclick = () => {
            room.send("accept");
            accept.disabled = true;
            accept.textContent = "ACCEPTED";
            title.textContent = "WAITING FOR OPPONENT…";
            title.style.color = "#ffcc66";
        };
        const decline = mkBtn("DECLINE", "#f63963");
        // the server answers with matchCancelled(requeued=false) and
        // kicks us — the rejection path below handles the rest
        decline.onclick = () => room.send("decline");
        row.append(accept, decline);

        acceptOverlay.append(title, timer, row);
        document.body.appendChild(acceptOverlay);
    }

    const depositNow = new Promise<void>((resolve, reject) => {
        let done = false; // promises settle once; this guards the UI paths

        room.onMessage("matchFound", (msg: MatchFoundMessage) => showAccept(msg.seconds));

        // step 2: everyone accepted (or solo fast-path) — time to pay.
        // The chip stays down from here: the deposit flow owns the UI.
        room.onMessage("depositNow", (_msg: DepositNowMessage) => {
            done = true;
            clearAccept();
            chip.remove();
            resolve();
        });

        // A4.0 — refused entry to real-money play for a too-high ping.
        // NOT a desertion: no penalty. A distinct error name lets main.ts
        // show a dedicated, non-punitive screen (play FREE instead).
        room.onMessage("pingTooHigh", (msg: PingTooHighMessage) => {
            done = true;
            clearAccept();
            chip.remove();
            const err = new Error(
                `your ping is ${msg.rttMs} ms — the limit for real-money play is ${msg.limitMs} ms`,
            );
            err.name = "PingGate";
            reject(err);
        });

        room.onMessage("matchCancelled", (msg: MatchCancelledMessage) => {
            clearAccept();
            if (msg.requeued) {
                // innocent path (D77): head of the queue, no cost —
                // stay in the warm-up, the chip keeps counting
                toast(`opponent bailed (${msg.reason}) — you are back at the head of the queue`);
            } else {
                done = true;
                chip.remove();
                reject(new Error(`dropped from the queue: ${msg.reason}`));
            }
        });

        // kicked or connection lost BEFORE the deposit window opened =
        // we are out of the queue. After resolve this fires too (the
        // server removes fulfilled members) — the guard makes it moot.
        room.onLeave(() => {
            if (done) return;
            clearAccept();
            chip.remove();
            reject(new Error("disconnected from the lobby"));
        });
    });

    // queue position, straight from the synced state (1-based; 0 while
    // in a pending match — keep the last shown value then)
    room.onStateChange(() => {
        const state = room.state as {
            players?: Map<string, { status: string; position: number }>;
        };
        const me = state.players?.get(room.sessionId);
        if (me && me.status === "queued" && me.position > 0) {
            chip.textContent = `IN QUEUE #${me.position} — warm up against the bots`;
        }
    });

    return {
        depositNow,
        leave: () => room.leave().then(() => undefined),
    };
}
