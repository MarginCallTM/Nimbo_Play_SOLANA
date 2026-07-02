"use client";

// Interactive cobe globe — corporate visual for the Hero (replaces the chest).
// Auto-rotates, and can be dragged to spin. Colored from our blue palette.
// City labels are a homemade HTML overlay: we re-run cobe's projection math
// each frame (see projectMarker) instead of relying on the CSS Anchor
// Positioning trick from the original template, which Firefox doesn't support.
import { useEffect, useRef, useCallback, useState } from "react";
import createGlobe from "cobe";

// cobe only has ONE base hue: land and ocean are the same color at different
// brightness, so a light ocean forces near-black land. Trick: render in dark
// mode (bright land on a dark sphere), then flip luminosity with a CSS
// `invert(1) hue-rotate(180deg)` filter on the canvas — invert swaps
// light/dark AND hues, hue-rotate(180) puts the hue back. Net effect:
// saturated brand-blue continents on an off-white ocean.
// These are therefore PRE-filter values, solved backwards (via the CSS
// hue-rotate matrix) so the ON-SCREEN result matches the palette:
//   land   -> gradient-brand dark stop, oklch(0.49 0.22 264)
//   ocean  -> off-white blue, close to the hero background
//   glow   -> sky-soft light blue
//   marker -> primary #3981f6
const BASE_PREFILTER: [number, number, number] = [0.49, 0.63, 1];
const GLOW_PREFILTER: [number, number, number] = [0.1, 0.23, 0.45];
const MARKER_PREFILTER: [number, number, number] = [0.26, 0.55, 1];

interface CityMarker {
  id: string;
  city: string;
  location: [number, number]; // [latitude, longitude]
}

interface GlobeAnalyticsProps {
  markers?: CityMarker[];
  className?: string;
  speed?: number;
}

// Seven big cities spread over five continents — the marketing message is
// "a blockchain lottery has no borders". Player counts are faked and
// generated client-side (see the `counts` state below).
const defaultMarkers: CityMarker[] = [
  { id: "nyc", city: "New York", location: [40.71, -74.01] },
  { id: "sao", city: "São Paulo", location: [-23.55, -46.63] },
  { id: "lon", city: "London", location: [51.51, -0.13] },
  { id: "lag", city: "Lagos", location: [6.52, 3.38] },
  { id: "mum", city: "Mumbai", location: [19.08, 72.88] },
  { id: "tok", city: "Tokyo", location: [35.68, 139.65] },
  { id: "syd", city: "Sydney", location: [-33.87, 151.21] },
  { id: "par", city: "Paris", location: [48.86, 2.35] },
];

// Projects a [lat, lng] location to canvas-relative coordinates (0..1),
// mirroring cobe's own vertex math so labels stick to their markers:
//   1. lat/lng -> point on the unit sphere (cobe's axis convention)
//   2. rotate that point by phi (spin) and theta (tilt)
//   3. orthographic projection — the sphere radius is 0.8 in clip space
// `visible` turns false when the city is on the far side of the globe.
const DEG = Math.PI / 180;
function projectMarker(
  location: [number, number],
  phi: number,
  theta: number
): { x: number; y: number; visible: boolean } {
  const lat = location[0] * DEG;
  const lng = location[1] * DEG - Math.PI;
  const px = -Math.cos(lat) * Math.cos(lng);
  const py = Math.sin(lat);
  const pz = Math.cos(lat) * Math.sin(lng);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const x = cp * px + sp * pz;
  const y = sp * st * px + ct * py - cp * st * pz;
  const z = -sp * ct * px + st * py + cp * ct * pz;
  const R = 0.8; // cobe's sphere radius in clip space
  return { x: (x * R + 1) / 2, y: (1 - y * R) / 2, visible: z >= 0 };
}

