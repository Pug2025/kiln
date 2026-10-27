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
const { PAL, glassMaterial } = await import('../src/render/materials.js');
const context = { fillRect(){}, beginPath(){},moveTo(){},lineTo(){},arc(){},quadraticCurveTo(){},bezierCurveTo(){},stroke(){},drawImage(){},
  getImageData(x,y,w,h){return {data:new Uint8ClampedArray(w*h*4).fill(255)};} };
globalThis.document = {createElement(){return {getContext(){return context;}};}};
const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
function pose(mesh, i) { mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);return {position:position.toArray(),scale:scale.toArray()}; }
function setup(mode='bottom') {
  const {world:w}=physicsWorld({mode});
  const scene=new THREE.Scene();
  const M={titanium:new THREE.MeshStandardMaterial({color:0xaaaeb4,metalness:.9,roughness:.25}),paddleGlass:glassMaterial(),darkMetalP:new THREE.MeshPhysicalMaterial(),core:new THREE.MeshStandardMaterial(),matteFree:new THREE.MeshStandardMaterial(),wallGlassI:glassMaterial(),tex:{glow:new THREE.Texture()}};
  const original={color:M.titanium.color.toArray(),emissive:M.titanium.emissive.toArray(),env:M.titanium.envMapIntensity};
  const actors=createActors(scene,M);actors.setWorld(w);
  const draw=(t=2,dt=1/60,alpha=.5,flare=0)=>actors.frame(w,alpha,t,{st:{flare}},dt);
  const find=name=>scene.getObjectByName(name);
  return {w,scene,M,original,actors,draw,find,cores:find('ball-cores'),outlines:find('ball-outlines')};
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
 for(const mode of ['bottom','left','ring'])for(const width of[PADDLE.W_SHRINK,PADDLE.W,PADDLE.W_WIDE]){
  const r=setup(mode);liveBalls(r.w);r.w.paddle.w=width;r.w.level.rules.ghosts=true;r.w.effects.catchOn=true;r.w.effects.laserShots=2;
  const before=snapshot(r.w);r.draw();assert.equal(snapshot(r.w),before);
  assert.equal(r.find(mode==='ring'?'paddle-arc-catch-line':'paddle-catch-line').visible,true);
  const mounts=r.find('laser-emitters');assert.ok(mounts.children.every(c=>c.visible));
  r.w.effects.catchOn=false;r.w.effects.laserShots=0;r.w.level.rules.ghosts=false;r.draw();
  assert.equal(r.find(mode==='ring'?'paddle-arc-catch-line':'paddle-catch-line').visible,false);assert.ok(mounts.children.every(c=>!c.visible));
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

test('production renderer warm-up prepares one linear variant and reflects drops without drawing',()=>{
 const r=setup(),f=dropWarmFixture(r),trace=[],target={name:'linear-target'},caller={name:'caller-target'},camera={},programs=[];
 let current=caller;
 const gl={...f.gl,initTexture(){},getRenderTarget(){return current;},
  setRenderTarget(value){current=value;trace.push(value===target?'target-linear':value===caller?'target-caller':'target-canvas');},
  compile(scene,cam){assert.equal(scene,r.scene);assert.equal(cam,camera);assert.equal(current,target);trace.push('compile-linear');
   scene.traverseVisible(o=>assert.ok(o!==r.actors.ballLight,'revealing hidden meshes must not compile the disabled lamp'));
   for(const [i,m]of f.materials.entries()){const p=f.program(`linear${i}`);programs.push(p);const props=gl.properties.get(m);if(!props.programs)props.programs=new Map();props.programs.set('linear',p);}
  }};
 const actors={warmTextures(){trace.push('textures');},warmPrograms(renderer){trace.push('reflect');assert.equal(programs.length,4);r.actors.warmPrograms(renderer);}};
 const source=readFileSync(new URL('../src/render/renderer.js',import.meta.url),'utf8');
 const begin=source.indexOf('  function withWarmScene(operation) {'),end=source.indexOf('  // ---- per-frame helpers',begin);
 assert.ok(begin>=0&&end>begin);
 const warm=new Function('unifyStandardMaterials','scene','M','gl','actors','camera','post','disposed','glWatch',`${source.slice(begin,end)};return warmUp;`)(()=>{},r.scene,r.M,gl,actors,camera,{composer:{renderTarget1:target},warmUp(){trace.push('post-warm');assert.equal(current,target);}},false,{lost:false});
 r.outlines.visible=false;const counts=f.meshes.map(m=>m.count);warm();
 assert.deepEqual(trace,['textures','target-linear','compile-linear','reflect','post-warm','target-caller']);
 assert.ok(programs.every(p=>p.initializations===1));assert.equal(r.outlines.visible,false,'hidden meshes restore after preparation');
 assert.deepEqual(f.meshes.map(m=>m.count),counts);assert.equal(current,caller);
 // Compilation failures still restore caller state and hidden pools. The existing boot guard
 // owns actual readiness; preparing a shader never draws or marks a successful frame.
 const failure=new Error('compile failed'),previousWarn=console.warn,warnings=[];
 gl.compile=()=>{throw failure;};console.warn=(...args)=>warnings.push(args);
 const reflected=f.calls.length;
 try{warm();}finally{console.warn=previousWarn;}
 assert.equal(warnings.length,1);assert.equal(warnings[0][1],failure);
 assert.equal(current,caller);assert.equal(r.outlines.visible,false);
 assert.deepEqual(f.meshes.map(m=>m.count),counts);assert.equal(f.calls.length,reflected);
});
