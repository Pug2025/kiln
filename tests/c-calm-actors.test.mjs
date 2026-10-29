// Actual pinned Three geometry/material/pool checks. Only the unrelated glyph-painting canvas is
// stubbed; no WebGL, browser, animation timing or rendered contrast is claimed by these tests.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { test, assert, near } from './lib.mjs';
import { BALL, FIELD, PADDLE, RING } from '../src/core/constants.js';
import { LOOK } from '../src/render/look.js';
import { FORGE_FX } from '../src/economy/tuning.js';
import { ringSpanFor, setTrack } from '../src/sim/field.js';
import { paddleBloomRadius } from '../src/render/ball-bloom.js';
import { physicsWorld } from './fixtures/A/sim.mjs';
const THREE_URL = new URL('../vendor/three/0.160.0/build/three.module.js', import.meta.url).href;
const ROUND_URL = new URL('../vendor/three/0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(spec, ctx, next) {
  if (spec === 'three') return {url:${JSON.stringify(THREE_URL)},shortCircuit:true};
  if (spec === 'three/addons/geometries/RoundedBoxGeometry.js') return {url:${JSON.stringify(ROUND_URL)},shortCircuit:true};
  return next(spec,ctx);
}`)}`);
const THREE = await import(THREE_URL);
const { createActors } = await import('../src/render/actors.js');
const { createRig } = await import('../src/render/rig.js');
const { PAL, glassMaterial, createNeutralTextures, unifyStandardMaterials } = await import('../src/render/materials.js');
const { LASER_MOUNT, laserMountPose } = await import('../src/render/laser-mounts.js');
const context = { fillRect(){}, beginPath(){},moveTo(){},lineTo(){},arc(){},quadraticCurveTo(){},bezierCurveTo(){},stroke(){},drawImage(){},
  getImageData(x,y,w,h){return {data:new Uint8ClampedArray(w*h*4).fill(255)};} };
globalThis.document = {createElement(){return {getContext(){return context;}};}};
const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
function pose(mesh, i) { mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);return {position:position.toArray(),scale:scale.toArray()}; }
function setup(mode='bottom') {
  const {world:w}=physicsWorld({mode});
  const scene=new THREE.Scene();
  const M={titanium:new THREE.MeshStandardMaterial({color:0xaaaeb4,metalness:.9,roughness:.25}),paddleGlass:glassMaterial(),darkMetalP:new THREE.MeshPhysicalMaterial(),core:new THREE.MeshStandardMaterial(),matteFree:new THREE.MeshStandardMaterial(),wallGlassI:glassMaterial(),tex:{glow:new THREE.Texture()}};
  // Actual initial plane inherited from createBricks, before renderer.setWorld moves its wall.
  const wallClip=[new THREE.Plane(new THREE.Vector3(0,-1,0),FIELD.H/2)];
  M.titanium.clippingPlanes=wallClip;M.titanium.map=new THREE.Texture();
  Object.assign(M.tex,createNeutralTextures());
  const original={color:M.titanium.color.toArray(),emissive:M.titanium.emissive.toArray(),env:M.titanium.envMapIntensity};
  const actors=createActors(scene,M);actors.setWorld(w);
  const draw=(t=2,dt=1/60,alpha=.5,flare=0)=>actors.frame(w,alpha,t,{st:{flare}},dt);
  const find=name=>scene.getObjectByName(name);
  return {w,scene,M,wallClip,original,actors,draw,find,cores:find('ball-cores'),outlines:find('ball-outlines')};
}
function liveBalls(w,n=1) {for(let i=0;i<w.balls.length;i++)Object.assign(w.balls[i],{alive:i<n,held:false,sealed:-1,r:BALL.R,x:180+i*20,y:440,px:160+i*20,py:420,vx:300,vy:-200});}
function snapshot(w){return JSON.stringify({balls:w.balls,paddle:w.paddle,effects:w.effects,level:w.level,phase:w.phase,rng:w.rng});}

