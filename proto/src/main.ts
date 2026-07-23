import { Application, Container, Graphics, Text } from "pixi.js";
import "./style.css";
import {
  BOT_COUNT,
  BOT_MAX_SCORE,
  BOT_MIN_SCORE,
  CORPSE_KEEP_RATIO,
  DEATH_ORB_VALUE,
  EXTRACT_CHANNEL_FRAMES,
  EXTRACT_RADIUS,
  EXTRACT_WARNING_FRAMES,
  FOOD_COUNT,
  FOOD_RADIUS,
  FOOD_WORTH,
  FREE_PLAY_SCORE,
  GRID_RESOLUTION,
  MAX_DT,
  MINIMAP_RADIUS,
  PELLET_FUND_RATE,
  SCORE_TO_SOL,
  SNAKE_RADIUS,
  WORLD_RADIUS,
} from "./constants";
import { createExtractState, updateExtract } from "./extract";
import { createBrain, driveBot } from "./bot";
import type { BotBrain } from "./bot";
import { fillSegmentGrid, findDeaths } from "./collision";
import type { Segment } from "./collision";
import { FoodField } from "./food";
import { SpatialGrid } from "./grid";
import { getDesiredAngle, initInput, isBoosting } from "./input";
import { createSnake, createSnakeView, drawSnake, updateSnake } from "./snake";
import type { Snake, SnakeColors, SnakeView } from "./snake";

// A snake plus its render objects. Sim data (Snake) stays pure — Pixi
// objects live only at this layer.
interface Entity {
  snake: Snake;
  view: SnakeView;
  label: Text; // mock-SOL value floating above the head
  name?: string; // player pseudo (bots stay anonymous)
}

// "no head": fed to the extract channel while the player is in the
// menu, so the lifecycle keeps running but nobody channels
const NOWHERE = { x: 1e9, y: 1e9 };

const PLAYER_COLORS: SnakeColors = { body: "#2b6fd6", head: "#3981f6" };
// one palette per bot, cycled through at spawn
const BOT_PALETTES: SnakeColors[] = [
  { body: "#d6702b", head: "#f68f39" }, // orange
  { body: "#8f2bd6", head: "#a939f6" }, // purple
  { body: "#2bd670", head: "#39f68f" }, // green
  { body: "#d62b4e", head: "#f63963" }, // red
  { body: "#d6c22b", head: "#f6e039" }, // yellow
  { body: "#2bc9d6", head: "#39e5f6" }, // cyan
];

