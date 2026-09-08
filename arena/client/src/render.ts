// Pixi rendering layer, ported from the proto (A0.x). This module
// only DRAWS: the netcode (main.ts) computes every position —
// predicted self, interpolated others, locally regrown bodies — and
// hands them over. Same sim/render split as the proto's Snake vs
// SnakeView, now applied across the network boundary.
import {
    Application,
    CanvasSource,
    Container,
    Graphics,
    Sprite,
    Text,
    Texture,
    TilingSprite,
} from "pixi.js";
import {
    AOI_RADIUS,
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_WARNING_FRAMES,
    FOOD_RADIUS,
    FOOD_VALUE,
    SNAKE_RADIUS,
    SNAKE_SPACING,
    REFERENCE_VIEW_CORNER,
    REFERENCE_VIEW_H,
    REFERENCE_VIEW_W,
    WORLD_RADIUS,
} from "@nimbo/shared";

export interface SnakeColors {
    body: string;
    head: string;
    // AV.5 — a skin, in its entirety: the colours its body cycles
    // through. Absent means a plain one-tone snake.
    //
    // THIS IS THE FORMAT THE MARKETPLACE WILL SELL, so it is worth being
    // deliberate about. A skin is a LIST OF COLOURS plus a band width —
    // tens of bytes, no asset to store, none to serve, and nothing to
    // load at spawn. It also makes "never pay-to-win" a property of the
    // data rather than a promise: a palette cannot encode a hitbox, a
    // speed or a reach, so an expensive skin is structurally incapable of
    // buying an advantage.
    bands?: string[];
}

// Band length in SEGMENTS. At SNAKE_SPACING = 10 and a 24-unit body,
// four segments is ~1.7 body widths — the reference's proportion.
//
// R1 watch: bands run ALONG the tube, so they can never suggest the body
// is cut into separate pieces. Keep the two tones close enough in value
// that a band reads as a marking and not as a gap.
const BAND_SEGMENTS = 4;

// AV.3b — palettes rebuilt from a MEASUREMENT, not from taste. Sampling
// our own screenshot against the reference gave, for the body:
//
//              saturation   value
//   ours          0.79       0.52     over-saturated and dark
//   reference     0.50       0.63     and its saturation barely moves
//                                     (0.49 -> 0.51) while value spans
//                                     0.42 -> 0.87
//
// Constant saturation with a wide value range is the signature of pure
// BRIGHTNESS shading — which is what a tint multiplied by a greyscale
// gradient produces, so our pipeline already had it right. What was
// wrong was the pigment: too saturated, and too dark once shaded.
//
// Hue is preserved exactly; only S and V are retargeted. Combined with
// the cylinder gradient (0.48 -> 1.0), a body tint at V = 0.88 renders
// across V 0.42 -> 0.88, i.e. the reference's own range.
//
// Head is lighter and less saturated than the body: it reads as the lit
// end of the same animal rather than as a different colour.
// AV.5 — the second band tone is the SAME HUE at S 0.22 / V 0.97: a pale
// version of the animal, never a foreign colour. Two tones of one hue
// read as markings on a creature; two different hues read as a costume,
// and at a glance the player would stop being able to name who is who.
// Telling snakes apart instantly is a gameplay need, not a style one.
export const PLAYER_COLORS: SnakeColors = {
    body: "#709de0",
    head: "#99c2ff",
    bands: ["#709de0", "#c1d7f7"],
};
// Offline snakes stay ONE tone on purpose: a frozen body is a warning,
// not a place for decoration.
export const OFFLINE_COLORS: SnakeColors = { body: "#4a4f5c", head: "#6a7080" };
// one palette per opponent, cycled through as they appear
export const OTHER_PALETTES: SnakeColors[] = [
    { body: "#e09d70", head: "#ffc299", bands: ["#e09d70", "#f7d7c1"] }, // orange
    { body: "#b270e0", head: "#d599ff", bands: ["#b270e0", "#e1c1f7"] }, // purple
    { body: "#70e09d", head: "#99ffc2", bands: ["#70e09d", "#c1f7d7"] }, // green
    { body: "#e07087", head: "#ff99ae", bands: ["#e07087", "#f7c1cc"] }, // red
    { body: "#e0d370", head: "#fff399", bands: ["#e0d370", "#f7f1c1"] }, // yellow
    { body: "#70d8e0", head: "#99f7ff", bands: ["#70d8e0", "#c1f3f7"] }, // cyan
];

// The colour segment `i` wears. Index-based, and that is what makes it
// free: tracers keep their index for life (growth appends at the TAIL),
// so a band is painted once when its segment is born and never rewritten
// — no per-frame tint work, and the markings stay put on the body
// instead of scrolling along it.
function bandTint(colors: SnakeColors, i: number): string {
    if (!colors.bands || colors.bands.length === 0) return colors.body;
    return colors.bands[Math.floor(i / BAND_SEGMENTS) % colors.bands.length];
}

// Ambient pellet colors — visual variety only, no gameplay meaning
const PELLET_TINTS = [0xff79c6, 0x8be9fd, 0x50fa7b, 0xf1fa8c, 0xbd93f9, 0xffb86c];
const ORB_TINT = 0xffcc66; // dropped orbs (corpse/boost): golden = loot

const MINIMAP_RADIUS = 70;

