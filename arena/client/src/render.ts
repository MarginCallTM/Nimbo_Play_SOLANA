// Pixi rendering layer, ported from the proto (A0.x). This module
// only DRAWS: the netcode (main.ts) computes every position —
// predicted self, interpolated others, locally regrown bodies — and
// hands them over. Same sim/render split as the proto's Snake vs
// SnakeView, now applied across the network boundary.
import { Application, Container, Graphics, Rectangle, Sprite, Text, TilingSprite } from "pixi.js";
import type { Texture } from "pixi.js";
import {
    AOI_RADIUS,
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_WARNING_FRAMES,
    FOOD_RADIUS,
    FOOD_VALUE,
    SNAKE_RADIUS,
    REFERENCE_VIEW_CORNER,
    REFERENCE_VIEW_H,
    REFERENCE_VIEW_W,
    WORLD_RADIUS,
} from "@nimbo/shared";

export interface SnakeColors {
    body: string;
    head: string;
}

export const PLAYER_COLORS: SnakeColors = { body: "#2b6fd6", head: "#3981f6" };
export const OFFLINE_COLORS: SnakeColors = { body: "#4a4f5c", head: "#6a7080" };
// one palette per opponent, cycled through as they appear
export const OTHER_PALETTES: SnakeColors[] = [
    { body: "#d6702b", head: "#f68f39" }, // orange
    { body: "#8f2bd6", head: "#a939f6" }, // purple
    { body: "#2bd670", head: "#39f68f" }, // green
    { body: "#d62b4e", head: "#f63963" }, // red
    { body: "#d6c22b", head: "#f6e039" }, // yellow
    { body: "#2bc9d6", head: "#39e5f6" }, // cyan
];

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

const HEX_GAP = 0x070a14;    // the seam between cells: darkest tone
const HEX_FILL = 0x0d1326;   // the cell face
const HEX_TOP = 0x1a2242;    // upper edges catch the light
const HEX_BOTTOM = 0x05070e; // lower edges fall into shadow

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

// One cell: face, then shadow on the lower edges, then highlight on the
// upper ones. That two-stroke split is the whole bevel — it is what
// makes the floor read as embossed panels instead of a flat honeycomb.
// Baked into a texture once, so its cost is paid at boot and never again.
function drawHexCell(g: Graphics, cx: number, cy: number, r: number) {
    const p = hexPoints(cx, cy, r);
    g.poly(p).fill(HEX_FILL);
    // y grows downward: v0(right) -> v1 -> v2 -> v3(left) is the LOWER
    // chain, v3 -> v4 -> v5 -> v0 the upper one.
    g.moveTo(p[0], p[1])
        .lineTo(p[2], p[3])
        .lineTo(p[4], p[5])
        .lineTo(p[6], p[7])
        .stroke({ width: 3, color: HEX_BOTTOM, alpha: 0.9 });
    g.moveTo(p[6], p[7])
        .lineTo(p[8], p[9])
        .lineTo(p[10], p[11])
        .lineTo(p[0], p[1])
        .stroke({ width: 3, color: HEX_TOP, alpha: 0.55 });
}

// The repeating tile, rendered once at boot into a GPU texture.
//
// Seamlessness comes from drawing each of the two lattice centres NINE
// times — itself plus the eight neighbouring tile offsets. A cell that
// straddles an edge is therefore also drawn coming back in on the
// opposite side; `frame` then keeps only the tile proper. Skipping this
// leaves cells sliced off at the border, which is the classic tiling
// artefact and looks exactly like a mis-sized tile.
function makeHexTileTexture(renderer: Application["renderer"]): Texture {
    const g = new Graphics();
    // the seam colour shows wherever no cell covers, so it is the floor
    g.rect(-2, -2, TILE_W_PX + 4, TILE_H_PX + 4).fill(HEX_GAP);

    const centres = [
        { x: 0, y: 0 },
        { x: TILE_W_PX / 2, y: TILE_H_PX / 2 }, // = (1.5R, sqrt(3)R/2)
    ];
    for (const c of centres) {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                drawHexCell(g, c.x + dx * TILE_W_PX, c.y + dy * TILE_H_PX, HEX_R_PX * 0.94);
            }
        }
    }

    const texture = renderer.generateTexture({
        target: g,
        frame: new Rectangle(0, 0, TILE_W_PX, TILE_H_PX),
        antialias: true,
    });
    g.destroy();
    return texture;
}

