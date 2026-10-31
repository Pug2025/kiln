// Kiln — JSDoc types for every entity, the world state and the module interfaces.
// This file has no runtime code. Import types with: /** @type {import('../core/types.js').World} */
//
// WHO WRITES WHAT (single writer per field; everyone else reads):
//   A = physics (src/sim)   B = content (src/content, src/levels)   E = economy (src/economy)
//   core = src/core/world.js   C/D read only, never write world state.
// See src/ARCHITECTURE.md for the step pipeline and the hard seams.

// ------------------------------------------------------------------ primitives

/**
 * @typedef {'bottom'|'left'|'ring'} FieldMode
 * @typedef {'serve'|'play'|'clearing'|'cleared'|'over'} Phase
 * @typedef {'ember'|'blaze'|'whiteheat'|'overburn'} WorldName
 */

/**
 * @typedef {object} Rng  seeded stream (src/core/rng.js)
 * @property {number} seed
 * @property {() => number} next      float in [0,1)
 * @property {(lo:number, hi:number) => number} int   inclusive
 * @property {(lo:number, hi:number) => number} range
 * @property {(p:number) => boolean} chance
 * @property {() => number} sign
 * @property {<T>(arr:T[]) => T} pick
 * @property {(weights:ArrayLike<number>) => number} weighted
 * @property {(name:string) => Rng} fork
 * @property {number} state
 */

/**
 * @typedef {object} SimBus  ring of numeric event records (src/core/bus.js)
 * @property {number} cap
 * @property {number} head     total events emitted
 * @property {number} step     world step stamped on new events (core writes)
 * @property {Uint16Array} type
 * @property {Int32Array} id
 * @property {Float32Array} x
 * @property {Float32Array} y
 * @property {Float32Array} a
 * @property {Float32Array} b
 * @property {Float32Array} c
 * @property {Uint32Array} at
 */

/**
 * @typedef {object} BusReader  a consumer's cursor; fields hold the current event after next()
 * @property {SimBus} bus
 * @property {string} name
 * @property {number} cur
 * @property {number} lost
 * @property {number} type
 * @property {number} id
 * @property {number} x
 * @property {number} y
 * @property {number} a
 * @property {number} b
 * @property {number} c
 * @property {number} at
 */

/**
 * @typedef {object} InputFrame  one sim step of player intent (src/core/input-frame.js)
 * @property {boolean} steer   tx/ty hold a steering target
 * @property {number} tx       field units
 * @property {number} ty
 * @property {number} axis     keyboard −1…1
 * @property {boolean} fast    Shift with arrows
 * @property {boolean} action  edge
 * @property {boolean} pull    held
 * @property {boolean} overload edge
 */

/**
 * @typedef {object} GridSpec  (constants GRID[mode])
 * @property {number} cols
 * @property {number} rows
 * @property {number} cw   cell width
 * @property {number} ch   cell height
 * @property {number} x0
 * @property {number} y0
 * @property {number} maxRows
 * @property {number} [rMax]  ring only
 */

// ------------------------------------------------------------------ levels (format: src/levels/FORMAT.md)

/**
 * @typedef {object} MotionRow  a row that slides on a rail
 * @property {number} row         grid row index
 * @property {number} [col]       left mode: the grid column that slides along y (writer: B's level data)
 * @property {number} speed       units/s
 * @property {number} [dir]       +1 right/down, −1 left/up (default +1)
 * @property {'bounce'|'wrap'} [style]  default 'bounce'
 */

/**
 * @typedef {object} SentrySpawn
 * @property {string} kind        'drifter' | 'bomber' (B may add kinds)
 * @property {number} [x]         field units (or use an 'S' cell in rows)
 * @property {number} [y]
 * @property {number} [atMs]      spawn time after level start (default 0)
 * @property {number} [everyMs]   respawn period while the level runs (0 = once)
 * @property {number} [along]     patrol size along the track, units (writer: B's level data)
 * @property {number} [across]    patrol size across the track, units (writer: B's level data)
 */

