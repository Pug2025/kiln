// Kiln: post-processing (OWNER: C). ACES tone mapping, half-resolution UnrealBloomPass (strength
// 0.18, radius 0.10, threshold 0.9, one tight mip), HalfFloat target with 4x MSAA. The output pass also carries
// the last-life desaturation (10%). Lite has no bloom: straight to the canvas when the canvas is
// multisampled (booted in lite), else through the composer's 2x target with the bloom pass off.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOOK } from './look.js';
import { BALL_BLOOM, writeBallBloom, paddleBloomRadius } from './ball-bloom.js';

const MSAA_PARAM = (() => {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('msaa') : null;
  return v === '0' || v === '2' || v === '4' ? Number(v) : -1;
})();

// Item 19 keeps only the tightest glow scale, without the broad scattering blur pairs.
// Pin the native source before changing its hardcoded five-sampler composite. A vendor update
// must be reviewed rather than silently reading textures that were never rendered.
function useTightBloomMip(bloom) {
  const cm = bloom.compositeMaterial;
  const pinned = `varying vec2 vUv;
				uniform sampler2D blurTexture1;
				uniform sampler2D blurTexture2;
				uniform sampler2D blurTexture3;
				uniform sampler2D blurTexture4;
				uniform sampler2D blurTexture5;
				uniform float bloomStrength;
				uniform float bloomRadius;
				uniform float bloomFactors[NUM_MIPS];
				uniform vec3 bloomTintColors[NUM_MIPS];

				float lerpBloomFactor(const in float factor) {
					float mirrorFactor = 1.2 - factor;
					return mix(factor, mirrorFactor, bloomRadius);
				}

				void main() {
					gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
						lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
						lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
						lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
						lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );
				}`;
  if (bloom.nMips !== 5 || cm.defines.NUM_MIPS !== 5 || cm.fragmentShader !== pinned
    || bloom.renderTargetsHorizontal.length !== 5 || bloom.renderTargetsVertical.length !== 5
    || bloom.separableBlurMaterials.length !== 5 || cm.uniforms.bloomFactors.value.length !== 5
    || bloom.bloomTintColors.length !== 5) throw new Error('Kiln bloom requires the pinned r160 five-mip source');
  cm.fragmentShader = pinned
    .replace(/\n\t{4}uniform sampler2D blurTexture[2-5];/g, '')
    .replace(/texture2D\(blurTexture1, vUv\) \+[\s\S]*?texture2D\(blurTexture5, vUv\)/,
      'texture2D(blurTexture1, vUv)');
  bloom.nMips = cm.defines.NUM_MIPS = 1;
  cm.uniforms.bloomFactors.value.length = 1;
  bloom.bloomTintColors.length = 1;
  for (let i = 2; i <= 5; i++) delete cm.uniforms[`blurTexture${i}`];
  cm.needsUpdate = true;
  // Keep all five constructor targets/materials owned. Native disposal loops their full array
  // lengths, while rendering/resizing loops only nMips, so inactive resources are never sampled.
}

