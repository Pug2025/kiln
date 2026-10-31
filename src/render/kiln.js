// Kiln: the world around the field (OWNER: C). Environment map, light rig, the kiln interior
// (back wall, ribs, pillars, grate, fire bed), haze planes, the light shaft, the smoked back plate
// and the arena frame (glass walls, titanium lip). Numbers: ART 7.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD, RING, HORIZONTAL } from '../core/constants.js';
import { PAL, PAL_VEC3 } from './materials.js';
import { LOOK } from './look.js';
import { PLAIN_VERT, HAZE_VERT, HAZE_FRAG, BACK_VERT, BACK_FRAG, SHAFT_FRAG, withOutput } from './shaders.js';
import { CEILING_ART, ceilingLayout, lintelPiece, ceilingContact, isCeilingHit } from './ceiling.js';
import { protectBed } from './paddle-source.js';

const FW = FIELD.W, FH = FIELD.H;
const HH_ = FIELD.H / 2;
const { GRATE_Y, GRATE_Z, GRATE_BAR, GRATE_BEARER } = LOOK;
// C2 exploration only: width / |x| / z. W > H is an audit candidate, not an accepted breakpoint.
const PILLAR_LEGACY = [70, 680, -460];
const PILLAR_LANDSCAPE = [50, 880, -700];

/** PMREM of the procedural kiln box (ART 7 "Environment"). */
export function makeEnvironment(gl) {
  const pm = new THREE.PMREMGenerator(gl);
  const s = new THREE.Scene();
  const owned = [];
  const add = (geo, col, x, y, z, rx = 0, ry = 0) => {
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    s.add(m);
    owned.push(geo, mat);
  };
  const boxGeo = new THREE.BoxGeometry(10, 10, 10);
  const boxMat = new THREE.MeshBasicMaterial({ color: 0x0a0b0e, side: THREE.BackSide });
  s.add(new THREE.Mesh(boxGeo, boxMat));
  owned.push(boxGeo, boxMat);
  const lo = PAL.heatLoRest;
  add(new THREE.PlaneGeometry(6, 2.6), lo.clone().multiplyScalar(2.4), 0, -4.9, 0.5, -Math.PI / 2);
  add(new THREE.PlaneGeometry(9, 6), lo.clone().multiplyScalar(0.35), 0, -4.9, -1, -Math.PI / 2);
  add(new THREE.PlaneGeometry(7, 0.22), new THREE.Color(0xdfe9f4).multiplyScalar(3.2), 0, 4.9, -0.5, Math.PI / 2);
  add(new THREE.PlaneGeometry(8, 3.2), new THREE.Color(0x5f6c7c).multiplyScalar(0.9), 0, 4.9, 1.0, Math.PI / 2);
  add(new THREE.PlaneGeometry(9, 2.0), new THREE.Color(0x3a4350).multiplyScalar(0.8), 0, 2.6, -4.9);
  add(new THREE.PlaneGeometry(0.4, 8), new THREE.Color(0x6d7f94).multiplyScalar(0.9), -4.9, 0.5, 0, 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(0.4, 8), new THREE.Color(0x6d7f94).multiplyScalar(0.9), 4.9, 0.5, 0, 0, -Math.PI / 2);
  for (let i = -3; i <= 3; i++) add(new THREE.PlaneGeometry(0.25, 10), new THREE.Color(0x272b31), i * 1.3, 0, -4.9);
  add(new THREE.PlaneGeometry(9, 4.5), new THREE.Color(0x3d4654).multiplyScalar(0.85), 0, -0.6, 4.9, 0, Math.PI);
  add(new THREE.PlaneGeometry(9, 0.6), new THREE.Color(0x9fb0c4).multiplyScalar(1.6), 0, 1.8, 4.9, 0, Math.PI);
  let target;
  try {
    target = pm.fromScene(s, 0.04);
  } finally {
    pm.dispose();
    for (const o of owned) o.dispose();
  }
  // The caller owns the PMREM output, including its framebuffer and depth attachment. Keep
  // the texture API used by both scenes, but release the full target when that texture retires.
  const env = target.texture;
  const release = () => {
    env.removeEventListener('dispose', release);
    target.dispose();
  };
  env.addEventListener('dispose', release);
  return env;
}

