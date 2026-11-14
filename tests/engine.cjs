// Run with: node tests/engine.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
function load(code) {
  const context=vm.createContext({performance,self:{}});
  vm.runInContext(code+`;globalThis.api={moves,generateCaptures,run(b,p,d){
    deadline=Infinity;nodes=0;aborted=false;tt.clear();killers=[];historyHeur={};
    const ms=moves(b,p);let best=null,score=-INF,alpha=-INF;
    for(const m of ms){const v=-search(m.board,-p,d-1,-INF,-alpha,1);
      if(v>score){score=v;best=m;}if(v>alpha)alpha=v;}
    return {score,from:best?.from,path:best?.path,nodes};
  }};`,context);
  return context.api;
}
const baseline=load(execFileSync('git',['show','95a7f5b511a1972e50e6e03007663bb46915b38a:engine-worker.js'],{encoding:'utf8'}));
const optimized=load(fs.readFileSync('engine-worker.js','utf8'));
const plain=x=>JSON.parse(JSON.stringify(x));
const normalize=ms=>plain(ms.map(({from,to,path,captures,board})=>({from,to,path,captures,board})));
let seed=123456;
const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
const start=()=>Array.from({length:64},(_,i)=>((i>>3)+(i&7))%2?(i<24?-1:i>=40?1:0):0);
const positions=[];
for(let game=0;game<12;game++) {
  let b=start(),p=1;
  for(let ply=0;ply<65;ply++) {
    const snapshot=b.slice(),a=baseline.moves(b,p),z=optimized.moves(b,p);
    assert.deepEqual(normalize(z),normalize(a));assert.deepEqual(b,snapshot);
    if(ply%13===0)positions.push({b:b.slice(),p});
    if(!a.length)break;
    b=Array.from(a[random(a.length)].board);p=-p;
  }
}
// Include king-heavy, promotion and unusual capture trees.
for(let n=0;n<600;n++) {
  const b=Array(64).fill(0);
  for(let k=0;k<12;k++){const r=random(8),c=2*random(4)+((r+1)%2);b[r*8+c]=[-2,-1,1,2][random(4)];}
  for(const p of [1,-1])assert.deepEqual(normalize(optimized.moves(b,p)),normalize(baseline.moves(b,p)));
}
const sample=positions.filter(({b,p})=>baseline.moves(b,p).length>1).slice(0,20);
function bench(engine){const t=performance.now();const results=sample.map(({b,p})=>plain(engine.run(b,p,5)));return {ms:performance.now()-t,results};}
bench(baseline);bench(optimized);
const timings=[];
for(let round=0;round<3;round++){
  const a=round%2?null:bench(baseline),z=bench(optimized),old=a||bench(baseline);
  assert.deepEqual(z.results,old.results);
  timings.push({baseline:Math.round(old.ms),optimized:Math.round(z.ms),speedup:+(old.ms/z.ms).toFixed(2)});
}
console.log(JSON.stringify({positions:positions.length,randomBoards:600,searchPositions:sample.length,depth:5,timings},null,2));