/**
 * @typedef {object} LevelRules  every flag defaults to false/0 (normalised by the parser)
 * @property {boolean} pull          Pull available (from level 7)
 * @property {boolean} overloads     Overloads available (from level 22)
 * @property {boolean} heat          HEAT meter shown (true once Pull or Overloads exist)
 * @property {number} timerMs        timed level (bonus rounds); 0 = none
 * @property {boolean} noFail        a lost ball costs nothing (bonus rounds)
 * @property {number} marchMs        march-down: a new row every N ms; 0 = off
 * @property {string[]} marchRows    rows fed in by march-down, cycled
 * @property {number} scrollSpeed    scrolling wall (units/s while the top row is cleared); 0 = off
 * @property {boolean} fever         every brick hit splits the ball (bonus)
 * @property {number} rainMs         multiball rain: a new ball every N ms (bonus); 0 = off
 * @property {boolean} dark          only a lantern radius around ball and paddle is lit
 * @property {boolean} ghosts        two afterimage paddles trail the paddle
 * @property {boolean} megaRescue    Mega drop may appear (≤5 bricks for 20 s)
 * @property {number} [marchFeed]    march-down: rows fed in before the feed stops (writer: B's level data)
 * @property {number} aimAt          aim line at ≤N bricks (0 = off; default LAST_BRICKS.AT from level 4)
 */

/**
 * @typedef {object} LevelDef  one level as written in src/levels/data/*.js
 * @property {number} n                 1–30 campaign; 31+ Overburn waves
 * @property {string} id                kebab id, e.g. 'ignition'
 * @property {string} name              shown on the HUD and level map, e.g. 'Ignition'
 * @property {WorldName} world
 * @property {'normal'|'bonus'|'boss'} kind
 * @property {FieldMode} mode
 * @property {string[]} rows            grid rows, top to bottom (legend: src/levels/legend.js)
 * @property {number} [tier]            starting speed tier 0–5 (default 0)
 * @property {string} [adds]            one short fact for the level card: what is new ("Numbered bricks")
 * @property {{rate?:number, table?:Object<string, number>}} [drops]  random-drop chance per broken brick and weights by drop name
 * @property {Object<string, string>} [carriers]  "row,col" → drop name for '?' cells with a fixed drop
 * @property {Object<string, '2'|'3'|'4'|'A'>} [loaded]  B: tougher material for a '?' cell with a fixed good drop
 * @property {Partial<LevelRules>} [rules]
 * @property {MotionRow[]} [motion]
 * @property {SentrySpawn[]} [sentries]
 * @property {'stoker'|'crucible'|'core'|null} [boss]
 * @property {'mod'|'overload'|null} [pick]   pick screen before the level starts
 * @property {boolean} [gate]           after this level the player picks one of two twists for the next
 * @property {string} [hint]            optional short fact (information, never an instruction)
 * @property {number} [stage]           2, 3 … for a continuation stage (same n); omitted on stage 1
 * @property {string} [twist]           gate twist applied to this copy (writer: B's applyTwist)
 * @property {string} [continues]       id of the next stage: when this world is cleared the run goes
 *                                      straight into that stage (The Core's three field modes). The
 *                                      field mode never changes inside a world.
 * @property {string[]} [doors]         the two gate doors into this level, each 'cost+payoff' (writer: B's level data)
 */

/**
 * @typedef {object} ParsedBrick  parser output, one per non-empty cell
 * @property {number} type   BRICK.*
 * @property {number} flags  BF.*
 * @property {number} hp
 * @property {number} tier   look tier 1–3 (plain), 0 otherwise
 * @property {number} col
 * @property {number} row
 * @property {number} x      centre, field units
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} link   index of the twin portal in the bricks list, −1 none
 * @property {number} drop   DROP kind for a fixed carrier, −1 random
 * @property {number} group  boss part / cavity id, −1 none
 */

/**
 * @typedef {object} ParsedLevel
 * @property {LevelDef} def
 * @property {GridSpec} grid
 * @property {LevelRules} rules
 * @property {ParsedBrick[]} bricks
 * @property {{x:number, y:number, kind:string}[]} sentrySpawns   from 'S' cells
 * @property {number} clearable   bricks with BF.CLEARABLE
 * @property {string[]} warnings
 */