async function main() {
  const app = new Application();
  await app.init({ resizeTo: window, background: "#0b1020", antialias: true });
  document.body.appendChild(app.canvas);
  initInput();

  const world = new Container();
  app.stage.addChild(world);

  // Static scenery (drawn ONCE): world border + reference dots
  const decor = new Graphics();
  decor.circle(0, 0, WORLD_RADIUS).stroke({ width: 8, color: "#4a5578" });
  for (let i = 0; i < 900; i++) {
    const r = WORLD_RADIUS * Math.sqrt(Math.random());
    const a = Math.random() * 2 * Math.PI;
    decor.circle(r * Math.cos(a), r * Math.sin(a), 3).fill("#232c4a");
  }
  world.addChild(decor);

  // z-order = insertion order: decor under food under snakes
  const food = new FoodField(app.renderer, world);
  food.spawnAmbient(FOOD_COUNT);

  // one shared circle texture for every snake segment (batched sprites,
  // same trick as the pellets)
  const circleGfx = new Graphics().circle(0, 0, SNAKE_RADIUS).fill(0xffffff);
  const snakeTexture = app.renderer.generateTexture(circleGfx);
  circleGfx.destroy();

  const entities: Entity[] = [];
  const segmentGrid = new SpatialGrid<Segment>(GRID_RESOLUTION);

  function spawn(
    x: number,
    y: number,
    score: number,
    value: number,
    colors: SnakeColors,
    name?: string,
  ): Entity {
    const view = createSnakeView(snakeTexture, colors);
    world.addChild(view.root);
    const label = new Text({
      text: "",
      style: { fill: "#ffffff", fontSize: 13, fontFamily: "monospace" },
    });
    label.anchor.set(0.5, 1); // centered above the head
    world.addChild(label);
    const entity = { snake: createSnake(x, y, score, value, colors), view, label, name };
    entities.push(entity);
    return entity;
  }

  function randomSpawnPoint() {
    // stay well inside the (now lethal) border
    const r = WORLD_RADIUS * 0.6 * Math.sqrt(Math.random());
    const a = Math.random() * 2 * Math.PI;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }

  // A0.7 (rev.) — the 70/30 death rule. 30% of the VALUE recycles
  // map-wide as CLASSIC unit-priced pellets (the self-managed ambient
  // supply); 70% stays on the corpse as chunky orbs. Pellets have a
  // FIXED unit worth, so we spawn floor(budget / unit) of them and the
  // sub-pellet remainder stays on the corpse: conservation is exact.
  function dropCorpse(snake: Snake) {
    if (snake.score <= 0 && snake.value <= 0) return;
    const recycleBudget = snake.value * (1 - CORPSE_KEEP_RATIO);
    const pelletCount = Math.floor(recycleBudget / FOOD_WORTH);
    for (let i = 0; i < pelletCount; i++) {
      food.scatterRecycled(FOOD_WORTH);
    }
    const corpseWorth = snake.value - pelletCount * FOOD_WORTH;
    const corpseScore = snake.score * CORPSE_KEEP_RATIO;
    const orbCount = Math.max(1, Math.ceil(corpseScore / DEATH_ORB_VALUE));
    const step = snake.tracers.length / orbCount;
    for (let i = 0; i < orbCount; i++) {
      const index = Math.min(Math.floor(i * step), snake.tracers.length - 1);
      const t = snake.tracers[index];
      food.spawnOrb(
        t.x,
        t.y,
        corpseScore / orbCount,
        corpseWorth / orbCount,
        snake.colors.body,
      );
    }
  }

  // dropLoot=false for extraction: the value LEAVES the arena (the
  // vault pays out in the real game) — it is NOT redistributed
  function despawn(entity: Entity, dropLoot = true) {
    if (dropLoot) dropCorpse(entity.snake);
    world.removeChild(entity.view.root);
    entity.view.root.destroy({ children: true });
    world.removeChild(entity.label);
    entity.label.destroy();
    entities.splice(entities.indexOf(entity), 1);
  }

  const bots: BotBrain[] = [];
  let botsSpawned = 0;

  function spawnBot() {
    const p = randomSpawnPoint();
    const colors = BOT_PALETTES[botsSpawned++ % BOT_PALETTES.length];
    // random spawn score = a poor man's variable buy-in (A0.8 makes it
    // real): kills are worth unequal, visible amounts
    const score = Math.round(
      BOT_MIN_SCORE + Math.random() * (BOT_MAX_SCORE - BOT_MIN_SCORE),
    );
    // a bot "bought in": its stake enters the arena here, split per
    // D71 — a small share funds the pellet reserve, the rest spawns as
    // the snake's value. (The 5.5% rake joins the split in A5.1.)
    const stake = score * SCORE_TO_SOL;
    food.fundReserve(stake * PELLET_FUND_RATE);
    const entity = spawn(p.x, p.y, score, stake * (1 - PELLET_FUND_RATE), colors);
    bots.push(createBrain(entity.snake));
  }

  // the player only exists between a PLAY click and a death/extraction
  let player: Entity | null = null;
  for (let i = 0; i < BOT_COUNT; i++) spawnBot();

  // extraction: state machine (extract.ts) + its render objects
  const extract = createExtractState();
  const extractGfx = new Graphics();
  world.addChild(extractGfx); // above food, below snakes spawned later
  let banked = 0; // mock-SOL cashed out of the arena

  // screen-edge arrow pointing at the active extract point
  const arrow = new Graphics();
  arrow.moveTo(0, -10).lineTo(20, 0).lineTo(0, 10).closePath().fill("#39f68f");
  arrow.visible = false;
  app.stage.addChild(arrow);

  // center-screen alert banner (extract spawned / closed), fades out
  const alert = new Text({
    text: "",
    style: {
      fill: "#39f68f",
      fontSize: 28,
      fontFamily: "monospace",
      fontWeight: "bold",
    },
  });
  alert.anchor.set(0.5);
  alert.visible = false;
  app.stage.addChild(alert);
  let alertTtl = 0;
  function showAlert(msg: string, color: string) {
    alert.text = msg;
    alert.style.fill = color;
    alertTtl = 240; // ~4 s, fading over the last second
  }

  // countdown over the active extract point, visible on every screen
  const chrono = new Text({
    text: "",
    style: { fill: "#39f68f", fontSize: 20, fontFamily: "monospace" },
  });
  chrono.anchor.set(0.5);
  chrono.visible = false;
  app.stage.addChild(chrono);

  // minimap (slither-style, bottom-right): shows YOU and the extract
  // point only — showing every snake would kill the fog of war
  const minimap = new Graphics();
  app.stage.addChild(minimap);

  // --- launch menu (A0.7bis) + variable buy-in (A0.8) ---
  const menuEl = document.getElementById("menu")!;
  const menuStatus = document.getElementById("menu-status")!;
  const menuBanked = document.getElementById("menu-banked")!;
  const pseudoInput = document.getElementById("pseudo") as HTMLInputElement;
  let selectedStake = 0; // 0 = FREE mode (fictitious size, zero value)
  let freePlay = false; // current run is a free one
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".stake")) {
    btn.addEventListener("click", () => {
      document.querySelector(".stake.selected")?.classList.remove("selected");
      btn.classList.add("selected");
      selectedStake = Number(btn.dataset.stake);
    });
  }

  function openMenu(status: string) {
    menuStatus.textContent = status;
    menuBanked.textContent = `banked ${banked.toFixed(3)}◎`;
    menuEl.classList.remove("hidden");
  }

  function startGame() {
    if (player) return; // already playing
    const stake = selectedStake;
    // FREE mode: fictitious mid-size snake, ZERO value — you can learn
    // the game but neither risk nor earn. (In prod: a SEPARATE server,
    // so free players can't free-ride on real pellets.)
    // Staked mode, D71 split at join: a small share funds the pellet
    // reserve, the rest spawns as the snake's value. SIZE derives from
    // the GROSS stake: bigger buy-in = bigger spawn. (Rake in A5.1.)
    food.fundReserve(stake * PELLET_FUND_RATE);
    freePlay = stake === 0;
    const score = stake > 0 ? Math.round(stake / SCORE_TO_SOL) : FREE_PLAY_SCORE;
    const p = randomSpawnPoint();
    player = spawn(
      p.x,
      p.y,
      score,
      stake * (1 - PELLET_FUND_RATE),
      PLAYER_COLORS,
      pseudoInput.value.trim() || undefined,
    );
    menuEl.classList.add("hidden");
  }
  document.getElementById("play")!.addEventListener("click", startGame);
  pseudoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startGame();
  });
  openMenu("stake in, survive, extract");

  // HUD lives on the stage (screen coordinates), NOT in the world
  const hud = new Text({
    text: "",
    style: { fill: "#e2e8f0", fontSize: 16, fontFamily: "monospace" },
  });
  hud.position.set(12, 12);
  app.stage.addChild(hud);
  let lastHudText = "";
  let deathCount = 0;

  app.ticker.add((ticker) => {
    // clamp: a frame hitch must SLOW the simulation, not make heads
    // jump 100+ px in one tick and tunnel through bodies unharmed
    const dt = Math.min(ticker.deltaTime, MAX_DT);

    // 1) intents
    if (player) {
      player.snake.desiredAngle = getDesiredAngle(app.screen.width, app.screen.height);
      player.snake.boost = isBoosting();
    }
    // bots perceive through LAST frame's segment grid (filled in step 3
    // below): one frame of lag is nothing for an AI — a human needs ~10
    for (const brain of bots) driveBot(brain, segmentGrid, food, dt);

    // 2) simulate + eat (every snake eats, bots included). Boost orbs
    // carry ZERO worth: sprinting sheds size, never money.
    for (const entity of entities) {
      const { snake } = entity;
      updateSnake(snake, dt, (x, y, v) =>
        food.spawnOrb(x, y, v, 0, snake.colors.body),
      );
      if (snake.grace > 0) continue; // spawn protection: eats nothing
      const gained = food.eatAround(
        snake.head.x,
        snake.head.y,
        snake.radius + FOOD_RADIUS,
        dt,
      );
      snake.score += gained.score;
      if (entity === player && freePlay) {
        // FREE run: no free-riding on real pellets — the size is
        // yours, the money goes back to the reserve (conserved)
        food.fundReserve(gained.worth);
      } else {
        snake.value += gained.worth;
      }
    }

    // 3) collisions
    fillSegmentGrid(segmentGrid, entities.map((e) => e.snake));
    const deaths = findDeaths(entities.map((e) => e.snake), segmentGrid);

    // bot churn (the economy's inflow): each bot "player" eventually
    // crashes out — normal death, corpse drops (90/10), and the
    // existing respawn buys a fresh stake in (2% -> pellet reserve).
    // Simulates real player traffic keeping the arena funded.
    for (const brain of bots) {
      brain.lifetime -= dt;
      if (brain.lifetime <= 0) deaths.add(brain.snake);
    }

    // 3bis) extraction lifecycle. Capture the zone position FIRST: a
    // detonation nulls state.point inside updateExtract.
    const zone = extract.point ? { x: extract.point.x, y: extract.point.y } : null;
    const extractStatus = updateExtract(extract, player?.snake.head ?? NOWHERE, dt);
    if (extractStatus === "spawned") {
      showAlert("EXTRACT POINT ACTIVE", "#39f68f");
    }
    if (extractStatus === "extracted" && player) {
      const gain = player.snake.value; // the VALUE cashes out — size dies with the snake
      banked += gain;
      despawn(player, false); // no corpse: the value left the arena
      player = null;
      openMenu(`EXTRACTED +${gain.toFixed(3)}◎`);
    }
    if (extractStatus === "detonated" && zone) {
      // the zone closes like a bomb: anyone still inside dies a NORMAL
      // death (corpse drops on site — the value stays in the arena)
      showAlert("EXTRACT POINT CLOSED", "#f63963");
      for (const { snake } of entities) {
        if (snake.grace > 0) continue; // spawn protection holds here too
        const d = Math.hypot(snake.head.x - zone.x, snake.head.y - zone.y);
        if (d <= EXTRACT_RADIUS) deaths.add(snake);
      }
    }

    // 3ter) deaths -> corpses -> respawns.
    // Iterate over a COPY: despawn() splices the original array, and
    // mutating a list while walking it is a classic silent bug
    for (const entity of [...entities]) {
      if (!deaths.has(entity.snake)) continue;
      despawn(entity);
      if (entity === player) {
        deathCount++;
        const lost = entity.snake.value;
        player = null;
        openMenu(`YOU DIED — ${lost.toFixed(3)}◎ left on the field`);
      }
      const botIndex = bots.findIndex((b) => b.snake === entity.snake);
      if (botIndex !== -1) {
        bots.splice(botIndex, 1);
        spawnBot(); // keep the arena populated
      }
    }

    // 4) camera: follow the player, or spectate the fattest snake
    //    while the menu is up (a living backdrop beats a black screen)
    let camSnake: Snake | null = player?.snake ?? null;
    if (!camSnake) {
      let best = -1;
      for (const e of entities) {
        if (e.snake.score > best) {
          best = e.snake.score;
          camSnake = e.snake;
        }
      }
    }
    if (camSnake) {
      world.position.set(
        app.screen.width / 2 - camSnake.head.x,
        app.screen.height / 2 - camSnake.head.y,
      );
    }

    // 5) render — snakes + their floating value labels (pseudo for the
    //    player, value only for anonymous bots). Spawn protection reads
    //    as translucency.
    for (const entity of entities) {
      const { snake, view, label } = entity;
      drawSnake(view, snake);
      const graced = snake.grace > 0;
      view.root.alpha = graced ? 0.45 : 1;
      label.alpha = graced ? 0.6 : 1;
      label.position.set(snake.head.x, snake.head.y - snake.radius - 8);
      const worth = `${snake.value.toFixed(3)}◎`;
      const text = entity.name ? `${entity.name}  ${worth}` : worth;
      if (label.text !== text) label.text = text;
    }

    // extract zone. Normal phase: green pulsing ring. Closing phase
    // (last EXTRACT_WARNING_FRAMES): bomb theater — turns red, swells,
    // and blinks 3 times before the kill. The KILL radius stays
    // EXTRACT_RADIUS; the swelling is warning theater only.
    extractGfx.clear();
    if (extract.point) {
      const p = extract.point;
      const closing = p.ttl <= EXTRACT_WARNING_FRAMES;
      const swell = closing ? 1 + 0.25 * (1 - p.ttl / EXTRACT_WARNING_FRAMES) : 1;
      const radius = EXTRACT_RADIUS * swell;
      const color = closing ? 0xf63963 : 0x39f68f;
      // square-wave blink: 30 frames on / 30 off -> 3 pulses over 3 s
      const blinkOn = !closing || Math.floor(p.ttl / 30) % 2 === 0;
      if (blinkOn) {
        const pulse = closing ? 0.9 : 0.55 + 0.25 * Math.sin(p.ttl * 0.08);
        extractGfx
          .circle(p.x, p.y, radius)
          .fill({ color, alpha: closing ? 0.16 : 0.08 })
          .circle(p.x, p.y, radius)
          .stroke({ width: closing ? 7 : 4, color, alpha: pulse });
      }
      if (extract.progress > 0) {
        const frac = extract.progress / EXTRACT_CHANNEL_FRAMES;
        // arc() is a PATH command: it draws from the pen's current
        // position. Without an explicit moveTo to the arc's start,
        // Pixi links the previous path point to it with a stray line
        // (the glitch seen when the gauge appeared).
        const arcR = radius + 12;
        const start = -Math.PI / 2; // 12 o'clock
        const end = start + frac * 2 * Math.PI;
        extractGfx
          .moveTo(p.x + Math.cos(start) * arcR, p.y + Math.sin(start) * arcR)
          .arc(p.x, p.y, arcR, start, end)
          .stroke({ width: 6, color: 0xffffff, alpha: 0.9 });
      }
    }

    // edge arrow toward the extract point when it is off-screen
    // (only meaningful while actually playing)
    if (extract.point && player) {
      const dx = extract.point.x - player.snake.head.x;
      const dy = extract.point.y - player.snake.head.y;
      const onScreen =
        Math.abs(dx) < app.screen.width / 2 - 40 &&
        Math.abs(dy) < app.screen.height / 2 - 40;
      arrow.visible = !onScreen;
      if (arrow.visible) {
        const ang = Math.atan2(dy, dx);
        const edge = Math.min(app.screen.width, app.screen.height) / 2 - 40;
        arrow.position.set(
          app.screen.width / 2 + Math.cos(ang) * edge,
          app.screen.height / 2 + Math.sin(ang) * edge,
        );
        arrow.rotation = ang;
      }
    } else {
      arrow.visible = false;
    }

    // alert banner: fade out over the last second
    alertTtl = Math.max(0, alertTtl - dt);
    alert.visible = alertTtl > 0;
    if (alert.visible) {
      alert.position.set(app.screen.width / 2, 80);
      alert.alpha = Math.min(1, alertTtl / 60);
    }

    // countdown: seconds left on the active zone; red blink while closing
    if (extract.point) {
      const closing = extract.point.ttl <= EXTRACT_WARNING_FRAMES;
      chrono.text = `EXTRACT ${Math.ceil(extract.point.ttl / 60)}s`;
      chrono.style.fill = closing ? "#f63963" : "#39f68f";
      chrono.visible = !closing || Math.floor(extract.point.ttl / 15) % 2 === 0;
      chrono.position.set(app.screen.width / 2, 120);
    } else {
      chrono.visible = false;
    }

    // minimap: world disk + you (white) + extract point (blinking)
    minimap.clear();
    const mmX = app.screen.width - MINIMAP_RADIUS - 20;
    const mmY = app.screen.height - MINIMAP_RADIUS - 20;
    const mmScale = MINIMAP_RADIUS / WORLD_RADIUS;
    minimap
      .circle(mmX, mmY, MINIMAP_RADIUS)
      .fill({ color: 0x0b1020, alpha: 0.7 })
      .stroke({ width: 2, color: 0x4a5578 });
    if (extract.point && Math.floor(extract.point.ttl / 20) % 2 === 0) {
      minimap
        .circle(mmX + extract.point.x * mmScale, mmY + extract.point.y * mmScale, 5)
        .fill(0x39f68f);
    }
    if (player) {
      minimap
        .circle(mmX + player.snake.head.x * mmScale, mmY + player.snake.head.y * mmScale, 4)
        .fill(0xffffff);
    }

    // conservation, visible on screen. The invariant:
    //   arena + banked + reserve = FOOD_RESERVE_INITIAL + sum(buy-ins)
    // arena/reserve trade against each other as ambient food spawns;
    // if the total drifts outside buy-ins/extractions, the economy leaks.
    let arenaWorth = food.totalWorth();
    for (const e of entities) arenaWorth += e.snake.value;
    const hudText =
      `value ${(player?.snake.value ?? 0).toFixed(3)}◎` +
      `  banked ${banked.toFixed(3)}◎` +
      `  arena ${arenaWorth.toFixed(3)}◎` +
      `  reserve ${food.reserveLeft().toFixed(3)}◎` +
      `  deaths ${deathCount}  fps ${Math.round(ticker.FPS)}`;
    if (hudText !== lastHudText) {
      hud.text = hudText;
      lastHudText = hudText;
    }
  });
}

main();