test('calm ball is a bounded heat-high solid sphere with a dark untextured normal-blended rim',()=>{
 const r=setup();liveBalls(r.w);r.draw();
 const core=r.cores.material,outline=r.outlines.material;
 assert.ok(LOOK.BALL_GAIN<=1&&LOOK.BALL_LIGHT===0,'calm palette values must be integrated');
 assert.deepEqual(core.uniforms.uBallColor.value.toArray(),PAL.heatHi.clone().multiplyScalar(LOOK.BALL_GAIN).toArray());
 assert.ok(Math.max(...core.uniforms.uBallColor.value.toArray())<=1);
 assert.ok(core.fragmentShader.includes('0.68 + 0.32 * light')&&core.fragmentShader.includes(', 1.0)'),'bounded sphere shading remains opaque');
 assert.equal(r.cores.geometry.type,'SphereGeometry');
 assert.equal(outline.blending,THREE.NormalBlending);assert.equal(outline.uniforms.uOpacity.value,1);
 assert.ok(outline.uniforms.uOutlineColor.value.r<.02&&outline.uniforms.uOutlineColor.value.g<.02);
 assert.equal(outline.map,undefined);assert.ok(!outline.fragmentShader.includes('texture2D'));
 assert.ok(outline.fragmentShader.includes('fwidth(radius)'));assert.equal(outline.extensions.derivatives,true);
 assert.equal(core.depthTest,false);assert.equal(outline.depthTest,false);
 assert.ok(r.outlines.renderOrder<r.cores.renderOrder);assert.equal(r.actors.ballLight.intensity,0);
 assert.equal(r.scene.getObjectById(r.actors.ballLight.id),undefined,'a disabled moving light never enters the render lighting inventory');
});

test('all ball slots keep their physical core and fixed tight outline under multiball, Slow, Fire and time',()=>{
 const r=setup();liveBalls(r.w,BALL.MAX);r.w.balls[3].r=18;
 const color=r.cores.material.uniforms.uBallColor.value,identity=r.outlines.instanceMatrix.array;
 for(const effects of [{fire:0,ballSpeedScale:1},{fire:1,ballSpeedScale:1},{fire:0,ballSpeedScale:.5}]) {
  Object.assign(r.w.effects,effects);r.draw(1);const before=Array.from(identity);r.draw(1.13);
  assert.deepEqual(Array.from(identity),before,'the dark rim does not pulse');
  assert.equal(r.cores.count,BALL.MAX);assert.equal(r.outlines.count,BALL.MAX);
  for(let i=0;i<BALL.MAX;i++){
   const c=pose(r.cores,i),o=pose(r.outlines,i),radius=r.w.balls[i].r;
   near(c.scale[0],radius/BALL.R,1e-6);assert.deepEqual(o.position,c.position);
   near(o.scale[0]/(2*radius),1.16,1e-6);near(o.scale[1],o.scale[0],1e-6);
  }
  assert.equal(r.cores.material.uniforms.uBallColor.value,color,'retained uniform identity');
 }
 assert.equal(r.outlines.instanceMatrix.array,identity,'retained pooled matrix storage');
});

test('held, sealed, dead and reset balls cannot leave a detached or stale outline',()=>{
 const r=setup();liveBalls(r.w,4);r.w.balls[0].held=true;r.w.balls[1].sealed=4;r.w.balls[2].alive=false;
 r.draw(3,0,.25);assert.equal(r.cores.count,3);assert.equal(r.outlines.count,3);
 near(pose(r.cores,0).position[0],r.w.balls[0].x-FIELD.W/2,1e-6);
 near(pose(r.outlines,1).scale[0],0);near(pose(r.cores,1).scale[0],.5);
 for(const b of r.w.balls)b.alive=false;r.draw();assert.equal(r.cores.count,0);assert.equal(r.outlines.count,0);
 liveBalls(r.w);r.draw();assert.equal(r.cores.count,1);
 r.actors.setWorld(r.w);assert.equal(r.cores.count,0);assert.equal(r.outlines.count,0);assert.equal(r.actors.ballLight.intensity,0);
});

test('the rim faces real fitted cameras through tilt, maximum lean and roll without exceeding 1.16r',()=>{
 const r=setup();
 assert.ok(r.outlines.material.vertexShader.includes('centre.xy += position.xy * size'),'offset in camera view space');
 assert.ok(r.outlines.material.vertexShader.includes('modelViewMatrix * instanceMatrix * vec4(0.0'));
 for(const mode of ['bottom','left','ring'])for(const [width,height]of[[1280,800],[390,844],[320,568]])for(const lead of[0,720]){
  const {world:w}=physicsWorld({mode}),camera=new THREE.PerspectiveCamera(35,width/height,10,8000),rig=createRig(camera);
  rig.setWorld(w);rig.resize(width,height);
  for(let i=0;i<240;i++)rig.update(20,1/60,lead,w.fx);
  for(const [x,y]of[[9,90],[711,90],[9,1000],[711,1000],[360,540]]){
   const centre=new THREE.Vector3(x-FIELD.W/2,FIELD.H/2-y,0).applyMatrix4(camera.matrixWorldInverse);
   const distance=centre.length(),toward=centre.clone().normalize();
   const u=new THREE.Vector3().crossVectors(toward,new THREE.Vector3(0,1,0)).normalize(),v=new THREE.Vector3().crossVectors(toward,u).normalize();
   const tangentCentre=centre.clone().addScaledVector(toward,-BALL.R*BALL.R/distance),tangentRadius=BALL.R*Math.sqrt(1-BALL.R*BALL.R/(distance*distance));
   const clip=centre.clone().applyMatrix4(camera.projectionMatrix),px=p=>[p.x*width/2,p.y*height/2],c=px(clip);
   const disk=centre.clone();disk.x+=BALL.R*1.16;disk.applyMatrix4(camera.projectionMatrix);const edge=px(disk),rim=Math.hypot(edge[0]-c[0],edge[1]-c[1]);
   let min=Infinity,max=0;
   for(let n=0;n<96;n++){
    const a=n*Math.PI*2/96,p=tangentCentre.clone().addScaledVector(u,Math.cos(a)*tangentRadius).addScaledVector(v,Math.sin(a)*tangentRadius).applyMatrix4(camera.projectionMatrix),q=px(p),d=Math.hypot(q[0]-c[0],q[1]-c[1]);min=Math.min(min,d);max=Math.max(max,d);
   }
   assert.ok(rim>=max-1e-6,`${mode}/${width}/${lead}/${x},${y}: camera-facing disk contains the sphere silhouette`);
   assert.ok(rim<=min*1.16+1e-6,`${mode}/${width}: no broad corona`);
   const vertical=centre.clone();vertical.y+=BALL.R*1.16;vertical.applyMatrix4(camera.projectionMatrix);const q=px(vertical);near(Math.hypot(q[0]-c[0],q[1]-c[1]),rim,1e-7);
  }
 }
});