// ------------------------------------------------------------------ world state

/**
 * @typedef {object} LevelState  (core creates; B writes remaining/timeLeftMs/elapsedMs/scrollY)
 * @property {LevelDef} def
 * @property {number} n
 * @property {FieldMode} mode
 * @property {GridSpec} grid
 * @property {LevelRules} rules
 * @property {'normal'|'bonus'|'boss'} kind
 * @property {number} remaining    clearable bricks left, or boss weak hits left (B)
 * @property {number} total        clearable at start (B)
 * @property {number} timeLeftMs   timed levels; −1 when untimed (B)
 * @property {number} elapsedMs    (B)
 * @property {number} scrollY      rows scrolled in (B)
 * @property {number} [entryY]     B (optional, set in content.init): bottom mode, the top edge of the
 *                                 line where new bricks come into play during the level (march-down
 *                                 feed rows, scrolled rows revealed). A keeps the ceiling at or above
 *                                 it. Unset: A assumes grid row 0 (y 90) for a march feed and the
 *                                 field top (y 0) for scrolling, which is where they enter today.
 */

/**
 * @typedef {object} PlayField  the play box's movable walls (A writes them once, in physics.init,
 *                              from the level's starting bricks; C draws the ceiling bar from them)
 * @property {number} ceilingY  bottom mode: y of the ceiling's face; balls, lasers and the robot's
 *                              casts bounce or stop there and never go above it. 0 in other modes.
 * @property {number} farX      left mode: x of the far wall's face (same rule). FIELD.W in other modes.
 * @property {number} clear     clear space at level start between the bricks' farthest reach (boss
 *                              parts: their whole turn) and that wall; 0 in ring mode or with no bricks
 * @property {number} gap       the clear space the rule asked for: CEILING.GAP (120), or MIN_CLEAR (60)
 *                              when nothing over the top can be broken or turns (ceiling.js); 0 in ring mode
 */

/**
 * @typedef {object} Paddle  (A writes all fields)
 * @property {number} x        centre, field units (all modes; ring: point on the arc)
 * @property {number} y
 * @property {number} px       previous step (interpolation; the renderer draws the paddle at x/y)
 * @property {number} py
 * @property {number} angle    ring mode: bearing of the paddle centre from the ring centre, radians,
 *                             field coords (x right, y down), so π/2 = bottom. Other modes: 0.
 * @property {number} w        current length along the track, field units (eases toward effects.paddleW)
 * @property {number} h
 * @property {number} span     ring mode: current arc span in radians
 * @property {number} vel      velocity along the track, units/s (spin, angle mixing)
 * @property {boolean} pulling Pull applied this step (E drains HEAT while true)
 * @property {number} lastActionMs  sim time of the last action press (perfect-hit window)
 * @property {number} contacts paddle contacts since the last tier change
 * @property {Float32Array} ghostX  afterimage paddles (rules.ghosts): 2 trailing x (or y / angle)
 * @property {number} flareMs  sim time of the last perfect-hit flare (renderer hint)
 */

/**
 * @typedef {object} Ball  pool entry (A writes)
 * @property {boolean} alive
 * @property {number} x
 * @property {number} y
 * @property {number} px       previous step position (interpolation)
 * @property {number} py
 * @property {number} vx       units/s
 * @property {number} vy
 * @property {number} r
 * @property {number} tier     speed tier 0–5
 * @property {number} boostMs  perfect-hit boost left
 * @property {number} pierce   bricks it may still pass through (perfect hit)
 * @property {boolean} held    sitting on the paddle (serve or Catch)
 * @property {number} holdOffset  offset along the paddle while held
 * @property {number} spin     signed spin, decays over SPIN.DURATION_MS
 * @property {number} bouncesNoBrick   anti-loop counter
 * @property {number} lastPaddleMs     sim time of the last paddle contact
 * @property {number} portalCooldownMs
 * @property {number} sealed   index of the cavity brick holding it, −1 free
 */

