# Kiln level format

Levels are plain JavaScript data in `src/levels/data/<world>.js` (`ember.js` = 1–10, `blaze.js` =
11–20, `whiteheat.js` = 21–30). Each file default-exports an array of level objects. Overburn
waves come from `src/levels/overburn.js` in the same shape. The parser (`src/levels/parser.js`)
turns a level into bricks; nothing else reads the raw rows.

```js
// src/levels/data/ember.js
export default [
  {
    n: 1, id: 'ignition', name: 'Ignition', world: 'ember', kind: 'normal', mode: 'bottom',
    tier: 0,
    adds: 'Embers and combo',
    rows: [
      '............',
      '..aaaaaaaa..',
      '.bbbbbbbbbb.',
      '..cccccccc..',
    ],
    drops: { rate: 0, table: {} },
    rules: {},
  },
];
```

## Fields

| field | type | default | meaning |
|---|---|---|---|
| `n` | int | required | level number 1–30; Overburn waves are 31+ |
| `id` | string | required | kebab-case id, unique (`'supply-drop'`) |
| `name` | string | required | the approved level name (handoff "Vocabulary") |
| `world` | `'ember'`·`'blaze'`·`'whiteheat'`·`'overburn'` | required | |
| `kind` | `'normal'`·`'bonus'`·`'boss'` | `'normal'` | bonus = timed, no-fail; boss = cleared when the boss is defeated |
| `mode` | `'bottom'`·`'left'`·`'ring'` | `'bottom'` | field mode (paddle at the bottom, on the left edge, on a ring) |
| `rows` | string[] | required | grid rows top → bottom, one legend character per cell (below). Bottom mode: row 0 is the top (y0 = 90). Left mode: row 0 is the top of the field, the paddle side is column 0. Ring mode: the 16 × 16 square around the centre |
| `tier` | 0–5 | 0 | starting speed tier (460…760 u/s) |
| `adds` | string | — | what this level adds, a short label for the level card ("Numbered bricks") |
| `hint` | string | none | optional one-line fact. Information, never an instruction ("Armour takes 3 hits." not "Hit the armour 3 times!") |
| `drops` | `{rate, table}` | `{rate:0, table:{}}` | `rate` = chance a broken non-carrier brick releases a drop; `table` = weights by drop name (`wide slow multi fire laser catch thru life shrink fast fog mega`) used for random drops and `?` carriers |
| `carriers` | `{"row,col": dropName}` | `{}` | fixed drop for a specific `?` cell |
| `loaded` | `{"row,col": "2"·"3"·"4"·"A"}` | `{}` | tougher material for an existing `?` carrier; requires a fixed Laser, Multi, Fire, Wide, Catch, Slow or Life in `carriers` |
| `rules` | object | all off | see Rules |
| `motion` | `[{row, speed, dir?, style?}]` | `[]` | rows that slide on a rail: `speed` u/s, `dir` ±1, `style` `'bounce'` (default, turns at the field walls) or `'wrap'` (leaves one side, re-enters the other). Left mode uses `col` instead of `row` (a column sliding along y). Not in ring mode |
| `sentries` | `[{kind, x?, y?, atMs?, everyMs?, along?, across?}]` | `[]` | sentries (`'drifter'`, `'bomber'`); position from an `S` cell when x/y are omitted; `atMs` first spawn, `everyMs` respawn after a kill (0 = never); `along`/`across` override the patrol size (units). In bottom mode they always keep below the wall |
| `boss` | `'stoker'`·`'crucible'`·`'core'`·`null` | `null` | boss script (src/content/bosses.js) |
| `pick` | `'mod'`·`'overload'`·`null` | `null` | pick screen before the level starts (Mods at 13, 16, 19, 23, 26, 29; Overload at 22) |
| `gate` | bool | `false` | after this level the player picks one of two twists for the next (first at 13; never in front of a bonus or boss level) |
| `stage` | int | none | 2, 3 … on a continuation stage (same `n`); stage defs are not listed on the level map |
| `twist` | string | none | set by `applyTwist` on a gated level's twisted copy (a door id, `'armoured+explosive'` …) |
| `doors` | string[2] | none | on a level a gate leads into: its two designed doors, each `cost+payoff` (see Gates) |
| `continues` | string | none | id of the next stage. When this world is cleared the run goes straight into it, no results in between. The field mode never changes inside a world, so The Core (30) is 3 chained stages: `core-1` bottom → `core-2` left → `core-3` ring |