// --- AV.1 — the hexagonal ground ------------------------------------
//
// What it replaces and why. The floor used to be a flat fill plus 900
// RANDOM dots. Random gives the eye nothing to measure a displacement
// against, so moving fast felt like moving nowhere. A REGULAR lattice is
// what turns motion into speed — that is the whole reason slither.io
// has one.
//
// THE TILE MUST WRAP EXACTLY, or a seam scrolls across the screen. For
// flat-top hexagons of circumradius R the lattice repeats over a
// rectangle 3R wide by sqrt(3)*R tall, holding two centres: one at the
// corner and one dead in the middle.
//
// The catch: a texture is an INTEGER number of pixels, and 3R / sqrt(3)R
// = sqrt(3) is irrational, so no R makes both sides whole. Rounding one
// of them shifts the wrap point away from the drawn geometry — the seam
// we are trying to avoid. Fix: pick the two INTEGER pixel sizes first,
// with a ratio as close to sqrt(3) as we like, then derive R from them.
// 362/209 = 1.7320574 against sqrt(3) = 1.7320508 — an error of 4e-6,
// i.e. under a thousandth of a pixel across the tile.
const TILE_W_PX = 362;
const TILE_H_PX = 209;
const HEX_R_PX = TILE_W_PX / 3;

// The one knob to turn. How wide a hexagon is IN WORLD UNITS, which is
// what sets the apparent size of the grid under the snakes: a spawning
// snake (SNAKE_RADIUS = 12, so 24 units across) spans about a quarter of
// a cell. Everything else follows from this number.
// 40 -> 48 on 2026-09-08 (user call: cells 20% larger, calmer floor).
const HEX_R_WORLD = 48;

// Drawn at ~3 texture pixels per world unit, so the grid stays sharp at
// the reference viewport (1 world unit ~ 1.3 screen pixels at 1080p).
const HEX_TILE_SCALE = (HEX_R_WORLD * 3) / TILE_W_PX;

// AV.3c — the floor, rebuilt from a CLOSE-UP measurement.
//
// A correction first: the previous pass made this palette near-neutral,
// on a percentile taken over the WHOLE frame. That number was diluted by
// every region a halo had washed out. Sampling the cells themselves —
// values supplied by the user, #18212d and #0e1621 — says the reference
// floor is decidedly BLUE: hue 214, saturation 0.47 to 0.58. Ours was
// the desaturated one.
//
// The real difference was never the cell colour. Measured on matching
// close-ups:
//
//                        ours    reference
//   median luminance     36.8      26.7
//   p85 / p98            36.8/50.7 37.0/51.1     <- our highlights MATCH
//   pixels in a seam      13%       30%          <- the actual gap
//
// Two findings hide in that table. First, our brightest tones are
// already right; the floor reads pale because CELLS COVER 87% OF THE
// SURFACE against their 70%. Widen the seams and the average falls
// without a single colour getting darker. Second, our p50 EQUALS our p85
// — a plateau, i.e. perfectly flat cell interiors — while the reference
// spreads continuously, because every one of its cells carries a
// gradient. Flat faces are what make a grid look like a wireframe
// instead of a floor.
// AV.3e — contrast pulled back 20% (user call, 2026-09-08), amplitude
// TOP-to-GAP going 17.8 -> 14.2 in luminance, anchored on the sampled
// mid so the floor keeps its colour and only its relief softens.
//
// Why softening the FLOOR answers a complaint about MOTION: any residual
// camera slide is only as legible as the pattern it slides over. Less
// contrast does not remove the movement, it lowers how loudly the floor
// reports it. It is a mitigation, not the cure — see the camera note in
// ArenaVisualsTODO (AV.3e).
const HEX_CELL_TOP = "#1b2737";    // lit upper edge of a cell
const HEX_CELL_MID = "#17212e";    // the user's sampled cell colour
const HEX_CELL_BOTTOM = "#131b25"; // shaded lower edge
const HEX_GAP = "#111822";         // the user's sampled seam colour
const HEX_SHADOW = "rgba(4,8,14,0.68)"; // what a raised cell drops into the seam

// Cell size as a fraction of the lattice pitch. Coverage goes as the
// SQUARE of this, so 0.84 lands at 70% — the measured reference figure.
// This single number is what sets how dark the floor reads.
const HEX_CELL_SCALE = 0.84;
const HEX_CORNER = 0.14; // corner rounding, as a fraction of the cell radius

// --- AV.2 — the pellet glow: REMOVED 2026-09-08 ----------------------
//
// A tombstone, because the idea is tempting enough that someone will
// want it back. It was a real halo — one shared radial-gradient texture
// per pellet, drawn in additive blending, exactly the way the reference
// does it — and it still had to go.
//
// WHY IT FAILED HERE. Halo area grows as the SQUARE of its radius, and
// our pellet count is high: at 8x the pellet radius the halos covered
// 123% of the viewport at 300 pellets, 184% at 450. The screen was
// carpeted in additive light more than once over. Additive light raises
// the black level EVERYWHERE, contrast collapses, and the eye reads that
// as being out of focus. A per-pellet twinkle then made the whole carpet
// breathe, and playtesters reported nausea — confirmed independently by
// the user and by friends asked for a blind opinion.
//
// Narrowing it to a measured 3x (the reference's own falloff) fixed the
// arithmetic, and the user still judged the game more comfortable with
// no halo at all. Comfort over fidelity: D85 makes the play experience
// the standard, and "it looks like the reference" does not outrank "it
// can be played for an hour".
//
// IF IT EVER COMES BACK, the constraint to design against is TOTAL
// COVERAGE (count x area), never the look of a single pellet in
// isolation. That is the number that made this unplayable, and it is
// invisible when you inspect one halo at a time.

// --- AV.3 — the shaded segment ---------------------------------------
//
// Until now every body segment, head and pellet was a FLAT white disc,
// tinted. Flat discs read as a string of beads; the reference reads as a
// TUBE, because each disc carries a highlight and a darker rim, and the
// highlight lands at the SAME place on every one of them — which draws a
// continuous ridge of light along the body whichever way it travels.
//
// THE GEOMETRY IS UNTOUCHED (R1). Same logical texture size, same
// `scale = radius / SNAKE_RADIUS` at every call site. Only pixels change.
//
// Supersampled because this texture gets stretched hard: a snake's radius
// is SNAKE_RADIUS * (1 + sqrt(score) * GROWTH_RADIUS_FACTOR), so x3 at
// score 10000 and x5.5 at 50000, on top of the camera scale. A flat fill
// survived that — a solid circle has no detail to lose — shading would
// not. `resolution` is what keeps the change invisible to the rest of the
// file: the source holds 4x the pixels while REPORTING the same logical
// 24x24 size, so no scale math anywhere needs to know it happened.
const SEGMENT_SUPERSAMPLE = 4;