/**
 * @typedef {object} BrickStore  struct of arrays, capacity POOL.BRICKS (B writes; A reads flags/geometry)
 * @property {number} count      high-water mark (iterate 0…count−1 and test alive)
 * @property {number} version    bumped by B whenever a brick appears, breaks or changes look;
 *                               the renderer rebuilds static instances when it changes
 * @property {Uint8Array} alive
 * @property {Uint8Array} type   BRICK.*
 * @property {Uint16Array} flags BF.*
 * @property {Int16Array} hp
 * @property {Int16Array} hpMax
 * @property {Uint8Array} tier   look tier 1–3 for plain bricks
 * @property {Float32Array} x    centre
 * @property {Float32Array} y
 * @property {Float32Array} w
 * @property {Float32Array} h
 * @property {Float32Array} px   previous step (B copies before moving MOVING/FALLING bricks)
 * @property {Float32Array} py
 * @property {Int16Array} col
 * @property {Int16Array} row
 * @property {Int16Array} link   portal twin index, −1
 * @property {Int8Array} drop    fixed carrier drop kind, −1 random
 * @property {Int16Array} group  boss part / cavity id, −1
 * @property {Float32Array} hitMs  sim time of the last hit (renderer flash / heat knock-out)
 */

/**
 * @typedef {object} EmberStore  struct of arrays, capacity EMBERS.MAX_LIVE (A moves; E asks for spawns)
 * @property {number} count   high-water mark
 * @property {Uint8Array} alive
 * @property {Float32Array} x
 * @property {Float32Array} y
 * @property {Float32Array} px
 * @property {Float32Array} py
 * @property {Float32Array} vx
 * @property {Float32Array} vy
 * @property {Float32Array} bornMs
 */

/**
 * @typedef {object} Drop  pool entry, capacity DROPS.MAX_LIVE (A moves; E decides kind)
 * @property {boolean} alive
 * @property {number} kind  DROP.*
 * @property {number} x
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} vx
 * @property {number} vy
 */

/**
 * @typedef {object} Hazard  pool entry (A moves and tests against the paddle; B spawns and decides the effect)
 * @property {boolean} alive
 * @property {number} kind   B-defined (0 sentry bomb, 1 Stoker slag, …)
 * @property {number} x
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} vx
 * @property {number} vy
 * @property {number} r
 */

/**
 * @typedef {object} Laser  pool entry (A)
 * @property {boolean} alive
 * @property {number} x
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} vx
 * @property {number} vy
 */

/**
 * @typedef {object} Sentry  pool entry (B moves and decides; A collides balls/lasers with it as a circle)
 * @property {boolean} alive
 * @property {number} kind
 * @property {number} x
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} vx
 * @property {number} vy
 * @property {number} r
 * @property {number} hp
 * @property {number} eye      eye bearing, radians (renderer)
 * @property {number} t        B's timer
 */

/**
 * @typedef {object} BossState  (B writes; boss bricks live in the brick store with BF.BOSS)
 * @property {boolean} active
 * @property {string} id       'stoker' | 'crucible' | 'core'
 * @property {number} phase    1-based
 * @property {number} hp
 * @property {number} hpMax
 * @property {number} x        anchor / centre for the renderer's boss mesh
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} angle
 * @property {number} pangle
 * @property {number} open     0…1 boss-defined pose (jaw open, ring gap, shutter)
 * @property {number} state    boss-defined state code
 * @property {number} t        ms in state
 * @property {object} data     boss-private, preallocated by B
 */

