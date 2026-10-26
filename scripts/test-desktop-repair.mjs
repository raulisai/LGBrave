import {EventEmitter} from 'node:events';
import {openInspectorTunnel} from './inspector-tunnel.mjs';
import {sessionWatchdogCommand} from './tv-lease.mjs';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProfileRecovery} from '../desktop/shared/profile-recovery.mjs';
import {createDesktopRepair} from '../desktop/shared/desktop-repair.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-repair-'));let passed=0;
const check=async(name,fn)=>{await fn();passed++;};
try{
 assert.throws(()=>sessionWatchdogCommand('shell-injection'),/inválida/);
 const watchdog=sessionWatchdogCommand('00000000-0000-0000-0000-000000000000');
 assert.ok(watchdog.includes('p=$PPID'));assert.ok(watchdog.includes('/proc/$p/comm'));assert.ok(watchdog.includes('$born'));assert.ok(watchdog.includes('kill -TERM'));
 const file=join(dir,'devices.json'),cache=join(dir,'backup.json'),key=join(dir,'.ssh','existing-key');
 mkdirSync(join(dir,'.ssh'));writeFileSync(key,'FAKE TEST KEY');
 const profile={name:'lg-lab',host:'192.168.1.134',port:'9922',username:'prisoner',type:'starfish',privateKey:{openSsh:'existing-key'},passphrase:'DO_NOT_SAVE',password:'DO_NOT_SAVE'};
 const read=()=>{try{return JSON.parse(readFileSync(file));}catch{return null;}};
 const recovery=createProfileRecovery({registry:()=>({file,devices:read()}),device:()=> 'lg-lab',home:()=>dir,cache});
 await check('Session watchdog receives the same authenticated SSH object',async()=>{
  const ssh=new EventEmitter();ssh.end=()=>{};let guarded=false;
  const tunnel=await openInspectorTunnel({connect:async()=>({ssh}),reserve:true,acquireLease:async()=>({token:'00000000-0000-0000-0000-000000000000',lost:new Promise(()=>{}),assertActive(){},async release(){}}),command:async(client,text)=>{assert.equal(client,ssh);if(text.includes('nohup')){guarded=true;return 'guarded';}return '0';}});
  assert.equal(guarded,true);await tunnel.close();
 });
 await check('Capture public registry metadata without passwords or private key contents',()=>{
  writeFileSync(file,JSON.stringify([profile]));assert.equal(recovery.capture(),true);const saved=readFileSync(cache,'utf8');assert.ok(!saved.includes('DO_NOT_SAVE'));assert.ok(!saved.includes('FAKE TEST KEY'));assert.equal(recovery.keyPresent(),true);
 });
 await check('Missing registry is restored with existing key, retaining other devices',()=>{
  writeFileSync(file,JSON.stringify([{name:'other'}]));assert.equal(recovery.restore().restored,true);assert.equal(read().length,2);assert.equal(recovery.restore().reason,'present');
 });
 await check('A damaged registry is not overwritten',()=>{
  writeFileSync(file,'invalid');assert.equal(recovery.restore().reason,'registry-unreadable');assert.equal(readFileSync(file,'utf8'),'invalid');
 });
 await check('No silent authorization replacement when key is missing',()=>{
  writeFileSync(file,'[]');rmSync(key);assert.equal(recovery.restore().reason,'authorization-required');
 });
 const base={state:'setup',running:true,tv:{configured:true,needsUpdate:false},tvReachable:true};let current={...base},restarts=0,starts=0,restores=0;
 const fake={restore(){restores++;return {restored:false};},capture(){},keyPresent:()=>true};
 const repair=createDesktopRepair({status:async()=>current,recovery:fake,start:async()=>{starts++;current={...base,state:'waiting'};},restart:async()=>{restarts++;current={...base,state:'starting'};}});
 await check('Stale setup is repaired with current Windows profile',async()=>{const result=await repair();assert.equal(restarts,1);assert.equal(result.repair.ok,true);});
 await check('Other inspector is respected, including manual Doctor',async()=>{current={...base,state:'standby'};const before=restores;const result=await repair();assert.equal(restarts,1);assert.equal(restores,before);assert.equal(result.repair.waiting,true);});
 await check('Disconnected TV is retried without restart loop',async()=>{current={...base,state:'offline',tvReachable:false};await repair();assert.equal(restarts,1);});
 await check('Stopped service starts; healthy service keeps playing',async()=>{current={...base,state:'stopped',running:false};await repair();assert.equal(starts,1);current={...base,state:'connected'};await repair();assert.equal(restarts,1);});
 await check('Expired or absent authorization is reported honestly',async()=>{current={...base,tv:{configured:false}};assert.equal((await repair()).repair.needsAuthorization,true);});
 console.log(passed+' comprobaciones del Doctor, registro recuperable y sesión ajena correctas.');
}finally{rmSync(dir,{recursive:true,force:true});}
