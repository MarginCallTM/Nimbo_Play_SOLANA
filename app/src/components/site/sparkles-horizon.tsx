// Shared "planet horizon" visual: blue sparkles floating over a soft-blue
// planet arc (sky-soft) with a subtle primary border line.
// Restored 2026-07-02 for style experiments (was dropped from the Hero's
// "Powered by" for a smoother transition into HowItWorks).
// `flipped` mirrors it vertically (scaleY(-1)) — useful to complete the
// half-dome into a full sphere across a section boundary.
// The radial mask fades everything near the band edges, so two halves blend
// softly instead of needing a pixel-perfect junction.
import { SparklesCore } from "@/components/ui/sparkles";

interface SparklesHorizonProps {
  /** Unique canvas id — required if several instances live on one page. */
  id: string;
  /** Mirror vertically (bottom half of the sphere). */
  flipped?: boolean;
  className?: string;
}

export function SparklesHorizon({
  id,
  flipped = false,
  className = "",
}: SparklesHorizonProps) {
  return (
    <div
      className={`relative h-64 w-full overflow-hidden [mask-image:radial-gradient(50%_50%,white,transparent)] before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_bottom_center,#3981f6,transparent_70%)] before:opacity-20 after:absolute after:top-1/2 after:-left-1/2 after:aspect-[1/0.7] after:w-[200%] after:rounded-[100%] after:border-t after:border-primary/30 after:bg-sky-soft/80 ${
        flipped ? "-scale-y-100" : ""
      } ${className}`}
    >
      <SparklesCore
        id={id}
        background="transparent"
        minSize={1}
        maxSize={2.8}
        particleDensity={280}
        particleColor="#3981f6"
        className="absolute inset-x-0 bottom-0 h-full w-full [mask-image:radial-gradient(50%_50%,white,transparent_85%)]"
      />
    </div>
  );
}
