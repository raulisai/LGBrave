import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {adoptPackagedSettings,currentPackage,launchThroughShell,packageCaches,packagedCopies} from '../desktop/shared/app-package.mjs';
import {createProfileRecovery} from '../desktop/shared/profile-recovery.mjs';
import {createSleepClock} from '../desktop/shared/repair-monitor.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-package-'));let passed=0;
const check=async(name,fn)=>{await fn();passed++;};
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
try{
 const local=join(dir,'Local'),cache=name=>join(local,'Packages',name,'LocalCache');
 const relative=join('.webos','tv','novacom-devices.json'),store='Vendor.App_abc';
 mkdirSync(cache(store),{recursive:true});mkdirSync(join(local,'Packages','NoCache_abc'),{recursive:true});
 const lab={name:'lg-lab',host:'192.168.1.134',port:'9922',username:'prisoner',type:'starfish',files:'stream',privateKey:{openSsh:'tv-key'},passphrase:'FIXTURE_PASS'};
 await check('Only packages that keep private data are listed; other systems list none',()=>{
  assert.deepEqual(packageCaches(local).map(item=>item.name),[store]);assert.deepEqual(packageCaches(''),[]);assert.deepEqual(packageCaches(join(dir,'missing')),[]);
 });
 await check('Private copies come newest first',()=>{
  put(join(cache('Old.App_abc'),'Local','state.json'),'{}');put(join(cache(store),'Local','state.json'),'{}');
  utimesSync(join(cache('Old.App_abc'),'Local','state.json'),new Date(1000),new Date(1000));
  assert.deepEqual(packagedCopies('Local','state.json',local).map(item=>item.name),[store,'Old.App_abc']);
  rmSync(join(cache('Old.App_abc')),{recursive:true});
 });
 await check('A redirected write names the app; a normal one does not, and no probe stays',()=>{
  assert.equal(currentPackage({local}),'');
  assert.equal(currentPackage({local,write:(file,text)=>put(join(cache(store),'Local','HolyLuma',file.split(/[\\/]/).pop()),text)}),store);
  assert.deepEqual(readdirSync(join(local,'HolyLuma')),[]);
  assert.equal(currentPackage({local:''}),'');
 });
 const home=join(dir,'owner'),registry=join(dir,'real','devices.json'),backup=join(dir,'backup.json');
 const load=()=>{try{return JSON.parse(readFileSync(registry,'utf8'));}catch{return null;}};
 const recovery=createProfileRecovery({registry:()=>({file:registry,devices:load()}),device:()=> 'lg-lab',home:()=>home,cache:backup,packaged:()=>packagedCopies('Roaming',relative,local)});
 put(join(home,'.ssh','tv-key'),'-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nFAKE TEST KEY');
 await check('An encrypted key cannot be rebuilt from the public backup',()=>{
  put(registry,JSON.stringify([{...lab,name:'lg-lab'}]));assert.equal(recovery.capture(),true);
  assert.ok(!readFileSync(backup,'utf8').includes('FIXTURE_PASS'));
  put(registry,JSON.stringify([{name:'emulator'}]));
  assert.equal(recovery.inspect().backupUsable,false);assert.equal(recovery.restore().reason,'authorization-required');
 });
 await check('The profile another app kept private moves whole, beside the other devices',()=>{
  put(join(cache(store),'Roaming',relative),JSON.stringify([{name:'emulator'},lab]));
  assert.equal(recovery.inspect().packagedProfile,true);
  assert.equal(recovery.restore().restored,true);
  assert.deepEqual(load().map(item=>item.name),['emulator','lg-lab']);
  assert.equal(load()[1].passphrase,'FIXTURE_PASS');assert.equal(load()[1].files,'stream');
  assert.ok(!readFileSync(backup,'utf8').includes('FIXTURE_PASS'),'La copia pública sigue sin secretos');
  assert.equal(recovery.restore().reason,'present');
 });
 await check('A private profile whose key is gone asks for authorization again',()=>{
  rmSync(join(home,'.ssh','tv-key'));put(registry,'[]');
  assert.equal(recovery.inspect().packagedProfile,false);assert.equal(recovery.restore().reason,'authorization-required');
 });
 await check('Sync settings are adopted only when ours have no usable key',()=>{
  const target=join(local,'HolyLuma','peer-sync.json'),file=join('HolyLuma','peer-sync.json'),usable=saved=>/^[a-f0-9]{64}$/.test(saved?.key||'');
  const paired={id:'a'.repeat(36),key:'b'.repeat(64),peers:[{host:'192.168.1.148'}]};
  put(join(cache(store),'Local',file),JSON.stringify(paired));put(target,JSON.stringify({id:'c'.repeat(36),key:'',peers:[]}));
  assert.equal(adoptPackagedSettings(target,file,usable,local),store);assert.deepEqual(JSON.parse(readFileSync(target,'utf8')),paired);
  put(join(cache(store),'Local',file),JSON.stringify({...paired,key:'d'.repeat(64)}));
  assert.equal(adoptPackagedSettings(target,file,usable,local),'');assert.equal(JSON.parse(readFileSync(target,'utf8')).key,paired.key);
 });
 await check('The shell receives the installed shortcut; without it the caller keeps its route',async()=>{
  const appData=join(dir,'Roaming'),launched=[];
  const launch=(binary,args)=>{launched.push([binary,args]);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
  assert.equal(await launchThroughShell({appData,windows:'W',launch}),false);assert.equal(launched.length,0);
  const link=join(appData,'Microsoft','Windows','Start Menu','Programs','Holy y Luma.lnk');put(link,'');
  assert.equal(await launchThroughShell({appData,windows:'W',launch}),true);assert.deepEqual(launched,[[join('W','explorer.exe'),[link]]]);
  assert.equal(await launchThroughShell({appData,windows:'W',launch:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('blocked')));return child;}}),false);
 });
 await check('Waking from sleep is told apart from a stuck worker',()=>{
  let time=0;const resumed=createSleepClock({now:()=>time});
  time=1000;assert.equal(resumed(),false);time=2000;assert.equal(resumed(),false);
  time=3600000;assert.equal(resumed(),true);time=3601000;assert.equal(resumed(),false);
 });
 assert.equal(existsSync(join(local,'HolyLuma','peer-sync.json.tmp')),false);
 console.log(passed+' comprobaciones de apps de Tienda: datos privados, perfil cifrado, ajustes y arranque fuera de la app.');
}finally{rmSync(dir,{recursive:true,force:true});}
