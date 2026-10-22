# Kiln art kit: the contract

Owner: F (technical artist). Consumers: C (renderer) and D (interface). Every shipped art file is
listed here with its size and format; `tests/f-kit.test.mjs` fails if a listed file is missing or
the wrong size, if a file in `textures/ glyphs/ models/ img/ icons/` is not listed, or if a `.glb`
is invalid or over 400 KB. `ARTKIT.READY` lists the files that are final.

Load every file by the path below and keep a procedural fallback while its status is
`placeholder`: placeholders have the final size and format, so code written against them does
not change when the final lands.

## Files

| Path | Pixels | Format | Colour space | Alpha | Consumer | Status |
|---|---|---|---|---|---|---|
| `textures/crackle.png` | 1024x1024 | PNG RGB | sRGB | none | C: ceramic core `map` | final |
| `textures/crackle_n.png` | 1024x1024 | PNG RGB | linear | none | C: ceramic core `normalMap` (scale 0.5) | final |
| `textures/carbon_detail.png` | 1024x1024 | PNG grey | linear | none | C: roughness / detail map (bright = crack line, rough) | final |
| `textures/obsidian.png` | 1024x1024 | PNG RGB | sRGB | none | C: indestructible grain, a multiply `map` (near white, mean 0.85 linear) under the matte colour | final |
| `textures/obsidian_n.png` | 1024x1024 | PNG RGB | linear | none | C: indestructible `normalMap` (bead-blasted grain, gentle) | final |
| `glyphs/wide.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 0 | final |
| `glyphs/slow.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 1 | final |
| `glyphs/multi.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 2 | final |
| `glyphs/fire.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 3 | final |
| `glyphs/laser.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 4 | final |
| `glyphs/catch.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 5 | final |
| `glyphs/thru.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 6 | final |
| `glyphs/life.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 7 | final |
| `glyphs/shrink.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 8 | final |
| `glyphs/fast.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 9 | final |
| `glyphs/fog.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 10 | final |
| `glyphs/mega.png` | 256x256 | PNG RGBA | sRGB | luminance | C: drop glyph source, id 11 | final |
| `glyphs/drops.png` | 1024x768 | PNG RGBA | sRGB | luminance | C: drop glyph atlas (layout below) | final |
| `img/backdrop.webp` | 2048x1024 | WebP | sRGB | none | C: kiln back plate behind the arena (wraps left/right) | final |
| `img/hearth.webp` | 1536x1536 | WebP | sRGB | none | D: title and boot backdrop (cover-fit, anchor bottom centre) | final |
| `img/levels/ember.webp` | 1024x576 | WebP | sRGB | none | D: level-map card, Ember (1 to 10) | final |
| `img/levels/blaze.webp` | 1024x576 | WebP | sRGB | none | D: level-map card, Blaze (11 to 20) | final |
| `img/levels/whiteheat.webp` | 1024x576 | WebP | sRGB | none | D: level-map card, White Heat (21 to 30) | final |
| `img/levels/overburn.webp` | 1024x576 | WebP | sRGB | none | D: level-map card, Overburn | final |
| `img/headroom/ember.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, Ember 1 to 9 (and Overburn, graded); the style anchor for every painted piece (ART 15.4 R9) | final |
| `img/headroom/ember_glow.png` | 512x768 | PNG RGB | linear | none | C: Ember masks: R glow (the crown seam only, 0 on metal; peaks at 0.30, pre-scaled so the plate meets ART 15.2 with KIT_GLOW 0.12), G structure (ribs and seam, faded with the plate by row .46, for the clear wave), B 0 | final |
| `img/headroom/blaze.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, Blaze 11 to 19 | final |
| `img/headroom/blaze_glow.png` | 512x768 | PNG grey | linear | none | C: Blaze emissive mask | final |
| `img/headroom/whiteheat.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, White Heat 21 to 29 | final |
| `img/headroom/whiteheat_glow.png` | 512x768 | PNG grey | linear | none | C: White Heat emissive mask | final |
| `img/headroom/stoker.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, The Stoker (10) | final |
| `img/headroom/stoker_mid.webp` | 1024x1536 | WebP RGBA | sRGB | straight | C: Stoker mid layer: the iris | final |
| `img/headroom/stoker_glow.png` | 512x768 | PNG grey | linear | none | C: Stoker emissive mask | final |
| `img/headroom/crucible.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, The Crucible (20) | final |
| `img/headroom/crucible_mid.webp` | 1024x1536 | WebP RGBA | sRGB | straight | C: Crucible mid layer: vessel and arms | final |
| `img/headroom/crucible_glow.png` | 512x768 | PNG grey | linear | none | C: Crucible emissive mask | final |
| `img/headroom/core.webp` | 1024x1536 | WebP | sRGB | none | C: headroom far layer, The Core (30) | final |
| `img/headroom/core_mid.webp` | 1024x1536 | WebP RGBA | sRGB | straight | C: Core mid layer: the shield rings | final |
| `img/headroom/core_glow.png` | 512x768 | PNG grey | linear | none | C: Core emissive mask | final |
| `icons/icon-180.png` | 180x180 | PNG RGB | sRGB | none | D: apple-touch-icon | final |
| `icons/icon-192.png` | 192x192 | PNG RGB | sRGB | none | D: manifest icon | final |
| `icons/icon-512.png` | 512x512 | PNG RGB | sRGB | none | D: manifest icon | final |
| `icons/icon-maskable-512.png` | 512x512 | PNG RGB | sRGB | none | D: manifest icon, `purpose: maskable` (art inside the centre 80% circle) | final |
| `icons/favicon.png` | 64x64 | PNG RGB | sRGB | none | D: `<link rel="icon">` | final |
| `models/stoker.glb` | n/a | glTF 2.0 binary | linear | n/a | C: The Stoker (level 10) | final |
| `models/crucible.glb` | n/a | glTF 2.0 binary | linear | n/a | C: The Crucible (level 20) | final |
| `models/core.glb` | n/a | glTF 2.0 binary | linear | n/a | C: The Core (level 30) | final |