export function createPost(gl, scene, camera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(gl, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), LOOK.BLOOM_STRENGTH, LOOK.BLOOM_RADIUS, LOOK.BLOOM_THRESHOLD);
  useTightBloomMip(bloom);
  // round halos (C call, review 2026-10-22): three's blur kernels use sigma = kernel radius and stop
  // at one sigma, which is nearly a box filter, so a small bright source (the ball) bloomed as a soft
  // square. Sigma = radius / 2.5 makes each pass a true Gaussian (the 2D result is round); the shader
  // normalises the weights, so the strength is unchanged.
  for (const m of bloom.separableBlurMaterials) {
    const R = m.defines.KERNEL_RADIUS;
    const s = R / 2.5;
    const c = m.uniforms.gaussianCoefficients.value;
    for (let i = 0; i < R; i++) c[i] = Math.exp((-0.5 * i * i) / (s * s));
  }
  const output = new OutputPass();
  // desaturation for the last-life escalation, applied after tone mapping, before sRGB
  output.material.uniforms.uSat = { value: 1 };
  output.material.fragmentShader = output.material.fragmentShader
    .replace('void main() {', 'uniform float uSat;\nvoid main() {')
    .replace('// color space', 'gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, uSat);\n\t// color space');
  // Item 19: no bloom on the paddle or balls. Suppress their bright source before blur, then
  // reject surrounding bloom at the final full-resolution additive blend. Guarding only the
  // half-resolution composite would let its later interpolation bleed across the sharp edge.
  const cm = bloom.compositeMaterial;
  const guards = {
    uMaskA: { value: new Float32Array([-1e4, -1e4]) },
    uMaskB: { value: new Float32Array([-1e4, -1e4]) },
    uMaskR: { value: 1 },
    uMaskF: { value: 1 },
    uRes: { value: new Float32Array([1, 1]) },
    uBallMasks: { value: new Float32Array(BALL_BLOOM.MAX * 4) },
    uBallMaskCount: { value: 0 },
  };
  // Keep the existing public composite uniforms as aliases to the same fixed buffers.
  Object.assign(cm.uniforms, guards);
  const guardGLSL = `uniform vec2 uMaskA, uMaskB, uRes; uniform float uMaskR, uMaskF;
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
    float bloomTransmission(){ return 1.0 - max(paddleBand(), ballBand()); }
    void main() {`;
  for (const material of [bloom.materialHighPassFilter, bloom.blendMaterial]) {
    Object.assign(material.uniforms, guards);
    const fs = material.fragmentShader, end = fs.lastIndexOf('}');
    // The final non-premultiplied additive draw uses SRC_ALPHA, ONE. Preserve its native alpha
    // so the feather weights RGB once, rather than squaring the transmission in the blend.
    const channel = material === bloom.blendMaterial ? '.rgb' : '';
    material.fragmentShader = fs.slice(0, end).replace('void main() {', guardGLSL)
      + `\n  gl_FragColor${channel} *= bloomTransmission();\n}`;
    material.needsUpdate = true;
  }

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);

  let useBloom = true;
  let msaaOff = false;
  // canvasAA: the canvas itself is multisampled (the renderer asks for that only when it boots in
  // lite). Without it, lite still goes through the composer (its 2x MSAA target, no bloom) so its
  // edges stay smooth; with it, lite draws straight to the canvas. Full quality always uses the
  // composer's target, so a full-quality canvas needs neither MSAA nor depth (review 2026-10-22).
  const canvasAA = !!gl.getContextAttributes()?.antialias;

  return {
    composer,
    bloom,
    canvasAA,
    paddleBloomRadius,

    /** Lite draws straight to the canvas (the CSS filter then carries the last-life desaturation). */
    get direct() {
      return !useBloom && canvasAA;
    },

    setSize(W, H, pr) {
      // MSAA: 4x at low pixel ratios; at 2x the pixels are small enough that 2x samples hold the
      // glass edges, at half the resolve cost on a phone GPU (C call). Lite through the composer: 2x
      // at 1x pixel ratio. ?msaa=0|2|4 overrides (QA).
      // The quality ladder's first step turns it off (msaaOff).
      const s = MSAA_PARAM >= 0 ? MSAA_PARAM : msaaOff ? 0 : !useBloom ? LOOK.MSAA_LITE : pr >= 1.75 ? LOOK.MSAA_HI_DPR : LOOK.MSAA;
      if (composer.renderTarget1.samples !== s) {
        for (const t of [composer.renderTarget1, composer.renderTarget2]) { t.samples = s; t.dispose(); }
      }
      composer.setPixelRatio(pr);
      // the composer hands every pass the full drawing size, and UnrealBloomPass halves it itself:
      // that IS the half-resolution bloom of ART 7 (a second halving here ran the bright pass at a
      // quarter and drew a square halo round the ball: review 2026-10-22)
      composer.setSize(W, H);
      cm.uniforms.uRes.value[0] = W * pr;
      cm.uniforms.uRes.value[1] = H * pr;
    },

    setBloom(on) {
      useBloom = on;
      bloom.enabled = on;
      if (!on) this.clearBallMasks();
    },

    /** The quality ladder: composer MSAA off (applies at the next setSize). */
    setMsaaOff(off) {
      msaaOff = !!off;
    },

    get bloomOn() {
      return useBloom;
    },

    /** Paddle capsule in drawing-buffer pixels (origin bottom-left), radius and feather in pixels. */
    setBloomMask(ax, ay, bx, by, r, f) {
      cm.uniforms.uMaskA.value[0] = ax;
      cm.uniforms.uMaskA.value[1] = ay;
      cm.uniforms.uMaskB.value[0] = bx;
      cm.uniforms.uMaskB.value[1] = by;
      cm.uniforms.uMaskR.value = r;
      cm.uniforms.uMaskF.value = f;
    },

    /** Gameplay circles, after the actual camera moved; the paddle mask stays in place. */
    setBallMasks(world, alpha, clip, width, height, gameplay) {
      cm.uniforms.uBallMaskCount.value = writeBallBloom(cm.uniforms.uBallMasks.value,
        world, alpha, clip, width, height, useBloom && gameplay);
    },

    clearBallMasks() {
      cm.uniforms.uBallMaskCount.value = 0;
      cm.uniforms.uBallMasks.value.fill(0);
    },

    setSaturation(s) {
      output.material.uniforms.uSat.value = s;
    },

    render() {
      if (!useBloom && canvasAA) gl.render(scene, camera);
      else composer.render();
    },

    dispose() {
      rt.dispose();
      composer.dispose?.();
      bloom.dispose?.();
    },
  };
}
