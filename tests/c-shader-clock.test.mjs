// Actual component updates plus execution of the renderer's unchanged API/event bodies with
// draw/DOM boundaries replaced by recording collaborators. No WebGL or rendered parity claim.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { EV, PHASE_CODE } from '../src/core/events.js';
import { createBus, createReader, resetReader, next, emit } from '../src/core/bus.js';
import { LOOK } from '../src/render/look.js';
import { CEILING_ART } from '../src/render/ceiling.js';
import { FIELD } from '../src/core/constants.js';
import { physicsWorld } from './fixtures/A/sim.mjs';
const threeURL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const addonURL = new URL('../vendor/three/0.160.0/examples/jsm/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(threeURL)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(addonURL)} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);
const THREE = await import(threeURL);
const { createFire } = await import('../src/render/fire.js');
const { createKiln } = await import('../src/render/kiln.js');
const { createHeadroom } = await import('../src/render/headroom.js');
const { createOverlays } = await import('../src/render/overlays.js');
const { createTrail } = await import('../src/render/trail.js');

const rendererSource = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
const eventsStart = rendererSource.indexOf('  function drain() {');
const eventsEnd = rendererSource.indexOf('  /** Reveal hidden variants', eventsStart);
const apiStart = rendererSource.indexOf('  const api = {');
const apiEnd = rendererSource.indexOf('\n\n  applyQuality();', apiStart);
assert.ok(eventsStart > 0 && eventsEnd > eventsStart && apiStart > eventsEnd && apiEnd > apiStart);
const makeApi = new Function('env', `with (env) {\n${rendererSource.slice(eventsStart, eventsEnd)}\n${rendererSource.slice(apiStart, apiEnd)}\nreturn api;\n}`);

function rendererHarness(lifetime = 0) {
  const trace = [];
  const record = label => (...args) => { trace.push({ label, args }); };
  const component = label => ({ setWorld: record(label + '.world'), frame: record(label + '.frame') });
  const scene = new THREE.Scene();
  const actualFire = createFire(scene);
  const fire = { ...actualFire, reset(changed) { record('fire.reset')(changed); actualFire.reset(changed); },
    update(t, dt) { const result = actualFire.update(t, dt); record('fire.update')(t, dt); return result; } };
  const env = {
    t: lifetime, shaderOrigin: 0, world: null, reader: null, clearHold: 0, breakBoost: 0,
    esc: 0, menuOn: false, menuSkip: 0, menuStride: 3, disposed: false,
    EV, PHASE_CODE, LOOK, createReader, resetReader, next, HW: FIELD.W / 2, HH: FIELD.H / 2,
    bossContactKind: () => '',
    fire, scene, camera: {}, M: {}, canvas: {}, vignette: {}, restCam: {},
    q: { lite: false, reduceMotion: false }, pools: [],
    stats: { worst: { ms: Infinity }, frameMs: 0 },
    glWatch: { lost: false }, gl: { info: { reset() {}, render: { calls: 0, triangles: 0 }, programs: [] } },
    gpuTimer: { begin() {}, end() {}, poll: () => -1 }, pace: {}, pacePushGpu() {},
    timing() {}, paceFrame() {}, legibility() {}, bloomMask() {}, leadX: () => 360,
    resize() {}, applyMenu() {}, applyQuality() {}, warmUp() {}, startKit() {}, bootJob: null,
    post: { clearBallMasks: record('masks.clear'), render() {} },
    rig: { setWorld: record('rig.world'), intro: record('rig.intro'), shake: record('rig.shake'), update: record('rig.update') },
    kiln: { setMode() {}, wallHit: record('kiln.wallHit'), update: record('kiln.update'), fireLight: { intensity: 0 } },
    bricks: { ...component('bricks'), hit: record('bricks.hit'), broken: record('bricks.broken'), spawned: record('bricks.spawned'), fireWall: record('bricks.fireWall'), coreBlocked: record('bricks.coreBlocked'), clearing: false },
    actors: { ...component('actors'), perfect: record('actors.perfect'), laserFired: record('actors.laserFired'), catchTick() {} },
    pieces: { ...component('pieces'), shieldUsed: record('pieces.shieldUsed') },
    boss: component('boss'), overlays: component('overlays'),
    headroom: { ...component('headroom'), clear: record('headroom.clear'), bossPulse() {} },
    trailFx: { reset: record('trail.reset'), frame: record('trail.frame') },
    fx: { clear: record('fx.clear'), frame: record('fx.frame'), breakAt: record('fx.breakAt'), burst() {}, blocked() {} },
  };
  const api = makeApi(env);
  const w = { bus: createBus(), level: { mode: 'bottom' }, field: {}, econ: { mult: 1 }, fx: { lastLife: false } };
  api.setWorld(w);
  const last = label => trace.filter(row => row.label === label).at(-1)?.args;
  return { env, api, w, trace, last, fire: actualFire };
}

function replay(lifetime) {
  const r = rendererHarness(lifetime), dt = 1 / 64;
  for (let frame = 1; frame <= 3840; frame++) {
    const age = frame * dt;
    r.w.econ.mult = age < 10 ? 1 : age < 45 ? 5 : 3;
    if (frame === 3808) emit(r.w.bus, EV.PERFECT_HIT);
    if (frame === 3832) {
      for (const ev of [EV.BRICK_DAMAGED, EV.BRICK_SPAWNED, EV.BRICK_BROKEN, EV.LASER_FIRED, EV.SHIELD_USED, EV.WALL_HIT, EV.BALL_LOST, EV.LEVEL_CLEARED]) emit(r.w.bus, ev, 4, 180, 700);
    }
    r.api.frame(r.w, .5, dt);
  }
  return r;
}

test('renderer rebases actual fire and procedural consumers at equal world age after80000s lifetime', () => {
  const low = replay(0), high = replay(79940);
  assert.equal(low.env.t, 60); assert.equal(high.env.t, 80000);
  assert.equal(low.env.shaderOrigin, 0); assert.equal(high.env.shaderOrigin, 79940);
  assert.deepEqual(high.last('fire.update'), [60, 1 / 64]);
  assert.deepEqual(high.fire.st, low.fire.st, 'same combo/flare dt replay produces the same integrated fire, not an artificial uniform overwrite');
  for (const material of ['main', 'backM', 'sparkMat']) {
    const hu = high.fire[material].uniforms, lu = low.fire[material].uniforms;
    for (const key of ['uTime', 'uFlow', 'uIntensity', 'uTip', 'uHot', 'uFlare']) if (hu[key]) assert.equal(hu[key].value, lu[key].value, key);
  }
  assert.equal(high.last('kiln.update')[0], 80000); assert.equal(high.last('kiln.update')[4], 60);
  assert.equal(high.last('headroom.frame')[1], 80000); assert.equal(high.last('headroom.frame')[4], 60);
  assert.equal(high.last('trail.frame')[2], 60); assert.equal(high.last('overlays.frame')[2], 60);
  for (const [label, index] of [['bricks.frame', 1], ['actors.frame', 2], ['pieces.frame', 2], ['boss.frame', 2], ['fx.frame', 1], ['rig.update', 0]]) assert.equal(high.last(label)[index], 80000, label);
  const flow = high.fire.st.flow;
  high.api.frame(high.w, .5, 1 / 60);
  near(high.last('fire.update')[0], 60 + 1 / 60, 1e-10);
  assert.ok(high.fire.st.flow > flow, 'long-session fire continues moving');
});

test('renderer event callbacks, clear delay and camera timestamps retain lifetime seconds', () => {
  const r = replay(79940), at = 79999.875;
  assert.deepEqual(r.last('actors.perfect'), [79999.5]);
  assert.deepEqual(r.last('actors.laserFired'), [at]);
  assert.deepEqual(r.last('pieces.shieldUsed'), [at]);
  assert.deepEqual(r.last('bricks.hit'), [4, at]);
  assert.deepEqual(r.last('bricks.spawned'), [4, at]);
  assert.equal(r.last('bricks.broken')[4], at);
  assert.deepEqual(r.last('rig.shake'), [at]);
  assert.deepEqual(r.last('rig.intro'), [79940]);
  assert.equal(r.last('kiln.wallHit')[3], at);
  assert.deepEqual(r.last('bricks.fireWall'), [at]);
  near(r.last('headroom.clear')[0], at + LOOK.CLEAR_SWEEP_S * .6, 1e-10);
  assert.equal(r.env.t - r.last('actors.laserFired')[0], .125);
});

test('world identity controls decorative reset, without restarting on ordinary preparation or same-world binding', () => {
  const r = replay(79940), origin = r.env.shaderOrigin, flow = r.fire.st.flow, phase = r.fire.st.phase;
  r.api.resize(); r.api.setMenu(true); r.api.setMenu(false);
  assert.equal(r.env.shaderOrigin, origin); assert.equal(r.fire.st.flow, flow); assert.equal(r.fire.st.phase, phase);
  r.api.setWorld(r.w);
  assert.deepEqual(r.last('fire.reset'), [false]);
  assert.equal(r.env.shaderOrigin, origin); assert.equal(r.fire.st.flow, flow); assert.equal(r.fire.st.phase, phase);
  const fresh = { ...r.w, bus: createBus() };
  r.api.setWorld(fresh);
  assert.deepEqual(r.last('fire.reset'), [true]);
  assert.equal(r.env.t, 80000); assert.equal(r.env.shaderOrigin, 80000);
  assert.equal(r.fire.st.flow, 0); assert.equal(r.fire.st.phase, 0);
  r.api.frame(fresh, .5, 1 / 64);
  assert.deepEqual(r.last('fire.update'), [1 / 64, 1 / 64]);
});

test('fire flow stays integrated through multiplier/flare changes and only periodic breath phase wraps', () => {
  const fire = createFire(new THREE.Scene());
  fire.st.phase = Math.PI * 2 - .001;
  fire.st.flow = 599.99;
  fire.setMult(5); fire.flare(.8, .25, true);
  const beforeFlow = fire.st.flow, beforePhase = fire.st.phase, dt = 1 / 64;
  fire.update(600, dt);
  near(fire.st.flow - beforeFlow, dt * (1 + .9 * fire.st.combo + .6 * fire.st.flare), 1e-10);
  assert.ok(fire.st.flow > 600, 'nonperiodic noise flow is not blindly wrapped');
  near(Math.sin(fire.st.phase), Math.sin(beforePhase + fire.st.omega * dt), 1e-12);
  assert.ok(fire.st.phase >= 0 && fire.st.phase < Math.PI * 2);
  const flow = fire.st.flow, phase = fire.st.phase;
  fire.setLite(true); fire.setLite(false);
  assert.equal(fire.st.flow, flow); assert.equal(fire.st.phase, phase);
  fire.reset(false); assert.equal(fire.st.flow, flow); assert.equal(fire.st.phase, phase);
  fire.reset(); assert.equal(fire.st.flow, 0); assert.equal(fire.st.phase, 0);
});

test('actual kiln, headroom, fog and Fire ribbon take local sampling time while lifetime clear/contact ages advance', () => {
  const scene = new THREE.Scene(), plain = new THREE.MeshBasicMaterial();
  const kiln = createKiln(scene, { wallGlass: plain, titaniumP: plain, ribs: plain, pillars: plain, grate: plain.clone(), tex: { glow: new THREE.Texture() } });
  kiln.setMode('bottom', { ceilingY: 450 });
  kiln.update(80000, .6, 1, 0, 60);
  assert.deepEqual([...kiln.haze[0].material.uniforms.uTimes.value], [60, 67, 74, 81]);
  const shaft = scene.children.find(obj => obj.material?.uniforms?.uTime && !obj.material.uniforms.uTimes);
  assert.equal(shaft.material.uniforms.uTime.value, 60);
  assert.equal(kiln.wallHit(2, 360, 450, 80000), true);
  near(kiln.ceilingGlow.material.uniforms.uHit.value.z, .8);
  kiln.update(80000 + CEILING_ART.HIT_S / 2, .6, 1, 0, 60 + CEILING_ART.HIT_S / 2);
  assert.ok(kiln.ceilingGlow.material.uniforms.uHit.value.z > 0 && kiln.ceilingGlow.material.uniforms.uHit.value.z < .8);
  kiln.update(80000 + CEILING_ART.HIT_S + .01, .6, 1, 0, 60 + CEILING_ART.HIT_S + .01);
  assert.equal(kiln.ceilingGlow.material.uniforms.uHit.value.z, 0, 'actual contact expires in lifetime time');
  const headroom = createHeadroom(scene);
  headroom.setPlate('ember', new THREE.Texture());
  const { world } = physicsWorld({ mode: 'bottom' });
  headroom.setWorld(world); headroom.clear(79999.3);
  headroom.frame(world, 80000, 0, .6, 60);
  assert.equal(headroom.far.material.uniforms.uTime.value, 60);
  near(headroom.far.material.uniforms.uClear.value, .5, 1e-10);
  headroom.frame(world, 80000.7, 0, .6, 60.7);
  near(headroom.far.material.uniforms.uClear.value, 1);
  headroom.setQuality(true, false); headroom.frame(world, 80001, 0, .6, 61);
  assert.equal(headroom.far.material.uniforms.uTime.value, 0);
  const overlay = createOverlays(scene); overlay.setWorld(world);
  overlay.frame(world, .5, 60, 0);
  const fog = scene.children.find(obj => obj.material?.uniforms?.uFog);
  assert.equal(fog.material.uniforms.uTime.value, 60);
  const trail = createTrail(scene); trail.frame(world, .5, 60);
  const ribbon = scene.children.find(obj => obj.material?.uniforms?.uTime && obj.geometry?.attributes?.aGain);
  assert.equal(ribbon.material.uniforms.uTime.value, 60);
});