/**
 * @typedef {object} EconState  per level (E writes)
 * @property {number} heat
 * @property {number} heatMax
 * @property {number} combo      combo count
 * @property {number} mult       1, 2, 3 or 5
 * @property {number} levelScore
 * @property {number} embersCaught
 * @property {number} embersAutoBanked  E: earned embers secured at a win, without catch HEAT/combo/score
 * @property {number} dropsCaught
 * @property {number} bricksBroken
 * @property {number} overloadCost  HEAT needed for the equipped Overload
 * @property {Float32Array} effectMs  per DROP kind: ms left (0 off; Infinity until used/lost)
 * @property {number} [shieldCost]   E: HEAT a shield costs on the overload input before an Overload is equipped
 * @property {number} [livesLost]    E: lives lost on this level
 * @property {boolean} [cavityFreed] E: a cavity ball was freed (the level score doubles at the clear)
 * @property {number} [clearBonus]   E: flat clear bonus awarded (results screen)
 * @property {number} [cavityBonus]  E: points added by the cavity doubling (results screen)
 * @property {boolean} [flawless]    E: cleared without losing a life
 * @property {number} [ventMs]       E: ms of play left before HEAT can fill again after an Overload (0 = filling)
 * @property {number} [shieldMs]     E: ms of play left on a bought shield (0 = none bought, or the Shield Mod's, which holds until used)
 */

/**
 * @typedef {object} Effects  live effect OUTPUTS that other systems obey (E is the only writer)
 * @property {number} paddleW         target paddle length (A eases paddle.w toward it)
 * @property {number} ballSpeedScale  Slow/Fast/Quench multiplier on ball speed (A applies)
 * @property {boolean} catchOn        balls stick to the paddle on contact (A)
 * @property {number} laserShots      shots left; A fires on action when > 0 and emits LASER_FIRED
 * @property {number} shield          misses the floor will absorb; A emits SHIELD_USED, E decrements
 * @property {boolean} fire           balls burn: one-shot armour, 3×3 splash (B applies damage)
 * @property {boolean} thru           balls pass through breakable bricks (A skips reflection)
 * @property {boolean} mega           balls are huge and pass through everything breakable
 * @property {number} fog             0…1 Fog drop strength (renderer)
 * @property {number} pierceFirst     Mod: extra pierce on each launch (A)
 * @property {number} magnet          Mod: embers curve to the paddle within this radius (A)
 * @property {number} ballKind        0 standard, 1 Heavy, 2 Splitter, 3 Sniper (A speed/aim, B damage)
 * @property {boolean} aimLine        always show the aim line (Sniper) (A sets fx.aim*)
 */

/**
 * @typedef {object} RunState  one run across levels (E writes; created by economy createRun)
 * @property {number} seed
 * @property {number} levelN
 * @property {number} lives
 * @property {number} score
 * @property {number[]} mods       Mod ids taken this run
 * @property {number} overload     OVERLOAD.* equipped
 * @property {number} ballKind
 * @property {string|null} twist   gate twist chosen for the next level
 * @property {number} overburnWave 0 in the campaign
 * @property {number} embersBanked embers collected for The Forge this run
 * @property {Object<string, number>} [forge]  E: Forge ranks snapshot at run start (lives, heat, paddle, embers, overload, ball)
 * @property {number} [freeMiss]   E: lost balls left this run that cost no life (Forge lives rank 3)
 * @property {number} [banked]     E: embersBanked already moved into the save by bankRun
 * @property {number} [carryHeat]  E: HEAT carried into the next chained stage (The Core), −1 none
 * @property {number} [carryCombo] E: combo carried into the next chained stage, −1 none
 */

/**
 * @typedef {object} FxHints  presentation hints written by the sim (renderer/audio/HUD read)
 * @property {number} zoom      1 normal; SLOWMO.LAST_ZOOM during the ceremony (A)
 * @property {number} zoomX     zoom focus, field units (A)
 * @property {number} zoomY
 * @property {boolean} aim      show the aim line (A)
 * @property {number} aimX      aim line start (A)
 * @property {number} aimY
 * @property {number} aimDX     unit direction (A)
 * @property {number} aimDY
 * @property {boolean} lastLife one life left: escalation look (E)
 * @property {number} dark      0…1 lantern darkness (B from rules.dark)
 * @property {number} heatLevel 0…1 music/fire intensity hint (E: HEAT, combo and danger blended)
 */

/**
 * @typedef {object} WorldStats  counters for tests and the debug overlay (owners append fields)
 * @property {number} nudges
 * @property {number} paddleHits
 * @property {number} perfectHits
 * @property {number} bricksBroken
 * @property {number} ballsLost
 * @property {Object<string, number>} apiMissing  calls to world.api functions nobody installed yet
 */

