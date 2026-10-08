import {nextHakem,dealPackages} from './table-rules.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from './server.mjs';
test('four independent sessions, confirmations, server authority, hand privacy, reconnection and tricks',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function call(path,data,token){const r=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()};}
 try{const host=(await call('create',{name:'سازنده'})).body;const members=[host];for(const i of [1,2,3])members.push((await call('join',{name:'بازیکن '+i,code:host.code,seat:i})).body);
 const get=async(i)=>(await call('state',null,members[i].token)).body;
 let s=await get(0);assert.equal((await call('start',{version:s.version},host.token)).status,400);
 for(let i=0;i<4;i++){s=await get(i);assert.equal((await call('ready',{version:s.version,ready:true},members[i].token)).status,200);}
 s=await get(0);assert.equal((await call('start',{version:s.version},host.token)).status,200);
 const snapshots=await Promise.all(members.map((_,i)=>get(i)));assert(snapshots.every(x=>x.hand.length===13));assert.equal(new Set(snapshots.flatMap(x=>x.hand.map(c=>c.id))).size,52);assert(snapshots.every(x=>x.players.every(p=>!('hand'in p))));assert(!JSON.stringify(snapshots).includes(host.token));
 assert.equal((await call('state',null,'invalid')).status,401);assert.equal((await call('join',{name:'پنجم',code:host.code,seat:1})).status,400);
 for(let offset=0;offset<4;offset++){const initial=await get(0);const i=initial.turn;s=await get(i);const res=await call('bid',{version:s.version,bid:2},members[i].token);assert.equal(res.status,200);}
 s=await get(1);assert.equal(s.phase,'playing');assert.equal(s.turn,s.hakem);
 const wrongSeat=(s.turn+1)%4;const wrong=await get(wrongSeat);assert.equal((await call('play',{version:wrong.version,card:wrong.hand[0].id},members[wrongSeat].token)).status,400);
 let played=0;while(played<8){s=await get(0);if(s.locked){await new Promise(r=>setTimeout(r,1100));continue;}const turn=s.turn;const own=await get(turn);const res=await call('play',{version:own.version,card:own.legal[0]},members[turn].token);assert.equal(res.status,200);const duplicate=await call('play',{version:own.version,card:own.legal[0]},members[turn].token);assert.equal(duplicate.status,409);played++;}
 const reconnect=await get(0);assert.equal(reconnect.hand.length,11);assert.equal(reconnect.code,host.code);
 }finally{await new Promise(r=>server.close(r));}
});

test('hakem retention, score priority, eight tie-break and clockwise package distribution',()=>{
 for(let h=0;h<4;h++){
  const own=h%2,other=1-own;let scores=[0,0],eights=[0,0];
  scores[own]=100;scores[other]=90;eights[other]=3;
  assert.equal(nextHakem(h,scores,eights),h);
  scores[other]=101;assert.equal(nextHakem(h,scores,eights),(h+1)%4);
  scores=[100,100];eights=[0,0];assert.equal(nextHakem(h,scores,eights),h);
  eights[other]=1;assert.equal(nextHakem(h,scores,eights),(h+1)%4);
  eights[own]=2;assert.equal(nextHakem(h,scores,eights),h);
  const hands=dealPackages(Array.from({length:52},(_,i)=>i),h);
  assert(hands.every(x=>x.length===13));assert.equal(new Set(hands.flat()).size,52);
  for(let o=0;o<4;o++)assert.deepEqual(hands[(h+o)%4],[...Array.from({length:5},(_,i)=>o*5+i),...Array.from({length:4},(_,i)=>20+o*4+i),...Array.from({length:4},(_,i)=>36+o*4+i)]);
 }
});
