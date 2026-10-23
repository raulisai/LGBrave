import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {LabRuntime} from './lab-runtime.mjs';
import {openInspectorTunnel} from './inspector-tunnel.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {findLumaTarget} from './cdp.mjs';

let passed = 0;
const check = async (name,fn) => { await fn(); passed++; };
const luma = id => ({id,description:'com.lgapp.holy',url:'https://example.com/'});
const pluto = {id:'pluto',description:'tv.pluto',url:'https://pluto.tv/'};
let current = [pluto], offline = false;
const calls = [];
const connections = [];
const runtime = new LabRuntime({
 log:()=>{},
 openTunnel:async()=>({endpoint:'http://127.0.0.1:1234',close:()=>calls.push('tunnel-close')}),
 targets:async()=>{ if(offline)throw Error('TV apagada');return current; },
 connect:async()=>{
  let resolve; const c={target:current.find(t=>t.description==='com.lgapp.holy'),closed:new Promise(r=>{resolve=r}),
   close(){calls.push('cdp-close');resolve()}, call(){throw Error('Must not navigate, launch, activate or focus')}};
  connections.push(c);calls.push('connect');return c;
 },
 makeBridge:()=>({start:async()=>calls.push('start'),status:async()=>calls.push('status'),stop:async()=>calls.push('stop'),command:()=>{throw Error('Must preserve the user page')}})
});
try {
 await check('Other apps and an empty TV never cause a connection to Luma',async()=>{
  for(let n=0;n<30;n++)await runtime.step();current=[];await runtime.step();
  assert.deepEqual(calls,[]);assert.equal(runtime.state,'waiting');
 });
 await check('Attach only after the Luma target appears, without navigation',async()=>{
  current=[pluto,luma('one')];await runtime.step();await runtime.step();
  assert.deepEqual(calls,['connect','start','status']);
 });
 await check('Closing Luma and using Pluto detaches and stays idle',async()=>{
  current=[pluto];await runtime.step();const size=calls.length;
  for(let n=0;n<20;n++)await runtime.step();
  assert.equal(calls.length,size);assert.equal(runtime.state,'waiting');assert.ok(calls.includes('stop'));
 });
 await check('Power off/on and a different foreground app never launch Luma',async()=>{
  offline=true;await runtime.step();assert.equal(runtime.state,'offline');
  offline=false;current=[pluto];await runtime.step();assert.equal(runtime.state,'waiting');
  assert.equal(calls.filter(x=>x==='connect').length,1);
 });
 await check('A manually reopened app and a lost CDP socket can reconnect passively',async()=>{
  current=[luma('two')];await runtime.step();connections.at(-1).close();await Promise.resolve();await runtime.step();
  assert.equal(calls.filter(x=>x==='connect').length,3);assert.equal(runtime.state,'connected');
 });
 await check('Switching target instances reconnects without issuing application commands',async()=>{
  current=[luma('three')];await runtime.step();assert.equal(calls.filter(x=>x==='connect').length,4);
 });
 await check('Other apps cannot match by a coincidental URL path',()=>{
  assert.equal(findLumaTarget([{...pluto,url:'https://example.com/com.lgapp.holy/'}]),undefined);
  assert.equal(findLumaTarget([{...pluto,url:'file:///media/developer/apps/usr/palm/applications/com.lgapp.holy/index.html'}]),undefined);
  assert.ok(findLumaTarget([{id:'file',url:'file:///media/developer/apps/usr/palm/applications/com.lgapp.holy/index.html'}]));
 });
 await check('Stopping the runtime prevents further connections',async()=>{
  await runtime.close();const size=calls.length;await runtime.step();assert.equal(calls.length,size);
 });
}finally{await runtime.close()}

await check('Closing during SSH startup does not attach after the connection arrives',async()=>{
 let complete,closed=0,attached=0;
 const pending=new LabRuntime({log:()=>{},openTunnel:()=>new Promise(r=>complete=r),targets:async()=>{attached++;return[luma('late')]}});
 const step=pending.step();await pending.close();complete({endpoint:'unused',close:()=>closed++});await step;
 assert.equal(closed,1);assert.equal(attached,0);
});

