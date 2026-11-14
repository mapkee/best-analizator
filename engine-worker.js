"use strict";
/*
 * Draughts Search Worker — Russian draughts 8x8.
 * Board encoding: 1 white man, 2 white king, -1 black man, -2 black king.
 * Search: iterative deepening, negamax alpha-beta, TT, move ordering,
 * killer/history heuristics, capture quiescence, aspiration windows.
 */
const DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const INF = 32000, MATE = 30000;
let deadline=0, nodes=0, aborted=false, tt=new Map(), killers=[], historyHeur={};

const inside=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
const idx=(r,c)=>r*8+c;
const rc=i=>[i>>3,i&7];
const side=p=>Math.sign(p);
const king=p=>Math.abs(p)===2;
const coord=i=>{const [r,c]=rc(i);return "abcdefgh"[c]+(8-r);};
const keyBoard=(b,p)=>p+":"+b.join(",");

function generateCaptures(b, player) {
  const result=[];
  for(let from=0;from<64;from++) {
    const piece=b[from];
    if(side(piece)!==player) continue;
    const path=[], victims=[], cur=b.slice();
    function dfs(pos, movingPiece) {
      const [r,c]=rc(pos); let extended=false;
      for(const [dr,dc] of DIRS) {
        if(!king(movingPiece)) {
          const mr=r+dr, mc=c+dc, lr=r+2*dr, lc=c+2*dc;
          if(!inside(mr,mc)||!inside(lr,lc)) continue;
          const victim=idx(mr,mc), land=idx(lr,lc);
          if(side(cur[victim])!==-player || cur[land]!==0) continue;
          extended=true;
          const taken=cur[victim]; cur[pos]=0; cur[victim]=0;
          let np=movingPiece;
          if((player===1&&lr===0)||(player===-1&&lr===7)) np=player*2;
          cur[land]=np;
          path.push(land); victims.push(victim);
          dfs(land,np);
          cur[land]=0; cur[victim]=taken; cur[pos]=movingPiece;
          path.pop(); victims.pop();
        } else {
          let rr=r+dr, cc=c+dc;
          while(inside(rr,cc)&&cur[idx(rr,cc)]===0){rr+=dr;cc+=dc;}
          if(!inside(rr,cc)) continue;
          const victim=idx(rr,cc);
          if(side(cur[victim])!==-player) continue;
          rr+=dr;cc+=dc;
          while(inside(rr,cc)&&cur[idx(rr,cc)]===0) {
            const land=idx(rr,cc); extended=true;
            const taken=cur[victim];cur[pos]=0;cur[victim]=0;cur[land]=movingPiece;
            path.push(land);victims.push(victim);
            dfs(land,movingPiece);
            cur[land]=0;cur[victim]=taken;cur[pos]=movingPiece;
            path.pop();victims.pop();
            rr+=dr;cc+=dc;
          }
        }
      }
      if(!extended && victims.length) result.push({from,to:pos,path:path.slice(),captures:victims.slice(),board:cur.slice()});
    }
    dfs(from,piece);
  }
  return result;
}

