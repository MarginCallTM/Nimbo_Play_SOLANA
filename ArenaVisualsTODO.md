# ArenaVisualsTODO.md — NIMBO ARENA RENDERING & IMMERSION

> Opened 2026-09-08. Dedicated branch: `arena-visuals` (forked from `master` @ `d85cf3b`).
> Trigger: the game is *fun* (proven at the alpha test, D85) but it **does not make you want to play**.
> Visual reference: slither.io captures supplied by the user on 2026-09-08.
> Scope: `arena/client/` only. **Not one line of server, not one line of on-chain.**

---

## STATUS AS OF 2026-09-08 — READ THIS FIRST

**Delivered:** AV.0, AV.1, AV.1b (`a54b438`) · AV.2 + AV.2b (`0ed9fdf`, later
**removed**) · AV.3 → AV.3h (`24e8b7c`) · AV.4 + AV.4b (`c2c2af9`).
**Written, not yet committed:** AV.5.

**Outstanding debt: the three AV.0 reference FPS figures have STILL never been
recorded.** We instrumented in order to measure and never wrote down the
baseline — which is exactly what would have priced the glow before we found
it by eye.

The technical foundation is in place and it is sound:

- **PixiJS 8.19.0 (WebGL)** was already the rendering dependency — verified in
  `arena/client/package.json` and `arena/node_modules/pixi.js`.
- `render.ts` already follows the right discipline: **one shared texture**
  instanced as sprites, so a whole snake body is a single draw call. The
  `SnakeView` comment spells that reasoning out. **Everything below must
  preserve that property.**
- The sim/render split is clean: `session.ts` computes every position,
  `render.ts` only draws.

**>>> NEXT TICKET: AV.6 (vignette), or AV.9/AV.11 if the arena screen comes first <<<**

---

## DOCTRINE — the three rules that outrank any aesthetic consideration

### R1. The rendering NEVER lies about game geometry

A4.13 cost months: the client passed `SNAKE_TURN_SPEED` where the server
passed `dims.turnSpeed`. The error was zero at score 0 and 27% at score
2000 — invisible, and decisive in a real-money game.

Consequence for this work: we change **textures, tints, layers, opacity**.
We **never** touch:

- `SNAKE_RADIUS`, nor the `scale` derived from `dims.radius`;
- the segment positions handed over by `session.ts`;
- the number of segments drawn;
- `FOOD_RADIUS`, `EXTRACT_RADIUS`, `AOI_RADIUS`.

Less obvious corollary: **no effect may ever be mistaken for a body.** If a
player believes the hitbox is bigger than it is, that is a gameplay bug
wearing a special effect as a disguise.

### R2. The frame budget is the mainnet budget (D85)

D85: "for anything touching gameplay and fluidity, we no longer reason MVP
first and optimise later". A pretty effect that drops the framerate is a
**bad trade**, not an acceptable compromise.

Every ticket is validated with a number, not an impression. See AV.0.

### R3. No new dependency until it is proven necessary

Adding a package to `arena/` triggers the Alpine lockfile ritual
(`arena/client/Dockerfile` runs `npm ci` on `node:20-alpine`) — the
`@emnapi` trap, already paid for three times. Every ticket here is designed
to need **no dependency at all**.

---

## What the reference captures actually contain

Breakdown, so every ticket has a named target:

| # | Observed effect | Ticket |
|---|---|---|
| 1 | Regular bevelled hexagonal lattice, scrolling | AV.1 |
| 2 | Soft coloured halo under each pellet, "lighting" the floor | AV.2 ⛔ |
| 3 | Saturation towards white where halos overlap | AV.2 ⛔ |
| 4 | Body shaded as a tube (bright centre, dark flanks) | AV.3 |
| 5 | White eyes with dark pupils, oriented | AV.4 |
| 6 | Banded skins (red/white/blue, orange/cream…) | AV.5 |
| 7 | Darkening towards the screen edges | AV.6 |
| 8 | A boosting snake radiating and washing the floor | AV.7 |
| 9 | Death as a sheet of glowing orbs | AV.8 |
| 10 | Dark outline around the body | AV.5 (option) |

**The technical point that changes everything:** slither.io uses **no
post-processing**. It is Canvas 2D. Its halos are **radial-gradient sprites
in additive blending** — light is not computed, it is drawn. So 85% of the
look is reachable without a single shader.

---

## Pixi 8.19 APIs — verified against the installed typings, 2026-09-08

Do not code anything beyond this list from memory; re-check the rest.

| Need | Status |
|---|---|
| `blendMode = 'add'` | ✅ string literal in v8 (`rendering/.../state/const.d.ts`) |
| `TilingSprite` | ✅ `scene/sprite-tiling/` |
| `FillGradient` with `type: 'radial'` | ✅ `scene/graphics/shared/fill/FillGradient.d.ts` |
| `ParticleContainer` + `Particle` | ✅ `scene/particle-container/` (API rebuilt in v8) |
| `renderer.generateTexture()` | ✅ already used in `render.ts:create()` |
| Built-in bloom / glow | ❌ **absent** — native filters are blur, color-matrix, noise, displacement, alpha |
| `CanvasSource` + `resolution` | ✅ logical size = pixel size / resolution |

