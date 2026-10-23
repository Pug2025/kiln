import {test,assert,near} from './lib.mjs';
import {DETAIL,createReadability,updateReadability,dropRotation} from '../src/core/readability.js';
import {DROP,DROPS,SIM,RING,PADDLE} from '../src/core/constants.js';
import {EV} from '../src/core/events.js';
import {fromLocal,modeCode,paddleTrack,halfReach,RING_FACE} from '../src/sim/field.js';
import {DROP_GRACE} from '../src/sim/bodies.js';
import {physicsWorld,recorder,steps} from './fixtures/A/sim.mjs';

test('view details leave desktop unchanged and use the same CSS target at every phone scale',()=>{
 const d=createReadability();assert.equal(d.small,false);assert.equal(d.dropHalfU,24);assert.equal(d.dropHalfV,11);assert.equal(d.emberR,3);
 for(const [width,height,scale] of [[390,844,.45],[320,568,.3],[844,390,.25]]){
  updateReadability(width,height,scale,d);assert.ok(d.small);near(d.dropHalfU*2*scale,44,1e-9);near(d.dropHalfV*2*scale,36,1e-9);near(d.emberR*2*scale,6,1e-9);
 }
 updateReadability(1280,800,.6,d);assert.equal(d.small,false);assert.equal(d.dropHalfU,DETAIL.DROP_HALF_U);assert.equal(d.dropHalfV,DETAIL.DROP_HALF_V);assert.equal(d.emberR,3);
});

test('all drop kinds use the drawn phone footprint at the paddle, with an honest outside miss in all modes',()=>{
 for(const mode of ['bottom','left','ring'])for(const kind of [DROP.WIDE,DROP.LASER,DROP.SHRINK,DROP.FOG])for(const side of [-1,1])for(const inside of [true,false]){
  const {world:w,frame}=physicsWorld({mode});updateReadability(390,844,.45,w.readability);
  const mc=modeCode(mode),track=paddleTrack(mc,w.paddle),p={};
  const u=side*(halfReach(mc,w.paddle)+w.readability.dropHalfU+DROP_GRACE+(inside?-1:1));
  fromLocal(mc,track,u,0,p);const i=w.api.spawnDrop(p.x,p.y,kind);w.drops[i].vx=w.drops[i].vy=0;
  const read=recorder(w);steps(w,frame,1);assert.equal(read().some(e=>e.type===EV.DROP_CAUGHT),inside,`${mode}/${kind}/${side}/${inside}`);
 }
});

test('ring capsule orientation follows its tangent while the icon stays a separate upright plane',()=>{
 for(const a of [0,Math.PI/2,Math.PI,-Math.PI/2,.37]){
  const rotation=dropRotation('ring',360+300*Math.cos(a),540+300*Math.sin(a));
  near(Math.abs(Math.cos(rotation)*Math.cos(a)+Math.sin(rotation)*-Math.sin(a)),0,1e-9);
 }
 assert.equal(dropRotation('bottom',0,0),0);assert.equal(dropRotation('left',0,0),-Math.PI/2);
});

test('enlarged phone ring drops remain alive until the entire visible footprint leaves the loss ring',()=>{
 for(const scale of [.45,.30]){
  const {world:w,frame}=physicsWorld({mode:'ring'});updateReadability(390,844,scale,w.readability);
  const read=recorder(w);
  const i=w.api.spawnDrop(RING.CX,RING.CY-RING.R_LOSS-2,DROP.LASER);
  steps(w,frame,1);
  assert.equal(w.drops[i].alive,true,'a still-visible body opposite the paddle must not disappear');
  assert.ok(!read().some(e=>e.type===EV.DROP_MISSED));
  w.drops[i].x=w.drops[i].px=RING.CX;
  w.drops[i].y=w.drops[i].py=RING.CY-RING.R_LOSS-w.readability.dropHalfV-1;
  steps(w,frame,1);
  assert.equal(w.drops[i].alive,false);
  assert.equal(read().filter(e=>e.type===EV.DROP_MISSED).length,1);
 }
 const {world:w,frame}=physicsWorld({mode:'ring'});
 const i=w.api.spawnDrop(RING.CX,RING.CY-RING.R_LOSS-2,DROP.LASER);
 steps(w,frame,1);assert.equal(w.drops[i].alive,false,'desktop retains its existing cleanup');
});

test('phone ring drops with a visible radial gap at late corners do not catch, including bad drops',()=>{
 for(const side of [-1,1])for(const kind of [DROP.LASER,DROP.SHRINK])for(const touches of [false,true]){
  const {world:w,frame}=physicsWorld({mode:'ring'});updateReadability(320,568,.29018,w.readability);
  const mc=modeCode('ring'),p={},u=side*(halfReach(mc,w.paddle)+w.readability.dropHalfU+DROP_GRACE-1);
  const nearestAngle=Math.abs(u)/RING_FACE-w.paddle.span/2;
  const radialLimit=(RING_FACE+PADDLE.H)*Math.cos(nearestAngle)+DROP_GRACE+w.readability.dropHalfV;
  const radius=touches?radialLimit-2:RING_FACE+PADDLE.H+w.readability.dropHalfV-2;
  fromLocal(mc,paddleTrack(mc,w.paddle),u,RING_FACE-radius,p);
  const i=w.api.spawnDrop(p.x,p.y,kind),d=w.drops[i];
  // Ring movement adds one fixed outward step. Account for it when placing the test body.
  const move=DROPS.FALL*SIM.DT,ratio=(radius-move)/radius;d.x=d.px=RING.CX+(p.x-RING.CX)*ratio;d.y=d.py=RING.CY+(p.y-RING.CY)*ratio;
  const read=recorder(w);steps(w,frame,1);
  assert.equal(read().some(e=>e.type===EV.DROP_CAUGHT),touches,`${kind}/${side}/${touches}`);
 }
});