test('warm solid paddle clone and thin hit/catch lines remain bounded in every field mode',()=>{
 for(const mode of ['bottom','left','ring']){
  const r=setup(mode);liveBalls(r.w);r.actors.perfect(2);for(let i=0;i<8;i++)r.actors.catchTick();r.draw(2,0,.5,3);
  const blade=r.find(mode==='ring'?'paddle-arc-blade':'paddle-blade'),line=r.find(mode==='ring'?'paddle-arc-heat-line':'paddle-heat-line'),flare=r.find(mode==='ring'?'paddle-arc-perfect-line':'paddle-perfect-line');
  assert.equal(blade.material.envMapIntensity,1.4);assert.equal(blade.material.roughness,.38);
  assert.ok(blade.material.color.r>=blade.material.color.g&&blade.material.color.g>=blade.material.color.b);
  assert.ok(Math.max(...blade.material.emissive.toArray())<LOOK.BLOOM_THRESHOLD);
  assert.deepEqual(r.M.titanium.color.toArray(),r.original.color);assert.deepEqual(r.M.titanium.emissive.toArray(),r.original.emissive);assert.equal(r.M.titanium.envMapIntensity,r.original.env);
  assert.ok(Math.max(...line.material.color.toArray())<=1);assert.equal(line.geometry.parameters.height,1.2);
  assert.equal(flare.material.blending,THREE.NormalBlending);assert.equal(flare.material.opacity,1);assert.ok(Math.max(...flare.material.color.toArray())<=1);
  r.draw(3,0);assert.equal(flare.material.opacity,0,'perfect cue clears');
 }
});

test('Catch, Laser, Afterimage and paddle widths keep their native cue state without simulation writes',()=>{
 for(const mode of ['bottom','left','ring'])for(const width of[PADDLE.W_SHRINK,PADDLE.W,PADDLE.W_WIDE,PADDLE.W_WIDE+FORGE_FX.PADDLE_ADD.at(-1)]){
  const r=setup(mode);liveBalls(r.w);r.w.paddle.w=width;r.w.level.rules.ghosts=true;r.w.effects.catchOn=true;r.w.effects.laserShots=2;
  const before=snapshot(r.w);r.draw();assert.equal(snapshot(r.w),before);
  assert.equal(r.find(mode==='ring'?'paddle-arc-catch-line':'paddle-catch-line').visible,true);
  const mounts=r.find('laser-emitters');assert.ok(mounts.children.every(c=>c.visible));
  r.w.effects.catchOn=false;r.w.effects.laserShots=0;r.w.level.rules.ghosts=false;r.draw();
  assert.equal(r.find(mode==='ring'?'paddle-arc-catch-line':'paddle-catch-line').visible,false);assert.ok(mounts.children.every(c=>!c.visible));
 }
});

function paddleParts(r) {
 return [r.find('paddle-blade'),...r.find('laser-emitters').children.map(m=>m.children[0].children[1])];
}
function paddleSurface(m) {
 return {color:m.color.toArray(),emissive:m.emissive.toArray(),roughness:m.roughness,metalness:m.metalness,
  emissiveIntensity:m.emissiveIntensity,envMapIntensity:m.envMapIntensity,map:m.map,normalMap:m.normalMap,
  normalMapType:m.normalMapType,normalScale:m.normalScale.toArray(),envMap:m.envMap,side:m.side,
  transparent:m.transparent,opacity:m.opacity,blending:m.blending,depthTest:m.depthTest,depthWrite:m.depthWrite,
  colorWrite:m.colorWrite,fog:m.fog,toneMapped:m.toneMapped,vertexColors:m.vertexColors,
  onBeforeCompile:m.onBeforeCompile,key:m.customProgramCacheKey()};
}