function makeSegmentTexture(): Texture {
    const r = SNAKE_RADIUS * SEGMENT_SUPERSAMPLE;
    const canvas = document.createElement("canvas");
    canvas.width = r * 2;
    canvas.height = r * 2;
    const ctx = canvas.getContext("2d")!;

    // AV.3b — LINEAR, not radial. This is the whole fix for the "string
    // of beads" look, and it is a change of nature, not of degree.
    //
    // A RADIAL gradient darkens every disc towards its own rim, so each
    // segment paints a dark arc over the bright middle of the one before
    // it: a dark band every SNAKE_SPACING pixels, which is exactly the
    // corrugation we had. Measured on our own screenshot, the silhouette
    // was innocent — the scallop is only 4.5% of the width — the internal
    // arcs were doing all the damage.
    //
    // A LINEAR gradient across the texture's Y axis, with the sprite
    // rotated to the local heading (see drawSnake), runs PERPENDICULAR to
    // travel. Along the body the value is then CONSTANT, so overlapping
    // discs cannot produce an arc at all, while across the body the
    // contrast stays strong. That is a lit cylinder instead of a row of
    // lit spheres — and it matches what the reference measures as: hue
    // and saturation locked, value spanning 0.42 to 0.87.
    //
    // SYMMETRIC on purpose: the heading vector flips sign wherever the
    // body doubles back, and a one-sided highlight would flip with it.
    //
    // Greyscale, because tint MULTIPLIES: 1.0 leaves the skin colour
    // untouched and every value below shades that same colour, so nothing
    // here can shift a snake's hue. With a tint at V = 0.88 the body
    // renders across V 0.42 -> 0.88.
    const gradient = ctx.createLinearGradient(0, 0, 0, r * 2);
    const stops: [number, number][] = [
        [0.0, 0.48],
        [0.22, 0.8],
        [0.5, 1.0],
        [0.78, 0.8],
        [1.0, 0.48],
    ];
    for (const [offset, level] of stops) {
        const v = Math.round(level * 255);
        gradient.addColorStop(offset, `rgb(${v},${v},${v})`);
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();

    return new Texture({
        source: new CanvasSource({ resource: canvas, resolution: SEGMENT_SUPERSAMPLE }),
    });
}

// --- AV.4 — the eyes --------------------------------------------------
//
// The cheapest character in the whole file. Four sprites turn a circle
// into a creature, and it is the first thing anyone noticed on the
// reference captures.
//
// Proportions read off those captures, all as fractions of the snake's
// own radius, so they scale with growth for free.
const EYE_RADIUS = 0.42;   // sclera radius
const EYE_SPREAD = 0.52;   // sideways offset from the heading axis
const EYE_FORWARD = 0.26;  // pushed towards the snout
const PUPIL_RADIUS = 0.46; // as a fraction of the sclera
const PUPIL_TRAVEL = 0.40; // how far the pupil rides off centre
const EYE_WHITE = 0xf4f7fb;
const EYE_PUPIL = 0x10131a; // the floor's near-black, not pure black

// A FLAT disc, unlike the body's shaded one: the reference's eyes carry
// no shading at all, and the cylinder gradient would have laid a
// horizontal bright band across them — a lying highlight on a sphere.
// Same logical size as circleTexture, so `scale = r / SNAKE_RADIUS`
// keeps working unchanged everywhere.
function makeDiscTexture(): Texture {
    const r = SNAKE_RADIUS * SEGMENT_SUPERSAMPLE;
    const canvas = document.createElement("canvas");
    canvas.width = r * 2;
    canvas.height = r * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.fill();
    return new Texture({
        source: new CanvasSource({ resource: canvas, resolution: SEGMENT_SUPERSAMPLE }),
    });
}

// Vertices of one flat-top hexagon, as a flat [x0,y0,x1,y1,...] list.
// Angle 0 puts a vertex at the right, which lands flat edges on the top
// and the bottom — the reference's orientation.
function hexPoints(cx: number, cy: number, r: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return pts;
}

// One cell, drawn as a RAISED TILE rather than as an outlined shape.
//
// Three things the previous version did not do, each measured above:
//   - a vertical gradient across the face, so no plateau;
//   - ROUNDED corners, obtained by tracing the hexagon slightly small
//     and stroking it back to size with a round line join — sharp
//     corners are most of what made ours read as a wireframe;
//   - a drop shadow into the seam, which is what tells the eye the cell
//     sits ABOVE the ground rather than being a hole cut through it.
function drawHexCell(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const corner = r * HEX_CORNER;
    const p = hexPoints(cx, cy, r - corner);

    const gradient = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    gradient.addColorStop(0, HEX_CELL_TOP);
    gradient.addColorStop(0.5, HEX_CELL_MID);
    gradient.addColorStop(1, HEX_CELL_BOTTOM);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();

    // AV.3d — a TIGHT shadow. At 0.28r the blur spread 28 texture pixels,
    // i.e. ~15 screen pixels of soft gradient around every single cell:
    // the floor stopped having edges at all, which read as the whole
    // scene being out of focus. The reference's shadow is a thin dark
    // lip, not a halo — it says "raised", it does not say "blurred".
    ctx.shadowColor = HEX_SHADOW;
    ctx.shadowBlur = r * 0.09;
    ctx.shadowOffsetY = r * 0.05;
    ctx.fillStyle = gradient;
    ctx.strokeStyle = gradient;
    ctx.lineJoin = "round";
    ctx.lineWidth = corner * 2; // grows the outline back to radius r
    ctx.stroke();
    ctx.fill();
    ctx.restore();
}

// The repeating tile, rendered once at boot into a GPU texture.
//
// Seamlessness comes from drawing each of the two lattice centres NINE
// times — itself plus the eight neighbouring tile offsets. A cell that
// straddles an edge is therefore also drawn coming back in on the
// opposite side; `frame` then keeps only the tile proper. Skipping this
// leaves cells sliced off at the border, which is the classic tiling
// artefact and looks exactly like a mis-sized tile.
// --- AV.3f — the A/B floor, kept for diagnosis ------------------------
//
// The pre-AV.3c look, restored verbatim: flat faces, sharp corners, thin
// two-tone seam, no drop shadow. It exists so the "everything is blurred"
// complaint can be ISOLATED rather than argued about — swap the floor
// mid-motion and see whether the sensation follows the floor or stays.
// If it stays, the floor was never the cause and the diagnosis moves.
const FLAT_GAP = "#141618";
const FLAT_FILL = "#21252a";
const FLAT_TOP = "#2f303e";
const FLAT_BOTTOM = "#0c0d0e";

function drawHexCellFlat(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    const p = hexPoints(cx, cy, r);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
    ctx.fillStyle = FLAT_FILL;
    ctx.fill();
    ctx.lineJoin = "miter";
    ctx.lineWidth = 3;
    // y grows downward: v0(right) -> v1 -> v2 -> v3(left) is the LOWER chain
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.lineTo(p[4], p[5]);
    ctx.lineTo(p[6], p[7]);
    ctx.strokeStyle = FLAT_BOTTOM;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p[6], p[7]);
    ctx.lineTo(p[8], p[9]);
    ctx.lineTo(p[10], p[11]);
    ctx.lineTo(p[0], p[1]);
    ctx.strokeStyle = FLAT_TOP;
    ctx.stroke();
}

