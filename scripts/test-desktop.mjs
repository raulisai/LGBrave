import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {lanAddress, safePath, userDataEnvironment} from './desktop-config.mjs';
import {acquireTVLease, sshCommand} from './tv-lease.mjs';
import {findLumaTarget} from './cdp.mjs';
import {LabRuntime} from './lab-runtime.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
import {HolyBridge} from './holy/holy-bridge.mjs';
import {filterConfiguration, enabledLists} from './filter-engine.mjs';
import {webosTool} from './webos-cli.mjs';

let passed = 0;
const check = async (label, fn) => {await fn(); passed++;};
const interfaces = {'vEthernet (Default Switch)':[{family:'IPv4',address:'192.168.48.1'}],WiFi:[{family:'IPv4',address:'192.168.1.65'}],Loopback:[{family:'IPv4',address:'127.0.0.1',internal:true}]};
await check('Missing Windows user-data variables use this user profile',()=>{
 const env=userDataEnvironment({},'win32','C:/Users/test-owner');
 assert.equal(env.APPDATA,join('C:/Users/test-owner','AppData','Roaming'));
 assert.equal(env.LOCALAPPDATA,join('C:/Users/test-owner','AppData','Local'));
 assert.equal(env.USERPROFILE,'C:/Users/test-owner');
});
await check('Explicit redirected Windows directories are retained',()=>{
 const original={USERPROFILE:'D:/owner',APPDATA:'D:/roaming',LOCALAPPDATA:'D:/local',OTHER:'keep'};
 assert.deepEqual(userDataEnvironment(original,'win32','C:/fallback'),original);
});
await check('macOS environment is kept intact',()=>{
 const original={HOME:'/Users/test-owner'};
 assert.deepEqual(userDataEnvironment(original,'darwin','/Users/test-owner'),original);
});
await check('Select real LAN adapter rather than a virtual Windows switch', () => assert.equal(lanAddress(interfaces,{tvIp:'192.168.1.134'}),'192.168.1.65'));
await check('Explicit host overrides auto detection', () => assert.equal(lanAddress(interfaces,{host:'192.168.1.9'}),'192.168.1.9'));
await check('Static paths work on Windows and cannot leave the build', () => {
  assert.equal(safePath('dist','../package.json'),null);
  assert.ok(safePath('dist','assets/main.js').endsWith(join('assets','main.js')));
});
await check('CLI uses a JS entry point instead of an OS-specific shim', () => assert.ok(webosTool('ares-launch').endsWith(join('bin','ares-launch.js'))));
await check('The cloned project has usable lists before its first download', () => {
  assert.ok(enabledLists().length >= 2,JSON.stringify(filterConfiguration()));
});
await check('An SSH lease operation times out and closes its channel', async () => {
  const channel = new EventEmitter(); let closed=0; channel.close=()=>{closed++;};
  await assert.rejects(sshCommand({exec:(_command,done)=>done(null,channel)},'ignored',20),/reserva/);
  assert.equal(closed,1);
});
await check('SSH channel errors do not leave unhandled errors', async () => {
  const channel = new EventEmitter(); channel.close=()=>{};
  const result = sshCommand({exec:(_command,done)=>{done(null,channel);queueMicrotask(()=>channel.emit('error',Error('desconectada')));}},'ignored');
  await assert.rejects(result,/desconectada/);
});
await check('A busy TV refuses a second computer', async () => {
  await assert.rejects(acquireTVLease(null,{run:async text=>text.includes('echo checked')?'checked':'busy'}),error=>error.code==='TV_BUSY');
});
await check('Lost renewal ends the lease before another owner can take it', async () => {
  let calls=0,lost=0;
  const lease=await acquireTVLease(null,{interval:10,onLost:()=>{lost++;},run:async()=>++calls===1?'acquired':'lost'});
  // Keep the test alive; the production renewal timer is intentionally unref'd.
  await Promise.race([lease.lost,new Promise((_,reject)=>setTimeout(()=>reject(Error('No se perdió la reserva')),150))]);
  assert.equal(lost,1); await lease.release();
});
await check('Releasing a lease stops heartbeat renewals', async () => {
  let count=0;
  const lease=await acquireTVLease(null,{interval:10,run:async command=>{count++;return command.includes('echo released')?'released':'acquired';}});
  await lease.release(); const before=count; await new Promise(r=>setTimeout(r,30)); assert.equal(count,before);
});
await check('One runtime selects Holy first, falls back to Luma and preserves passive behavior', async () => {
  let targets=[{id:'h',description:'com.lgapp.holy'},{id:'l',description:'com.lgapp.lab'}],closed=0;
  const apps=[];
  const runtime=new LabRuntime({log:()=>{},selectTarget:list=>findLumaTarget(list,'com.lgapp.holy')||findLumaTarget(list),
    openTunnel:async()=>({endpoint:'fake',close(){}}),targets:async()=>targets,
    connect:async(_endpoint,id)=>({target:targets.find(t=>t.description===id),close:()=>{closed++;}}),
    makeBridge:(_cdp,options)=>({async start(){apps.push(options.target.description);},async status(){},async stop(){}})});
  try {
    await runtime.step(); targets=[targets[1]];await runtime.step();targets=[];await runtime.step();
    assert.deepEqual(apps,['com.lgapp.holy','com.lgapp.lab']);assert.equal(closed,2);assert.equal(runtime.state,'waiting');
  } finally {await runtime.close();}
});
await check('Standby computer takes over after the first disconnects', async () => {
  let owner=null;const attached=[];
  const make=id=>new LabRuntime({log:()=>{},openTunnel:async()=>{
    if(owner){const e=Error('ocupada');e.code='TV_BUSY';throw e;} owner=id;return{endpoint:'fake',close:()=>{if(owner===id)owner=null;}};
  },targets:async()=>[{id:'l',description:'com.lgapp.lab'}],connect:async()=>({target:{id:'l'},close(){}}),
    makeBridge:()=>({async start(){attached.push(id);},async status(){},async stop(){}})});
  const mac=make('mac'),pc=make('windows');
  try{await mac.step();await pc.step();assert.equal(pc.state,'standby');assert.deepEqual(attached,['mac']);await mac.close();await pc.step();assert.deepEqual(attached,['mac','windows']);}
  finally{await mac.close();await pc.close();}
});
await check('Luma and Holy retain distinct homes in the same Node process', () => {
  const dir=mkdtempSync(join(tmpdir(),'luma-homes-'));
  try {
    const luma=new BrowserBridge({}, {lists:false,preferencesFile:join(dir,'luma.json')});
    const holy=new HolyBridge({}, {lists:false,preferencesFile:join(dir,'holy.json')});
    assert.ok(luma.home.endsWith('/luma-home/'));assert.ok(holy.home.endsWith('/holy/'));
    assert.ok(luma.packagedHome.includes('/com.lgapp.lab/'));assert.ok(holy.packagedHome.includes('/com.lgapp.holy/'));
    assert.ok(holy.isHome('http://192.168.1.148:43190/holy/#episodes=test'));
    assert.equal(holy.isHome('https://evil.example:43190/holy/'),false);
    assert.equal(holy.isHome('http://192.168.1.148:43190/player/'),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

await check('A lost lease is retired once even when release is requested repeatedly',async()=>{
 let commands=0,releases=0;
 const lease=await acquireTVLease(null,{interval:5,run:async command=>{
  if(command.includes('echo released')){releases++;return 'released';}
  return ++commands===1?'acquired':'lost';
 }});
 let timer;try{await Promise.race([lease.lost,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Heartbeat no terminó')),500);})]);}finally{clearTimeout(timer)}
 await Promise.all([lease.release(),lease.release()]);assert.equal(releases,1);assert.throws(()=>lease.assertActive(),/vigente/);
});

await check('A hung renewal cannot hold the lease past its watchdog',async()=>{
 let releases=0;
 const lease=await acquireTVLease(null,{interval:5,activeFor:30,run:command=>{
  if(command.includes('echo released')){releases++;return Promise.resolve('released');}
  if(command.includes('echo acquired'))return Promise.resolve('acquired');
  return new Promise(()=>{});
 }});
 let timer;try{await Promise.race([lease.lost,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Watchdog no terminó')),500);})]);}finally{clearTimeout(timer)}
 assert.throws(()=>lease.assertActive(),/vigente/);await lease.release();assert.equal(releases,1);
});

await check('A renewal acknowledged after clock expiry cannot resurrect a suspended computer',async()=>{
 let now=0,renewal,notified=0;
 const lease=await acquireTVLease(null,{interval:5,clock:()=>now,onLost:()=>{notified++;throw Error('Consumer error');},run:command=>{
  if(command.includes('echo released'))return Promise.resolve('released');
  if(command.includes('echo acquired'))return Promise.resolve('acquired');
  return new Promise(resolve=>{renewal=resolve;});
 }});
 try{
  await new Promise(r=>setTimeout(r,15));assert.equal(typeof renewal,'function');
  now=16000;renewal('renewed');await new Promise(r=>setImmediate(r));
  assert.equal(notified,1);assert.throws(()=>lease.assertActive(),/vigente/);
 }finally{await lease.release()}
});

await check('A channel received after SSH timeout still has a safe error handler',async()=>{
 let arrive;
 await assert.rejects(sshCommand({exec:(_command,done)=>{arrive=done;}},'ignored',10),/reserva/);
 const channel=new EventEmitter();let closes=0;channel.close=()=>{closes++;};
 arrive(null,channel);assert.equal(closes,1);assert.doesNotThrow(()=>channel.emit('error',Error('Late transport error')));
});

await check('Transport closure rejects an SSH operation without waiting for timeout',async()=>{
 const ssh=new EventEmitter(),channel=new EventEmitter();channel.close=()=>{};
 ssh.exec=(_command,done)=>done(null,channel);
 const result=sshCommand(ssh,'ignored',1000);ssh.emit('close');
 await assert.rejects(result,/cerró/);assert.equal(ssh.listenerCount('close'),0);
});

await check('Synchronous SSH failures settle safely',async()=>{
 await assert.rejects(sshCommand({exec(){throw Error('Synchronous failure');}},'ignored',10),/Synchronous failure/);
});
console.log(`${passed} comprobaciones de Windows, perfiles, reserva, relevo y ambos navegadores correctas (sin TV).`);
