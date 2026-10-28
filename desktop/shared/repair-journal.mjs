import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
const ACTIONS=new Set(['start','restart','wake','refresh']);
const WINDOW=10*60000;
export class RepairJournal {
  constructor({file,now=Date.now}={}){this.file=file;this.now=now;this.memory={v:1,attempts:[]};}
  reserve(action,code){
    if(!ACTIONS.has(action))return{allowed:false,reason:'invalid-action'};
    const now=this.now();let state=this.memory;
    try{
      if(this.file&&existsSync(this.file))state=JSON.parse(readFileSync(this.file,'utf8'));
      if(state?.v!==1||!Array.isArray(state.attempts))throw Error('journal');
      const attempts=state.attempts.filter(a=>ACTIONS.has(a.action)&&Number.isFinite(a.at));
      const recent=attempts.filter(a=>now-a.at<WINDOW),same=recent.filter(a=>a.action===action);
      const last=same.at(-1),delay=action==='restart'?[30000,120000,300000][Math.min(2,same.length-1)]:30000;
      const retryAfterMs=same.length>=3?Math.max(0,same[0].at+WINDOW-now):last?Math.max(0,last.at+delay-now):0;
      if(retryAfterMs)return{allowed:false,reason:'cooldown',retryAfterMs,attempt:same.length};
      const next={v:1,attempts:[...recent,{action,code:/^[a-z-]{1,64}$/.test(code||'')?code:'unknown',at:now}].slice(-30)};
      if(this.file){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(next)+'\n',{mode:0o600});renameSync(this.file+'.tmp',this.file);}
      this.memory=next;return{allowed:true,attempt:same.length+1};
    }catch{return{allowed:false,reason:'journal-unavailable',retryAfterMs:30000};}
  }
}