// Both floors share this: only the per-cell painter differs, so the
// lattice period and the nine-fold wrap can never drift between them.
function makeTile(
    paint: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void,
    ground: string,
    cellScale: number,
): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_W_PX;
    canvas.height = TILE_H_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, TILE_W_PX, TILE_H_PX);
    const centres = [
        { x: 0, y: 0 },
        { x: TILE_W_PX / 2, y: TILE_H_PX / 2 }, // = (1.5R, sqrt(3)R/2)
    ];
    for (const c of centres) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                paint(ctx, c.x + dx * TILE_W_PX, c.y + dy * TILE_H_PX, HEX_R_PX * cellScale);
            }
        }
    }
    return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function makeHexTileTextureFlat(): Texture {
    return makeTile(drawHexCellFlat, FLAT_GAP, 0.94);
}

// the canvas IS the tile, so there is no frame to crop: anything the
// neighbour copies drew outside it simply never made it in
function makeHexTileTexture(): Texture {
    return makeTile(drawHexCell, HEX_GAP, HEX_CELL_SCALE);
}

// One snake on screen: body sprites + head sprite + floating label.
// Sprites all share ONE texture (proto lesson): Pixi batches them
// into a single draw call — a 400-segment snake costs the same GPU
// submission as a dot.
interface SnakeView {
    root: Container;
    body: Container;
    head: Sprite;
    // AV.4 — index 0 is the left eye, 1 the right. Children of `root`, so
    // they inherit the snake's alpha (graced/offline fade) and die with it.
    sclerae: [Sprite, Sprite];
    pupils: [Sprite, Sprite];
    // AV.4b — last heading that could be trusted, and whether one ever
    // was. Held across frames so a stalled or freshly-seeded body cannot
    // spin the eyes; see the derivation in drawSnake.
    heading: number;
    headingValid: boolean;
    label: Text;
    colors: SnakeColors;
}

export class GameView {
    readonly app: Application;
    private world = new Container();
    private foodLayer = new Container();
    private snakeLayer = new Container();
    private debugGfx = new Graphics(); // AoI circle + server ghost
    private minimap = new Graphics();  // screen-space, bottom-right
    private extractGfx = new Graphics(); // the zone, redrawn per frame
    private extractLabel!: Text;
    private circleTexture!: Texture;   // shared by every segment & pellet
    private discTexture!: Texture;     // flat disc: sclerae and pupils
    private foodSprites = new Map<string, Sprite>();
    private snakes = new Map<string, SnakeView>();

    // AV.0 — the number every visual effect from here on is judged by.
    // D85 makes fluidity a mainnet-grade requirement, so an effect that
    // costs frames is a bad trade, not an acceptable compromise — and
    // "it feels smooth" is not a measurement.
    //
    // Pixi's own ticker.FPS reports the LAST frame only (1000/elapsedMS),
    // so reading it once a second samples one arbitrary frame and reports
    // noise. Counting frames over a real window costs an increment and
    // tells the truth.
    private frames = 0;
    private fpsSampledAt = 0;
    private fps = 0;

    // `?debug` in the URL turns the netcode overlays back on — see drawDebug.
    private debug = new URLSearchParams(window.location.search).has("debug");

    // AV.3f — the floor A/B switch. Born as a diagnostic (three toggles,
    // one per suspect, to isolate the "everything is blurred" report
    // instead of arguing about it) and it paid for itself: it found the
    // cause in a minute, where three rounds of reasoning had not.
    //
    // The glow and pulse toggles went with the glow itself. This one
    // stays, and is on its way to becoming a real player preference —
    // see AV.3h in ArenaVisualsTODO for what that still needs.
    private floor!: TilingSprite;
    private floorTextures!: { tiles: Texture; flat: Texture };
    private floorMode: "tiles" | "flat" | "none" = "tiles";
    private diagEl?: HTMLDivElement;

