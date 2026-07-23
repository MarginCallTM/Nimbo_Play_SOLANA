// Units: speeds are "per frame at 60 fps" because ticker.deltaTime
// is ~1.0 at 60 fps (always scaled by dt)
export const WORLD_RADIUS = 3000;

export const SNAKE_SPEED = 4;    // px/frame
export const SNAKE_TURN_SPEED = 0.08;   // rad/frame at BASE size (shrinks as the snake grows)
export const SNAKE_RADIUS = 12; // visual radius of one segment at score 0
export const SNAKE_BASE_LENGTH = 40; // tracer count at score 0
export const SNAKE_SPACING = 10; // target distance between tracers
export const SNAKE_BOOST_SPEED = 8;   // px/frame while boosting (x2)
export const MAX_DT = 3;              // dt clamp: a frame hitch SLOWS the sim
                                      // instead of teleporting heads through
                                      // bodies (no swept collision = tunneling)
export const SPAWN_GRACE_FRAMES = 180; // 3 s: translucent, can't kill, can't
                                       // die, eats nothing (spawn protection)

// --- A0.3: food, score, boost cost (all playtest knobs) ---
export const FOOD_COUNT = 2200;     // ambient pellets (scaled with world area)
export const FOOD_RADIUS = 5;       // px, base pellet radius
export const FOOD_VALUE = 1;        // score granted by one ambient pellet
export const FOOD_WORTH = 0.001;    // mock-SOL carried by EVERY ambient pellet.
                                    // No valueless pellets (user decision 2026-07-23):
                                    // reserve dry -> the SUPPLY rarefies instead
export const FOOD_RESERVE_INITIAL = 5; // mock-SOL backing ambient food (proto stand-in
                                       // for the ARENA-2 FoodReserve PDA)
export const PELLET_FUND_RATE = 0.02;  // D71: share of every buy-in routed to the
                                       // reserve. Keep SMALL: a high rate turns
                                       // ambient food into bot-farmable income
export const FOOD_MAGNET_RANGE = 25; // px beyond eat range: pellets get pulled in
export const FOOD_MAGNET_SPEED = 6;  // px/frame pull speed (must beat SNAKE_SPEED)

export const SNAKE_BOOST_COST = 0.25; // score burned per frame while boosting (~15/s)
// Drop frequency = SNAKE_BOOST_COST / BOOST_ORB_VALUE: raising the orb
// value drops BIGGER orbs LESS often, at the same total cost (conservation)
export const BOOST_ORB_VALUE = 1.5;

// score -> body growth curve (display knobs — NEVER touch value
// conservation to fix a size-feel problem: score is value, size is
// just how value is displayed)
export const GROWTH_LENGTH_PER_SCORE = 0.3; // extra tracers per score point
export const GROWTH_RADIUS_FACTOR = 0.02;   // radius gain per sqrt(score)

export const GRID_RESOLUTION = 100; // spatial grid cell size (~ eat range)

// --- A0.4: collisions & death ---
export const DEATH_ORB_VALUE = 5; // corpse orbs are chunky (worth the risk)

// --- A0.7bis: free play ---
export const FREE_PLAY_SCORE = 100; // fictitious spawn size in FREE mode (value 0)

// --- A0.6: mock value & extraction ---
export const SCORE_TO_SOL = 0.001;         // display rate: 1 score point = 0.001 "SOL"
export const EXTRACT_RADIUS = 130;         // px, zone radius (circle inside it to channel)
export const EXTRACT_SPAWN_COOLDOWN = 600; // frames (~10 s) between extract points
export const EXTRACT_TTL = 2400;           // frames (~40 s): the zone's full lifetime
export const EXTRACT_WARNING_FRAMES = 180; // last 3 s: bomb-style blink/swell, then it KILLS
export const EXTRACT_CHANNEL_FRAMES = 240; // frames (= 4 s) of channeling to cash out
export const MINIMAP_RADIUS = 90;          // px on screen, bottom-right

// --- A0.7 (rev. 2026-07-23): the 70/30 death rule ---
// 70% of the dead snake's VALUE stays on the corpse (the killer's
// loot); 30% recycles MAP-WIDE as classic unit-priced pellets — the
// self-managed ambient supply (and a soft anti-snowball brake: 30% of
// every kill escapes the killer toward everyone).
export const CORPSE_KEEP_RATIO = 0.7;

// --- A0.5: bots (all playtest knobs) ---
export const BOT_COUNT = 8; // scaled up with the bigger world
export const BOT_VISION = 400;         // px, food perception radius
export const BOT_LOOKAHEAD = 110;      // px, danger probe ahead of the head
export const BOT_BOOST_MIN_SCORE = 15; // don't sprint yourself down to zero
export const BOT_MIN_SCORE = 100;      // bots mirror the REAL stake tiers
export const BOT_MAX_SCORE = 600;      // (0.10-0.60 SOL) — they simulate players
export const BOT_LIFETIME_MIN = 1800;  // frames (~30 s): bots churn like real
export const BOT_LIFETIME_MAX = 5400;  // players (~90 s) — crash out, corpse
                                       // drops, a fresh stake joins (economy inflow)
