import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {LabRuntime} from './lab-runtime.mjs';
import {openInspectorTunnel} from './inspector-tunnel.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {findLumaTarget, connectTV} from './cdp.mjs';
import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';

let passed = 0;
const check = async (name,fn) => { await fn(); passed++; };
const luma = id => ({id,description:'com.lgapp.lab',url:'https://example.com/'});
const pluto = {id:'pluto',description:'tv.pluto',url:'https://pluto.tv/'};
let current = [pluto], offline = false;
const calls = [];
const connections = [];
const runtime = new LabRuntime({
 log:()=>{},
 openTunnel:async()=>({endpoint:'http://127.0.0.1:1234',close:()=>calls.push('tunnel-close')}),
 targets:async()=>{ if(offline)throw Error('TV apagada');return current; },
 connect:async()=>{
  let resolve; const c={target:current.find(t=>t.description==='com.lgapp.lab'),closed:new Promise(r=>{resolve=r}),
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
  assert.equal(findLumaTarget([{...pluto,url:'https://example.com/com.lgapp.lab/'}]),undefined);
  assert.equal(findLumaTarget([{...pluto,url:'file:///media/developer/apps/usr/palm/applications/com.lgapp.lab/index.html'}]),undefined);
  assert.ok(findLumaTarget([{id:'file',url:'file:///media/developer/apps/usr/palm/applications/com.lgapp.lab/index.html'}]));
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

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
const turn = () => new Promise(r => setImmediate(r));
const limit = (promise, ms=500) => {
 let timer; return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('La operación local no terminó')),ms);})]).finally(()=>clearTimeout(timer));
};

await check('Overlapping polls share one tunnel and one bridge',async()=>{
 const opening=deferred();let tunnels=0,starts=0;
 const lab=new LabRuntime({log:()=>{},openTunnel:()=>{tunnels++;return opening.promise;},targets:async()=>[luma('one')],
  connect:async()=>({target:luma('one'),close(){}}),makeBridge:()=>({async start(){starts++;},async stop(){}})});
 try{
  const first=lab.step(),second=lab.step();assert.equal(tunnels,1);
  opening.resolve({endpoint:'fake',close(){}});await Promise.all([first,second]);
  assert.equal(starts,1);assert.equal(lab.state,'connected');
 }finally{await lab.close()}
});

await check('A lost tunnel during target discovery cannot attach a late target',async()=>{
 const discovering=deferred(),lost=deferred();let connections=0;
 const lab=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'fake',closed:lost.promise,close(){}}),
  targets:()=>discovering.promise,connect:async()=>{connections++;throw Error('Late connection');}});
 try{
  const step=lab.step();await turn();lost.resolve();await turn();
  discovering.resolve([luma('late')]);await step;
  assert.equal(connections,0);assert.equal(lab.state,'offline');assert.equal(lab.tunnel,null);
 }finally{await lab.close()}
});

await check('A handshake finishing after lease loss is closed without starting a bridge',async()=>{
 const handshake=deferred(),lost=deferred();let socketsClosed=0,starts=0;
 const lab=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'fake',closed:lost.promise,close(){}}),
  targets:async()=>[luma('late')],connect:()=>handshake.promise,makeBridge:()=>{starts++;throw Error('Late bridge');}});
 try{
  const step=lab.step();await turn();lost.resolve();await turn();
  handshake.resolve({target:luma('late'),close(){socketsClosed++;}});await step;
  assert.equal(starts,0);assert.equal(socketsClosed,1);assert.equal(lab.state,'offline');
 }finally{await lab.close()}
});

await check('A bridge completing startup after shutdown cannot restore connected status',async()=>{
 const starting=deferred();let stops=0,closes=0;
 const lab=new LabRuntime({log:()=>{},openTunnel:async()=>({endpoint:'fake',close(){}}),targets:async()=>[luma('late')],
  connect:async()=>({target:luma('late'),close(){closes++;}}),
  makeBridge:()=>({start:()=>starting.promise,async stop(){stops++;}})});
 const step=lab.step();await turn();await lab.close();starting.resolve();await step;
 assert.ok(stops>=1);assert.ok(closes>=1);assert.notEqual(lab.state,'connected');assert.equal(lab.bridge,null);
});

await check('SSH loss while a lease is being acquired rejects and retires the late lease',async()=>{
 const ssh=new EventEmitter(),acquired=deferred(),lost=deferred();let ends=0,releases=0,released=false;
 ssh.end=()=>{ends++;};
 const result=openInspectorTunnel({connect:async()=>({ssh}),reserve:true,acquireLease:()=>acquired.promise,command:async()=>{throw Error('No inspector query after loss');}});
 await turn();ssh.emit('close');await turn();
 acquired.resolve({lost:lost.promise,assertActive(){},async release(){if(!released){released=true;releases++;}}});
 await assert.rejects(limit(result),/cerró/);assert.equal(ends,1);assert.equal(releases,1);
});

await check('An occupied inspector retires the new reservation and leaves that inspector untouched',async()=>{
 const ssh=new EventEmitter(),lost=deferred();let ends=0,releases=0;
 ssh.end=()=>{ends++;};
 await assert.rejects(openInspectorTunnel({connect:async()=>({ssh}),reserve:true,
  acquireLease:async()=>({lost:lost.promise,assertActive(){},release(){releases++;}}),command:async()=> '2'}),
  error=>error.code==='TV_BUSY');
 assert.equal(ends,1);assert.ok(releases>=1);
});

