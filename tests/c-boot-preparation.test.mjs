// Actual renderer preparation transactions, with an unresolved driver-completion job.
import { test, assert } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { submitShaderPreparation } from '../src/render/shader-preparation.js';

const source = readFileSync(new URL('../src/render/renderer.js', import.meta.url), 'utf8');
const begin = source.indexOf('  function withWarmScene(operation) {');
const end = source.indexOf('  // ---- per-frame helpers', begin);
assert.ok(begin >= 0 && end > begin);
const factory = new Function('env', `with (env) {
  let disposed=false, contextEpoch=0, bootJob=null;
  ${source.slice(begin, end)}
  return { prepareBoot, warmUp,
    lose() { contextEpoch++; glWatch.lost=true; bootJob?.cancel('context-lost'); },
    dispose() { disposed=true; bootJob?.cancel('disposed'); }
  };
}`);

function fixture({ khr=true, link=true, compileError=false, renderError=false, lateLinkFailure=false }={}) {
  const trace=[], hidden={visible:false,frustumCulled:true,count:0,boundingSphere:null,boundingBox:null}, visible={visible:true,frustumCulled:false,count:7}, target={}, caller={};
  let current=caller, pending=null, now=0, ready=false;
  let viewport=[2,3,400,300], scissor=[4,5,200,100], scissorTest=false;
  class Vector4 { data=[]; }
  const scheduler={now:()=>now, setTimeout(fn) { assert.equal(pending,null); pending=fn; return 1; }, clearTimeout() { pending=null; }};
  const program={program:{}, getUniforms() { trace.push('uniforms'); }, getAttributes() { trace.push('attributes'); }};
  const material={id:1,version:0}, lateProgram={program:{}};
  const native={ LINK_STATUS:0x8b82, isContextLost:()=>false,
    getExtension:()=>khr?{COMPLETION_STATUS_KHR:0x91b1}:null,
    getProgramParameter(handle,pname) { if(handle===lateProgram.program){trace.push('late-link');return false;} assert.equal(handle,program.program); trace.push(pname===0x91b1?'completion':'link'); return pname===0x91b1?ready:link; },
    getProgramInfoLog:()=> 'injected link failure' };
  const scene={ traverse(fn) { fn(hidden); fn(visible); } }, camera={};
  const gl={ info:{programs:[program]}, autoClear:false,
    getViewport(v){v.data=[...viewport];return v;}, getScissor(v){v.data=[...scissor];return v;}, getScissorTest:()=>scissorTest,
    setViewport(...values){viewport=values.length===1?[...values[0].data]:values;},
    setScissor(...values){scissor=values.length===1?[...values[0].data]:values;},setScissorTest(v){scissorTest=v;},
    render(s,c){ assert.equal(s,scene);assert.equal(c,camera);assert.equal(current,target);
      assert.equal(hidden.visible,true);assert.equal(hidden.frustumCulled,false);assert.equal(visible.frustumCulled,false);
      assert.deepEqual([hidden.count,visible.count],[0,7]);assert.deepEqual(viewport,[0,0,1,1]);assert.deepEqual(scissor,[0,0,1,1]);assert.equal(scissorTest,true);
      hidden.boundingSphere={empty:true};hidden.boundingBox={empty:true};
      trace.push('preflight');if(lateLinkFailure)gl.info.programs.push(lateProgram);if(renderError)throw Error('injected preflight failure');
    }, getRenderTarget:()=>current, setRenderTarget(value) { current=value; }, initTexture() {},
    getContext:()=>native, properties:{ get:()=>({programs:new Map([['variant',program]]),currentProgram:program}) },
    compile(s,c) { assert.equal(s,scene); assert.equal(c,camera); assert.equal(current,target); assert.equal(hidden.visible,true); trace.push('compile'); if(compileError)throw Error('injected compile failure'); return new Set([material]); } };
  const post={composer:{renderTarget1:target},warmUp() { assert.equal(current,target); trace.push('post'); }};
  const stats={preparation:{}};
  const api=factory({THREE:{Vector4},scene,camera,gl,post,stats,glWatch:{lost:false},M:{tex:{}},
    actors:{warmTextures(){trace.push('textures');},warmPrograms(){trace.push('actors');}},
    unifyStandardMaterials(){},performance:{now:()=>now},
    submitShaderPreparation:(g,s,c,o)=>submitShaderPreparation(g,s,c,{...o,scheduler}),
  });
  return {api,trace,stats,hidden,visible,
    restored(){assert.equal(current,caller);assert.equal(hidden.visible,false);assert.equal(visible.visible,true);assert.equal(hidden.frustumCulled,true);assert.equal(visible.frustumCulled,false);
      assert.deepEqual([hidden.count,visible.count],[0,7]);assert.deepEqual(viewport,[2,3,400,300]);assert.deepEqual(scissor,[4,5,200,100]);assert.equal(scissorTest,false);assert.equal(gl.autoClear,false);assert.equal(hidden.boundingSphere,null);assert.equal(hidden.boundingBox,null);},
    complete(){ready=true;const fn=pending;pending=null;now+=10;fn();},
    poll(){const fn=pending;pending=null;now+=10;fn();},
    get pending(){return pending;},
  };
}

