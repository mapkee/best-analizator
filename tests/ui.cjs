const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
class Element {
  constructor(){this.children=[];this.attributes={};this.classList={add(){},toggle(){}};}
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
const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const context=vm.createContext({document,window:{},Worker,setTimeout(){}});
vm.runInContext(script,context);
const run=code=>vm.runInContext(code,context);
run('analyze()');
const worker=workers.at(-1),id=worker.message.requestId;
worker.onmessage({data:{requestId:id,partial:true,move:{from:40,to:33,path:[33],captures:[],depth:1,nodes:20}}});
assert.equal(run('thinking'),true);
assert.match(elements.get('status').textContent,/уточняю/);
assert.equal(elements.get('arrows').children.filter(el=>el.attributes['marker-end']).length,1);
run('clickCell(40);clickCell(33)');
assert.equal(run('turn'),-1);
assert.equal(worker.terminated,true);
const oldBoard=run('JSON.stringify(board)');
worker.onmessage({data:{requestId:id,partial:false,move:{from:40,to:33,path:[33],captures:[],depth:9}}});
assert.equal(run('JSON.stringify(board)'),oldBoard);
assert.equal(run('hint'),null);
run('drawArrow()');
for(const color of [1,-1]){
  run(`myColor=${color};hint={from:40,path:[26,12],captures:[33,19]};drawArrow()`);
  for(const el of elements.get('arrows').children)for(const value of Object.values(el.attributes))assert.ok(!value.includes('NaN'));
}
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
