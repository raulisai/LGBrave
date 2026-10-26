import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{Library}from'./holy/library.mjs';import{WebPlayback}from'./holy/web-playback.mjs';import{registration,holyServer,playerKey}from'../browser/holy-companion/shared.js';
const dir=mkdtempSync(join(tmpdir(),'holy-web-progress-'));let now=100000;const library=new Library(join(dir,'library.json'),()=>now);const item={title:'Between Steps',kind:'dorama',source:'doramasflix',url:'https://doramasflix.io/capitulos/between-steps-1x4',show:'https://doramasflix.io/doramas/between-steps',episode:4};
try{
 library.start(item);library.progress(item.show,item.url,123,4300);const tracker=new WebPlayback({library,file:join(dir,'sessions.json'),now:()=>now});const playback=tracker.begin(item);assert.equal(playback.resumeAt,123);
 now+=10000;tracker.update(playback.token,{t:133,d:4300,seq:1});assert.equal(library.resumeAt(item),133);assert.equal(library.entries[0].watched,10);
 tracker.update(playback.token,{t:10,d:4300,seq:1});assert.equal(library.resumeAt(item),133,'Replayed samples cannot rewind the movie');
 const stamp=library.get(item.show).updatedAt;now+=10000;tracker.update(playback.token,{t:133,d:4300,seq:2});assert.equal(library.get(item.show).updatedAt,stamp,'An idle/paused player must not publish a newer position');
 const loaded=new WebPlayback({library,file:join(dir,'sessions.json'),now:()=>now});loaded.update(playback.token,{t:140,d:4300,seq:3});assert.equal(library.resumeAt(item),140);
 assert.throws(()=>tracker.update('bad',{t:1,d:50,seq:1}));assert.throws(()=>tracker.update(playback.token,{t:5000,d:4300,seq:4}));
 library.start({...item,url:'https://doramasflix.io/capitulos/between-steps-1x5',episode:5});assert.throws(()=>tracker.update(playback.token,{t:150,d:4300,seq:4}),/otro capítulo/);
 const sender={url:'http://192.168.1.65:43190/'};const message={type:'HOLY_PLAYBACK_OPEN',server:'http://192.168.1.65:43190',url:'https://streamtape.com/e/123?token=never-persist',playback};assert.ok(registration(message,sender));assert.ok(!registration({...message,server:'https://attacker.example'},sender));assert.ok(!holyServer('https://attacker.example:43190'));assert.equal(playerKey(message.url),'https://streamtape.com/e/123');
 now+=86400001;assert.throws(()=>loaded.update(playback.token,{t:160,d:4300,seq:5}));
 console.log('Progreso web: reanudar, guardado, pausas, orden de muestras, reinicio, expiración, límites y vínculo seguro con el complemento correctos.');
}finally{rmSync(dir,{recursive:true,force:true});}