---

# TICKETS

## AV.0 — Instrument before touching anything

**Why.** R2 demands numbers. Without a baseline, "it feels a bit choppy" is
an impression and we will never know which effect cost what.

**To do.**
- Show the frame rate in the existing debug HUD, plus the sprite count.
- Record the baseline on three configurations: the user's machine, a weak
  machine, and a phone if the game is playable there.
- Write those three figures **into this file**.

**Validation.** The three figures are written down here. **STILL PENDING.**

**Risk.** None.

---

## AV.1 — Hexagonal floor (the largest visual gap)

**Why.** The floor used to be a flat `#0b1020` fill plus 900 random dots
drawn once. A **random** pattern gives the eye nothing to measure a
displacement against: the eye needs **regularity** to read motion as speed.
That is exactly why slither.io has a lattice.

**Technique.** Generate the tile texture **once** at boot, show it in a
world-space `TilingSprite` below every other layer, and bevel each cell so
it reads as an embossed panel.

**The trap.** See "AV.1 — the note not to rediscover" at the bottom.

**GPU cost.** One quad; the repeat happens in the sampler. Free.

**Risk.** None (purely decorative, no interaction with the sim).

---

## AV.2 — Additive halos on pellets ⛔ DELIVERED THEN REMOVED

Delivered in `0ed9fdf`, removed in `24e8b7c`. See **AV.3g** and **AV.3h**
for the measured reason. A tombstone comment is kept in `render.ts`.

---

## AV.3 — Shaded segment texture (best effort/benefit ratio)

**Why.** `circleTexture` was a **flat** disc, hence the "string of beads"
look. In the captures the body reads as a **tube**.

**Technique.** Replace the flat disc with a **greyscale pre-shaded** one.
Pixi's tint being a **multiplication**, `tint` keeps working exactly as
before.

**Property to preserve.** Still **one texture** → batching and render cost
are rigorously unchanged. This is a texture swap, not an architecture
change.

⚠️ Supersample so large snakes are not blurry — but **without touching the
`scale` computation** (R1). `resolution` on the texture source is what makes
that free.

**Risk.** Low.

---

## AV.4 — The eyes (biggest personality gain on the list)

Delivered. See the AV.4 and AV.4b notes below.

---

## AV.5 — Banded skins (opens the door to NFT skins)

Delivered. See the AV.5 note below.

---

## AV.6 — Vignette and general mood

**Why.** The captures darken markedly towards the edges, which concentrates
attention at the centre — where the player's head is.

**Technique.** A full-screen sprite in **screen space** (not in `world`),
radial black gradient, low alpha, added to the `stage` **below** the minimap
and the HUD. Resized on the resize event.

⚠️ **Full-screen effect — apply the AV.2 lesson.** It *subtracts* light
rather than adding it, so it is far safer than a halo, but the same
discipline applies: judge it in motion, and keep it weak enough that it
never fights the floor for attention.

**Files.** `render.ts`: `create()` + resize handling.

**Validation.** The vignette does not move with the camera and masks neither
the minimap nor the HUD.

**Risk.** Low.

---

## AV.7 — Boost emphasis — TO BE RE-COSTED BEFORE WRITING ANY CODE

**Why.** In the captures, a boosting snake **radiates** and washes the
floor. Today boost only turns the head white. It is the most intense moment
in the game and it barely shows.

**Mandatory first step.** The AV.3g lesson is that **total coverage**
(count × area) decides, never how one isolated effect looks. A boost glow
touches 1 to 3 snakes at a time against 300 pellets, so the arithmetic is
not remotely comparable and the effect is probably perfectly viable —
**but compute the coverage first**. That is precisely the step that was
skipped the first time.

**Signature note.** `drawSnake()` does not receive the boost state;
`session.ts` computes it and only smuggles it in as a head colour. Passing
it explicitly is the moment to replace the `colors` parameter with a single
style object rather than adding a tenth positional argument.

**Risk.** Medium (variable sprite count). Bound the number of extra sprites
per snake, independently of body length.

---

## AV.8 — Death must be visible — TO BE REDESIGNED WITHOUT A HALO

**Why.** Death is the most expensive event in the game: the player loses
their stake. Today the orbs appear with no emphasis whatsoever.

**Technique, now that the glow is gone.**
- A scale "pop" on appearance (~200 ms).
- A shockwave at the point of death — an expanding, fading ring in
  `Graphics`, no dependency.