    private constructor() {
        this.app = new Application();
    }

    // AV.3f — the toggles, plus a readout so a screenshot always says
    // which combination produced it. Self-contained in the view: the test
    // has to work in the menu and the demo too, not only in a paid room.
    private installDiagnostics() {
        const el = document.createElement("div");
        el.style.cssText =
            "position:fixed;left:8px;bottom:8px;z-index:10;color:#8fa3bf;" +
            "font:12px monospace;pointer-events:none;white-space:pre";
        document.body.appendChild(el);
        this.diagEl = el;
        this.refreshDiagnostics();

        window.addEventListener("keydown", (e) => {
            // never steal a keystroke aimed at the name field
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
            if (e.code !== "KeyB") return;
            this.floorMode =
                this.floorMode === "tiles" ? "flat" : this.floorMode === "flat" ? "none" : "tiles";
            this.floor.visible = this.floorMode !== "none";
            if (this.floorMode !== "none") {
                this.floor.texture = this.floorTextures[this.floorMode];
            }
            this.refreshDiagnostics();
        });
    }

    private refreshDiagnostics() {
        if (!this.diagEl) return;
        this.diagEl.textContent = `[B] floor: ${this.floorMode}`;
    }

    // Live cost of the current scene. `sprites` is what actually reaches
    // the GPU — food, body segments and heads — which is the figure that
    // moves when an effect is added, where FPS only says whether it hurt.
    stats(): { fps: number; sprites: number } {
        let sprites = this.foodSprites.size;
        for (const view of this.snakes.values()) {
            sprites += view.body.children.length + 1; // + the head
        }
        return { fps: Math.round(this.fps), sprites };
    }

    // Pixi v8 initializes asynchronously (GPU context negotiation) —
    // hence a static factory instead of doing it in the constructor.
    static async create(): Promise<GameView> {
        const view = new GameView();
        const app = view.app;
        // AV.3d — RESOLUTION. This is the fix for the floor looking soft
        // and crawling in motion, and it was a default we never set.
        //
        // Pixi's renderer defaults to `resolution: 1`
        // (AbstractRenderer.defaultOptions). On any HiDPI screen —
        // every recent Mac — that renders the frame at half the display's
        // real pixel count and lets the compositor scale it up. The whole
        // image is softened, uniformly, which is why a still barely shows
        // it and playing does.
        //
        // It compounds with a second effect the floor alone suffers from.
        // The hex tile carries 362 texture pixels per 144 world units, so
        // 2.51 texels per world unit, against 1.3 screen pixels per world
        // unit at the reference viewport: the tile is MINIFIED about 1.9x.
        // Texture sources default to `mipLevelCount: 1`, i.e. no mipmaps,
        // so minification samples one texel in four — which stays put in a
        // screenshot and crawls the moment the camera moves.
        //
        // Rendering at device resolution fixes both at once: it removes
        // the upscale, and it brings the tile back to roughly 1 texel per
        // device pixel, where there is nothing left to alias.
        //
        // `autoDensity` is REQUIRED alongside it: it keeps the canvas's
        // CSS size in CSS pixels while the backing store grows. Without
        // it the canvas would lay out devicePixelRatio times too large.
        //
        // ⚠ FAIRNESS, checked and not assumed: `app.screen` is documented
        // in CSS pixels, independent of resolution, so viewScale() and the
        // field of view are bit-for-bit unchanged (AF.3bis).
        //
        // ⚠ COST: 4x the fragment work on a 2x display. Watch the AV.0
        // counter — if 60fps no longer holds, cap this at 1.5 rather than
        // going back to 1.
        await app.init({
            resizeTo: window,
            background: "#0e1621", // the seam colour: the floor's own ground
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
        });
        document.body.appendChild(app.canvas);

        // AV.0 — frame counter, averaged over a 500ms window (see stats()).
        // Attached to the VIEW, not to a session: the menu and the demo
        // are exactly where a heavy effect would go unnoticed otherwise.
        view.fpsSampledAt = performance.now();
        app.ticker.add(() => {
            const now = performance.now();
            view.frames++;
            const elapsed = now - view.fpsSampledAt;
            if (elapsed >= 500) {
                view.fps = (view.frames * 1000) / elapsed;
                view.frames = 0;
                view.fpsSampledAt += elapsed;
            }
        });

        // z-order = insertion order: decor < food < debug < snakes
        app.stage.addChild(view.world);

        // AV.1 — the hexagonal floor, below everything else.
        //
        // Oversized past the world border by a full screen diagonal
        // (REFERENCE_VIEW_CORNER): standing ON the border, a player still
        // sees roughly half a screen beyond it, and the grid must not
        // just stop in mid-air there. The border ring below is what marks
        // the lethal edge — the floor never carries that meaning.
        //
        // Cost: ONE quad. The repeat happens in the sampler, so covering
        // 5000x5000 units costs exactly what covering one cell would.
        const floorSpan = 2 * (WORLD_RADIUS + REFERENCE_VIEW_CORNER);
        view.floorTextures = { tiles: makeHexTileTexture(), flat: makeHexTileTextureFlat() };
        const floor = new TilingSprite({
            texture: view.floorTextures.tiles,
            width: floorSpan,
            height: floorSpan,
            tileScale: { x: HEX_TILE_SCALE, y: HEX_TILE_SCALE },
        });
        floor.position.set(-floorSpan / 2, -floorSpan / 2);
        view.floor = floor;
        view.world.addChild(floor);
        view.installDiagnostics();

        // The world border — kept, and kept alone in this layer. Crossing
        // it kills (A4.11 border deaths), so it is the one piece of
        // scenery that carries gameplay truth and must stay unmistakable
        // against the new floor.
        const decor = new Graphics();
        decor.circle(0, 0, WORLD_RADIUS).stroke({ width: 8, color: "#4a5578" });
        view.world.addChild(decor);
        view.world.addChild(view.foodLayer);
        view.world.addChild(view.debugGfx);
        view.world.addChild(view.extractGfx); // zone under the snakes
        view.extractLabel = new Text({
            text: "",
            style: { fill: 0xffcc66, fontSize: 16, fontFamily: "monospace" },
        });
        view.extractLabel.anchor.set(0.5);
        view.extractLabel.visible = false;
        view.world.addChild(view.extractLabel);
        view.world.addChild(view.snakeLayer);

        // the one texture every circle sprite is an instance of — body
        // segments, heads AND pellets, which now read as glossy beads for
        // free (the reference's food is lit the same way)
        view.circleTexture = makeSegmentTexture();
        view.discTexture = makeDiscTexture();

        app.stage.addChild(view.minimap);
        return view;
    }

