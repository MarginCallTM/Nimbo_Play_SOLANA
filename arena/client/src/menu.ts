// A3.2 — launch menu (network port of proto A0.7bis): a DOM overlay
// above the Pixi canvas, never Pixi UI (free layout, no per-frame
// cost, native focus handling). Resolves with the chosen stake in SOL
// once the player clicks a tier — the caller then runs the deposit +
// join sequence and tears the menu down.

import { STAKE_TIERS_SOL } from "@nimbo/shared";

export interface MenuResult {
    stakeSol: number;
}

// End-of-run screen (proto's openMenu("EXTRACTED +X" / "YOU DIED —")
// flavor): big verdict, the amount, one button. Resolves on click —
// the caller decides what "back to menu" means (a full reload: every
// netcode buffer, prediction history and room handle dies with the
// page, which is exactly what we want after leaving a room).
export function showGameOver(opts: {
    title: string;    // "EXTRACTED" | "GAME OVER"
    amount: string;   // "◎0.0925 secured" | "◎0.0845 left on the field"
    detail?: string;  // optional smaller line (nonce, payout note)
    color: string;    // verdict color: green for cash-out, red for death
}): Promise<void> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:30",
            "display:flex", "flex-direction:column",
            "align-items:center", "justify-content:center", "gap:18px",
            "background:rgba(11,16,32,0.92)",
            "color:#e2e8f0", "font-family:monospace",
        ].join(";");

        const title = document.createElement("div");
        title.textContent = opts.title;
        title.style.cssText = `font-size:42px;letter-spacing:8px;color:${opts.color}`;
        overlay.appendChild(title);

        const amount = document.createElement("div");
        amount.textContent = opts.amount;
        amount.style.cssText = "font-size:22px";
        overlay.appendChild(amount);

        if (opts.detail) {
            const detail = document.createElement("div");
            detail.textContent = opts.detail;
            detail.style.cssText = "font-size:13px;opacity:0.6";
            overlay.appendChild(detail);
        }

        const btn = document.createElement("button");
        btn.textContent = "BACK TO MENU";
        btn.style.cssText = [
            "margin-top:10px", "padding:14px 22px", "font:16px monospace",
            "cursor:pointer", "color:#e2e8f0", "background:#1a2340",
            `border:1px solid ${opts.color}`, "border-radius:8px",
        ].join(";");
        btn.onclick = () => {
            overlay.remove();
            resolve();
        };
        overlay.appendChild(btn);

        document.body.appendChild(overlay);
    });
}

export function showMenu(): Promise<MenuResult> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = [
            "position:fixed", "inset:0", "z-index:20",
            "display:flex", "flex-direction:column",
            "align-items:center", "justify-content:center", "gap:24px",
            "background:rgba(11,16,32,0.92)",
            "color:#e2e8f0", "font-family:monospace",
        ].join(";");

        const title = document.createElement("div");
        title.textContent = "NIMBO ARENA";
        title.style.cssText = "font-size:42px;letter-spacing:8px;color:#6a9bf5";
        overlay.appendChild(title);

        const hint = document.createElement("div");
        hint.textContent = "pick your stake — bigger stake, bigger spawn";
        hint.style.cssText = "font-size:14px;opacity:0.7";
        overlay.appendChild(hint);

        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:12px";
        overlay.appendChild(row);

        for (const tier of STAKE_TIERS_SOL) {
            const btn = document.createElement("button");
            btn.textContent = tier === 0 ? "FREE" : `${tier} SOL`;
            btn.style.cssText = [
                "padding:14px 22px", "font:16px monospace", "cursor:pointer",
                "color:#e2e8f0", "background:#1a2340",
                "border:1px solid #6a9bf5", "border-radius:8px",
            ].join(";");
            btn.onmouseenter = () => (btn.style.background = "#27335c");
            btn.onmouseleave = () => (btn.style.background = "#1a2340");
            btn.onclick = () => {
                overlay.remove();
                resolve({ stakeSol: tier });
            };
            row.appendChild(btn);
        }

        document.body.appendChild(overlay);
    });
}