**Product caveat.** The amended 70/30 (D71) puts 30% of the value back into
the map, not onto the corpse. The effect must not suggest 100% of the loot
is lying there — otherwise the screen lies about the economy, which is the
very invariant D71 protects ("a visible pellet is real money").

**Risk.** Low.

---

## AV.9 — HUD, minimap and menu — SCOPE MUST BE SETTLED FIRST

**Status: WAITING ON THE USER.**

The HUD is currently **DOM over the canvas** (`main.ts`:
`document.getElementById("status")`), plus a `Graphics` minimap drawn in
screen space. The menu is `arena/client/src/menu.ts`.

Three possible scopes, none chosen:
1. the game client's **menu** screen (stake choice, entering a round);
2. the **in-game HUD** (value carried, extraction timer, warnings);
3. a page of the **Next portal** in `app/`.

For 1 and 2 this is plain DOM/CSS and the portal's design system (F3.x) can
be reused directly. For the canvas there is no "component library" — it is
Pixi and textures.

**Settle this before opening a ticket.** Note that **AV.11 belongs to the
same screen** and should be done in the same pass.

---

## AV.10 — Post-processing bloom ⛔ ABANDONED

**Abandoned, and that is a conclusion rather than a retreat.** Bloom adds
light across the whole screen. AV.3g measured that this is precisely what
this game cannot tolerate.

---

# EXECUTION ORDER

**Revised 2026-09-08** after the glow removal (AV.3h): AV.7 and AV.8 leaned
on a halo texture that no longer exists, and AV.10 lost its purpose.

| Order | Ticket | Felt effect | Effort | Status |
|---|---|---|---|---|
| ✅ | AV.0 instrumentation | — | — | `a54b438` (⚠ the 3 reference FPS figures are STILL not recorded) |
| ✅ | AV.1 hexagonal floor | huge | — | delivered, then reworked in AV.3c/3e |
| ⛔ | AV.2 additive halos | — | — | `0ed9fdf`, **REMOVED** in `24e8b7c` — see AV.3h |
| ✅ | AV.3 shaded segment | strong | — | delivered, corrected to a cylinder in AV.3b |
| ✅ | AV.4 eyes | strong | — | `c2c2af9`, stabilised by AV.4b |
| ✅ | AV.5 banded skins | medium | — | written, not committed — defines the NFT skin format |
| 1 | AV.3h button B → real preference | medium | low | blocked: user to pick the 3rd style |
| 2 | AV.6 vignette | medium | low | ⚠ full-screen effect — same caution as AV.2 |
| 3 | AV.8 death emphasis | medium | low | **redesign without a halo** |
| 4 | AV.7 boost emphasis | strong | medium | **re-cost coverage first** |
| — | AV.9 HUD/menu | ? | ? | **blocked: user must settle the scope** |
| ✅ | AV.11 shared colour identity | — | — | **CLOSED** — synced, server-validated skin |
| ⛔ | AV.10 bloom | — | — | **ABANDONED**, not deferred |

---

# DEPLOYMENT

This work touches `arena/client/` only. Therefore:

```bash
ssh root@167.233.250.97
cd /root/nimbo
git pull
docker compose --profile https up -d --build client
```

**Name `client` and nothing else.** Recreating `server` disconnects every
active player, and a disconnect is instant death and a lost stake
(anti-rage-quit rule, amended 2026-08-06). A client-only deploy is
**safe at any hour** — an advantage lost the moment the server is touched.

Reminder: `VITE_SERVER_URL` is baked at build time → `--build` is
mandatory, `restart` would not suffice (DEPLOY.md §4bis).

---

# BACKLOG — do NOT start without explicit agreement

- **v8 `ParticleContainer`** for food if profiling demands it. The API was
  rebuilt in v8 and constrains what can be done per particle. **Only on
  measured evidence**, never as a precaution.
- Persistent boost trails (expensive, and an R1 risk: a trail must not look
  like a body).
- Alternative theme (the captures show a green variant).
- Skins as on-chain cosmetic assets — depends on AV.5 and **AV.11**, but it
  is a product effort, not a rendering one.
- Weather / arena events.

---

# JOURNAL

