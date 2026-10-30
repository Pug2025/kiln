import { test, assert, near } from './lib.mjs';
import * as THREE from '../vendor/three/0.160.0/build/three.module.js';
import { FIELD, PADDLE, RING } from '../src/core/constants.js';
import { paddleSourceRadius, protectBed } from '../src/render/paddle-source.js';

test('bed guard changes only source alpha and reuses its uniforms through recompilation and menus', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0x774400, transparent: true, opacity: .8 });
  const guard = protectBed(material), a = guard.uniforms.uBedA.value, b = guard.uniforms.uBedB.value;
  assert.equal(b[2], 0, 'initial source is unmodified');
  const compile = () => {
    const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uBedA, guard.uniforms.uBedA);
    assert.equal(shader.uniforms.uBedB, guard.uniforms.uBedB);
    assert.ok(shader.fragmentShader.includes('diffuseColor.a *= bedTransmission();\n#include <opaque_fragment>'));
    assert.ok(!shader.fragmentShader.includes('diffuseColor.rgb *='), 'normal blending weights RGB by alpha once');
    for (const chunk of ['map_fragment', 'fog_fragment', 'tonemapping_fragment', 'colorspace_fragment']) {
      assert.ok(shader.fragmentShader.includes(`#include <${chunk}>`), chunk + ' retained');
    }
    return shader.fragmentShader;
  };
  const source = compile();
  for (let i = 0; i < 20; i++) guard.set(10 + i, 20, 80, 20, 30, 12, true);
  assert.equal(guard.uniforms.uBedA.value, a); assert.equal(guard.uniforms.uBedB.value, b);
  assert.equal(b[2], 1); assert.equal(material.opacity, .8); assert.equal(material.transparent, true);
  assert.equal(material.blending, THREE.NormalBlending);
  assert.equal(compile(), source, 'context recompilation keeps the same program and fixed buffers');
  guard.clear(); assert.equal(b[2], 0);
  guard.set(1, 2, 3, 4, 5, 0, false); assert.ok(a[3] > 0); assert.equal(b[2], 0);
  const smoothstep = (lo, hi, x) => { const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const fadeExpression = source.match(/float fade = ([^;]+);/)[1].replace('length(pa - ba * k)', 'distance');
  const fade = new Function('uBedA', 'distance', 'smoothstep', `return ${fadeExpression};`);
  const combine = new Function('fade', 'uBedB', 'mix', `return ${source.match(/return (mix[^;]+);/)[1]};`);
  const transmission = (d, enabled) => combine(fade({ z: 30, w: 12 }, d, smoothstep), { z: enabled }, (a, b, t) => a + (b - a) * t);
  for (const d of [0, 12, 30]) assert.equal(transmission(d, 1), 0, 'genuine zero shoulder');
  near(transmission(36, 1), .5, 1e-12); assert.equal(transmission(42, 1), 1);
  for (const d of [0, 30, 100]) assert.equal(transmission(d, 0), 1, 'menus are unchanged');
  assert.throws(() => material.onBeforeCompile({ uniforms: {}, fragmentShader: 'void main() {}' }));
});

test('projected bed neighbourhood contains footprint offsets through perspective, rotation and front depth', () => {
  const v = new THREE.Vector3();
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) for (const pr of [1, 2]) {
    for (const mode of ['bottom', 'left', 'ring']) for (const lean of [-1, 0, 1]) {
      const camera = new THREE.PerspectiveCamera(35, width / height, 10, 8000);
      camera.position.set(lean * 80, 150 + lean * 30, 1800);
      camera.lookAt(-lean * 20, -30, 0); camera.rotateZ(lean * .1); camera.updateMatrixWorld(true);
      const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
      const project = (x, y, z) => {
        v.set(x - FIELD.W / 2, FIELD.H / 2 - y, z).project(camera);
        return [(v.x + 1) * width * pr / 2, (v.y + 1) * height * pr / 2];
      };
      const p = { x: 360, y: 1000, w: 300, h: PADDLE.H, angle: Math.PI / 2 + lean * .9, span: 70 * Math.PI / 180 };
      if (mode === 'left') { p.x = 40; p.y = 540; }
      if (mode === 'ring') { p.x = RING.CX + Math.cos(p.angle) * RING.R_PADDLE; p.y = RING.CY + Math.sin(p.angle) * RING.R_PADDLE; }
      let ends;
      if (mode === 'ring') ends = [-1, 1].map(sign => project(RING.CX + Math.cos(p.angle + sign * p.span / 2) * RING.R_PADDLE, RING.CY + Math.sin(p.angle + sign * p.span / 2) * RING.R_PADDLE, 0));
      else ends = [-1, 1].map(sign => project(p.x + (mode === 'left' ? 0 : sign * p.w / 2), p.y + (mode === 'left' ? sign * p.w / 2 : 0), 0));
      const [a, b] = ends, dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
      const radius = paddleSourceRadius(p, mode, clip, width * pr, height * pr, ...a, ...b);
      assert.ok(Number.isFinite(radius) && radius > 0);
      for (let i = 0; i <= 24; i++) for (const sign of [-1, 1]) {
        let x, y;
        if (mode === 'ring') {
          const angle = p.angle - p.span / 2 + p.span * i / 24, r = RING.R_PADDLE + sign * p.h / 2;
          x = RING.CX + Math.cos(angle) * r; y = RING.CY + Math.sin(angle) * r;
        } else if (mode === 'left') { x = p.x + sign * p.h / 2; y = p.y - p.w / 2 + p.w * i / 24; }
        else { x = p.x - p.w / 2 + p.w * i / 24; y = p.y + sign * p.h / 2; }
        for (let j = 0; j < 16; j++) for (const z of [11.4, 11.75]) {
          const q = project(x + 40 * Math.cos(j * Math.PI / 8), y + 40 * Math.sin(j * Math.PI / 8), z);
          const k = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / length2));
          const distance = Math.hypot(q[0] - a[0] - k * dx, q[1] - a[1] - k * dy);
          assert.ok(distance <= radius, `${mode} neighbourhood outside source guard`);
        }
      }
    }
  }
});
