import { register } from 'node:module';
import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { BALL, RING } from '../src/core/constants.js';
import { paddleBloomRadius } from '../src/render/ball-bloom.js';
import { physicsWorld } from './fixtures/A/sim.mjs';

const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const { createPost } = await import('../src/render/post.js');
const { createActors } = await import('../src/render/actors.js');
const { glassMaterial } = await import('../src/render/materials.js');

function fixture(antialias = false) {
  const calls = [];
  const gl = { getPixelRatio: () => 2, getContextAttributes: () => ({ antialias }),
    render: (...args) => calls.push(['direct', ...args]) };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 390 / 844, 10, 8000);
  camera.position.set(0, 150, 2400); camera.lookAt(0, -30, 0); camera.updateMatrixWorld();
  const post = createPost(gl, scene, camera);
  post.composer.render = () => calls.push(['composer']);
  return { post, calls, scene, camera };
}

test('bloom source and final full-resolution blend share the exact fixed guard uniforms', () => {
  const { post, camera } = fixture(), bloom = post.bloom;
  const stages = [bloom.compositeMaterial, bloom.materialHighPassFilter, bloom.blendMaterial];
  const initial = stages[0].uniforms;
  for (const material of stages) for (const name of ['uMaskA', 'uMaskB', 'uMaskR', 'uMaskF', 'uRes', 'uBallMasks', 'uBallMaskCount']) {
    assert.equal(material.uniforms[name], initial[name], `${name}: both shader stages observe the same current value`);
  }
  for (const name of ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks']) assert.ok(initial[name].value instanceof Float32Array);
  const buffers = ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].map(n => initial[n].value);
  post.setSize(390, 844, 2);
  assert.deepEqual([...initial.uRes.value], [780, 1688], 'half-res bright pass still uses full drawing-buffer coordinates');
  post.setBloomMask(10.125, 20.25, 100.5, 22.75, 8, 4);
  assert.deepEqual([...initial.uMaskA.value], [10.125, 20.25]);
  assert.deepEqual([...initial.uMaskB.value], [100.5, 22.75]);
  const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const world = { balls: [{ alive: true, held: true, sealed: -1, r: BALL.R, x: 360, y: 450 }] };
  post.setBallMasks(world, .5, clip, 780, 1688, true);
  assert.equal(initial.uBallMaskCount.value, 1);
  for (let i = 0; i < 10; i++) { post.setBloomMask(i, i, 100 + i, i, 8, 4); post.setBallMasks(world, i / 10, clip, 780, 1688, true); }
  ['uMaskA', 'uMaskB', 'uRes', 'uBallMasks'].forEach((n, i) => assert.equal(initial[n].value, buffers[i]));
  assert.equal(post.composer.passes.length, 3, 'same scene, bloom and output passes; no extra target or draw');
  post.dispose();
});

