import {createTVProfileStore,TV_PEER_REGISTRY_PATH} from './tv-profile-store.mjs';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
// This channel holds a kernel lock only while a small registry transaction runs.
// It never reserves the inspector or changes the page. TV timeout releases a sleeping PC.
export async function registryTransaction(ssh,work,{timeout=15000}={}){
 const command="flock -x -w 2 /tmp/luma-peer-sync.lock timeout 12 sh -c 'echo locked; if read -r p; then case \"$p\" in /tmp/luma-peer-sync.json.*.tmp) if mv \"$p\" /tmp/luma-peer-sync.json && chmod 600 /tmp/luma-peer-sync.json; then echo committed; fi;; esac; fi'";
 let stream,active=false,done=false,committed=false,started=0,output='',readyResolve,readyReject,commitResolve,commitReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const fail=()=>{active=false;const e=Error('No se pudo actualizar el vínculo de equipos en la TV.');readyReject(e);commitReject?.(e);};
 const timer=setTimeout(()=>{fail();stream?.close();},timeout);
 try{
  ssh.exec(command,(error,channel)=>{
   if(error){fail();return;}stream=channel;channel.on('error',fail);channel.once('close',()=>{if(!done)fail();active=false;});
   channel.on('data',bytes=>{output+=bytes.toString();if(output.length>100)fail();if(!active&&output.includes('locked\n')){active=true;started=performance.now();readyResolve();}if(output.includes('committed\n')){done=true;committed=true;commitResolve?.(true);}});
  });
  await ready;
  const guard=()=>{if(committed)return;if(!active||performance.now()-started>8000)throw Error('El vínculo de equipos agotó su reserva.');};
  const store=createTVProfileStore({ssh,guard,path:TV_PEER_REGISTRY_PATH,commit:path=>{
   guard();if(!/^\/tmp\/luma-peer-sync\.json\.[a-f0-9-]{36}\.tmp$/.test(path))throw Error('Ruta temporal inválida.');
   return new Promise((resolve,reject)=>{commitResolve=resolve;commitReject=reject;stream.write(path+'\n');});
  }});
  return await work(store);
 }finally{clearTimeout(timer);done=true;active=false;try{stream?.end();stream?.close();}catch{}}
}
export async function registerPeer(ssh,local){
 return registryTransaction(ssh,async store=>{
  const saved=await store.read();
  if(saved&&(!/^[a-f0-9]{64}$/.test(saved.key||'')||!Array.isArray(saved.peers)))throw Error('El vínculo guardado en la TV no es válido.');
  const key=saved?.key||local.key||randomBytes(32).toString('hex');
  const peers=(saved?.peers||[]).filter(p=>p.id!==local.id&&typeof p.id==='string'&&p.id.length<=80&&typeof p.host==='string'&&p.host.length<=60).slice(-7);
  peers.push({id:local.id,host:local.host,name:String(local.name||'equipo').slice(0,50),at:Date.now()});
  if(!await store.write({v:1,key,peers}))throw Error('No se guardó el vínculo de equipos.');
  return{key,peers};
 });
}