| Date | Ticket | Commit | FPS before → after | Lesson |
|---|---|---|---|---|
| 2026-09-08 | AV.0 | `a54b438` | — | Pixi's `ticker.FPS` reports the LAST frame only (`1000/elapsedMS`): reading it once a second samples one arbitrary frame and prints noise. Count frames over a 500 ms window instead. |
| 2026-09-08 | AV.1 | `a54b438` | — | See the tile-period note at the bottom — the only real trap in the ticket. |
| 2026-09-08 | AV.1b | `a54b438` | — | Debug overlays (green server ghost + AoI bubble) **turned off for players** (user call: the green ghost reads as latency). **Put behind `?debug` in the URL, NOT deleted** — it is A4.14's diagnostic instrument, and removing the measurement to hide the symptom turns a known bug into an unknown one. A query param rather than a build flag: switchable against the LIVE site with no rebuild. No advantage risk (A1.8): it shows only our own server position and our own AoI radius, never an opponent. |
| 2026-09-08 | AV.2 | `0ed9fdf` ⛔ | — | Halo as a **sibling** sprite in a dedicated layer, never a child: inside `foodLayer` the order becomes pellet/halo/pellet/halo, and the batcher only merges **consecutive** sprites sharing a texture AND a blend mode. One layer each = 2 draw calls regardless of pellet count. — Texture built on a **2D canvas** (`CanvasSource`) rather than with `FillGradient`: exact control of alpha at every stop. The **curve** is the subject: a linear 1→0 ramp reads as a flat cone, not as light; an inverse-square falloff is needed (bright core, fast decay, long faint skirt). |
| 2026-09-08 | AV.2b | `0ed9fdf` ⛔ | — | Halo twinkle + corpse orbs 30% brighter (user request). **Phase AND speed randomised per pellet**: on a shared clock with no offset every halo breathes in unison, which reads as a strobing bug rather than a living field. Wall clock (`performance.now()`), not an accumulator: nothing drifts, and a backgrounded tab resumes on the right phase instead of replaying its absence. |
| 2026-09-08 | AV.3 | `24e8b7c` | to record | **`resolution` is the key to the ticket**: the source carries 4× the pixels while DECLARING the same logical size, so `scale = radius / SNAKE_RADIUS` stays true everywhere and no call site changes (R1 satisfied for free). Supersampling was necessary: radius reaches ×3 at score 10 000 and ×5.5 at 50 000 — a flat fill survived that, a gradient would not. |
| 2026-09-08 | AV.4 | `c2c2af9` | to record | See the AV.4 note. |
| 2026-09-08 | AV.5 | *(uncommitted)* | to record | See the AV.5 note. |

## AV.3b — THE MEASURED COMPARISON (2026-09-08) — do not redo this

The user found our render "not clean" without knowing why, and guessed it
was about pale colours. Rather than settle it by eye, both captures (ours
and slither's) were **sampled pixel by pixel** (`sips -s format bmp` then a
pure-Python BMP parse — the machine has neither PIL nor ImageMagick, cf.
[[front-redesign]]).

| | Ours | slither.io |
|---|---|---|
| Body saturation (median) | **0.79** | **0.50** |
| Saturation, spread | 0.38 → 0.80 | **0.49 → 0.51** |
| Body value (median) | 0.52 | 0.63 |
| Value, peak | 0.74 | 0.87 |
| Floor saturation | **0.39** | **0.21** ⚠ see AV.3c |
| Floor value | 0.200 | 0.165 |
| Body/floor contrast | ×2.6 | ×3.8 |
| Hex pattern period | 288 px | 183 px |

**Three findings, by importance:**

1. **The "string of beads" was NOT the silhouette.** Computed: with `r = 12`
   and `SNAKE_SPACING = 10`, the outline scallop is
   `12 − √(144−25) = 1.09 px` out of 24 wide, i.e. **4.5%** — invisible.
   The culprit was AV.3's **RADIAL** gradient (rim at 0.46): every disc
   painted its dark rim over the bright middle of the previous one, an arc
   every 10 px. **Fixed by changing the NATURE of the gradient, not its
   strength**: linear, perpendicular to travel (sprite rotated onto the
   local heading). Along the body the value becomes constant → no internal
   arc is possible; across it the contrast stays strong → a real cylinder.
   Confirmed by the measurement: in the reference, H and S are **locked**
   while V doubles.
2. **Our floor was BLUE** and the reference's looked neutral — **this
   conclusion was later shown wrong, see AV.3c.**
3. **Saturation spread betrays a shape defect.** Since `tint` multiplies, S
   should be CONSTANT across a body. Our 0.38 → 0.80 were edge pixels: too
   much perimeter, therefore too much outline — an independent confirmation
   of finding 1.

⚠ Measurement not applied, left to the user: our hexagons are **57% larger**
than the reference (`HEX_R_WORLD = 48`, ~31 would match). That contradicts
his own +20% adjustment the same day, so it is his call, not ours.

## AV.3c — THE FLOOR, AND A MEASUREMENT ERROR OF MINE

The AV.3b conclusion "their floor is neutral" was **wrong**. It came from a
percentile taken over the WHOLE frame, diluted by every region a halo had
washed out. Sampling the cells themselves — values supplied by the user,
`#18212d` and `#0e1621` — shows the reference floor is decidedly **BLUE**:
hue 214, saturation 0.47 to 0.58. Ours was the desaturated one.

**Lesson: a statistic over a whole image does not measure a local object.**

The real difference was never the cell colour. Measured on matching
close-ups:

| | Ours | Reference |
|---|---|---|
| Median luminance | 36.8 | 26.7 |
| p85 / p98 | 36.8 / 50.7 | 37.0 / 51.1 |
| Pixels inside a seam | **13%** | **30%** |

