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
    const path=[], victims=[];
    function dfs(pos, cur, movingPiece, capturedMask) {
      const [r,c]=rc(pos); let extended=false;
      for(const [dr,dc] of DIRS) {
        if(!king(movingPiece)) {
          const mr=r+dr, mc=c+dc, lr=r+2*dr, lc=c+2*dc;
          if(!inside(mr,mc)||!inside(lr,lc)) continue;
          const victim=idx(mr,mc), land=idx(lr,lc);
          if(side(cur[victim])!==-player || (capturedMask.has(victim)) || cur[land]!==0) continue;
          extended=true;
          const nb=cur.slice(); nb[pos]=0; nb[victim]=0;
          let np=movingPiece;
          if((player===1&&lr===0)||(player===-1&&lr===7)) np=player*2;
          nb[land]=np;
          const nm=new Set(capturedMask); nm.add(victim);
          path.push(land); victims.push(victim);
          dfs(land,nb,np,nm);
          path.pop(); victims.pop();
        } else {
          let rr=r+dr, cc=c+dc;
          while(inside(rr,cc)&&cur[idx(rr,cc)]===0){rr+=dr;cc+=dc;}
          if(!inside(rr,cc)) continue;
          const victim=idx(rr,cc);
          if(side(cur[victim])!==-player || capturedMask.has(victim)) continue;
          rr+=dr;cc+=dc;
          while(inside(rr,cc)&&cur[idx(rr,cc)]===0) {
            const land=idx(rr,cc); extended=true;
            const nb=cur.slice();nb[pos]=0;nb[victim]=0;nb[land]=movingPiece;
            const nm=new Set(capturedMask);nm.add(victim);
            path.push(land);victims.push(victim);
            dfs(land,nb,movingPiece,nm);
            path.pop();victims.pop();
            rr+=dr;cc+=dc;
          }
        }
      }
      if(!extended && victims.length) result.push({from,to:pos,path:path.slice(),captures:victims.slice(),board:cur});
    }
    dfs(from,b.slice(),piece,new Set());
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
function evalWhite(b) {
  let score=0, wm=0,bm=0,wk=0,bk=0;
  for(let i=0;i<64;i++) {
    const p=b[i]; if(!p)continue;
    const [r,c]=rc(i), s=side(p), k=king(p);
    let v=k?3.25:1.0;
    if(!k) {
      v += (s===1?(7-r):r)*0.035;
      if(c>=2&&c<=5)v+=0.045;
      if(r>=2&&r<=5)v+=0.025;
      if((s===1&&r===1)||(s===-1&&r===6))v+=0.12;
    } else {
      if(r>=2&&r<=5&&c>=2&&c<=5)v+=0.10;
      const edge=(r===0||r===7||c===0||c===7);
      if(edge)v-=0.035;
    }
    score += s*v;
    if(s===1){if(k)wk++;else wm++;} else {if(k)bk++;else bm++;}
  }
  // A small endgame king activity bonus.
  const men=wm+bm;
  if(men<=4) {
    for(let i=0;i<64;i++) if(king(b[i])) {
      const [r,c]=rc(i); score += side(b[i])*(0.025*(3.5-Math.abs(3.5-r)+3.5-Math.abs(3.5-c)));
    }
  }
  return score*100;
}
function evaluate(b,p) { return evalWhite(b)*p; }

function moveKey(m){return m.from*64+m.to;}
function orderMoves(ms, ttMove, ply) {
  const k1=killers[ply]?.[0], k2=killers[ply]?.[1];
  ms.sort((a,b)=>{
    function score(m) {
      let s=m.captures.length*1200;
      if(m.to===m.from) return s;
      const target=m.board[m.to];
      if(king(target))s+=80;
      if(moveKey(m)===ttMove)s+=1000000;
      if(moveKey(m)===k1)s+=50000;
      if(moveKey(m)===k2)s+=30000;
      s+=historyHeur[moveKey(m)]||0;
      return s;
    }
    return score(b)-score(a);
  });
  return ms;
}
function timeCheck(){ if((nodes&1023)===0 && performance.now()>=deadline) aborted=true; }
function quiescence(b,p,alpha,beta,ply) {
  nodes++; timeCheck(); if(aborted)return 0;
  const stand=evaluate(b,p);
  if(stand>=beta)return beta;
  if(stand>alpha)alpha=stand;
  if(ply>=12)return alpha;
  const caps=generateCaptures(b,p);
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
  let ms=moves(b,p);
  if(!ms.length)return -MATE+ply;
  if(depth<=0)return quiescence(b,p,alpha,beta,0);
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
function choose(b,p,ms,budget) {
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
    if(Math.abs(bestScore)>MATE-100)break;
  }
  return {...best,depth:completed,nodes,score:bestScore,elapsed:Math.round(performance.now()-(deadline-budget))};
}
self.onmessage=(e)=>{
  const {board,player,budgetMs=4500,requestId}=e.data||{};
  try {
    if(!Array.isArray(board)||board.length!==64)throw new Error("Некорректная доска");
    const ms=moves(board,player);
    const result=choose(board,player,ms,Math.max(500,Math.min(10000,budgetMs)));
    if(!result){self.postMessage({requestId,move:null});return;}
    self.postMessage({requestId,move:{from:result.from,to:result.to,path:result.path,captures:result.captures,depth:result.depth,nodes:result.nodes,score:result.score,elapsed:result.elapsed}});
  } catch(err) { self.postMessage({requestId,error:String(err&&err.message||err)}); }
};
