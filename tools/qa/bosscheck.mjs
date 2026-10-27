#!/usr/bin/env node
// Canonical boss presentation witnesses. Uses actual content hit handlers, then freezes play
// for screenshots; these controlled states are not claims of a human or robot playthrough.
// Run against team/devserver.mjs: node tools/qa/bosscheck.mjs --url http://localhost:8792/
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchChrome } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const base = option('--url', 'http://localhost:8792/');
const out = resolve(option('--out', 'tools/qa/out/bosscheck'));
const devices = option('--devices', 'desktop,iphone14pro').split(',');
mkdirSync(out, { recursive: true });
const report = { when: new Date().toISOString(), base, controlledStates: true, results: [] };
const chrome = await launchChrome();
try {
  for (const device of devices) {
    const page = await chrome.newPage();
    const errors = [];
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    page.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    page.on('Network.responseReceived', e => { if (e.response.status >= 400) errors.push(`${e.response.status} ${e.response.url}`); });
    await emulateDevice(page, getDevice(device));
    async function open(level) {
      const u = new URL(base);
      for (const [k, v] of Object.entries({ level, seed: 3, mute: 1, bot: 1 })) u.searchParams.set(k, v);
      await page.navigate(u.href);
      await page.waitFor('window.__kiln?.world?.step > 0');
      // Wait for the shipped model, not merely the fallback primitive.
      await page.waitFor("window.__kiln.renderer._internals.scene.getObjectByName('boss')?.children.some(o=>o.visible && o.userData.parts)");
      await page.eval(`(async () => {
        const k = window.__kiln;
        k.app.paused = true; k.ui.card(null);
        const [bus, events, constants, input, world] = await Promise.all([
          import('./src/core/bus.js'), import('./src/core/events.js'), import('./src/core/constants.js'),
          import('./src/core/input-frame.js'), import('./src/core/world.js')]);
        window.bossQA = { ...bus, ...events, ...constants, ...input, ...world };
      })()`);
      await prepare();
    }
    async function prepare() {
      await page.eval(`(() => {
        const k = window.__kiln, w = k.world;
        k.app.paused = true; k.ui.card(null); w.phase = 'play';
        for (const b of w.balls) b.alive = false;
        const Q = window.bossQA;
        Q.skip = ms => {
          w.step += Math.ceil(ms / Q.SIM.DT_MS);
          w.time = w.step * Q.SIM.DT_MS; w.bus.step = w.step;
        };
        Q.hit = (i, source = Q.SRC.BALL) => {
          Q.emit(w.bus, Q.EV.BRICK_HIT, i, w.bricks.x[i], w.bricks.y[i], -1, source);
          w.systems.content.resolve(w, Q.createInputFrame());
          w.systems.economy.step(w, Q.createInputFrame());
        };
        Q.core = () => Array.from({length:w.bricks.count}, (_,i)=>i).find(i=>w.bricks.alive[i] && w.bricks.flags[i]&Q.BF.WEAK);
        Q.jaw = () => Array.from({length:w.bricks.count}, (_,i)=>i).filter(i=>w.bricks.group[i]===1 && w.bricks.flags[i]&Q.BF.BOSS && w.bricks.type[i]===Q.BRICK.ARMOURED);
        Q.render = () => k.advance(1, 0);
        Q.render();
      })()`);
    }
    async function witness(name, settleFrames = 30) {
      await page.eval('window.bossQA.render()');
      // Age cosmetic fragments while the simulation remains frozen. Otherwise a plate broken
      // by a controlled hit is still covered by its first-frame debris in every later witness.
      await page.eval(`window.__kiln.advance(${settleFrames}, 100)`);
      const state = await page.eval(`(() => {
        const k=window.__kiln,w=k.world,Q=window.bossQA;
        const texts = [...document.querySelectorAll('#ui *')].filter(e=>e.children.length===0 && e.getBoundingClientRect().width && getComputedStyle(e).visibility!=='hidden').map(e=>e.textContent.trim()).filter(Boolean);
        return { id:w.boss.id, stage:w.level.def.stage||1, hp:w.boss.hp, max:w.boss.hpMax, guard:w.boss.data.guard,
          jaw:Q.jaw().filter(i=>w.bricks.alive[i]).map(i=>({x:w.bricks.x[i],hp:w.bricks.hp[i]})),
          texts, layout:k.hudCheck(), coreHeat:k.renderer._internals.M.bossCore.userData.u.uHeatValue.value,
          cracks:k.renderer._internals.scene.getObjectByName('boss-core-cracks')?.count ?? -1,
          segs:document.querySelector('[data-k="boss"]')?.style.getPropertyValue('--segs'),
          field:(()=>{const r={};k.renderer.fieldRect(r);return r})() };
      })()`);
      assert.equal(state.layout.overlaps.length, 0, `${device}/${name}: HUD buttons overlap text`);
      if(name.endsWith('guarded')) assert.ok(state.coreHeat < 0.1, `${device}/${name}: protected model core must dim`);
      // item 20: every counted hit is a lasting crack (3 segments each) and one bar segment
      if(state.hp > 0) assert.equal(state.cracks, (state.max - state.hp) * 3, `${device}/${name}: one drawn crack per counted hit`);
      if(state.hp > 0) assert.equal(state.segs, String(state.max), `${device}/${name}: one bar segment per core hit`);
      const shot = join(out, `${device}-${name}.png`);
      writeFileSync(shot, await page.screenshot());
      report.results.push({ device, name, ...state, shot });
      console.log(`${device}/${name}: ${state.id} ${state.hp}/${state.max}, guard=${state.guard}`);
    }
    async function guarded(name) {
      await page.eval(`(() => {
        const w=window.__kiln.world,Q=window.bossQA,i=Q.core();
        const b=w.balls[0];Object.assign(b,{alive:true,held:false,x:w.boss.x+45,y:w.boss.y,px:w.boss.x+45,py:w.boss.y,vx:0,vy:0});
        // count hits until the core cools (2 for The Stoker, 3 for the rotating bosses)
        let n=0; while(!w.boss.data.guard && n++<6){Q.skip(600);Q.hit(i);}
        Q.skip(300);
        const hp=w.boss.hp;Q.hit(i);if(w.boss.hp!==hp || !w.boss.data.guard)throw Error('guard failed: '+JSON.stringify({hpBefore:hp,hp:w.boss.hp,data:w.boss.data,time:w.time,phase:w.phase}));
        Q.skip(160);
        Q.render();
      })()`);
      await witness(name);
    }
    await open(10);
    await witness('stoker-closed');
    await page.eval(`(() => { const w=window.__kiln.world,Q=window.bossQA;const ids=Q.jaw();Q.hit(ids[2]);Q.hit(ids[3],Q.SRC.LASER);w.boss.open=1/6;Q.render(); })()`);
    await witness('stoker-damaged-open');
    await page.eval(`(() => { const w=window.__kiln.world,Q=window.bossQA; Q.skip(600);Q.hit(Q.core());w.systems.content.move(w,Q.createInputFrame());Q.render(); })()`);
    await witness('stoker-phase2-repair');
    await page.eval(`(() => { const w=window.__kiln.world,Q=window.bossQA; for(const i of Q.jaw())if(w.bricks.alive[i])Q.hit(i,Q.SRC.LASER);w.boss.open=1;Q.render(); })()`);
    await witness('stoker-open');
    await page.eval(`(() => {
      const w=window.__kiln.world,Q=window.bossQA,f=Q.createInputFrame();
      w.api.applyDrop(Q.DROP.LASER);w.systems.economy.step(w,f);
      const shots=w.effects.laserShots;
      const b=w.balls[0];Object.assign(b,{alive:true,held:false,x:w.paddle.x,y:w.paddle.y-50,px:w.paddle.x,py:w.paddle.y-50,vx:0,vy:-460});
      f.action=true;Q.stepWorld(w,f);
      if(w.effects.laserShots!==shots-1 || !w.lasers.some(b=>b.alive))throw Error('Laser action did not fire');
      f.action=false;f.pull=true;Q.stepWorld(w,f);
      if(w.effects.laserShots!==shots-1)throw Error('Pull incorrectly fired another Laser');
      f.pull=false;w.econ.heat=70;
      Q.emit(w.bus,Q.EV.HAZARD_HIT,0,w.paddle.x,w.paddle.y,Q.HAZARD.SLAG);
      w.systems.content.resolve(w,f);w.systems.economy.step(w,f);
      if(w.econ.heat!==45)throw Error('slag did not remove25HEAT');Q.render();
      const note=document.querySelector('[data-k="delta"]');
      if(!document.querySelector('#ui').textContent.includes('Slag −25 HEAT'))throw Error('actual slag consequence absent');
    })()`);
    await witness('stoker-laser-slag', 2);
    await guarded('stoker-guarded');
    await open(20);
    await witness('crucible-open');
    await guarded('crucible-guarded');
    await open(30);
    for(let stage=1;stage<=3;stage++) {
      assert.equal(await page.eval('window.__kiln.world.level.def.stage || 1'), stage);
      await witness(`core-${stage}-open`);
      await guarded(`core-${stage}-guarded`);
      if(stage<3) {
        await page.eval(`(() => {
          const k=window.__kiln,w=k.world,Q=window.bossQA;
          for(const b of w.balls)b.alive=false;
          while(w.boss.hp>0){w.boss.data.guard=0;Q.skip(600);Q.hit(Q.core());}
          const f=Q.createInputFrame();for(let n=0;n<100;n++)Q.stepWorld(w,f);
          if(w.phase!=='cleared')throw Error('stage did not clear');
          k.app.paused=false;k.advance(50,1000/60);k.app.paused=true;
        })()`);
        await prepare();
      }
    }
    assert.deepEqual(errors, [], `${device}: browser errors`);
    await page.send('Target.closeTarget', {targetId:page.targetId});
  }
} finally {
  await chrome.close();
  writeFileSync(join(out,'report.json'), JSON.stringify(report,null,2));
}
console.log(`Boss presentation witnesses saved to ${out}`);