Two findings hide in that table. First, our brightest tones were **already
right**; the floor read pale because **cells covered 87% of the surface
against their 70%**. Widening the seams lowers the average without a single
colour getting darker. Second, our p50 **equalled** our p85 — a plateau,
i.e. perfectly flat cell interiors — while the reference spreads
continuously, because every one of its cells carries a gradient. Flat faces
are what make a grid look like a wireframe instead of a floor.

Hence: cells at `0.84` of the lattice pitch (coverage goes as the square →
70%), rounded corners, a per-cell vertical gradient, and a drop shadow into
the seam.

## AV.3d — THE BLUR: two Pixi defaults never set

Symptom as reported: "a blur effect produced by the floor while playing",
**invisible on a still**. That last detail is the diagnosis: constant blur
shows on a still image; blur that only appears in motion is **minification
aliasing**.

**Cause 1 — `resolution` was never set.**
`AbstractRenderer.defaultOptions.resolution = 1`. On any HiDPI screen (every
recent Mac, `devicePixelRatio = 2`) we rendered half the real pixels and let
the compositor scale up. **The whole image was uniformly softened.** Fix:
`resolution: window.devicePixelRatio` + **`autoDensity: true`** (mandatory —
without it the canvas CSS size follows the backing store and the game
displays twice too large).

**Cause 2 — the tile was minified with no mipmap.**
362 texels per 144 world units = 2.51 texels/unit against 1.3 screen
pixels/unit → **×1.93 minification**. And `TextureSource.defaultOptions`
carries `mipLevelCount: 1`: no mipmaps, so one texel in four is sampled.
Still it holds; in motion it crawls.

**Both are fixed at once** by rendering at device resolution: it removes the
upscale AND brings the tile back to ~1 texel per device pixel, where there
is nothing left to alias.

⚠ **Verified, not assumed**: `app.screen` is documented **in CSS pixels**,
independent of `resolution` → `viewScale()` and the field of view are
unchanged bit for bit. That was the blocking condition: FOV is a **fairness**
invariant (AF.3bis), not a cosmetic setting.

⚠ **Cost**: 4× the fragment work on a 2× display. If the AV.0 counter drops
off 60 fps, cap at 1.5 — **never go back to 1**.

**Cause 3 (minor, my error)**: `shadowBlur` was `0.28r`, i.e. ~15 screen
pixels of soft gradient around EVERY cell — the floor had no edges left.
Reduced to `0.09r`. The reference's shadow is a thin dark lip, not a halo:
it says "raised", it does not say "blurred".

## AV.3e — THE FLOOR DID NOT CREATE THE PROBLEM, IT REVEALED IT

After AV.3d the user reported residual blur **and nausea**. That second word
moves the diagnosis: nausea in a game comes from **camera motion**, not from
a soft texture.

**Two distinct causes, not to be conflated.**

**(a) Residual blur — sub-pixel resampling.** `camera()` set
`world.position` to a FRACTIONAL value, so the world landed on a different
sub-pixel phase every frame and every texture was resampled 60 times a
second. Still: sharp. Moving: it SWIMS. Not a filtering setting — the offset
never sitting still. **Fix: round the translation to DEVICE pixels** (not
CSS — after AV.3d we render at `devicePixelRatio`, and CSS rounding would
leave half a device pixel of wobble). Cost: half a CSS pixel of camera
placement, imperceptible.

**(b) THE DEEPER CAUSE — the camera drifts on its own. NOT FIXED.**
`CAMERA_RATE = 0.15` (`session.ts:117`) is exponential smoothing with a
~110 ms time constant, so the camera permanently trails the head. And
`session.ts:362` **resynchronises `predicted.x/y` onto server truth** — and
**A4.14 is OPEN**: median divergence 25 px, measured max 218 px. Every
correction makes the target jump, then the camera slides for ~110 ms. **The
scenery scrolls without the player asking**: visual flow decoupled from
input, which is the definition of motion sickness.

**Why it did not exist before AV.1:** the floor was a flat fill plus 900
sparse dots, on which a camera slide was **invisible**. On a regular
contrasted lattice, every micro-slide becomes legible. The pattern broke
nothing — it made a pre-existing defect visible.

**Mitigation applied (user request)**: floor contrast −20% (TOP↔GAP
amplitude 17.8 → 14.2 in luminance, mid anchored). It does not remove the
motion, it lowers the volume at which the floor reports it. **Mitigation,
not cure.**

**NOTE: this was NOT the cause of the reported nausea — see AV.3g.** It
remains a real open defect regardless.

**To test later, in order:**
1. `CAMERA_RATE` 0.15 → 0.35 (tighter camera, less slide). One line,
   reversible. ⚠ Changes game FEEL → D85, must be validated by the user,
   never imposed.
2. The real fix is **A4.14** (remove the divergence at source). Tuning the
   camera only masks netcode that jumps.