## Rules (`rules: {}`)

| rule | type | meaning |
|---|---|---|
| `pull` | bool | Pull available (level 7 on) |
| `overloads` | bool | Overloads available (level 22 on) |
| `heat` | bool | show the HEAT meter (the parser sets it when `pull` or `overloads`) |
| `timerMs` | int | timed level; when it reaches 0 the level is cleared (bonus rounds: 5 = 30000, 15 = 25000, 25 = 20000) |
| `noFail` | bool | a lost ball costs nothing (bonus rounds) |
| `marchMs` | int | march-down: every N ms the wall moves down one row and a new row enters at the top (14: 15000) |
| `marchRows` | string[] | rows fed in by march-down, cycled (no `G C * S B W` or portals) |
| `marchFeed` | int | rows fed in before the feed stops (default: `marchRows.length`); the wall keeps stepping down. A brick whose bottom edge passes y 780 (`WALL.DANGER_Y`) burns off: `BRICK_BURNT`, no score, no embers. Rows still to come do not count in `remaining`, so clearing the wall early ends the level |
| `scrollSpeed` | number | scrolling wall (24): while the lowest clearable brick sits above y 630 and rows wait above the field, the whole wall slides down at this speed (units/s). Hidden rows count in `remaining`; anything reaching y 780 burns off |
| `fever` | bool | every brick hit splits the ball (25) |
| `rainMs` | int | multiball rain: a new ball every N ms (15) |
| `dark` | bool | only a lantern radius around ball and paddle is lit (28) |
| `ghosts` | bool | two afterimage paddles trail the paddle (27) |
| `megaRescue` | bool | the Mega drop can appear when ≤5 bricks remain for 20 s (23 on) |
| `aimAt` | int | aim line from the paddle at ≤N bricks (4 on: 3) |

## Grids per mode

Each row string must be exactly `cols` characters. The parser rejects anything else.

| mode | cols × rows | cell (w×h) | origin | notes |
|---|---|---|---|---|
| `bottom` | 12 × up to 20 | 60 × 30 | (0, 90) | scrolling levels may have up to 60 rows: the last 20 sit on the grid, the rest above it (a brick is `BF.HIDDEN` while its bottom edge is at or above y 0) |
| `left` | 24 × 18 | 30 × 60 | (0, 0) | paddle is a vertical bar at x = 40; keep the first 4 columns empty |
| `ring` | 16 × 16 | 30 × 30 | (120, 300) | centre (360, 540); only cells whose centre is within radius 240 may hold bricks |

Brick centre for cell (col, row): `x = x0 + (col + 0.5) · cw`, `y = y0 + (row + 0.5) · ch`.

## Legend (`src/levels/legend.js`)

Case matters: `c` is a plain molten brick, `C` is a cavity shell.

| char | brick | hits | notes |
|---|---|---|---|
| `.` or space | empty | | |
| `a` `b` `c` | plain | 1 | look tier 1 (cool), 2 (warm), 3 (molten core) |
| `2`…`9` | numbered | the digit | number shows inside the glass |
| `A` | armoured | 3 ball / 1 laser or fire | brushed titanium |
| `X` | indestructible | — | matte black; never two facing each other with nothing between (loop trap) |
| `E` | explosive | 1 | 3×3 blast, chains |
| `G` | gravity | 1 | falls when the brick under it breaks |
| `C` | cavity shell | 2 | must fully enclose a `*` (4-neighbour) |
| `*` | sealed ball | — | freed (multiball) when a shell cell next to it breaks |
| `?` | carrier | 1 | always releases a drop (table or `carriers`) |
| `(` `)` `[` `]` `{` `}` | portal ends | — | each pair must appear exactly once per level; non-solid |
| `B` | boss body | boss decides | only in `kind: 'boss'` levels |
| `W` | boss weak point | boss decides | only in `kind: 'boss'` levels |
| `S` | sentry spawn | — | empty cell where a sentry starts |

Roughly 1 brick in 7 is a carrier on levels with drops (PLAN §4). The data files run every level
through `sprinkleCarriers` (parser.js): plain `a`/`b` bricks become random `?` carriers, spread
evenly and counted from the row nearest the paddle, until the share is about 1 in 7 (molten `c`
bricks stay molten unless a level runs short of `a`/`b`). Every carrier has its
drop kind rolled at load from the level table (`bricks.drop`), so E, C and the HUD agree on it.

