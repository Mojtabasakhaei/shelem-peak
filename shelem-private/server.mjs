import http from 'node:http';
import {makeStore} from './persistence.mjs';
import {nextHakem,dealPackages} from './table-rules.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const source=fs.readFileSync(root+'engine-source.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const rooms=new Map(),sessions=new Map(),rates=new Map();
let store=makeStore(),queue=Promise.resolve();
function serial(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;}
function snapshot(){return {schema:1,rooms:[...rooms.values()].map(r=>({code:r.code,members:r.members,version:r.version,started:r.started,touched:r.touched,hakem:r.hakem,state:r.ctx.state,report:r.nodes.get('report-body')?.innerHTML||'',reportTitle:r.nodes.get('report-title')?.textContent||''}))};}
function restore(data){
 if(data?.schema!==1||!Array.isArray(data.rooms))throw new Error('Invalid snapshot');
 for(const r of rooms.values())r.timers.forEach(clearTimeout);
 rooms.clear();sessions.clear();
 for(const saved of data.rooms){if(Date.now()-saved.touched>24*3600000)continue;const r={...saved};newEngine(r);r.ctx.state=saved.state;r.ctx.state.paused=false;
 r.ctx.document.getElementById('report-body').innerHTML=saved.report;
 r.ctx.document.getElementById('report-title').textContent=saved.reportTitle;
 rooms.set(r.code,r);r.members.forEach((m,seat)=>{if(m){m.lastSeen=0;sessions.set(m.token,{room:r,seat});}});
 if(r.ctx.state.phase==='playing'&&r.ctx.state.trick.length===4)r.ctx.schedule(r.ctx.settleTrickWinner,3000);
 }
}
export async function initializePersistence(env=process.env){store=makeStore(env);const saved=await store.load();if(saved)restore(saved);return store.kind;}
async function commit(fn){const before=JSON.stringify(snapshot());try{const result=await fn();await store.save(snapshot());return result;}catch(e){restore(JSON.parse(before));throw e;}}
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function nameOf(v){if(typeof v!=='string'||!v.trim()||v.trim().length>30)fail('نامی بین ۱ تا ۳۰ نویسه وارد کنید.');return v.trim();}
function newEngine(room){
 const nodes=new Map(),timers=new Set(),storage=new Map();
 function node(){return {style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},dataset:{},children:[],value:'',textContent:'',innerHTML:'',scrollLeft:0,appendChild(n){this.children.push(n);},replaceChildren(...n){this.children=n;},setAttribute(){}};}
 const document={documentElement:node(),body:node(),getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node,querySelectorAll(){return [];}};
 const ctx={document,localStorage:{getItem(k){return storage.get(k)||null;},setItem(k,v){storage.set(k,String(v));}},console,Math,Number,JSON,Array,Object,Error,Date,confirm:()=>false,alert(){},setInterval(){return 0;},clearInterval(){},setTimeout(fn,ms){const t=setTimeout(()=>{timers.delete(t);serial(()=>commit(()=>{fn();room.version++;room.touched=Date.now();})).catch(()=>console.error('Trick save failed; state restored'));},ms);timers.add(t);return t;},clearTimeout(t){clearTimeout(t);timers.delete(t);}};
 ctx.window=ctx;ctx.addEventListener=()=>{};vm.createContext(ctx);vm.runInContext(source,ctx);
 ctx.renderView=()=>{};ctx.startTurnTimer=()=>{};ctx.runBiddingRoutine=()=>{};
 ctx.triggerRoundPlay=()=>{if(ctx.state.phase==='playing'&&!ctx.state.moveLocked)ctx.enforceBlackJokerDeadline(ctx.state.currentTurn);};
 ctx.recordPersonalRound=()=>null;
 room.ctx=ctx;room.nodes=nodes;room.timers=timers;
 ctx.state.players.forEach(p=>p.isBot=false);
}
function member(room,name,seat){const token=crypto.randomBytes(32).toString('hex');room.members[seat]={name,token,ready:false,lastSeen:Date.now()};sessions.set(token,{room,seat});room.version++;return {code:room.code,token,seat};}
function identify(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const session=sessions.get(token);if(!session)fail('نشست معتبر نیست؛ دوباره وارد میز شوید.',401);session.room.touched=Date.now();session.room.members[session.seat].lastSeen=Date.now();return session;}
function view(room,seat){const s=room.ctx.state;return {code:room.code,version:room.version,you:seat,host:seat===0,phase:room.started?s.phase:'lobby',members:room.members.map((m,i)=>m?{name:m.name,seat:i,team:i%2,ready:m.ready,connected:Date.now()-m.lastSeen<10000}:null),players:s.players.map((p,i)=>({name:room.members[i]?.name||'',bid:p.bid,tricks:p.tricks,count:p.hand.length,team:p.team})),hand:room.started?s.players[seat].hand:[],legal:room.started&&s.phase==='playing'&&s.currentTurn===seat&&!s.moveLocked?room.ctx.getLegalMoves(seat).map(c=>c.id):[],turn:s.currentTurn,locked:s.moveLocked,trick:s.trick,scores:s.teamScores,eights:s.teamEights,round:s.roundNumber,report:s.phase==='ended'?room.nodes.get('report-body')?.innerHTML||'':'',reportTitle:s.phase==='ended'?room.nodes.get('report-title')?.textContent||'':'',winner:s.matchWinner,hakem:room.hakem??null};}
function beginRound(room){const c=room.ctx;
 room.hakem=room.hakem===undefined?crypto.randomInt(4):nextHakem(room.hakem,c.state.teamScores,c.state.teamEights);
 c.state.dealer=(room.hakem+3)%4;c.startNewRoundCycle();
 const hands=dealPackages(c.createFreshDeck(),room.hakem);
 c.state.players.forEach((p,i)=>{p.name=room.members[i].name;p.isBot=false;p.hand=c.sortPlayerHand(hands[i]);});
 c.state.currentTurn=room.hakem;room.started=true;
}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)fail('درخواست بیش از حد بزرگ است.',413);}try{return JSON.parse(raw||'{}');}catch{fail('درخواست نامعتبر است.');}}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
export function createServer(){return http.createServer((req,res)=>{serial(async()=>{const before=JSON.stringify(snapshot());let status=200,response;const send=(code,data)=>{status=code;response=data;};try{
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(fs.readFileSync(root+'public/index.html'));return;}
 if(url.pathname==='/health'){send(200,{ok:true});return;}
 if(req.method==='GET'&&url.pathname==='/api/state'){const {room,seat}=identify(req);send(200,view(room,seat));return;}
 if(req.method!=='POST')fail('مسیر پیدا نشد.',404);
 // Same-origin browser requests only. No cross-site cookie authentication.
 if(req.headers.origin){const expected=process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`;if(req.headers.origin!==expected)fail('مبدأ درخواست مجاز نیست.',403);}
 const ip=req.socket.remoteAddress;const r=rates.get(ip)||{at:Date.now(),n:0};if(Date.now()-r.at>60000){r.at=Date.now();r.n=0;}if(++r.n>180)fail('کمی صبر کنید و دوباره تلاش کنید.',429);rates.set(ip,r);
 const b=await body(req);
 if(url.pathname==='/api/create'){if(rooms.size>=200)fail('ظرفیت میزها تکمیل است.',503);const name=nameOf(b.name);let code;do{code=crypto.randomBytes(6).toString('base64url').toUpperCase();}while(rooms.has(code));const room={code,members:Array(4).fill(null),version:0,started:false,touched:Date.now()};newEngine(room);rooms.set(code,room);send(200,member(room,name,0));return;}
 if(url.pathname==='/api/join'){const room=rooms.get(String(b.code||'').trim().toUpperCase());if(!room)fail('کد میز پیدا نشد.',404);if(room.started)fail('بازی شروع شده؛ فقط اعضای قبلی می‌توانند برگردند.');const seat=Number(b.seat);if(!Number.isInteger(seat)||seat<1||seat>3||room.members[seat])fail('این جایگاه آزاد نیست.');const name=nameOf(b.name);if(room.members.some(m=>m?.name===name))fail('این نام در میز استفاده شده است.');room.members.forEach(m=>{if(m)m.ready=false;});send(200,member(room,name,seat));return;}
 const {room,seat}=identify(req),c=room.ctx,s=c.state;
 if(b.version!==room.version)fail('وضعیت میز تغییر کرده؛ دوباره تلاش کنید.',409);
 if(url.pathname==='/api/ready'){if(room.started)fail('بازی شروع شده است.');room.members[seat].ready=!!b.ready;}
 else if(url.pathname==='/api/start'){if(seat!==0)fail('فقط سازنده میز می‌تواند شروع کند.',403);if(room.started)fail('بازی شروع شده است.');if(!room.members.every(m=>m?.ready))fail('هر چهار بازیکن باید ترکیب را تأیید کنند.');beginRound(room);}
 else if(url.pathname==='/api/bid'){if(!room.started||s.phase!=='bidding'||s.currentTurn!==seat)fail('نوبت تعهد شما نیست.');if(!Number.isInteger(b.bid)||b.bid<2||b.bid>13)fail('تعهد باید بین ۲ و ۱۳ باشد.');s.players[seat].bid=b.bid;s.currentTurn=(seat+1)%4;if(s.players.every(p=>p.bid>=2)){s.phase='playing';s.currentTurn=(s.dealer+1)%4;c.triggerRoundPlay();}}
 else if(url.pathname==='/api/play'){if(!room.started||s.phase!=='playing'||s.currentTurn!==seat||s.moveLocked)fail('نوبت بازی شما نیست.');const card=s.players[seat].hand.find(x=>x.id===b.card);if(!card)fail('کارت در دست شما نیست.');const before=s.phase;if(!c.executeMove(seat,card)&&s.phase===before)fail('این کارت در این نوبت مجاز نیست.');}
 else if(url.pathname==='/api/next'){if(seat!==0||s.phase!=='ended')fail('فقط سازنده پس از پایان دور می‌تواند ادامه دهد.');if(s.matchWinner!==null){s.teamScores=[0,0];s.teamEights=[0,0];s.roundNumber=0;room.hakem=undefined;}beginRound(room);}
 else if(url.pathname==='/api/leave'){if(room.started)fail('بازی در جریان است؛ نشست شما برای بازگشت حفظ می‌شود.');if(seat===0){room.members.filter(Boolean).forEach(m=>sessions.delete(m.token));rooms.delete(room.code);}else{sessions.delete(room.members[seat].token);room.members[seat]=null;room.members.forEach(m=>{if(m)m.ready=false;});}send(200,{left:true});return;}
 else fail('مسیر پیدا نشد.',404);
 room.version++;send(200,view(room,seat));
 }catch(e){status=e.status||500;response={error:e.status?e.message:'خطای سرور؛ دوباره تلاش کنید.'};}finally{if(response){if(req.method==='POST'){try{await store.save(snapshot());}catch{restore(JSON.parse(before));status=503;response={error:'ذخیرهٔ بازی ممکن نشد؛ حرکت ثبت نشد. کمی بعد دوباره تلاش کنید.'};}}reply(res,status,response);}}}).catch(()=>{if(!res.writableEnded)reply(res,503,{error:'سرور آماده نیست.'});});});}
const cleanup=setInterval(()=>{serial(()=>commit(()=>{const now=Date.now();for(const [code,r] of rooms)if(now-r.touched>24*3600000){r.members.filter(Boolean).forEach(m=>sessions.delete(m.token));r.timers.forEach(clearTimeout);rooms.delete(code);}for(const [ip,r] of rates)if(now-r.at>120000)rates.delete(ip);})).catch(()=>console.error('Cleanup save failed'));},60000);cleanup.unref();
if(process.argv[1]===fileURLToPath(import.meta.url)){await initializePersistence();createServer().listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Shelem private table server listening'));}