/**
 * @param {THREE.Scene} scene
 * @param {object} M materials
 */
export function createKiln(scene, M) {
  // ---- lights (ART 7) ----
  const hemi = new THREE.HemisphereLight(0x2c3440, 0x2a1408, 0.4);
  const key = new THREE.DirectionalLight(0xd6dfeb, 1.5);
  key.position.set(-260, 760, 900);
  const rim = new THREE.DirectionalLight(0x9fc4d8, 0.7);
  rim.position.set(240, 520, -700);
  const fireLight = new THREE.PointLight(PAL.heatLo, 70000, 1250, 2);
  fireLight.position.set(0, -560, 120);
  const deepLight = new THREE.PointLight(PAL.heatLo, 30000, 1100, 2);
  deepLight.position.set(0, -520, -520);
  scene.add(hemi, key, rim, fireLight, deepLight);
  // the point lights hold PAL.heatLo by reference so the last-life shift reaches them
  fireLight.color = PAL.heatLo;
  deepLight.color = PAL.heatLo;

  // ---- kiln interior (parallax layers behind the field) ----
  const backMat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 1 }, uHeatLo: { value: PAL_VEC3.heatLo }, uGraphite: { value: PAL_VEC3.graphite }, uBase: { value: PAL_VEC3.base } },
    vertexShader: BACK_VERT,
    fragmentShader: BACK_FRAG,
    fog: false,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(5200, 4000), backMat);
  back.position.z = -1050;
  scene.add(back);

  const ribGeo = new THREE.BoxGeometry(26, 1700, 50);
  const ribs = new THREE.InstancedMesh(ribGeo, M.ribs, 11 + 3);
  const m4 = new THREE.Matrix4();
  let k = 0;
  // ART 11.4 (C call, review 2026-10-22, chosen by capture): the ribs behind the field are gone. Seen
  // through the smoked plate they read as dark bars down the field even lifted toward graphite;
  // the back wall's own shaded ribs carry the kiln there. Ribs at |x| <= 480 project inside the
  // field at the desktop fit; the outer ones stay in the gutters.
  for (let x = -1200; x <= 1200; x += 240) if (Math.abs(x) > 480) ribs.setMatrixAt(k++, m4.makeTranslation(x, 120, -880));
  // (the look test's three cross beams are gone: they read as black bars across the headroom art,
  // ART 11.4 / 12a)
  ribs.count = k;
  scene.add(ribs);

  const pillarGeo = new THREE.BoxGeometry(70, 1900, 700);
  const pillars = new THREE.InstancedMesh(pillarGeo, M.pillars, 2);
  pillars.name = 'kiln-pillars';
  let pillarLayout = null;
  function layoutPillars(width, height) {
    // Exploratory eligibility only. Native art and HUD evidence must choose the final rule.
    const layout = width > height ? PILLAR_LANDSCAPE : PILLAR_LEGACY;
    if (layout === pillarLayout) return;
    const [span, x, z] = layout;
    for (let i = 0; i < 2; i++) {
      m4.makeScale(span / 70, 1, 1).setPosition(i ? x : -x, 80, z);
      pillars.setMatrixAt(i, m4);
    }
    pillars.instanceMatrix.needsUpdate = true;
    pillars.computeBoundingBox();
    pillars.computeBoundingSphere();
    if (layout === PILLAR_LANDSCAPE) M.pillars.color.copy(PAL.graphite);
    else M.pillars.color.setHex(0x101216);
    M.pillars.envMapIntensity = layout === PILLAR_LANDSCAPE ? 0.3 : 0.45;
    pillarLayout = layout;
  }
  layoutPillars(1, 1); // Exact legacy appearance before the first renderer resize.
  scene.add(pillars);

  // the grate under the kiln mouth (ART 15.3 C8): cast bars along x on two bearers, no square cells.
  // C call (review 2026-10-22): the bars sit at z -60 to -300, not -180 to -780: under every fit
  // (375x667 to 2560x1080, tests/c-fit) a bar much farther back projects into the paddle's 40-unit
  // ring. These seven land between the sill and the flame's foot, under the fire. They are
  // 780 x 6 x 9, not 1100 x 16 x 22: seen from the camera's 21 degrees thick bars covered every gap
  // and read as a bench in front of the coals, and the long ones reached into the gutters.
  const [BAR_W, BAR_H, BAR_D] = GRATE_BAR;
  const grate = new THREE.InstancedMesh(new THREE.BoxGeometry(BAR_W, BAR_H, BAR_D), M.grate, GRATE_Z.length + 2);
  for (let i = 0; i < GRATE_Z.length; i++) grate.setMatrixAt(i, m4.makeTranslation(0, GRATE_Y, GRATE_Z[i]));
  // the two bearers run under the bars, no farther back than the last bar (LOOK.GRATE_BEARER)
  const [BEAR_X, BEAR_W, BEAR_H] = GRATE_BEARER;
  const bearerLen = GRATE_Z[0] - GRATE_Z[GRATE_Z.length - 1] + BAR_D;
  for (let i = 0; i < 2; i++) {
    m4.makeScale(BEAR_W / BAR_W, BEAR_H / BAR_H, bearerLen / BAR_D);
    m4.setPosition(i ? BEAR_X : -BEAR_X, GRATE_Y - BAR_H / 2 - BEAR_H / 2, (GRATE_Z[0] + GRATE_Z[GRATE_Z.length - 1]) / 2);
    grate.setMatrixAt(GRATE_Z.length + i, m4);
  }
  // the bars sit behind the flame body (review 2026-10-22: dark bars ran across the deep plane's
  // flames): drawn in the transparent pass after the bed glow and before both fire planes, without
  // writing depth, so every flame adds over them while the sill and lip still hide them
  M.grate.transparent = true;
  M.grate.depthWrite = false;
  grate.renderOrder = 0.5;
  scene.add(grate);
  const bedMat = new THREE.MeshBasicMaterial({ map: M.tex.glow, color: PAL.heatLo.clone().multiplyScalar(0.9), transparent: true, depthWrite: false });
  const bedGuard = protectBed(bedMat);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1000), bedMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, -690, -560);
  scene.add(bed);

  // ---- hearth floor under the grate: tall phone views look below the kiln mouth, where the back
  // wall's fire glow read as a flat brown band. Dark refractory, warm only near the mouth.
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { uGlow: backMat.uniforms.uGlow, uHeatLo: { value: PAL_VEC3.heatLo }, uGraphite: { value: PAL_VEC3.graphite }, uBase: { value: PAL_VEC3.base } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: withOutput(`precision highp float; varying vec3 vW; uniform float uGlow; uniform vec3 uHeatLo, uGraphite, uBase;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 col = mix(uBase, uGraphite, 0.35) * 0.7;
        float d = length(vec2(vW.x * 0.0026, (vW.z + 520.0) * 0.0034));
        col += uHeatLo * exp(-d * d) * 0.16 * uGlow;
        col *= 1.0 - 0.45 * smoothstep(-200.0, 700.0, vW.z);
        col += (h(floor(vW.xz * 0.5)) - 0.5) * 0.01;
        gl_FragColor = vec4(col, 1.0);
      }`),
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3200, 2600), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -705, -200);
  scene.add(floor);

  // ---- haze (four layers in three sorted draws; lite keeps original layer two) ----
  // Keep the accepted far-pair batch and the two nearer draws in back-to-front order.
  // All three now composite after the smoked plate; layer parameters and depths stay unchanged.
  const hazeLayers = [[-90, 0.11, 1.3, 0.2], [-260, 0.11, 4.1, 0.16], [-480, 0.12, 7.7, 0.12], [-760, 0.13, 2.2, 0.09]];
  const hazeTimes = new Float32Array(4);
  const hazeParams = new Float32Array(12);
  for (let i = 0; i < hazeLayers.length; i++) {
    const [, alpha, seed, tint] = hazeLayers[i];
    hazeParams.set([seed, alpha, tint], i * 3);
  }
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTimes: { value: hazeTimes }, uParams: { value: hazeParams }, uDensity: { value: LOOK.HAZE_DENSITY }, uWarm: { value: 0.35 }, uHeatLo: { value: PAL_VEC3.heatLo } },
    vertexShader: HAZE_VERT,
    fragmentShader: HAZE_FRAG,
  });
  function writeHaze(mesh, indices) {
    const attr = mesh.geometry.attributes.aHaze;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i], [z, alpha, seed, tint] = hazeLayers[index];
      // All batches share one object matrix; layer placement belongs to the instance.
      m4.makeTranslation(0, -120, z);
      mesh.setMatrixAt(i, m4);
      const offset = i * 4;
      attr.array[offset] = seed; attr.array[offset + 1] = alpha;
      attr.array[offset + 2] = tint; attr.array[offset + 3] = index;
    }
    mesh.count = indices.length;
    mesh.instanceMatrix.needsUpdate = true;
    attr.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  function hazeBatch(name, indices) {
    const geo = new THREE.PlaneGeometry(1900, 1500);
    geo.setAttribute('aHaze', new THREE.InstancedBufferAttribute(new Float32Array(indices.length * 4), 4));
    const mesh = new THREE.InstancedMesh(geo, hazeMat, indices.length);
    mesh.name = name;
    mesh.renderOrder = 0;
    writeHaze(mesh, indices);
    scene.add(mesh);
    return mesh;
  }
  const fullFar = [3, 2], oneFar = [2];
  const farHaze = hazeBatch('kiln-haze-far', fullFar);
  const middleHaze = hazeBatch('kiln-haze-middle', [1]);
  const nearHaze = hazeBatch('kiln-haze-near', [0]);
  const haze = [farHaze, middleHaze, nearHaze];
  let oneHaze = false;

  // ---- one soft light shaft from the upper left ----
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: PLAIN_VERT,
    fragmentShader: SHAFT_FRAG,
  });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(320, 2600), shaftMat);
  shaft.position.set(-330, 300, -300);
  shaft.rotation.z = -0.42;
  shaft.renderOrder = -2;
  scene.add(shaft);

  // ---- smoked back plate: dims the interior behind the wall so the bricks own the frame ----
  // opacity .62 over the wall and the paddle, thinning to .34 at the top so the headroom art reads
  const plateMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uBase: { value: PAL_VEC3.base }, uTop: { value: 0.34 }, uLow: { value: 0.62 } },
    vertexShader: PLAIN_VERT,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; uniform vec3 uBase; uniform float uTop, uLow;
      void main(){ float fy = (1.0 - vUv.y) * ${(FH + 24).toFixed(1)} - 12.0;
        float a = mix(uLow, uTop, smoothstep(600.0, 120.0, fy)); gl_FragColor = vec4(uBase * a, a); }`),
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(FW + 24, FH + 24), plateMat);
  plate.position.set(0, 0, -44);
  plate.renderOrder = -1;
  scene.add(plate);

  // ---- arena frame: glass walls on the three closed sides, titanium lip on the loss edge ----
  const frame = new THREE.Group();
  scene.add(frame);
  const sideGeo = new RoundedBoxGeometry(12, FH + 24, 40, 3, 4);
  const endGeo = new RoundedBoxGeometry(FW + 24, 12, 40, 3, 4);
  const lipLong = new RoundedBoxGeometry(FW + 24, 10, 70, 3, 3);
  const lipTall = new RoundedBoxGeometry(10, FH + 24, 70, 3, 3);
  const wallL = new THREE.Mesh(sideGeo, M.wallGlass);
  const wallR = new THREE.Mesh(sideGeo.clone(), M.wallGlass);
  const wallT = new THREE.Mesh(endGeo, M.wallGlass);
  const wallB = new THREE.Mesh(endGeo.clone(), M.wallGlass);
  wallL.name = 'kiln-wall-left'; wallR.name = 'kiln-wall-right';
  wallT.name = 'kiln-wall-top'; wallB.name = 'kiln-wall-bottom';
  // Fixed offsets lie on the axis setMode never scales. Keep each wall's normals/UVs and
  // perpendicular mode scale intact, while opposite walls share the same object matrix.
  const offsetWall = (wall, x, y) => {
    const geo = wall.geometry, normal = geo.attributes.normal;
    // translate() also normalizes normals; a position offset must retain the rounded normals.
    if (normal) geo.deleteAttribute('normal');
    geo.translate(x, y, 0);
    if (normal) geo.setAttribute('normal', normal);
  };
  offsetWall(wallL, -(FW / 2 + 6), 0);
  offsetWall(wallR, FW / 2 + 6, 0);
  offsetWall(wallT, 0, FH / 2 + 6);
  offsetWall(wallB, 0, -(FH / 2 + 6));
  for (const w of [wallL, wallR, wallT, wallB]) {
    w.position.z = -6;
    w.renderOrder = 6;
  }
  const lipB = new THREE.Mesh(lipLong, M.titaniumP);
  lipB.position.set(0, -FH / 2 - 5, 6);
  const lipL = new THREE.Mesh(lipTall, M.titaniumP);
  lipL.position.set(-FW / 2 - 5, 0, 6);
  // ring mode: a titanium ring on the loss radius and a faint hairline on the paddle track
  const ringLip = new THREE.Mesh(new THREE.TorusGeometry(RING.R_LOSS + 6, 3, 8, 160), M.titaniumP);
  ringLip.position.set(RING.CX - FW / 2, FH / 2 - RING.CY, 2);
  const track = new THREE.Mesh(
    new THREE.RingGeometry(RING.R_PADDLE - 0.5, RING.R_PADDLE + 0.5, 192),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  track.position.copy(ringLip.position);
  track.position.z = -10;
  // left mode: a faint hairline on the paddle track
  const trackL = new THREE.Mesh(
    new THREE.PlaneGeometry(1, FH),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  trackL.position.set(HORIZONTAL.PADDLE_X - FW / 2, 0, -10);
  frame.add(wallL, wallR, wallT, wallB, lipB, lipL, ringLip, track, trackL);

  // ART 12a.1: the collision edge is a forged lintel in the same metal as the sill. The continuous
  // rail meets the ball; recessed joints divide its cap without holes in the visible bounce edge.
  const sillMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.7, envMapIntensity: 0.35 });
  const ceiling = ceilingLayout('ring', null);
  // Match the sill finish, but keep plain and instanced program state on separate materials.
  const ceilingBar = new THREE.InstancedMesh(
    new RoundedBoxGeometry(CEILING_ART.SEGMENT, CEILING_ART.BAR, CEILING_ART.DEPTH, 2, 2),
    sillMat.clone(), 1 + Math.ceil((FH + 24) / CEILING_ART.SEGMENT),
  );
  ceilingBar.name = 'kiln-lintel';
  ceilingBar.renderOrder = 6;
  // Only a local, soft shadow above the lintel. No pane or rectangle covers the painting.
  // The seam and brief contact spark stay below bloom and share this single narrow plane.
  const lintelMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uHeatLo: { value: PAL_VEC3.heatLo }, uBase: { value: PAL_VEC3.base },
      uLength: { value: FW + 24 }, uHit: { value: new THREE.Vector3(0, 14, 0) },
    },
    vertexShader: PLAIN_VERT,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv;
      uniform vec3 uHeatLo, uBase, uHit; uniform float uLength;
      void main(){
        float d = vUv.y * ${(CEILING_ART.SHADE + 1).toFixed(1)} - 1.0;
        float edge = smoothstep(0.0, 0.02, vUv.x) * (1.0 - smoothstep(0.98, 1.0, vUv.x));
        float shade = smoothstep(${(CEILING_ART.BAR - 2).toFixed(1)}, ${(CEILING_ART.BAR + 2).toFixed(1)}, d)
          * pow(1.0 - smoothstep(${CEILING_ART.BAR.toFixed(1)}, ${CEILING_ART.SHADE.toFixed(1)}, d), 2.0) * 0.22;
        float seam = 1.0 - smoothstep(0.25, 0.9, abs(d));
        float along = (vUv.x - 0.5) * uLength;
        float spark = pow(max(0.0, 1.0 - abs(along - uHit.x) / (uHit.y * 0.5)), 3.0) * uHit.z * seam;
        float a = max(shade, seam * 0.55 + spark * 0.3) * edge;
        vec3 col = (uBase * shade + uHeatLo * (seam * 0.10 + spark * 0.26)) * edge;
        gl_FragColor = vec4(col, a);
      }`),
  });
  const ceilingGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lintelMat);
  ceilingGlow.name = 'kiln-lintel-warmth';
  ceilingGlow.position.z = CEILING_ART.DEPTH / 2 + 0.1;
  ceilingGlow.renderOrder = 7;
  ceilingBar.visible = ceilingGlow.visible = false;
  frame.add(ceilingBar, ceilingGlow);
  const lintelPart = {}, contact = {};
  const lintelTransform = new THREE.Matrix4();
  let contactT = -1e9, contactAt = 0;
  function updateContact(age) {
    ceilingContact(ceiling, contactAt, age, contact);
    lintelMat.uniforms.uHit.value.set(contact.at, contact.length, contact.alpha);
  }

  // ---- the kiln lip (ART 12b): a dark metal sill between the fire and the paddle that hides the
  // flame tips. Bottom mode: field y 1022..1044 (the paddle's lower edge is 1008); other modes put
  // it just under the field. It sits behind the ball's plane (z -38..-10), in front of the fire.
  const sill = new THREE.Mesh(new RoundedBoxGeometry(FW + 40, 22, 28, 2, 3), sillMat);
  sill.position.z = -24;
  const sillEdge = new THREE.Mesh(new THREE.PlaneGeometry(FW + 30, 0.8), new THREE.MeshBasicMaterial({ color: 0x3a3e45 }));
  sillEdge.position.z = -9.9;
  scene.add(sill, sillEdge);
  const SILL = { bottom: 1022, left: 1084, ring: 1084 };
  let lipY = HH_ - 1030;

  return {
    hemi, key, rim, fireLight, deepLight, backMat, haze, shaftMat, bed, bedGuard, plate, frame,
    ceiling, ceilingBar, ceilingGlow,
    layoutPillars,

    /** Frame pieces per field mode (ART 7; ring/left variants are C calls). */
    /** World y the flame tips must stay under (the lip line). */
    get lipY() {
      return lipY;
    },

    setMode(mode, field) {
      bedGuard.clear();
      ceilingLayout(mode, field, ceiling);
      ceilingBar.visible = ceilingGlow.visible = ceiling.active;
      contactT = -1e9;
      updateContact(1);
      const lintelRotation = ceiling.vertical ? -Math.PI / 2 : 0;
      lintelTransform.makeRotationZ(lintelRotation);
      lintelTransform.setPosition(ceiling.barX - FW / 2, HH_ - ceiling.barY, 0);
      // The renderer enables every nonempty instance pool before drawing, so inactive means zero.
      ceilingBar.count = ceiling.active ? 1 + ceiling.segments : 0;
      for (let i = 0; i < ceilingBar.count; i++) {
        lintelPiece(ceiling, i, lintelPart);
        m4.makeScale(lintelPart.w / CEILING_ART.SEGMENT, lintelPart.h / CEILING_ART.BAR, lintelPart.d / CEILING_ART.DEPTH);
        m4.setPosition(lintelPart.x, lintelPart.y, 0);
        m4.premultiply(lintelTransform);
        ceilingBar.setMatrixAt(i, m4);
      }
      ceilingBar.instanceMatrix.needsUpdate = true;
      ceilingBar.computeBoundingSphere();
      const offset = (CEILING_ART.SHADE - 1) / 2;
      ceilingGlow.position.x = (ceiling.vertical ? ceiling.edge + offset : FW / 2) - FW / 2;
      ceilingGlow.position.y = HH_ - (ceiling.vertical ? FH / 2 : ceiling.edge - offset);
      ceilingGlow.rotation.z = lintelRotation;
      ceilingGlow.scale.set(ceiling.barLength, CEILING_ART.SHADE + 1, 1);
      lintelMat.uniforms.uLength.value = ceiling.barLength;
      wallL.scale.y = wallR.scale.y = ceiling.wallH / (FH + 24);
      wallL.position.y = wallR.position.y = HH_ - ceiling.wallY;
      wallT.scale.x = wallB.scale.x = ceiling.wallW / (FW + 24);
      wallT.position.x = wallB.position.x = ceiling.wallX - FW / 2;
      const top = SILL[mode] ?? SILL.bottom; // field y of the sill's top edge
      sill.position.y = HH_ - (top + 11);
      sillEdge.position.y = HH_ - top - 0.4;
      lipY = HH_ - (top + 8);
      wallB.visible = mode !== 'bottom';
      wallT.visible = !(ceiling.active && !ceiling.vertical);
      wallR.visible = !(ceiling.active && ceiling.vertical);
      lipB.visible = false; // the sill is the kiln lip now (ART 12b)
      wallL.visible = mode !== 'left';
      lipL.visible = mode === 'left';
      trackL.visible = mode === 'left';
      ringLip.visible = mode === 'ring';
      track.visible = mode === 'ring';
    },

    /** A short warm contact spark follows the forged edge, without free particles or bloom. */
    wallHit(wall, x, y, t) {
      if (!isCeilingHit(ceiling, wall)) return false;
      contactT = t;
      contactAt = ceiling.vertical ? y : x;
      updateContact(0);
      return true;
    },

    /** lite: no rim light, one haze plane; hazeOne alone (the quality ladder's second step): one haze plane. */
    setLite(lite, hazeOne = false) {
      // intensity, not visibility: a change in the light count would recompile every material
      rim.intensity = lite ? 0 : 0.7;
      const one = lite || hazeOne;
      if (one !== oneHaze) {
        writeHaze(farHaze, one ? oneFar : fullFar);
        middleHaze.count = nearHaze.count = one ? 0 : 1;
        oneHaze = one;
      }
      for (let i = 0; i < haze.length; i++) haze[i].visible = haze[i].count > 0;
    },

    /** fi = the one fire number; glowMul from the wall firing. */
    update(t, fi, glowMul, breakBoost, shaderT = t) {
      updateContact((t - contactT) / CEILING_ART.HIT_S);
      backMat.uniforms.uGlow.value = (0.6 + 0.5 * fi) * glowMul;
      deepLight.intensity = 30000 + 30000 * fi;
      bedMat.opacity = 0.5 + 0.35 * fi;
      shaftMat.uniforms.uTime.value = shaderT;
      for (let i = 0; i < 4; i++) hazeTimes[i] = shaderT + i * 7;
      hazeMat.uniforms.uWarm.value = 0.35 + 0.45 * fi;
      return breakBoost;
    },
  };
}
