import { Container, Graphics, Sprite } from "pixi.js";
import type { Renderer, Texture } from "pixi.js";
import {
    FOOD_MAGNET_RANGE,
    FOOD_MAGNET_SPEED,
    FOOD_RADIUS,
    FOOD_RESERVE_INITIAL,
    FOOD_VALUE,
    FOOD_WORTH,
    GRID_RESOLUTION,
    WORLD_RADIUS,
} from "./constants";
import { SpatialGrid } from "./grid";

// Ambient pellet colors — visual variety only, no gameplay meaning
const PELLET_TINTS = [0xff79c6, 0x8be9fd, 0x50fa7b, 0xf1fa8c, 0xbd93f9, 0xffb86c];
const ORB_TINT = 0x3981f6; // boost orbs = player color, so the trail reads clearly

export interface Food {
    x: number;
    y: number;
    value: number;    // growth points (score) granted when eaten
    worth: number;    // mock-SOL carried (0 for ambient food: gameplay only)
    ambient: boolean; // ambient pellets respawn elsewhere; dropped orbs don't
    sprite: Sprite;
}

export interface EatResult {
    score: number;
    worth: number;
}

export class FoodField {
    private grid = new SpatialGrid<Food>(GRID_RESOLUTION);
    private container = new Container();
    private texture: Texture;
    private worthOnGround = 0;
    private reserve = FOOD_RESERVE_INITIAL;

    constructor(renderer: Renderer, parent: Container) {
        // ONE texture shared by every pellet: Pixi batches all sprites
        // using the same texture into a single draw call. This is what
        // makes thousands of entities cheap (vs redrawing a Graphics).
        const g = new Graphics().circle(0, 0, FOOD_RADIUS).fill(0xffffff);
        this.texture = renderer.generateTexture(g);
        g.destroy();
        parent.addChild(this.container);
    }

    spawnAmbient(count: number) {
        for (let i = 0; i < count; i++) this.spawnAmbientAtRandom();
    }

    // Orbs dropped at the tail while boosting: the score leaves the
    // snake but STAYS in the world as something eatable — nothing is
    // created or destroyed (preview of the A0.7 conservation rule)
    spawnOrb(x: number, y: number, value: number, worth: number, tint?: string | number) {
        this.add(x, y, value, worth, false, tint);
    }

    // total mock-SOL lying on the ground (conservation HUD)
    totalWorth(): number {
        return this.worthOnGround;
    }

    // mock-SOL still backing future ambient pellets (conservation HUD)
    reserveLeft(): number {
        return this.reserve;
    }

    // D71: the reserve's inflow — a share of every buy-in lands here
    // (and, in the real game, the orphan SOL swept between rounds)
    fundReserve(amount: number) {
        this.reserve += amount;
    }

    // Death recycling (70/30 rule): spawns ONE classic pellet at a
    // random map spot, its worth funded by a corpse — not the reserve.
    // Looks and behaves exactly like any ambient pellet.
    scatterRecycled(worth: number) {
        const r = WORLD_RADIUS * Math.sqrt(Math.random());
        const a = Math.random() * 2 * Math.PI;
        this.add(r * Math.cos(a), r * Math.sin(a), FOOD_VALUE, worth, true);
    }

    // Called once per frame with the head position. Eats everything
    // within `eatRange`, pulls pellets slightly beyond it toward the
    // head (the slither "vacuum" feel). Returns the total score gained.
    eatAround(x: number, y: number, eatRange: number, dt: number): EatResult {
        let gainedScore = 0;
        let gainedWorth = 0;
        const candidates = this.grid.queryNear(x, y, eatRange + FOOD_MAGNET_RANGE);
        for (const food of candidates) {
            const dx = x - food.x;
            const dy = y - food.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= eatRange) {
                gainedScore += food.value;
                gainedWorth += food.worth;
                this.eat(food);
            } else if (dist <= eatRange + FOOD_MAGNET_RANGE) {
                // moving a grid item: remove -> mutate -> re-insert,
                // otherwise the grid keeps it filed in a stale cell
                this.grid.remove(food);
                const pull = Math.min((FOOD_MAGNET_SPEED * dt) / dist, 1);
                food.x += dx * pull;
                food.y += dy * pull;
                this.grid.insert(food);
                food.sprite.position.set(food.x, food.y);
            }
        }
        return { score: gainedScore, worth: gainedWorth };
    }

    // Nearest food item within `range` of (x, y), or null. Bot
    // perception: bots see through the same grid as everyone else,
    // no dedicated structure, no cheating.
    findNearest(x: number, y: number, range: number): Food | null {
        let nearest: Food | null = null;
        let nearestDist = range;
        for (const food of this.grid.queryNear(x, y, range)) {
            const d = Math.hypot(x - food.x, y - food.y);
            if (d < nearestDist) {
                nearest = food;
                nearestDist = d;
            }
        }
        return nearest;
    }

    private spawnAmbientAtRandom() {
        // EVERY pellet on the map is real money (no valueless pellets):
        // a pellet only spawns if the reserve can fund it. Reserve dry
        // -> the respawn is skipped and the SUPPLY rarefies — scarcity
        // is the honest signal, never a lying pellet. Without the gate,
        // sum(extractions) could exceed sum(deposits): insolvency.
        if (this.reserve < FOOD_WORTH) return;
        this.reserve -= FOOD_WORTH;
        // sqrt for a uniform distribution over the disk
        const r = WORLD_RADIUS * Math.sqrt(Math.random());
        const a = Math.random() * 2 * Math.PI;
        this.add(r * Math.cos(a), r * Math.sin(a), FOOD_VALUE, FOOD_WORTH, true);
    }

    private add(
        x: number,
        y: number,
        value: number,
        worth: number,
        ambient: boolean,
        tint?: string | number,
    ) {
        this.worthOnGround += worth;
        const sprite = new Sprite(this.texture);
        sprite.anchor.set(0.5);
        sprite.position.set(x, y);
        if (ambient) {
            sprite.tint = PELLET_TINTS[Math.floor(Math.random() * PELLET_TINTS.length)];
            sprite.scale.set(0.7 + Math.random() * 0.6); // visual only
        } else {
            sprite.tint = tint ?? ORB_TINT;
            // area proportional to value: an orb worth 1.5 pellets
            // visibly IS 1.5 pellets
            sprite.scale.set(Math.sqrt(value / FOOD_VALUE));
        }
        this.container.addChild(sprite);
        this.grid.insert({ x, y, value, worth, ambient, sprite });
    }

    private eat(food: Food) {
        this.worthOnGround -= food.worth;
        this.grid.remove(food);
        this.container.removeChild(food.sprite);
        food.sprite.destroy(); // sprite only — the shared texture survives
        // keep world density constant: an eaten ambient pellet respawns
        // somewhere else; boost orbs are gone for good
        if (food.ambient) this.spawnAmbientAtRandom();
    }
}
