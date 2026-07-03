"use client";

// Dependency-free sparkles field on a <canvas>.
// Replaces tsparticles v3, whose ESM build imports type-only ".js" files
// (RepulseDiv.js, shape-*) that neither Turbopack nor Webpack can resolve.
// Same public API (SparklesCore + props) so callers stay unchanged.
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ParticlesProps = {
  id?: string;
  className?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

// One drifting, twinkling dot.
type Particle = {
  x: number;
  y: number;
  r: number; // radius in CSS pixels
  baseOpacity: number; // max brightness of this dot
  phase: number; // where it currently is in its twinkle cycle
  twinkleSpeed: number; // how fast it breathes
  vy: number; // upward drift
  vx: number; // gentle horizontal sway
};

export const SparklesCore = (props: ParticlesProps) => {
  const {
    id,
    className,
    background = "transparent",
    minSize = 1,
    maxSize = 3,
    speed = 1,
    particleColor = "#ffffff",
    particleDensity = 120,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crisp rendering on Retina: draw at devicePixelRatio, keep CSS size in px.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;

    // (Re)build the field whenever the container is resized.
    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px

      // Interpret particleDensity as "dots per 160000 px²" (a 400×400 block),
      // matching the old tsparticles density reference. Capped for perf.
      const count = Math.min(
        Math.round((particleDensity * width * height) / 160000),
        700,
      );
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: minSize + Math.random() * (maxSize - minSize),
        baseOpacity: 0.3 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
        twinkleSpeed: (0.005 + Math.random() * 0.02) * speed,
        vy: (0.05 + Math.random() * 0.25) * speed,
        vx: (Math.random() - 0.5) * 0.15 * speed,
      }));
    };

    const draw = () => {
      // Paint the background (or clear if transparent so the parent shows through).
      if (background && background !== "transparent") {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      ctx.fillStyle = particleColor;
      for (const p of particles) {
        // Move: drift up, sway slightly, wrap around the edges.
        p.y -= p.vy;
        p.x += p.vx;
        if (p.y < -p.r) {
          p.y = height + p.r;
          p.x = Math.random() * width;
        }
        if (p.x < -p.r) p.x = width + p.r;
        else if (p.x > width + p.r) p.x = -p.r;

        // Twinkle: opacity breathes between ~0 and baseOpacity via a sine.
        p.phase += p.twinkleSpeed;
        const opacity = p.baseOpacity * (0.5 + 0.5 * Math.sin(p.phase));

        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    build();
    draw();

    const observer = new ResizeObserver(build);
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    background,
    minSize,
    maxSize,
    speed,
    particleColor,
    particleDensity,
  ]);

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className={cn("h-full w-full", className)}
    />
  );
};
