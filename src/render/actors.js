// Kiln: the ball, the paddle and the pickups (OWNER: C). Balls (core, halo, light), the paddle in
// all three field modes (bar, vertical bar, arc) with heat line, end caps, perfect-hit flare,
// Catch line and Afterimage ghosts, ember pickups, and drops with their lit glyphs.
// All pools are instanced and written in place every frame; nothing allocates.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD, BALL, EMBERS, DROPS, RING, PADDLE, DROP, DROP_FAMILY } from '../core/constants.js';
import { LOOK } from './look.js';
import { PAL, glassMaterial } from './materials.js';
import { withOutput } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;

// ---------------------------------------------------------------- bending (ring-mode paddle)
/**
 * Patch a material so a box laid along x (x in -0.5..0.5) bends onto an arc of radius uR and
 * length uLen, curving toward local +y (the ring centre). uBend 0 leaves it straight.
 */
export function bendable(material, key) {
  const u = { uR: { value: RING.R_PADDLE }, uLen: { value: 100 }, uBend: { value: 1 } };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uR, uLen, uBend;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float th = position.x * uLen / uR * uBend; float c = cos(th), s = sin(th);
          objectNormal.xy = vec2(c * objectNormal.x - s * objectNormal.y, s * objectNormal.x + c * objectNormal.y); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float sx = transformed.x * uLen; float th = sx / uR * uBend;
          if (uBend > 0.0) { float rho = uR - transformed.y; transformed.xy = vec2(rho * sin(th), uR - rho * cos(th)); }
          else transformed.x = sx; }`);
  };
  const base = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => `${base}|bend-${key}`;
  material.userData.bend = u;
  return material;
}

/** Procedural drop glyph atlas (4 x 3 cells of 128, DROP_NAMES order) until F's atlas loads. */
function proceduralDropAtlas() {
  const cs = 128;
  const c = document.createElement('canvas');
  c.width = cs * 4;
  c.height = cs * 3;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const draw = [
    (x, y) => { g.moveTo(x - 36, y); g.lineTo(x + 36, y); g.moveTo(x - 22, y - 14); g.lineTo(x - 36, y); g.lineTo(x - 22, y + 14); g.moveTo(x + 22, y - 14); g.lineTo(x + 36, y); g.lineTo(x + 22, y + 14); },
    (x, y) => { g.arc(x, y, 30, 0, Math.PI * 2); g.moveTo(x, y); g.lineTo(x, y - 18); g.moveTo(x, y); g.lineTo(x + 14, y + 8); },
    (x, y) => { for (const [dx, dy] of [[-18, 10], [18, 10], [0, -18]]) { g.moveTo(x + dx + 10, y + dy); g.arc(x + dx, y + dy, 10, 0, Math.PI * 2); } },
    (x, y) => { g.moveTo(x, y + 32); g.quadraticCurveTo(x - 30, y + 10, x - 6, y - 32); g.quadraticCurveTo(x + 2, y - 4, x + 14, y - 12); g.quadraticCurveTo(x + 30, y + 14, x, y + 32); },
    (x, y) => { g.moveTo(x - 14, y + 30); g.lineTo(x - 14, y - 30); g.moveTo(x + 14, y + 30); g.lineTo(x + 14, y - 30); },
    (x, y) => { g.moveTo(x - 32, y - 10); g.lineTo(x - 32, y + 14); g.lineTo(x + 32, y + 14); g.lineTo(x + 32, y - 10); g.moveTo(x + 10, y - 2); g.arc(x, y - 2, 10, 0, Math.PI * 2); },
    (x, y) => { g.moveTo(x - 32, y); g.lineTo(x + 32, y); g.moveTo(x + 16, y - 16); g.lineTo(x + 32, y); g.lineTo(x + 16, y + 16); g.moveTo(x - 10, y - 24); g.lineTo(x - 10, y + 24); },
    (x, y) => { g.moveTo(x, y + 28); g.bezierCurveTo(x - 44, y - 2, x - 18, y - 36, x, y - 14); g.bezierCurveTo(x + 18, y - 36, x + 44, y - 2, x, y + 28); },
    (x, y) => { g.moveTo(x - 36, y); g.lineTo(x - 14, y); g.moveTo(x + 36, y); g.lineTo(x + 14, y); g.moveTo(x - 24, y - 12); g.lineTo(x - 12, y); g.lineTo(x - 24, y + 12); g.moveTo(x + 24, y - 12); g.lineTo(x + 12, y); g.lineTo(x + 24, y + 12); },
    (x, y) => { for (const dx of [-16, 8]) { g.moveTo(x + dx, y - 22); g.lineTo(x + dx + 18, y); g.lineTo(x + dx, y + 22); } },
    (x, y) => { for (const dy of [-16, 0, 16]) { g.moveTo(x - 32, y + dy); g.bezierCurveTo(x - 12, y + dy - 10, x + 12, y + dy + 10, x + 32, y + dy); } },
    (x, y) => { g.moveTo(x + 34, y); g.arc(x, y, 34, 0, Math.PI * 2); g.moveTo(x + 14, y); g.arc(x, y, 14, 0, Math.PI * 2); },
  ];
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    draw[i]((i % 4) * cs + cs / 2, Math.floor(i / 4) * cs + cs / 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Glyph tint by role (ART 8): good white-hot, cold cyan, bad warn red, Mega white over molten. */
function tintFor(kind, out) {
  const fam = DROP_FAMILY[kind];
  if (fam === 'cold') out.copy(PAL.cold).multiplyScalar(1.15);
  else if (fam === 'warn') out.copy(PAL.warn).multiplyScalar(1.3);
  else out.setRGB(1, 0.97, 0.92).multiplyScalar(1.05);
  return out;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} M materials
 */
export function createActors(scene, M) {
  const root = new THREE.Group();
  root.name = 'actors';
  scene.add(root);

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const qId = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const col = new THREE.Color();

  // ---------------------------------------------------------------- balls
  const ballGeo = new THREE.SphereGeometry(BALL.R, 28, 20);
  const ballMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(LOOK.BALL_GAIN) });
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, BALL.MAX);
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.frustumCulled = false;
  balls.count = 0;
  balls.renderOrder = 7;
  const haloMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatHi.clone(), transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, BALL.MAX);
  halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  halos.frustumCulled = false;
  halos.count = 0;
  halos.renderOrder = 8;
  const ballLight = new THREE.PointLight(PAL.heatHi, 0, LOOK.BALL_LIGHT_DIST, 2);
  root.add(balls, halos, ballLight);

  // ---------------------------------------------------------------- paddle
  const pad = new THREE.Group();
  root.add(pad);
  const bladeGeo = new RoundedBoxGeometry(PADDLE.W, PADDLE.H, LOOK.PADDLE_DEPTH, 3, LOOK.PADDLE_RADIUS);
  const arcGeo = new THREE.BoxGeometry(1, PADDLE.H, LOOK.PADDLE_DEPTH, 64, 1, 1);
  const arcThinGeo = new THREE.BoxGeometry(1, 1, 1, 64, 1, 1);

  const flareProps = () => ({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(2.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const catchProps = () => ({ color: PAL.cold.clone().multiplyScalar(1.1), transparent: true, opacity: 0.9, depthWrite: false });

  // ART 12b: the paddle is the most legible object at the bottom of the screen. A bevelled
  // brushed-titanium bar with a smoked-glass top and a thin heat-core edge line on its top face
  // (#FFD9A8 at the centre to #FF7A1A at the ends); no orange glow around it.
  const H2 = PADDLE.H / 2, D2 = LOOK.PADDLE_DEPTH / 2;
  const edgeColors = (geo) => {
    const p = geo.attributes.position;
    const c = new Float32Array(p.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const k = Math.min(1, Math.abs(p.getX(i)) * 2);
      tmp.copy(PAL.heatHi).lerp(PAL.heatLo, Math.pow(k, 1.4));
      c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  };
  // a brighter titanium than the bricks' (more environment, a faint cool self-light) so the paddle
  // keeps 3:1 against its surroundings even while the fire flares (ART 12b)
  const padTitanium = M.titanium.clone();
  padTitanium.envMapIntensity = 3.4;
  padTitanium.roughness = 0.3;
  // self-light 0x4e5258 (was 0x2a2e35; G's legibility run 2026-10-22: the paddle's mean 0.12 to 0.15
  // needed 0.19 to 0.25 against a ring lit by the fire under the lip at x5 and in flares)
  padTitanium.emissive = new THREE.Color(0x4e5258);
  padTitanium.emissiveIntensity = 1;

  // bar (bottom and left modes)
  const blade = new THREE.Mesh(bladeGeo, padTitanium);
  const topGlass = new THREE.Mesh(new RoundedBoxGeometry(PADDLE.W - 1, 6, LOOK.PADDLE_DEPTH + 0.8, 2, 2.5), M.paddleGlass);
  topGlass.position.y = H2 - 2.6;
  topGlass.renderOrder = 6;
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  const line = new THREE.Mesh(edgeColors(new THREE.BoxGeometry(1, 1.2, 1.4, 24, 1, 1)), lineMat);
  line.position.set(0, H2 + 0.5, D2 - 1.6);
  const flareMat = new THREE.MeshBasicMaterial(flareProps());
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.2), flareMat);
  flare.renderOrder = 9;
  const catchMat = new THREE.MeshBasicMaterial(catchProps());
  const catchLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catchMat);
  catchLine.renderOrder = 9;
  const bar = new THREE.Group();
  bar.add(blade, topGlass, line, flare, catchLine);
  pad.add(bar);

  // arc (ring mode): the same parts bent onto the paddle track
  const arcTitanium = bendable(padTitanium.clone(), 'ti');
  const arcBlade = new THREE.Mesh(arcGeo, arcTitanium);
  const arcGlass = bendable(glassMaterial({ aMin: 0.3, aMax: 0.9, color: 0x1a1e26, env: 2.6 }), 'glass');
  const arcTop = new THREE.Mesh(new THREE.BoxGeometry(1, 6, LOOK.PADDLE_DEPTH + 0.8, 64, 1, 1), arcGlass);
  arcTop.position.y = H2 - 2.6;
  arcTop.renderOrder = 6;
  const arcLineMat = bendable(new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }), 'line');
  const arcLine = new THREE.Mesh(edgeColors(new THREE.BoxGeometry(1, 1.2, 1.4, 64, 1, 1)), arcLineMat);
  arcLine.position.set(0, H2 + 0.5, D2 - 1.6);
  const arcFlareMat = bendable(new THREE.MeshBasicMaterial(flareProps()), 'flare');
  const arcFlare = new THREE.Mesh(arcThinGeo, arcFlareMat);
  arcFlare.scale.set(1, 2.2, 0.5);
  arcFlare.renderOrder = 9;
  const arcCatchMat = bendable(new THREE.MeshBasicMaterial(catchProps()), 'catch');
  const arcCatch = new THREE.Mesh(arcThinGeo, arcCatchMat);
  arcCatch.renderOrder = 9;
  const arc = new THREE.Group();
  arc.add(arcBlade, arcTop, arcLine, arcFlare, arcCatch);
  pad.add(arc);

  // Afterimage ghosts (ART 8: 30% and 15% of the paddle glass alpha, trailing 80 / 160 ms)
  const ghosts = [0.3, 0.15].map((f, k) => {
    const gm = glassMaterial({ aMin: 0.3, aMax: 0.9, color: 0x1a1e26, env: 2.6 });
    gm.userData.u.uFade.value = f;
    const gArc = bendable(glassMaterial({ aMin: 0.3, aMax: 0.9, color: 0x1a1e26, env: 2.6 }), `ghost${k}`);
    gArc.userData.u.uFade.value = f;
    const g = new THREE.Group();
    const gb = new THREE.Mesh(bladeGeo, gm);
    const ga = new THREE.Mesh(arcGeo, gArc);
    gb.renderOrder = 5;
    ga.renderOrder = 5;
    g.add(gb, ga);
    g.visible = false;
    root.add(g);
    return { g, gb, ga, gArc };
  });

  const padState = { flareT: -1e9, tick: 0 };

  // ---------------------------------------------------------------- ember pickups
  const emberGeo = new THREE.DodecahedronGeometry(3.6, 0);
  emberGeo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(EMBERS.MAX_LIVE).fill(0.8), 1));
  const embers = new THREE.InstancedMesh(emberGeo, M.core, EMBERS.MAX_LIVE);
  embers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  embers.frustumCulled = false;
  embers.count = 0;
  const streakMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatLo.clone().multiplyScalar(0.8), transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), streakMat, EMBERS.MAX_LIVE);
  streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  streaks.frustumCulled = false;
  streaks.count = 0;
  root.add(embers, streaks);

  // ---------------------------------------------------------------- drops (48 x 22 dark cells, lit glyph)
  const dropShell = new THREE.InstancedMesh(new RoundedBoxGeometry(48, 22, 14, 3, 4), M.wallGlassI, DROPS.MAX_LIVE);
  const dropCore = new THREE.InstancedMesh(new RoundedBoxGeometry(41, 15, 8, 2, 2.5), M.matte, DROPS.MAX_LIVE);
  const megaGeo = new RoundedBoxGeometry(41, 15, 8, 2, 2.5);
  megaGeo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(DROPS.MAX_LIVE).fill(1.0), 1));
  const dropMega = new THREE.InstancedMesh(megaGeo, M.core, DROPS.MAX_LIVE);
  const glyphGeo = new THREE.PlaneGeometry(17, 17);
  const aKind = new THREE.InstancedBufferAttribute(new Float32Array(DROPS.MAX_LIVE), 1);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(DROPS.MAX_LIVE * 3), 3);
  aKind.setUsage(THREE.DynamicDrawUsage);
  aTint.setUsage(THREE.DynamicDrawUsage);
  glyphGeo.setAttribute('aKind', aKind);
  glyphGeo.setAttribute('aTint', aTint);
  const dropAtlas = proceduralDropAtlas();
  M.tex.drops = dropAtlas;
  const glyphMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAtlas: { value: dropAtlas } },
    vertexShader: `attribute float aKind; attribute vec3 aTint; varying vec2 vUv; varying vec3 vTint;
      void main(){
        float k = floor(aKind + 0.5); float c = mod(k, 4.0); float r = floor(k / 4.0);
        vUv = vec2((c + uv.x) / 4.0, 1.0 - (r + 1.0 - uv.y) / 3.0); vTint = aTint;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; varying vec3 vTint; uniform sampler2D uAtlas;
      void main(){ vec4 s = texture2D(uAtlas, vUv); float m = max(s.a * max(s.r, max(s.g, s.b)), 0.0);
        m = smoothstep(0.15, 0.6, m); if (m < 0.01) discard; gl_FragColor = vec4(vTint * m, m); }`),
  });
  const dropGlyphs = new THREE.InstancedMesh(glyphGeo, glyphMat, DROPS.MAX_LIVE);
  const dropMeshes = [dropShell, dropCore, dropMega, dropGlyphs];
  for (const m of dropMeshes) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
  }
  dropShell.renderOrder = 5;
  dropGlyphs.renderOrder = 1;
  root.add(dropShell, dropCore, dropMega, dropGlyphs);

  let mode = 'bottom';
  const lerp = (a, b, k) => a + (b - a) * k;

  /** Position and turn a paddle group on the track for a track coordinate (x, y or angle). */
  function placeOnTrack(g, x, y, lean) {
    g.position.set(x - HW, HH - y, 0);
    if (mode === 'ring') g.rotation.z = Math.atan2(y - RING.CY, RING.CX - x) - Math.PI / 2 + lean;
    else g.rotation.z = (mode === 'left' ? -Math.PI / 2 : 0) + lean;
  }

  function setPaddle(world, t, fire, dt) {
    const p = world.paddle;
    const w = Math.max(8, p.w);
    // lean with velocity (ART 8), normalised by the base speed tier (460 u/s); a flick of the finger
    // moves the paddle at thousands of u/s, so the lean stops at 2.3 degrees (C call)
    const lean = Math.max(-0.04, Math.min(0.04, -(p.vel / 460) * LOOK.PADDLE_LEAN));
    placeOnTrack(pad, p.x, p.y, lean);
    padState.tick = Math.max(0, padState.tick - dt * 2.5);
    // edge line: rest 1.0 (just under bloom), rising with every hit, flare and ember catch so its
    // centre blooms lightly; the fire itself is dimmed around the paddle (fire.js)
    const heat = 1.0 + fire.st.flare * 0.7 + padState.tick * 1.5;
    const fl = Math.max(0, 1 - (t - padState.flareT) / (LOOK.PERFECT_FLARE_MS / 1000));
    const catchOn = !!world.effects.catchOn;
    const ring = mode === 'ring';
    bar.visible = !ring;
    arc.visible = ring;
    if (ring) {
      const span = p.span > 0 ? p.span : (RING.SPAN_DEG * Math.PI) / 180;
      const len = span * RING.R_PADDLE;
      arcTitanium.userData.bend.uLen.value = len;
      arcGlass.userData.bend.uLen.value = len - 1;
      arcLineMat.userData.bend.uLen.value = len - 10;
      arcFlareMat.userData.bend.uLen.value = len - 8;
      arcCatchMat.userData.bend.uLen.value = len - 4;
      arcLineMat.color.setScalar(heat);
      arcFlareMat.opacity = fl;
      arcFlare.position.set(0, PADDLE.H / 2 + 0.2, LOOK.PADDLE_DEPTH / 2 + 0.5);
      arcCatch.visible = catchOn;
      arcCatch.position.set(0, PADDLE.H / 2 + 1.4, 0);
    } else {
      blade.scale.set(w / PADDLE.W, p.h / PADDLE.H, 1);
      topGlass.scale.set(w / PADDLE.W, 1, 1);
      topGlass.position.y = p.h / 2 - 2.6;
      line.scale.set(Math.max(1, w - 10), 1, 1);
      line.position.y = p.h / 2 + 0.5;
      lineMat.color.setScalar(heat);
      flare.scale.set(w - 8, 1, 1);
      flare.position.set(0, p.h / 2 + 0.2, LOOK.PADDLE_DEPTH / 2 + 0.5);
      flareMat.opacity = fl;
      catchLine.visible = catchOn;
      catchLine.scale.set(w - 4, 1, 1);
      catchLine.position.set(0, p.h / 2 + 1.4, LOOK.PADDLE_DEPTH / 2 - 2);
    }
    // ghosts trail the paddle along its track
    const on = !!world.level.rules.ghosts;
    for (let k = 0; k < 2; k++) {
      const gh = ghosts[k];
      gh.g.visible = on;
      if (!on) continue;
      const v = p.ghostX ? p.ghostX[k] : 0;
      gh.gb.visible = !ring;
      gh.ga.visible = ring;
      if (ring) {
        const a = v || p.angle;
        placeOnTrack(gh.g, RING.CX + Math.cos(a) * RING.R_PADDLE, RING.CY + Math.sin(a) * RING.R_PADDLE, 0);
        gh.gArc.userData.bend.uLen.value = arcTitanium.userData.bend.uLen.value;
      } else if (mode === 'left') {
        placeOnTrack(gh.g, p.x, v || p.y, 0);
        gh.gb.scale.set(w / PADDLE.W, p.h / PADDLE.H, 1);
      } else {
        placeOnTrack(gh.g, v || p.x, p.y, 0);
        gh.gb.scale.set(w / PADDLE.W, p.h / PADDLE.H, 1);
      }
    }
  }

  function setBalls(world, alpha, t) {
    let n = 0;
    let lit = -1;
    const E = world.effects;
    // halo: Slow / Quench cool it toward cyan (40%), Fire tints it toward heat-low
    haloMat.color.copy(PAL.heatHi);
    if (E.ballSpeedScale < 0.999) haloMat.color.lerp(PAL.cold, 0.4);
    else if (E.fire) haloMat.color.lerp(PAL.heatLo, 0.6);
    for (let i = 0; i < world.balls.length; i++) {
      const b = world.balls[i];
      if (!b.alive) continue;
      const x = b.held ? b.x : lerp(b.px, b.x, alpha);
      const y = b.held ? b.y : lerp(b.py, b.y, alpha);
      const sealed = b.sealed >= 0;
      const s = (b.r / BALL.R) * (sealed ? 0.5 : 1);
      pos.set(x - HW, HH - y, 0);
      scl.set(s, s, s);
      m4.compose(pos, qId, scl);
      balls.setMatrixAt(n, m4);
      const hs = sealed ? 0 : (LOOK.BALL_HALO + 3 * Math.sin(t * 23 + i)) * (b.r / BALL.R);
      pos.z = 10;
      scl.set(hs, hs, 1);
      m4.compose(pos, qId, scl);
      halos.setMatrixAt(n, m4);
      n++;
      if (lit < 0 && !sealed) {
        lit = i;
        ballLight.position.set(x - HW, HH - y, 80);
      }
    }
    balls.count = n;
    halos.count = n;
    balls.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    ballLight.intensity = lit >= 0 ? LOOK.BALL_LIGHT : 0;
  }

  function setEmbers(world, alpha) {
    const E = world.embers;
    let n = 0;
    for (let i = 0; i < E.count; i++) {
      if (!E.alive[i]) continue;
      const x = lerp(E.px[i], E.x[i], alpha) - HW;
      const y = HH - lerp(E.py[i], E.y[i], alpha);
      quat.setFromAxisAngle(zAxis, (E.bornMs[i] * 0.01 + i) % 6.283);
      pos.set(x, y, 0);
      scl.set(1, 1, 1);
      m4.compose(pos, quat, scl);
      embers.setMatrixAt(n, m4);
      // a short streak behind the motion
      const vx = E.vx[i], vy = -E.vy[i];
      const sp = Math.hypot(vx, vy) || 1;
      quat.setFromAxisAngle(zAxis, Math.atan2(vy, vx));
      pos.set(x - (vx / sp) * 9, y - (vy / sp) * 9, -1);
      scl.set(18, 4, 1);
      m4.compose(pos, quat, scl);
      streaks.setMatrixAt(n, m4);
      n++;
    }
    embers.count = n;
    streaks.count = n;
    embers.instanceMatrix.needsUpdate = true;
    streaks.instanceMatrix.needsUpdate = true;
  }

  function setDrops(world, alpha) {
    let n = 0, nm = 0;
    // drops keep the brick slab's orientation: turned in left mode, level otherwise
    quat.setFromAxisAngle(zAxis, mode === 'left' ? -Math.PI / 2 : 0);
    for (let i = 0; i < world.drops.length; i++) {
      const d = world.drops[i];
      if (!d.alive) continue;
      pos.set(lerp(d.px, d.x, alpha) - HW, HH - lerp(d.py, d.y, alpha), 0);
      scl.set(1, 1, 1);
      m4.compose(pos, quat, scl);
      dropShell.setMatrixAt(n, m4);
      const kind = d.kind | 0;
      if (kind === DROP.MEGA) dropMega.setMatrixAt(nm++, m4);
      else dropCore.setMatrixAt(n - nm, m4);
      // glyph upright on the inner plane
      pos.z = 4.6;
      m4.compose(pos, qId, scl);
      dropGlyphs.setMatrixAt(n, m4);
      aKind.array[n] = kind;
      tintFor(kind, col);
      aTint.array[n * 3] = col.r;
      aTint.array[n * 3 + 1] = col.g;
      aTint.array[n * 3 + 2] = col.b;
      n++;
    }
    dropShell.count = n;
    dropGlyphs.count = n;
    dropMega.count = nm;
    dropCore.count = n - nm;
    for (let k = 0; k < dropMeshes.length; k++) dropMeshes[k].instanceMatrix.needsUpdate = true;
    aKind.needsUpdate = true;
    aTint.needsUpdate = true;
  }

  return {
    root, pad, ballLight, padState, glyphMat,

    setWorld(world) {
      mode = world.level.mode;
      padState.flareT = -1e9;
      padState.tick = 0;
    },

    perfect(t) {
      padState.flareT = t;
    },

    /** An ember catch ticks the paddle heat line. */
    catchTick() {
      padState.tick = Math.min(0.5, padState.tick + 0.12);
    },

    setDropAtlas(tex) {
      glyphMat.uniforms.uAtlas.value = tex;
      dropAtlas.dispose();
    },

    frame(world, alpha, t, fire, dt) {
      setPaddle(world, t, fire, dt);
      setBalls(world, alpha, t);
      setEmbers(world, alpha);
      setDrops(world, alpha);
    },
  };
}
