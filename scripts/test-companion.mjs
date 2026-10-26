import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{randomBytes}from'node:crypto';import vm from'node:vm';
const originalChrome=globalThis.chrome,originalFetch=globalThis.fetch;const session={},listeners={},requests=[];const token=randomBytes(32).toString('hex');
const store={async get(key){if(key===null)return structuredClone(session);return{[key]:structuredClone(session[key])};},async set(value){Object.assign(session,structuredClone(value));},async remove(key){delete session[key];}};
try{
 globalThis.chrome={storage:{session:store},runtime:{getURL:p=>'chrome-extension://holy/'+p,onMessage:{addListener:fn=>listeners.message=fn}},tabs:{async query(){return[{id:2,openerTabId:1,url:'https://streamtape.com/e/movie'}];},async get(id){return{id,url:'https://streamtape.com/e/movie'};},onUpdated:{addListener:fn=>listeners.updated=fn},onRemoved:{addListener:fn=>listeners.removed=fn}},scripting:{async executeScript(){}}};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return{ok:true,status:200};};await import('../browser/holy-companion/background.js');
 const send=(m,s)=>new Promise(resolve=>listeners.message(m,s,resolve));const source={tab:{id:1},url:'http://192.168.1.65:43190/'};const data={type:'HOLY_PLAYBACK_OPEN',server:'http://192.168.1.65:43190',url:'https://streamtape.com/e/movie?secret=not-stored',playback:{token,resumeAt:123}};
 assert.equal((await send({type:'register',data},source)).ok,true);assert.ok(!JSON.stringify(session).includes('not-stored'));
 assert.equal((await send({type:'session'},{tab:{id:99},url:'https://streamtape.com/e/other'})).ok,false);
 const player={tab:{id:2,openerTabId:1},frameId:0,url:'https://streamtape.com/e/movie'};assert.equal((await send({type:'session'},player)).resumeAt,123);
 assert.equal((await send({type:'session'},{...player,url:'https://other.example/'})).ok,false);
 await send({type:'progress',value:{t:130,d:4300,area:1920*1080}},player);assert.equal(requests.length,1);assert.equal(JSON.parse(requests[0].options.body).t,130);assert.equal(requests[0].options.headers.Authorization,'Bearer '+token);
 assert.equal((await send({type:'activate',tabId:99},player)).ok,false);
 await send({type:'register',data:{...data,server:'https://evil.example'}},source);assert.equal(Object.keys(session).length,1);
 listeners.removed(2);assert.equal((await send({type:'session'},player)).ok,false);
 const manifest=JSON.parse(readFileSync(new URL('../browser/holy-companion/manifest.json',import.meta.url)));assert.ok(!manifest.host_permissions.some(s=>['<all_urls>','https://*/*','http://*/*'].includes(s)));
 // Run the actual isolated player script against a video and mocked browser messaging.
 const sent=[];let interval;const v={currentTime:0,duration:4300,readyState:4,addEventListener(){},removeEventListener(){},getBoundingClientRect(){return{width:1920,height:1080};}};
 const context={document:{querySelectorAll:()=>[v]},getComputedStyle:()=>({visibility:'visible',display:'block'}),chrome:{runtime:{sendMessage:async m=>{if(m.type==='session')return{ok:true,resumeAt:123};sent.push(m);return{ok:true};}}},setInterval:fn=>{interval=fn;return 1;},clearInterval(){},window:{addEventListener(){}},Date};
 vm.runInNewContext(readFileSync(new URL('../browser/holy-companion/player.js',import.meta.url),'utf8'),context);await new Promise(r=>setImmediate(r));assert.equal(v.currentTime,123);assert.equal(sent[0].value.t,123);await interval();await new Promise(r=>setImmediate(r));assert.equal(sent.length,1,'An unchanged paused position is not reported repeatedly');
 console.log('Complemento: solo vídeos vinculados desde Holy, permiso por sitio, URL sin tokens persistentes, reanudación y mensajes de progreso correctos (Chrome simulado).');
}finally{globalThis.chrome=originalChrome;globalThis.fetch=originalFetch;}
