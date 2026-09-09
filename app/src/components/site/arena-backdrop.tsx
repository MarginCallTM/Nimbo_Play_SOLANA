// The live arena, embedded as scenery behind the closing CTA.
//
// WHY AN IFRAME AND NOT THE SIMULATION ITSELF. The backdrop lives in the
// game client (arena/client/src/backdrop.ts) and draws through the game's
// own renderer, so it looks EXACTLY like the game. Porting it here meant
// adding PixiJS to the portal — 225 KB gzipped on a marketing page, plus
// a new dependency and its Alpine lockfile ritual — and, worse, a second
// copy that would drift from the game every time the renderer improves.
//
// The iframe runs the same build. Any future rendering work lands in both
// places at once, with no second implementation to keep in step.
//
// The embedded page runs with `?backdrop`, which the client reads to skip
// the menu, the HUD and — importantly — every network connection. Nothing
// here holds a socket to the game server.
"use client";

import { useEffect, useRef, useState } from "react";
import { ARENA_URL } from "@/lib/constants";

export function ArenaBackdrop() {
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Mount only once the section is near the viewport. This is the whole
  // reason the cost is acceptable: a visitor who never scrolls to the
  // footer downloads none of it.
  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    // No IntersectionObserver (very old browser, or a test environment):
    // show the section without the backdrop rather than not at all.
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setVisible(true);
        io.disconnect(); // one-way: never tear it down mid-scroll
      },
      { rootMargin: "200px" }, // start loading just before it is needed
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={anchor} aria-hidden className="pointer-events-none absolute inset-0">
      {visible && (
        <iframe
          src={`${ARENA_URL}/?backdrop`}
          title=""
          tabIndex={-1}
          // allow-same-origin is REQUIRED, and it is not a loosening of
          // the sandbox here. Without it the frame gets an OPAQUE origin,
          // in which every localStorage access throws — and the game
          // client legitimately uses it, so it died on load and the page
          // sat at "connecting...".
          //
          // Pairing it with allow-scripts is only dangerous for a
          // SAME-origin frame, which could then drop its own sandbox.
          // This one is cross-origin: it keeps ITS own origin
          // (arena.nimboplay.dev) and still cannot reach the portal's.
          // Everything else stays denied — no forms, no popups, no
          // top-level navigation.
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
          // Slightly transparent and softened: it has to read as depth
          // behind the text, never as a competing window. The CTA's own
          // radial glows sit above it and tie it into the section.
          className="h-full w-full border-0 opacity-45 [filter:saturate(0.85)]"
        />
      )}
    </div>
  );
}
