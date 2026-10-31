// Kiln: loading F's art kit (OWNER: C). ARTKIT.md is the contract; ARTKIT.READY lists the files
// that are final. Only final files are loaded; everything else keeps the renderer's procedural
// stand-in, so the game never waits on the kit and never breaks when a file is missing.
// Loads run in the background after the first frame; each swap is one assignment.

import * as THREE from 'three';

export const KIT_BASE = new URL('../../', import.meta.url).href;

/** Parse ARTKIT.READY: one "path date" per line, '#' comments. */
export function parseReady(text) {
  const out = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const path = line.split(/\s+/)[0];
    if (/^[\w./-]+\.\w+$/.test(path)) out.add(path);
  }
  return out;
}

/**
 * @param {object} h hooks: { M, onDropAtlas(tex), onModel(id, scene), onPlate(name, tex), onHeadroomReady(ready, decode), aniso, isDisposed?, canUpload? }
 * @returns {Promise<Set<string>>} the final files that were found
 */
export async function loadKit(h, base = KIT_BASE) {
  const inactive = () => !!h.isDisposed?.();
  const discarded = new WeakSet();
  function discardTexture(texture) {
    if (!texture || discarded.has(texture)) return;
    discarded.add(texture);
    texture.dispose();
    texture.image?.close?.();
  }
  function discardModel(model) {
    const resources = new Set();
    model.traverse((object) => {
      if (object.geometry) resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) discardTexture(value);
      }
    });
    for (const resource of resources) resource.dispose();
  }
  if (inactive()) return new Set();
  let ready;
  try {
    const r = await fetch(`${base}ARTKIT.READY`, { cache: 'no-cache' });
    if (!r.ok) return new Set();
    ready = parseReady(await r.text());
  } catch {
    return new Set();
  }
  if (inactive()) return new Set();
  // Images decode off the main thread as ImageBitmaps where that is reliable (the same test as
  // three's GLTFLoader). Upload an arriving texture while the context is valid to reduce
  // first-use work. Upload and runtime shader preparation are still synchronous work.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const safari = /^((?!chrome|android).)*safari/i.test(ua) ? Number((ua.match(/Version\/(\d+)/) || [0, 0])[1]) : -1;
  const firefox = ua.includes('Firefox') ? Number((ua.match(/Firefox\/(\d+)/) || [0, 0])[1]) : -1;
  const bitmaps = typeof createImageBitmap !== 'undefined' && !(safari >= 0 && safari < 17) && !(firefox >= 0 && firefox < 98);
  const texLoader = new THREE.TextureLoader();
  const bmpLoader = bitmaps ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
  const tex = (path, srgb, repeat = true, upload = true) => new Promise((resolve) => {
    if (inactive() || !ready.has(path)) return resolve(null);
    const done = (t) => {
      if (inactive()) { discardTexture(t); resolve(null); return; }
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = h.aniso || 4;
      if (upload && h.gl && h.gl.initTexture && (!h.canUpload || h.canUpload())) {
        try { h.gl.initTexture(t); } catch { /* uploads on first draw instead */ }
      }
      resolve(t);
    };
    const url = `${base}${path}`;
    if (bmpLoader) {
      bmpLoader.load(url, (bmp) => {
        const t = new THREE.Texture(bmp);
        t.flipY = false; // flipped at decode
        t.needsUpdate = true;
        done(t);
      }, undefined, () => {
        if (inactive()) resolve(null);
        else texLoader.load(url, done, undefined, () => resolve(null));
      });
    } else texLoader.load(url, done, undefined, () => resolve(null));
  });
  // Headroom has its own bounded current/prefetch owner. Expose decode-only loading before
  // the common jobs finish, without making their completion wait on optional world art.
  h.onHeadroomReady?.(ready, (path, srgb) => tex(path, srgb, false, false));
  const M = h.M;
  const jobs = [];

  // Keep the registered glaze, grooves and optional vein mask in one swap. Native material
  // samplers retain ownership and enter the same upload, warm-up and context-restore paths.
  jobs.push(Promise.all([tex('textures/crackle.png', true), tex('textures/crackle_n.png', false), tex('textures/crackle_mask.png', false)]).then(([c, n, mask]) => {
    if (inactive() || !c || !n) { discardTexture(c); discardTexture(n); discardTexture(mask); return; }
    for (const m of [M.core, M.fragCeramic, M.bossCore]) {
      if (!m) continue;
      m.map = c;
      if (m.normalMap !== undefined && m !== M.fragCeramic) m.normalMap = n;
      if (m !== M.fragCeramic) {
        m.emissiveMap = mask || c;
        if (m.userData?.u?.uVeinMask) m.userData.u.uVeinMask.value = mask ? 1 : 0;
      }
      m.needsUpdate = true;
    }
    M.tex.crackle = c;
    M.tex.crackleN = n;
    if (mask) M.tex.crackleMask = mask;
  }));

  // indestructible matte black: a very low-contrast obsidian detail (it still reflects nothing)
  jobs.push(Promise.all([tex('textures/obsidian.png', true), tex('textures/obsidian_n.png', false)]).then(([o, on]) => {
    if (inactive() || !o) { discardTexture(o); discardTexture(on); return; }
    for (const m of [M.matte, M.matteP, M.matteFree]) {
      if (!m) continue;
      m.map = o;
      if (on) {
        m.normalMap = on;
        m.normalScale = new THREE.Vector2(0.6, 0.6);
      }
      m.needsUpdate = true;
    }
  }));

  // drop glyph atlas (4 x 3 cells, DROP_NAMES order)
  jobs.push(tex('glyphs/drops.png', true, false).then((t) => {
    if (!t || inactive()) { discardTexture(t); return; }
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (h.onDropAtlas) h.onDropAtlas(t);
  }));

  // boss meshes
  const models = ['stoker', 'crucible', 'core'].filter((id) => ready.has(`models/${id}.glb`));
  if (models.length && h.onModel) {
    jobs.push(import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      if (inactive()) return;
      const gl = new GLTFLoader();
      return Promise.all(models.map((id) => new Promise((resolve) => {
        gl.load(`${base}models/${id}.glb`, (g) => {
          if (inactive()) discardModel(g.scene);
          else h.onModel(id, g.scene);
          resolve();
        }, undefined, () => resolve());
      })));
    }).catch(() => {}));
  }

  // Keep the shared backdrop on its existing loader path; its future consumer is C5 work.
  if (h.onPlate && ready.has('img/backdrop.webp')) jobs.push(tex('img/backdrop.webp', true, false)
    .then((t) => { if (inactive()) discardTexture(t); else if (t) h.onPlate('backdrop', t); }));

  await Promise.all(jobs);
  return ready;
}
