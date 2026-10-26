import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {homedir,hostname} from 'node:os';
import {join,dirname} from 'node:path';
import {isIP} from 'node:net';
import {LibraryReplica,SyncProtocol,sign,authentic,seal,unseal,SYNC_WIRE_BYTES} from './sync-protocol.mjs';
import {registerPeer} from './peer-registry.mjs';
export const privateHost=host=>{if(isIP(host)!==4)return false;const[a,b]=host.split('.').map(Number);return a===10||(a===192&&b===168)||(a===172&&b>=16&&b<=31);};
export const syncSettingsFile=()=>join(process.env.LOCALAPPDATA||join(homedir(),'.config'),'HolyLuma','peer-sync.json');
export class PeerSync{
 constructor({library,file=syncSettingsFile(),host,peers=()=>[],connect,device,port=43190,now=Date.now,fetcher=fetch,diagnostics}={}){
  Object.assign(this,{file,host,peers,connect,device,port,now,fetcher,diagnostics});
  let saved;try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{saved={};}
  this.settings={id:/^[a-f0-9-]{36}$/.test(saved.id||'')?saved.id:randomUUID(),key:/^[a-f0-9]{64}$/.test(saved.key||'')?saved.key:'',peers:Array.isArray(saved.peers)?saved.peers:[]};
  this.replica=new LibraryReplica(library);this.protocol=new SyncProtocol({replica:this.replica,identity:this.settings.id,key:()=>this.settings.key,now});this.links=new Map();this.abort=new AbortController();this.save();
 }
 save(){mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const temporary=this.file+'.'+randomUUID()+'.tmp';writeFileSync(temporary,JSON.stringify(this.settings),{mode:0o600});renameSync(temporary,this.file);}
 async discover(){
  if(!this.connect||this.now()<(this.discoverAt||0))return;this.discoverAt=this.now()+30000;
  let session;try{session=await this.connect(this.device());this.discoverySession=session;if(this.stopping)return;const registry=await registerPeer(session.ssh,{...this.settings,host:this.host(),name:hostname()});
   if(this.stopping)return;this.settings.key=registry.key;this.settings.peers=registry.peers.filter(p=>p.id!==this.settings.id&&privateHost(p.host));this.save();this.discoveryError='';
  }catch{this.discoveryError='La TV no está disponible para actualizar el vínculo; se conservan los equipos ya vinculados.';}
  finally{this.discoverySession=null;try{session?.ssh.end();}catch{}}
 }
 async tick(){if(this.pending)return this.pending;this.pending=this.step().finally(()=>{this.pending=null;});return this.pending;}
 async step(){
  // Discovery is a separate bounded SSH transaction. Cached peers keep exchanging with TV off.
  if(!this.discoveryWork)this.discoveryWork=this.discover().finally(()=>{this.discoveryWork=null;});
  if(!this.settings.key)await this.discoveryWork;if(!this.settings.key)return;
  const hosts=[...new Set([...this.settings.peers.map(p=>p.host),...this.peers()])].filter(h=>privateHost(h)&&h!==this.host()).slice(0,8);
  await Promise.all(hosts.map(async host=>{
   const link=this.links.get(host)||{host,state:'pending',ack:''};const before=link.state;this.links.set(host,link);
   try{
    const request=this.protocol.request(link.ack),envelope=seal(request,this.settings.key);const response=await this.fetcher('http://'+host+':'+this.port+'/holy-api/profile-sync',{method:'POST',headers:{'Content-Type':'application/json','X-Holy-Signature':sign(envelope,this.settings.key)},body:JSON.stringify(envelope),signal:AbortSignal.any([AbortSignal.timeout(3000),this.abort.signal])});
    if(!response.ok){link.state=response.status===404?'needs-update':'offline';link.error=response.status===404?'El otro equipo necesita actualizar Holy.':'No se pudo sincronizar con el equipo.';return;}
    const text=await limitedResponse(response);const box=JSON.parse(text);if(this.stopping)return;if(!authentic(box,response.headers.get('x-holy-signature'),this.settings.key))throw Error('Firma inválida.');const value=unseal(box,this.settings.key);link.ack=this.protocol.receive(request,value,sign(value,this.settings.key));link.state='synced';link.updated=this.now();link.error='';
   }catch{link.state='offline';link.error='Equipo sin conexión; se conserva la copia local y se reintentará.';}
   finally{if(before!==link.state)this.diagnostics?.event('profile-sync','peer-state',{source:host,state:link.state},link.state==='offline'?'warn':'info');}
  }));
 }
 async handle(req,res){
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  if(req.headers.origin!==undefined||!this.settings.key){res.writeHead(401).end();return;}
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>SYNC_WIRE_BYTES)throw Object.assign(Error('Perfil demasiado grande.'),{status:413});chunks.push(chunk);}
   const box=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!authentic(box,req.headers['x-holy-signature'],this.settings.key))throw Object.assign(Error('Firma inválida.'),{status:401});const value=unseal(box,this.settings.key);const reply=this.protocol.accept(value,sign(value,this.settings.key)),responseBox=seal(reply,this.settings.key);
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Holy-Signature':sign(responseBox,this.settings.key)});res.end(JSON.stringify(responseBox));
   this.lastInbound=this.now();this.lastInboundHash=reply.hash;
  }catch(error){res.writeHead(error.status||400,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,error:'No se aceptó la sincronización.'}));}
 }
 status(){const records=[...this.links.values()],hash=this.replica.hash();const links=records.map(({host,state,updated,error})=>({host,state,updated:updated||null,error:error||''}));const pending=records.length?records.some(p=>p.ack!==hash):!!this.lastInboundHash&&this.lastInboundHash!==hash;const synced=!pending&&(links.some(p=>p.state==='synced')||this.lastInbound&&this.now()-this.lastInbound<15000);
  return{paired:!!this.settings.key,state:synced?'synced':links.some(p=>p.state==='needs-update')?'needs-update':this.settings.key?'pending':'unpaired',updated:Math.max(this.lastInbound||0,...links.map(p=>p.updated||0))||null,peers:links,pending,transport:'Red local cifrada y autenticada; copias persistentes en cada equipo',discovery:this.discoveryError||''};}

 start(){if(this.started)return this;this.started=true;this.stopping=false;if(this.abort.signal.aborted)this.abort=new AbortController();const run=async()=>{try{await this.tick();}catch(error){this.diagnostics?.event('profile-sync','error',{error},'warn');}finally{if(!this.stopping){this.timer=setTimeout(run,5000);this.timer.unref();}}};run();return this;}
 async stop(){this.stopping=true;this.started=false;this.abort.abort();clearTimeout(this.timer);try{this.discoverySession?.ssh.end();}catch{}}
}
async function limitedResponse(response){if(Number(response.headers.get('content-length'))>SYNC_WIRE_BYTES)throw Error('Respuesta excesiva.');let size=0;const parts=[];for await(const chunk of response.body){size+=chunk.length;if(size>SYNC_WIRE_BYTES)throw Error('Respuesta excesiva.');parts.push(Buffer.from(chunk));}return Buffer.concat(parts).toString('utf8');}
