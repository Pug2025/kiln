// Muted, controlled browser witnesses for real Laser pickup and paddle equipment lifecycle.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launchChrome } from './lib/cdp.mjs';
import { getDevice, emulateDevice } from './lib/devices.mjs';
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=option('--url','http://localhost:8792/');
const out=resolve(option('--out','tools/qa/out/lasercheck'));
const devices=option('--devices','desktop,iphone14pro,mobile').split(',');
mkdirSync(out,{recursive:true});
const report={controlledStates:true,results:[],errors:[]};
const chrome=await launchChrome();
try {
  for(const device of devices) {
    const page=await chrome.newPage();
    await page.send('Runtime.enable');await page.send('Network.enable');
    page.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
    page.on('Network.responseReceived',e=>{if(e.response.status>=400)report.errors.push(`${e.response.status} ${e.response.url}`)});
    const d=getDevice(device);
    if(device==='mobile'){d.width=320;d.height=568;}
    await emulateDevice(page,d);
    for(const level of [10,17,21]) {
      const url=new URL(base);
      for(const [key,value] of Object.entries({level,mute:1,seed:2,bot:1}))url.searchParams.set(key,value);
      await page.navigate(url.href);
      await page.waitFor(`window.__kiln?.world?.step>0 && window.__kiln.world.level.n===${level} && !window.__kiln.app.attract && window.__kiln.app.mode==='play'`);
      await page.eval(`(async()=>{
        const k=window.__kiln;k.app.paused=true;k.ui.card(null);
        for(const b of k.world.balls)b.alive=false;k.world.api.serve();
        const [world,input,constants,bus,events,field,mounts,THREE]=await Promise.all([
          import('./src/core/world.js'),import('./src/core/input-frame.js'),import('./src/core/constants.js'),
          import('./src/core/bus.js'),import('./src/core/events.js'),import('./src/sim/field.js'),
          import('./src/render/laser-mounts.js'),import('three')]);
        const Q=window.laserQA={...world,...input,...constants,...bus,...events,...field,...mounts,THREE};
        Q.frame=()=>Q.createInputFrame();Q.step=(f=Q.frame(),n=1)=>{for(let i=0;i<n;i++)Q.stepWorld(k.world,f)};
        Q.render=()=>k.advance(1,0);
        Q.snap=()=>{
          const w=k.world,r=k.renderer._internals.actors.root,items=[];
          for(let n=0;n<2;n++){
            const m=r.getObjectByName('laser-emitter-'+n),p={};Q.laserMountPose(w.level.mode,w.paddle,n===0?-1:1,p);
            const h=r.getObjectByName('laser-hardware-'+n),t=r.getObjectByName('laser-ready-tip-'+n),f=r.getObjectByName('laser-muzzle-flash-'+n);
            items.push({hardware:m.visible&&h.visible,tip:m.visible&&h.visible&&t.visible,flash:m.visible&&f.visible,
              error:Math.hypot(m.position.x-(p.x-360),m.position.y-(540-p.y))});
          }
          const c=new Q.THREE.Vector3(w.paddle.x-360,540-w.paddle.y,12).project(k.renderer._internals.camera);
          return {mode:w.level.mode,shots:w.effects.laserShots,width:w.paddle.w,span:w.paddle.span,items,
            screenPaddle:[(c.x+1)*innerWidth/2,(1-c.y)*innerHeight/2],viewport:[innerWidth,innerHeight],layout:k.hudCheck(),phase:w.phase};
        };
        k.advance(18,100);Q.render();
      })()`);
      async function shot(name,armed){
        await page.eval('window.laserQA.render()');
        const s=await page.eval('window.laserQA.snap()');
        assert.ok(s.items.every(v=>v.hardware===armed&&v.tip===armed),`${device}/${level}/${name}: equipment state`);
        if(armed)assert.ok(s.items.every(v=>v.error<1e-6),`${device}/${level}/${name}: bolt origin mismatch`);
        assert.equal(s.layout.overlaps.length,0);
        const file=join(out,`${device}-L${level}-${name}.png`);
        writeFileSync(file,await page.screenshot());report.results.push({device,level,name,...s,file});
      }
      await shot('before',false);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world,p={};
        Q.fromLocal(Q.modeCode(w.level.mode),Q.paddleTrack(Q.modeCode(w.level.mode),w.paddle),0,1,p);
        w.api.spawnDrop(p.x,p.y,Q.DROP.LASER);Q.step();if(!w.effects.laserShots)throw Error('real pickup failed');Q.render();})()`);
      await shot('ready',true);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world;w.api.applyDrop(Q.DROP.WIDE);Q.step(Q.frame(),90);Q.render();})()`);
      await shot('wide',true);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world;w.api.applyDrop(Q.DROP.SHRINK);w.api.applyDrop(Q.DROP.SHRINK);Q.step(Q.frame(),90);Q.render();})()`);
      await shot('shrink',true);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world,k=window.__kiln;
        const shots=w.effects.laserShots;const f=Q.frame();f.action=true;Q.step(f);Q.render();
        if(w.effects.laserShots!==shots)throw Error('launch spent Laser');
        if(k.renderer._internals.actors.padState.laserT>-1e8)throw Error('launch produced muzzle flash');
        Q.step(f);Q.render();if(w.effects.laserShots!==shots-1)throw Error('real volley failed');
        if(!Q.snap().items.every(i=>i.flash))throw Error('no firing flash');})()`);
      await shot('firing',true);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world,f=Q.frame();f.action=true;
        while(w.effects.laserShots>0){for(const b of w.lasers)b.alive=false;Q.step(f)}Q.render();})()`);
      await shot('spent',false);
      await page.eval(`(()=>{const Q=window.laserQA,w=window.__kiln.world;
        w.api.applyDrop(Q.DROP.LASER);w.systems.economy.step(w,Q.frame());Q.render();
        if(!Q.snap().items.every(i=>i.hardware))throw Error('reacquire failed');
        Q.emit(w.bus,Q.EV.OUT_OF_BALLS);w.systems.economy.step(w,Q.frame());Q.render();
        window.__kiln.advance(2,100);if(Q.snap().items.some(i=>i.flash))throw Error('stale muzzleflash');})()`);
      await shot('life-cleared',false);
      await page.eval(`window.oldLaserWorld=window.__kiln.world;window.__kiln.startRun(${level})`);
      await page.waitFor(`window.__kiln.world!==window.oldLaserWorld && window.__kiln.world.level.n===${level} && !window.__kiln.app.attract`);
      await page.eval(`(()=>{window.__kiln.app.paused=true;window.laserQA.render();if(window.laserQA.snap().items.some(i=>i.flash))throw Error('newworld stale flash');})()`);
      await shot('new-level',false);
      console.log(`${device}/L${level}: real pickup, widths, firing, spent/life/new-level PASS`);
    }
    await page.send('Target.closeTarget',{targetId:page.targetId});
  }
  assert.deepEqual(report.errors,[]);
} finally {await chrome.close();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