await check('Forwarded sockets delivered after tunnel shutdown are destroyed',async()=>{
 const ssh=new EventEmitter(),forwarded=deferred();let finishForward;
 ssh.forwardOut=(...args)=>{finishForward=args.at(-1);forwarded.resolve();};
 ssh.end=()=>{};
 const tunnel=await openInspectorTunnel({connect:async()=>({ssh})});
 const socket=net.connect(Number(new URL(tunnel.endpoint).port),'127.0.0.1');socket.on('error',()=>{});
 try{
  await limit(forwarded.promise);await tunnel.close();
  const remote=new net.Socket();finishForward(null,remote);assert.equal(remote.destroyed,true);
 }finally{socket.destroy();await tunnel.close()}
});

await check('CDP uses the tunnel authority, handles bad messages and rejects outstanding requests',async()=>{
 const server=http.createServer((_req,res)=>{
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify([{...luma('cdp'),webSocketDebuggerUrl:'ws://127.0.0.1:1/devtools/page/cdp?test=1'}]));
 });
 const sockets=new WebSocketServer({server});let peer,requestPath;
 sockets.on('connection',(socket,req)=>{peer=socket;requestPath=req.url;socket.on('message',bytes=>{
  const message=JSON.parse(bytes);if(message.method==='echo')socket.send(JSON.stringify({id:message.id,result:{ok:true}}));
  if(message.method==='malformed')socket.send('broken json');
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let cdp;
 try{
  cdp=await connectTV('http://127.0.0.1:'+server.address().port);assert.equal(requestPath,'/devtools/page/cdp?test=1');
  assert.deepEqual(await cdp.call('echo'),{ok:true});
  await assert.rejects(cdp.call('malformed'),/inválido/);await limit(cdp.closed);
  await assert.rejects(cdp.call('echo'),/cerrada/);
 }finally{cdp?.close();peer?.terminate();await new Promise(r=>sockets.close(r));server.closeAllConnections();await new Promise(r=>server.close(r))}
});

await check('CDP closes immediately when its reservation guard fails',async()=>{
 const server=http.createServer((_req,res)=>res.end(JSON.stringify([{...luma('guard'),webSocketDebuggerUrl:'ws://localhost:9998/devtools/page/guard'}])));
 const sockets=new WebSocketServer({server});let peer,valid=true;
 sockets.on('connection',socket=>{peer=socket;});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let cdp;
 try{
  cdp=await connectTV('http://127.0.0.1:'+server.address().port,'com.lgapp.lab',{guard:()=>{if(!valid)throw Error('Reserva perdida');}});
  valid=false;await assert.rejects(cdp.call('ignored'),/Reserva perdida/);await limit(cdp.closed);
 }finally{cdp?.close();peer?.terminate();await new Promise(r=>sockets.close(r));server.closeAllConnections();await new Promise(r=>server.close(r))}
});

await check('Concurrent processes reclaim stale legacy and directory locks without two owners',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'luma-lock-race-'));
 const moduleUrl=new URL('./runtime-lock.mjs',import.meta.url).href;
 const worker=`
  import {acquireRuntimeLock} from ${JSON.stringify(moduleUrl)};
  let release;
  process.on('message',message=>{
   if(message==='go'){
    try{release=acquireRuntimeLock(process.argv[1]);process.send({owned:true});}
    catch(error){process.send({owned:false,error:error.message,stack:error.stack},()=>process.exit(0));}
   }else if(message==='release'){release?.();process.exit(0);}
  });
  process.send({ready:true});
 `;
 try{
  for(let round=0;round<4;round++){
   const file=join(dir,'runtime-'+round+'.lock');
   if(round%2===0)writeFileSync(file,JSON.stringify({pid:2147483647,token:'old'}));
   else{
    const token='00000000-0000-4000-8000-000000000000';
    mkdirSync(file);writeFileSync(join(file,token+'.json'),JSON.stringify({pid:2147483647,token}));
   }
   const workers=[],results=[],owners=new Set();let ready=0;
   const finished=new Promise((resolve,reject)=>{
    let exited=0;
    for(let i=0;i<6;i++){
     const child=spawn(process.execPath,['--input-type=module','-e',worker,file],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
     workers.push(child);let stderr='';
     child.stderr.on('data',chunk=>{stderr+=chunk;});
     child.on('error',reject);
     child.on('message',message=>{
      if(message.ready){if(++ready===6)for(const peer of workers)peer.send('go');return;}
      results.push(message);if(message.owned)owners.add(child);
      if(results.length===6)for(const peer of owners)peer.send('release',error=>{if(error)reject(error);});
     });
     child.on('exit',code=>{
      if(code!==0)reject(Error('Proceso de bloqueo falló: '+stderr));
      if(++exited===6)resolve();
     });
    }
   });
   try{await limit(finished,10000);}
   finally{for(const child of workers)if(child.exitCode===null)child.kill();}
   assert.equal(results.length,6);assert.equal(results.filter(result=>result.owned).length,1,JSON.stringify(results));
   assert.ok(results.filter(result=>!result.owned).every(result=>/activo|única/.test(result.error)),JSON.stringify(results));
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
});
console.log(`${passed} comprobaciones de conexión pasiva, apagado, otras apps, túnel y exclusión mutua correctas.`);
