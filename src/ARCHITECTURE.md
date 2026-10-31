# Kiln architecture: modules, the step, and the hard seams

Read this before writing code that talks to another agent's module. Types: `src/core/types.js`.
Constants: `src/core/constants.js`. Events: `src/core/events.js`. Owners: `team/FILEMAP.md` (planning
file, read by absolute path in the main folder).

## Module map

| Module | Owner | Entry | Runs in Node? |
|---|---|---|---|
| core: constants, types, events, bus, rng, input frame, world, headless | shared (ARCH, then A/G per FILEMAP) | `src/core/*.js` | yes |
| sim: physics, field modes, collision, robot player | A | `src/sim/physics.js` `createPhysics()`, `src/sim/robot.js` `createRobot()` | yes |
| content: bricks, bosses, sentries, rules, timers | B | `src/content/content.js` `createContent()` | yes |
| levels: legend, parser, 30 levels, Overburn | B | `src/levels/index.js` `getLevel(n)`, `parser.js` `parseLevel()`, `overburn.js` `generateOverburn()` | yes |
| economy: embers, drops, HEAT, combo, score, lives, Overloads, Mods, The Forge, save | E | `src/economy/economy.js` `createEconomy()`, `createRun()`; `save.js` `createSave()` | yes |
| systems composition | shared (A after day one) | `src/systems.js` `makeSystems()` | yes |
| renderer: three.js scene, materials, fire, sparks, fragments, bloom, camera, lite | C | `src/render/renderer.js` `createRenderer()` | no |
| input, HUD, screens, PWA, composition | D | `src/input/input.js`, `src/ui/ui.js`, `src/main.js`, `index.html`, `sw.js` | no (pure helpers may be) |
| audio: sounds, adaptive music, credits | E | `src/audio/audio.js` `createAudio()` | no (pure helpers may be) |

Game logic (core, sim, content, levels, economy) never imports the DOM, three.js, audio,
`performance.now()`, `Date.now()` or `Math.random()`. It is deterministic for a seed and inputs.

## Coordinates and time

- Field units, origin top-left, x right, y down; the field is 720 × 1080 in every mode.
- three.js world: `X = x − 360`, `Y = 540 − y`, `Z = 0` on the field plane (one unit = one field unit).
- Ring-mode angles are in field coordinates (y down): bearing π/2 is straight down (the bottom).
- The sim takes fixed steps of `SIM.DT` (1/120 s). `world.time` is sim milliseconds
  (`step × 8.333…`). Durations in constants are sim ms unless named `REAL`.
- Slow-mo never changes `DT`. A sets `world.timeScale` (e.g. 0.25); `main.js` feeds the accumulator
  `realDt × timeScale`, so fewer steps run per real second. The robot and tests ignore timeScale.
  A 600 ms real slow-mo at 25% therefore lasts 150 ms of sim time.

## One step (`stepWorld`, `src/core/world.js` PIPELINE)

| # | Slot | Owner | Does |
|---|---|---|---|
| 1 | `physics.pre` | A | paddle from the InputFrame (1:1, per mode), serve/launch/release, lasers fired, Pull flag (`paddle.pulling`), perfect-hit press time |
| 2 | `content.move` | B | moving rows, march-down, scrolling, gravity falls, bosses and sentries move and attack, level timers (`level.timeLeftMs`) |
| 3 | `physics.move` | A | integrate and collide balls, lasers, embers, drops, hazards; emit `BRICK_HIT`, `SENTRY_HIT`, `PADDLE_HIT`, `EMBER_CAUGHT`, `DROP_CAUGHT`, `HAZARD_HIT`, `BALL_LOST`, `OUT_OF_BALLS` … |
| 4 | `content.resolve` | B | apply hits: damage, `BRICK_BROKEN`, chains, cavity release, boss/sentry reactions, `level.remaining` |
| 5 | `economy.step` | E | embers/drops to spawn, HEAT, combo, score, lives, drop effects, Overloads, Mods |
| 6 | `physics.post` | A | last-brick ceremony + near miss + top-speed slow-time (timeScale, fx.zoom), anti-loop, aim line, phase `play → clearing → cleared` |

