// Kiln: inner marks and fittings on bricks (OWNER: C). ART 8 table.
//   numbered      white digit on a plane inside the glass (hits left), always upright
//   explosive     thin warn-red ring inside the glass, pulsing with the core
//   carrier       small white (70%) bar and dot, bottom right inside the glass
//   cavity ball   ('*' cells) a tiny white-hot ball drifting inside clear glass
//   portal        1-unit white ring + the pair letter (A, B, C ...) on the inner plane; pairs by
//                 letter, never by colour
//   gravity       magnetic clamp under the slab: dark-metal bar, two posts, white 2-unit mark 70%
//   moving        dark-metal rail with a white hairline (50%) and a sliding shoe under the brick
//   armoured      one dark machined seam; each hit adds a seam and a 0.16 s heat flash along it
// Every kind is one InstancedMesh, rebuilt with the wall and re-posed per frame only for bricks that
// move, pulse or drift. "Under" means toward the paddle in every mode (left mode turns the slab
// -90 degrees; ring mode turns each clamp to face outward).

import * as THREE from 'three';
import { FIELD, POOL, BRICK, BF, RING } from '../core/constants.js';
import { LOOK } from './look.js';
import { PAL } from './materials.js';
import { withOutput } from './shaders.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;
const CAP = POOL.BRICKS;
const SEAM_X = [10, -8, 2, -17, 18, -2];

/** Digit and letter atlas: 0-9 then A-F, Inter Tight 600, white on black (16 cells of 64x128). */
export function glyphAtlas() {
  const cw = 64, ch = 128, n = 16;
  const c = document.createElement('canvas');
  c.width = cw * n;
  c.height = ch;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = '600 92px "Inter Tight", "Inter", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const chars = '0123456789ABCDEF';
  for (let i = 0; i < n; i++) g.fillText(chars[i], i * cw + cw / 2, ch / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  return t;
}

function inst(geo, mat, cap, order = 0) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  m.renderOrder = order;
  return m;
}

