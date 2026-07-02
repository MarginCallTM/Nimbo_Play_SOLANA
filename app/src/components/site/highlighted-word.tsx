"use client";

// Brand variant of PointerHighlight: the rectangle is FILLED with the
// Connect-wallet gradient, and the word fades to white mid-sweep so it
// stays readable on the blue fill.
// Client leaf on purpose: the text color must animate with the same
// whileInView trigger as the rectangle (a CSS class can't wait for scroll),
// while the parent section stays a Server Component.
import { motion } from "motion/react";
import { PointerHighlight } from "@/components/ui/pointer-highlight";

export function HighlightedWord({ children }: { children: React.ReactNode }) {
  return (
    <PointerHighlight
      containerClassName="inline-block align-top"
      rectangleClassName="border-primary/60 bg-[image:var(--gradient-brand)]"
      pointerClassName="text-primary"
    >
      {/* z-10 lifts the word above the filled rectangle (which paints at
          z-0 AFTER the children in the DOM). Color turns white at ~0.6s,
          when the 1s fill sweep reaches the middle of the word. */}
      <motion.span
        className="relative z-10 inline-block px-1"
        initial={{ color: "var(--foreground)" }}
        whileInView={{ color: "var(--primary-foreground)" }}
        transition={{ duration: 0.3, delay: 0.6, ease: "easeInOut" }}
      >
        {children}
      </motion.span>
    </PointerHighlight>
  );
}