Every system reads events with its **own bus reader** (`createReader(world.bus, name, 0)` in its
`init`), so it sees everything since it last read, including what later slots emitted on the
previous step. Nobody clears the bus.

## Who writes what (single writer per field)

| State | Writer | Readers |
|---|---|---|
| `step`, `time`, `bus.step` | core | all |
| `phase` (only via `setPhase`) | A: serve ↔ play, clearing, cleared · E: over | all |
| `timeScale`, `fx.zoom*`, `fx.aim*` | A | main.js, renderer |
| `field.*` (ceilingY, farX, clear, gap), once in `physics.init` | A | renderer (ceiling bar, camera), robot, tests |
| `paddle.*`, `balls[*]`, `embers`, `drops[*]`, `hazards[*]`, `lasers[*]` motion | A | all |
| `drops[i].kind`, which embers/drops exist | E asks A through `world.api.spawn*` | |
| `bricks.*` (SoA), `bricks.version`, `level.remaining/total/timeLeftMs/elapsedMs/scrollY` | B | A (flags, geometry), C, D, E |
| `sentries[*]`, `boss.*`, `fx.dark` | B | A (sentry circles), C, D, E |
| `econ.*`, `run.*`, `effects.*`, `fx.lastLife`, `fx.heatLevel` | E | A, B, C, D |
| `stats.*` | the owner of each counter | tests, overlay |

C and D never write world state. If you need a field that does not exist, append it (see FILEMAP
shared-layer rule) and name its single writer in `types.js`.

## Hard seams (the decisions)

1. **Falling drops, embers, hazards and paddle catches are simulated by A.** They are bodies in
   world pools moved in `physics.move` with the same field transform as the ball (falling is
   "away from the bricks" in every mode). E decides what spawns and when, by calling
   `world.api.spawnEmbers(x, y, n)` / `spawnDrop(x, y, kind)`; B spawns hazards with
   `world.api.spawnHazard(...)`. A emits `EMBER_CAUGHT` / `DROP_CAUGHT` / `DROP_MISSED` /
   `HAZARD_HIT`; E (embers, drops) and B (hazards) react. Reason: one owner for motion and
   catch geometry across three field modes; determinism.
2. **Economy reacts to sim events and feeds effects back through `world.effects` and
   `world.api`, nothing else.** E reads events in `economy.step`, writes `econ`, `run` and
   `effects` (paddle width target, ball speed scale, catch, laser shots, shield, fire, thru,
   mega, fog, Mod values, ball kind). A and B obey `effects` on the next slot they run. Counts
   that A consumes (laser shots, shield) stay E's: A emits `LASER_FIRED` / `SHIELD_USED` and E
   decrements in the same step. Multiball/Fork call `world.api.splitBalls(k)` (A); Purge calls
   `world.api.purgeRows(3)` (B); Quench sets `effects.ballSpeedScale`. Lives: A emits
   `OUT_OF_BALLS`; E decides (noFail, shield already handled by A), then calls
   `world.api.serve()` or `setPhase(world, 'over')`.
3. **Bosses and sentries are B's content, made of shared primitives.** Boss bodies are bricks
   (`B`/`W` cells, `BF.BOSS`/`BF.WEAK`, `bricks.group` = part) moved by the boss script (set
   `BF.MOVING`, copy `px/py` first); boss state for the renderer/HUD is `world.boss`. Sentries
   are circles in `world.sentries`. A collides balls and lasers with any solid brick and any
   live sentry generically and emits `BRICK_HIT` / `SENTRY_HIT`; B's `content.resolve` routes
   hits on boss bricks to the boss script and on sentries to the sentry controller. Attacks are
   hazards. A boss level is cleared when B sets `level.remaining` to 0.
