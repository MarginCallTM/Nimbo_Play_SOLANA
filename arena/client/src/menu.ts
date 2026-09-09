// A3.2 — launch menu (network port of proto A0.7bis): a DOM overlay
// above the Pixi canvas, never Pixi UI (free layout, no per-frame
// cost, native focus handling). Resolves with the chosen stake in SOL
// once the player clicks a tier — the caller then runs the deposit +
// join sequence and tears the menu down.

import { DEFAULT_SKIN_ID, SKINS, STAKE_TIERS_SOL } from "@nimbo/shared";
import logoUrl from "./assets/logo.png";

export interface MenuResult {
    stakeSol: number;
    name: string; // A4.11 — chosen pseudo, so deaths are correlatable
    skinId: string; // AV.11 — validated against the shared whitelist
}

const NAME_KEY = "nimbo_name";
const SKIN_KEY = "nimbo_skin";

// The umbrella site. Hard-coded rather than baked in like VITE_SERVER_URL:
// that one HAS to vary (localhost vs the VPS) because the client talks to
// it, whereas this is a public address a visitor could type by hand. If it
// ever needs to differ per environment, it becomes a build arg like the
// others — but a link does not justify one today.
const PORTAL_URL = "https://nimboplay.dev";

// Small style helper. This file builds its DOM by hand — there is no CSS
// pipeline in the client — and joining declarations by hand at every call
// site is what made the previous version hard to read.
function css(...decls: string[]): string {
    return decls.join(";");
}

const SURFACE = "#141c2b";
const SURFACE_HOVER = "#1e2a41";
const BORDER = "#2c3c5c";
const TEXT = "#e2e8f0";

function button(label: string, extra: string[] = []): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = css(
        "padding:14px 22px",
        "font:16px monospace",
        "cursor:pointer",
        `color:${TEXT}`,
        `background:${SURFACE}`,
        `border:1px solid ${BORDER}`,
        "border-radius:10px",
        "transition:background .15s,border-color .15s",
        ...extra,
    );
    b.onmouseenter = () => {
        if (!b.disabled) b.style.background = SURFACE_HOVER;
    };
    b.onmouseleave = () => {
        if (!b.disabled) b.style.background = SURFACE;
    };
    return b;
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
    // A4.11 — when present, a "report this death" button appears (paid
    // deaths only). It fires this callback, which POSTs the client-side
    // reconstruction to the server so a suspect death can be reviewed.
    onReport?: () => void | Promise<void>;
}): Promise<void> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = css(
            "position:fixed", "inset:0", "z-index:30",
            "display:flex", "flex-direction:column",
            "align-items:center", "justify-content:center", "gap:18px",
            "background:rgba(14,22,33,0.92)",
            `color:${TEXT}`, "font-family:monospace",
        );

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

        // A4.11 — "report this death": for a suspect death, one click
        // ships the client's view to the server. It stays on-screen (no
        // reload) so the tester sees the confirmation before leaving.
        if (opts.onReport) {
            const report = document.createElement("button");
            report.textContent = "⚠ REPORT THIS DEATH";
            report.style.cssText = css(
                "margin-top:6px", "padding:10px 18px", "font:13px monospace",
                "cursor:pointer", "color:#ffcc66", "background:transparent",
                "border:1px solid #ffcc66", "border-radius:8px",
            );
            report.onclick = async () => {
                report.disabled = true;
                report.style.cursor = "default";
                report.textContent = "reporting…";
                try {
                    await opts.onReport!();
                    report.textContent = "✓ reported — thanks";
                } catch {
                    report.textContent = "report failed — refresh & retry";
                }
            };
            overlay.appendChild(report);
        }

        const back = button("BACK TO MENU", [
            "margin-top:10px",
            `border:1px solid ${opts.color}`,
        ]);
        back.onclick = () => {
            overlay.remove();
            resolve();
        };
        overlay.appendChild(back);

        document.body.appendChild(overlay);
    });
}