test('bottom titanium preserves the complete finish and retains the original independent left/ring planes',()=>{
 const r=setup(),parts=paddleParts(r),bottom=parts[0].material,arc=r.find('paddle-arc-blade').material;
 let legacy;
 r.actors.withWarmPaddleMaterials(()=>{legacy=parts[1].material;unifyStandardMaterials(r.scene,r.M.tex);});
 assert.notEqual(bottom,legacy);assert.equal(bottom.clippingPlanes,null);
 assert.notEqual(legacy.clippingPlanes,r.wallClip);assert.notEqual(legacy.clippingPlanes[0],r.wallClip[0]);
 assert.notEqual(arc.clippingPlanes[0],legacy.clippingPlanes[0]);
 assert.deepEqual(legacy.clippingPlanes[0].normal.toArray(),[0,-1,0]);assert.equal(legacy.clippingPlanes[0].constant,FIELD.H/2);
 assert.deepEqual(paddleSurface(bottom),paddleSurface(legacy));
 assert.equal(bottom.map,r.M.titanium.map);assert.equal(bottom.normalMap,r.M.tex.neutralNormal);
 assert.deepEqual(bottom.normalScale.toArray(),[0,0]);
 // The later brick setWorld changes the source wall; Material.copy must keep the legacy plane.
 r.wallClip[0].normal.set(-1,0,0);r.wallClip[0].constant=120;
 const versions=[bottom.version,legacy.version,arc.version];
 for(const mode of ['bottom','left','ring','bottom','ring','left','bottom']){
  r.w.level.mode=mode;const before=snapshot(r.w);r.actors.setWorld(r.w);r.draw();
  assert.equal(snapshot(r.w),before);assert.ok(parts.every(p=>p.material===(mode==='bottom'?bottom:legacy)));
  assert.equal(r.find('paddle-arc-blade').material,arc);
  for(const m of [legacy,arc]){assert.deepEqual(m.clippingPlanes[0].normal.toArray(),[0,-1,0]);assert.equal(m.clippingPlanes[0].constant,FIELD.H/2);}
  assert.deepEqual([bottom.version,legacy.version,arc.version],versions,'world changes and frames only select retained materials');
 }
});

test('actual bottom blade and collar vertices remain below the inherited plane through Forge widths and lean',()=>{
 const r=setup(),parts=paddleParts(r),p=r.w.paddle,vertex=new THREE.Vector3(),pose={};
 const plane=r.wallClip[0],geometry=parts.map(m=>m.geometry),attributes=geometry.map(g=>[...g.attributes.position.array,...g.attributes.normal.array,...g.attributes.uv.array]);
 for(const add of FORGE_FX.PADDLE_ADD)for(const width of [PADDLE.W_SHRINK+add,PADDLE.W+add,PADDLE.W_WIDE+add,PADDLE.W-20+add,PADDLE.W+30+add]){
  p.w=width;p.span=ringSpanFor(width);
  for(const track of [0,FIELD.W/2,FIELD.W])for(const vel of [-1e6,0,1e6]){
   setTrack(r.w,track);p.vel=vel;r.w.effects.laserShots=2;
   const before=snapshot(r.w);r.draw(2,0);r.scene.updateMatrixWorld(true);assert.equal(snapshot(r.w),before);
   for(const [k,mesh]of parts.entries()){
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++){
     vertex.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
     const fieldY=FIELD.H/2-vertex.y;
     assert.ok(plane.distanceToPoint(vertex)>0,'no vertex is on the discarded side');
     assert.ok(fieldY>=(k===0?987.8:994)-1e-4,`${width}/${track}/${vel}/${k}: minimum field y`);
     if(k>0)assert.ok(fieldY<=1000+1e-4);
    }
    if(k>0){
     laserMountPose('bottom',p,k===1?-1:1,pose);
     near(mesh.parent.parent.position.y,FIELD.H/2-pose.y,1e-9);
     near(pose.y,PADDLE.Y-PADDLE.H/2-LASER_MOUNT.FRONT,1e-9);near(mesh.parent.parent.rotation.z,0,1e-9);
    }
   }
  }
 }
 assert.deepEqual(parts.map(m=>m.geometry),geometry);
 assert.deepEqual(geometry.map(g=>[...g.attributes.position.array,...g.attributes.normal.array,...g.attributes.uv.array]),attributes);
});

