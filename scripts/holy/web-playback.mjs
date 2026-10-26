import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {cleanItem} from '../../desktop/shared/profile-state.mjs';
import {entryKey} from './library.mjs';
export class WebPlayback{
 constructor({library,file,now=Date.now}){Object.assign(this,{library,file,now});let saved;try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{}this.sessions=new Map(Array.isArray(saved)?saved.filter(([token,s])=>/^[a-f0-9]{64}$/.test(token)&&cleanItem(s?.item)&&now()-s.at<86400000):[]);}
 save(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify([...this.sessions]),{mode:0o600});renameSync(this.file+'.tmp',this.file);}
 begin(item){
  const safe=cleanItem(item);if(!safe)return null;
  const resumeAt=this.library.resumeAt?.(item)||0;this.library.start(item);
  const token=randomBytes(32).toString('hex');const at=Math.max(this.now(),...Array.from(this.sessions.values(),s=>s.at+1));
  for(const [key,s]of this.sessions)if(this.now()-s.at>86400000)this.sessions.delete(key);
  while(this.sessions.size>=100)this.sessions.delete(this.sessions.keys().next().value);
  this.sessions.set(token,{item:safe,at,seq:{}});this.save();return{token,resumeAt};
 }
 update(token,value){
  const s=this.sessions.get(token);if(!s||this.now()-s.at>86400000)throw Object.assign(Error('Sesión de reproducción no válida.'),{status:401});
  if([...this.sessions.values()].some(other=>other.at>s.at&&other.item.url===s.item.url))throw Object.assign(Error('Hay una reproducción más reciente de este capítulo.'),{status:409});
  const {t,d,seq,client='companion'}=value;
  if(!['companion','manual'].includes(client)||!Number.isInteger(seq)||seq<1||seq>2147483647||!Number.isFinite(t)||!Number.isFinite(d)||t<0||d<=0||d>86400||t>d+30)throw Object.assign(Error('Posición no válida.'),{status:400});
  if(seq<=(s.seq[client]||0))return{ok:true,ignored:true};
  const updated=this.library.progress(entryKey(s.item),s.item.url,t,d);
  if(!updated)throw Object.assign(Error('La biblioteca ya está en otro capítulo.'),{status:409});
  s.seq[client]=seq;this.save();return{ok:true,t:updated.t,duration:updated.duration,libraryVersion:this.library.version};
 }
}
