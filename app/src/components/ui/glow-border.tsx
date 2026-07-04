"use client";

// Pointer-tracked border glow (adapted from a community GlowCard snippet,
// stripped of its size system / hue rotation; visuals live in globals.css
// under .glow-border). Client leaf: the host section stays a Server
// Component and passes the card as children.
//
// The JS only forwards the pointer's VIEWPORT coordinates as CSS vars via
// direct style writes on the ref — no state, no re-render per mousemove.
// The CSS uses background-attachment: fixed, so gradients positioned at
// --x/--y land exactly under the cursor wherever the card is on the page.
import { useEffect, useRef, type ReactNode } from "react";

export function GlowBorder({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = (e: PointerEvent) => {
      ref.current?.style.setProperty("--x", e.clientX.toFixed(2));
      ref.current?.style.setProperty("--y", e.clientY.toFixed(2));
    };
    document.addEventListener("pointermove", sync);
    return () => document.removeEventListener("pointermove", sync);
  }, []);

  return (
    <div ref={ref} className={`glow-border ${className}`}>
      {/* Blurred twin of the ring = soft outer bloom. */}
      <div aria-hidden className="glow-border-halo" />
      {children}
    </div>
  );
}