test('paddle preparation permutations restore exact materials and actor state on success, nesting and failure',()=>{
 for(const mode of ['bottom','left','ring']){
  const r=setup(mode),parts=paddleParts(r),active=parts.map(p=>p.material),arc=r.find('paddle-arc-blade').material;
  const before=snapshot(r.w),state=parts.map(m=>[m.geometry,m.visible,m.renderOrder,...m.position.toArray(),...m.scale.toArray()]);
  const token={},failure=new Error('injected preparation failure');
  assert.equal(r.actors.withWarmPaddleMaterials(()=>{
   const split=parts.map(m=>m.material);assert.equal(split[0].clippingPlanes,null);
   assert.equal(split[1].clippingPlanes.length,1);assert.equal(split[2],split[0]);
   r.actors.withWarmPaddleMaterials(()=>{
    assert.deepEqual(parts.map(m=>m.material),[split[1],split[0],split[1]]);
   },true);
   assert.deepEqual(parts.map(m=>m.material),split);
   assert.throws(()=>r.actors.withWarmPaddleMaterials(()=>{throw failure;},true),e=>e===failure);
   assert.deepEqual(parts.map(m=>m.material),split);return token;
  }),token);
  assert.deepEqual(parts.map(m=>m.material),active);
  assert.throws(()=>r.actors.withWarmPaddleMaterials(()=>{throw failure;}),e=>e===failure);
  assert.deepEqual(parts.map(m=>m.material),active);assert.equal(r.find('paddle-arc-blade').material,arc);
  assert.deepEqual(parts.map(m=>[m.geometry,m.visible,m.renderOrder,...m.position.toArray(),...m.scale.toArray()]),state);
  assert.equal(snapshot(r.w),before);
 }
});

test('bottom material selection preserves event-timed perfect, Catch and final-shot muzzle cues',()=>{
 const r=setup(),parts=paddleParts(r),materials=parts.map(m=>m.material),finish=paddleSurface(materials[0]);
 r.w.effects.catchOn=true;r.w.effects.laserShots=1;r.actors.perfect(2);r.actors.laserFired(2);r.actors.catchTick();
 const before=snapshot(r.w);r.draw(2,0);assert.equal(snapshot(r.w),before);
 const line=r.find('paddle-heat-line'),perfect=r.find('paddle-perfect-line'),catchLine=r.find('paddle-catch-line');
 assert.equal(perfect.material.opacity,1);assert.equal(catchLine.visible,true);assert.ok(line.material.color.r<=1);
 for(const mount of r.find('laser-emitters').children){assert.equal(mount.children[0].visible,true);assert.equal(mount.children[1].visible,true);assert.equal(mount.children[1].material.opacity,1);}
 r.w.effects.laserShots=0;r.draw(2.04,0);
 for(const mount of r.find('laser-emitters').children){assert.equal(mount.visible,true);assert.equal(mount.children[0].visible,false);near(mount.children[1].material.opacity,.5,1e-9);}
 r.w.effects.catchOn=false;r.draw(3,0);assert.equal(perfect.material.opacity,0);assert.equal(catchLine.visible,false);
 assert.ok(r.find('laser-emitters').children.every(m=>!m.visible));
 assert.deepEqual(parts.map(m=>m.material),materials);assert.deepEqual(paddleSurface(materials[0]),finish);
});

test('paddle disposal releases all owned variants even when one plain material is absent from the scene',()=>{
 for(const mode of ['bottom','left','ring']){
  const r=setup(mode),parts=paddleParts(r),materials=[],disposed=[];let sharedDisposals=0;
  r.actors.withWarmPaddleMaterials(()=>materials.push(parts[0].material,parts[1].material,r.find('paddle-arc-blade').material));
  const inactive=mode==='bottom'?materials[1]:materials[0];let reachable=false;
  r.scene.traverse(o=>{if(o.material===inactive)reachable=true;});assert.equal(reachable,false);
  for(const material of materials)material.addEventListener('dispose',()=>disposed.push(material));
  for(const shared of [r.M.titanium,r.M.titanium.map,r.M.tex.neutralNormal])shared.addEventListener('dispose',()=>sharedDisposals++);
  const active=parts.map(m=>m.material),before=snapshot(r.w);r.actors.dispose();r.actors.dispose();
  assert.equal(disposed.length,3);assert.equal(new Set(disposed).size,3);assert.ok(materials.every(m=>disposed.includes(m)));
  assert.equal(sharedDisposals,0,'the renderer owns shared textures and base materials');
  assert.deepEqual(parts.map(m=>m.material),active);assert.equal(snapshot(r.w),before);
 }
});


