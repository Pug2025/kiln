// Kiln: the ball, the paddle and the pickups (OWNER: C). Balls (solid core and dark rim), the paddle in
// all three field modes (bar, vertical bar, arc) with heat line, end caps, perfect-hit flare,
// Catch line and Afterimage ghosts, ember pickups, and drops with their lit glyphs.
// All pools are instanced and written in place every frame; nothing allocates.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD, BALL, EMBERS, DROPS, RING, PADDLE, DROP, DROP_FAMILY } from '../core/constants.js';
import { DETAIL, dropRotation } from '../core/readability.js';
import { LOOK } from './look.js';
import { PAL, glassMaterial, createCoreState } from './materials.js';
import { withOutput } from './shaders.js';
import { LASER_MOUNT, laserMountsActive, laserMountPose, laserMuzzleFlash } from './laser-mounts.js';
import { createBallStreaks } from './trail.js';

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
function proceduralDropAtlas(tight = false) {
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
  let source = c;
  if (tight) {
    const phone = document.createElement('canvas'); phone.width = c.width; phone.height = c.height;
    const pg = phone.getContext('2d'); pg.fillStyle = '#000'; pg.fillRect(0, 0, phone.width, phone.height);
    for (let k = 0; k < 12; k++) {
      const ox = (k % 4) * cs, oy = Math.floor(k / 4) * cs;
      const pixels = g.getImageData(ox, oy, cs, cs).data;
      let x0 = cs, y0 = cs, x1 = 0, y1 = 0;
      for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) if (pixels[(y * cs + x) * 4] > 64) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, fit = (cs - 12) / Math.max(w, h);
      pg.drawImage(c, ox + x0, oy + y0, w, h, ox + (cs - w * fit) / 2, oy + (cs - h * fit) / 2, w * fit, h * fit);
    }
    source = phone;
  }
  const t = new THREE.CanvasTexture(source);
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
  // A solid heat-high sphere stays visible through glass and Fog without adding HDR light.
  // Quiet view-space shading gives it volume while its brightest point stays heat-high.
  const ballMat = new THREE.ShaderMaterial({
    uniforms: { uBallColor: { value: PAL.heatHi.clone().multiplyScalar(LOOK.BALL_GAIN) } },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec3 vBallNormal;
      void main(){
        vBallNormal = normalMatrix * mat3(instanceMatrix) * normal;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: withOutput(`precision highp float; varying vec3 vBallNormal; uniform vec3 uBallColor;
      void main(){
        float light = max(0.0, dot(normalize(vBallNormal), normalize(vec3(-0.35, 0.5, 1.0))));
        gl_FragColor = vec4(uBallColor * (0.68 + 0.32 * light), 1.0);
      }`),
  });
  const balls = new THREE.InstancedMesh(ballGeo, ballMat, BALL.MAX);
  balls.name = 'ball-cores';
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.frustumCulled = false;
  balls.count = 0;
  balls.renderOrder = 21;
  // Reuse the old halo pool for a thin dark silhouette, not a glow texture. Offsets are in
  // view space, so the disk faces the actual camera even during lean, tilt and roll.
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uOutlineColor: { value: new THREE.Color(0x12100e) }, uOpacity: { value: LOOK.BALL_HALO_ALPHA } },
    extensions: { derivatives: true },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vOutlineUv;
      void main(){
        vOutlineUv = uv;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        centre.xy += position.xy * size;
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vOutlineUv; uniform vec3 uOutlineColor; uniform float uOpacity;
      void main(){
        float radius = length(vOutlineUv - 0.5) * 2.0;
        float aa = max(fwidth(radius), 0.001);
        float alpha = (1.0 - smoothstep(1.0 - aa, 1.0, radius)) * uOpacity;
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(uOutlineColor, alpha);
      }`),
  });
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, BALL.MAX);
  halos.name = 'ball-outlines';
  halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  halos.frustumCulled = false;
  halos.count = 0;
  halos.renderOrder = 20;
  const ballLight = new THREE.PointLight(PAL.heatHi, 0, LOOK.BALL_LIGHT_DIST, 2);
  root.add(balls, halos);
  // Keep the diagnostic handle, but do not compile or shade a light configured to emit nothing.
  if (LOOK.BALL_LIGHT > 0) root.add(ballLight);
  const ballStreaks = createBallStreaks(root);

  // ---------------------------------------------------------------- paddle
  const pad = new THREE.Group();
  pad.name = 'paddle';
  root.add(pad);
  const bladeGeo = new RoundedBoxGeometry(PADDLE.W, PADDLE.H, LOOK.PADDLE_DEPTH, 3, LOOK.PADDLE_RADIUS);
  const arcGeo = new THREE.BoxGeometry(1, PADDLE.H, LOOK.PADDLE_DEPTH, 64, 1, 1);
  const arcThinGeo = new THREE.BoxGeometry(1, 1, 1, 64, 1, 1);

  const flareProps = () => ({ color: PAL.heatHi.clone(), transparent: true, opacity: 0, depthWrite: false });
  const catchProps = () => ({ color: PAL.cold.clone().multiplyScalar(0.9), transparent: true, opacity: 0.9, depthWrite: false });

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
  // Warm brushed titanium with a bounded neutral fill keeps the bevel solid. The fill never
  // becomes a cool luminous bar; local post protection supplies separation from the fire.
  const padTitanium = M.titanium.clone();
  padTitanium.color.set(0xa69a88);
  padTitanium.envMapIntensity = 1.4;
  padTitanium.roughness = 0.38;
  padTitanium.emissive = new THREE.Color(LOOK.PADDLE_SELF_LIGHT);
  padTitanium.emissiveIntensity = 1;
  // Bottom vertices stay below field y=0 even at Forge Wide + maximum lean. Keep the
  // inherited plane on the legacy left/ring materials, where endpoint lean can need it.
  const bottomTitanium = padTitanium.clone();
  bottomTitanium.clippingPlanes = null;

  // bar (bottom and left modes)
  const blade = new THREE.Mesh(bladeGeo, bottomTitanium);
  blade.name = 'paddle-blade';
  const topGlass = new THREE.Mesh(new RoundedBoxGeometry(PADDLE.W - 1, 6, LOOK.PADDLE_DEPTH + 0.8, 2, 2.5), M.paddleGlass);
  topGlass.position.y = H2 - 2.6;
  topGlass.renderOrder = 6;
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  const line = new THREE.Mesh(edgeColors(new THREE.BoxGeometry(1, 1.2, 1.4, 24, 1, 1)), lineMat);
  line.name = 'paddle-heat-line';
  line.position.set(0, H2 + 0.5, D2 - 1.6);
  const flareMat = new THREE.MeshBasicMaterial(flareProps());
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.2), flareMat);
  flare.name = 'paddle-perfect-line';
  flare.renderOrder = 9;
  const catchMat = new THREE.MeshBasicMaterial(catchProps());
  const catchLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catchMat);
  catchLine.name = 'paddle-catch-line';
  catchLine.renderOrder = 9;
  const bar = new THREE.Group();
  bar.add(blade, topGlass, line, flare, catchLine);
  pad.add(bar);

  // arc (ring mode): the same parts bent onto the paddle track
  const arcTitanium = bendable(padTitanium.clone(), 'ti');
  const arcBlade = new THREE.Mesh(arcGeo, arcTitanium);
  arcBlade.name = 'paddle-arc-blade';
  const arcGlass = bendable(glassMaterial({ aMin: 0.3, aMax: 0.9, color: 0x1a1e26, env: 2.6 }), 'glass');
  const arcTop = new THREE.Mesh(new THREE.BoxGeometry(1, 6, LOOK.PADDLE_DEPTH + 0.8, 64, 1, 1), arcGlass);
  arcTop.position.y = H2 - 2.6;
  arcTop.renderOrder = 6;
  const arcLineMat = bendable(new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff }), 'line');
  const arcLine = new THREE.Mesh(edgeColors(new THREE.BoxGeometry(1, 1.2, 1.4, 64, 1, 1)), arcLineMat);
  arcLine.name = 'paddle-arc-heat-line';
  arcLine.position.set(0, H2 + 0.5, D2 - 1.6);
  const arcFlareMat = bendable(new THREE.MeshBasicMaterial(flareProps()), 'flare');
  // Size the section before bending. Scaling Y afterwards would stretch the arc's entire
  // sagitta, pulling a Wide paddle's perfect-hit line away from its actual face.
  const arcFlare = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.5, 64, 1, 1), arcFlareMat);
  arcFlare.name = 'paddle-arc-perfect-line';
  arcFlare.renderOrder = 9;
  const arcCatchMat = bendable(new THREE.MeshBasicMaterial(catchProps()), 'catch');
  const arcCatch = new THREE.Mesh(arcThinGeo, arcCatchMat);
  arcCatch.name = 'paddle-arc-catch-line';
  arcCatch.renderOrder = 9;
  const arc = new THREE.Group();
  arc.add(arcBlade, arcTop, arcLine, arcFlare, arcCatch);
  pad.add(arc);

  // Laser is visible equipment, even while a served/Catch ball is held. Both narrow mounts sit
  // inside the paddle's existing width; they neither widen its silhouette along the bounce face
  // nor change its collider. Their tips are the real bolt origins, independent of cosmetic lean.
  const laserRig = new THREE.Group();
  laserRig.name = 'laser-emitters';
  root.add(laserRig);
  const laserHousingMat = M.darkMetalP.clone();
  laserHousingMat.roughness = 0.32;
  laserHousingMat.emissive = new THREE.Color(0x202730);
  laserHousingMat.emissiveIntensity = 0.8;
  const laserTipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.92, 0.78).multiplyScalar(0.95) });
  const laserFlashMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(1.8), transparent: true,
    opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const housingGeo = new RoundedBoxGeometry(LASER_MOUNT.WIDTH, LASER_MOUNT.LENGTH, 16, 2, 2);
  const collarGeo = new RoundedBoxGeometry(LASER_MOUNT.WIDTH, 6, 17, 2, 1.5);
  const tipGeo = new THREE.BoxGeometry(10, 5, 16.5);
  const laserMounts = [];
  for (let k = 0; k < 2; k++) {
    const mount = new THREE.Group();
    mount.name = `laser-emitter-${k}`;
    mount.visible = false;
    const hardware = new THREE.Group();
    hardware.name = `laser-hardware-${k}`;
    const housing = new THREE.Mesh(housingGeo, laserHousingMat);
    housing.position.set(0, -LASER_MOUNT.LENGTH / 2, 8);
    const collar = new THREE.Mesh(collarGeo, bottomTitanium);
    collar.position.set(0, -LASER_MOUNT.LENGTH + 3, 8);
    const tip = new THREE.Mesh(tipGeo, laserTipMat);
    tip.name = `laser-ready-tip-${k}`;
    tip.position.set(0, -2.5, 8.5);
    hardware.add(housing, collar, tip);
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), laserFlashMat);
    flash.name = `laser-muzzle-flash-${k}`;
    flash.position.set(0, 3, 18);
    flash.renderOrder = 9;
    flash.visible = false;
    mount.add(hardware, flash);
    laserRig.add(mount);
    laserMounts.push({ mount, hardware, collar, tip, flash });
  }
  const mountPose = { x: 0, y: 0, nx: 0, ny: 0, rotation: 0 };

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

  const padState = { flareT: -1e9, laserT: -1e9, tick: 0 };

  // ---------------------------------------------------------------- ember pickups
  const emberGeo = new THREE.DodecahedronGeometry(3.6, 0);
  emberGeo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(EMBERS.MAX_LIVE).fill(0.8), 1));
  const emberState = createCoreState(EMBERS.MAX_LIVE).setUsage(THREE.DynamicDrawUsage);
  emberGeo.setAttribute('aCoreState', emberState);
  const embers = new THREE.InstancedMesh(emberGeo, M.core, EMBERS.MAX_LIVE);
  embers.name = 'ember-pickups';
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
  // Pickups and hazards share the unclipped pool material, separate from the brick wall.
  const dropMatte = M.matteFree;
  M.dropMatte = dropMatte;
  const dropShell = new THREE.InstancedMesh(new RoundedBoxGeometry(48, 22, 14, 3, 4), M.wallGlassI, DROPS.MAX_LIVE);
  const dropCore = new THREE.InstancedMesh(new RoundedBoxGeometry(41, 15, 8, 2, 2.5), dropMatte, DROPS.MAX_LIVE);
  const megaGeo = new RoundedBoxGeometry(41, 15, 8, 2, 2.5);
  megaGeo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(DROPS.MAX_LIVE).fill(1.0), 1));
  const megaState = createCoreState(DROPS.MAX_LIVE).setUsage(THREE.DynamicDrawUsage);
  megaGeo.setAttribute('aCoreState', megaState);
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
  const phoneDropAtlas = proceduralDropAtlas(true);
  const glyphMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAtlas: { value: dropAtlas }, uPhoneAtlas: { value: phoneDropAtlas }, uSmall: { value: 0 } },
    vertexShader: `attribute float aKind; attribute vec3 aTint; varying vec2 vUv; varying vec3 vTint;
      void main(){
        float k = floor(aKind + 0.5); float c = mod(k, 4.0); float r = floor(k / 4.0);
        vUv = vec2((c + uv.x) / 4.0, 1.0 - (r + 1.0 - uv.y) / 3.0); vTint = aTint;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; varying vec3 vTint; uniform sampler2D uAtlas; uniform sampler2D uPhoneAtlas; uniform float uSmall;
      void main(){ vec4 s = uSmall > 0.5 ? texture2D(uPhoneAtlas, vUv) : texture2D(uAtlas, vUv); float m = max(s.a * max(s.r, max(s.g, s.b)), 0.0);
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
  const phoneDropBack = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 0.1, 2, 0.08), dropMatte, DROPS.MAX_LIVE);
  phoneDropBack.name = 'phone-drop-backing'; phoneDropBack.count = 0; phoneDropBack.frustumCulled = false;
  phoneDropBack.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(phoneDropBack);
  dropShell.name = 'drop-shells'; dropCore.name = 'drop-cores'; dropGlyphs.name = 'drop-glyphs';
  root.add(dropShell, dropCore, dropMega, dropGlyphs);

  let mode = 'bottom';
  let paddleMaterialsDisposed = false;
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
    // A thin solid edge can warm with a catch or hit, but never adds HDR light.
    const heat = Math.min(1, 0.8 + fire.st.flare * 0.12 + padState.tick * 0.16);
    const fl = Math.max(0, Math.min(1, 1 - (t - padState.flareT) / (LOOK.PERFECT_FLARE_MS / 1000)));
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
    const laserOn = laserMountsActive(world);
    const muzzle = laserMuzzleFlash(t, padState.laserT);
    laserFlashMat.opacity = muzzle;
    for (let k = 0; k < 2; k++) {
      const m = laserMounts[k];
      m.mount.visible = laserOn || muzzle > 0;
      m.hardware.visible = laserOn;
      m.tip.visible = laserOn;
      m.flash.visible = muzzle > 0;
      if (!m.mount.visible) continue;
      laserMountPose(mode, p, k === 0 ? -1 : 1, mountPose);
      m.mount.position.set(mountPose.x - HW, HH - mountPose.y, 0);
      m.mount.rotation.z = mountPose.rotation;
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
      const hs = sealed ? 0 : LOOK.BALL_HALO * (b.r / BALL.R);
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
      const size = world.readability?.small ? world.readability.emberR / 3.6 : 1;
      scl.set(size, size, size);
      m4.compose(pos, quat, scl);
      embers.setMatrixAt(n, m4);
      emberState.array[n * 2] = ((i + 1) * 0.61803398875) % 1;
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
    emberState.needsUpdate = true;
    streaks.instanceMatrix.needsUpdate = true;
  }

  function setDrops(world, alpha) {
    let n = 0, nm = 0;
    const info = world.readability;
    const small = !!info?.small, scale = info?.scale || 1;
    glyphMat.uniforms.uSmall.value = small ? 1 : 0;
    // Capsules use their actual track/radial catch footprint; the icon stays upright.
    for (let i = 0; i < world.drops.length; i++) {
      const d = world.drops[i];
      if (!d.alive) continue;
      const x = lerp(d.px, d.x, alpha), y = lerp(d.py, d.y, alpha);
      const hu = info?.dropHalfU || 24, hv = info?.dropHalfV || 11;
      const rotation = small ? dropRotation(mode, x, y) : mode === 'left' ? -Math.PI / 2 : 0;
      quat.setFromAxisAngle(zAxis, rotation);
      pos.set(x - HW, HH - y, 0);
      scl.set(hu / 24, hv / 11, 1);
      m4.compose(pos, quat, scl);
      dropShell.setMatrixAt(n, m4);
      const kind = d.kind | 0;
      if (small) scl.set((hu * 2 - 6 / scale) / 41, (hv * 2 - 4 / scale) / 15, 1);
      m4.compose(pos, quat, scl);
      if (kind === DROP.MEGA) {
        megaState.array[nm * 2] = ((i + 1) * 0.61803398875) % 1;
        dropMega.setMatrixAt(nm++, m4);
      } else dropCore.setMatrixAt(n - nm, m4);
      if (small) {
        pos.z = 7.2; scl.set(28 / scale, 28 / scale, 1);
        m4.compose(pos, qId, scl); phoneDropBack.setMatrixAt(n, m4);
      }
      pos.z = small ? 7.4 : 4.6;
      const glyphSize = small ? DETAIL.DROP_GLYPH_PX * (128 / 116) / scale / 17 : 1;
      scl.set(glyphSize, glyphSize, 1);
      m4.compose(pos, qId, scl);
      dropGlyphs.setMatrixAt(n, m4);
      aKind.array[n] = kind;
      tintFor(kind, col);
      if (small) {
        if (DROP_FAMILY[kind] === 'warn') col.setRGB(2.4, 0.16, 0.24);
        else if (DROP_FAMILY[kind] === 'cold') col.multiplyScalar(0.8);
        else col.setRGB(0.85, 0.83, 0.80);
      }
      aTint.array[n * 3] = col.r;
      aTint.array[n * 3 + 1] = col.g;
      aTint.array[n * 3 + 2] = col.b;
      n++;
    }
    phoneDropBack.count = small ? n : 0; phoneDropBack.instanceMatrix.needsUpdate = true;
    dropShell.count = n; dropGlyphs.count = n; dropMega.count = nm; dropCore.count = n - nm;
    for (let k = 0; k < dropMeshes.length; k++) dropMeshes[k].instanceMatrix.needsUpdate = true;
    aKind.needsUpdate = true; aTint.needsUpdate = true;
    megaState.needsUpdate = true;
  }

  return {
    root, pad, ballLight, padState, glyphMat,

    setWorld(world) {
      mode = world.level.mode;
      const titanium = mode === 'bottom' ? bottomTitanium : padTitanium;
      blade.material = titanium;
      for (const m of laserMounts) m.collar.material = titanium;
      ballStreaks.reset();
      balls.count = 0;
      halos.count = 0;
      ballLight.intensity = 0;
      padState.flareT = -1e9;
      padState.laserT = -1e9;
      padState.tick = 0;
    },

    perfect(t) {
      padState.flareT = t;
    },

    /** Only an actual emitted volley flashes the two real muzzles. */
    laserFired(t) {
      padState.laserT = t;
    },

    /** An ember catch ticks the paddle heat line. */
    catchTick() {
      padState.tick = Math.min(0.5, padState.tick + 0.12);
    },

    setDropAtlas(tex) {
      glyphMat.uniforms.uAtlas.value = tex;
      dropAtlas.dispose();
    },

    /** Compile alone does not upload samplers on an empty pool. Prepare them before play. */
    warmTextures(gl) {
      gl.initTexture(glyphMat.uniforms.uAtlas.value);
      gl.initTexture(phoneDropAtlas);
      if (dropMatte.map) gl.initTexture(dropMatte.map);
      if (dropMatte.normalMap) gl.initTexture(dropMatte.normalMap);
    },

    /** Expose both plain variants only during synchronous preparation, never across an await. */
    withWarmPaddleMaterials(operation, legacyBlade = false) {
      const previousBlade = blade.material;
      const previous0 = laserMounts[0].collar.material;
      const previous1 = laserMounts[1].collar.material;
      blade.material = legacyBlade ? padTitanium : bottomTitanium;
      laserMounts[0].collar.material = legacyBlade ? bottomTitanium : padTitanium;
      laserMounts[1].collar.material = blade.material;
      try {
        return operation();
      } finally {
        blade.material = previousBlade;
        laserMounts[0].collar.material = previous0;
        laserMounts[1].collar.material = previous1;
      }
    },

    /** Reflect actual compiled maps again after quality, kit or native-context changes. */
    warmPrograms(gl) {
      const warmed = new Set();
      for (const material of [padTitanium, bottomTitanium, arcTitanium,
        ...dropMeshes.map(mesh => mesh.material), phoneDropBack.material]) {
        const programs = gl.properties.get(material).programs;
        if (!programs) continue;
        for (const program of programs.values()) {
          if (warmed.has(program)) continue;
          program.getUniforms();
          program.getAttributes();
          warmed.add(program);
        }
      }
      ballStreaks.warmPrograms(gl);
    },

    /** Inactive variants are absent from scene traversal but still own program references. */
    dispose() {
      if (paddleMaterialsDisposed) return;
      paddleMaterialsDisposed = true;
      bottomTitanium.dispose();
      padTitanium.dispose();
      arcTitanium.dispose();
    },

    frame(world, alpha, t, fire, dt) {
      setPaddle(world, t, fire, dt);
      setBalls(world, alpha, t);
      ballStreaks.frame(world, alpha);
      setEmbers(world, alpha);
      setDrops(world, alpha);
    },
  };
}
