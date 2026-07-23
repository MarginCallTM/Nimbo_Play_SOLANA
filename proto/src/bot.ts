import {
    BOT_BOOST_MIN_SCORE,
    BOT_LIFETIME_MAX,
    BOT_LIFETIME_MIN,
    BOT_LOOKAHEAD,
    BOT_VISION,
    WORLD_RADIUS,
} from "./constants";
import type { Segment } from "./collision";
import type { FoodField } from "./food";
import type { SpatialGrid } from "./grid";
import type { Snake } from "./snake";

// Per-bot memory carried between frames (Thge snake itself stays pure
// sim data - wander state is a BRAIN concern, not a body concern)
export interface BotBrain {
    snake: Snake;
    wanderAngle: number;
    wanderTime: number; // frames left before picking a new heading
    lifetime: number;   // frames left before this "player" crashes out
                        // (bot churn = the economy's simulated traffic)
}

export function createBrain(snake: Snake): BotBrain {
    return {
        snake,
        wanderAngle: Math.random() * 2 * Math.PI,
        wanderTime: 0,
        lifetime:
            BOT_LIFETIME_MIN + Math.random() * (BOT_LIFETIME_MAX - BOT_LIFETIME_MIN),
    };
}

// Priority-based steering, ONE decision per frame:
//  1. survive (border or adverse body ahead -> flee)
//  2. eat (nearest food in vision)
//  3. wander (random, heading, changed every 1-3sec)

// Perception goes through the same spatial grids as the rest of the
// game: a probe point projected ahead of the head asks the segment
// grid "is there fanger where I am ABOUT to be?"
export function driveBot(
    brain: BotBrain,
    segments: SpatialGrid<Segment>,
    food: FoodField,
    dt: number,
) {
    const snake = brain.snake;

    // probe point ahead of the head
    const px = snake.head.x + Math.cos(snake.angle) * BOT_LOOKAHEAD;
    const py = snake.head.y + Math.sin(snake.angle) * BOT_LOOKAHEAD;

    // 1a) border ahead -> aim at the center calmly
    if (Math.hypot(px, py) > WORLD_RADIUS * 0.85) {
        snake.desiredAngle = Math.atan2(-snake.head.y, -snake.head.x);
        snake.boost = false;
        return
    }

    // 1b) closet adverse segment near the probe -> flee straight away
    //      from it sprinting if fat enough to afford the score burn
    let threat: Segment | null = null;
    let threatDist = Infinity;
    for (const seg of segments.queryNear(px, py, BOT_LOOKAHEAD)) {
        if (seg.owner == snake) continue; // Own body is not a threat
        const d = Math.hypot(px - seg.x, py - seg.y);
        if (d < threatDist) {
            threat = seg;
            threatDist = d;
        }
    }
    if (threat && threatDist < BOT_LOOKAHEAD) {
        snake.desiredAngle = Math.atan2(
            snake.head.y - threat.y,
            snake.head.x - threat.x,
        );
        snake.boost = snake.score > BOT_BOOST_MIN_SCORE;
        return;
    }
    snake.boost = false;

    // 2) nearest food in vision
    const target = food.findNearest(snake.head.x, snake.head.y, BOT_VISION);
    if (target) {
        snake.desiredAngle = Math.atan2(
            target.y - snake.head.y,
            target.x - snake.head.x,
        );
        return
    }

    // 3) wander hold a random heading for 1-3 seconds
    brain.wanderTime -= dt;
    if (brain.wanderTime <= 0) {
        brain.wanderAngle = Math.random() * 2 * Math.PI;
        brain.wanderTime = 60 + Math.random() * 120;
    }
    snake.desiredAngle = brain.wanderAngle;

}