## AV.3f — THE A/B SWITCHES

Three suspects, three toggles, so the cause could be **isolated** instead of
argued about: `B` floor style, `G` halo layer, `P` halo pulse. Plus a
`none` floor mode as the control condition — if the sensation survives a
floor with no pattern at all, the floor was never the cause.

It paid for itself immediately: it found the cause in one minute, where
three rounds of reasoning had not. `G` and `P` were removed with the glow;
`B` stays and is on its way to becoming a player preference (AV.3h).

## AV.3g — THE REAL CAUSE: veiling glare, not blur. RESOLVED.

**Found by the user** with the AV.3f switches: cutting the halo layer (`G`)
restores a healthy image; nothing else changes anything. Not the floor, not
the camera.

**So it was never blur. It was VEILING GLARE.** Halo area goes as the
**square** of the radius, and at `GLOW_SPREAD = 8` the arithmetic is
damning:

| setting | 300 pellets | 450 pellets |
|---|---|---|
| spread 8 | **123% of the screen** | **184%** |
| spread 4 | 31% | 46% |
| **spread 3** | **17%** | 26% |

The whole screen was carpeted in additive light, more than once over.
Additive light raises the black level **everywhere**, contrast collapses,
and the eye reads that as being out of focus. AV.2b then made the carpet
**breathe**, which is what turned an ugly frame into a nauseating one.

**The 3 is MEASURED.** Radial profiles of isolated pellets in the reference:
excess luminance 100 / 91 / 71 / 48 / 22 / 1% at 0, 2, 4, 6, 8, 10 px over a
2–4 px core — a halo that dies at **2 to 3 times** the pellet radius. The
broad coloured washes in their captures are not big halos: they are **many
small ones summing** where pellets cluster, which additive blending gives
for free.

**Three method lessons, not to be lost:**
1. **My three previous diagnoses were wrong** (tile too soft, `resolution`,
   camera drift). They produced real improvements —
   `resolution: devicePixelRatio` and pixel snapping remain correct fixes —
   but **none was the cause**. Stacking plausible fixes is not a diagnosis.
2. **The switch settled in one minute** what three rounds of reasoning had
   not. Faced with a diffuse visual symptom, build the A/B **before**
   fixing.
3. The detail that should have pointed the way from the start: "it is not
   obvious on a still". An additive veil is *constant*, but what makes it
   unbearable is the **pulsing** — hence invisible on a frozen frame. I read
   that word as "minification aliasing" and held on to it far too long.

## AV.3h — GLOW REMOVED, and what remains to do with button B

**User decision (2026-09-08), after testing and outside opinions from
friends: the pellet glow is REMOVED**, not merely reduced. At spread 3 it
was tolerable; without it comfort is better, and that is the criterion that
wins (D85: the play experience is the standard — "it looks like the
reference" does not outrank "you can play it for an hour").

All glow code is gone: `makeGlowTexture`, `GlowView`, `glowLayer`,
`glowTexture`, `glowSprites`, `pulseGlows`, the `GLOW_*` and `PULSE_*`
constants, the `G` and `P` toggles, and the glow branches of `addFood` /
`removeFood` / `clear()` / `stats()`. **A tombstone is left in `render.ts`**
(section AV.2) with the costed reason: the idea is tempting enough that
someone will want it back, and the constraint to design against then is
**TOTAL COVERAGE** (count × area), never how one isolated halo looks — that
is the number that made the game unplayable, and it is invisible when you
inspect one halo at a time.

### Button B is now a REAL preference — DONE 2026-09-08

Shipped as `relief` / `flat` / `subtle`, cycled with **B**.

**A correction on my part, worth keeping.** I first argued for hiding the
readout before merging and called it a "risk". It was not a risk — the
floor is decorative and there is **no fairness stake** (unlike the field of
view, AF.3bis) — and the user pushed back correctly. The real point was much
narrower: a permanent grey `[B] floor: tiles` in monospace is the visual
language of a dev overlay, not of a game setting. And the user's own
counter-argument was the better one: **an undiscoverable setting is useless,
so the answer was to make it look like a feature, not to hide it.**

What it now does:
1. **`localStorage` persistence** (`nimbo.arena.floor`), every access
   wrapped in try/catch — a private window, cleared site data or a browser
   blocking storage all THROW, and a crash there would take the renderer
   down with it. Falls back to `relief`.
2. **A permanent hint, bottom-left**: `Press B to change background`, at
   55% opacity. On each press it brightens to `Floor — Relief` for 1.4 s,
   then falls back to the hint. One element, two states.
   `?debug` pins the style name instead, because when we are the ones
   testing, a screenshot has to say what produced it.
3. **`none` was DROPPED from the player-facing choices.** All of AV.1 rests
   on a REGULAR lattice being what makes speed legible (900 random dots did
   not). Offering "no pattern" would let a player quietly degrade their own
   perception of motion. **A preference may trade comfort against beauty,
   never against information.**
4. **Textures are built lazily** — only the chosen style is rasterised, so a
   player who never presses B pays for one tile, not three.

`subtle` is `relief` with its luminance amplitude at 40% (14.2 → 5.7),
anchored on the same mid, so the floor keeps its colour and merely stops
shouting.

**Discoverability — settled, and I had left it open by mistake.** I shipped
the setting with no visible hint, having argued myself that an
undiscoverable preference is useless, and the user had to point it out
again. The hint is now permanent. **Lesson: when a feature's whole value
depends on being found, its label is part of the feature, not polish.**

Still deferred to AV.9: a proper settings menu. A one-letter global key is
a scarce resource as the game grows, and the hint line does not scale to
five of them.

## AV.4 — the eyes (delivered 2026-09-08)

Four sprites per snake, children of `root`, so they inherit the snake's
alpha (graced/offline fade) and die with it, with no extra code.

**FLAT texture, not the body's**: AV.3b's cylinder gradient would have laid
a horizontal bright band across each eye — a lying highlight on a sphere.
The reference has no shading on its eyes at all. Same logical size as
`circleTexture`, so `scale = r / SNAKE_RADIUS` keeps working everywhere.

**Proportions, all as fractions of the snake's radius** (so they follow
growth for free), and verified numerically:
- eye centre at `0.581 r` from the head centre, outer edge at `1.001 r` →
  the eyes sit exactly flush with the silhouette, as in the reference;