function generateQuiet(b, player) {
  const out=[];
  for(let from=0;from<64;from++) {
    const p=b[from]; if(side(p)!==player) continue;
    const [r,c]=rc(from);
    if(king(p)) {
      for(const [dr,dc] of DIRS) {
        let rr=r+dr,cc=c+dc;
        while(inside(rr,cc)&&b[idx(rr,cc)]===0) {
          const to=idx(rr,cc), nb=b.slice();nb[from]=0;nb[to]=p;
          out.push({from,to,path:[to],captures:[],board:nb});
          rr+=dr;cc+=dc;
        }
      }
    } else {
      const dr=player===1?-1:1;
      for(const dc of [-1,1]) {
        const rr=r+dr,cc=c+dc;
        if(!inside(rr,cc)) continue;
        const to=idx(rr,cc); if(b[to]!==0) continue;
        const nb=b.slice();nb[from]=0;nb[to]=p;
        if((player===1&&rr===0)||(player===-1&&rr===7)) nb[to]=player*2;
        out.push({from,to,path:[to],captures:[],board:nb});
      }
    }
  }
  return out;
}
function moves(b,p) {
  const caps=generateCaptures(b,p);
  return caps.length?caps:generateQuiet(b,p);
}
function hasQuietMove(b,p) {
  for(let i=0;i<64;i++) {
    if(side(b[i])!==p)continue;
    const r=i>>3,c=i&7;
    for(const [dr,dc] of DIRS) {
      if(!king(b[i])&&dr!==(p===1?-1:1))continue;
      if(inside(r+dr,c+dc)&&b[idx(r+dr,c+dc)]===0)return true;
    }
  }
  return false;
}
// Preserve the evaluator's floating-point operation order while caching
// position-independent piece values and king activity terms.
const pieceValues=Array.from({length:5},()=>new Float64Array(64));
const kingActivity=new Float64Array(64);
for(let i=0;i<64;i++) {
  const r=i>>3,c=i&7;
  kingActivity[i]=0.025*(3.5-Math.abs(3.5-r)+3.5-Math.abs(3.5-c));
  for(const p of [-2,-1,1,2]) {
    const s=side(p),k=king(p);
    let v=k?3.25:1.0;
    if(!k) {
      v+=(s===1?(7-r):r)*0.035;
      if(c>=2&&c<=5)v+=0.045;
      if(r>=2&&r<=5)v+=0.025;
      if((s===1&&r===1)||(s===-1&&r===6))v+=0.12;
    } else {
      if(r>=2&&r<=5&&c>=2&&c<=5)v+=0.10;
      if(r===0||r===7||c===0||c===7)v-=0.035;
    }
    pieceValues[p+2][i]=s*v;
  }
}
function evalWhite(b) {
  let score=0, wm=0,bm=0,wk=0,bk=0;
  for(let i=0;i<64;i++) {
    const p=b[i]; if(!p)continue;
    const s=side(p), k=king(p);
    score += pieceValues[p+2][i];
    if(s===1){if(k)wk++;else wm++;} else {if(k)bk++;else bm++;}
  }
  // A small endgame king activity bonus.
  const men=wm+bm;
  if(men<=4) {
    for(let i=0;i<64;i++) if(king(b[i])) {
      score += side(b[i])*kingActivity[i];
    }
  }
  return score*100;
}
function evaluate(b,p) { return evalWhite(b)*p; }

