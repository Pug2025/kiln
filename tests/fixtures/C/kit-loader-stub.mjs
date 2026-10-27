// Controlled IO boundaries for actual kit.js lifecycle tests; no DOM, network or GPU.
export const STUB = { requests: [], textures: [], bitmapOptions: [] };
export function reset() { STUB.requests.length = STUB.textures.length = STUB.bitmapOptions.length = 0; }
export class Texture {
  constructor(image = null) { this.image = image; this.isTexture = true; this.disposals = 0; STUB.textures.push(this); }
  dispose() { this.disposals++; }
}
export class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }
export class TextureLoader {
  load(url, onLoad, progress, onError) { STUB.requests.push({ kind: 'texture', url, onLoad, onError }); }
}
export class ImageBitmapLoader {
  setOptions(options) { STUB.bitmapOptions.push(options); return this; }
  load(url, onLoad, progress, onError) { STUB.requests.push({ kind: 'bitmap', url, onLoad, onError }); }
}
export class GLTFLoader {
  load(url, onLoad, progress, onError) { STUB.requests.push({ kind: 'model', url, onLoad, onError }); }
}
export const RepeatWrapping = 1000, SRGBColorSpace = 'srgb', NoColorSpace = '', LinearMipmapLinearFilter = 1008;
