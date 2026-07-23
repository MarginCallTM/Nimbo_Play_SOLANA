import { Container, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import {
    BOOST_ORB_VALUE,
    GROWTH_LENGTH_PER_SCORE,
    GROWTH_RADIUS_FACTOR,
    SNAKE_BASE_LENGTH,
    SPAWN_GRACE_FRAMES,
    SNAKE_BOOST_COST,
    SNAKE_BOOST_SPEED,
    SNAKE_RADIUS,
    SNAKE_SPACING,
    SNAKE_SPEED,
    SNAKE_TURN_SPEED,
} from "./constants";

interface Point {
    x: number;
    y: number;
}

export interface SnakeColors {
    body: string;
    head: string;
}

export interface Snake {
    head: Point;
    angle: number;          // actual heading (radians)
    desiredAngle: number;   // intent set by input
    boost: boolean;         // intent set by input
    score: number;          // THE source of truth: everything below derives from it
    value: number;          // mock-SOL ledger: enters via buy-in, moves via
                            // corpses, leaves via extraction. NEVER minted by food.
    radius: number;         // derived from score each tick (cached for eat/collisions)
    boostDebt: number;      // score burned by boosting, not yet dropped as an orb
    tracers: Point[];        // body points, ordered head to tail
    colors: SnakeColors;
    grace: number;           // spawn-protection frames left: while > 0 the
                             // snake can't kill, can't die, eats nothing
}

export interface SnakeDims {
    length: number;    // tracer count
    radius: number;    // px per segment
    turnSpeed: number; // rad/frame
}

// The core idea of A0.3 (littensy: describeSnakeFromScore): score is the
// single variable, the body is a pure function of it. Every formula here
// is a gameplay knob — tune at playtest, may need soft caps.
export function describeSnakeFromScore(score: number): SnakeDims {
    // sqrt = fast growth early, diminishing later (4x the score is only
    // 2x the growth) — keeps huge snakes impressive but not absurd
    const growth = Math.sqrt(score);
    const radius = SNAKE_RADIUS * (1 + growth * GROWTH_RADIUS_FACTOR);
    return {
        length: Math.round(SNAKE_BASE_LENGTH + score * GROWTH_LENGTH_PER_SCORE),
        radius,
        // bigger snake = slower turning: the weight feel, and later the
        // balance lever against big buy-ins (A0.8)
        turnSpeed: SNAKE_TURN_SPEED * Math.sqrt(SNAKE_RADIUS / radius),
    };
}

export function createSnake(
    x: number,
    y: number,
    score: number,
    value: number,
    colors: SnakeColors,
): Snake {
    const dims = describeSnakeFromScore(score);
    const tracers: Point[] = [];
    for (let i = 0; i < dims.length; i++) {
        tracers.push({ x: x - (i + 1) * SNAKE_SPACING, y });
    }
    return {
        head: { x, y },
        angle: 0,
        desiredAngle: 0,
        boost: false,
        score,
        value,
        radius: dims.radius,
        boostDebt: 0,
        tracers,
        colors,
        grace: SPAWN_GRACE_FRAMES,
    };
}


// Turns `angle` toward `target` by at most `maxStep` per call: the
// snake cannot turn around instantly (the slither feel)
function turnTowards(angle: number, target: number, maxStep: number): number {
    let diff = target - angle;
    // wrap the difference into [-PI, PI], otherwise we would turn 350
    // degrees the wrong way instead of -10
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (diff > maxStep) diff = maxStep;
    if (diff < -maxStep) diff = -maxStep;
    return angle + diff;
}

export function updateSnake(
    snake: Snake,
    dt: number,
    dropOrb: (x: number, y: number, value: number) => void,
) {
    // 0) spawn protection ticks down
    if (snake.grace > 0) snake.grace -= dt;

    // 1) boost gating: at base size the sprint cuts off — you cannot
    //    burn score you do not have (littensy: snakeIsBoosting)
    const boosting = snake.boost && snake.score >= BOOST_ORB_VALUE;

    // 2) boost cost: the drain accumulates as a debt, and every full
    //    orb worth of debt leaves the snake as an eatable orb at the
    //    tail. Score only ever moves in orb-sized chunks: what the
    //    snake loses exists in the world, nothing evaporates.
    if (boosting) {
        snake.boostDebt += SNAKE_BOOST_COST * dt;
        while (snake.boostDebt >= BOOST_ORB_VALUE && snake.score >= BOOST_ORB_VALUE) {
            snake.boostDebt -= BOOST_ORB_VALUE;
            snake.score -= BOOST_ORB_VALUE;
            const tail = snake.tracers[snake.tracers.length - 1];
            dropOrb(tail.x, tail.y, BOOST_ORB_VALUE);
        }
    }

    // 3) body characteristics derive from the (post-drain) score
    const dims = describeSnakeFromScore(snake.score);
    snake.radius = dims.radius;

    // 4) heading turns toward the intent, at the score-derived rate
    snake.angle = turnTowards(snake.angle, snake.desiredAngle, dims.turnSpeed * dt);

    // 5) head moves forward along its heading
    const speed = boosting ? SNAKE_BOOST_SPEED : SNAKE_SPEED;
    snake.head.x += Math.cos(snake.angle) * speed * dt;
    snake.head.y += Math.sin(snake.angle) * speed * dt;

    // (the world border no longer slides: it KILLS — handled by
    // findDeaths in collision.ts)

    // 6) grow / shrink toward the target length. Growing copies the tail
    //    point so new segments unfold from the tail instead of popping in
    while (snake.tracers.length < dims.length) {
        const tail = snake.tracers[snake.tracers.length - 1];
        snake.tracers.push({ x: tail.x, y: tail.y });
    }
    while (snake.tracers.length > dims.length) {
        snake.tracers.pop();
    }

    // 7) follow-the-leader (littensy approach): each tracer eases toward
    //    the one ahead of it; alpha = distance traveled / spacing
    const alpha = Math.min((speed * dt) / SNAKE_SPACING, 1);
    let previous = snake.head;
    for (const tracer of snake.tracers) {
        tracer.x += (previous.x - tracer.x) * alpha;
        tracer.y += (previous.y - tracer.y) * alpha;
        previous = tracer;
    }
}

// Sprite-based rendering: ONE shared circle texture, one sprite per
// tracer. Replaces the per-frame Graphics rebuild (hundreds of filled
// circles re-tessellated 60x/s — slow, and fragile in Pixi v8 at large
// vertex counts: intermittent one-frame dropouts). Sprites batch into
// a single draw call and only positions/scales change per frame.
export interface SnakeView {
    root: Container;
    body: Container; // one sprite per tracer, order irrelevant (same tint)
    head: Sprite;    // separate + added last -> always drawn on top
    texture: Texture;
}

export function createSnakeView(texture: Texture, colors: SnakeColors): SnakeView {
    const root = new Container();
    const body = new Container();
    const head = new Sprite(texture);
    head.anchor.set(0.5);
    head.tint = colors.head;
    root.addChild(body);
    root.addChild(head);
    return { root, body, head, texture };
}

export function drawSnake(view: SnakeView, snake: Snake) {
    // sync sprite count to the body length
    while (view.body.children.length < snake.tracers.length) {
        const s = new Sprite(view.texture);
        s.anchor.set(0.5);
        s.tint = snake.colors.body;
        view.body.addChild(s);
    }
    while (view.body.children.length > snake.tracers.length) {
        view.body.children[view.body.children.length - 1].destroy();
    }
    // the texture is drawn at SNAKE_RADIUS: scale carries the growth
    const scale = snake.radius / SNAKE_RADIUS;
    for (let i = 0; i < snake.tracers.length; i++) {
        const s = view.body.children[i] as Sprite;
        s.position.set(snake.tracers[i].x, snake.tracers[i].y);
        s.scale.set(scale);
    }
    view.head.position.set(snake.head.x, snake.head.y);
    view.head.scale.set(scale);
}