/**
 * @typedef {object} WorldApi  cross-system calls. Defaults (core) are counting no-ops; owners
 * replace them in their system's init(). Never call these from presentation code.
 * @property {(x:number, y:number, vx:number, vy:number) => number} spawnBall      A → slot or −1
 * @property {(extraPerBall:number) => number} splitBalls                        A → balls created
 * @property {() => void} serve                                                   A: new ball on the paddle
 * @property {(x:number, y:number, n:number) => number} spawnEmbers             A → embers created
 * @property {() => number} settlePickups  A: deactivate current ember/capsule pools; return live ember count without catch events
 * @property {(x:number, y:number, kind:number) => number} spawnDrop             A → slot or −1
 * @property {(x:number, y:number, vx:number, vy:number, kind:number, r:number) => number} spawnHazard  A
 * @property {(i:number, dmg:number, src:number, ball:number) => void} damageBrick  B
 * @property {(i:number, src:number, ball:number) => void} breakBrick           B
 * @property {(rows:number) => number} purgeRows                                 B → bricks broken
 * @property {(points:number, x:number, y:number) => void} addScore              E
 * @property {(n:number) => void} addHeat                                        E
 * @property {(kind:number) => void} applyDrop                                   E (effect without a catch)
 */

/**
 * @typedef {object} System  a sim system; hooks run in the order of PIPELINE (src/core/world.js)
 * @property {string} name
 * @property {(w:World) => void} init
 * @property {(w:World, input:InputFrame) => void} [pre]
 * @property {(w:World, input:InputFrame) => void} [move]
 * @property {(w:World, input:InputFrame) => void} [resolve]
 * @property {(w:World, input:InputFrame) => void} [step]
 * @property {(w:World, input:InputFrame) => void} [post]
 */

/**
 * @typedef {object} Systems
 * @property {System} physics   A (src/sim/physics.js createPhysics)
 * @property {System} content   B (src/content/content.js createContent)
 * @property {System} economy   E (src/economy/economy.js createEconomy)
 */

/**
 * @typedef {object} World  everything the sim knows. One world per level attempt.
 * @property {number} seed
 * @property {number} step        steps taken (core)
 * @property {number} time        sim ms (core)
 * @property {Phase} phase        change only through setPhase() (core)
 * @property {number} phaseMs     sim time when the phase began (core)
 * @property {number} timeScale   real-time scale for main.js's accumulator (A: slow-mo)
 * @property {LevelState} level
 * @property {{small:boolean,width:number,height:number,scale:number,dropHalfU:number,dropHalfV:number,emberR:number}} readability  stable CSS view/catch facts (D writes at layout)
 * @property {PlayField} field    the ceiling / far wall (A, set once at level start)
 * @property {Paddle} paddle
 * @property {Ball[]} balls
 * @property {BrickStore} bricks
 * @property {EmberStore} embers
 * @property {Drop[]} drops
 * @property {Hazard[]} hazards
 * @property {Laser[]} lasers
 * @property {Sentry[]} sentries
 * @property {BossState} boss
 * @property {EconState} econ
 * @property {Effects} effects
 * @property {RunState} run
 * @property {FxHints} fx
 * @property {SimBus} bus
 * @property {{physics:Rng, content:Rng, economy:Rng, robot:Rng}} rng
 * @property {WorldApi} api
 * @property {WorldStats} stats
 * @property {Systems} systems
 */

// ------------------------------------------------------------------ module interfaces (presentation side)

/**
 * @typedef {object} FieldRect  where the field sits on screen, CSS pixels
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {number} scale  CSS px per field unit at the field plane
 * @property {number} [fieldX] C: original field x at the framed rect's left edge
 * @property {number} [fieldY] C: original field y at the framed rect's top edge
 * @property {number} [fieldW] C: field units across the framed rect
 * @property {number} [fieldH] C: field units down the framed rect
 */