    // AF.3bis — how many screen pixels one world unit takes. The world
    // used to be drawn at scale 1 (1 unit = 1 CSS pixel), which made the
    // FIELD OF VIEW a function of the window size: a bigger screen — or
    // just Ctrl+- — showed more of the arena. In a real-money PvP game
    // that is bought map awareness, the same thing the minimap radar was
    // removed for (A1.8).
    //
    // "cover" (max, not min): the visible world is width/k by height/k,
    // and k >= w/REF_W means the visible width is at most REF_W. Same for
    // height. So an unusual aspect ratio sees LESS than the reference,
    // never more — the fair direction. Using min() would let an ultrawide
    // screen see past it and reopen the hole through the aspect ratio.
    //
    // Recomputed every frame on purpose: two divisions, and it tracks
    // window resizes AND browser zoom with no event plumbing at all.
    viewScale(): number {
        return Math.max(
            this.app.screen.width / REFERENCE_VIEW_W,
            this.app.screen.height / REFERENCE_VIEW_H,
        );
    }

    // Camera: keep (x, y) — the predicted head — at screen center by
    // scaling and translating the WORLD, never the view. The HUD is NOT
    // in this container (DOM overlay + the minimap on the stage), so it
    // keeps its screen pixels: zooming the page resizes the interface,
    // exactly as it does in slither.io, and leaves the field of view
    // untouched.
    camera(x: number, y: number) {
        const k = this.viewScale();
        this.world.scale.set(k);
        // AV.3e — SNAP the world translation to whole device pixels.
        //
        // Left fractional, the world lands on a different sub-pixel phase
        // every single frame, so every texture is resampled slightly
        // differently 60 times a second. A still frame looks fine; in
        // motion the floor SWIMS. That is the residual blur — it is not a
        // filtering setting, it is the offset never sitting still.
        //
        // Snapping costs at most half a CSS pixel of camera placement,
        // which no player can perceive, and it applies to the whole world
        // so pellets and snakes sharpen with the floor.
        //
        // Rounding in DEVICE pixels, not CSS ones: after AV.3d the
        // renderer draws at devicePixelRatio, and snapping to CSS pixels
        // would still leave a half-device-pixel wobble on a HiDPI screen.
        const dpr = this.app.renderer.resolution;
        const snap = (v: number) => Math.round(v * dpr) / dpr;
        this.world.position.set(
            snap(this.app.screen.width / 2 - x * k),
            snap(this.app.screen.height / 2 - y * k),
        );
    }

    // --- food: driven by the Colyseus add/remove callbacks ---------
    addFood(id: string, x: number, y: number, value: number) {
        const isOrb = value > FOOD_VALUE;
        // dropped orb: golden, area proportional to value — an orb worth
        // 5 pellets visibly IS 5 pellets
        const radius = isOrb
            ? FOOD_RADIUS * Math.sqrt(value / FOOD_VALUE)
            : FOOD_RADIUS * (0.7 + Math.random() * 0.6);
        const tint = isOrb
            ? ORB_TINT
            : PELLET_TINTS[Math.floor(Math.random() * PELLET_TINTS.length)];

        const sprite = new Sprite(this.circleTexture);
        sprite.anchor.set(0.5);
        sprite.position.set(x, y);
        sprite.tint = tint;
        sprite.scale.set(radius / SNAKE_RADIUS); // texture is snake-sized
        this.foodLayer.addChild(sprite);
        this.foodSprites.set(id, sprite);
    }

    removeFood(id: string) {
        const sprite = this.foodSprites.get(id);
        if (!sprite) return;
        this.foodSprites.delete(id);
        sprite.destroy(); // sprite only — the shared texture survives
    }

