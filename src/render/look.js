// Kiln: every renderer number in one place (OWNER: C). Sources: ART.md sections 7 to 11 and look
// test 02 (HANDOFF-look2.md). Values marked "C call" are logged in status/C.md with the reason.
// Pure data: no three.js import.

export const LOOK = Object.freeze({
  // tone and bloom (ART 7, 11.2)
  EXPOSURE: 1.1,
  BLOOM_STRENGTH: 0.18,
  BLOOM_RADIUS: 0.10,
  BLOOM_THRESHOLD: 0.9,
  MAX_DPR: 2,
  MSAA: 4, // composer samples below 1.75x pixel ratio (ART 7)
  MSAA_HI_DPR: 2, // at 1.75x and up (C call: half the resolve cost, edges still clean)
  MSAA_LITE: 2, // lite through the composer (a canvas made without MSAA), at 1x pixel ratio

  // fog (ART 7)
  FOG_NEAR: 1700,
  FOG_FAR: 2900,
  FOG_REF_DIST: 1782, // the desktop fit distance the look was approved at; fog shifts with the fit

  // brick slab (ART 8): shell 56x26x18 r5 seg4 in the 60x30 cell; core 49x19x11 r2.5 seg2
  SHELL: { w: 56, h: 26, d: 18, r: 5, seg: 4 },
  CORE: { w: 49, h: 19, d: 11, r: 2.5, seg: 2 },
  CELL_GAP: 4,
  MARK_Z: 11 / 2 + 1.3, // inner marks: core front + 1.2..1.4

  // heat per brick type (ART 8)
  HEAT_TIER: [0.12, 0.12, 0.5, 1.0], // index = bricks.tier (1..3); 0 falls back to tier 1
  HEAT_NUMBERED_FULL: 0.42,
  HEAT_NUMBERED_MIN: 0.04,
  HEAT_NUMBERED_SPAN: 0.38,
  HEAT_MOVING: 0.55,
  HEAT_SPECIAL: 0.3, // carrier, cavity, gravity, portal
  HEAT_WEAK: 1.15, // boss weak point: the hottest core (C call)
  EXPLOSIVE_LO: 0.45,
  EXPLOSIVE_HI: 1.05,
  EXPLOSIVE_RATE: 2.6, // rad/s
  HIT_FLASH: 0.6,
  HIT_FLASH_S: 0.16,
  RUPTURE_FLASH: 2.4,
  RUPTURE_S: 0.16,
  BURN_S: 0.42, // BRICK_BURNT: heat climbs, the slab shrinks away, sparks rise (no fragments)
  BURN_HEAT: 1.6,
  REFORM_EASE_S: 0.55,
  REFORM_SETTLE_S: 0.5,
  REFORM_GLOW: 1.4,

  // fragments (ART 8)
  FRAG_GLASS: 8,
  FRAG_CERAMIC: 4,
  FRAG_SIZE: [6.75, 4.5, 1.95],
  FRAG_GRAVITY: 560,
  FRAG_TUMBLE: 12,
  FRAG_LIFE_S: 2.4,
  FRAG_POOL: 240, // fragments alive at once (20 breaks in flight)

  // paddle (ART 8)
  PADDLE_DEPTH: 22,
  PADDLE_RADIUS: 4,
  PADDLE_CAP: 6,
  PADDLE_LINE_REST: 0.35,
  PADDLE_LEAN: 0.03,
  PADDLE_SELF_LIGHT: 0x746a5d,
  PERFECT_FLARE_MS: 120,

  // Item 19: solid warm ball. The retained HALO field is the dark outline diameter.
  BALL_GAIN: 1.0,
  BALL_HALO: 20.88,
  BALL_HALO_ALPHA: 1.0,
  BALL_LIGHT: 0,
  BALL_LIGHT_DIST: 320,
  TRAIL_POINTS: 120,

  // camera motion (ART 6)
  INTRO_DOLLY: 1.07,
  INTRO_S: 1.6,
  LEAN: 0.22,
  LEAN_LOOK: 0.35,
  LEAN_POS: 0.9,
  ROLL: 0.012,
  LEAN_RATE: 1.8,
  DRIFT: 10,
  SHAKE_PX: 4,
  SHAKE_MS: 200,

  // fire (ART 9.1)
  FIRE_BY_MULT: { 1: 0.55, 2: 0.7, 3: 0.85, 5: 1.0 },
  OMEGA_BY_MULT: { 1: 1.25, 2: 1.5, 3: 1.75, 5: 2.0 },
  FIRE_EASE_S: 0.6,
  FLARE_PADDLE: 0.6,
  FLARE_PERFECT: 0.8,
  FLARE_LOST: 1.0,
  FLARE_HALF_S: 0.25,
  FIRE_LIGHT_BASE: 70000,
  FIRE_LIGHT_GAIN: 80000,
  FIRE_LIGHT_BREAK: 60000,
  DEEP_LIGHT_BASE: 30000,
  DEEP_LIGHT_GAIN: 30000,
  // the grate under the mouth (ART 15.3 C8): seven cast bars along x (width, height, depth) at this
  // world y, at these depths, on two bearers (C call, see kiln.js: smaller and nearer than C8's
  // 1100 x 16 x 22 at z -180 to -780; tests/c-fit checks that no bar shows inside the paddle's ring)
  GRATE_Y: -632,
  GRATE_Z: [-60, -100, -140, -180, -220, -260, -300],
  GRATE_BAR: [780, 6, 9],
  GRATE_BEARER: [330, 12, 14], // |x|, width, height: under the bars, as deep as the bars span

  // sparks (decoration, ART 8)
  SPARKS: 620,
  SPARKS_LITE: 206,
  // gains on heat-high (review 2026-10-22, ART 14: bloom only on the ball, molten cores, fire and the
  // rupture; threshold 0.9 linear): decorative sparks and hit sparks stay under it, the ball's own
  // trail dots may cross it (tests/c-look checks the first two against COLOR.HEAT_HI)
  SPARK_GAIN: 1.15,
  BURST_GAIN: 1.1,
  TRAIL_GAIN: 2.0,

  // headroom plates (ART 12a, 15.2): scene-linear peak cap (soft knee from 60%), and the body gain
  // behind D's HUD (phone band, gutters), where the emitters go out
  PLATE_CAP: 0.12,
  PLATE_HUD_BODY: 0.4,

  // wall firing on level clear (ART 9.4)
  CLEAR_SWEEP_S: 0.7,
  CLEAR_CELL_S: 0.5,
  CLEAR_PEAK: 1.4,
  CLEAR_REST: 0.2,
  CLEAR_HOLD_S: 1.2,

  // last life (ART 10)
  VIGNETTE: 0.14,
  VIGNETTE_LAST: 0.25,
  DESAT_LAST: 0.1,
  HEAT_LO_LAST: '#F36123',
  ESCALATE_S: 0.4,

  // menu (ART 5)
  MENU_BLUR_PX: 40,
  MENU_DIM: 0.35,
  // (the frame budget and the quality ladder live in pace.js PACE)
});