test('actual perfect-line vertices stay on the ring face and inside its local guard at Wide plus Forge',()=>{
 const r=setup('ring'),flare=r.find('paddle-arc-perfect-line');
 assert.deepEqual(flare.scale.toArray(),[1,1,1],'section dimensions are baked before bend');
 assert.equal(flare.geometry.parameters.height,2.2);assert.equal(flare.geometry.parameters.depth,.5);
 for(const width of[PADDLE.W_SHRINK,PADDLE.W,PADDLE.W_WIDE,PADDLE.W_WIDE+FORGE_FX.PADDLE_ADD.at(-1)])for(const angle of[0,Math.PI/2,-Math.PI/3])for(const vel of[-900,900]){
  const p=r.w.paddle;p.w=width;p.span=ringSpanFor(width);p.vel=vel;setTrack(r.w,angle);r.actors.perfect(2);r.draw(2,0);
  r.scene.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(35,1280/800,10,8000),rig=createRig(camera);rig.setWorld(r.w);rig.resize(1280,800);rig.update(20,1/60,p.x,r.w.fx);
  const W=2560,H=1600,clip=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements;
  const project=(x,y)=>{const v=new THREE.Vector3(x-FIELD.W/2,FIELD.H/2-y,0).project(camera);return[(v.x+1)*W/2,(v.y+1)*H/2];};
  const a=project(RING.CX+Math.cos(angle-p.span/2)*RING.R_PADDLE,RING.CY+Math.sin(angle-p.span/2)*RING.R_PADDLE);
  const b=project(RING.CX+Math.cos(angle+p.span/2)*RING.R_PADDLE,RING.CY+Math.sin(angle+p.span/2)*RING.R_PADDLE);
  const radius=paddleBloomRadius(p,'ring',r.actors.pad.rotation.z,clip,W,H,...a,...b),dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
  const position=flare.geometry.attributes.position,u=flare.material.userData.bend,R=u.uR.value,len=u.uLen.value;
  assert.ok(Math.max(...flare.material.color.toArray())<=1,'no HDR recovery');
  for(let i=0;i<position.count;i++){
   const th=position.getX(i)*len/R,rho=R-position.getY(i);
   const local=new THREE.Vector3(rho*Math.sin(th),R-rho*Math.cos(th),position.getZ(i));
   near(Math.hypot(local.x,local.y-R),rho,1e-7,'the line follows the original radius');
   const v=local.applyMatrix4(flare.matrixWorld).project(camera),x=(v.x+1)*W/2,y=(v.y+1)*H/2;
   const k=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/length2));
   assert.ok(Math.hypot(x-a[0]-k*dx,y-a[1]-k*dy)<radius,`${width}/${angle}/${vel}: actual post-bend flare is guarded`);
  }
 }
});

function dropWarmFixture(r) {
 const mega=r.actors.root.children.find(o=>o.isInstancedMesh&&o.material===r.M.core&&o.geometry.type==='BoxGeometry'&&o.geometry.hasAttribute('aHeat'));
 const meshes=['drop-shells','drop-cores','drop-glyphs','phone-drop-backing'].map(r.find).concat(mega);
 assert.ok(meshes.every(Boolean));
 const materials=[...new Set(meshes.map(o=>o.material))],properties=new Map(),calls=[];
 const program=name=>{
  let uniforms,attributes,initializations=0;
  return {name,get initializations(){return initializations;},
   getUniforms(){calls.push(`${name}:uniforms`);if(!uniforms){uniforms={};attributes={};initializations++;}return uniforms;},
   getAttributes(){calls.push(`${name}:attributes`);if(!attributes){attributes={};uniforms={};initializations++;}return attributes;}};
 };
 const gl={properties:{get(material){if(!properties.has(material))properties.set(material,{});return properties.get(material);}},
  render(){throw Error('warm-up must not draw');}};
 return {meshes,materials,properties,calls,program,gl};
}

test('drop warm-up reflects both compiled output variants once without touching unrelated actors or drawing',()=>{
 const r=setup(),f=dropWarmFixture(r),programs=[];
 for(const [i,material]of f.materials.entries()){
  const lite=f.program(`lite${i}`),full=f.program(`full${i}`);programs.push(lite,full);
  f.properties.set(material,{programs:new Map([['lite',lite],['full',full],['duplicate',lite]])});
 }
 assert.equal(f.materials.length,4,'phone backing shares the existing drop core material');
 f.properties.set(r.cores.material,{programs:new Map([['unrelated',{getUniforms(){throw Error('ball program outside scope');}}]])});
 const before=snapshot(r.w),meshState=f.meshes.map(m=>[m.visible,m.count,m.material,m.geometry,m.instanceMatrix.version]);
 r.actors.warmPrograms(f.gl);
 assert.equal(f.calls.length,programs.length*2,'duplicate map values and phone backing do not repeat reflection');
 for(const p of programs){assert.equal(p.initializations,1);assert.equal(f.calls.filter(c=>c===`${p.name}:uniforms`).length,1);assert.equal(f.calls.filter(c=>c===`${p.name}:attributes`).length,1);}
 assert.equal(snapshot(r.w),before);assert.deepEqual(f.meshes.map(m=>[m.visible,m.count,m.material,m.geometry,m.instanceMatrix.version]),meshState);
});

