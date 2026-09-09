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

export function ArenaBackdrop({ triggerId = "how" }: { triggerId?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Start loading when the reader reaches ANOTHER section — "How it
  // works" by default — rather than when this one is nearly in view.
  //
  // The iframe boots Pixi and a simulation, which is not instant. Waiting
  // until the CTA was 200px away meant arriving on a blank rectangle that
  // filled in a moment later. Two sections of runway means the arena is
  // already alive by the time it is scrolled to.
  //
  // Watching a NAMED section rather than widening a margin: "200px" is a
  // number that corresponds to nothing, and it drifts as soon as the copy
  // above changes length.
  useEffect(() => {
    // No IntersectionObserver (very old browser, or a test environment):
    // show the section without the backdrop rather than not at all.
    if (typeof IntersectionObserver === "undefined") return;
    // Falls back to this component's own position if the trigger section
    // is ever renamed or removed: the backdrop then loads late instead of
    // never, which is the right way for this to break.
    const target = document.getElementById(triggerId) ?? anchor.current;
    if (!target) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setVisible(true);
      io.disconnect(); // one-way: never tear it down mid-scroll
    });
    io.observe(target);
    return () => io.disconnect();
  }, [triggerId]);

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
