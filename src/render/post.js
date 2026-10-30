// Kiln: one linear Full/Lite scene route, three tight bloom draws and one guarded output.
// Only the output applies ACES, last-life saturation and sRGB. Lite skips every bloom draw.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOOK } from './look.js';
import { BALL_BLOOM, writeBallBloom, paddleBloomRadius } from './ball-bloom.js';
import { TightBloomPass, BLOOM_GUARD_GLSL, tightBloomFactor } from './bloom.js';

const MSAA_PARAM = (() => {
  const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('msaa') : null;
  return v === '0' || v === '2' || v === '4' ? Number(v) : -1;
})();

function replaceOnce(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Kiln output requires the pinned r160 shader');
  return source.replace(anchor, replacement);
}

export function createPost(gl, scene, camera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(gl, rt);
  const renderPass = new RenderPass(scene, camera);
  const guards = {
    uMaskA: { value: new Float32Array([-1e4, -1e4]) },
    uMaskB: { value: new Float32Array([-1e4, -1e4]) },
    uMaskR: { value: 1 }, uMaskF: { value: 1 },
    uRes: { value: new Float32Array([1, 1]) },
    uBallMasks: { value: new Float32Array(BALL_BLOOM.MAX * 4) },
    uBallMaskCount: { value: 0 },
  };
  const bloom = new TightBloomPass(guards);
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  blank.name = 'KilnBloom.black';
  blank.colorSpace = THREE.NoColorSpace;
  blank.generateMipmaps = false;
  blank.needsUpdate = true;
  const output = new OutputPass();
  let shader = output.material.fragmentShader;
  shader = replaceOnce(shader, 'void main() {', `${BLOOM_GUARD_GLSL}
    uniform sampler2D uBloomTexture; uniform float uBloomEnabled, uBloomFactor, uSat;
    void main() {`);
  shader = replaceOnce(shader, 'gl_FragColor = texture2D( tDiffuse, vUv );', `gl_FragColor = texture2D( tDiffuse, vUv );
    vec4 bloom = texture2D(uBloomTexture, vUv) * uBloomFactor;
    // Native composite scales RGBA; SRC_ALPHA,ONE then weights RGB by that scaled alpha.
    // Only RGB receives the final guard, so its feather is applied once, including overlap.
    gl_FragColor.rgb += bloom.rgb * bloom.a * bloomTransmission() * uBloomEnabled;
    gl_FragColor.a += bloom.a * bloom.a * uBloomEnabled;`);
  shader = replaceOnce(shader, '// color space', `gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, uSat);
    // color space`);
  output.material.fragmentShader = shader;
  Object.assign(output.uniforms, guards, {
    uBloomTexture: { value: bloom.texture }, uBloomEnabled: { value: 1 },
    uBloomFactor: { value: tightBloomFactor(bloom.strength, bloom.radius) }, uSat: { value: 1 },
  });
  // The public mask diagnostic is the actual output combine, not a detached compatibility copy.
  bloom.compositeMaterial = output.material;
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);

  const warmTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, samples: 0,
  });
  warmTarget.texture.name = 'KilnBloom.warm-output';
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  const warmInput = { texture: blank };
  let useBloom = true, msaaOff = false, disposed = false;
  const canvasAA = !!gl.getContextAttributes()?.antialias;

  return {
    composer, bloom, canvasAA, paddleBloomRadius,
    get direct() { return false; },

    setSize(W, H, pr) {
      const samples = MSAA_PARAM >= 0 ? MSAA_PARAM : msaaOff ? 0 : !useBloom ? LOOK.MSAA_LITE : pr >= 1.75 ? LOOK.MSAA_HI_DPR : LOOK.MSAA;
      if (composer.renderTarget1.samples !== samples) {
        for (const target of [composer.renderTarget1, composer.renderTarget2]) { target.samples = samples; target.dispose(); }
      }
      composer.setPixelRatio(pr);
      composer.setSize(W, H);
      guards.uRes.value[0] = W * pr;
      guards.uRes.value[1] = H * pr;
    },

    setBloom(on) {
      useBloom = !!on;
      bloom.enabled = useBloom;
      output.uniforms.uBloomEnabled.value = useBloom ? 1 : 0;
      output.uniforms.uBloomTexture.value = useBloom ? bloom.texture : blank;
      if (!useBloom) this.clearBallMasks();
    },
    setMsaaOff(off) { msaaOff = !!off; },
    get bloomOn() { return useBloom; },
    setBloomMask(ax, ay, bx, by, radius, feather) {
      guards.uMaskA.value[0] = ax; guards.uMaskA.value[1] = ay;
      guards.uMaskB.value[0] = bx; guards.uMaskB.value[1] = by;
      guards.uMaskR.value = radius; guards.uMaskF.value = feather;
    },
    setBallMasks(world, alpha, clip, width, height, gameplay) {
      guards.uBallMaskCount.value = writeBallBloom(guards.uBallMasks.value,
        world, alpha, clip, width, height, useBloom && gameplay);
    },
    clearBallMasks() { guards.uBallMaskCount.value = 0; guards.uBallMasks.value.fill(0); },
    setSaturation(saturation) { output.uniforms.uSat.value = saturation; },

    contextLost() {
      if (disposed) return;
      // Retire r160's old-context disposal listeners before its properties map is replaced.
      // Keep the JS targets and texture references: their next bind recreates GPU storage.
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
      for (const target of Object.values(bloom.targets)) target.dispose();
      warmTarget.dispose(); blank.dispose();
    },

    // Four offscreen draws prepare both bloom programs, owned targets and the real output
    // variant even when booting Lite. No scene/gameplay draw, time advance or readiness signal.
    warmUp() {
      const target = gl.getRenderTarget(), autoClear = gl.autoClear;
      gl.getViewport(viewport); gl.getScissor(scissor);
      const scissorTest = gl.getScissorTest(), renderToScreen = output.renderToScreen;
      const texture = output.uniforms.uBloomTexture.value, enabled = output.uniforms.uBloomEnabled.value;
      const input = output.uniforms.tDiffuse.value;
      try {
        gl.initTexture(blank);
        gl.setScissorTest(false);
        bloom.render(gl, null, warmInput);
        output.uniforms.uBloomTexture.value = bloom.texture;
        output.uniforms.uBloomEnabled.value = 1;
        output.uniforms.uBloomFactor.value = tightBloomFactor(bloom.strength, bloom.radius);
        output.renderToScreen = false;
        output.render(gl, warmTarget, warmInput);
      } finally {
        output.renderToScreen = renderToScreen;
        output.uniforms.uBloomTexture.value = texture;
        output.uniforms.uBloomEnabled.value = enabled;
        output.uniforms.tDiffuse.value = input;
        gl.autoClear = autoClear;
        // Restore canvas defaults first; binding last reapplies a caller target's own state.
        gl.setViewport(viewport); gl.setScissor(scissor); gl.setScissorTest(scissorTest);
        gl.setRenderTarget(target);
      }
    },
    render() {
      const target = gl.getRenderTarget();
      output.uniforms.uBloomFactor.value = tightBloomFactor(bloom.strength, bloom.radius);
      try { composer.render(); } finally { gl.setRenderTarget(target); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      composer.dispose(); bloom.dispose(); output.dispose(); blank.dispose(); warmTarget.dispose();
    },
  };
}