test('drop reflection follows new kit and restored-context maps without persistent readiness flags or frame work',()=>{
 const r=setup(),f=dropWarmFixture(r);
 r.actors.warmPrograms(f.gl);assert.deepEqual(f.calls,[],'not-yet-compiled materials are skipped');
 const initial=f.program('initial');for(const m of f.materials)f.properties.set(m,{programs:new Map([['shared',initial]])});
 r.actors.warmPrograms(f.gl);assert.equal(f.calls.length,2,'one existing program shared across materials');
 r.actors.warmPrograms(f.gl);assert.equal(initial.initializations,1,'native cached getters remain idempotent');
 const late=f.program('late-kit');f.properties.get(r.find('drop-glyphs').material).programs.set('new-map-variant',late);
 r.actors.warmPrograms(f.gl);assert.equal(late.initializations,1,'late kit variant is not suppressed by an old ready flag');
 const restored=f.program('restored');for(const m of f.materials)f.properties.set(m,{programs:new Map([['new-context',restored]])});
 r.actors.warmPrograms(f.gl);assert.equal(restored.initializations,1,'replacement context maps are reflected');
 const n=f.calls.length;liveBalls(r.w);r.draw();r.actors.setWorld(r.w);assert.equal(f.calls.length,n,'frame and world reset never warm programs');
});

test('paddle reflection follows inactive, bent and replaced context program maps without duplicating shared programs',()=>{
 const r=setup('left'),parts=paddleParts(r),materials=[],f=dropWarmFixture(r),shared=f.program('shared-paddle');
 r.actors.withWarmPaddleMaterials(()=>materials.push(parts[0].material,parts[1].material,r.find('paddle-arc-blade').material));
 const unique=materials.map((m,i)=>{const p=f.program(`paddle-${i}`);f.properties.set(m,{programs:new Map([['shared',shared],['own',p]])});return p;});
 r.actors.warmPrograms(f.gl);assert.equal(f.calls.length,8);assert.ok([shared,...unique].every(p=>p.initializations===1));
 const replacement=f.program('restored-inactive-bottom');f.properties.set(materials[0],{programs:new Map([['restored',replacement]])});
 assert.ok(parts.every(m=>m.material===materials[1]),'bottom material remains inactive');
 r.actors.warmPrograms(f.gl);assert.equal(replacement.initializations,1);
});