// AV.11 — the skin swatch. Two tones of the same hue, laid out as the
// bands they will actually become on the snake, so the choice previews
// the thing itself rather than a colour chip.
function skinSwatch(skinIndex: number, selected: boolean): HTMLButtonElement {
    const skin = SKINS[skinIndex];
    const b = document.createElement("button");
    b.title = skin.label;
    b.style.cssText = css(
        "width:52px", "height:26px", "padding:0", "cursor:pointer",
        "border-radius:999px",
        `border:2px solid ${selected ? TEXT : "transparent"}`,
        // the band pattern of AV.5, frozen into a preview
        `background:repeating-linear-gradient(90deg,${skin.body} 0 12px,${skin.band} 12px 20px)`,
        "transition:border-color .15s,transform .15s",
    );
    b.onmouseenter = () => (b.style.transform = "scale(1.08)");
    b.onmouseleave = () => (b.style.transform = "scale(1)");
    return b;
}

export function showMenu(): Promise<MenuResult> {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.style.cssText = css(
            "position:fixed", "inset:0", "z-index:20",
            "display:flex", "flex-direction:column",
            "align-items:center", "justify-content:center", "gap:20px",
            // matches the arena floor's own ground (AV.3c), not the navy
            // that was retired with the old background
            "background:rgba(14,22,33,0.92)",
            `color:${TEXT}`, "font-family:monospace",
        );

        // --- top left: back to the portal -----------------------------
        //
        // "PORTAL" rather than "HOME": with three hosts (portal, arena,
        // docs) "home" names none of them, and the docs navbar already
        // calls nimboplay.dev the Portal. Same word everywhere beats a new
        // one per surface.
        //
        // A plain <a>, not a button with a handler: middle-click and
        // "open in new tab" then work the way a link is expected to, and
        // the destination shows in the status bar on hover.
        const portal = document.createElement("a");
        portal.href = PORTAL_URL;
        portal.textContent = "← PORTAL";
        portal.style.cssText = css(
            "position:absolute", "left:24px", "top:24px",
            "padding:10px 16px", "font:13px monospace", "text-decoration:none",
            `color:${TEXT}`, `background:${SURFACE}`,
            `border:1px solid ${BORDER}`, "border-radius:10px",
            "transition:background .15s",
        );
        portal.onmouseenter = () => (portal.style.background = SURFACE_HOVER);
        portal.onmouseleave = () => (portal.style.background = SURFACE);
        overlay.appendChild(portal);

        const logo = document.createElement("img");
        logo.src = logoUrl;
        logo.alt = "Nimbo Arena";
        // -10% on 2026-09-09 (user call): 480 -> 432px, 72 -> 65vw. Both
        // terms scale together so the narrow-screen behaviour keeps the
        // same proportion instead of only the desktop one shrinking.
        //
        // OPTICAL CENTRING, and it is not a fudge. Measured on a capture:
        // the lockup's bounding box centres to within half a pixel of the
        // buttons, but its luminance-weighted centre of mass sits 2.2% of
        // its own width to the RIGHT — the white wordmark carries most of
        // the visible weight while the joystick, though colourful, is a
        // dark object. The browser centres a box; the eye centres mass.
        //
        // Expressed as a percentage OF THE ELEMENT so the correction
        // tracks the logo at every viewport width, and as a transform so
        // it never disturbs the layout around it.
        logo.style.cssText = css(
            "width:min(432px,65vw)", "height:auto", "user-select:none",
            "transform:translateX(-2.2%)",
        );
        overlay.appendChild(logo);

        // A4.11 — name input. Persisted so friends don't retype it; it
        // rides into the death log + the "killed by X" screen, which is
        // what makes an "unfair death" report correlatable to a server
        // log line. Falls back to "player" if left blank.
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.maxLength = 16;
        nameInput.placeholder = "your name";
        nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
        nameInput.style.cssText = css(
            "padding:12px 16px", "font:16px monospace", "text-align:center",
            `color:${TEXT}`, `background:${SURFACE}`,
            `border:1px solid ${BORDER}`, "border-radius:10px", "outline:none",
        );
        overlay.appendChild(nameInput);

        const chosenName = () => {
            const n = (nameInput.value.trim() || "player").slice(0, 16);
            localStorage.setItem(NAME_KEY, n);
            return n;
        };

        // --- stakes: paid tiers on a grid, FREE spanning underneath ----
        //
        // The layout carries a meaning. FREE is not a fifth tier, it is a
        // DIFFERENT WORLD: off-chain, bots only, no wallet, no value, and
        // a player there never meets someone who staked (D72). Sitting it
        // in the same row as the paid tiers said the opposite. Below and
        // full width, it reads as what it is — the way in, not the
        // cheapest bet.
        const paid = STAKE_TIERS_SOL.filter((t) => t > 0);

        // one column stack: the paid grid, then FREE beneath it. The grid
        // sets the width, so FREE spans exactly the tiers above it however
        // many there are.
        const stakesWrap = document.createElement("div");
        stakesWrap.style.cssText = "display:flex;flex-direction:column;gap:12px";
        overlay.appendChild(stakesWrap);

        const stakes = document.createElement("div");
        stakes.style.cssText = css(
            "display:grid",
            `grid-template-columns:repeat(${paid.length},1fr)`,
            "gap:12px",
        );
        stakesWrap.appendChild(stakes);

        const finish = (stakeSol: number) => {
            const name = chosenName();
            const skinId = SKINS[skinIndex].id;
            localStorage.setItem(SKIN_KEY, skinId);
            overlay.remove();
            resolve({ stakeSol, name, skinId });
        };

        for (const tier of paid) {
            const b = button(`${tier} SOL`);
            b.onclick = () => finish(tier);
            stakes.appendChild(b);
        }

        // Same white as the paid tiers: the transparent background and the
        // full width already say FREE is a different thing, so dimming the
        // text on top of that made it look disabled rather than distinct.
        const free = button("FREE — practise against bots", [
            "width:100%", "font:14px monospace",
            "background:transparent",
        ]);
        free.onmouseenter = () => (free.style.background = SURFACE);
        free.onmouseleave = () => (free.style.background = "transparent");
        free.onclick = () => finish(0);
        stakesWrap.appendChild(free);

        // --- bottom left: skin picker ---------------------------------
        let skinIndex = Math.max(
            0,
            SKINS.findIndex((s) => s.id === (localStorage.getItem(SKIN_KEY) ?? DEFAULT_SKIN_ID)),
        );

        const skinCorner = document.createElement("div");
        skinCorner.style.cssText = css(
            "position:absolute", "left:24px", "bottom:24px",
            "display:flex", "flex-direction:column", "gap:10px", "align-items:flex-start",
        );
        overlay.appendChild(skinCorner);

        const palette = document.createElement("div");
        palette.style.cssText = css(
            "display:none", "gap:8px", "flex-wrap:wrap", "max-width:200px",
            "padding:12px", "border-radius:12px",
            `background:${SURFACE}`, `border:1px solid ${BORDER}`,
        );
        skinCorner.appendChild(palette);

        const skinBtn = button("SKIN", ["font:13px monospace", "padding:10px 16px"]);
        skinCorner.appendChild(skinBtn);

        // The button keeps a fixed label; the selected swatch is what says
        // which skin is current, so the label never has to move or resize.
        const swatches: HTMLButtonElement[] = [];
        const paint = () => {
            swatches.forEach((s, i) => {
                s.style.borderColor = i === skinIndex ? TEXT : "transparent";
            });
        };
        SKINS.forEach((_, i) => {
            const s = skinSwatch(i, i === skinIndex);
            s.onclick = () => {
                skinIndex = i;
                localStorage.setItem(SKIN_KEY, SKINS[i].id);
                paint();
            };
            swatches.push(s);
            palette.appendChild(s);
        });
        paint();

        skinBtn.onclick = () => {
            palette.style.display = palette.style.display === "none" ? "flex" : "none";
        };

        // --- bottom right: server picker, deliberately inert -----------
        //
        // One region exists today and the multi-region question is parked.
        // The button is here because the choice is coming, but it carries
        // "SOON" rather than pretending: a disabled control with no
        // explanation reads as something broken, and on a real-money
        // product it also advertises infrastructure that does not exist.
        const serverCorner = document.createElement("div");
        serverCorner.style.cssText = css(
            "position:absolute", "right:24px", "bottom:24px",
            "display:flex", "align-items:center", "gap:8px",
        );
        const serverBtn = button("🌐  CHOOSE SERVER   ·   SOON", [
            "font:13px monospace", "padding:10px 16px",
            "cursor:not-allowed", "opacity:.45",
        ]);
        serverBtn.disabled = true;
        serverBtn.title = "One region for now — Europe";
        serverCorner.appendChild(serverBtn);
        overlay.appendChild(serverCorner);

        document.body.appendChild(overlay);
    });
}
