// Kiln: boss meshes (OWNER: C). The boss's hit body is bricks (drawn by bricks.js); this is the
// armour and frame around and behind them, at world.boss.x/y/angle (interpolated), with
// world.boss.open driving the pose (jaw, ring gap, shields). ART 8:
//   The Stoker   a furnace head: titanium brow and cheeks, matte throat, one heat-low port glow
//   The Crucible a rotating ring of titanium plates around a white-hot core
//   The Core     a sphere of contained white heat behind rotating titanium shields
// Procedural until F's models/<id>.glb is final in ARTKIT.READY; then the glTF scene replaces it,
// its materials swapped by name (titanium, matte, core, metal) for the renderer's own.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FIELD } from '../core/constants.js';
import { PAL, coreMaterial } from './materials.js';

const HW = FIELD.W / 2;
const HH = FIELD.H / 2;

export function createBoss(scene, M) {
  const root = new THREE.Group();
  root.name = 'boss';
  root.position.z = -26;
  root.visible = false;
  scene.add(root);

  const hotCore = coreMaterial(M.tex, { instanced: false, heat: 1.25 });
  M.bossCore = hotCore;
  const glowMat = new THREE.MeshBasicMaterial({
    map: M.tex.glow, color: PAL.heatLo.clone(), transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // ---- The Stoker ----
  const stoker = new THREE.Group();
  {
    const brow = new THREE.Mesh(new RoundedBoxGeometry(460, 46, 30, 3, 6), M.titaniumP);
    brow.position.set(0, 120, 0);
    const cheekGeo = new RoundedBoxGeometry(46, 230, 30, 3, 6);
    const cl = new THREE.Mesh(cheekGeo, M.titaniumP);
    const cr = new THREE.Mesh(cheekGeo, M.titaniumP);
    cl.position.set(-230, 10, 0);
    cr.position.set(230, 10, 0);
    const throat = new THREE.Mesh(new THREE.PlaneGeometry(420, 210), M.matteP);
    throat.position.set(0, 10, -14);
    const jaw = new THREE.Mesh(new RoundedBoxGeometry(400, 30, 26, 3, 6), M.darkMetalP);
    jaw.position.set(0, -100, 0);
    const port = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), glowMat);
    port.position.set(0, 40, -10);
    stoker.add(brow, cl, cr, throat, jaw, port);
    stoker.userData = { jaw, port };
  }

  // ---- The Crucible ----
  const crucible = new THREE.Group();
  {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(48, 3), hotCore);
    const ring = new THREE.Group();
    const plateGeo = new RoundedBoxGeometry(70, 26, 22, 2, 5);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = new THREE.Mesh(plateGeo, M.titaniumP);
      p.position.set(Math.cos(a) * 150, Math.sin(a) * 150, 0);
      p.rotation.z = a + Math.PI / 2;
      ring.add(p);
    }
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), glowMat);
    halo.position.z = -20;
    crucible.add(halo, core, ring);
    crucible.userData = { ring, core };
  }

  // ---- The Core ----
  const coreBoss = new THREE.Group();
  {
    const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(70, 3), hotCore);
    const shields = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(115, 14, 8, 48, Math.PI * 0.5), M.titaniumP);
      s.rotation.z = (i / 3) * Math.PI * 2;
      shields.add(s);
    }
    const outer = new THREE.Mesh(new THREE.TorusGeometry(150, 4, 8, 96), M.matteP);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(340, 340), glowMat);
    halo.position.z = -30;
    coreBoss.add(halo, heart, shields, outer);
    coreBoss.userData = { shields, heart };
  }

  const placeholders = { stoker, crucible, core: coreBoss };
  const models = {};
  for (const k in placeholders) {
    placeholders[k].visible = false;
    root.add(placeholders[k]);
  }
  let current = null;
  let id = '';

  // F's `ember` material: the dim heat behind the weak-point cells, breathing with the boss, always
  // far below the W cells (ARTKIT "Boss meshes")
  const emberMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.8, metalness: 0, envMapIntensity: 0.2 });
  emberMat.emissive.copy(PAL.heatLo);
  emberMat.emissiveIntensity = 0.28;
  // a hidden carrier so the boot shader warm-up compiles it before the glb arrives
  const emberWarm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), emberMat);
  emberWarm.visible = false;
  root.add(emberWarm);

  /**
   * Swap a loaded glTF scene in for a boss id: materials replaced by name, and the `part-<name>`
   * nodes kept for the per-node drive (never turn the whole scene: cradle and frame are static).
   */
  function setModel(bossId, gltfScene) {
    const parts = {};
    gltfScene.traverse((o) => {
      if (o.name && o.name.startsWith('part-') && !/_\d+$/.test(o.name)) parts[o.name] = o;
      if (!o.isMesh) return;
      const n = (o.material && o.material.name || '').toLowerCase();
      if (n.includes('titanium')) o.material = M.titaniumP;
      else if (n.includes('matte')) o.material = M.matteP;
      else if (n.includes('ember')) o.material = emberMat;
      else if (n.includes('core')) o.material = hotCore;
      else if (n.includes('metal')) o.material = M.darkMetalP;
    });
    gltfScene.userData.parts = parts;
    gltfScene.visible = false;
    root.add(gltfScene);
    models[bossId] = gltfScene;
    if (bossId === id) pick();
  }

  function pick() {
    for (const k in placeholders) placeholders[k].visible = false;
    for (const k in models) models[k].visible = false;
    current = models[id] || placeholders[id] || null;
    if (current) current.visible = true;
    // F's meshes are built around the brick plane (rims come forward to z +13); placeholders sit back
    root.position.z = current && current.userData.parts ? 0 : -26;
  }

  /** ARTKIT "Boss meshes" drive table. */
  function driveModel(parts, B, ang, open) {
    const jaw = parts['part-jaw'];
    if (jaw) jaw.position.y = -open * 60;
    const ring = parts['part-ring'];
    if (ring) ring.rotation.z = -ang;
    const s1 = parts['part-shell'], s2 = parts['part-shell-s2'], s3 = parts['part-shell-s3'], so = parts['part-outer-shell'];
    if (s1) { s1.visible = B.phase <= 1; s1.rotation.z = -ang; }
    if (s2) { s2.visible = B.phase === 2; s2.rotation.z = -ang; }
    if (s3) { s3.visible = B.phase >= 3; s3.rotation.z = -ang; }
    if (so) { so.visible = B.phase >= 3; so.rotation.z = -((B.data && B.data.angle2) || 0); }
  }

  return {
    setModel,

    setWorld(world) {
      id = world.boss && world.boss.id ? world.boss.id : (world.level.def.boss || '');
      pick();
      root.visible = !!current;
    },

    frame(world, alpha, t, fire) {
      const B = world.boss;
      if (!B || !B.active || !current) {
        root.visible = false;
        if (B && B.id && B.id !== id) { id = B.id; pick(); }
        return;
      }
      if (B.id !== id) { id = B.id; pick(); }
      root.visible = true;
      root.position.x = B.px + (B.x - B.px) * alpha - HW;
      root.position.y = HH - (B.py + (B.y - B.py) * alpha);
      const ang = B.pangle + (B.angle - B.pangle) * alpha;
      const open = Math.max(0, Math.min(1, B.open || 0));
      // molten, only the very centre whitening: a big white-hot sphere outshone the ball (ART 8:
      // the ball is always the brightest thing); The Core's heart is the largest, so the coolest
      const big = current === coreBoss;
      hotCore.userData.u.uHeatValue.value = (big ? 0.9 : 0.98) + 0.08 * Math.sin(t * 2.2) + (big ? 0.12 : 0.15) * fire;
      emberMat.emissiveIntensity = 0.22 + 0.04 * Math.sin(t * 2.2) + 0.1 * fire + 0.08 * open;
      if (current.userData.parts) {
        driveModel(current.userData.parts, B, ang, open);
      } else if (current === stoker) {
        stoker.userData.jaw.position.y = -100 - open * 40;
        glowMat.opacity = 0.35 + 0.35 * fire + 0.3 * open;
      } else if (current === crucible) {
        crucible.userData.ring.rotation.z = -ang;
        glowMat.opacity = 0.45 + 0.3 * fire;
      } else if (current === coreBoss) {
        const sh = coreBoss.userData.shields;
        sh.rotation.z = -ang;
        sh.scale.setScalar(1 + open * 0.35);
        glowMat.opacity = 0.5 + 0.3 * fire + 0.2 * open;
      } else {
        current.rotation.z = -ang;
      }
    },
  };
}