From Blaze onward, selected carriers use `loaded` metadata: their raw cell stays `?`, while the
parser gives them numbered glass or armour and `BF.LOADED`. They retain the power mark alongside
their hit lines and release their fixed good power only when broken. Existing carriers and the
legend keep their meaning. Gate hardening excludes loaded carriers, just as it excludes `?`.
`anchorLow` moves `loaded` keys together with `carriers` keys.

## Placement (lead rule from the playtest)

Formations sit near the paddle. Bottom mode: at level start the lowest brick's bottom edge is at
y ≥ 600 (`ANCHOR.BOTTOM_MIN_Y`); empty rows go above the formation, never below it. The data files
write compact layouts and run them through `anchorLow(def, row)` (parser.js), which drops trailing
empty rows and pads the top so the lowest brick row lands on grid row 17 (or the row given),
moving `carriers` keys and `motion` rows with it. Left mode: the nearest brick column's edge is at
x ≤ 440. Ring levels sit around the centre. Scrolling and marching levels are judged at the start.

Figures (ART.md 15.7, B1): a band level reads better as a shape than as a full-width strip. Nine
levels carry one: Grid and Conveyor a diamond, Blast door a keyhole, Friend or foe a chevron,
Hull plating a V, Containment a tall diamond, Loadout a stepped ziggurat, Shrapnel a funnel,
Sentries an arch with a keystone. Each leaves at least 25% of its starting box empty, stands 4 to
9 rows tall, keeps its CP3 brick count within ±10%, and gathers its molten `c` bricks in one
cluster at the focal point (the heart, tip, keystone, crown or spout), never a row
(`tests/b-levels.test.mjs`, "figures").

## Parser checks

`parseLevel(def)` throws on anything the game cannot load; `checkLevel(def, {names})` returns the
design problems (empty = good). `tests/b-parser.test.mjs` and `tests/b-levels.test.mjs` run both on
every level, stage, gate twist and Overburn wave.

- parse: every row has the right length and only legend characters; row count within the mode's
  limit (left 18, ring 16 exactly); ring cells inside radius 240; portals paired; every `*` region
  fully enclosed by `C` (4-neighbour); `B`/`W` only in boss levels; no `G` in ring mode; motion
  rows, sentry kinds and `carriers` keys valid; march rows legal
- check: no two `X` cells face each other in a row or column with only non-solid cells between
  (loop trap; adjacent `X` are a wall)
- check: portal twins never share one lane toward the paddle (one column in bottom mode, one row
  in left mode, one bearing in ring mode) unless an `X` stands between them: once the bricks
  around them break, a ball would run paddle, ring, twin, wall, twin, ring, paddle for ever
- boss levels: a block of `W` cells becomes one brick at load (no seams inside the core)
- check: at least one clearable brick (or a boss / timer)
- check: every clearable brick and weak point reachable by a ball (flood fill from the paddle side
  through everything but `X` and `B`; the band above the wall is open; portal twins connect)
- check: left mode keeps columns 0-3 empty; every `G` starts on a solid brick
- check: the placement rule above; bonus levels have `rules.timerMs`; boss levels have a `W`
- check: id kebab-case; names match the handoff list for 1–30; `adds` 2–4 words; hints carry no "!"

## Gates

From level 13 a level with `gate: true` is followed by two doors. `twistsFor(n)` (src/levels/index.js)
returns the two `{id, label, fact}` doors in front of level n (empty when level n−1 has no gate or n is
a bonus or boss level); `applyTwist(def, id)` returns the twisted copy. Every door is a trade, id
`cost+payoff` (src/content/gates.js). Costs: `moving` (two rows slide, columns in left mode),
`armoured` (every third plain brick → `A`), `heavier` (plain → 2, numbers +1). Payoffs: `explosive`
(every twelfth plain or low number → `E`), `rich` (every sixth plain → `?`). The level that the
doors lead into names its pair: `doors: ["armoured+explosive", "heavier+rich"]`, measured with the
robot so both play within about 1.25x of each other and neither plays clearly faster than the
level alone (tests/b-gates); without `doors` a rule picks a pair. The fact under a door counts what
it does ("12 bricks armoured, 7 explode"), 40 characters at most. Content also applies `run.twist`
itself if handed the plain def of a level the doors lead into.
