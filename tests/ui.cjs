const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
class Element {
  constructor(){this.children=[];this.attributes={};this.classList={add(){},toggle(){}};this.style={setProperty(k,v){this[k]=v;}};}
  set innerHTML(value){this.children=[];}
  appendChild(el){this.children.push(el);return el;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  addEventListener(){}
}
const elements=new Map(),workers=[];
class Worker {
  constructor(){workers.push(this);}
  postMessage(message){this.message=message;}
  terminate(){this.terminated=true;}
}
const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},createElementNS(){return new Element();}};
const html=fs.readFileSync('index.html','utf8');
assert.ok(!html.includes('ANALYZATOR PRO'));
assert.ok(!/[⚪⚫✦↶⟳]/u.test(html));
assert.match(html,/<marker[^>]*id="ah"[^>]*>[\s\S]*?fill="#9cb9df"/);
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const context=vm.createContext({document,window:{},Worker,setTimeout(){}});
vm.runInContext(script,context);
const run=code=>vm.runInContext(code,context);
run('analyze()');
const worker=workers.at(-1),id=worker.message.requestId;
assert.equal(worker.message.budgetMs,1000);
worker.onmessage({data:{requestId:id,partial:true,move:{from:40,to:33,path:[33],captures:[],depth:1,nodes:20}}});
assert.equal(run('thinking'),true);
assert.equal(run('hint'),null);
assert.equal(elements.get('arrows').children.length,0);
worker.onmessage({data:{requestId:id,partial:true,move:{from:42,to:35,path:[35],captures:[],depth:2,nodes:40}}});
assert.equal(run('hint'),null);
assert.equal(elements.get('arrows').children.length,0);
worker.onmessage({data:{requestId:id,partial:false,move:{from:40,to:33,path:[33],captures:[],depth:9,nodes:80}}});
assert.equal(run('thinking'),false);
const hintCard=elements.get('status');
assert.equal(hintCard.children[0].textContent,'Ход найден');
const hintRoute=hintCard.children.find(el=>el.className==='hint-route');
assert.deepEqual(hintRoute.children.filter(el=>el.className==='route-square').map(el=>el.textContent),['a3','b4']);
assert.equal(elements.get('arrows').children.filter(el=>el.attributes['marker-end']).length,1);
run('clickCell(40);clickCell(33)');
assert.equal(run('turn'),-1);
assert.equal(worker.terminated,undefined);
const oldBoard=run('JSON.stringify(board)');
worker.onmessage({data:{requestId:id,partial:false,move:{from:40,to:33,path:[33],captures:[],depth:9}}});
assert.equal(run('JSON.stringify(board)'),oldBoard);
assert.equal(run('hint'),null);
// A capture is entered at every landing; turn changes only after the full path.
function position(pieces){
  const b=Array(64).fill(0);for(const [i,p] of pieces)b[i]=p;
  run(`cancelAnalysis();closeResult();gameOver=null;board=${JSON.stringify(b)};turn=1;myColor=1;selected=null;hint=null;pendingCapture=null;history=[];render()`);
  return b;
}
const captureBoard=position([[42,1],[35,-1],[21,-1],[19,-1]]);
run('clickCell(42);clickCell(28)');
assert.equal(run('turn'),1);
assert.equal(run('board[28]'),1);
assert.equal(run('board[35]'),0);
assert.deepEqual(Array.from(run('nextDestinations()')).sort((a,b)=>a-b),[10,14]);
const inProgress=run('JSON.stringify(board)');
run('clickCell(63);setColor(-1);setAnalysisMode(4500);analyze()');
assert.equal(run('JSON.stringify(board)'),inProgress);
assert.equal(run('myColor'),1);
run('clickCell(14)');
assert.equal(run('turn'),-1);
assert.equal(run('board[14]'),1);
assert.equal(run('pendingCapture'),null);
assert.equal(run('history.length'),1);
run('$("undoBtn").onclick()');
assert.equal(run('JSON.stringify(board)'),JSON.stringify(captureBoard));
assert.equal(run('turn'),1);
run('clickCell(42);clickCell(28);$("undoBtn").onclick()');
assert.equal(run('pendingCapture'),null);
assert.equal(run('JSON.stringify(board)'),JSON.stringify(captureBoard));
// Promotion during a combination continues with king landings from the full move.
position([[19,1],[10,-1],[28,-1]]);
const promotedMove=JSON.parse(run('JSON.stringify(moves(board,turn).find(m=>m.path[0]===1&&m.path[1]===37))'));
run('clickCell(19);clickCell(1)');
assert.equal(run('board[1]'),2);
assert.equal(run('turn'),1);
run('clickCell(37)');
assert.equal(run('JSON.stringify(board)'),JSON.stringify(promotedMove.board));
assert.equal(run('turn'),-1);
// Complete many generated combinations step by step and compare final boards.
let captureSeed=789;
const randomInt=n=>{captureSeed=(Math.imul(captureSeed,1664525)+1013904223)>>>0;return (captureSeed>>>8)%n;};
let combinations=0;
for(let trial=0;trial<100;trial++){
  const pieces=[];
  for(let k=0;k<12;k++){const r=randomInt(8),c=2*randomInt(4)+((r+1)%2);pieces.push([r*8+c,[-2,-1,1,2][randomInt(4)]])}
  position(pieces);
  const candidate=JSON.parse(run('JSON.stringify(moves(board,turn).find(m=>m.captures.length>1)||null)'));
  if(!candidate)continue;
  run(`clickCell(${candidate.from})`);
  for(let step=0;step<candidate.path.length;step++){
    run(`clickCell(${candidate.path[step]})`);
    assert.equal(run('turn'),step===candidate.path.length-1?-1:1);
  }
  assert.equal(run('JSON.stringify(board)'),JSON.stringify(candidate.board));combinations++;
}
assert.ok(combinations>0);
position([[42,1],[35,-1],[21,-1]]);
run('clickCell(42);clickCell(28);$("newBtn").onclick()');
assert.equal(run('pendingCapture'),null);
assert.equal(run('JSON.stringify(board)'),run('JSON.stringify(startBoard())'));
run('drawArrow()');
for(const color of [1,-1]){
  run(`myColor=${color};hint={from:40,path:[26,12],captures:[33,19]};drawArrow()`);
  for(const el of elements.get('arrows').children)for(const value of Object.values(el.attributes))assert.ok(!value.includes('NaN'));
}
run('turn=1;myColor=1;setAnalysisMode(4500)');
const deepWorker=workers.at(-1);
assert.equal(deepWorker.message.budgetMs,4500);
assert.equal(elements.get('deepMode').attributes['aria-pressed'],'true');
run('setAnalysisMode(1000)');
assert.equal(deepWorker.terminated,true);
assert.equal(workers.at(-1).message.budgetMs,1000);
assert.equal(elements.get('fastMode').attributes['aria-pressed'],'true');
// Test real movement hooks, including flipped boards and cancellation.
const animations=[];
Element.prototype.animate=function(frames,options){
  const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};
  animations.push(animation);return animation;
};
elements.get('board').getBoundingClientRect=()=>({width:800});
position([[40,1]]);
run('clickCell(40);clickCell(33)');
assert.equal(run('animating'),true);
assert.equal(animations.at(-1).frames[0].transform,'translate(-100px,100px)');
assert.equal(animations.at(-1).options.duration,220);
run('clickCell(33)');
assert.equal(run('selected'),null);
animations.at(-1).onfinish();
assert.equal(run('animating'),false);
position([[40,1]]);run('myColor=-1;clickCell(40);clickCell(33)');
assert.equal(animations.at(-1).frames[0].transform,'translate(100px,-100px)');
run('$("undoBtn").onclick()');
assert.equal(animations.at(-1).cancelled,true);
assert.equal(run('animating'),false);
assert.equal(run('board[40]'),1);
position([[42,1],[35,-1],[21,-1]]);
run('clickCell(42);clickCell(28)');
const duringJump=run('JSON.stringify(board)');
run('clickCell(14)');
assert.equal(run('JSON.stringify(board)'),duringJump);
animations.at(-1).onfinish();run('clickCell(14)');
assert.equal(run('turn'),-1);
assert.equal(run('animating'),true);
run('$("newBtn").onclick()');
assert.equal(run('animating'),false);
assert.equal(run('pendingCapture'),null);
const priorAnimations=animations.length;
const windowForMotion=context.window;
windowForMotion.matchMedia=()=>({matches:true});
position([[40,1]]);run('clickCell(40);clickCell(33)');
assert.equal(run('animating'),false);
assert.equal(animations.length,priorAnimations);
delete windowForMotion.matchMedia;
delete Element.prototype.animate;
// A game ends after the whole move, including positions with blocked pieces.
position([[42,1],[35,-1]]);run('clickCell(42);clickCell(28)');
assert.equal(run('gameOver'),1);
assert.equal(elements.get('resultTitle').textContent,'Победа!');
assert.equal(elements.get('fireworks').children.length,104);
assert.equal(elements.get('resultDialog').hidden,false);
run('$("undoBtn").onclick()');
assert.equal(run('gameOver'),null);
assert.equal(elements.get('fireworks').children.length,0);
assert.equal(elements.get('resultDialog').hidden,true);
position([[42,1],[56,-1]]);run('clickCell(42);clickCell(33)');
assert.equal(run('gameOver'),1);
position([[1,1]]);run('checkGameEnd()');
assert.equal(run('gameOver'),-1);
assert.equal(elements.get('resultTitle').textContent,'Победа соперника');
assert.equal(elements.get('fireworks').children.length,0);
run('$("resultNew").onclick()');
assert.equal(run('gameOver'),null);
assert.equal(run('JSON.stringify(board)'),run('JSON.stringify(startBoard())'));
// Exercise the real worker protocol: completed iterations arrive before final.
const reports=[],engine=vm.createContext({performance,self:{postMessage(data){reports.push({data,time:performance.now()});}}});
vm.runInContext(fs.readFileSync('engine-worker.js','utf8'),engine);
const board=Array.from({length:64},(_,i)=>((i>>3)+(i&7))%2?(i<24?-1:i>=40?1:0):0);
const started=performance.now();
engine.self.onmessage({data:{board,player:1,budgetMs:500,requestId:7}});
assert.ok(reports.length>1);
assert.equal(reports[0].data.partial,true);
assert.equal(reports.at(-1).data.partial,false);
assert.ok(reports[0].time<reports.at(-1).time);
assert.deepEqual(reports.at(-1).data.move.path,reports.at(-2).data.move.path);
console.log(JSON.stringify({ui:'passed',workerReports:reports.length,firstHintMs:Math.round(reports[0].time-started),finalMs:Math.round(reports.at(-1).time-started)},null,2));
