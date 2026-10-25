// Kiln: post-processing (OWNER: C). ACES tone mapping, half-resolution UnrealBloomPass (strength
// 0.55, radius 0.25, threshold 0.9), HalfFloat target with 4x MSAA. The output pass also carries
// the last-life desaturation (10%). Lite has no bloom: straight to the canvas when the canvas is
// multisampled (booted in lite), else through the composer's 2x target with the bloom pass off.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOOK } from './look.js';
import { BALL_BLOOM, writeBallBloom } from './ball-bloom.js';

const MSAA_PARAM = (() => {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('msaa') : null;
  return v === '0' || v === '2' || v === '4' ? Number(v) : -1;
})();

export function createPost(gl, scene, camera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(gl, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), LOOK.BLOOM_STRENGTH, LOOK.BLOOM_RADIUS, LOOK.BLOOM_THRESHOLD);
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
  // ART 12b: protect the paddle from fire bloom and each visible gameplay ball from the
  // surrounding bloom. Soft circles use the same 15% floor as the paddle capsule, and max
  // protection keeps overlapping regions from multiplying into a dark cut.
  const cm = bloom.compositeMaterial;
  Object.assign(cm.uniforms, {
    uMaskA: { value: new THREE.Vector2(-1e4, -1e4) },
    uMaskB: { value: new THREE.Vector2(-1e4, -1e4) },
    uMaskR: { value: 1 },
    uMaskF: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uBallMasks: { value: new Float32Array(BALL_BLOOM.MAX * 4) },
    uBallMaskCount: { value: 0 },
  });
  const fs = cm.fragmentShader;
  const end = fs.lastIndexOf('}');
  cm.fragmentShader = fs.slice(0, end).replace('void main() {', `uniform vec2 uMaskA, uMaskB, uRes; uniform float uMaskR, uMaskF;
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
    void main() {`) + '\n  gl_FragColor *= 1.0 - 0.85 * max(paddleBand(), ballBand());\n}';
  cm.needsUpdate = true;

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
      cm.uniforms.uRes.value.set(W * pr, H * pr);
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
      cm.uniforms.uMaskA.value.set(ax, ay);
      cm.uniforms.uMaskB.value.set(bx, by);
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
