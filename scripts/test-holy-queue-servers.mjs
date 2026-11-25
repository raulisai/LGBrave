import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Library} from './holy/library.mjs';
import {HolyBridge} from './holy/holy-bridge.mjs';
import {Catalog} from './holy/catalog.mjs';
import {packHome,unpackHome,sectionRows} from '../src/holy.js';
import {parse,compileModule} from 'svelte/compiler';
import {pathToFileURL} from 'node:url';
import {startServer} from './holy/server.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-queue-servers-'));
const item={source:'test',title:'Película',kind:'movie',url:'https://source.example/film',year:'2020'};
let server;
try {
 const file=join(dir,'library.json'),library=new Library(file);
 assert.equal(library.toggleQueue(item),true);
 assert.equal(library.entries.length,0,'Queued titles do not become watched');
 assert.equal(new Library(file).watchQueue[0].year,'2020');
 assert.equal(library.toggleQueue(item),false);
 const show={...item,isShow:true,kind:'series',show:'https://source.example/show',url:'https://source.example/show'};
 library.toggleQueue(show);
 assert.equal(new Library(file).watchQueue[0].isShow,true,'Series still open episode lists');
 assert.equal(library.toggleQueue({...show,url:show.url+'/1',isShow:false}),false,'A title is queued once per series');
 assert.throws(()=>library.toggleQueue({...item,url:item.url+'?token=SECRET'}));
 library.toggleQueue({...item,poster:'https://img.example/p?token=SECRET'});
 assert.equal(library.watchQueue[0].poster,'');
 const catalog=new Catalog({file:join(dir,'c.json'),detailsFile:join(dir,'d.json'),connectors:[{id:'test',name:'Test',site:'https://source.example',parseHome:()=>[]}],fetch:async()=>''});
 const home=unpackHome(packHome(catalog.home(library)));
 assert.equal(sectionRows(home,'cola')[0].items[0].title,item.title);
 assert.ok(sectionRows(home,'inicio').some(row=>row.id==='queue'));
 server=await startServer({catalog,library,port:0,root:dir,imageDir:join(dir,'images'),log:()=>{},resolveHost:async()=>['93.184.216.34']});
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 let response=await fetch(base+'/holy-api/queue',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'text/plain'},body:JSON.stringify({item})});
 assert.equal(response.status,403,'Queue obeys mutation origin protection');
 response=await fetch(base+'/holy-api/queue',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:JSON.stringify({item})});
 assert.equal((await response.json()).queued,false);
 for(let n=0;n<100;n++)library.toggleQueue({...item,url:item.url+n});
 assert.throws(()=>library.toggleQueue({...item,url:item.url+'overflow'}),/100/);
 library.toggleQueue({...item,url:item.url+0});assert.equal(library.watchQueue.length,99);
 // Use the real bridge menu and switching code, without a live TV.
 const bridge=Object.create(HolyBridge.prototype),drawn=[],navigated=[];
 bridge.library=library;bridge.catalog=catalog;bridge.home='http://localhost/holy/';bridge.homeAliases=[];
 bridge.curtain=async text=>drawn.push(text);bridge.installCurtain=async()=>true;
 bridge.openServer=async(session,url)=>{navigated.push(url);session.target=url;};
 const urls=['https://one.example/player','https://two.example/player'];
 const session=bridge.session={item,key:item.url,position:{t:720,d:3600},target:urls[0],serverChoices:urls,version:'lat',versions:[{id:'lat',kind:'dub',label:'Latino'},{id:'sub',kind:'sub',label:'Subtitulado'}]};
 await bridge.showPauseCard(session);
 assert.deepEqual(session.card.options.map(o=>o.action),['resume','versions','servers']);
 await bridge.chooseCard(session,2);assert.equal(session.card.kind,'servers');assert.equal(session.card.focus,0);
 await bridge.cardInput({key:39});assert.equal(session.card.focus,1);
 await bridge.cardInput({key:13});assert.deepEqual(navigated,[urls[1]]);assert.equal(session.resumeAt,720);assert.equal(session.version,'lat');assert.deepEqual(session.queue,[urls[0]]);
 const before=navigated.length;await bridge.switchServer(session,'https://bad.example');assert.equal(navigated.length,before);
 session.serverChoices=[urls[1]];await bridge.showPauseCard(session);assert.ok(!session.card.options.some(o=>o.action==='servers'),'One server needs no selector');
 // Compile the component's actual yellow-key handler and request, including its feedback.
 const source=readFileSync(new URL('../src/Holy.svelte',import.meta.url),'utf8');
 const body=parse(source,{modern:true}).instance.content.body;
 const pick=name=>{const node=body.find(n=>n.id?.name===name||n.declarations?.some(d=>d.id.name===name));return source.slice(node.start,node.end);};
 const uiCode=[
  'let navigationError="",langSheet=null,sheet=null,inSearch=false,inNav=false,opening=null,keyAt=0,section="inicio",focused=null,notice="",apiBase="http://localhost",calls=[],resets=0,failure=null;',
  'const leavePointer=()=>false; const whyFailed=e=>e.message; const resetTaste=()=>resets++;',
  'const getJSON=async(url,options)=>{calls.push({url,options});if(failure)throw Object.assign(Error(failure),{status:409});return {ok:true,queued:true};};const load=async()=>{notice="";};',
  pick('plainItem'),pick('toggleQueue'),pick('remote'),
  'export async function press(item,repeat=false){focused=item;remote({keyCode:405,repeat,preventDefault(){}});await new Promise(r=>setTimeout(r,0));return {calls,notice,resets};}',
  'export function taste(){section="gustos";} export function fail(message){failure=message;}'
 ].join('\n');
 const compiled=compileModule(uiCode,{filename:'queue.svelte.js',generate:'client',dev:false}).js.code.replace(/from ['"]svelte\/internal\/client['"]/g,'from '+JSON.stringify(import.meta.resolve('svelte/internal/client')));
 const uiPath=join(dir,'ui.mjs');writeFileSync(uiPath,compiled);const ui=await import(pathToFileURL(uiPath).href);
 let state=await ui.press(item);assert.equal(state.calls.length,1);assert.equal(JSON.parse(state.calls[0].options.body).item.title,item.title);assert.match(state.notice,/Agregado/);
 state=await ui.press(item,true);assert.equal(state.calls.length,1,'Holding yellow does not toggle repeatedly');
 state=await ui.press({...item,discover:true});assert.equal(state.calls.length,1,'Discovery placeholders are not titles');
 ui.taste();state=await ui.press(item);assert.equal(state.calls.length,2,'Yellow also queues titles in Gustos');
 state=await ui.press({chip:true});assert.equal(state.resets,1,'Preference reset remains available');
 ui.fail('Tu cola está llena (100 títulos). Quita uno para agregar otro.');state=await ui.press(item);assert.match(state.notice,/100 títulos/,'Real UI keeps the domain error message');
 console.log('Cola: persistencia, series, límite, API protegida y filas. Servidor: menú, idioma, minuto y alternativas correctos (sin TV).');
} finally {if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
