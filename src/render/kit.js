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
 * @param {object} h hooks: { M, onDropAtlas(tex), onModel(id, scene), onPlate(name, tex), aniso }
 * @returns {Promise<Set<string>>} the final files that were found
 */
export async function loadKit(h, base = KIT_BASE) {
  let ready;
  try {
    const r = await fetch(`${base}ARTKIT.READY`, { cache: 'no-cache' });
    if (!r.ok) return new Set();
    ready = parseReady(await r.text());
  } catch {
    return new Set();
  }
  // Images decode off the main thread as ImageBitmaps where that is reliable (the same test as
  // three's GLTFLoader), and each texture is uploaded as soon as it arrives (h.gl.initTexture), so
  // a 1024 x 1536 plate never stalls a frame of play when it is first drawn.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const safari = /^((?!chrome|android).)*safari/i.test(ua) ? Number((ua.match(/Version\/(\d+)/) || [0, 0])[1]) : -1;
  const firefox = ua.includes('Firefox') ? Number((ua.match(/Firefox\/(\d+)/) || [0, 0])[1]) : -1;
  const bitmaps = typeof createImageBitmap !== 'undefined' && !(safari >= 0 && safari < 17) && !(firefox >= 0 && firefox < 98);
  const texLoader = new THREE.TextureLoader();
  const bmpLoader = bitmaps ? new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
  const tex = (path, srgb, repeat = true) => new Promise((resolve) => {
    if (!ready.has(path)) return resolve(null);
    const done = (t) => {
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = h.aniso || 4;
      if (h.gl && h.gl.initTexture) {
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
      }, undefined, () => texLoader.load(url, done, undefined, () => resolve(null)));
    } else texLoader.load(url, done, undefined, () => resolve(null));
  });
  const M = h.M;
  const jobs = [];

  // ceramic crackle (core map + normal), on the bricks, embers and ceramic fragments
  jobs.push(Promise.all([tex('textures/crackle.png', true), tex('textures/crackle_n.png', false)]).then(([c, n]) => {
    if (!c || !n) return;
    for (const m of [M.core, M.fragCeramic, M.bossCore]) {
      if (!m) continue;
      m.map = c;
      if (m.normalMap !== undefined && m !== M.fragCeramic) m.normalMap = n;
      m.needsUpdate = true;
    }
    M.tex.crackle = c;
    M.tex.crackleN = n;
  }));

  // indestructible matte black: a very low-contrast obsidian detail (it still reflects nothing)
  jobs.push(Promise.all([tex('textures/obsidian.png', true), tex('textures/obsidian_n.png', false)]).then(([o, on]) => {
    if (!o) return;
    for (const m of [M.matte, M.matteP]) {
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
    if (!t) return;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (h.onDropAtlas) h.onDropAtlas(t);
  }));

  // boss meshes
  const models = ['stoker', 'crucible', 'core'].filter((id) => ready.has(`models/${id}.glb`));
  if (models.length && h.onModel) {
    jobs.push(import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
      const gl = new GLTFLoader();
      return Promise.all(models.map((id) => new Promise((resolve) => {
        gl.load(`${base}models/${id}.glb`, (g) => { h.onModel(id, g.scene); resolve(); }, undefined, () => resolve());
      })));
    }).catch(() => {}));
  }

  // headroom plates (ART 12a): img/headroom/<name>.webp when final
  if (h.onPlate) {
    for (const path of ready) {
      const m = /^img\/headroom\/([\w-]+)\.(webp|png|jpg)$/.exec(path);
      if (!m) continue;
      // masks (_glow, _mask) are linear grey; plates and mid layers are sRGB
      jobs.push(tex(path, !/_(glow|mask)$/.test(m[1]), false).then((t) => { if (t) h.onPlate(m[1], t); }));
    }
    if (ready.has('img/backdrop.webp')) jobs.push(tex('img/backdrop.webp', true, false).then((t) => { if (t) h.onPlate('backdrop', t); }));
  }

  await Promise.all(jobs);
  return ready;
}