4. **The renderer reads state in place and never allocates per frame.** It iterates the pools
   (`alive` flags, struct-of-arrays bricks and embers), interpolates `px → x` with
   `alpha`, rebuilds static brick instances only when `bricks.version` changes (moving/falling
   bricks every frame), and turns events into effects through its own reader created in
   `setWorld`. It draws the paddle at `x/y` (latest input). Preallocated Matrix4/Vector3/Color
   scratch only.
5. **The robot player drives the sim exactly like a person.** `createRobot().fill(frame, world)`
   writes the same `InputFrame` the input module writes (steer target, action, pull, overload);
   `runHeadless(world, robot)` in `src/core/headless.js` steps it in Node with no DOM, three.js,
   audio or clock. Same seed + same frames = same game, so any failing level reproduces.

Also decided:
- **Scrolling (The Flue, 24)** moves bricks, not the camera: B shifts the wall down
  (`BF.MOVING` while it moves, `BF.HIDDEN` above the field), so physics stays in field units.
- **Ring-mode bricks** sit on a 16 × 16 grid of 30 × 30 cells inside radius 240 (axis-aligned
  collision everywhere).
- **Portals**: A teleports the ball to `bricks.link[i]` (B pairs them) and emits `PORTAL`.
- **Perfect hit timing**: the press is stamped with `world.time` of the step that receives it
  (`paddle.lastActionMs`); A compares it with contact times. Error ≤ one step (8.3 ms).
- **Level end**: `cleared` is set by A when `level.remaining` reaches 0 (after the ceremony);
  E emits `LEVEL_CLEARED` on that phase change; `main.js` moves on. Timed levels: B counts
  `timeLeftMs` down and sets `remaining` to 0 at the end.
- **One world per level attempt**: systems are created fresh per world (`makeSystems()`); the
  run (lives, score, Mods) carries across worlds in `world.run`.
- **The field mode never changes inside a world.** The Core (30) is three chained stage worlds
  (`core-1` bottom → `core-2` left → `core-3` ring) linked by `LevelDef.continues`; `main.js`
  starts the next stage straight away with the same run (`getStage(id)` in `src/levels/index.js`).
  Boss HP per stage lives in each stage's `world.boss`.
- **QA hooks in main.js** (keep them): `?level=N` starts level N, `?seed=S` fixes the seed,
  `?bot=1` lets the robot play in the browser (attract mode, frame-time tests), `?debug=1` shows
  C's overlay. `window.__kiln` exposes `world`, `renderer`, `stats` (frames, maxFrameMs, frame
  time histogram once C/G add it).

## Presentation contracts (summary; full JSDoc in types.js)

```
createRenderer(host, opts) → Promise<Renderer>   C   setWorld · frame(world, alpha, dt) · resize · setQuality · setMenu · screenToField · fieldRect · stats
createInput(target, mapper, opts) → Input        D   sample(frame, world) · setEnabled · onPause · configure · dispose
createUI(root, ctx) → UI                         D   show(name, data) · hud(world) · layout(rect) · toast(text)
createAudio(opts) → Audio                        E   unlock · setWorld · frame(world, dt) · music(track) · setVolume · suspend · resume
createSave(storage) → Save                       E   load · write · reset
```

`main.js` (D) is the only file that calls `stepWorld`, `renderer.frame`, `ui.hud` and
`audio.frame`. It exposes `window.__kiln` (world, renderer, stats) for QA scripts.