await check('Closing during target discovery does not attach afterwards',async()=>{
 let deliver,attached=0;
 const pending=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'unused',close(){}}),targets:()=>new Promise(r=>deliver=r),connect:async()=>{attached++;throw Error('Must not connect')}});
 const step=pending.step();await new Promise(r=>setImmediate(r));await pending.close();deliver([luma('late')]);await step;assert.equal(attached,0);
});

await check('A WebSocket that finishes connecting after shutdown is immediately closed',async()=>{
 let deliver,started=0,closed=0;
 const pending=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'unused',close(){}}),targets:async()=>[luma('late')],connect:()=>new Promise(r=>deliver=r),makeBridge:()=>{started++;throw Error('Must not start')}});
 const step=pending.step();await new Promise(r=>setImmediate(r));await pending.close();deliver({target:luma('late'),close(){closed++}});await step;
 assert.equal(started,0);assert.equal(closed,1);
});

await check('Real local tunnel forwards only to 9998, with no command or launch channel',async()=>{
 const ssh=new EventEmitter();let ends=0;const forwards=[];
 const server=http.createServer((req,res)=>res.end('[]'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 ssh.forwardOut=(src,port,host,destination,cb)=>{
  forwards.push({src,host,destination});const socket=net.connect(server.address().port,'127.0.0.1');
  socket.once('connect',()=>cb(null,socket));socket.on('error',()=>{});
 };
 ssh.end=()=>{ends++;ssh.emit('close')};
 const session={ssh,run(){throw Error('No remote commands permitted')}};
 let tunnel;
 try{
  tunnel=await openInspectorTunnel({connect:async()=>session});assert.ok(tunnel.endpoint.startsWith('http://127.0.0.1:'));
  assert.deepEqual(await(await fetch(tunnel.endpoint+'/json')).json(),[]);
  assert.deepEqual(forwards,[{src:'127.0.0.1',host:'127.0.0.1',destination:9998}]);
  ssh.emit('close');await tunnel.closed;assert.equal(ends,1);
 }finally{tunnel?.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
});

await check('Only one runtime may own the workspace lock',()=>{
 const dir=mkdtempSync(join(tmpdir(),'luma-runtime-'));const file=join(dir,'runtime.lock');
 try{const release=acquireRuntimeLock(file);assert.throws(()=>acquireRuntimeLock(file),/activo/);release();const release2=acquireRuntimeLock(file);release2();
  writeFileSync(file,JSON.stringify({pid:2147483647,token:'stale'}));const release3=acquireRuntimeLock(file);release3();
 }finally{rmSync(dir,{recursive:true,force:true})}
});
await check('Tabs survive a dropped socket for the same app instance and reset for a new instance',async()=>{
 let target=luma('tabs-one');const bridges=[],connections=[];
 const lab=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'unused',close(){}}),targets:async()=>target?[target]:[],
  connect:async()=>{let resolve;const connection={target,closed:new Promise(r=>resolve=r),close(){resolve()}};connections.push(connection);return connection},
  makeBridge:(_cdp,options)=>{const bridge={tabs:options.tabs||{items:[],managed:true},async start(){},async stop(){},async status(){}};bridges.push(bridge);return bridge}
 });
 try{
  await lab.step();bridges[0].tabs.items.push({id:'one'});
  connections.at(-1).close();await Promise.resolve();await lab.step();
  assert.equal(bridges[1].tabs,bridges[0].tabs);
  assert.equal(bridges[1].tabs.items.length,1);
  target=luma('tabs-two');await lab.step();assert.notEqual(bridges[2].tabs,bridges[1].tabs);
  assert.equal(bridges[2].tabs.items.length,0);
  target=null;await lab.step();assert.equal(lab.sessionTabs,null);
 }finally{await lab.close()}
});
console.log(`${passed} comprobaciones de conexión pasiva, apagado, otras apps, túnel y exclusión mutua correctas.`);