    // --- snakes: fully re-positioned every frame by main.ts --------
    drawSnake(
        id: string,
        colors: SnakeColors,
        headX: number,
        headY: number,
        body: { x: number; y: number }[],
        radius: number,
        alpha: number,
        labelText: string,
        // AV.4 — where THIS snake's pupils look, in radians. Passed only
        // for the local player, whose aim we legitimately know: it is
        // `input.angle`, the very value sent to the server, so the eyes
        // cannot tell a different story from the one being played.
        //
        // Left undefined for everyone else, and that is a RULE, not an
        // omission. An opponent's cursor would announce their turn before
        // they take it — information the player could not otherwise have,
        // which is exactly what A1.8 and AF.3bis exist to prevent. Their
        // pupils follow their VISIBLE heading, which reveals nothing new.
        lookAngle?: number,
    ) {
        let view = this.snakes.get(id);
        if (!view) {
            const root = new Container();
            const bodyC = new Container();
            const head = new Sprite(this.circleTexture);
            head.anchor.set(0.5);
            root.addChild(bodyC);
            root.addChild(head); // added last -> drawn on top of the body
            const mkEye = (tint: number) => {
                const s = new Sprite(this.discTexture);
                s.anchor.set(0.5);
                s.tint = tint;
                root.addChild(s);
                return s;
            };
            // sclerae first, then pupils, so a pupil always sits on top
            const sclerae: [Sprite, Sprite] = [mkEye(EYE_WHITE), mkEye(EYE_WHITE)];
            const pupils: [Sprite, Sprite] = [mkEye(EYE_PUPIL), mkEye(EYE_PUPIL)];
            const label = new Text({
                text: "",
                style: { fill: "#e2e8f0", fontSize: 13, fontFamily: "monospace" },
            });
            label.anchor.set(0.5, 1);
            root.addChild(label);
            this.snakeLayer.addChild(root);
            view = {
                root, body: bodyC, head, sclerae, pupils, label,
                heading: 0, headingValid: false,
                colors: { ...colors },
            };
            this.snakes.set(id, view);
        }
        // re-tint only when colors actually change (offline toggle). Bands
        // never vary independently of `body`, so testing that one field
        // still catches every skin change.
        if (view.colors.body !== colors.body) {
            view.colors = { ...colors };
            view.head.tint = colors.head;
            view.body.children.forEach((s, i) => {
                (s as Sprite).tint = bandTint(colors, i);
            });
        }
        // sync sprite count to the body length. A new segment is born at
        // the TAIL, so its index is final and its band tint is written
        // once, here, for good.
        while (view.body.children.length < body.length) {
            const s = new Sprite(this.circleTexture);
            s.anchor.set(0.5);
            s.tint = bandTint(colors, view.body.children.length);
            view.body.addChild(s);
        }
        while (view.body.children.length > body.length) {
            view.body.children[view.body.children.length - 1].destroy();
        }
        // the texture is drawn at SNAKE_RADIUS: scale carries growth
        const scale = radius / SNAKE_RADIUS;
        for (let i = 0; i < body.length; i++) {
            const s = view.body.children[i] as Sprite;
            s.position.set(body[i].x, body[i].y);
            s.scale.set(scale);
            // AV.3b — align the shading band with the body. The texture's
            // gradient runs along its Y axis, so rotating a segment to its
            // local heading lays that band ACROSS the tube. Neighbours
            // then share the same shading wherever they overlap, which is
            // what removes the internal arcs entirely.
            //
            // Purely cosmetic: it reads positions the simulation already
            // produced and feeds nothing back. A disc is rotationally
            // symmetric, so the silhouette — and the hitbox it suggests —
            // is bit-for-bit what it was (R1).
            const prev = i > 0 ? body[i - 1] : { x: headX, y: headY };
            s.rotation = Math.atan2(body[i].y - prev.y, body[i].x - prev.x);
        }
        view.head.position.set(headX, headY);
        view.head.scale.set(scale);

        // AV.4b — a STABLE heading. Reading it off body[0] alone breaks in
        // two situations that both happen constantly in a real game:
        //
        //   1. A snake entering the AoI has its whole body seeded AT the
        //      head (session.ts updateBody), so body[0] IS the head and
        //      atan2(0, 0) returns 0 — every newcomer's eyes snapped due
        //      East for a few frames.
        //   2. A remote snake whose position stalls (a late packet, dead
        //      reckoning out of samples) has body[0] converge back ONTO
        //      the head. The vector shrinks to nothing and its angle
        //      becomes pure noise, so the pupils spin.
        //
        // Neither is about bots: a HUMAN opponent with a late packet shows
        // exactly the same thing, in a paid round.
        //
        // Fix: walk back along the body for the first tracer far enough to
        // carry a meaningful direction, and if none qualifies, KEEP THE
        // LAST GOOD HEADING rather than recompute noise. Threshold is a
        // fraction of SNAKE_SPACING because that — not the radius — is
        // what governs how far apart tracers settle.
        const minSep = SNAKE_SPACING * 0.25;
        for (const t of body) {
            const dx = headX - t.x;
            const dy = headY - t.y;
            if (dx * dx + dy * dy >= minSep * minSep) {
                view.heading = Math.atan2(dy, dx);
                view.headingValid = true;
                break;
            }
        }
        // The local player is the one case with a meaningful fallback: an
        // aim exists before the body has unfolded, so our own snake never
        // spawns eyeless.
        if (!view.headingValid && lookAngle !== undefined) {
            view.heading = lookAngle;
            view.headingValid = true;
        }
        const heading = view.heading;
        view.head.rotation = heading;
        view.head.tint = colors.head;

        // AV.4 — the eyes are anchored to the BODY's heading; only the
        // pupils swivel, towards `lookAngle` when we have it. For the
        // local player the two differ mid-turn — the aim leads the
        // snake — and that gap is exactly what makes them expressive:
        // the eyes look where you are steering before the body arrives.
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const gaze = lookAngle ?? heading;
        const gx = Math.cos(gaze);
        const gy = Math.sin(gaze);
        const eyeR = radius * EYE_RADIUS;
        for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            // Hidden until a heading is trustworthy. A two-frame absence
            // reads as nothing at all; eyes pointing the wrong way read as
            // a bug — which is precisely how this was reported.
            view.sclerae[i].visible = view.headingValid;
            view.pupils[i].visible = view.headingValid;
            // forward along the heading, then sideways along its normal
            const ex = headX + cos * radius * EYE_FORWARD - sin * side * radius * EYE_SPREAD;
            const ey = headY + sin * radius * EYE_FORWARD + cos * side * radius * EYE_SPREAD;
            const sclera = view.sclerae[i];
            sclera.position.set(ex, ey);
            sclera.scale.set(eyeR / SNAKE_RADIUS);
            const pupil = view.pupils[i];
            pupil.position.set(ex + gx * eyeR * PUPIL_TRAVEL, ey + gy * eyeR * PUPIL_TRAVEL);
            pupil.scale.set((eyeR * PUPIL_RADIUS) / SNAKE_RADIUS);
        }

