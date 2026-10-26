// Kiln: the single tight bloom side chain. All intermediate draws stay linear and unblended.
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { BALL_BLOOM } from './ball-bloom.js';
import { LOOK } from './look.js';

export const BLOOM_GUARD_GLSL = `uniform vec2 uMaskA, uMaskB, uRes; uniform float uMaskR, uMaskF;
  uniform vec4 uBallMasks[${BALL_BLOOM.MAX}]; uniform int uBallMaskCount;
  float paddleBand(){
    vec2 p = vUv * uRes, pa = p - uMaskA, ba = uMaskB - uMaskA;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    return 1.0 - smoothstep(uMaskR, uMaskR + uMaskF, length(pa - ba * k));
  }
  float ballBand(){
    if (uBallMaskCount == 0) return 0.0;
    vec2 p = vUv * uRes;
    float band = 0.0;
    for (int i = 0; i < ${BALL_BLOOM.MAX}; i++) {
      if (i >= uBallMaskCount) break;
      vec4 mask = uBallMasks[i];
      band = max(band, 1.0 - smoothstep(mask.z, mask.z + mask.w, length(p - mask.xy)));
    }
    return band;
  }
  float bloomTransmission(){ return 1.0 - max(paddleBand(), ballBand()); }`;

const VERTEX = `varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** The retained radius-three kernel samples offsets 0,+/-1,+/-2 with sigma 1.2. */
export function tightBloomWeights() {
  return new Float32Array([0, 1, 2].map(i => Math.exp(-0.5 * i * i / (1.2 * 1.2))));
}

/** Native composite scales RGBA before SRC_ALPHA,ONE: this factor is used twice in RGB. */
export function tightBloomFactor(strength, radius) {
  return strength * (1 + (0.2 - 1) * radius);
}

export class TightBloomPass extends Pass {
  constructor(guards) {
    super();
    this.needsSwap = false;
    this.strength = LOOK.BLOOM_STRENGTH;
    this.radius = LOOK.BLOOM_RADIUS;
    this.threshold = LOOK.BLOOM_THRESHOLD;
    this.targets = {};
    for (const name of ['bright', 'horizontal', 'vertical']) {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0,
      });
      target.texture.name = `KilnBloom.${name}`;
      target.texture.generateMipmaps = false;
      this.targets[name] = target;
    }
    this.texture = this.targets.vertical.texture;
    this.materialHighPassFilter = new THREE.ShaderMaterial({
      name: 'KilnBloomBright', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: { tDiffuse: { value: null }, luminosityThreshold: { value: this.threshold },
        smoothWidth: { value: 0.01 }, ...guards },
      vertexShader: VERTEX,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse;
        uniform float luminosityThreshold, smoothWidth;
        ${BLOOM_GUARD_GLSL}
        void main(){
          vec4 texel = texture2D(tDiffuse, vUv);
          float luminance = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, luminance);
          gl_FragColor = texel * alpha;
          gl_FragColor *= bloomTransmission();
        }`,
    });
    this.blurMaterial = new THREE.ShaderMaterial({
      name: 'KilnBloomBlur', depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms: { colorTexture: { value: null }, invSize: { value: new Float32Array([1, 1]) },
        direction: { value: new Float32Array(2) }, gaussianCoefficients: { value: tightBloomWeights() } },
      vertexShader: VERTEX,
      fragmentShader: `varying vec2 vUv; uniform sampler2D colorTexture;
        uniform vec2 invSize, direction; uniform float gaussianCoefficients[3];
        void main(){
          float weightSum = gaussianCoefficients[0];
          vec3 diffuseSum = texture2D(colorTexture, vUv).rgb * weightSum;
          for (int i = 1; i < 3; i++) {
            float weight = gaussianCoefficients[i];
            vec2 offset = direction * invSize * float(i);
            diffuseSum += (texture2D(colorTexture, vUv + offset).rgb + texture2D(colorTexture, vUv - offset).rgb) * weight;
            weightSum += 2.0 * weight;
          }
          // Pinned native blur convolves RGB and writes alpha one, not a blurred coverage mask.
          gl_FragColor = vec4(diffuseSum / weightSum, 1.0);
        }`,
    });
    // Own this geometry rather than disposing r160's shared FullScreenQuad triangle.
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    this.mesh = new THREE.Mesh(this.geometry, this.materialHighPassFilter);
    this.mesh.frustumCulled = false;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.disposed = false;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.round(width / 2)), h = Math.max(1, Math.round(height / 2));
    for (const target of Object.values(this.targets)) target.setSize(w, h);
    const inv = this.blurMaterial.uniforms.invSize.value;
    inv[0] = 1 / w; inv[1] = 1 / h;
  }

  render(renderer, writeBuffer, readBuffer) {
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      const bright = this.materialHighPassFilter;
      bright.uniforms.tDiffuse.value = readBuffer.texture;
      bright.uniforms.luminosityThreshold.value = this.threshold;
      this.mesh.material = bright;
      renderer.setRenderTarget(this.targets.bright);
      renderer.render(this.mesh, this.camera);
      const u = this.blurMaterial.uniforms;
      this.mesh.material = this.blurMaterial;
      u.colorTexture.value = this.targets.bright.texture;
      u.direction.value[0] = 1; u.direction.value[1] = 0;
      renderer.setRenderTarget(this.targets.horizontal);
      renderer.render(this.mesh, this.camera);
      u.colorTexture.value = this.targets.horizontal.texture;
      u.direction.value[0] = 0; u.direction.value[1] = 1;
      renderer.setRenderTarget(this.targets.vertical);
      renderer.render(this.mesh, this.camera);
    } finally {
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(target);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const target of Object.values(this.targets)) target.dispose();
    this.materialHighPassFilter.dispose();
    this.blurMaterial.dispose();
    this.geometry.dispose();
  }
}
