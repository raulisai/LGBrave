import {registration,playerKey} from './shared.js';
const ttl=24*3600*1000;
async function all(){return await chrome.storage.session.get(null);}
async function attach(tab,manual=false){
 const data=await all();for(const[key,p]of Object.entries(data)){
  if(!key.startsWith('pending-'))continue;if(Date.now()-p.at>ttl){await chrome.storage.session.remove(key);continue;}
  if(playerKey(tab.url)!==p.player||(!manual&&tab.openerTabId!==p.owner))continue;
  await chrome.storage.session.set({['tab-'+tab.id]:{...p,seq:0,frame:null}});await chrome.storage.session.remove(key);return true;
 }return false;
}
async function act(message,sender){
 if(message?.type==='register'){
  const d=message.data;if(!registration(d,sender)||!sender.tab?.id)return{ok:false};
  const p={server:d.server,token:d.playback.token,resumeAt:d.playback.resumeAt,player:playerKey(d.url),owner:sender.tab.id,at:Date.now()};
  if(d.embedded)await chrome.storage.session.set({['tab-'+sender.tab.id]:{...p,seq:0,frame:null}});
  else{await chrome.storage.session.set({['pending-'+d.playback.token]:p});for(const tab of await chrome.tabs.query({}))if(await attach(tab))break;}
  return{ok:true};
 }
 if(message?.type==='activate'){
  if(sender.url!==chrome.runtime.getURL('popup.html'))return{ok:false};
  const tab=await chrome.tabs.get(message.tabId);if(!await attach(tab,true)&&!(await chrome.storage.session.get('tab-'+tab.id))['tab-'+tab.id])return{ok:false,error:'Primero abre este vídeo desde Holy.'};
  await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['player.js']});return{ok:true};
 }
 if(!sender.tab?.id)return{ok:false};const key='tab-'+sender.tab.id;let p=(await chrome.storage.session.get(key))[key];
 if(!p&&message?.type==='session'){await attach({...sender.tab,url:sender.url});p=(await chrome.storage.session.get(key))[key];}
 if(!p||Date.now()-p.at>ttl)return{ok:false};
 try{if(new URL(sender.url).origin!==new URL(p.player).origin)return{ok:false};}catch{return{ok:false};}
 if(message?.type==='session')return{ok:true,resumeAt:p.resumeAt};
 if(message?.type==='progress'){
  const v=message.value;if(!v||!Number.isFinite(v.t)||!Number.isFinite(v.d)||v.d<60||v.t<0||v.t>v.d+30||!Number.isFinite(v.area)||v.area<14400)return{ok:false};
  if(p.frame!==null&&p.frame!==sender.frameId&&v.area<=p.area)return{ok:false};
  p.frame=sender.frameId;p.area=v.area;p.seq++;
  await chrome.storage.session.set({[key]:p});
  try{const r=await fetch(p.server+'/holy-api/progress',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+p.token},body:JSON.stringify({t:v.t,d:v.d,seq:p.seq,client:'companion'}),signal:AbortSignal.timeout(5000)});if(r.status===401||r.status===409)await chrome.storage.session.remove(key);return{ok:r.ok};}catch{return{ok:false};}
 }
 return{ok:false};
}
const queues=new Map();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{const id=sender.tab?.id||message.tabId||'popup';const work=(queues.get(id)||Promise.resolve()).then(()=>act(message,sender));queues.set(id,work.catch(()=>{}));work.then(reply,()=>reply({ok:false}));return true;});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.url||change.status==='complete')attach(tab).catch(()=>{});});
chrome.tabs.onRemoved.addListener(id=>{chrome.storage.session.remove('tab-'+id);});
