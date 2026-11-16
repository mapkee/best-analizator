// Short forced-win benchmark. Oracle enumerates every line, without the
// engine's evaluator, alpha-beta, transposition table or quiescence search.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const context=vm.createContext({performance,self:{}});
vm.runInContext(fs.readFileSync('engine-worker.js','utf8')+`;globalThis.engine={moves,run(b,p,d){deadline=Infinity;nodes=0;aborted=false;tt.clear();killers=[];historyHeur={};const ms=moves(b,p);let best=null,score=-INF,alpha=-INF;for(const m of ms){const v=-search(m.board,-p,d-1,-INF,-alpha,1);if(v>score){score=v;best=m;}alpha=Math.max(alpha,v);}return {best,score,nodes};}}`,context);
const engine=context.engine;
const key=m=>m.from+':'+m.path.join(',');
let oracleNodes=0;
function solve(b,p,depth,ply){
  if(++oracleNodes>150000)throw Error('oracle budget');
  const ms=engine.moves(b,p);
  if(!ms.length)return -1000+ply;
  if(!depth)return 0; // Unknown, not a static evaluation.
  let best=-Infinity;
  for(const m of ms)best=Math.max(best,-solve(m.board,-p,depth-1,ply+1));
  return best;
}
function oracle(b,p,depth){oracleNodes=0;return engine.moves(b,p).map(m=>({key:key(m),value:-solve(m.board,-p,depth-1,1)}));}
const fixturePath='tests/tactics.json';
if(process.argv.includes('--generate')){
  let seed=89641;const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>8)%n;};
  const cases=[];
  for(let attempt=0;attempt<1500&&cases.length<12;attempt++){
    const board=Array(64).fill(0),squares=Array.from({length:32},(_,i)=>Math.floor(i/4)*8+(i%4)*2+((Math.floor(i/4)+1)%2));
    for(const p of [1,1,-1,-1]){const at=squares.splice(rnd(squares.length),1)[0];board[at]=(at<8&&p===1)||(at>=56&&p===-1)?p*2:p;}
    if(engine.moves(board,1).length<2)continue;
    let lines;try{lines=oracle(board,1,5)}catch{continue;}
    const wins=lines.filter(line=>line.value>900);
    if(!wins.length||wins.length===lines.length)continue;
    cases.push({id:'forced-win-'+String(cases.length+1).padStart(2,'0'),player:1,depth:5,board,winningMoves:wins.map(line=>line.key)});
  }
  assert.equal(cases.length,12,'Could not generate enough proven positions');
  cases.push(...cases.map(test=>({id:test.id+'-black',player:-1,depth:test.depth,board:test.board.slice().reverse().map(p=>-p),winningMoves:test.winningMoves.map(move=>{const [from,path]=move.split(':');return (63-Number(from))+':'+path.split(',').map(to=>63-Number(to)).join(',');})})));
  fs.writeFileSync(fixturePath,JSON.stringify(cases,null,2)+'\n');
}
const fixtures=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
let passed=0;const results=[];const started=performance.now();
for(const test of fixtures){
  const proven=Array.from(oracle(test.board,test.player,test.depth).filter(line=>line.value>900),line=>line.key);
  assert.deepEqual(proven.slice().sort(),test.winningMoves.slice().sort(),'Fixture proof changed: '+test.id);
  const result=engine.run(test.board,test.player,test.depth),chosen=key(result.best),ok=proven.includes(chosen);
  if(ok)passed++;
  results.push({id:test.id,passed:ok,chosen,winningMoves:proven,nodes:result.nodes});
}
console.log(JSON.stringify({passed,total:fixtures.length,accuracy:passed+'/'+fixtures.length,depth:5,elapsedMs:Math.round(performance.now()-started),scope:'Synthetic four-piece forced wins; not an Elo or full playing-strength estimate.',results},null,2));
if(passed!==fixtures.length)process.exitCode=1;