export function GlobeAnalytics({
  markers = defaultMarkers,
  className = "",
  speed = 0.003,
}: GlobeAnalyticsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // One DOM node per city label, repositioned every frame without React.
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Fake per-city stats. Generated in an effect (client only): Math.random()
  // during SSR would differ between server and client HTML and trigger a
  // React hydration mismatch. `null` = labels not mounted yet.
  const [stats, setStats] = useState<
    { players: number; growth: string }[] | null
  >(null);
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);

  // Roll the fake stats once per mount: 150..999 "players" per city, plus a
  // small always-positive growth (+0.5%..+4.9%) — modest numbers everywhere
  // read as steady worldwide growth, big spikes would look fake.
  useEffect(() => {
    setStats(
      markers.map(() => ({
        players: 150 + Math.floor(Math.random() * 850),
        growth: (0.5 + Math.random() * 4.4).toFixed(1),
      }))
    );
  }, [markers]);

  // Start dragging: remember where the pointer went down, pause auto-rotation.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    isPausedRef.current = true;
  }, []);

  // Release: bake the drag delta into the persistent offset, resume rotation.
  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    isPausedRef.current = false;
  }, []);

  // Track pointer movement globally while a drag is in progress.
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        };
      }
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerUp]);

  // Create + drive the globe.
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let animationId = 0;
    let phi = 0;

    const init = () => {
      const width = canvas.offsetWidth;
      if (width === 0 || globe) return;

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width,
        height: width,
        phi: 0,
        theta: 0.2,
        // Dark mode: land dots are BRIGHT on a dark sphere. The CSS
        // invert+hue-rotate filter on the canvas flips this back to dark
        // continents on a light ocean (see color constants above).
        dark: 1,
        // Low diffuse keeps land brightness even across the sphere instead
        // of falling off towards the edges.
        diffuse: 0.6,
        mapSamples: 16000,
        // In dark mode land ~ baseColor * (mapBrightness * lighting + 0.1);
        // 1 is full brightness pre-filter -> deepest blue after inversion.
        mapBrightness: 1,
        baseColor: BASE_PREFILTER,
        markerColor: MARKER_PREFILTER,
        glowColor: GLOW_PREFILTER,
        markerElevation: 0,
        markers: markers.map((m) => ({ location: m.location, size: 0.04 })),
        opacity: 1,
      });

      const animate = () => {
        if (!isPausedRef.current) phi += speed;
        const currentPhi = phi + phiOffsetRef.current + dragOffset.current.phi;
        const currentTheta =
          0.2 + thetaOffsetRef.current + dragOffset.current.theta;
        globe!.update({ phi: currentPhi, theta: currentTheta });
        // Move the city labels along with the globe. Direct DOM writes on
        // purpose: React state here would mean 60 re-renders per second.
        markers.forEach((m, i) => {
          const el = labelRefs.current[i];
          if (!el) return;
          const pos = projectMarker(m.location, currentPhi, currentTheta);
          el.style.left = `${pos.x * 100}%`;
          el.style.top = `${pos.y * 100}%`;
          el.style.opacity = pos.visible ? "1" : "0";
        });
        animationId = requestAnimationFrame(animate);
      };
      animate();
      // Fade in once the first frame is ready.
      setTimeout(() => {
        if (canvas) canvas.style.opacity = "1";
      });
    };

    // The canvas may have 0 width on first paint (grid layout) — wait for it.
    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if ((entries[0]?.contentRect.width ?? 0) > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (globe) globe.destroy();
    };
  }, [markers, speed]);

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1.2s ease",
          borderRadius: "50%",
          touchAction: "none",
          // Flips the dark-mode render into our light palette: invert swaps
          // light/dark (and hues), hue-rotate(180) restores the hue.
          filter: "invert(1) hue-rotate(180deg)",
        }}
      />
      {/* City labels — positioned every frame by the animate loop above.
          aria-hidden: the numbers are decorative marketing, not real data. */}
      {stats && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {markers.map((m, i) => (
            <div
              key={m.id}
              ref={(el) => {
                labelRefs.current[i] = el;
              }}
              className="absolute flex -translate-x-1/2 -translate-y-[150%] items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/90 px-2.5 py-1 text-xs shadow-sm backdrop-blur"
              style={{ opacity: 0, transition: "opacity 0.35s ease" }}
            >
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="text-muted-foreground">{m.city}</span>
              <span className="font-semibold text-foreground">
                {stats[i].players}
              </span>
              <span className="font-medium text-success">
                +{stats[i].growth}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
