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
import { colorVec3, writeColorVec3 } from './palette-uniforms.js';
import { withOutput } from './shaders.js';
import { coreProtected } from './boss-feedback.js';
import { phoneMarkLayout, phonePipLayout, phonePipPosition, glyphInkRect, phoneTargetSegment } from './phone-marks.js';

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
  // Read the actual rasterised ink once. Phone marks crop this rectangle instead of scaling
  // the empty padding surrounding a character. The original texture is unchanged on desktop.
  const pixels = g.getImageData(0, 0, c.width, ch).data;
  const bounds = new Float32Array(n * 4), aspects = new Float32Array(n), rect = {};
  for (let k = 0; k < n; k++) {
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (pixels[(y * c.width + k * cw + x) * 4] < 48) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    glyphInkRect(x0, y0, x1, y1, cw, ch, rect);
    bounds[k * 4] = rect.x; bounds[k * 4 + 1] = rect.y;
    bounds[k * 4 + 2] = rect.w; bounds[k * 4 + 3] = rect.h;
    aspects[k] = rect.aspect;
  }
  t.userData.inkBounds = bounds;
  t.userData.inkAspects = aspects;
  return t;
}

/** High-contrast phone symbols: carrier cell, explosion, armour shield, permanent lock, gravity. */
function phoneIconAtlas() {
  const size = 128, c = document.createElement('canvas');
  c.width = size * 5; c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = '#f2f4f7'; g.fillStyle = '#f2f4f7';
  g.lineWidth = 11; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 5; k++) {
    g.save(); g.translate(k * size, 0); g.beginPath();
    if (k === 0) {
      g.roundRect(17, 33, 94, 62, 17); g.stroke();
      g.beginPath(); g.arc(64, 64, 9, 0, Math.PI * 2); g.fill();
    } else if (k === 1) {
      g.moveTo(64, 13); g.lineTo(116, 108); g.lineTo(12, 108); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(64, 44); g.lineTo(64, 71); g.stroke();
      g.beginPath(); g.arc(64, 89, 4, 0, Math.PI * 2); g.fill();
    } else if (k === 2) {
      g.moveTo(24, 19); g.lineTo(104, 19); g.lineTo(99, 73);
      g.quadraticCurveTo(94, 93, 64, 111); g.quadraticCurveTo(34, 93, 29, 73); g.closePath(); g.stroke();
    } else if (k === 3) {
      g.roundRect(26, 55, 76, 56, 8); g.fill();
      g.beginPath(); g.moveTo(40, 55); g.lineTo(40, 39); g.arc(64, 39, 24, Math.PI, 0); g.lineTo(88, 55); g.stroke();
      g.fillStyle = '#080a0d'; g.beginPath(); g.arc(64, 80, 7, 0, Math.PI * 2); g.fill();
      g.fillRect(60, 80, 8, 16);
    } else {
      g.moveTo(64, 17); g.lineTo(64, 100); g.moveTo(37, 74); g.lineTo(64, 103); g.lineTo(91, 74); g.stroke();
    }
    g.restore();
  }
  const texture = new THREE.CanvasTexture(c);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
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
  const inkBounds = Array.from({ length: 16 }, (_, i) => new THREE.Vector4().fromArray(atlas.userData.inkBounds, i * 4));
  const glyphMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uAtlas: { value: atlas }, uColor: { value: colorVec3(PAL.text, 1.25) },
      uPhone: { value: 0 }, uInk: { value: inkBounds } },
    // clipping chunks: bricks.js clips the wall at the field's top edge (rows scrolling in)
    vertexShader: `attribute float aCell; varying vec2 vUv; varying float vCell;
      #include <clipping_planes_pars_vertex>
      void main(){ vUv = uv; vCell = aCell; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: withOutput(`precision highp float; varying vec2 vUv; varying float vCell; uniform sampler2D uAtlas; uniform vec3 uColor; uniform float uPhone; uniform vec4 uInk[16];
      #include <clipping_planes_pars_fragment>
      void main(){
        #include <clipping_planes_fragment>
        float cell = floor(vCell + 0.5);
        // plane 20x18, atlas cell 64x128 (aspect .5): keep the glyph's aspect, 15 units tall
        vec2 d = vec2((vUv.x - 0.5) * (20.0 / 18.0) / 0.5 * (18.0 / 15.0) + 0.5, (vUv.y - 0.5) * (18.0 / 15.0) + 0.5);
        if (uPhone > 0.5) { vec4 ink = uInk[int(cell)]; d = ink.xy + vUv * ink.zw; }
        float m = 0.0;
        if (d.x > 0.0 && d.x < 1.0 && d.y > 0.0 && d.y < 1.0) m = texture2D(uAtlas, vec2((cell + d.x) / 16.0, d.y)).r;
        m = smoothstep(0.25, 0.75, m);
        if (m < 0.01) discard;
        gl_FragColor = vec4(uColor * m, m * 0.95);
      }`),
  });
  const glyphs = inst(glyphGeo, glyphMat, CAP, 1);
  glyphs.name = 'brick-hit-glyphs';

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

  const phoneBackMat = new THREE.MeshBasicMaterial({ color: 0x080a0d });
  const phoneWhite = new THREE.MeshBasicMaterial({ color: 0xf2f4f7 });
  phoneWhite.color.multiplyScalar(0.9); // information stays below the bloom threshold
  const phoneBacks = inst(new THREE.PlaneGeometry(1, 1), phoneBackMat, CAP * 2, 6);
  phoneBacks.name = 'brick-phone-backs';
  const phonePips = inst(new THREE.CircleGeometry(0.5, 12), phoneWhite, CAP * 9, 7);
  phonePips.name = 'brick-hit-pips';
  const iconGeometry = new THREE.PlaneGeometry(1, 1);
  const iconCell = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 2), 1);
  iconCell.setUsage(THREE.DynamicDrawUsage);
  iconGeometry.setAttribute('aCell', iconCell);
  const iconMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uAtlas: { value: phoneIconAtlas() } },
    vertexShader: `attribute float aCell; varying vec2 vUv; varying float vCell;
      #include <clipping_planes_pars_vertex>
      void main(){vUv=uv;vCell=aCell;vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: withOutput(`precision highp float;varying vec2 vUv;varying float vCell;uniform sampler2D uAtlas;
      #include <clipping_planes_pars_fragment>
      void main(){
        #include <clipping_planes_fragment>
        vec4 texel=texture2D(uAtlas,vec2((floor(vCell+0.5)+vUv.x)/5.0,vUv.y));
        if(texel.a<0.1)discard;gl_FragColor=vec4(vec3(0.80,0.82,0.85),texel.a);
      }`),
  });
  const phoneIcons = inst(iconGeometry, iconMaterial, CAP * 2, 7);
  phoneIcons.name = 'brick-phone-symbols';
  const phoneCorners = inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), CAP * 8, 7);
  phoneCorners.name = 'boss-phone-target';
  const targetWarm = new THREE.Color(0xffd9a8), targetCool = new THREE.Color(0x777c85);
  phoneCorners.setColorAt(0, targetWarm);
  const phoneRings = inst(new THREE.TorusGeometry(0.5, 0.06, 8, 40), phoneWhite, CAP, 7);
  phoneRings.name = 'brick-phone-portal-rings';
  const phoneFrames = inst(new THREE.PlaneGeometry(1, 1), phoneWhite, CAP * 2, 7);
  phoneFrames.name = 'brick-phone-armour-edges';
  group.add(glyphs, exRings, portalRings, carrierBar, carrierDot, cavBalls, cavGlows,
    clampBar, clampPost, clampMark, rails, railLines, shoes, seams, phoneBacks, phonePips, phoneIcons, phoneCorners, phoneRings, phoneFrames);

  // ---- per-mark bookkeeping (preallocated) ----
  // each entry: mesh id, slot in that mesh, brick, local offset (x, y, z), local scale x, y
  const MAXE = CAP * 20;
  const eMesh = new Uint8Array(MAXE);
  const eSlot = new Int32Array(MAXE);
  const eBrick = new Int32Array(MAXE);
  const eX = new Float32Array(MAXE), eY = new Float32Array(MAXE), eZ = new Float32Array(MAXE);
  const eSX = new Float32Array(MAXE), eSY = new Float32Array(MAXE);
  const eUpright = new Uint8Array(MAXE); // ignores the slab rotation (glyphs, rings)
  const eKind = new Uint8Array(MAXE);    // 1 pulse, 2 cavity drift, 3 seam
  const eAux = new Int16Array(MAXE);     // seam index
  let nE = 0;
  const meshes = [glyphs, exRings, portalRings, carrierBar, carrierDot, cavBalls, cavGlows, clampBar, clampPost, clampMark, shoes, seams, phoneBacks, phonePips, phoneIcons, phoneCorners, phoneRings, phoneFrames];
  const ID = { glyphs: 0, exRings: 1, portalRings: 2, carrierBar: 3, carrierDot: 4, cavBalls: 5, cavGlows: 6, clampBar: 7, clampPost: 8, clampMark: 9, shoes: 10, seams: 11, backs: 12, pips: 13, icons: 14, corners: 15, phoneRings: 16, frames: 17 };
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
  const readability = { small: false, scale: 1 };
  const markPlan = {}, pipPlan = {}, pipPoint = {}, targetPlan = {};
  let targetGuard = null;

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

  function phoneIcon(i, icon, x, y, size, z, upright = 1) {
    add(ID.backs, i, x, y, z, size * 0.95, size * 0.95, upright);
    const k = add(ID.icons, i, x, y, z + 0.2, size, size, upright);
    iconCell.array[eSlot[k]] = icon;
  }

  function phoneCount(i, hp, z, offsetX = 0, width) {
    const B = world.bricks;
    phoneMarkLayout(readability, width || B.w[i], B.h[i], markPlan);
    const count = Math.max(1, Math.min(9, hp | 0));
    if (markPlan.digits) {
      const h = markPlan.glyphH, w = h * atlas.userData.inkAspects[count];
      add(ID.backs, i, offsetX, 0, z, w + 3, h + 1, 1);
      const k = add(ID.glyphs, i, offsetX, 0, z + 0.2, w / 20, h / 18, 1);
      glyphCell.array[eSlot[k]] = count;
    } else {
      phonePipLayout(count, markPlan.innerW, markPlan.innerH, readability.scale, pipPlan);
      add(ID.backs, i, offsetX, 0, z, pipPlan.width + 3, pipPlan.height + 3, 1);
      for (let j = 0; j < count; j++) {
        phonePipPosition(j, pipPlan, pipPoint);
        add(ID.pips, i, offsetX + pipPoint.x, pipPoint.y, z + 0.2, pipPlan.size, pipPlan.size, 1);
      }
    }
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
      const amp = readability.small ? 2 : mode === 'bottom' ? 14 : 5;
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
    setReadability(info) {
      readability.small = !!info?.small;
      readability.scale = Math.max(0.05, Number(info?.scale) || 1);
      glyphMat.uniforms.uPhone.value = readability.small ? 1 : 0;
      writeColorVec3(glyphMat.uniforms.uColor.value, PAL.text, readability.small ? 0.9 : 1.25);
      glyphs.renderOrder = readability.small ? 7 : 1;
      targetGuard = null;
    },

    setWorld(w, m) {
      world = w;
      mode = m;
      seamFlashT.fill(-1e9);
      targetGuard = null;
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
      const phone = readability.small;
      const scale = readability.scale;
      const front = zFront + 0.35;
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
          const ballSize = phone ? Math.min(1.8, 6 / (9 * scale)) : 1;
          add(ID.cavBalls, i, 0, 0, 0, ballSize, ballSize, 1, 2);
          add(ID.cavGlows, i, 0, 0, 2, 1, 1, 1, 2);
        } else {
          switch (type) {
            case BRICK.NUMBERED: {
              if (phone) { phoneCount(i, B.hp[i], front); break; }
              const k = add(ID.glyphs, i, 0, 0, zMark, 1, 1, 1);
              glyphCell.array[eSlot[k]] = Math.max(0, Math.min(9, B.hp[i]));
              break;
            }
            case BRICK.EXPLOSIVE:
              if (phone) {
                phoneMarkLayout(readability, B.w[i], B.h[i], markPlan);
                phoneIcon(i, 1, 0, 0, markPlan.icon, front);
              } else add(ID.exRings, i, 0, 0, zMark, 1, 1, 1, 1);
              break;
            case BRICK.CARRIER:
              if (phone) {
                phoneMarkLayout(readability, B.w[i], B.h[i], markPlan);
                phoneIcon(i, 0, 0, 0, markPlan.icon, front); break;
              }
              add(ID.carrierBar, i, halfW - 14, -halfH + 6, zMark, 1, 1);
              add(ID.carrierDot, i, halfW - 23, -halfH + 6, zMark, 1, 1);
              break;
            case BRICK.PORTAL: {
              const j = B.link[i];
              const letter = j >= 0 && j < i ? letterOf[j] : pairK++;
              letterOf[i] = letter;
              const code = 10 + (letter % 6);
              if (phone) {
                phoneMarkLayout(readability, B.w[i], B.h[i], markPlan);
                const size = markPlan.icon, h = size * 0.69, gw = h * atlas.userData.inkAspects[code];
                add(ID.backs, i, 0, 0, front, size + 2, size + 2, 1);
                // A wider torus tube is a readable portal outline instead of a subpixel hairline.
                add(ID.phoneRings, i, 0, 0, front + 0.2, size, size, 1);
                const k = add(ID.glyphs, i, 0, 0, front + 0.4, gw / 20, h / 18, 1);
                glyphCell.array[eSlot[k]] = code;
              } else {
                add(ID.portalRings, i, 0, 0, zMark, 1, 1, 1);
                const k = add(ID.glyphs, i, 0, 0, zMark + 0.1, 0.8, 0.8, 1);
                glyphCell.array[eSlot[k]] = code;
              }
              break;
            }
            case BRICK.GRAVITY:
              if (phone) {
                phoneMarkLayout(readability, B.w[i], B.h[i], markPlan);
                phoneIcon(i, 4, 0, 0, markPlan.icon, front, 0);
              }
              add(ID.clampBar, i, 0, -halfH - 1, 0, sq ? 0.5 : 1, 1);
              add(ID.clampPost, i, -(halfW - 9), -halfH + 3, 0, 1, 1);
              add(ID.clampPost, i, halfW - 9, -halfH + 3, 0, 1, 1);
              add(ID.clampMark, i, 0, -halfH - 1, 7.2, sq ? 0.5 : 1, phone ? Math.min(2.5, 1.25 / (2 * scale)) : 1);
              break;
            case BRICK.ARMOURED: {
              if (phone) {
                // Upright shield hardware occupies a side strip on wide slabs; small square
                // plates keep a contained count with titanium corner brackets below.
                const sideStrip = B.w[i] * scale >= 26;
                if (sideStrip) {
                  const iconSize = Math.min(9 / scale, B.h[i] - 6);
                  phoneIcon(i, 2, -(B.w[i] / 2 - iconSize / 2 - 4), 0, iconSize, front);
                  phoneCount(i, B.hp[i], front, iconSize / 3, B.w[i] - iconSize - 4);
                } else {
                  phoneCount(i, B.hp[i], front);
                  const stroke = Math.min(1.25 / scale, B.w[i] / 8);
                  for (let side = -1; side <= 1; side += 2)
                    add(ID.frames, i, side * (B.w[i] / 2 - stroke / 2 - 1), 0, front + 0.4,
                      stroke, Math.max(8, B.h[i] - 8), 1);
                }
              } else if (f & BF.BOSS) {
                const digit = add(ID.glyphs, i, 0, 0, zFront + 0.2, 1, 1, 1);
                glyphCell.array[eSlot[digit]] = Math.max(1, Math.min(9, B.hp[i]));
              }
              const hits = Math.max(0, (B.hpMax[i] || 3) - Math.max(0, B.hp[i]));
              const n = Math.min(SEAM_X.length, 1 + hits);
              for (let s = 0; s < n; s++) {
                const k = add(ID.seams, i, sq ? SEAM_X[s] * 0.4 : SEAM_X[s], 0, zFront, phone ? Math.min(2.5, 1 / (0.9 * scale)) : 1, sq ? 0.95 : 1, 0, 3, s);
                if (s === n - 1) seamSlotOfBrick[i] = eSlot[k];
              }
              break;
            }
            case BRICK.INDESTRUCTIBLE:
              if (phone) {
                phoneMarkLayout(readability, B.w[i], B.h[i], markPlan);
                phoneIcon(i, 3, 0, 0, markPlan.icon, front);
              }
              break;
            case BRICK.CAVITY:
              if (phone) phoneCount(i, B.hp[i], front);
              break;
            case BRICK.WEAK:
              if (phone) for (let k = 0; k < 8; k++) {
                phoneTargetSegment(k, B.w[i], B.h[i], scale, targetPlan);
                add(ID.backs, i, targetPlan.x, targetPlan.y, front - 0.1, targetPlan.w + 3, targetPlan.h + 3, 1);
                add(ID.corners, i, targetPlan.x, targetPlan.y, front, targetPlan.w, targetPlan.h, 1);
              }
              break;
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
        if (phone) scl.y = 1.1 / (0.7 * scale);
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
      iconCell.needsUpdate = true;
      targetGuard = null;
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
            if (readability.small) {
              eSX[k] = eSY[k] * 18 * atlas.userData.inkAspects[v] / 20;
              brickXY(i, alpha, bxy); pose(k, bxy.x, bxy.y, t); dirty = true;
            }
            glyphCell.needsUpdate = true;
          }
        }
      }
      if (readability.small && phoneCorners.count > 0) {
        const guarded = coreProtected(w);
        if (guarded !== targetGuard) {
          for (let j = 0; j < phoneCorners.count; j++) phoneCorners.setColorAt(j, guarded ? targetCool : targetWarm);
          phoneCorners.instanceColor.needsUpdate = true;
          targetGuard = guarded;
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