## Notes (append-only, newest last; one line each, with your id)
- A: sim modules: `field.js` (mode geometry, safe for C/D: trackToField, fieldToTrack, ringBearing, toLocal/fromLocal, normalAt, awayAt, isLost), `collide.js` (swept primitives + brick grid), `paddle.js` (steering, bounce rule), `ball.js` (one ball, one step), `bodies.js` (embers, drops, hazards, lasers), `feel.js` (anti-loop, ceremony, near miss, aim line), `aim.js` + `robot.js` (the robot player).
- A: perfect hit = an action press within 60 ms before OR after a paddle contact; it gives tier +1 for 1.5 s (`ball.boostMs`) and pierce 1. The permanent tier rises every 6 contacts (18 in ring mode, whose trips are about a third as long), is shared by all balls in play, and resets on serve. In ring mode a ball that makes 3 paddle contacts in a row with nothing else touched leaves the third within 15 degrees of straight in (the ring skate turn, NUDGE reason 4). `ball.boostMs` and `ball.portalCooldownMs` show the time left; A counts both to an end time in sim ms (exactly 180 steps for the boost).
- A: at most one BRICK_HIT per ball per brick per step. A ball passes (c = 1) only as many bricks as it has pierce (Thru and Mega: any breakable), including a push-out (a brick that moved into the ball), which passes a brick only when the ball is moving into it. A portal exit keeps the whole ball inside the twin cell.
- A: LASER_FIRED is emitted once per action press (a = bolts in the volley, 2); LASER_DONE once per bolt. E decrements `effects.laserShots` once per LASER_FIRED.
- A: ring mode: `paddle.span` = 40 deg x w/120; the paddle reaches half the arc on the face circle (radius 312). `paddle.ghostX` holds track coordinates (x, y or bearing), only moving when `rules.ghosts`; ghosts deflect balls but never catch or get hit.
- A: optional `effects.catchMs` (writer E) overrides the 3 s Catch hold (`PHYS.CATCH_HOLD_MS`) if E appends it for the longer-catch Mod.
- A: no OUT_OF_BALLS during `clearing`/`cleared`; a level whose clock ran out (no break in the last 500 ms) goes straight to `cleared` without the slow-mo.
- E: economy numbers live in `src/economy/tuning.js`; score maths in `score.js` (multFor, brickPoints, clearBonus, intensity). Everything scored is base points x the multiplier at that moment; clear bonuses are flat.
- E: `world.effects` is rewritten from E's state every economy step (writeEffects). Heavy ball's slower speed is folded into `effects.ballSpeedScale` (A must not scale by ballKind again); its 2 damage is B's (read `effects.ballKind`).
- E: the overload input fires the equipped Overload; before one is equipped (and where `rules.heat`) it buys one shield for 50 HEAT (event SHIELD_BOUGHT 141). `econ.overloadCost` and `econ.shieldCost` give the prices for the HUD.
- E: on OUT_OF_BALLS every timed drop effect ends, the combo halves, then a free miss (FREE_MISS 140) or a life goes; noFail levels just serve. HEAT and combo reset per level, except into a chained stage (`run.carryHeat`, `run.carryCombo`).
- E: pure screen helpers for D: `economy/mods.js` (MODS, modChoices, applyMod), `economy/overloads.js` (OVERLOADS, chooseOverload, overloadCost), `economy/forge.js` (FORGE_ITEMS, forgePrice, nextPrice, buyRank, bankRun, ballKindsUnlocked), `economy/save.js` (createSave, migrate). `createRun({seed, save, ballKind})` applies The Forge.
- E: `createAudio` listens for the first pointerdown, touchend or keydown itself; `setWorld` picks the level's track. D calls `audio.music('title')` or `audio.music(null)` off-level, `audio.suspend()` and `audio.resume()` on pause, `audio.ui(name)` for menu sounds, `audio.setVolume({music, sfx, muted})` from settings. QA readout: `window.__kiln.audio.state`.
- B: content modules: `content/content.js` (the system: hits, breaks, blasts, gravity, cavities, rails, march, scroll, timers, rain, Fever, Purge), `content/bricks.js` (CONTENT tunables, hitDamage), `content/sentries.js`, `content/bosses.js` (createBoss, BOSS_PARTS, BOSS_DRESSING) with `bosses/stoker.js`, `bosses/orbit.js` (The Crucible, The Core), `bosses/common.js`; `content/gates.js` (twists). Level side: `levels/parser.js` (parseLevel, checkLevel, anchorLow, sprinkleCarriers), `levels/index.js` (LEVELS, getLevel, getStage, stagesOf, LEVEL_NAMES, twistsFor, applyTwist, generateOverburn), `levels/overburn.js`.
- B: damage: plain 1, numbered 1 a hit, armour 3 ball hits or 1 laser/fire, Heavy ball 2; a pierced hit (BRICK_HIT c = 1: perfect hit, Thru), Mega, a blast and Purge break any breakable brick outright. A fire-ball hit also splashes 1 (SRC.FIRE) on the 3 x 3 around it. An explosive goes off when it breaks; blast-broken explosives follow 70 ms later (CONTENT.CHAIN_MS), in brick index order.
- B: boss levels: no brick is CLEARABLE except the `W` weak points (so aim lines and the robot target them); `level.remaining` = `boss.hp`. Weak points ignore hits for 500 ms after one lands. Ring plates of The Crucible and The Core are 30 x 30 squares (B sets bricks.w/h per brick: C sizes instances from w/h, not from the grid). The Core stage 3 outer ring angle is `boss.data.angle2`.
- B: `world.boss.open` = Stoker jaw open (0..1, share of jaw plates broken); `boss.angle` = the turning ring (Crucible, Core). STAGE_CLEARED (92) ends The Core stages 1 and 2 (no BOSS_DEFEATED until stage 3). On defeat every boss brick breaks in index order over about 0.5 s (BRICK_BROKEN, SRC.BOSS).
- B: hazards: kinds in `HAZARD` (constants): BOMB 0 (bombers), SLAG 1 (Stoker, Crucible), BOLT 2 (The Core). Any HAZARD_HIT knocks `CONTENT.HAZARD_HEAT` (25) out of the HEAT meter through `world.api.addHeat`; a hazard never shrinks the paddle (PLAN §1: shrink only from a red drop the player caught). Bombs, slag and bolts need at least 1 s from spawn to the paddle line.
- B: sentries keep below the wall in bottom mode (never lower than y 860); drifter 2 hp, bomber 3 hp; a laser, fire, Mega, a blast, Purge or a ball still boosted by a perfect hit (`ball.boostMs > 0`) kills one outright. SENTRY_DAMAGED (91) on a hit that does not kill.
- B: march-down and The Flue move the whole wall (BF.MOVING while it moves); bricks whose bottom edge passes y 780 burn off with BRICK_BURNT (90): no BRICK_BROKEN, no score, no embers. Scrolling levels count hidden rows in `remaining`; rows still to march in do not.
- B: every carrier gets its drop kind at load (`bricks.drop`, rolled from the level table with `rng.content`); E spawns it on BRICK_BROKEN with a = BRICK.CARRIER. CAVITY_OPENED fires once per sealed ball: a = ball slot, b = cavity id.
- B: gates: `twistsFor(n)` gives the two doors in front of level n; start the level with `applyTwist(getLevel(n), id)` (content also applies `run.twist` to a plain def when a gate leads into it, so clear `run.twist` once used).
- E: QA tabs are silent: `?mute=1`, or `?bot=1` unless `?sound=1`, mutes the audio on top of the player's settings (agents' browser checks must never play out loud). Mute and volume changes fade over 150 ms. After RUN_OVER the music turns to the run-over theme; `audio.music('title')` or `setWorld` brings it back.
- E (replaces the QA-mute part of the line above): `?mute=1` keeps the game silent for the whole page life, and `?bot=1`, `?qa=1` or `?level=` imply it; there is no override (`?sound=1` no longer unmutes). `qaMuted(search)` in src/audio/audio.js is the rule.
- D: flow rules are pure in `src/app/flow.js` (picks before 13/16/19/22/23/26/29, gates from 13 never before bonus/boss, The Core stages chained with no results, Overburn waves); main.js shows the screens. Screens get plain data and callbacks and never touch world state.
- D: QA hooks in main.js: `?level=N` `?seed=S` `?bot=1` (robot plays; picks and results advance by themselves) `?debug=1` `?autopause=0` (hide/blur/pointercancel ignored) `?mute=1` (also implied by bot, qa=1, level, fixture, autopause=0) `?fixture=<name>` (tests/fixtures/G/<name>.js `level`) `?sw=1` (service worker on localhost). `window.__kiln`: world, renderer, input, ui, audio, save, data, app, ext, stats, advance(n, dtMs) (frames by hand in a hidden pane), startLevel/startRun(n), startOverburn, pause, resume, showTitle, showMap, showForge, showSettings, showCredits, toggleMute.
- D: sw.js's file list and `src/app/present.js` (which optional modules exist, so the page never requests a missing file) are generated by `node src/app/sw-files.mjs --write`; G's deploy runs it, then the gate with KILN_RELEASE=1 checks every shipped file is cached.
- A: no allocation in the step (tests/a-perf): V8 boxes every fractional number passed to or returned from a call it does not inline. Hot sim code passes numbers through scratch fields instead (collide.js `COLLIDE` + `sweepRectCore`/`sweepCircleCore`/`sweepExitCore`/`overlapBallBrick`, paddle.js `BOUNCE` + `bounceCore`, physics ctx `nX/nY/oX/oY`, `sdx/sdy`, `bx/by`, `target`, `pad.t`) and starts such fields at 0.5 so they stay unboxed. Keep new per-step code that way: a test regression of a few MB means a new boxed call.
- D: more `window.__kiln` QA openers (sample data, no run change, no save write, every choice returns to the title): `showResults()` (a cleared level) or `showResults('over')`, `showPick()` (Mod, level 13) or `showPick('overload')`, `showGate(n = 14)` (the two doors before level n); `hudCheck()` returns the HUD mode, its smallest text in CSS px and any HUD button over HUD text.
- E (2026-10-22, replaces the shield part of the overload-input line above): before an Overload the overload input buys a shield for 100 HEAT, one per level; it holds 20 s of play (not while the ball waits on the paddle) or one miss, then SHIELD_GONE (142). After buying, `econ.shieldCost` is 0 (none left this level). An Overload is ready at `econ.overloadCost`, firing spends the whole meter, and the kiln vents: no HEAT for 12 s of play (`econ.ventMs` counts down). Bricks an Overload breaks, and blasts it sets off, pay points and drops but no embers. Music: a file track fades out in 0.3 s and its sources are dropped before the next track decodes.
- B: boss weak points: a block of `W` cells is fused into one brick at init (no seams inside the core). A core counts at most two hits per entry (CONTENT.ENTRY_HITS, 500 ms apart), then cools (`boss.data.guard` = 1) until every ball is out of the boss (the Stoker's head, the outer ring); C may draw a cooled core dimmer. The Stoker's phase-2 jaw regrows behind every scoring ball and 6 s after it opens. Boss hazards need at least 1 s to reach the paddle line (The Core stage 3 fires from the heart).
- A (2026-10-22 review): `paddle.vel` is the last move divided by the time since the paddle's move before it (up to 4 steps), held over the still steps of a display frame, 0 once the paddle stands longer than that gap: a 60 Hz frame's two steps share one pointer target, and a per-step difference read double then zero. Ring mode counts a catch sweep of at most `PHYS.RING_SWEEP_MAX` (4800 u/s) per step of that gap, and a ball already level with the arc is hit only by an end moving onto it. A top-speed ball (760) coming within 40 sim ms of the paddle line sets `timeScale` 0.5 for 80 ms real (`PHYS.TOP_SLOW_*`, once per approach). NUDGE b = 3: 4 portal trips with nothing breakable hit (paddle contacts do not reset it). A nudge the 12 degree clamp would eat turns the other way.
- A (2026-10-22, the ceiling, PLAN 11): `world.field` = { ceilingY, farX, clear }, worked out once in physics.init by `src/sim/ceiling.js` from the bricks content.init laid out. Bottom mode: ceilingY = max(90, highest top edge - 120), but never less than 60 clear (then top - 60, and never above the field top), and never below where bricks enter later (`level.entryY`, B, optional; unset = grid row 0 for a march feed, y 0 for scrolling). Left mode: farX = min(720, farthest right edge + 120). Ring: 0 / 720. Boss bricks that are MOVING at level start turn about the boss centre and count with their whole turn. Balls (WALL_HIT a = 2 at the ceiling, a = 1 at the far wall), laser bolts (LASER_DONE on it) and the robot cast stop there; nothing changes it during a level.
- A (2026-10-22, ceiling review): `world.field.gap` is the clear space the rule asked for: 120, or 60 when nothing over the top can be reached (no BREAKABLE or WEAK brick within 120 of the wall's top or far edge, and no turning boss part; today only The Stoker, ceiling y 300). Bricks that enter later keep 60 clear above their entry line (ceiling <= entry - 60, from B's `level.entryY`). Anti-loop: a hit on unbreakable boss armour while the ball is past the boss's top edge (bottom) or far edge (left), skating between it and the ceiling, is a dead bounce, not progress; level with or inside the boss it is still progress. tests/a-ceiling "release: the renderer draws the ceiling" fails under KILN_RELEASE=1 until src/render reads world.field (ceilingY, farX).
- B (2026-10-22 run 7, replaces the boss weak-point line above): a block of `W` cells is fused into one brick at init. A core counts two hits per entry (CONTENT.ENTRY_HITS, 500 ms apart), then cools (`boss.data.guard` = 1, BOSS_GUARD 93 a = 1) until every ball is out of the boss (the Stoker's head, the outer ring) or `CONTENT.GUARD_MS` (2.5 s) has passed, then it is hot again (BOSS_GUARD a = 0). Every core contact that does not count emits BOSS_BLOCKED (94; a = 1 cooled, a = 0 inside the 500 ms): C draws a cooled core dim and no hit flash on a blocked contact, E plays a dull knock. The Stoker's phase-2 jaw shuts only behind a ball that scored, never on a timer. Boss hazards need at least 1 s to reach the paddle line. `world.level.entryY` (B, every level): where bricks join play later (march feed: the wall's starting top edge; The Flue: y 150), NaN when none do.
- Codex B/C/D/E (2026-10-23, supersedes historical Stoker repair notes): Stoker alone has two-hit jaw plates (`STOKER.JAW_HP`); five core hits remain. Broken plates repair once at phase 2 after every ball leaves the head, never again. Content writes `boss.data.jawRepairPending` / `jawRepairDone`; HUD reads these and the live jaw/core bricks. All boss core contacts use outcome events for feedback: BOSS_HIT alone gives success; BOSS_BLOCKED gives a grey puff/low knock, cooldown/guard cores dim, permanent head/ring plates deflect. Model dressing is clipped to the actual jaw and rotating plate apertures. HAZARD_HEAT_LOST (95), emitted by content after addHeat, carries actual capped HEAT loss in b and hazard kind in a; main forwards it to `ui.hudHazardHit(kind, lost)`.
- D (2026-10-31): `?dev=1` is the dev build. Its save has its own slot `kiln.save.v1.dev` (E's createSave(storage, {key, seedFrom}): an empty slot starts from the real save, which it only reads), the help and ball keys get `.dev` versions, every level and Overburn are open (mapModel's `allOpen`), the Menu and Levels labels carry a Dev tag and the install offer never shows. Sound and the title work as normal, so agents add `&mute=1`.