- pupil: radius `0.193 r`, travel `0.168 r` → furthest edge `0.361 r`
  against a `0.420 r` eye, i.e. **14% margin: the pupil can never spill out
  of the eye**, at any size.

**INFORMATION RULE — the only real decision in the ticket.** Only the local
player passes `lookAngle` (= `input.angle`, the very value sent to the
server, so the eyes cannot tell a story different from the one being
played). **Opponents never get one**: showing their cursor would announce
their turn BEFORE they take it — information the player could not otherwise
have, which is exactly what A1.8 and AF.3bis exist to prevent. Their pupils
follow their **visible heading**, which reveals nothing new.

Intended side effect: for the local player, aim and heading differ during a
turn (the aim leads the body), and that gap is what makes the eyes
expressive — they look where you are steering before the snake gets there.

## AV.4b — the unstable heading (fixed 2026-09-08)

Reported as "opponents' eyes look buggy", attributed to bots having no
mouse. **The hypothesis was wrong, and correcting it changed the
priority**: the mouse only concerns the local player; for everyone else the
gaze came from `atan2(head − body[0])`. So the defect hit **human opponents
too**, in paid rounds.

**Two failure modes, both frequent in a real game:**
1. `updateBody` (`session.ts:422`) seeds the body **at the head position**.
   A snake entering the AoI therefore has `body[0] === head` →
   `atan2(0,0) = 0` → eyes snapped due East for a few frames.
2. When a remote position **stalls** (late packet, dead reckoning out of
   samples), `body[0]` converges back **onto** the head. The vector shrinks
   to nothing and its angle becomes pure noise → pupils spin.

**Fix:** walk the body to the first tracer further than
`SNAKE_SPACING * 0.25` from the head (spacing, not radius, governs the
separation), otherwise **keep the last good heading** stored on the
`SnakeView`. The eyes stay **hidden** until a heading is trustworthy: two
frames without eyes go unnoticed, two frames of eyes pointing the wrong way
read as a bug — which is exactly how it was reported. The local player has a
useful fallback (`lookAngle`), so our own snake never spawns eyeless.

**Secondary benefit:** `head.rotation` suffered from the same computation
since AV.3b. Invisible until now — a gradient on a disc does not betray an
unstable rotation — but two eyes scream it. General lesson: **adding a
visual reference reveals the defects of everything it is attached to.** That
happened twice in one day; the hexagonal lattice had already exposed a
pre-existing camera drift.

## AV.5 — banded skins (delivered 2026-09-08)

**This ticket defines the FORMAT the marketplace will sell**, and that is
its real stake. A skin is **a list of colours plus a band width**. A few
dozen bytes: no asset to store, none to serve, nothing to load at spawn.

Above all it makes "never pay-to-win" a **property of the data** rather than
a promise: a palette cannot encode a hitbox, a speed or a reach. An
expensive skin is *structurally* incapable of buying an advantage.

**The second tone is the SAME HUE** (S 0.22 / V 0.97) — a pale version of
the animal, never a foreign colour. Two tones of one hue read as markings on
a creature; two different hues read as a costume, and at a glance the player
would stop being able to name who is who. **Identifying an opponent
instantly is a gameplay need, not a style one.**

**Zero cost, and here is why:** tracers keep their index for life (growth
appends at the TAIL), so a segment's band is painted once at birth and never
rewritten. No per-frame tint work, and the markings stay put on the body
instead of scrolling along it.

