import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createDoctor} from './holy/doctor.mjs';
import {repairPlan,profileMismatch} from '../desktop/shared/repair-policy.mjs';
import {RepairJournal} from '../desktop/shared/repair-journal.mjs';
import {createRepairMonitor} from '../desktop/shared/repair-monitor.mjs';
import {createDesktopRepair} from '../desktop/shared/desktop-repair.mjs';
import {createProfileRecovery} from '../desktop/shared/profile-recovery.mjs';
import {userDataContext,ROOT} from './desktop-config.mjs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-doctor-coverage-'));
const good={state:'setup',running:true,tv:{configured:true,needsUpdate:false},tvReachable:true};
const auth={registry:'ok',profilePresent:true,keyPresent:true};
let passed=0;
const test=async(name,fn)=>{await fn();passed++;};
const idle=ms=>new Promise(r=>setTimeout(r,ms));
const fakeRecovery={restore:()=>({restored:false}),capture(){},keyPresent:()=>true,inspect:()=>auth};
try{
 await test('Taxonomy and healthy/owner guards',()=>{
  for(const [report,inspection,code,action] of [
   [{...good,state:'connected'},auth,'healthy',null],
   [{...good,state:'standby'},auth,'other-owner',null],
   [{...good,state:'starting'},auth,'service-starting',null],
   [{...good,state:'conflict'},auth,'local-conflict',null],
   [good,{...auth,registry:'unreadable'},'registry-unreadable',null],
   [{...good,tv:{configured:true,needsUpdate:true}},auth,'tv-address-mismatch',null],
   [{...good,tv:{configured:false}},{...auth,keyPresent:false},'authorization-missing',null],
   [{...good,state:'stopped',running:false},auth,'service-stopped','start'],
   [{...good,repairNeeded:true},auth,'profile-context-mismatch','restart'],
   [{...good,state:'unresponsive'},auth,'service-unresponsive','restart'],
   [{...good,state:'error'},auth,'service-error','restart'],
   [{...good,state:'offline',tvReachable:false},auth,'tv-unreachable',null],
   [{...good,state:'waiting'},auth,'app-not-open',null],
   [{...good,state:'offline'},auth,'connection-retry','wake']
  ]){const value=repairPlan(report,inspection);assert.equal(value.code,code);assert.equal(value.action,action);}
  assert.equal(repairPlan({...good,state:'connected',profileContext:{mismatch:true}},auth).action,null);
 });
 await test('Process context is comparable without paths or secrets',()=>{
  const a=userDataContext({env:{HOME:'C:/owner',LOCALAPPDATA:'C:/local'},registry:{file:'C:/roaming/devices.json'},platform:'win32'});
  const same=userDataContext({env:{HOME:'c:/OWNER',LOCALAPPDATA:'c:/LOCAL'},registry:{file:'c:/ROAMING/devices.json'},platform:'win32'});
  const other=userDataContext({env:{HOME:'C:/wrong',LOCALAPPDATA:'C:/wrong'},registry:{file:'C:/wrong/devices.json'},platform:'win32'});
  assert.deepEqual(a,same);assert.notEqual(a.id,other.id);assert.match(a.id,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(a).includes('owner'));
  assert.equal(profileMismatch({state:'setup',tv:{configured:false}},a,{configured:true}),true);
  assert.equal(profileMismatch({state:'setup',context:other},a,{configured:true}),true);
 });
 await test('Budget survives repeated CLI instances, limits restart storms and fails closed',()=>{
  let now=1000;const file=join(dir,'budget.json');
  const run=()=>new RepairJournal({file,now:()=>now});
  assert.equal(run().reserve('restart','profile-context-mismatch').allowed,true);
  now+=1000;assert.equal(run().reserve('restart','profile-context-mismatch').reason,'cooldown');
  now=32000;assert.equal(run().reserve('restart','service-error').allowed,true);
  now=153000;assert.equal(run().reserve('restart','service-unresponsive').allowed,true);
  now=500000;assert.equal(run().reserve('restart','service-error').allowed,false);
  now=602000;assert.equal(run().reserve('restart','service-error').allowed,true);
  assert.equal(run().reserve('erase-keys','bad').allowed,false);
  writeFileSync(file,'invalid');assert.equal(run().reserve('restart','service-error').reason,'journal-unavailable');
  assert.equal(readFileSync(file,'utf8'),'invalid');
 });
 await test('Repair is deduplicated and only called verified after a real status transition',async()=>{
  let state={...good},restarts=0,probes=0;
  const fix=createDesktopRepair({status:async()=>{if(restarts&&++probes===3)state={...good,state:'connected'};return state;},
   recovery:fakeRecovery,start:async()=>{},restart:async()=>{restarts++;state={...good,state:'starting'};},wait:async()=>{},verifyAttempts:5});
  const first=fix(),second=fix();assert.equal(first,second);
  const result=await first;assert.equal(restarts,1);assert.equal(result.repair.verified,true);assert.equal(result.repair.outcome,'verified');
  await fix();assert.equal(restarts,1);
 });
 await test('Pending repair, unreachable TV and standby do not claim success',async()=>{
  let state={...good},restarts=0,restores=0;
  const recovery={...fakeRecovery,restore(){restores++;return{};}};
  const fix=createDesktopRepair({status:async()=>state,recovery,start:async()=>{},restart:async()=>{restarts++;state={...good,state:'starting'};},verifyAttempts:0});
  assert.equal((await fix()).repair.outcome,'pending');
  state={...good,state:'offline',tvReachable:false};const off=await fix();assert.equal(off.repair.waiting,true);assert.equal(off.repair.verified,false);assert.equal(restarts,1);
  state={...good,state:'standby'};const previous=restores;await fix();assert.equal(restores,previous);assert.equal(restarts,1);
 });
 await test('Another repair process cannot start a second action',async()=>{
  const file=join(dir,'shared.lock'),release=acquireRuntimeLock(file);let actions=0;
  try{const fix=createDesktopRepair({status:async()=>good,recovery:fakeRecovery,start:async()=>actions++,restart:async()=>actions++,lock:()=>acquireRuntimeLock(file)});
   const result=await fix();assert.equal(result.repair.outcome,'busy');assert.equal(actions,0);
  }finally{release();}
 });
 await test('Ownership changes during diagnosis cancel the restart',async()=>{
  let reads=0,actions=0;
  const fix=createDesktopRepair({status:async()=>++reads<2?good:{...good,state:'standby'},recovery:fakeRecovery,start:async()=>actions++,restart:async()=>actions++});
  const result=await fix();assert.equal(result.state,'standby');assert.equal(actions,0);
 });
 await test('Offline connection uses wake rather than restarting the whole service',async()=>{
  let state={...good,state:'offline'},wakes=0;
  const fix=createDesktopRepair({status:async()=>state,recovery:fakeRecovery,start:async()=>assert.fail(),restart:async()=>assert.fail(),wake:async()=>{wakes++;state={...good,state:'connected'};}});
  assert.equal((await fix()).repair.verified,true);assert.equal(wakes,1);
 });
 await test('Damaged registry does not trigger new pairing or a restart',async()=>{
  let actions=0;
  const fix=createDesktopRepair({status:async()=>({...good,tv:{configured:false}}),recovery:{...fakeRecovery,restore:()=>({reason:'registry-unreadable'}),inspect:()=>({...auth,registry:'unreadable'})},start:async()=>actions++,restart:async()=>actions++});
  const result=await fix();assert.equal(result.repair.code,'registry-unreadable');assert.equal(result.repair.needsReview,true);assert.equal(actions,0);
 });
 await test('Known public metadata restores a missing profile with its existing key',async()=>{
  const home=join(dir,'owner'),registry=join(dir,'registry.json'),cache=join(dir,'recovery.json');
  mkdirSync(join(home,'.ssh'),{recursive:true});writeFileSync(join(home,'.ssh','test-key'),'PRIVATE_FIXTURE');
  const profile={name:'lg-lab',host:'192.168.1.134',username:'prisoner',privateKey:{openSsh:'test-key'},password:'SECRET'};
  writeFileSync(registry,JSON.stringify([profile]));
  const load=()=>{try{return JSON.parse(readFileSync(registry));}catch{return null;}};
  const recovery=createProfileRecovery({registry:()=>({file:registry,devices:load()}),device:()=> 'lg-lab',home:()=>home,cache});
  recovery.capture();writeFileSync(registry,'[]');assert.equal(recovery.inspect().backupUsable,true);
  let state='setup',restarts=0;
  const fix=createDesktopRepair({status:async()=>({...good,state,tv:{configured:!!load()?.length}}),recovery,start:async()=>{},restart:async()=>{restarts++;state='connected';}});
  const result=await fix();assert.equal(result.repair.verified,true);assert.equal(restarts,1);assert.equal(load()[0].privateKey.openSsh,'test-key');
  assert.ok(!readFileSync(cache,'utf8').includes('SECRET'));assert.ok(!readFileSync(cache,'utf8').includes('PRIVATE_FIXTURE'));
 });
 await test('Monitor does not repair healthy/standby and remembers blocked outcomes',async()=>{
  let now=0,state={...good,state:'connected'},calls=0;
  const monitor=createRepairMonitor({readState:()=>state,now:()=>now,repair:async()=>{calls++;return{repair:{outcome:'blocked'}};}});
  await monitor.tick();state={...good,state:'standby'};await monitor.tick();assert.equal(calls,0);
  state={...good};await monitor.tick();await monitor.tick();assert.equal(calls,1);
  now=60001;await monitor.tick();assert.equal(calls,2);
 });
 await test('Failed actions and unavailable journal never claim a completed repair',async()=>{
  const fail=createDesktopRepair({status:async()=>good,recovery:fakeRecovery,start:async()=>{},restart:async()=>{throw Error('SECRET key');}});
  const result=await fail();assert.equal(result.repair.verified,false);assert.equal(result.repair.outcome,'failed');assert.ok(!JSON.stringify(result).includes('SECRET'));
  let actions=0;const blocked=createDesktopRepair({status:async()=>good,recovery:fakeRecovery,start:async()=>actions++,restart:async()=>actions++,journal:{reserve:()=>({allowed:false,reason:'journal-unavailable'})}});
  const denied=await blocked();assert.equal(denied.repair.outcome,'blocked');assert.equal(denied.repair.needsReview,true);assert.equal(actions,0);
 });
 await test('Web Doctor preserves standby, startup and a connection recovered during diagnosis',async()=>{
  const make=state=>{const calls=[],runtime={state,disconnect:async()=>calls.push('disconnect')};const doctor=createDoctor({catalog:{items:[{}],updatedAt:Date.now(),sources:()=>[],refresh:async()=>calls.push('refresh')},library:{entries:[]},runtime,startedAddress:'192.168.1.65',currentAddress:()=> '192.168.1.65',probe:async()=>true,rss:()=>1,supervised:true,restart:()=>calls.push('restart'),autostart:{status:async()=>({installed:true,loaded:true})}});return{doctor,runtime,calls};};
  for(const state of ['standby','starting']){const d=make(state);assert.equal((await d.doctor.diagnose()).checks.find(c=>c.id==='tv-link').fix,null);await d.doctor.prescribe();assert.deepEqual(d.calls,[]);}
  const calls=[],runtime={state:'offline',disconnect:async()=>calls.push('disconnect')};
  const doctor=createDoctor({catalog:{items:[{}],updatedAt:Date.now(),sources:()=>[]},library:{entries:[]},runtime,startedAddress:'192.168.1.65',currentAddress:()=> '192.168.1.65',probe:async()=>true,rss:()=>1,autostart:{status:async()=>{runtime.state='connected';return{installed:true,loaded:true};}}});
  await doctor.prescribe();assert.deepEqual(calls,[]);
 });
 await test('Web Doctor restores an authorized profile, reports pending restart and throttles repeats',async()=>{
  let exists=false,restarts=0,restores=0;const runtime={state:'setup',disconnect:async()=>assert.fail()};
  const profile={inspect:()=>({registry:'ok',profilePresent:exists,keyPresent:exists,backupUsable:true}),restore:()=>{restores++;exists=true;return{restored:true};}};
  const doctor=createDoctor({catalog:{items:[{}],updatedAt:Date.now(),sources:()=>[]},library:{entries:[]},runtime,profile,tv:()=>({host:'127.0.0.1',port:9922,configured:exists}),startedAddress:'192.168.1.65',currentAddress:()=> '192.168.1.65',probe:async()=>true,rss:()=>1,supervised:true,restart:()=>{restarts++;},autostart:{status:async()=>({installed:true,loaded:true})},log:()=>{}});
  const first=await doctor.prescribe();assert.equal(first.restarting,true);assert.equal(restores,1);await idle(700);assert.equal(restarts,1);
  const second=await doctor.prescribe();assert.equal(second.restarting,false);await idle(700);assert.equal(restarts,1);
 });
 await test('Real supervisor repairs stale setup without tray and preserves healthy/other owner',async()=>{
  const root=join(dir,'isolated'),files=[
   'desktop/shared/desktop-supervisor.mjs','desktop/shared/desktop-config.mjs','desktop/shared/profile-recovery.mjs','desktop/shared/app-package.mjs',
   'desktop/shared/desktop-repair.mjs','desktop/shared/repair-policy.mjs','desktop/shared/repair-journal.mjs','desktop/shared/repair-monitor.mjs',
   'scripts/runtime-lock.mjs','scripts/holy/doctor.mjs','scripts/diagnostics.mjs'];
  for(const file of files){mkdirSync(dirname(join(root,file)),{recursive:true});copyFileSync(join(ROOT,file),join(root,file));}
  writeFileSync(join(root,'package.json'),'{"type":"module"}');mkdirSync(join(root,'.local'),{recursive:true});
  writeFileSync(join(root,'.local','desktop-config.json'),'{"device":"lg-lab","tvIp":"127.0.0.1"}');
  const home=join(root,'owner'),appData=join(home,'roaming'),local=join(home,'local');
  mkdirSync(join(home,'.ssh'),{recursive:true});writeFileSync(join(home,'.ssh','fixture'),'NOT_A_REAL_KEY');
  mkdirSync(join(appData,'.webos','tv'),{recursive:true});
  writeFileSync(join(appData,'.webos','tv','novacom-devices.json'),JSON.stringify([{name:'lg-lab',host:'127.0.0.1',username:'prisoner',privateKey:{openSsh:'fixture'}}]));
  writeFileSync(join(root,'fake-host.mjs'),"import{readFileSync,writeFileSync}from'node:fs';import{tvAddress,userDataContext}from'./desktop/shared/desktop-config.mjs';let n=0;try{n=+readFileSync('count','utf8')}catch{}writeFileSync('count',String(++n));function send(){let state=n===1?'setup':'connected';try{state=readFileSync('mode','utf8')}catch{}process.send({type:'status',status:{state,tv:{...tvAddress(),configured:n!==1},context:n===1?{id:'old'}:userDataContext(),updated:Date.now()}})};send();setInterval(send,50);process.on('message',m=>{if(m==='stop')process.exit(0)});process.on('disconnect',()=>process.exit(0));");
  const child=spawn(process.execPath,[join(root,'desktop/shared/desktop-supervisor.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,APPDATA:appData,LOCALAPPDATA:local,USERPROFILE:home,HOME:home,TV_DEVICE:'lg-lab',TV_IP:'127.0.0.1',LUMA_OFFLINE_TEST:'1',LUMA_HOST_SCRIPT:join(root,'fake-host.mjs'),LUMA_WORKER_STALL_MS:'5000'}});
  let output='';child.stdout.on('data',b=>{output=(output+b).slice(-2000)});child.stderr.on('data',b=>{output=(output+b).slice(-2000)});
  const done=new Promise(resolve=>child.once('exit',resolve));let owner;
  const request=async path=>{owner=JSON.parse(readFileSync(join(root,'.local','desktop-owner.json'),'utf8'));const response=await fetch('http://127.0.0.1:'+owner.port+path,{method:path==='/stop'?'POST':'GET',headers:{'X-Luma-Token':owner.token},signal:AbortSignal.timeout(1000)});return response.json();};
  try{
   let status;for(let i=0;i<100;i++){try{status=await request('/status');if(status.state==='connected')break;}catch{}await idle(80);}
   assert.equal(status?.state,'connected',output);assert.equal(readFileSync(join(root,'count'),'utf8'),'2');
   await idle(1200);assert.equal(readFileSync(join(root,'count'),'utf8'),'2');
   writeFileSync(join(root,'mode'),'standby');await idle(1300);assert.equal(readFileSync(join(root,'count'),'utf8'),'2');assert.equal((await request('/status')).state,'standby');
  }finally{
   try{await request('/stop');}catch{}if(child.exitCode===null){const t=setTimeout(()=>child.kill(),5000);await done;clearTimeout(t);}
  }
 });
 console.log(passed+' escenarios del Doctor: diagnóstico, verificación, límites persistentes, exclusión mutua y supervisor real correctos (sin TV).');
}finally{
 const target=resolve(dir),base=resolve(tmpdir())+sep;assert.ok(target.startsWith(base));rmSync(target,{recursive:true,force:true});
}