// One snake on screen: body sprites + head sprite + floating label.
// Sprites all share ONE texture (proto lesson): Pixi batches them
// into a single draw call — a 400-segment snake costs the same GPU
// submission as a dot.
interface SnakeView {
    root: Container;
    body: Container;
    head: Sprite;
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

    private constructor() {
        this.app = new Application();
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
        await app.init({ resizeTo: window, background: "#0b1020", antialias: true });
        document.body.appendChild(app.canvas);

        // AV.0 — frame counter, averaged over a 500ms window (see stats()).
        // Attached to the VIEW, not to a session: the menu and the demo
        // are exactly where a heavy effect would go unnoticed otherwise.
        view.fpsSampledAt = performance.now();
        app.ticker.add(() => {
            view.frames++;
            const elapsed = performance.now() - view.fpsSampledAt;
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
        const floor = new TilingSprite({
            texture: makeHexTileTexture(app.renderer),
            width: floorSpan,
            height: floorSpan,
            tileScale: { x: HEX_TILE_SCALE, y: HEX_TILE_SCALE },
        });
        floor.position.set(-floorSpan / 2, -floorSpan / 2);
        view.world.addChild(floor);

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

        // the one texture every circle sprite is an instance of
        const gfx = new Graphics().circle(0, 0, SNAKE_RADIUS).fill(0xffffff);
        view.circleTexture = app.renderer.generateTexture(gfx);
        gfx.destroy();

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
        this.world.position.set(
            this.app.screen.width / 2 - x * k,
            this.app.screen.height / 2 - y * k,
        );
    }

    // --- food: driven by the Colyseus add/remove callbacks ---------
    addFood(id: string, x: number, y: number, value: number) {
        const sprite = new Sprite(this.circleTexture);
        sprite.anchor.set(0.5);
        sprite.position.set(x, y);
        const base = FOOD_RADIUS / SNAKE_RADIUS; // texture is snake-sized
        if (value > FOOD_VALUE) {
            // dropped orb: golden, area proportional to value — an orb
            // worth 5 pellets visibly IS 5 pellets
            sprite.tint = ORB_TINT;
            sprite.scale.set(base * Math.sqrt(value / FOOD_VALUE));
        } else {
            sprite.tint = PELLET_TINTS[Math.floor(Math.random() * PELLET_TINTS.length)];
            sprite.scale.set(base * (0.7 + Math.random() * 0.6));
        }
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
    ) {
        let view = this.snakes.get(id);
        if (!view) {
            const root = new Container();
            const bodyC = new Container();
            const head = new Sprite(this.circleTexture);
            head.anchor.set(0.5);
            root.addChild(bodyC);
            root.addChild(head); // added last -> drawn on top of the body
            const label = new Text({
                text: "",
                style: { fill: "#e2e8f0", fontSize: 13, fontFamily: "monospace" },
            });
            label.anchor.set(0.5, 1);
            root.addChild(label);
            this.snakeLayer.addChild(root);
            view = { root, body: bodyC, head, label, colors: { ...colors } };
            this.snakes.set(id, view);
        }
        // re-tint only when colors actually change (offline toggle)
        if (view.colors.body !== colors.body) {
            view.colors = { ...colors };
            view.head.tint = colors.head;
            for (const s of view.body.children) (s as Sprite).tint = colors.body;
        }
        // sync sprite count to the body length
        while (view.body.children.length < body.length) {
            const s = new Sprite(this.circleTexture);
            s.anchor.set(0.5);
            s.tint = colors.body;
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
        }
        view.head.position.set(headX, headY);
        view.head.scale.set(scale);
        view.head.tint = colors.head;
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
            .fill({ color: 0x0b1020, alpha: 0.7 })
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