test('actual emitted source and blend kernels give zero body bloom and use max protection for overlap', () => {
  const { post } = fixture();
  // Execute the return expression emitted to each actual material, rather than a second CPU
  // implementation of its policy. Projection/raster coverage is proved separately and natively.
  for (const material of [post.bloom.materialHighPassFilter, post.bloom.blendMaterial]) {
    const expression = material.fragmentShader.match(/float bloomTransmission\(\)\s*\{\s*return ([^;]+);/)[1];
    const kernel = new Function('paddleBand', 'ballBand', 'max', `return ${expression};`);
    const gain = (paddle, ball) => kernel(() => paddle, () => ball, Math.max);
    assert.equal(gain(0, 0), 1, 'distant emitters retain their bloom');
    for (const other of [0, .1, .5, 1]) {
      assert.equal(gain(1, other), 0, 'no paddle bloom floor');
      assert.equal(gain(other, 1), 0, 'no ball bloom floor, including multiball overlap');
    }
    near(gain(.4, .4), .6, 1e-12, 'overlap does not multiply soft masks into a dark cut');
    near(gain(.2, .7), .3, 1e-12);
    for (let i = 0; i <= 10; i++) assert.ok(gain(i / 10, .3) >= 0 && gain(i / 10, .3) <= 1);
  }
  // Only source rejection and the final additive blend attenuate bloom. The mip composite is
  // still the native pass, so there is no second feather multiplication before upsampling.
  assert.equal(post.bloom.compositeMaterial.fragmentShader.includes('bloomTransmission'), false);
  post.dispose();
});

test('Lite, menus, reset and disposal preserve post routes and clear stale multiball guards', () => {
  for (const antialias of [false, true]) {
    const { post, calls, camera } = fixture(antialias);
    const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
    const world = { balls: Array.from({ length: BALL.MAX }, (_, i) => ({ alive: true, held: true,
      sealed: -1, r: BALL.R, x: 45 + 50 * i, y: 450 })) };
    const uniforms = post.bloom.blendMaterial.uniforms, buffer = uniforms.uBallMasks.value;
    post.setBallMasks(world, .5, clip, 780, 1688, true);
    assert.equal(uniforms.uBallMaskCount.value, BALL.MAX);
    post.render(); assert.equal(calls.at(-1)[0], 'composer');
    post.setBallMasks(world, .5, clip, 780, 1688, false);
    assert.equal(uniforms.uBallMaskCount.value, 0); assert.ok(buffer.every(v => v === 0));
    post.setBallMasks(world, .5, clip, 780, 1688, true);
    post.setBloom(false); post.render();
    assert.equal(post.direct, antialias);
    assert.equal(calls.at(-1)[0], antialias ? 'direct' : 'composer');
    assert.equal(uniforms.uBallMaskCount.value, 0); assert.ok(buffer.every(v => v === 0));
    post.setBloom(true); post.render(); assert.equal(calls.at(-1)[0], 'composer');
    post.setBallMasks(world, .5, clip, 780, 1688, true); post.clearBallMasks();
    assert.equal(uniforms.uBallMaskCount.value, 0); assert.equal(uniforms.uBallMasks.value, buffer);
    assert.ok(buffer.every(v => v === 0));
    post.dispose();
  }
});

test('native additive blend applies the feather once without attenuating its source alpha', () => {
  const { post } = fixture(), material = post.bloom.blendMaterial;
  assert.equal(material.blending, THREE.AdditiveBlending);
  assert.equal(material.premultipliedAlpha, false, 'native r160 additive factors are SRC_ALPHA, ONE');
  const expression = material.fragmentShader.match(/float bloomTransmission\(\)\s*\{\s*return ([^;]+);/)[1];
  const kernel = new Function('paddleBand', 'ballBand', 'max', `return ${expression};`);
  const assignment = material.fragmentShader.match(/gl_FragColor(\.rgb)?\s*\*=\s*bloomTransmission\(\)/);
  assert.ok(assignment, 'actual final shader applies the guard');
  for (const band of [0, .25, .5, .75, 1]) for (const srcAlpha of [.2, .55, 1]) {
    const transmission = kernel(() => band, () => 0, Math.max), srcRGB = .8;
    const rgb = srcRGB * transmission;
    const alpha = assignment[1] ? srcAlpha : srcAlpha * transmission;
    const contribution = rgb * alpha; // r160 non-premultiplied additive source term
    near(contribution, srcRGB * srcAlpha * (1 - band), 1e-12, 'one linear feather, without a T-squared valley');
  }
  post.dispose();
});

test('zero-bloom hull contains produced ring paddle geometry including Wide plus Forge and perfect Catch lines', () => {
  const context = { fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, arc(){}, quadraticCurveTo(){},
    bezierCurveTo(){}, stroke(){}, drawImage(){}, getImageData(x,y,w,h){return {data:new Uint8ClampedArray(w*h*4).fill(255)};} };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement(){return {getContext(){return context;}};} };
  try {
    const { world: w } = physicsWorld({ mode: 'ring' }), scene = new THREE.Scene();
    const actors = createActors(scene, { titanium: new THREE.MeshStandardMaterial(), paddleGlass: glassMaterial(),
      darkMetalP: new THREE.MeshPhysicalMaterial(), core: new THREE.MeshStandardMaterial(),
      matteFree: new THREE.MeshStandardMaterial(), wallGlassI: glassMaterial(), tex: {glow:new THREE.Texture()} });
    actors.setWorld(w);
    const p = w.paddle; p.w = 210; p.span = 70 * Math.PI / 180; w.effects.catchOn = true;
    for (const angle of [0, Math.PI / 3, Math.PI, Math.PI * 1.5]) for (const velocity of [-1500, 1500]) {
      p.angle = angle; p.x = RING.CX + Math.cos(angle) * RING.R_PADDLE;
      p.y = RING.CY + Math.sin(angle) * RING.R_PADDLE; p.vel = velocity;
      actors.perfect(2); actors.frame(w, .5, 2, {st:{flare:3}}, 0);
      actors.pad.updateMatrixWorld(true);
      for (const [W, H] of [[640, 1136], [780, 1688], [2560, 1600]]) {
        const cam = new THREE.PerspectiveCamera(35, W / H, 10, 8000);
        cam.position.set(55, 170, 2400); cam.lookAt(-10, -30, 0); cam.rotateZ(.08); cam.updateMatrixWorld();
        const clip = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
        const project = v => {v.project(cam);return [(v.x+1)*W/2,(v.y+1)*H/2];};
        const edge = a => project(new THREE.Vector3(Math.cos(a)*RING.R_PADDLE,
          -Math.sin(a)*RING.R_PADDLE, 0));
        const a = edge(angle-p.span/2), b = edge(angle+p.span/2);
        const radius = paddleBloomRadius(p, 'ring', actors.pad.rotation.z, clip, W, H, ...a, ...b);
        const dx = b[0]-a[0], dy = b[1]-a[1], length2 = dx*dx+dy*dy;
        let checkedPerfect = false;
        actors.pad.traverse(mesh => {
          if (!mesh.isMesh) return;
          for (let o=mesh; o; o=o.parent) if (!o.visible) return;
          if (mesh.name === 'paddle-arc-perfect-line') checkedPerfect = true;
          const pos = mesh.geometry.attributes.position, bend = mesh.material.userData.bend;
          for (let i=0;i<pos.count;i++) {
            const point = new THREE.Vector3().fromBufferAttribute(pos,i);
            if (bend) {
              const R=bend.uR.value, th=point.x*bend.uLen.value/R*bend.uBend.value;
              if (bend.uBend.value>0) {const rho=R-point.y;point.set(rho*Math.sin(th),R-rho*Math.cos(th),point.z);}
              else point.x*=bend.uLen.value;
            }
            const q=project(point.applyMatrix4(mesh.matrixWorld));
            const k=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/length2));
            assert.ok(Math.hypot(q[0]-a[0]-k*dx,q[1]-a[1]-k*dy)<radius,
              `${mesh.name||mesh.type}: actual post-bend vertex stays inside the zero-bloom hull`);
          }
        });
        assert.ok(checkedPerfect, 'actual visible perfect mesh was included');
      }
    }
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document=previousDocument; }
});
