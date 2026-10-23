#!/usr/bin/env node
// Controlled resource/guide/win/save witnesses; not a human playthrough.
// node tools/qa/resourcecheck.mjs --url http://localhost:8792/ --out tools/qa/out/resourcecheck
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {launchChrome} from './lib/cdp.mjs';
import {getDevice,emulateDevice} from './lib/devices.mjs';
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=option('--url','http://localhost:8792/');
const out=resolve(option('--out','tools/qa/out/resourcecheck'));
const devices=option('--devices','desktop,iphone14pro,mobile').split(',');
const report={controlledStates:true,states:[],errors:[]};mkdirSync(out,{recursive:true});
const chrome=await launchChrome();
try{
 for(const device of devices){
  const page=await chrome.newPage();await page.send('Runtime.enable');await page.send('Network.enable');
  page.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  page.on('Network.responseReceived',e=>{if(e.response.status>=400)report.errors.push(`${e.response.status} ${e.response.url}`)});
  const d=getDevice(device);if(device==='mobile'){d.width=320;d.height=568;}await emulateDevice(page,d);
  async function shot(name){
   const s=await page.eval(`(()=>{const k=window.__kiln,w=k.world,screen=document.querySelector('.screen.in:not(.out)'),p=screen?.querySelector('.panel');
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
    return {ui:k.ui.current,level:w.level.n,stage:w.level.def.stage||1,mode:w.level.mode,layout:k.hudCheck(),text:screen?.innerText||document.querySelector('.boss-fact')?.textContent,
     panel:p?rect(p):null,buttons:screen?[...screen.querySelectorAll('button')].map(e=>({text:e.innerText,...rect(e)})):[],wallet:k.data.forge.embers,savedWallet:k.save.load().forge.embers,
     hudText:document.querySelector('.hud')?.innerText,canvasFilter:getComputedStyle(document.querySelector('#view canvas')).filter,laserShots:w.effects.laserShots,caught:w.econ.embersCaught,auto:w.econ.embersAutoBanked,liveEmbers:[...w.embers.alive].reduce((a,b)=>a+b,0),liveDrops:w.drops.filter(d=>d.alive).length};})()`);
   assert.equal(s.layout.overlaps.length,0,`${device}/${name} HUD overlap`);
   if(s.panel){assert.ok(s.panel.x>=-1&&s.panel.y>=-1&&s.panel.x+s.panel.w<=d.width+1&&s.panel.y+s.panel.h<=d.height+1,`${device}/${name} panel out of bounds`);
    for(const b of s.buttons)assert.ok(b.x>=-1&&b.y>=-1&&b.x+b.w<=d.width+1&&b.y+b.h<=d.height+1,`${device}/${name} unreachable ${b.text}`);}
   const file=join(out,`${device}-${name}.png`);writeFileSync(file,await page.screenshot());report.states.push({device,name,...s,file});return s;
  }
  async function click(text){await page.eval(`(()=>{const b=[...document.querySelectorAll('.screen.in:not(.out) button')].find(e=>(e.querySelector('.label')?.textContent||e.textContent).trim().toLowerCase()===${JSON.stringify(text.toLowerCase())});if(!b)throw Error('missing button '+${JSON.stringify(text)});b.click()})()`);}
  async function waitUI(name){await page.waitFor(`window.__kiln.ui.current===${JSON.stringify(name)}&&!!document.querySelector('.screen-${name}.in:not(.out)')`);await page.eval(`new Promise(r=>setTimeout(r,250))`);}
  const url=new URL(base);url.searchParams.set('mute','1');url.searchParams.set('bot','1');await page.navigate(url.href);await page.waitFor('!!window.__kiln?.renderer');await page.eval('window.__kiln.showTitle()');await waitUI('title');
  await click('HOW IT WORKS');await waitUI('guide');await shot('title-guide');
  const guide=await page.eval(`(()=>{const e=document.querySelector('.guide-copy');e.scrollTop=e.scrollHeight;return {max:e.scrollHeight-e.clientHeight,actual:e.scrollTop,text:e.innerText}})()`);assert.ok(guide.text.includes('next run'));if(device!=='desktop')assert.ok(guide.max>0&&guide.actual>0,'guide must scroll');await shot('guide-bottom');
  await click('Back');await waitUI('title');
  await page.eval(`(()=>{const k=window.__kiln;k.data.forge.embers=20;k.data.forge.ranks.embers=1;delete k.data.campaign.cleared[30];k.save.write(k.data);k.startRun(7)})()`);
  await page.waitFor('window.__kiln.world.level.n===7&&!window.__kiln.app.attract&&window.__kiln.app.mode==="play"');
  await page.eval(`(async()=>{const k=window.__kiln;k.app.paused=true;k.ui.card(null);
   const [world,input,constants,bus,events]=await Promise.all([import('./src/core/world.js'),import('./src/core/input-frame.js'),import('./src/core/constants.js'),import('./src/core/bus.js'),import('./src/core/events.js')]);
   window.RQ={...world,...input,...constants,...bus,...events};const Q=window.RQ;
   Q.step=(n=1)=>{for(let i=0;i<n;i++)Q.stepWorld(k.world,Q.createInputFrame())};
   Q.hit=i=>{const w=k.world;Q.emit(w.bus,Q.EV.BRICK_HIT,i,w.bricks.x[i],w.bricks.y[i],-1,Q.SRC.BALL);w.systems.content.resolve(w);w.systems.economy.step(w,Q.createInputFrame())};
   Q.win=()=>{const w=k.world;for(const b of w.balls)b.alive=false;w.api.spawnEmbers(100,100,3);w.api.spawnDrop(100,120,Q.DROP.LASER);w.api.spawnDrop(130,120,Q.DROP.SHRINK);
    if(w.boss.active){const core=[...Array(w.bricks.count).keys()].find(i=>w.bricks.alive[i]&&w.bricks.type[i]===Q.BRICK.WEAK&&(w.bricks.flags[i]&Q.BF.BOSS));let attempts=0;while(w.boss.hp>0&&attempts++<80){Q.hit(core);if(w.boss.hp>0)Q.step(62)};if(w.boss.hp>0)throw Error("boss fixture stalled hp="+w.boss.hp+" phase="+w.phase)}
    else for(let i=0;i<w.bricks.count;i++)if(w.bricks.alive[i]&&(w.bricks.flags[i]&Q.BF.CLEARABLE)){let guard=50;while(w.bricks.alive[i]&&guard-->0)Q.hit(i)}
    if(w.level.remaining!==0)throw Error('did not clear');Q.step(1);k.advance(1,0);
    window.beforeBank={wallet:k.data.forge.embers,raw:w.run.embersBanked-w.run.banked,hudText:document.querySelector('.hud')?.innerText,canvasFilter:getComputedStyle(document.querySelector('#view canvas')).filter,laserShots:w.effects.laserShots,caught:w.econ.embersCaught,auto:w.econ.embersAutoBanked};return window.beforeBank;};
   Q.flow=()=>{k.qa.bot=false;k.app.endAt=k.app.last+1;k.app.paused=false;k.advance(1,20);k.app.paused=true;};
   k.advance(1,0);})()`);
  await shot('heat-pull-shield');
  await page.eval('window.__kiln.app.paused=false;window.__kiln.pause("user")');await waitUI('pause');await click('How it works');await waitUI('guide');const step=await page.eval('window.__kiln.world.step');await page.eval('window.__kiln.advance(20,100)');assert.equal(await page.eval('window.__kiln.world.step'),step);await shot('pause-guide');await click('Back');await waitUI('pause');assert.equal(await page.eval('window.__kiln.app.paused'),true);await click('Resume');await page.waitFor('window.__kiln.ui.current===null');await page.eval('window.__kiln.app.paused=true');
  for(const level of [7,10,30]){
   if(level!==7){await page.eval(`window.__kiln.qa.bot=true;window.__kiln.startRun(${level})`);await page.waitFor(`window.__kiln.world.level.n===${level}&&!window.__kiln.app.attract&&window.__kiln.app.mode==='play'`);await page.eval('window.__kiln.app.paused=true;window.__kiln.ui.card(null)');}
   for(let stage=1;stage<=(level===30?3:1);stage++){
    if(level===10||level===30)await page.eval(`(()=>{const k=window.__kiln,w=k.world;w.api.applyDrop(window.RQ.DROP.LASER);w.api.applyDrop(window.RQ.DROP.WIDE);w.econ.heat=100;window.RQ.step();k.advance(1,0);if(!w.effects.laserShots)throw Error("Laser fixture not armed")})()`);
    if(level===10){await page.eval('new Promise(r=>setTimeout(r,400))');const armed=await shot('boss-laser-heat');assert.ok(armed.laserShots>0);assert.match(armed.hudText,/Laser/);assert.equal(armed.canvasFilter,'none');}
    const before=await page.eval('window.RQ.win()');assert.ok(before.auto>0);const ceremony=await shot(`L${level}-stage${stage}-banked`);assert.equal(ceremony.liveEmbers,0);assert.equal(ceremony.liveDrops,0);assert.match(ceremony.text,/embers banked/);
    await page.eval('window.RQ.flow()');const expected=before.wallet+Math.floor(before.raw*1.25);
    assert.equal(await page.eval('window.__kiln.data.forge.embers'),expected,'Forge gain conversion');assert.equal(await page.eval('window.__kiln.save.load().forge.embers'),expected,'saved wallet');
    if(level===30&&stage<3){assert.equal(await page.eval('window.__kiln.world.level.def.stage'),stage+1);assert.ok(!await page.eval('window.__kiln.data.campaign.cleared[30]'),'stage must not record campaign clear');}
    else{await waitUI('results');const s=await shot(`L${level}-results`);assert.match(s.text,/auto-banked/);assert.match(s.text,/Forge wallet/);const wallet=s.wallet;await page.eval('window.__kiln.advance(50,100)');assert.equal(await page.eval('window.__kiln.save.load().forge.embers'),wallet,'no repeat banking');if(level===30){assert.match(s.text,/This encounter/);assert.ok(await page.eval('window.__kiln.data.campaign.cleared[30]'));}}
   }
  }
  await page.send('Target.closeTarget',{targetId:page.targetId});console.log(`${device}: guide, pause, HUD, win settlement, Forge conversion, Core stages PASS`);
 }
 assert.deepEqual(report.errors,[]);
}finally{await chrome.close();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