export function createMarks(root, M) {
  const group = new THREE.Group();
  group.name = 'marks';
  root.add(group);

  // ---- glyph plane (digits and portal letters) ----
  const atlas = glyphAtlas();
  M.tex.digits = atlas;
  const glyphGeo = new THREE.PlaneGeometry(20, 18);
  const glyphCell = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1);
  glyphCell.setUsage(THREE.DynamicDrawUsage);
  glyphGeo.setAttribute('aCell', glyphCell);
  const glyphMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAtlas: { value: atlas }, uColor: { value: PAL.text.clone().multiplyScalar(1.25) } },
    // clipping chunks: bricks.js clips the wall at the field's top edge (rows scrolling in)
    vertexShader: `attribute float aCell; varying vec2 vUv; varying float vCell;
      #include <clipping_planes_pars_vertex>
      void main(){ vUv = uv; vCell = aCell; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; varying float vCell; uniform sampler2D uAtlas; uniform vec3 uColor;
      #include <clipping_planes_pars_fragment>
      void main(){
        #include <clipping_planes_fragment>
        float cell = floor(vCell + 0.5);
        // plane 20x18, atlas cell 64x128 (aspect .5): keep the glyph's aspect, 15 units tall
        vec2 d = vec2((vUv.x - 0.5) * (20.0 / 18.0) / 0.5 * (18.0 / 15.0) + 0.5, (vUv.y - 0.5) * (18.0 / 15.0) + 0.5);
        float m = 0.0;
        if (d.x > 0.0 && d.x < 1.0 && d.y > 0.0 && d.y < 1.0) m = texture2D(uAtlas, vec2((cell + d.x) / 16.0, d.y)).r;
        m = smoothstep(0.25, 0.75, m);
        if (m < 0.01) discard;
        gl_FragColor = vec4(uColor * m, m * 0.95);
      }`),
  });
  const glyphs = inst(glyphGeo, glyphMat, CAP, 1);

  // ---- rings (explosive warn, portal white) ----
  const ringGeo = new THREE.TorusGeometry(8.5, 0.7, 8, 40);
  const warnRingMat = new THREE.MeshBasicMaterial({ color: PAL.warn.clone().multiplyScalar(1.25) });
  const exRings = inst(ringGeo, warnRingMat, CAP, 1);
  const portalRingGeo = new THREE.TorusGeometry(10, 0.5, 6, 48);
  const portalRings = inst(portalRingGeo, M.white, CAP, 1);

  // ---- carrier bar + dot ----
  const carrierBar = inst(new THREE.PlaneGeometry(12, 1.6), M.white70, CAP, 1);
  const carrierDot = inst(new THREE.PlaneGeometry(1.6, 1.6), M.white70, CAP, 1);

  // ---- cavity ball ----
  const cavBallMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.86).multiplyScalar(2.2) });
  const cavBalls = inst(new THREE.SphereGeometry(4.5, 16, 12), cavBallMat, CAP, 1);
  const cavGlowMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatLo.clone(), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const cavGlows = inst(new THREE.PlaneGeometry(22, 22), cavGlowMat, CAP, 1);

  // ---- gravity clamp ----
  const clampBar = inst(new THREE.BoxGeometry(42, 2, 14), M.darkMetal, CAP);
  const clampPost = inst(new THREE.BoxGeometry(3, 8, 12), M.darkMetal, CAP * 2);
  const clampMark = inst(new THREE.PlaneGeometry(16, 2), M.white70, CAP, 1);

  // ---- moving: rails and shoes ----
  const rails = inst(new THREE.BoxGeometry(1, 2, 4), M.darkMetal, 64);
  const railLines = inst(new THREE.PlaneGeometry(1, 0.7), M.white50, 64, 1);
  const shoes = inst(new THREE.BoxGeometry(22, 4, 10), M.darkMetal, CAP);

  // ---- armoured seams (instance colour flashes with heat) ----
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const seams = inst(new THREE.PlaneGeometry(0.9, 18), seamMat, CAP * 4, 1);
  const seamCol = new THREE.Color(0x111317);
  seams.setColorAt(0, seamCol);

  group.add(glyphs, exRings, portalRings, carrierBar, carrierDot, cavBalls, cavGlows,
    clampBar, clampPost, clampMark, rails, railLines, shoes, seams);

  // ---- per-mark bookkeeping (preallocated) ----
  // each entry: mesh id, slot in that mesh, brick, local offset (x, y, z), local scale x, y
  const MAXE = CAP * 8;
  const eMesh = new Uint8Array(MAXE);
  const eSlot = new Int32Array(MAXE);
  const eBrick = new Int32Array(MAXE);
  const eX = new Float32Array(MAXE), eY = new Float32Array(MAXE), eZ = new Float32Array(MAXE);
  const eSX = new Float32Array(MAXE), eSY = new Float32Array(MAXE);
  const eUpright = new Uint8Array(MAXE); // ignores the slab rotation (glyphs, rings)
  const eKind = new Uint8Array(MAXE);    // 1 pulse, 2 cavity drift, 3 seam
  const eAux = new Int16Array(MAXE);     // seam index
  let nE = 0;
  const meshes = [glyphs, exRings, portalRings, carrierBar, carrierDot, cavBalls, cavGlows, clampBar, clampPost, clampMark, shoes, seams];
  const ID = { glyphs: 0, exRings: 1, portalRings: 2, carrierBar: 3, carrierDot: 4, cavBalls: 5, cavGlows: 6, clampBar: 7, clampPost: 8, clampMark: 9, shoes: 10, seams: 11 };
  const counts = new Int32Array(meshes.length);
  const entryOfBrickStart = new Int32Array(CAP);
  const entryOfBrickEnd = new Int32Array(CAP);
  const seamFlashT = new Float32Array(CAP * 4).fill(-1e9);
  const seamSlotOfBrick = new Int32Array(CAP).fill(-1);
  const brickRot = new Float32Array(CAP); // ring mode: per-brick rotation so "under" faces outward
  const isSlid = new Uint8Array(CAP); // brick moves (needs re-pose every frame)
  const letterOf = new Int16Array(CAP);
  const railKey = new Float32Array(64);
  let nRail = 0;
  function addRail(key) {
    for (let q = 0; q < nRail; q++) if (railKey[q] === key) return;
    if (nRail < 64) railKey[nRail++] = key;
  }

  let world = null;
  let mode = 'bottom';

  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tmpCol = new THREE.Color();

  function add(id, i, x, y, z, sx = 1, sy = 1, upright = 0, kind = 0, aux = 0) {
    const k = nE++;
    eMesh[k] = id;
    eSlot[k] = counts[id]++;
    eBrick[k] = i;
    eX[k] = x; eY[k] = y; eZ[k] = z;
    eSX[k] = sx; eSY[k] = sy;
    eUpright[k] = upright;
    eKind[k] = kind;
    eAux[k] = aux;
    return k;
  }

  /** Pose entry k at brick position (bx, by) world units. */
  function pose(k, bx, by, t) {
    const i = eBrick[k];
    let lx = eX[k], ly = eY[k];
    let sx = eSX[k], sy = eSY[k];
    const kind = eKind[k];
    if (kind === 1) { // explosive pulse
      const p = 0.5 + 0.5 * Math.sin(t * LOOK.EXPLOSIVE_RATE + i * 0.7);
      sx *= 1 + 0.05 * p;
      sy *= 1 + 0.05 * p;
    } else if (kind === 2) { // cavity drift (inside the cell)
      const amp = mode === 'bottom' ? 14 : 5;
      lx += Math.sin(t * 2.1 + i * 1.7) * amp;
      ly += Math.cos(t * 3.3 + i) * 3;
    }
    const rot = eUpright[k] ? 0 : brickRot[i];
    if (rot !== 0) {
      const c = Math.cos(rot), s = Math.sin(rot);
      const rx = lx * c - ly * s, ry = lx * s + ly * c;
      lx = rx; ly = ry;
    }
    quat.setFromAxisAngle(zAxis, rot);
    pos.set(bx + lx, by + ly, eZ[k]);
    scl.set(sx, sy, 1);
    m4.compose(pos, quat, scl);
    meshes[eMesh[k]].setMatrixAt(eSlot[k], m4);
  }

  function brickXY(i, alpha, out) {
    const B = world.bricks;
    const moving = (B.flags[i] & (BF.MOVING | BF.FALLING)) !== 0;
    out.x = (moving ? B.px[i] + (B.x[i] - B.px[i]) * alpha : B.x[i]) - HW;
    out.y = HH - (moving ? B.py[i] + (B.y[i] - B.py[i]) * alpha : B.y[i]);
    return out;
  }
  const bxy = { x: 0, y: 0 };

  return {
    setWorld(w, m) {
      world = w;
      mode = m;
      seamFlashT.fill(-1e9);
    },

    /** Rebuild every mark from the live wall (called with the brick rebuild). */
    rebuild(w, m, slotOf, grpOf, alpha) {
      world = w;
      mode = m;
      const B = w.bricks;
      nE = 0;
      counts.fill(0);
      seamSlotOfBrick.fill(-1);
      const zMark = LOOK.MARK_Z;
      const zFront = LOOK.SHELL.d / 2 + 0.15;
      const halfH = 13; // shell half height in the slab frame
      // portal letters: pair k gets letter A + k, by the lower index of the pair
      let pairK = 0;
      nRail = 0;
      for (let i = 0; i < B.count; i++) {
        entryOfBrickStart[i] = nE;
        isSlid[i] = 0;
        if (!B.alive[i] || (B.flags[i] & BF.HIDDEN)) { entryOfBrickEnd[i] = nE; continue; }
        const f = B.flags[i];
        const type = B.type[i];
        // slab frame rotation: left mode -90 deg; ring mode faces the clamp outward
        if (mode === 'left') brickRot[i] = -Math.PI / 2;
        else if (mode === 'ring') {
          const ux = B.x[i] - RING.CX, uy = -(B.y[i] - RING.CY);
          brickRot[i] = (Math.abs(ux) + Math.abs(uy) > 1) ? Math.atan2(ux, -uy) : 0;
        } else brickRot[i] = 0;
        const sq = mode === 'ring';
        const halfW = sq ? 13 : 28;
        if (f & BF.CAVITY_BALL) {
          add(ID.cavBalls, i, 0, 0, 0, 1, 1, 1, 2);
          add(ID.cavGlows, i, 0, 0, 2, 1, 1, 1, 2);
        } else {
          switch (type) {
            case BRICK.NUMBERED: {
              const k = add(ID.glyphs, i, 0, 0, zMark, 1, 1, 1);
              glyphCell.array[eSlot[k]] = Math.max(0, Math.min(9, B.hp[i]));
              break;
            }
            case BRICK.EXPLOSIVE:
              add(ID.exRings, i, 0, 0, zMark, 1, 1, 1, 1);
              break;
            case BRICK.CARRIER:
              add(ID.carrierBar, i, halfW - 14, -halfH + 6, zMark, 1, 1);
              add(ID.carrierDot, i, halfW - 23, -halfH + 6, zMark, 1, 1);
              break;
            case BRICK.PORTAL: {
              add(ID.portalRings, i, 0, 0, zMark, 1, 1, 1);
              const j = B.link[i];
              const letter = j >= 0 && j < i ? letterOf[j] : pairK++;
              letterOf[i] = letter;
              const k = add(ID.glyphs, i, 0, 0, zMark + 0.1, 0.8, 0.8, 1);
              glyphCell.array[eSlot[k]] = 10 + (letter % 6);
              break;
            }
            case BRICK.GRAVITY:
              add(ID.clampBar, i, 0, -halfH - 1, 0, sq ? 0.5 : 1, 1);
              add(ID.clampPost, i, -(halfW - 9), -halfH + 3, 0, 1, 1);
              add(ID.clampPost, i, halfW - 9, -halfH + 3, 0, 1, 1);
              add(ID.clampMark, i, 0, -halfH - 1, 7.2, sq ? 0.5 : 1, 1);
              break;
            case BRICK.ARMOURED: {
              if (f & BF.BOSS) {
                const digit = add(ID.glyphs, i, 0, 0, zFront + 0.2, 1, 1, 1);
                glyphCell.array[eSlot[digit]] = Math.max(1, Math.min(9, B.hp[i]));
              }
              const hits = Math.max(0, (B.hpMax[i] || 3) - Math.max(0, B.hp[i]));
              const n = Math.min(SEAM_X.length, 1 + hits);
              for (let s = 0; s < n; s++) {
                const k = add(ID.seams, i, sq ? SEAM_X[s] * 0.4 : SEAM_X[s], 0, zFront, 1, sq ? 0.95 : 1, 0, 3, s);
                if (s === n - 1) seamSlotOfBrick[i] = eSlot[k];
              }
              break;
            }
            default:
          }
        }
        // moving bricks: a shoe under the slab, and a rail along the slide axis
        const slides = (f & BF.MOVING) && !(f & (BF.FALLING | BF.BOSS)) && !(w.level.rules.scrollSpeed > 0);
        if (slides) {
          isSlid[i] = 1;
          add(ID.shoes, i, 0, -halfH - 1, -2, sq ? 0.6 : 1, 1);
          addRail(mode === 'left' ? Math.round(B.x[i]) : Math.round(B.y[i]));
        }
        entryOfBrickEnd[i] = nE;
      }
      // rails from the level's motion rows too (bottom mode), before the bricks start moving
      const def = w.level.def;
      if (mode === 'bottom' && def.motion && !(w.level.rules.scrollSpeed > 0)) {
        const g = w.level.grid;
        for (let q = 0; q < def.motion.length; q++) addRail(Math.round(g.y0 + (def.motion[q].row + 0.5) * g.ch));
      }
      let r = 0;
      for (let q = 0; q < nRail; q++) {
        const key = railKey[q];
        if (mode === 'left') {
          pos.set(key - HW - 15 - 1, 0, -2);
          quat.setFromAxisAngle(zAxis, Math.PI / 2);
          scl.set(FIELD.H - 8, 1, 1);
        } else {
          pos.set(0, HH - key - 15 - 1, -2);
          quat.identity();
          scl.set(FIELD.W - 8, 1, 1);
        }
        m4.compose(pos, quat, scl);
        rails.setMatrixAt(r, m4);
        pos.z = 0.4;
        scl.x -= 8;
        m4.compose(pos, quat, scl);
        railLines.setMatrixAt(r, m4);
        r++;
      }
      rails.count = r;
      railLines.count = r;
      rails.instanceMatrix.needsUpdate = true;
      railLines.instanceMatrix.needsUpdate = true;

      for (let k = 0; k < nE; k++) {
        brickXY(eBrick[k], alpha, bxy);
        pose(k, bxy.x, bxy.y, 0);
      }
      for (let id = 0; id < meshes.length; id++) {
        meshes[id].count = counts[id];
        meshes[id].instanceMatrix.needsUpdate = true;
      }
      for (let s = 0; s < counts[ID.seams]; s++) seams.setColorAt(s, seamCol);
      if (seams.instanceColor) seams.instanceColor.needsUpdate = true;
      glyphCell.needsUpdate = true;
    },

    hit(i, t) {
      if (i < 0 || i >= CAP || !world) return;
      if (world.bricks.type[i] === BRICK.ARMOURED) {
        // the new seam appears on the rebuild; flash the newest seam of this brick
        seamFlashT[i] = t;
      }
    },

    frame(w, alpha, t) {
      if (!world) return;
      const B = w.bricks;
      let dirty = false;
      for (let k = 0; k < nE; k++) {
        const i = eBrick[k];
        const kind = eKind[k];
        const moving = (B.flags[i] & (BF.MOVING | BF.FALLING)) !== 0;
        if (moving || kind === 1 || kind === 2) {
          brickXY(i, alpha, bxy);
          pose(k, bxy.x, bxy.y, t);
          dirty = true;
        }
        if (eMesh[k] === ID.glyphs && B.type[i] === BRICK.NUMBERED) {
          const v = Math.max(0, Math.min(9, B.hp[i]));
          if (glyphCell.array[eSlot[k]] !== v) {
            glyphCell.array[eSlot[k]] = v;
            glyphCell.needsUpdate = true;
          }
        }
      }
      // seam heat flash (0.16 s along the newest seam)
      let flashing = false;
      for (let k = 0; k < nE; k++) {
        if (eKind[k] !== 3) continue;
        const i = eBrick[k];
        const kf = (t - seamFlashT[i]) / LOOK.HIT_FLASH_S;
        if (kf >= 0 && kf < 1.2 && eSlot[k] === seamSlotOfBrick[i]) {
          const h = Math.max(0, 1 - kf);
          tmpCol.copy(seamCol).lerp(PAL.heatHi, h).multiplyScalar(1 + h * 1.5);
          seams.setColorAt(eSlot[k], tmpCol);
          flashing = true;
        }
      }
      if (flashing && seams.instanceColor) seams.instanceColor.needsUpdate = true;
      if (dirty) for (let id = 0; id < meshes.length; id++) meshes[id].instanceMatrix.needsUpdate = true;
    },
  };
}
