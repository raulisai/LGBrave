import assert from 'node:assert/strict';
import vm from 'node:vm';
import { playerSafetySource } from './holy/player-safety.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { LabRuntime } from './lab-runtime.mjs';
import { createDoctor } from './holy/doctor.mjs';
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name); };
const fixture = href => {
  const calls = [];
  const window = { close: () => calls.push('close'), open: () => calls.push('open') };
  const context = {window, document:{documentElement:{dataset:{}}}, URL, location:new URL(href)};
  const source = playerSafetySource(['http://192.168.1.65:43190/holy/','file:///holy/index.html']);
  vm.runInNewContext(source, context);
  return {window,context,source,calls};
};
await check('Amadeus y Dragon Ball: scripts no cierran la app ni abren ventanas, tampoco al reasignar las funciones', () => {
  for(const host of ['tungtungsahur.cuevana3c.pro','jkanime.net','embed.example']) {
    const f=fixture('https://'+host+'/player');
    const close=f.window.close; f.window.close=()=>f.calls.push('bypass'); close(); f.window.close();
    f.window.open('about:blank','_self'); f.window.open=()=>f.calls.push('bypass'); f.window.open();
    assert.deepEqual(f.calls,[]); assert.equal(f.window.__holyPlayerSafety.blockedCloses,2);
    vm.runInNewContext(f.source,f.context); assert.equal(f.window.__holyPlayerSafety.blockedCloses,2);
    assert.throws(()=>Object.defineProperty(f.window,'close',{value:()=>{}}));
  }
});
await check('Inicio propio y verificación humana conservan sus funciones', () => {
  for(const url of ['http://192.168.1.65:43190/holy/','http://192.168.1.148:43190/holy/','file:///holy/index.html','https://challenges.cloudflare.com/check']) {
    const f=fixture(url); f.window.close();f.window.open();assert.deepEqual(f.calls,['close','open']);
  }
});
await check('YouTube oficial conserva controles y enlaces; sin exención para imitaciones ni páginas watch', () => {
  for(const url of ['https://www.youtube-nocookie.com/embed/aaaaaaaaaa2?autoplay=1','https://www.youtube.com/embed/aaaaaaaaaa2']) {
    const f=fixture(url);f.window.open();f.window.close();assert.deepEqual(f.calls,['open','close']);
  }
  for(const url of ['https://www.youtube-nocookie.com.evil/embed/aaaaaaaaaa2','https://www.youtube.com/watch?v=aaaaaaaaaa2','https://www.youtube.com/embed/bad']) {
    const f=fixture(url);f.window.open();f.window.close();assert.deepEqual(f.calls,[]);
  }
});
await check('La protección no toca vídeo, pausa, ubicación ni controles del usuario', () => {
  const f=fixture('https://embed.example/play');
  assert.equal(f.context.location.href,'https://embed.example/play');
  assert.equal(Object.keys(f.window).includes('video'),false);
  assert.equal(Object.getOwnPropertyDescriptor(f.window,'close').configurable,false);
});
await check('Cierre raíz conserva motivo, segundo y un solo incidente; cierre de iframe no se atribuye a toda la app', async () => {
  const b=Object.create(HolyBridge.prototype), rows=[];
  b.session={item:{title:'Amadeus'},position:{t:7052}};b.cdp={target:{id:'root'}};b.recordPlayback=(...args)=>rows.push(args);
  b.childSessions=new Map();b.remoteContexts=new Set();b.uiContexts=new Set();b.diagnostics={event(){}};b.errors=[];
  await b.event({method:'Inspector.detached',params:{reason:'target_closed'},sessionId:'iframe'});
  assert.equal(rows.length,0);
  await b.event({method:'Inspector.detached',params:{reason:'target_closed'}});
  await b.event({method:'Inspector.detached',params:{reason:'target_closed'}});
  assert.equal(rows.length,1);assert.equal(rows[0][2].reason,'target_closed');assert.equal(b.lastPlaybackIncident.position,7052);
  b.session.disconnected=false;await b.event({method:'Inspector.detached'});assert.equal(rows.at(-1)[2].reason,'Inspector.detached');
});
await check('Iframe en target separado recibe guardia al aparecer y antes de su próxima navegación', async () => {
  const calls=[],b=Object.create(HolyBridge.prototype);
  b.childSessions=new Map([['child',{contexts:new Set(),enabled:false}]]);b.pageContexts=()=>[];
  b.home='http://192.168.1.65:43190/holy/';b.packagedHome='file:///holy/index.html';
  b.cdp={call:async(method,params,session)=>{calls.push({method,params,session});return {identifier:'safe-child'}}};
  await b.playerContexts();
  assert.equal(calls[0].method,'Page.addScriptToEvaluateOnNewDocument');assert.equal(calls[0].session,'child');
  await b.event({method:'Runtime.executionContextCreated',sessionId:'child',params:{context:{id:7,auxData:{isDefault:true}}}});
  assert.equal(calls.at(-1).method,'Runtime.evaluate');assert.equal(calls.at(-1).params.contextId,7);
  assert.match(calls.at(-1).params.expression,/holyPlayerSafety/);
});
await check('Reinicio del puente conserva incidente para Doctor sin navegar ni relanzar la TV', async () => {
  const incident={at:Date.now(),title:'Amadeus',reason:'target_closed',position:7052};
  const runtime=new LabRuntime({log(){}});runtime.bridge={lastPlaybackIncident:incident,async stop(){}};
  await runtime.detach();assert.deepEqual(runtime.lastPlaybackIncident,incident);
  runtime.state='connected'; let restarts=0;
  const d=createDoctor({runtime,catalog:{items:[{}],updatedAt:Date.now(),sources:()=>[]},library:{entries:[]},startedAddress:'x',currentAddress:()=> 'x',probe:async()=>true,supervised:true,rss:()=>1e8,restart:()=>restarts++,diskFree:()=>10*1024**3});
  const report=await d.diagnose();assert.equal(report.checks.find(c=>c.id==='player-exit').fix,null);
  await d.prescribe();assert.equal(restarts,0);
});
console.log(passed+' regresiones de cierre de reproductor correctas (controladas, sin TV).');
