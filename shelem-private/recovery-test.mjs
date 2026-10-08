import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeStore} from './persistence.mjs';
test('actual process restart restores tokens, cards and pending trick exactly once',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shelem-'));
 let child;
 async function boot(){child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'31987',STATE_FILE:path.join(dir,'state.json')}});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',()=>reject(new Error('Startup failed')));});}
 async function stop(){const p=child;await new Promise(r=>{p.once('exit',r);p.kill('SIGKILL');});child=null;}
 async function call(action,data,token){const r=await fetch('http://127.0.0.1:31987/api/'+action,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});assert.equal(r.status,200);return r.json();}
 try{await boot();const members=[await call('create',{name:'A'})];for(let seat=1;seat<4;seat++)members.push(await call('join',{code:members[0].code,name:String(seat),seat}));
 const get=i=>call('state',null,members[i].token);
 for(let i=0;i<4;i++){const s=await get(i);await call('ready',{ready:true,version:s.version},members[i].token);}
 let s=await get(0);await call('start',{version:s.version},members[0].token);
 for(let i=0;i<4;i++){s=await get(0);await call('bid',{version:s.version,bid:2},members[s.turn].token);}
 for(let i=0;i<4;i++){s=await get(0);const own=await get(s.turn);await call('play',{version:own.version,card:own.legal[0]},members[s.turn].token);}
 const before=await Promise.all(members.map((_,i)=>get(i)));assert.equal(before[0].trick.length,4);
 await stop();await boot();let after=await get(0);assert.deepEqual(after.hand,before[0].hand);assert.equal(after.trick.length,4);assert.equal(after.code,before[0].code);
 await new Promise(r=>setTimeout(r,3300));after=await get(0);assert.equal(after.trick.length,0);assert.equal(after.players.reduce((a,p)=>a+p.tricks,0),1);
 await stop();await boot();after=await get(0);assert.equal(after.players.reduce((a,p)=>a+p.tricks,0),1);assert.equal(after.trick.length,0);
 }finally{if(child)await stop();await fs.rm(dir,{recursive:true,force:true});}
});
test('database configuration fails closed and unavailable storage is never treated as empty',async()=>{
 assert.throws(()=>makeStore({REQUIRE_PERSISTENCE:'true'}));assert.throws(()=>makeStore({SUPABASE_URL:'https://example.com'}));
 const old=globalThis.fetch;globalThis.fetch=async()=>({ok:false});try{const store=makeStore({SUPABASE_URL:'https://example.com',SUPABASE_SECRET_KEY:'test'});await assert.rejects(store.load());await assert.rejects(store.save({schema:1,rooms:[]}));}finally{globalThis.fetch=old;}
});