test('boot restores visibility and linear target before awaiting completion, then reflects all programs and prepares post',async()=>{
  const f=fixture(), done=f.api.prepareBoot();
  f.restored();assert.deepEqual(f.trace,['textures','compile']);
  f.poll();f.restored();assert.deepEqual(f.trace,['textures','compile','completion']);
  f.complete();await done;f.restored();
  assert.deepEqual(f.trace,['textures','compile','completion','completion','textures','link','uniforms','attributes','actors','post','preflight','link']);
  assert.equal(f.stats.preparation.capability,'parallel');assert.equal(f.stats.preparation.programs,1);
  assert.equal(f.pending,null);
});

test('no-KHR boot yields and reports synchronous fallback without claiming a game draw',async()=>{
  const f=fixture({khr:false}),done=f.api.prepareBoot();f.restored();
  assert.deepEqual(f.trace,['textures','compile']);f.complete();await done;
  assert.equal(f.stats.preparation.capability,'synchronous-fallback');
  assert.equal(f.trace.includes('completion'),false);assert.ok(f.trace.includes('post'));assert.ok(f.trace.includes('preflight'));f.restored();
});

test('loss or disposal while boot waits clears polling and cannot reflect stale programs or warm post',async()=>{
  for(const action of ['lose','dispose']){
    const f=fixture(),done=f.api.prepareBoot();f.api[action]();
    await assert.rejects(done,{name:'AbortError'});f.restored();
    assert.equal(f.pending,null);assert.deepEqual(f.trace,['textures','compile']);
  }
});

test('boot submission and real link failures reject to startup recovery and restore transaction state',async()=>{
  const compile=fixture({compileError:true});await assert.rejects(compile.api.prepareBoot(),/compile failure/);compile.restored();
  assert.equal(compile.pending,null);
  const link=fixture({link:false}),done=link.api.prepareBoot();link.complete();await assert.rejects(done,/link failed/);link.restored();
  assert.equal(link.trace.includes('actors'),false);assert.equal(link.trace.includes('post'),false);
});


test('first-use preflight failure restores culling, zero pool counts and caller graphics state before rejecting',async()=>{
  const f=fixture({renderError:true}),done=f.api.prepareBoot();f.complete();
  await assert.rejects(done,/preflight failure/);f.restored();assert.equal(f.pending,null);
});


test('a newly acquired first-use program link failure rejects before startup can return a renderer',async()=>{
  const f=fixture({lateLinkFailure:true}),done=f.api.prepareBoot();f.complete();
  await assert.rejects(done,/First-use shader link failed/);f.restored();
  assert.equal(f.trace.at(-1),'late-link');assert.equal(f.pending,null);
});