function moveKey(m){return m.from*64+m.to;}
function orderMoves(ms, ttMove, ply) {
  const k1=killers[ply]?.[0], k2=killers[ply]?.[1];
  // Cache priorities once per move; stable sorting preserves tied move order.
  for(const m of ms) {
    let s=m.captures.length*1200;
    if(m.to!==m.from) {
      const key=moveKey(m);
      if(king(m.board[m.to]))s+=80;
      if(key===ttMove)s+=1000000;
      if(key===k1)s+=50000;
      if(key===k2)s+=30000;
      s+=historyHeur[key]||0;
    }
    m.orderScore=s;
  }
  ms.sort((a,b)=>b.orderScore-a.orderScore);
  return ms;
}
function timeCheck(){ if((nodes&1023)===0 && performance.now()>=deadline) aborted=true; }
function quiescence(b,p,alpha,beta,ply,initialCaptures) {
  nodes++; timeCheck(); if(aborted)return 0;
  const stand=evaluate(b,p);
  if(stand>=beta)return beta;
  if(stand>alpha)alpha=stand;
  if(ply>=12)return alpha;
  const caps=initialCaptures===undefined?generateCaptures(b,p):initialCaptures;
  if(!caps.length)return alpha;
  orderMoves(caps,0,ply);
  for(const m of caps) {
    const v=-quiescence(m.board,-p,-beta,-alpha,ply+1);
    if(aborted)return 0;
    if(v>=beta)return beta;
    if(v>alpha)alpha=v;
  }
  return alpha;
}
function search(b,p,depth,alpha,beta,ply) {
  nodes++;timeCheck();if(aborted)return 0;
  if(ply>60)return evaluate(b,p);
  const key=keyBoard(b,p), entry=tt.get(key), origAlpha=alpha;
  if(entry&&entry.depth>=depth&&ply>0) {
    const sc=entry.score> MATE-1000?entry.score-ply:entry.score< -MATE+1000?entry.score+ply:entry.score;
    if(entry.flag===0)return sc;
    if(entry.flag===1)alpha=Math.max(alpha,sc);
    else beta=Math.min(beta,sc);
    if(alpha>=beta)return sc;
  }
  if(depth<=0) {
    const caps=generateCaptures(b,p);
    if(!caps.length&&!hasQuietMove(b,p))return -MATE+ply;
    return quiescence(b,p,alpha,beta,0,caps);
  }
  let ms=moves(b,p);
  if(!ms.length)return -MATE+ply;
  const ttMove=entry?entry.best:0;orderMoves(ms,ttMove,ply);
  let best=-INF,bestMove=0;
  for(const m of ms) {
    const v=-search(m.board,-p,depth-1,-beta,-alpha,ply+1);
    if(aborted)return 0;
    if(v>best){best=v;bestMove=moveKey(m);}
    if(v>alpha)alpha=v;
    if(alpha>=beta) {
      if(!m.captures.length) {
        if(!killers[ply])killers[ply]=[];
        if(killers[ply][0]!==moveKey(m)){killers[ply][1]=killers[ply][0];killers[ply][0]=moveKey(m);}
        historyHeur[moveKey(m)]=(historyHeur[moveKey(m)]||0)+depth*depth;
      }
      break;
    }
  }
  const flag=best<=origAlpha?2:best>=beta?1:0;
  const stored=best> MATE-1000?best+ply:best< -MATE+1000?best-ply:best;
  if(tt.size>180000)tt.clear();
  tt.set(key,{depth,score:stored,flag,best:bestMove});
  return best;
}
function choose(b,p,ms,budget,onProgress) {
  if(!ms.length)return null;
  if(ms.length===1)return {...ms[0],depth:0,nodes:0,score:0};
  deadline=performance.now()+budget;nodes=0;aborted=false;
  tt.clear();killers=[];historyHeur={};
  let best=ms[0], completed=0, bestScore=0;
  for(let depth=1;depth<=24;depth++) {
    let a=-INF, beta=INF, localBest=best, localScore=-INF;
    orderMoves(ms,moveKey(best),0);
    for(const m of ms) {
      const value=-search(m.board,-p,depth-1,-beta,-a,1);
      if(aborted)break;
      if(value>localScore){localScore=value;localBest=m;}
      if(value>a)a=value;
    }
    if(aborted)break;
    best=localBest;bestScore=localScore;completed=depth;
    if(onProgress)onProgress({...best,depth:completed,nodes,score:bestScore,elapsed:Math.round(performance.now()-(deadline-budget))});
    if(Math.abs(bestScore)>MATE-100)break;
  }
  return {...best,depth:completed,nodes,score:bestScore,elapsed:Math.round(performance.now()-(deadline-budget))};
}
self.onmessage=(e)=>{
  const {board,player,budgetMs=4500,requestId}=e.data||{};
  try {
    if(!Array.isArray(board)||board.length!==64)throw new Error("Некорректная доска");
    const ms=moves(board,player);
    const report=(result,partial)=>self.postMessage({requestId,partial,move:{from:result.from,to:result.to,path:result.path,captures:result.captures,depth:result.depth,nodes:result.nodes,score:result.score,elapsed:result.elapsed}});
    const result=choose(board,player,ms,Math.max(500,Math.min(10000,budgetMs)),result=>report(result,true));
    if(!result){self.postMessage({requestId,move:null});return;}
    report(result,false);
  } catch(err) { self.postMessage({requestId,error:String(err&&err.message||err)}); }
};