`BAND_SEGMENTS = 4`, i.e. ~1.7 body widths — the reference's proportion.
Disconnected snakes stay **one tone**: a frozen body is a warning, not a
place for decoration.

⚠ Bug caught in passing: `session.ts` rebuilt `drawn` field by field for the
boost case, which **erased the band palette** — a snake lost its skin
exactly while it was interesting to look at. Fixed with a spread.

## AV.11 — COLOUR IS NOT A SHARED IDENTITY — **CLOSED 2026-09-09**

**Fixed end to end.** `Player.skin` is now a synced, server-validated
field; the client renders every snake — including its own — from that
state, and the arrival-order `paletteCursor` is gone along with
`OTHER_PALETTES`. The 8-skin whitelist lives in `shared/` because both
ends need it, and `skinById()` is the single gate on both.

Three things worth keeping from the implementation:

1. **The wire carries an ID, never colours.** An unknown or absent id
   becomes the default *without an error*, so an outdated client still
   gets a legal snake and a hostile one gains nothing by lying. Colours on
   the wire would have let a headless client dress in the floor's own
   tone and become hard to see — a real advantage bought with a string
   (D82: the barrier is server-side).
2. **We render our OWN skin from the synced state**, not from the menu's
   choice. The server is what validated it, so echoing the server's answer
   is what guarantees we see ourselves as everyone else does — and a
   refused choice shows up immediately instead of silently diverging.
3. **Demo bots walk the palette.** Six identical snakes in the tutorial
   would teach exactly the wrong reflex; the demo is where a newcomer
   learns to read the arena.

Contrast against the floor is measured, not eyeballed: every body colour
sits at least 3.37x the relative luminance of the cell face (`#17212e`),
so no skin can hide against the ground.

Original diagnosis, kept because it explains why this mattered:

---

**Raised by the user on 2026-09-08** (open at the time, done with AV.9)

Raised by the user on 2026-09-08: "I always see myself in blue, my friend
does not recognise me by colour". **The defect is wider than that.**

**Verified in the code:**
- `PlayerState` (`ArenaRoom.ts:78+`) has **no colour or skin field**.
  Nothing is synchronised.
- `session.ts:451` assigns palettes **client-side**, via `paletteCursor++`,
  in the order that client saw players arrive.

So not only does the player always see themselves as `PLAYER_COLORS`, but
**two opponents see the same third snake in two different colours**. There
is no shared colour identity in the arena at all.

**Four consequences, by importance:**
1. **The skin marketplace is BLOCKED by this.** An NFT skin nobody else can
   see has no value. This is therefore not polish: it is a **business-model
   prerequisite**, to be done before selling any cosmetic.
2. No callouts between players ("watch the purple one" means nothing if
   purple is not the same for everyone) — this matters as soon as friends
   play together on voice.
3. Recognising a friend, the original report.
4. Any future colour-coding (killfeed, leaderboard) inherits the problem.

**Design constraint NOT to forget — this is a fairness stake, not a taste
one.** A free colour choice would let a player pick a hue that blends into
the floor: less visible means a real advantage. Therefore:
- colour/skin must live in the **synchronised, server-authoritative state**;
- the choice comes from a **server-validated whitelist**, with a **minimum
  contrast against the floor palette** (measurable: the floor luminances are
  in AV.3c);
- D82 doctrine: the barrier is server-side, **never on what the client
  declares**. A headless client's `options.skin` announces whatever suits it.

**Work:** a field in the shared schema + server validation + a selector in
the menu (`arena/client/src/menu.ts`), and later NFT ownership verification.
To be done **with AV.9**, since it is the same screen.

## AV.1 — the note not to rediscover

The hex lattice repeats over `3R × √3·R`. Since a texture is an **integer**
number of pixels and `√3` is irrational, **no radius `R` makes both sides
whole**. Rounding either one shifts the wrap point away from the drawn
geometry: exactly the seam we are trying to avoid.

**Method — invert the derivation.** Choose the two integer pixel sizes
first, with a ratio as close to `√3` as desired, then derive `R`:

- `362 / 209 = 1.7320574` against `√3 = 1.7320508` → relative error `6.6e-6`
- `3R = 362` **exactly** (`R = 362/3`) and `1.5R = 181` **exactly**
- only `√3·R = 209.0008` differs from `TILE_H = 209` → **0.0008 px** of
  mismatch at the vertical wrap, for the life of the game

The error **does not accumulate**: the GPU repeats the tile identically, it
never reconstructs an ideal lattice. The only possible discrepancy is that
0.0008 px, present once, at each edge.

Second condition, independent of the first: every lattice centre is drawn
**nine times** (itself plus the eight neighbouring tile offsets), otherwise
cells straddling the border are sliced off and the join shows — the classic
tiling artefact, easily mistaken for a wrongly sized tile.
