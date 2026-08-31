"use client";

// Mobile navigation (F5.7). Below `md` the header hides its nav, which left
// Arena / Leaderboard / Lotteries unreachable on a phone — this restores them.
//
// It is a CLIENT LEAF on purpose: it owns open/closed state, so it has to run
// in the browser, but keeping it in its own file means header.tsx stays a
// Server Component and only this button's JS ships. Same pattern as
// ConnectWalletButton.
//
// The links are passed in rather than duplicated here: header.tsx stays the
// single source of truth, so desktop and mobile can never drift apart.
//
// It is a DROPDOWN, not a modal. An earlier version froze background scroll and
// laid an opaque backdrop over the page — the standard treatment for a
// full-screen panel, and far too heavy for four links: you had to dismiss the
// menu before you could carry on reading. The page now scrolls freely
// underneath and the panel simply floats above it.
import { useEffect, useRef, useState } from "react";

export type NavLink = { label: string; href: string };

export function MobileNav({
  links,
  docsHref,
}: {
  links: NavLink[];
  docsHref: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    // Escape closes — expected of any overlay, and the only way out for someone
    // navigating by keyboard who cannot reach the toggle again.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    // Tap-outside-to-close via a document listener rather than a full-screen
    // backdrop element. A backdrop would swallow touch events and block the
    // very scrolling we want to keep; a listener sees the tap and lets the
    // gesture through. `pointerdown` covers mouse, touch and pen at once.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return; // the toggle handles itself
      if (panelRef.current?.contains(target)) return; // a tap inside the menu
      setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        // aria-expanded is what tells a screen reader this button owns a
        // collapsible region, and aria-controls says which one.
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid size-9 place-items-center rounded-full border border-white/20 text-white transition-colors hover:bg-white/5 md:hidden"
      >
        {/* Inline SVG rather than an icon package: two shapes do not justify a
            dependency, and this ships zero extra bytes. */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          {open ? (
            <>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>

      {open && (
        // `absolute top-full` anchors the panel to the bottom edge of the
        // header, so no header height is hardcoded anywhere — change the header
        // padding and this still lands in the right place.
        //
        // SURFACE: the panel used to be the same black as the header and the
        // hero, so it read as a hole rather than a layer. It now runs from the
        // indigo-tinted `secondary` surface down to the page background — both
        // sampled from the artwork's clouds (F3) — so it detaches without
        // introducing a colour the palette does not already own.
        // /95 + backdrop-blur only became worth having once scrolling was
        // unlocked: real content now moves behind the panel, and blurring it is
        // what sells the sense of depth. The hairline border and drop shadow
        // finish the job.
        <nav
          ref={panelRef}
          id="mobile-nav-panel"
          className="absolute inset-x-0 top-full z-50 border-b border-border bg-gradient-to-b from-secondary/95 to-background/95 px-6 py-4 shadow-2xl shadow-black/60 backdrop-blur-xl md:hidden"
        >
          {/* Documentation is appended to the same list rather than styled
              separately alongside it. On desktop it is a button because it sits
              in the action group; inside this panel it is just another
              destination, so it should look and be marked up like one. */}
          <ul className="flex flex-col">
            {[...links, { label: "Documentation", href: docsHref }].map((l) => (
              <li key={l.label}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  // py-3 keeps every row past the ~44px minimum touch target.
                  className="block py-3 text-base text-white/80 transition-colors hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
