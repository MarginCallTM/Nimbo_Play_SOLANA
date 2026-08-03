// Pixi rendering layer, ported from the proto (A0.x). This module
// only DRAWS: the netcode (main.ts) computes every position —
// predicted self, interpolated others, locally regrown bodies — and
// hands them over. Same sim/render split as the proto's Snake vs
// SnakeView, now applied across the network boundary.
import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import type { Texture } from "pixi.js";
import {
    AOI_RADIUS,
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_WARNING_FRAMES,
    FOOD_RADIUS,
    FOOD_VALUE,
    SNAKE_RADIUS,
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

    private constructor() {
        this.app = new Application();
    }

    // Pixi v8 initializes asynchronously (GPU context negotiation) —
    // hence a static factory instead of doing it in the constructor.
    static async create(): Promise<GameView> {
        const view = new GameView();
        const app = view.app;
        await app.init({ resizeTo: window, background: "#0b1020", antialias: true });
        document.body.appendChild(app.canvas);

        // z-order = insertion order: decor < food < debug < snakes
        app.stage.addChild(view.world);

        // static scenery, drawn ONCE: world border + reference dots
        // (without them, moving over a uniform background shows nothing)
        const decor = new Graphics();
        decor.circle(0, 0, WORLD_RADIUS).stroke({ width: 8, color: "#4a5578" });
        for (let i = 0; i < 900; i++) {
            const r = WORLD_RADIUS * Math.sqrt(Math.random());
            const a = Math.random() * 2 * Math.PI;
            decor.circle(r * Math.cos(a), r * Math.sin(a), 3).fill("#232c4a");
        }
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

    // Camera: keep (x, y) — the predicted head — at screen center by
    // translating the WORLD, never the view. World px == screen px
    // (scale 1), so screen-space math stays trivial.
    camera(x: number, y: number) {
        this.world.position.set(
            this.app.screen.width / 2 - x,
            this.app.screen.height / 2 - y,
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

    // --- debug overlays (world space): AoI bubble + server ghost ---
    drawDebug(selfX: number, selfY: number, ghostX: number, ghostY: number, radius: number) {
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
        // own channel: a ring filling clockwise from 12 o'clock
        if (channelFrames > 0) {
            const frac = Math.min(channelFrames / EXTRACT_CHANNEL_FRAMES, 1);
            this.extractGfx
                .arc(x, y, EXTRACT_RADIUS + 12, -Math.PI / 2, -Math.PI / 2 + frac * 2 * Math.PI)
                .stroke({ width: 6, color: 0x50fa7b });
        }
        this.extractLabel.visible = true;
        this.extractLabel.position.set(x, y - EXTRACT_RADIUS - 28);
        this.extractLabel.text = warning
            ? `!! ${Math.ceil(ttlFrames / 60)}s !!`
            : `EXTRACT ${Math.ceil(ttlFrames / 60)}s`;
    }
}
