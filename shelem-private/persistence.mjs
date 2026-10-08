import fs from 'node:fs/promises';
import path from 'node:path';
export function makeStore(env=process.env){
 const url=env.SUPABASE_URL,key=env.SUPABASE_SECRET_KEY;
 if(url||key){
  if(!url||!key)throw new Error('Both Supabase settings are required');
  const endpoint=new URL('/rest/v1/shelem_snapshots',url);
  if(endpoint.protocol!=='https:')throw new Error('Supabase requires HTTPS');
  async function request(method,data){const r=await fetch(endpoint+'?id=eq.main',{method,signal:AbortSignal.timeout(15000),headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:data?JSON.stringify({id:'main',payload:data}):undefined});if(!r.ok)throw new Error('Snapshot database unavailable');return method==='GET'?await r.json():null;}
  return {kind:'supabase',async load(){return (await request('GET'))[0]?.payload||null;},async save(data){await request('POST',data);}};
 }
 if(env.STATE_FILE){const file=path.resolve(env.STATE_FILE);return {kind:'file',async load(){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},async save(data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(data),{mode:0o600});await fs.rename(file+'.tmp',file);}};}
 if(env.REQUIRE_PERSISTENCE==='true')throw new Error('Persistent storage is required');
 return {kind:'memory',async load(){return null;},async save(){}};
}
