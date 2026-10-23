import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
// Brave's mirror refreshes at :15 and :45; an unchanged mirror costs two `git ls-remote`.
export const FILTER_CHECK_MS=30*60*1000;
export class FilterUpdates {
 constructor({run,now=Date.now,log=console.log}={}){this.now=now;this.log=log;this.run=run||(()=>this.download());this.stopped=false;this.nextAttempt=0;this.failures=0;}
 async download(){
  return new Promise((resolve,reject)=>{
   const child=this.child=spawn(process.execPath,['scripts/update-lists.mjs'],{stdio:['ignore','pipe','pipe']});let output='';
   child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
   child.once('error',reject);child.once('exit',code=>{this.child=null;if(code!==0)return reject(Error(output.slice(-1000)||'Actualización interrumpida'));try{resolve(JSON.parse(output.trim().split('\n').at(-1)))}catch{resolve(null)}});
  });
 }
 async check(){
  if(this.stopped||this.pending||this.now()<this.nextAttempt)return;
  let checked=0;try{checked=Date.parse(JSON.parse(readFileSync('research/lists/sync-state.json','utf8')).checkedAt)||0}catch{}
  if(this.now()-checked<FILTER_CHECK_MS)return;
  this.pending=true;
  try{const result=await this.run();this.failures=0;this.nextAttempt=this.now()+FILTER_CHECK_MS;if(!this.stopped&&result?.changed!==false)this.log('Filtros de Brave actualizados y verificados. Se conservan la página y la reproducción.');}
  catch(e){this.failures++;this.nextAttempt=this.now()+Math.min(60,15*2**Math.min(this.failures-1,2))*60000;if(!this.stopped)this.log('No se pudieron actualizar los filtros; se conserva la versión activa. '+e.message);}
  finally{this.pending=false;}
 }
 start(){this.timer=setInterval(()=>this.check(),60000);this.check();return this;}
 stop(){this.stopped=true;clearInterval(this.timer);this.child?.kill('SIGTERM');}
}