/**
 * @typedef {object} Renderer  (C) src/render/renderer.js — createRenderer(host, opts) → Promise<Renderer>
 * @property {(world:World) => void} setWorld     new level/attempt: rebuild instances, reset its bus reader
 * @property {(def:{world?:string, boss?:string}, wave?:number) => void} [prefetchHeadroom] decode one next art set on CPU after results appear
 * @property {(world:World, alpha:number, realDt:number) => void} frame   draw; alpha = interpolation 0…1
 * @property {() => void} resize
 * @property {(q:{lite?:boolean, reduceMotion?:boolean}) => void} setQuality
 * @property {(on:boolean) => void} setMenu        blur 40 px + dim 35% behind menus
 * @property {(clientX:number, clientY:number, out:{x:number,y:number}) => boolean} screenToField
 * @property {(out:FieldRect) => FieldRect} fieldRect
 * @property {(out:object) => object} [detailInfo] (C) stable CSS detail sizes; D copies them to world.readability at layout
 * @property {(r:{top?:number, bottom?:number}) => void} [setReserve]   (C) CSS px kept clear above (HUD) and under (touch Overload) the field; next resize() applies it
 * @property {{frameMs:number, calls:number, triangles:number}} stats
 * @property {() => void} dispose
 */

/**
 * @typedef {object} Input  (D) src/input/input.js — createInput(target, mapper, opts) → Input
 * @property {(frame:InputFrame, world:World) => void} sample   fill the frame for the next step
 * @property {(on:boolean) => void} setEnabled
 * @property {(fn:(reason:string) => void) => void} onPause      auto-pause on hide/blur/pointercancel/keys
 * @property {(opts:object) => void} configure                    left-handed, thumb pad
 * @property {() => void} dispose
 */

/**
 * @typedef {object} UI  (D) src/ui/ui.js — createUI(root, ctx) → UI
 * @property {(name:string, data?:object) => void} show   'title'|'map'|'forge'|'settings'|'pause'|'results'|'credits'|'pick'|'gate'|null
 * @property {(world:World) => void} hud                  per frame; touches the DOM only on change
 * @property {(rect:FieldRect) => void} layout
 * @property {(text:string) => void} toast
 * @property {(kind:number, lost:number) => void} hudHazardHit  actual capped HEAT loss, supplied by content (D displays)
 */

/**
 * @typedef {object} Audio  (E) src/audio/audio.js — createAudio(opts) → Audio
 * @property {() => void} unlock                    call from the first pointerdown/keydown (iOS)
 * @property {(world:World) => void} setWorld      reset its bus reader for a new world
 * @property {(world:World, realDt:number) => void} frame  drain events into sounds, steer music layers
 * @property {(track:string|null) => void} music   'title'|'ember'|'blaze'|'whiteheat'|'boss'|null
 * @property {(v:{music?:number, sfx?:number, muted?:boolean}) => void} setVolume
 * @property {() => void} suspend
 * @property {() => void} resume
 */

/**
 * @typedef {object} SaveData  localStorage 'kiln.save.v1' (E owns the shape and migrations)
 * @property {number} v
 * @property {{unlocked:number, best:Object<string, number>, cleared:Object<string, boolean>}} campaign
 * @property {{embers:number, ranks:Object<string, number>}} forge
 * @property {{best:number, bestWave:number, lastSeed:number}} overburn
 * @property {Object<string, number>} stats
 * @property {{music:number, sfx:number, muted:boolean, lite:boolean, reduceMotion:boolean,
 *   reduceTransparency:boolean, leftHanded:boolean, thumbPad:boolean}} settings
 */

/**
 * @typedef {object} Save  (E) src/economy/save.js — createSave(storage) → Save
 * @property {() => SaveData} load
 * @property {(data:SaveData) => void} write
 * @property {() => SaveData} reset
 */

/**
 * @typedef {object} Controller  anything that fills an InputFrame from the world (robot, replay)
 * @property {(frame:InputFrame, world:World) => void} fill
 */

/**
 * @typedef {object} HeadlessResult  src/core/headless.js runHeadless()
 * @property {boolean} cleared
 * @property {Phase} phase
 * @property {number} steps
 * @property {number} simMs
 * @property {number} remaining
 * @property {number} livesLost
 * @property {number} nudges
 * @property {number} score
 */

export {};
