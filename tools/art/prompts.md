# Kiln art kit: image prompt log (gpt-image-2)

Drafts are saved in `assets/generated/` (gitignored). Every image was viewed and critiqued before use.
Count and quality per image also in the F status file.

## Drop glyphs (2026-10-21)

1. `glyph-fire` (generate, low, 1024): monoline flame, white on black, "about 70 px" stroke.
   Verdict: clean, but the stroke came out about 35 px; inner tongue nearly touches the outline. Rejected.
2. `glyph-fire-bold` (generate, low, 1024): same, stroke "one twelfth of the canvas width", "wide open
   black space between every pair of lines". Verdict: passed; the style reference for the other eleven.

Prompt (2), kept as the house glyph prompt:
> A single flat line pictogram of a flame, centred on a square canvas. Pure white (#FFFFFF) line on a
> flat pure black (#000000) background. Heavy monoline: one uniform, very bold stroke weight everywhere
> (one twelfth of the canvas width), like a bold outlined icon drawn on a 24 pixel grid with 2 pixel
> lines. Round line caps and round joins. Smooth, confident vector curves, like a precise line icon from
> a premium car dashboard. Outline only: no fills, no solid shapes, no glow, no blur, no gradient, no
> shading, no texture, no 3D, no shadow. [subject]. Keep wide open black space between every pair of
> lines. The drawing fills the central 78 percent of the canvas. Nothing else in the image.

3 to 14. `edit_image` (low, 1024) with `glyph-fire-bold` as the only input:
> Same medium, same hand, same day. The attached flame pictogram is the style reference only: keep its
> exact white monoline, the same bold stroke weight, the same round caps and round joins, the same flat
> pure black background and the same even margin. Remove the flame completely and draw a different
> pictogram in its place: [SUBJECT]. Outline only, no fills, no glow, no gradient, no shading, no text,
> nothing else in the image.

Subjects: WIDEN double-headed arrow; SLOW gauge arc with a needle toward the low end; MULTI three rings
in a triangle; LASER two vertical lines above a short bar; CATCH a ring resting in a U cradle;
THROUGH an arrow through a gap in a wall line; LIFE plus sign above a short bar; SHRINK two arrows
pointing inward; FAST two right chevrons; FOG three wavy lines; MEGA a large ring with a small
concentric ring.

Verdicts: all passed except LIFE (first try drew the plus and bar as outlined solid shapes, a different
hand). LIFE redone with "every element is a single stroke of the same weight, never an outlined shape";
passed. That line was added to the last four prompts.

Post (tools/art/glyphs.py): luminance threshold at 0.5, fit the longer side into the centre 200 px of
the 256 cell (round-ish glyphs 190), fog stretched 1.5x vertically so its waves stay apart at 24 px,
every stroke normalised to 84 px at 1024 (21 px at 256, 2 px at 24 px) by disk dilation or erosion,
4x box downsample for the alpha edge. RGB white, alpha = luminance.

46. `glyph-thru2` (edit, low, 1024, 2026-10-22), after review: the first THRU (a continuous wall line
    crossed by an arrow) read as a plus sign at 16 px, next to LIFE's plus-minus. Same edit prompt with
    the subject: "a short upright wall made of two separate vertical line segments standing a little
    left of centre, one segment in the upper part and one in the lower part, with a wide empty gap
    between them at middle height. A horizontal arrow passes straight through that gap from left to
    right: its tail starts left of the wall and its arrowhead sits well beyond the wall on the right.
    The arrow never touches the wall: clear black space of at least two stroke widths between the
    arrow shaft and each wall segment. Every element is a single stroke of the same weight, never an
    outlined shape." Verdict: passed (one hand with the rest). The model's gap (72 px) closed to under
    1 px at 24 px once strokes were normalised, so tools/art/glyphs.py moves the two wall segments
    80 px apart (SPLIT) before fitting: the gap reads at 24 and 16 px.

## Textures, plates, cards (2026-10-21)

15. `tex-obsidian` (generate, low, 1024): "Seamless tileable texture ... top-down orthographic view ...
    matte black bead-blasted ceramic, like the body of a high-end black ceramic watch case seen under a
    microscope. Very fine, uniform, even grain, a few tiny scattered pits ... Extremely low contrast ...
    Flat, even, shadowless lighting. No shadows, no highlights, no reflections ... repeats seamlessly on
    all four edges." Verdict: passed, seams 0.94 / 0.91. Shipped from the draft (tools/art/textures.py):
    a fine grain gains nothing from high quality.
16. `img-backdrop` (generate, low, 2048x1024): far back wall of a modern industrial kiln, vertical bays
    and ribs, warm glow on the lower fifth, near black above, repeats sideways. Verdict: rejected, the
    warmth came out as rust and corrosion (old, not modern).
17. `img-hearth` (generate, low, 1536): the mouth of a modern industrial kiln seen straight on, steel
    grate lit from below, no flames visible, upper two thirds near black for a title. Verdict: passed.
18. `img-backdrop-clean` (edit of 16, low): "Same image, same composition ... remove all rust and orange
    corrosion stains ... the warmth at the bottom is light, not stain". Verdict: passed; shipped from the
    draft (smooth gradients, nothing for high quality to add). Cut to 5 whole rib bays where the cut
    columns match best (tools/art/plates.py): edge difference 2 levels of 255, invisible.
19. `card-ember` (generate, low, 1536x864): macro photograph of a wall of bevelled smoked-glass cells,
    dark ceramic cores glowing faint deep orange inside, heat inside the glass, low key. Verdict: passed;
    the style reference for the other cards.
20 to 22. `card-blaze`, `card-whiteheat`, `card-overburn` (edit of 19, low): "Same medium, same hand,
    same day: the same macro photograph setup, same camera angle, same lens ..." with the heat raised:
    molten orange with two titanium plates; white-hot cores among titanium and matte black slabs; every
    core molten with cracks of light. Verdicts: all passed (Overburn's X-shaped cracks are a little
    regular, accepted). Shipped from the drafts at 1024x576: crisp after downscale.
23. `img-hearth-final` (edit of 17, HIGH): "Same photograph, same composition ... refine only: crisper,
    precisely machined steel edges, cleaner grate bars ... replace the small block at the bottom centre
    with a continuous plain dark steel sill". Verdict: passed but the upper steel came out three times
    brighter (mean 44 vs 15); graded back down to the warm world base in tools/art/plates.py.

## Headroom plates (ART.md 12a, LEAD request 18:55; 2026-10-21)

24. `headroom-ember` (generate, low, 1024x1536): "Cinematic matte painting, portrait format. Inside a
    vast modern kiln, looking up at the upper back wall: the firing chamber crown. A vaulted ceiling of
    smoked refractory glass panels held by brushed titanium ribs that converge upward ... one long, thin
    seam of orange heat ... All the detail sits in the top 45 percent ... Below that the wall falls off
    smoothly into near-black ... left and right edges also fall off to dark." Verdict: passed as the
    style reference (panels a little tile-like, seam a little LED-like: fixed in the final).
25. `headroom-ember2` (generate, low): same with "heat leaks through one long joint". Verdict: rejected,
    the seam became a bright vertical line through the play area.
26 to 30. edits of 24 (low), each "Same medium, same hand, same day: the same cinematic matte painting
    style, the same camera looking up at the upper back wall of the kiln, the same warm-charcoal darks
    and brushed titanium, the same falloff ... New subject: [..]": the heat-exchanger hall (glass
    conduits of molten light), the reactor heart (white heat behind slatted titanium shields), the
    Stoker's furnace iris with one orange port, the Crucible hanging on titanium arms with molten glow
    over its rim, the Core's sphere of white heat inside three titanium shield rings. All passed.
31 to 36. HIGH finals, edits of 24 and 26 to 30: "Same painting, same composition, same camera ...
    Refine only: [panels are dark smoked glass, not tiles; machined titanium, no rivets or rust; the
    seam is heat leaking through a glass joint, never a neon tube; the crucible a precise vessel, not a
    cooking pot; the sphere softer, white-hot only at its centre]". All passed.
37 to 39. mid layers (edits of the finals, low): "Same image, same framing, same exact position, size
    and perspective of every element. Keep ONLY [the iris / the crucible and its arms / the three shield
    rings] ... everything else replaced by one flat, uniform, pure magenta colour (#FF00FF)". All passed;
    aligned with the finals within a few pixels. Only their alpha is used (tools/art/headroom.py).

## Boss concepts and meshes (2026-10-21)

40 to 42. `boss-stoker-concept`, `boss-crucible-concept`, `boss-core-concept` (generate, low, 1024):
    straight-on front elevations on flat black, machined titanium plates and matte black over a heat
    core, built around B's brick layouts (the Stoker's 10-wide face, the Crucible's plate ring on a
    cradle, the Core's two plate rings in an octagonal frame). Reference only, never shipped.
    Verdicts: all passed. Taken into the meshes: the Stoker's cowl, flue stacks, cheek plates, glowing
    eye slots, grate across the mouth and hinge bar; the Crucible's yoke and two arms, concentric
    rings and cross over a red-orange glow; the Core's octagon frame and diagonal braces.
Meshes: `tools/art/boss_<id>.py` through `bosslib.py`, Blender headless only (`Blender -b --python
    tools/art/boss_<id>.py`). First check in the game (headless Chrome, levels 10, 20, 30): a flat
    `core` emissive behind the W cells outshone the weak point itself, so the glow behind became
    `ember` (#FF7A1A x 0.28) with dark grates in front of it; the weak point is again the hottest
    thing on every boss.

## App icons (2026-10-21)

43. `icon-iflame` (generate, low, 1024): "Macro photograph, perfectly straight-on ... A single tall,
    narrow, vertical slot cut cleanly through a thick plate of matte black ceramic ... four times
    taller than it is wide ... Inside the slot burns live fire ... white-hot at the base ... bright
    orange flame tongues ... Everywhere outside the slot the black plate is completely flat and
    uniform (#07080A) ... No text, no logo marks, no border, no rounded tile". Verdict: rejected, the
    slot came out 1:7 (2 px wide at 29 px).
44. `icon-iflame-wide` (generate, low, 1024): the same with "WIDE and bold: 170 pixels wide and 650
    pixels tall ... shaped like the capital letter I of a heavy geometric sans-serif". Verdict:
    passed (1:4.9, rich fire, clean void).
45. `icon-iflame-final` (edit of 44, HIGH): "Same photograph, same composition ... Refine only the
    fire inside the slot: crisper, more defined flame tongues ... white-hot base ... saturated orange
    (#FF7A1A) at the top ... Nothing outside the slot changes". Verdict: passed. Only the fire inside
    the slot is used: tools/art/icons.py cuts it out and redraws the slot with exact, pixel-snapped
    geometry per size (hairline heat rim, faint warm spill, the top 10% shaded by the plate).

## Boss rebuild, ART 15.5 F1 (2026-10-22)

All three: generate, low, flat warm-black ground (#0F0D0C), "industrial design concept rendering",
cool key light from the upper left, soft cool rim light, "plain studio product photograph feel, no
environment, no props", and a strict list: no eyes or face, no glowing edges or rims of light, no
stripes, no rivets, no grilles, no text; the heat only inside an opening. Reference only.
47. `boss-stoker-cowl-concept` (1536x1024): a wide, heavy brushed-titanium cowl with sloped
    shoulders, very deep; a matte black face with ONE long narrow horizontal slot (about 8:1) cut
    deep into the body, matte walls tapering in, a thin line of deep orange heat only at its back;
    a row of titanium armour blocks as the chin; two plain dark gunmetal flue stacks set back on the
    cowl; "no eyes, no face, no round port, no iris, no grille bars". Verdict: passed (no face, the
    slot reads as a furnace slot). Taken into the mesh: cowl over the head, one slot with tapered
    matte walls and the heat at its back, chin bar, two set-back stacks.
48. `boss-crucible-lip-concept` (1024): a deep vessel whose thick brushed-titanium lip faces us,
    molten metal deep inside; a ring of TWELVE thick bevelled titanium plates round it with one wide
    gap; a dark gunmetal cradle (two hangers from pivots, a bail arc under the ring). Verdict:
    passed. Taken into the mesh as drawn (12 plates, lip, bowl, bail, pivots, hangers).
49. `boss-core-petals-concept` (1024): a sphere of dark crackled crust with glowing veins behind
    three domed brushed-titanium petals like a three-bladed aperture, three narrow gaps of about 12
    degrees, three gunmetal struts at 120 degrees; "no concentric rings". Verdict: passed. Taken
    into the mesh: domed petals with angular 12-degree gaps, the sphere behind (C's crackle core),
    three struts.