test('production runtime warm-up preflights both real paddle geometry/program pairs offscreen and restores state',()=>{
 const r=setup(),f=dropWarmFixture(r),trace=[],target={name:'linear-target'},caller={name:'caller-target'},camera={},programs=[];
 const parts=paddleParts(r),materials=parts.map(m=>m.material),pairs=new Set();
 const viewport=new THREE.Vector4(2,3,400,300),scissor=new THREE.Vector4(4,5,200,100);let scissorTest=false,current=caller;
 const gl={...f.gl,autoClear:false,initTexture(){},getRenderTarget(){return current;},
  getViewport(v){return v.copy(viewport);},getScissor(v){return v.copy(scissor);},getScissorTest(){return scissorTest;},
  setViewport(...v){v.length===1?viewport.copy(v[0]):viewport.set(...v);},
  setScissor(...v){v.length===1?scissor.copy(v[0]):scissor.set(...v);},setScissorTest(v){scissorTest=v;},
  setRenderTarget(value){current=value;trace.push(value===target?'target-linear':value===caller?'target-caller':'target-canvas');},
  render(scene,cam){assert.equal(scene,r.scene);assert.equal(cam,camera);assert.equal(current,target);
   assert.deepEqual(viewport.toArray(),[0,0,1,1]);assert.deepEqual(scissor.toArray(),[0,0,1,1]);assert.equal(scissorTest,true);
   trace.push(parts[0].material.clippingPlanes?'preflight-legacy':'preflight-bottom');
   scene.traverse(o=>assert.equal(o.frustumCulled,false));
   for(const mesh of parts){assert.equal(mesh.visible,true);pairs.add(`${mesh.geometry.id}/${mesh.material.clippingPlanes?.length||0}`);}
  },
  compile(scene,cam){assert.equal(scene,r.scene);assert.equal(cam,camera);assert.equal(current,target);trace.push('compile-linear');
   scene.traverseVisible(o=>assert.ok(o!==r.actors.ballLight,'revealing hidden meshes must not compile the disabled lamp'));
   for(const [i,m]of f.materials.entries()){const p=f.program(`linear${i}`);programs.push(p);const props=gl.properties.get(m);if(!props.programs)props.programs=new Map();props.programs.set('linear',p);}
  }};
 const actors={withWarmPaddleMaterials:(...args)=>r.actors.withWarmPaddleMaterials(...args),
  warmTextures(){trace.push('textures');},warmPrograms(renderer){trace.push('reflect');assert.equal(programs.length,4);r.actors.warmPrograms(renderer);}};
 const source=readFileSync(new URL('../src/render/renderer.js',import.meta.url),'utf8');
 const begin=source.indexOf('  function withWarmScene(operation) {'),end=source.indexOf('  // ---- per-frame helpers',begin);
 assert.ok(begin>=0&&end>begin);
 const warm=new Function('THREE','unifyStandardMaterials','scene','M','gl','actors','camera','post','disposed','glWatch',`${source.slice(begin,end)};return warmUp;`)(THREE,unifyStandardMaterials,r.scene,r.M,gl,actors,camera,{composer:{renderTarget1:target},warmUp(){trace.push('post-warm');assert.equal(current,target);}},false,{lost:false});
 r.outlines.visible=false;const counts=f.meshes.map(m=>m.count),objectState=[];r.scene.traverse(o=>objectState.push([o,o.visible,o.frustumCulled]));warm();
 assert.deepEqual(trace,['textures','target-linear','compile-linear','reflect','post-warm','preflight-bottom','preflight-legacy','target-linear','reflect','target-caller']);
 for(const mesh of parts)for(const clip of [0,1])assert.ok(pairs.has(`${mesh.geometry.id}/${clip}`),'both real geometry/program combinations are submitted');
 assert.ok(programs.every(p=>p.initializations===1));assert.equal(r.outlines.visible,false,'hidden meshes restore after preparation');
 assert.deepEqual(f.meshes.map(m=>m.count),counts);assert.equal(current,caller);
 for(const [o,visible,culled]of objectState){assert.equal(o.visible,visible);assert.equal(o.frustumCulled,culled);}
 assert.deepEqual(parts.map(m=>m.material),materials);assert.deepEqual(viewport.toArray(),[2,3,400,300]);assert.deepEqual(scissor.toArray(),[4,5,200,100]);assert.equal(scissorTest,false);
 // Compilation failures still restore caller state and hidden pools. The existing boot guard
 // owns actual readiness; offscreen preparation never marks a successful gameplay frame.
 const failure=new Error('compile failed'),previousWarn=console.warn,warnings=[],compile=gl.compile,render=gl.render;
 gl.compile=()=>{throw failure;};console.warn=(...args)=>warnings.push(args);
 const reflected=f.calls.length;
 try{warm();}finally{console.warn=previousWarn;}
 assert.equal(warnings.length,1);assert.equal(warnings[0][1],failure);
 assert.equal(current,caller);assert.equal(r.outlines.visible,false);
 assert.deepEqual(f.meshes.map(m=>m.count),counts);assert.equal(f.calls.length,reflected);assert.deepEqual(parts.map(m=>m.material),materials);
 for(const pass of [1,2]){
  const preflightFailure=new Error(`preflight ${pass} failed`),worldBefore=snapshot(r.w);
  const bounds=[r.cores.boundingSphere,r.cores.boundingBox,r.cores.geometry.boundingSphere,r.cores.geometry.boundingBox];
  let draws=0;warnings.length=0;programs.length=0;gl.compile=compile;
  gl.render=(...args)=>{
   render(...args);draws++;
   r.cores.boundingSphere=new THREE.Sphere();r.cores.boundingBox=new THREE.Box3();
   r.cores.geometry.boundingSphere=new THREE.Sphere();r.cores.geometry.boundingBox=new THREE.Box3();
   if(draws===pass)throw preflightFailure;
  };
  console.warn=(...args)=>warnings.push(args);
  try{warm();}finally{console.warn=previousWarn;gl.render=render;}
  assert.equal(draws,pass);assert.equal(warnings.length,1);assert.equal(warnings[0][1],preflightFailure);
  assert.equal(current,caller);assert.equal(gl.autoClear,false);assert.equal(scissorTest,false);
  assert.deepEqual(viewport.toArray(),[2,3,400,300]);assert.deepEqual(scissor.toArray(),[4,5,200,100]);
  assert.deepEqual(parts.map(m=>m.material),materials);assert.deepEqual(f.meshes.map(m=>m.count),counts);
  for(const [o,visible,culled]of objectState){assert.equal(o.visible,visible);assert.equal(o.frustumCulled,culled);}
  assert.deepEqual([r.cores.boundingSphere,r.cores.boundingBox,r.cores.geometry.boundingSphere,r.cores.geometry.boundingBox],bounds);
  assert.equal(snapshot(r.w),worldBefore,'failed runtime preparation never writes game state');
 }
});