        view.root.alpha = alpha;
        view.label.position.set(headX, headY - radius - 8);
        if (view.label.text !== labelText) view.label.text = labelText;
    }

    removeSnake(id: string) {
        const view = this.snakes.get(id);
        if (!view) return;
        this.snakes.delete(id);
        view.root.destroy({ children: true });
    }

    // A4.2a — session teardown: wipe every per-room visual so the next
    // session (demo -> arena handoff) starts on a clean canvas. The
    // shared texture and the static decor survive: they are per-VIEW,
    // not per-room.
    clear() {
        for (const id of [...this.snakes.keys()]) this.removeSnake(id);
        for (const id of [...this.foodSprites.keys()]) this.removeFood(id);
        this.debugGfx.clear();
        this.minimap.clear();
        this.extractGfx.clear();
        this.extractLabel.visible = false;
    }

    // --- debug overlays (world space): AoI bubble + server ghost ---
    //
    // OFF for players (2026-09-08, user call). The green ghost is the
    // SERVER's belief about where our head is, so the gap between it and
    // the drawn head is the round-trip time made visible — honest, and
    // exactly the wrong thing to show a paying player: it reads as the
    // game being laggy rather than as the network being measured.
    //
    // Kept behind a flag rather than deleted, because it is the
    // instrument A4.14 is diagnosed with (the ~20px divergence floor,
    // median 25px for a 15px-radius snake). Removing the measurement to
    // hide the symptom is how a known bug becomes an unknown one.
    //
    // A query param and not a build flag: it can be switched on against
    // the LIVE site while investigating, with no rebuild. Safe to expose
    // — it renders our OWN server position and our OWN AoI radius, never
    // anything about an opponent, so it grants no map awareness (A1.8).
    drawDebug(selfX: number, selfY: number, ghostX: number, ghostY: number, radius: number) {
        // never drawn when off, so there is nothing to clear either
        if (!this.debug) return;
        this.debugGfx.clear();
        this.debugGfx
            .circle(selfX, selfY, AOI_RADIUS)
            .stroke({ width: 2, color: 0x335588, alpha: 0.5 });
        // where the SERVER believes we are: the gap between this ring
        // and our head IS the round-trip time, made visible
        this.debugGfx
            .circle(ghostX, ghostY, radius)
            .stroke({ width: 2, color: 0x44ff44, alpha: 0.7 });
    }

    // Minimap (screen space, bottom-right): world disk + SELF +
    // EXTRACT only (proto rule: fog of war for everything else).
    // Deliberately no opponents: showing them would bake the
    // player-radar into the UI we later have to unbake (A1.8 note —
    // players still globally synced, to close before real money).
    drawMinimap(selfX: number, selfY: number, extract?: { x: number; y: number }) {
        this.minimap.clear();
        const mmX = this.app.screen.width - MINIMAP_RADIUS - 20;
        const mmY = this.app.screen.height - MINIMAP_RADIUS - 20;
        const s = MINIMAP_RADIUS / WORLD_RADIUS;
        this.minimap
            .circle(mmX, mmY, MINIMAP_RADIUS)
            .fill({ color: 0x0e1621, alpha: 0.8 })
            .stroke({ width: 2, color: 0x4a5578 });
        if (extract) {
            this.minimap.circle(mmX + extract.x * s, mmY + extract.y * s, 5).fill(0xffcc66);
        }
        this.minimap.circle(mmX + selfX * s, mmY + selfY * s, 4).fill(0xffffff);
    }

    // The extract zone, redrawn each frame (it pulses). channelFrames
    // is the LOCAL player's progress — the golden ring everyone can
    // see on other snakes comes from their synced channel field.
    drawExtract(active: boolean, x: number, y: number, ttlFrames: number, channelFrames: number) {
        this.extractGfx.clear();
        if (!active) {
            this.extractLabel.visible = false;
            return;
        }
        // bomb behavior in the last seconds: red, pulsing once per
        // second — the proto's 3-blink warning, driven by ttl alone
        const warning = ttlFrames <= EXTRACT_WARNING_FRAMES;
        const pulse = warning
            ? 0.25 + 0.35 * Math.abs(Math.sin((ttlFrames / 60) * Math.PI))
            : 0.12;
        const color = warning ? 0xff4455 : 0xffcc66;
        this.extractGfx
            .circle(x, y, EXTRACT_RADIUS)
            .fill({ color, alpha: pulse })
            .stroke({ width: 4, color, alpha: 0.9 });
        // own channel: a ring filling clockwise from 12 o'clock. Drawn
        // JUST INSIDE the zone edge, and with an explicit moveTo to the
        // arc's start — without it, Pixi connects a stray line from the
        // circle above to the arc's start (the "green line into the sky"
        // bug). The moveTo opens a fresh sub-path so only the arc strokes.
        if (channelFrames > 0) {
            const frac = Math.min(channelFrames / EXTRACT_CHANNEL_FRAMES, 1);
            const rr = EXTRACT_RADIUS - 8; // hug the boundary from inside
            const a0 = -Math.PI / 2;       // 12 o'clock
            const a1 = a0 + frac * 2 * Math.PI;
            this.extractGfx
                .moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr)
                .arc(x, y, rr, a0, a1)
                .stroke({ width: 6, color: 0x50fa7b });
        }
        this.extractLabel.visible = true;
        this.extractLabel.position.set(x, y - EXTRACT_RADIUS - 28);
        this.extractLabel.text = warning
            ? `!! ${Math.ceil(ttlFrames / 60)}s !!`
            : `EXTRACT ${Math.ceil(ttlFrames / 60)}s`;
    }
}
