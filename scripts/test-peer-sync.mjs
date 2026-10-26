import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {Library} from './holy/library.mjs';import {LibraryReplica,SyncProtocol,libraryHash,sign,seal,unseal} from '../desktop/shared/sync-protocol.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-peer-sync-'));let clock=100000;
const key=randomBytes(32).toString('hex');const item={title:'Between Steps',kind:'dorama',source:'doramasflix',url:'https://doramasflix.io/capitulos/between-steps-1x4',show:'https://doramasflix.io/doramas/between-steps',episode:4,genres:['Romance']};
const make=id=>{const library=new Library(join(dir,id+'.json'),()=>clock);return{library,replica:new LibraryReplica(library),protocol:null,id};};
const a=make('mac'),b=make('windows');for(const s of[a,b])s.protocol=new SyncProtocol({replica:s.replica,identity:s.id,key:()=>key,now:()=>clock});
const exchange=(from,to,ack='')=>{const req=from.protocol.request(ack),reply=to.protocol.accept(req,sign(req,key));return from.protocol.receive(req,reply,sign(reply,key));};
try{
 a.library.start(item);a.library.progress(item.show,item.url,123,4300);a.library.vote(item,2);b.library.prefer('genre','Acción',1);
 exchange(a,b);exchange(b,a);assert.equal(a.replica.hash(),b.replica.hash());assert.equal(b.library.resumeAt(item),123);assert.equal(b.library.voteOf(item),2);assert.equal(a.library.prefs.length,1);
 clock+=1000;b.library.progress(item.show,item.url,60,4300);exchange(b,a);assert.equal(a.library.resumeAt(item),60,'An intentional rewind must sync, rather than always choosing the furthest minute');
 a.library.setLanguage(item,{id:'38',kind:'dub',label:'Español latino'});exchange(a,b);assert.equal(b.library.languageOf(item).id,'38');
 const stale=a.replica.capture();clock+=1000;b.library.vote(item,0);b.library.remove(item.show);exchange(b,a);a.replica.merge(stale);assert.equal(a.library.voteOf(item),0);assert.equal(a.library.get(item.show),null);
 // Offline edits remain durable, then both directions converge without a TV lease.
 clock+=1000;a.library.prefer('genre','Drama',1);b.library.prefer('country','Japón',1);const reloaded=new Library(a.library.file);assert.equal(reloaded.prefs.length,2);exchange(a,b);exchange(b,a);assert.equal(a.replica.hash(),b.replica.hash());
 const sealed=seal(a.protocol.request(),key);assert.ok(!JSON.stringify(sealed).includes('Between Steps'));assert.equal(unseal(sealed,key).v,1);assert.throws(()=>unseal({...sealed,data:sealed.data.slice(0,-5)+'AAAA='},key));
 const req=a.protocol.request();assert.throws(()=>b.protocol.accept(req,'0'.repeat(64)));const reply=b.protocol.accept(req,sign(req,key));assert.throws(()=>b.protocol.accept(req,sign(req,key)));assert.throws(()=>a.protocol.receive(req,{...reply,hash:'bad'},sign(reply,key)));
 const expired={...a.protocol.request(),at:clock-300001};assert.throws(()=>b.protocol.accept(expired,sign(expired,key)));
 const equal=a.protocol.request(a.replica.hash());assert.equal(equal.library,undefined);const unchanged=b.protocol.accept(equal,sign(equal,key));assert.equal(unchanged.library,undefined);
 // A response racing a new local click must merge with it, not overwrite it.
 const delayed=a.protocol.request();const response=b.protocol.accept(delayed,sign(delayed,key));clock++;a.library.prefer('genre','Comedia',1);a.protocol.receive(delayed,response,sign(response,key));assert.ok(a.library.prefs.some(p=>p.name==='Comedia'));exchange(a,b);assert.equal(a.replica.hash(),b.replica.hash());
 // An incorrect older clock still creates a new event after observing remote state.
 clock=10;a.library.start(item);a.library.progress(item.show,item.url,200,4300);exchange(a,b);assert.equal(b.library.resumeAt(item),200);
 clock++;b.library.progress(item.show,item.url,300,4300);exchange(b,a);const observed=a.library.get(item.show).updatedAt;a.library.progress(item.show,item.url,200,4300);assert.equal(a.library.get(item.show).t,300,'An unchanged paused local observation cannot overwrite incoming progress');assert.equal(a.library.get(item.show).updatedAt,observed);
 assert.ok(readFileSync(a.library.file+'.before-sync','utf8'));
 assert.equal(libraryHash({...a.replica.capture(),asked:{b:2,a:1}}),libraryHash({...a.replica.capture(),asked:{a:1,b:2}}));
 console.log('Sincronización bidireccional: progreso/rewind, gustos, idiomas, borrados, cambios offline, firmas, replay, tráfico por hash y escrituras concurrentes correctos (sin TV).');
}finally{rmSync(dir,{recursive:true,force:true});}