## Rules per kind

**Textures.** Seamless (tilecheck seam score 1.6 or less on every final), flat even lighting.
Generated at 1024 square (house rule), shipped at the size the game samples: a brick face is
under about 200 device px even at pixel ratio 2, so it never samples above the 256 mip of a
1024 map. `textures/` and its rows belong to R (FILEMAP, since 2026-10-21 19:55); f-kit only
prints advice about its size, never fails on it. `python3 tools/art/resample.py <in> <out> <512|256> <albedo|grey-albedo|linear|normal>`
shrinks a map wrap-aware, so the seam score holds; a grey map ships as `PNG grey`. Albedo is
sRGB (`texture.colorSpace = SRGBColorSpace`), grey or not: a grey albedo (an obsidian.png saved
as `PNG grey`) is still sRGB. Normal maps and grey data maps (roughness, masks) are linear
(`NoColorSpace`). Normals are OpenGL convention (+Y up), the three.js default.
Titanium stays procedural in C (ART.md section 13), so there is no titanium file.

**Drop glyphs.** White monoline on transparent: RGB is white everywhere, alpha is the glyph's
luminance (cut by threshold, never the image model's own transparency). C tints by role at draw
time: good = white-hot, cold powers (slow, catch) = cyan, bad (shrink, fast, fog) = warn red,
mega = molten. Every stroke is 21 px wide in the 256 cell (2 px when the cell is drawn 24 px
tall), round caps, one hand; separate strokes stay 24 px apart or more (2 px at 24; f-kit
measures it), and all twelve read apart at 14 px. LIFE is the HUD's lives bar with a short
chevron above it (drawn in code at the same stroke, ART 15.5 F2), never a plus. The glyph fits the centre 200x200 of its cell (about 27 px clear
margin) so mipmaps never bleed between atlas cells. Wide glyphs (wide, shrink, fog) are shorter
than tall ones; draw the glyph quad square and centred in the drop cell.

**Atlas `glyphs/drops.png`.** 4 columns x 3 rows of 256x256 cells, row-major in `DROP_NAMES`
order: row 0 = wide slow multi fire, row 1 = laser catch thru life, row 2 = shrink fast fog mega.
Cell of drop id `i`: column `i % 4`, row `floor(i / 4)`; in UV (flipY true) u0 = col/4,
v0 = 1 - (row + 1)/3, size 1/4 x 1/3.

**Plates and cards.** WebP, quality about 80, below the bricks in contrast (the world stays the
star). No text is baked in: D draws names and numbers in the DOM.

**Icons.** The KILN I-flame on void `#07080A`, opaque (iOS fills alpha with black): one slot of
fire, the I of the wordmark, edged by a 1 px titanium `#C0C4CA` hairline at 40% (corners at 10% of
the slot width; ART 15.5 F3, no heat outline), with a faint warm spill by its white-hot base.
Exact geometry per size (`tools/art/icons.py`, fire from one gpt-image-2 photograph): slot 68% of
the height at 1:3.8 on the 180/192/512 icons, 62% on the maskable (its corners at radius 0.32,
inside the 0.40 safe circle), 80% at 1:3.2 on the favicon so it still reads at 16 px. Checked at
29, 60 and 180 px on dark and light (`assets/generated/sheet-icons.png` in F's worktree).

**Boss meshes (ART 15.5 F1, 2026-10-22).** glTF 2.0 binary, under 400 KB each. 1 unit = 1 field
unit; +Y up, +X right, +Z toward the camera (three.js axes, exported from Blender with +Y up);
origin at the boss anchor (`world.boss.x / y`; place the root at scene `(x - 360, 540 - y, 0)`).
Bricks stay the boss's hit body; the mesh is the hardware drawn around and behind them: draw the
bricks as usual and the mesh as well. Every node sits behind the brick plane (z -11 and back)
wherever it overlaps a cell; only parts outside the cells come forward (the Stoker's cowl brow
and jaw bar to z +12, the Crucible's lip to z +6). Built from B's layouts (level 10 rows,
`CRUCIBLE_SPEC`, `CORE_SPECS` in `src/content/bosses/orbit.js`) with concepts first
(`assets/generated/image-20261022-0901*-boss-*-concept.png` in F's worktree, reference only).
Each is 120 units deep or more (Stoker 162, Crucible 132, Core 180+), 4k to 15k triangles, every
hard edge bevelled 1.5 units in two segments, and smooth-shaded with face-area weighted normals:
flat faces stay flat and each bevel turns as one round highlight. No face, rivets, stripes or
rims of light; heat only inside openings. f-kit checks depth, triangle count, where the heat is,
that nothing leaves the arena at any anchor (the Stoker's 60-unit sway included: its half-width
is 296) and that the turning parts leave B's ring gaps open.
Materials are named so C can swap its own in by name: `titanium` (armour, cowl, lip, petals),
`matte` (the Stoker's face and slot, the Crucible's bowl), `metal` (flue stacks, hinges, vessel
body, cradle, struts), `ember` (a dim heat glow: the strip at the back of the Stoker's slot, the
pool at the floor of the Crucible's bowl) and `core` (The Core's sphere only: C's crackle
hot-core). The heat is inside, never on a surface: the Stoker's ember is 84 units behind its face
at the back of a slot whose matte walls taper in; the Crucible's pool (124 across, at most 1.3x
the W block) is 70 units behind the lip; the Core's sphere (180 across) has its front 40 units
behind the brick plane and shows only through the three 12-degree gaps between the petals (about
10% of its disc in stage 1). `ember` ships as an unlit-looking emissive `#FF7A1A` x 0.28 (linear)
on a near-black base; keep it as exported, or swap in a heat-low emissive that breathes with boss
heat, but never brighter than the W cells. The `core` sphere's UV is front-projected with its
centre at (0.5, 0.5), one repeat per 90 units, so C's core shader (hottest at the uv centre) is
white-hot only right behind the W cells and heat-low toward the edge; drive its heat below the W
cells (see Requests to C in F's status).
Single-sided, no texture files: C's own maps apply through `TEXCOORD_0`, a box-projected UV in
field units (faces toward the camera take x, y; side faces z, y; top and bottom faces x, z).
`titanium` runs 128 x 32 units per repeat, so C's 512x128 brushed canvas lands at 4 texels per
unit with the grain horizontal; `matte` runs 64 x 64 units per repeat, so the obsidian grain is
about as fine as on a brick face; `metal` and `ember` 128 x 128. Sizes: stoker 5534 triangles /
163 KB, crucible 8682 / 254 KB, core 9207 / 251 KB (all three petal sets included). Faces no game
camera can see (the backs of closed solids) and zero-area triangles are removed before export, so
every material must stay single-sided.
Nodes are named `part-<name>` (B's `BOSS_PARTS` names + `BOSS_DRESSING`). three.js's GLTFLoader
loads each node as a Group holding one mesh per material (`part-ring_1`, `part-ring_2`): drive the
Group by its name (`gltf.scene.getObjectByName('part-ring')`). All node origins are the boss
anchor, so a node turns about the anchor. Field angles turn clockwise on screen, so a turning node
takes `rotation.z = -angle`. Never turn the whole scene: the head, cradle and frame are static.
The drive is the same as before F1, so `src/render/boss.js` needs no change for it. Checked in the
game (levels 10, 20, 30 and The Core's stages 2 and 3, headless Chrome) with exactly this drive.

| Model | Node | Drive |
|---|---|---|
| stoker | `part-head` | static in the model (the root follows `boss.x`, which B sways 60 each way in phase 2): matte face behind the cells with titanium sides, the mouth slot carved into it (matte walls tapering 84 deep), the titanium cowl over the top (brow at z +12, 150 deep) with a raised spine, two dark-metal flue stacks in titanium boots, and a titanium plate in each of row 3's two holes (no eyes) |
| stoker | `part-jaw` | titanium bar under the chin row with two hinge knuckles behind it: `position.y = -world.boss.open * 60` (B sets open = share of jaw plates broken) |
| stoker | `part-core` | the ember strip (295 x 13) at the back of the slot; static |
| crucible | `part-cradle` | static: the bail under the ring, pivot hubs at x +-206, hangers up to the top of the field, axles in to the vessel |
| crucible | `part-ring` | 12 bevelled titanium plates (r 126 to 186) carrying B's ring, open over exactly its gap (slots 23 to 26 today; the build reads B's `orbit.js`, f-kit fails a stale mesh): `rotation.z = -world.boss.angle` |
| crucible | `part-core` | the vessel: titanium lip (r 72 to 104, face at z +6), matte bowl tapering in, the ember pool at its floor (z -64), dark-metal body behind (to z -126); static |
| core | `part-frame` | three static dark-metal struts (r 60 to 200, at 90, 210 and 330 degrees) with titanium feet; no ring |
| core | `part-core` | the crackled sphere (`core`, 180 across, front at z -40); static |
| core | `part-shell` | stage 1: three domed titanium petals, 108 degrees each with 12-degree gaps: `rotation.z = -world.boss.angle`; show when `boss.phase === 1` |
| core | `part-shell-s2` | stage 2: the petals parted 9 units: `rotation.z = -world.boss.angle`; show when `boss.phase === 2` |
| core | `part-shell-s3` | stage 3: the petals parted 18 units: `rotation.z = -world.boss.angle`; show when `boss.phase === 3` |
| core | `part-outer-shell` | stage 3: three titanium keepers behind B's outer ring (r 140 to 194), clear of its gap: `rotation.z = -world.boss.data.angle2`; show when `boss.phase === 3` |

## Headroom layers (ART.md 12a)

One plate per world and per boss arena, portrait 1024x1536, one painted hand (Ember made first,
the rest edited from it). The plate is the upper back wall above the bricks: anchor its top edge
to the top of the visible kiln and let it run down behind the field. The grade falls off with
height, so the play area stays quiet: mean luminance (sRGB) peaks at 0.13 to 0.33 between 10% and
40% of the height (the Stoker plate stays at 0.06; the Ember plate, refined by R for ART 15.4 R9
with `tools/art/refine_plate.py`, is darker: 0.086 to 0.116 between 10% and 30%, near-black
below 45%), drops to 0.04 to 0.09 at 50 to 60%, and is 0.01 to 0.03 from 60% down. Structure is not cut off at 40%: ribs and rings continue at low
contrast to about 60% (the Stoker's iris ring and the Core's lower rings reach 50 to 60%), so
place the plate by this falloff, not by a hard line. Its left and right edges are eased toward dark: on desktop extend the gutters with the
world base `#0F0D0C` or mirror the outer 10%.

Grade already applied: luminance soft-capped at 0.30 outside emitters and 0.85 on emitters (sRGB
values), so with exposure 1.1 the plate stays under the 0.9 bloom threshold unless C pushes it.

| Plate | Layers (back to front) | Moving part and pivot (plate pixels, 1024x1536) |
|---|---|---|
| ember | `ember.webp` + `ember_glow.png` | none; the crown seam is the only emitter: rows .22 to .27, columns .16 to .85, heat-low at its ends to heat-high's hue at the crown, core about 0.44 linear; ribs and glass fade from row .30 to .46 |
| blaze | `blaze.webp` + `blaze_glow.png` | none; the conduits are the emitters |
| whiteheat | `whiteheat.webp` + `whiteheat_glow.png` | none; the louvre gaps are the emitters |
| stoker | `stoker.webp`, `stoker_mid.webp` + `stoker_glow.png` | iris bbox 207,51 to 816,610; port (hot centre) at 513,306: turn the iris a few degrees about the port, or scale it up 1 to 1.06 to "open" |
| crucible | `crucible.webp`, `crucible_mid.webp` + `crucible_glow.png` | vessel and arms bbox 26,0 to 997,818; sway about the top centre 512,0 (a degree or two) |
| core | `core.webp`, `core_mid.webp` + `core_glow.png` | rings bbox 169,96 to 853,652; sphere centre 515,435: the rings part from the sphere by moving the mid layer out and up, or fade it for "shields open" |

- Far layer: where a mid layer exists, its footprint is already filled from the surroundings, so
  the mid can shift (parallax), turn or fade without showing the structure twice.
- Mid layer: straight alpha, colour taken from the same graded final, so composited at rest it
  matches the far layer exactly.
- Glow mask: 0 = cold, 1 = emitter; multiply the plate's emissive add by it and breathe it with
  the fire number and HEAT. Lite mode: draw the far layer (plus the mid at rest), no glow pass.
- Overburn: reuse the world plates with a hotter, redder grade in the shader (no extra files).
- `img/backdrop.webp` stays as the plain plate for the lower kiln wall and the desktop gutters.

## Status words
`placeholder` = right size and format, stand-in look. `final` = matches ART.md, listed in
`ARTKIT.READY` with its date.
