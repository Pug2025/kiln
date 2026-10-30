// Kiln: lasers, hazards, sentries, the aim line and the shield (OWNER: C). ART 8.
//   lasers   thin white-hot bolts 2 x 24, under the bloom threshold, along their flight
//   hazards  kind 0 (sentry bomb): matte black with a warn-red ring; kind 1 (Stoker slag): a
//            molten core in a dark crust with a 1-unit warn rim; other kinds look like bombs
//   sentries dark drones (dark metal + matte black) with one heat-low eye on world.sentries[i].eye
//   aim line faint white line from fx.aimX/aimY along fx.aimDX/aimDY, fading out (information,
//            never an instruction: it shows where the ball will go, nothing more)
//   shield   1-unit cyan line across the floor under the paddle at 60%; flashes when it saves a ball

import * as THREE from 'three';
import { FIELD, POOL, RING, HORIZONTAL } from '../core/constants.js';
import { PAL, createCoreState } from './materials.js';
import { withOutput } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;

function inst(geo, mat, cap, order = 0) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  m.renderOrder = order;
  return m;
}

export function createPieces(scene, M) {
  const root = new THREE.Group();
  root.name = 'pieces';
  scene.add(root);
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const qId = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---- lasers ----
  const laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.94, 0.85).multiplyScalar(0.95) });
  const lasers = inst(new THREE.BoxGeometry(2, 24, 2), laserMat, POOL.LASERS, 7);
  const laserGlowMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatLo.clone().multiplyScalar(0.6), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const laserGlows = inst(new THREE.PlaneGeometry(10, 34), laserGlowMat, POOL.LASERS, 8);

  // ---- hazards (unit radius 10, scaled by r) ----
  const bombs = inst(new THREE.SphereGeometry(10, 18, 12), M.matteFree, POOL.HAZARDS);
  const bombRings = inst(new THREE.TorusGeometry(10.6, 0.6, 6, 32), M.warn, POOL.HAZARDS, 1);
  const slagGeo = new THREE.IcosahedronGeometry(8.5, 1);
  slagGeo.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(POOL.HAZARDS).fill(1.05), 1));
  const slagState = createCoreState(POOL.HAZARDS).setUsage(THREE.DynamicDrawUsage);
  slagGeo.setAttribute('aCoreState', slagState);
  const slagCores = inst(slagGeo, M.core, POOL.HAZARDS);
  const slagCrust = inst(new THREE.DodecahedronGeometry(10, 0), M.matteFree, POOL.HAZARDS);
  const slagRims = inst(new THREE.TorusGeometry(10.8, 0.5, 6, 32), M.warn, POOL.HAZARDS, 1);

  // ---- sentries (unit radius 16, scaled by r) ----
  const sentryBody = inst(new THREE.IcosahedronGeometry(12, 1), M.darkMetal, POOL.SENTRIES);
  const sentryRing = inst(new THREE.TorusGeometry(15, 2.2, 8, 36), M.matteFree, POOL.SENTRIES);
  const eyeMat = new THREE.MeshBasicMaterial({ color: PAL.heatLo.clone().multiplyScalar(1.6) });
  const sentryEye = inst(new THREE.SphereGeometry(3.2, 12, 8), eyeMat, POOL.SENTRIES, 1);
  const eyeGlowMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatLo.clone(), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sentryGlow = inst(new THREE.PlaneGeometry(18, 18), eyeGlowMat, POOL.SENTRIES, 8);

  // ---- aim line ----
  const aimMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAlpha: { value: 0.35 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: withOutput('precision highp float; varying vec2 vUv; uniform float uAlpha; void main(){ float a = uAlpha * smoothstep(1.0, 0.0, vUv.x) * smoothstep(0.0, 0.06, vUv.x); gl_FragColor = vec4(vec3(1.0) * a, a); }'),
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const aimGeo = new THREE.PlaneGeometry(1, 1);
  aimGeo.translate(0.5, 0, 0);
  const aim = new THREE.Mesh(aimGeo, aimMat);
  aim.renderOrder = 9;
  aim.visible = false;

  // ---- shield ----
  const shieldMat = new THREE.MeshBasicMaterial({ color: PAL.cold.clone(), transparent: true, opacity: 0.6, depthWrite: false });
  const shieldBar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shieldMat);
  const shieldRing = new THREE.Mesh(new THREE.RingGeometry(RING.R_LOSS - 10.5, RING.R_LOSS - 9.5, 160), shieldMat);
  shieldRing.position.set(RING.CX - HW, HH - RING.CY, 1);
  shieldBar.renderOrder = 9;
  shieldRing.renderOrder = 9;
  shieldBar.visible = false;
  shieldRing.visible = false;

  root.add(lasers, laserGlows, bombs, bombRings, slagCores, slagCrust, slagRims,
    sentryBody, sentryRing, sentryEye, sentryGlow, aim, shieldBar, shieldRing);

  // Phone-only warning rims are decoration outside the unchanged damage body.
  const warningDark = inst(new THREE.RingGeometry(0.68, 1, 48), new THREE.MeshBasicMaterial({ color: 0x08090c, depthWrite: false }), POOL.HAZARDS, 2);
  const warningRing = inst(new THREE.RingGeometry(0.78, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.16, 0.24), depthWrite: false }), POOL.HAZARDS, 3);
  const droneOutline = inst(new THREE.RingGeometry(0.78, 1, 40), new THREE.MeshBasicMaterial({ color: 0xb1b8c2, depthWrite: false }), POOL.SENTRIES, 1);
  const bomberOutline = inst(new THREE.RingGeometry(0.78, 1, 4), droneOutline.material, POOL.SENTRIES, 1);
  bomberOutline.name = 'phone-bomber-outlines';
  warningDark.name = 'phone-hazard-backing'; warningRing.name = 'phone-hazard-rims'; droneOutline.name = 'phone-sentry-outlines';
  root.add(warningDark, warningRing, droneOutline, bomberOutline);
  let info = { small: false, scale: 1 };
  let mode = 'bottom';
  let shieldFlashT = -1e9;

  function setLasers(world, alpha) {
    let n = 0;
    for (let i = 0; i < world.lasers.length; i++) {
      const L = world.lasers[i];
      if (!L.alive) continue;
      pos.set(lerp(L.px, L.x, alpha) - HW, HH - lerp(L.py, L.y, alpha), 0);
      quat.setFromAxisAngle(zAxis, Math.atan2(-L.vy, L.vx) - Math.PI / 2);
      scl.set(1, 1, 1);
      m4.compose(pos, quat, scl);
      lasers.setMatrixAt(n, m4);
      pos.z = 6;
      m4.compose(pos, quat, scl);
      laserGlows.setMatrixAt(n, m4);
      n++;
    }
    lasers.count = n;
    laserGlows.count = n;
    lasers.instanceMatrix.needsUpdate = true;
    laserGlows.instanceMatrix.needsUpdate = true;
  }

  function setHazards(world, alpha, t) {
    let nb = 0, ns = 0, nw = 0;
    for (let i = 0; i < world.hazards.length; i++) {
      const h = world.hazards[i];
      if (!h.alive) continue;
      const s = (h.r || 10) / 10;
      if (info.small) {
        const radius = (h.r || 10) + 2.5 / info.scale;
        pos.set(lerp(h.px, h.x, alpha) - HW, HH - lerp(h.py, h.y, alpha), 1);
        scl.set(radius + 0.8 / info.scale, radius + 0.8 / info.scale, 1);
        m4.compose(pos, qId, scl); warningDark.setMatrixAt(nw, m4);
        scl.set(radius, radius, 1); pos.z = 1.1;
        m4.compose(pos, qId, scl); warningRing.setMatrixAt(nw++, m4);
      }
      pos.set(lerp(h.px, h.x, alpha) - HW, HH - lerp(h.py, h.y, alpha), 0);
      scl.set(s, s, s);
      if ((h.kind | 0) === 1) {
        quat.setFromAxisAngle(zAxis, t * 1.3 + i);
        m4.compose(pos, quat, scl);
        slagCores.setMatrixAt(ns, m4);
        slagState.array[ns * 2] = ((i + 1) * 0.61803398875) % 1;
        // the crust: a squashed shell that lets the molten core show through its cracks
        scl.set(s * 0.95, s * 0.95, s * 0.55);
        m4.compose(pos, quat, scl);
        slagCrust.setMatrixAt(ns, m4);
        scl.set(s, s, s);
        m4.compose(pos, qId, scl);
        slagRims.setMatrixAt(ns, m4);
        ns++;
      } else {
        m4.compose(pos, qId, scl);
        bombs.setMatrixAt(nb, m4);
        bombRings.setMatrixAt(nb, m4);
        nb++;
      }
    }
    warningDark.count = nw; warningRing.count = nw;
    warningDark.instanceMatrix.needsUpdate = true; warningRing.instanceMatrix.needsUpdate = true;
    bombs.count = nb;
    bombRings.count = nb;
    slagCores.count = ns;
    slagState.needsUpdate = true;
    slagCrust.count = ns;
    slagRims.count = ns;
    bombs.instanceMatrix.needsUpdate = true;
    bombRings.instanceMatrix.needsUpdate = true;
    slagCores.instanceMatrix.needsUpdate = true;
    slagCrust.instanceMatrix.needsUpdate = true;
    slagRims.instanceMatrix.needsUpdate = true;
  }

  function setSentries(world, alpha, t) {
    let n = 0, nd = 0, nb = 0;
    for (let i = 0; i < world.sentries.length; i++) {
      const s = world.sentries[i];
      if (!s.alive) continue;
      const k = (s.r || 16) / 16;
      const x = lerp(s.px, s.x, alpha) - HW, y = HH - lerp(s.py, s.y, alpha);
      if (info.small) {
        pos.set(x, y, 1); scl.set(s.r || 16, s.r || 16, 1);
        m4.compose(pos, qId, scl);
        if (s.kind === 1) bomberOutline.setMatrixAt(nb++, m4);
        else droneOutline.setMatrixAt(nd++, m4);
      }
      pos.set(x, y, 0);
      quat.setFromAxisAngle(zAxis, t * 0.6 + i);
      scl.set(k, k, k * 0.7);
      m4.compose(pos, quat, scl);
      sentryBody.setMatrixAt(n, m4);
      scl.set(k, k, k);
      m4.compose(pos, qId, scl);
      sentryRing.setMatrixAt(n, m4);
      // the eye looks along s.eye (field radians, y down)
      const ex = Math.cos(s.eye || Math.PI / 2) * 7 * k, ey = -Math.sin(s.eye || Math.PI / 2) * 7 * k;
      pos.set(x + ex, y + ey, 8 * k);
      m4.compose(pos, qId, scl);
      if (info.small) {
        const eyeSize = Math.max(k, 4 / (6.4 * info.scale));
        scl.set(eyeSize, eyeSize, eyeSize); m4.compose(pos, qId, scl);
      }
      sentryEye.setMatrixAt(n, m4);
      scl.set(k, k, k);
      pos.z = 12 * k;
      m4.compose(pos, qId, scl);
      sentryGlow.setMatrixAt(n, m4);
      n++;
    }
    droneOutline.count = nd; droneOutline.instanceMatrix.needsUpdate = true;
    bomberOutline.count = nb; bomberOutline.instanceMatrix.needsUpdate = true;
    for (const m of sentryMeshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
  }
  const sentryMeshes = [sentryBody, sentryRing, sentryEye, sentryGlow];

  function setAim(world) {
    const fx = world.fx;
    // A sets fx.aim (last bricks, or the Sniper's always-on line) and its start and direction
    aim.visible = !!fx.aim && fx.aimDX * fx.aimDX + fx.aimDY * fx.aimDY > 0.01;
    if (!aim.visible) return;
    aim.position.set(fx.aimX - HW, HH - fx.aimY, 1);
    aim.rotation.z = Math.atan2(-fx.aimDY, fx.aimDX);
    aim.scale.set(260, 1, 1);
  }

  function setShield(world, t) {
    const on = world.effects.shield > 0;
    const fl = Math.max(0, 1 - (t - shieldFlashT) / 0.25);
    const vis = on || fl > 0;
    shieldMat.opacity = Math.min(1, 0.6 + fl * 0.4) * (on ? 1 : fl);
    shieldMat.color.copy(PAL.cold).multiplyScalar(1 + fl * 1.2);
    shieldRing.visible = vis && mode === 'ring';
    shieldBar.visible = vis && mode !== 'ring';
    if (mode === 'left') {
      shieldBar.position.set(-HW + HORIZONTAL.PADDLE_X - 26, 0, 1);
      shieldBar.scale.set(1 + fl * 2, FIELD.H - 8, 1);
    } else {
      shieldBar.position.set(0, -HH + 40, 1);
      shieldBar.scale.set(FIELD.W - 8, 1 + fl * 2, 1);
    }
  }

  return {
    setReadability(value) { info = value; },
    setWorld(world) {
      mode = world.level.mode;
      shieldFlashT = -1e9;
    },
    shieldUsed(t) {
      shieldFlashT = t;
    },
    frame(world, alpha, t) {
      setLasers(world, alpha);
      setHazards(world, alpha, t);
      setSentries(world, alpha, t);
      setAim(world);
      setShield(world, t);
    },
  };
}
