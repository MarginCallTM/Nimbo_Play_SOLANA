// proto/src/collision.ts
import { WORLD_RADIUS } from "./constants";
import type { SpatialGrid } from "./grid";
import type { Snake } from "./snake";

// One entry per body tracer, indexed in a spatial grid each frame
export interface Segment {
    x: number;
    y: number;
    radius: number;
    owner:Snake;
}

// Segments move EVERY frame, so instead of the remove/mutate/insert
// dance per tracer we rebuild the grid from scratch each tick. Same
// O(total segments) cost as an incremental update, zero stale-cell
// risk. (littensy tracks segments incrementally — revisit only if
// profiling says so.)
export function fillSegmentGrid(grid: SpatialGrid<Segment>, snakes: Snake[]) {
    grid.clear();
    for (const snake of snakes) {
        // spawn protection: a graced snake's body is intangible — it
        // cannot kill anyone who spawnkills into it
        if (snake.grace > 0) continue;
        for (const t of snake.tracers) {
            grid.insert({x: t.x, y: t.y, radius: snake.radius, owner: snake});
        }
    }
}

// Death rules (slither): a HEAD dies by touching the BODY of another
// snake or the world border. Bodies never die from being touched, and
// crossing YOURSELF is legal. Head-vs-head: each head overlaps the
// other's first tracers, so both die the same frame — fair.
export function findDeaths(snakes: Snake[], grid: SpatialGrid<Segment>): Set<Snake> {
    const dead = new Set<Snake>();

    // widest possible hit = my radius + the fattest snake's radius;
    // used as the broad-phase query range
    let maxRadius = 0;
    for (const s of snakes) maxRadius = Math.max(maxRadius, s.radius);

    for (const snake of snakes) {
        // spawn protection: a graced snake cannot die
        if (snake.grace > 0) continue;
        // lethal border (the A0.2 "slide along the edge" was a
        // placeholder for exactly this)
        if (Math.hypot(snake.head.x, snake.head.y) + snake.radius >= WORLD_RADIUS) {
            dead.add(snake);
            continue;
        }
        // broad phase: grid candidates around the head...
        const candidates = grid.queryNear(
            snake.head.x,
            snake.head.y,
            snake.radius + maxRadius,
        );
        // ...narrow phase: exact circle-vs-circle overlap
        for (const seg of candidates) {
            if (seg.owner === snake) continue; // self-crossing is legal
            const dist = Math.hypot(snake.head.x - seg.x, snake.head.y - seg.y);
            if (dist < snake.radius + seg.radius) {
                dead.add(snake);
                break;
            }
        }
    }
    return dead;
}
