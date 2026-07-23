import {
    EXTRACT_CHANNEL_FRAMES,
    EXTRACT_RADIUS,
    EXTRACT_SPAWN_COOLDOWN,
    EXTRACT_TTL,
    WORLD_RADIUS,
} from "./constants";

interface Point {
    x: number;
    y: number;
}

export interface ExtractPoint {
    x: number;
    y: number;
    ttl: number; // frames left before the point vanishes unused
}

// One extract point at a time (proto): three phases - 
// cooldown (nothing on the map) -> active (point up, ttl ticking)
// -> used or expired -> back to cooldown
export interface ExtractState {
    point: ExtractPoint | null;
    cooldown: number; // frames until the next point spawns
    progress: number; // channel frames accumulated by the player
}

export function createExtractState(): ExtractState {
    return { point: null, cooldown: EXTRACT_SPAWN_COOLDOWN, progress: 0};
}

export type ExtractStatus =
    | "idle"
    | "spawned"
    | "channeling"
    | "extracted"
    | "detonated";

// Advances the state machine and the player's channel. The channel
// rule is purely SPATIAL: head inside the zone -> progress climbs;
// head outside -> hard reset to zero. No stun, no slow - having to
// stay 4 s inside a circle everyone can see IS the vulnerablily
export function updateExtract(
    state: ExtractState,
    head: Point,
    dt: number,
): ExtractStatus {
    // no point up: run the spawn cooldown
    if (!state.point) {
        state.progress = 0;
        state.cooldown -= dt;
        if (state.cooldown <= 0) {
            // uniform over the disk, kept away from the lethal border
            const r = WORLD_RADIUS * 0.75 * Math.sqrt(Math.random());
            const a = Math.random() * 2 * Math.PI;
            state.point = {
                x: r * Math.cos(a),
                y: r * Math.sin(a),
                ttl: EXTRACT_TTL,
            };
            return "spawned"; // one-frame event: main shows the alert
        }
        return "idle";
    }

    // point expired -> closes like a bomb, back to cooldown
    state.point.ttl -= dt;
    if (state.point.ttl <= 0) {
        state.point = null;
        state.cooldown = EXTRACT_SPAWN_COOLDOWN;
        state.progress = 0;
        return "detonated"; // one-frame event: main kills anyone inside
    }

    // channel: inside -> accumulate, outside -> hard reset
    const inside =
        Math.hypot(head.x - state.point.x, head.y - state.point.y) <= EXTRACT_RADIUS;
    if(!inside) {
        state.progress = 0;
        return "idle"
    }
    state.progress += dt;
    if (state.progress >= EXTRACT_CHANNEL_FRAMES) {
        state.point = null;
        state.cooldown = EXTRACT_SPAWN_COOLDOWN;
        state.progress = 0;
        return "extracted";
    }
    return "channeling";

}
