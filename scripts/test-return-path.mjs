import assert from 'node:assert/strict';
import {createReturnPathCheck,returnPathCommand,readReturnPath,describeReturnPath,windowsFirewallHint} from '../desktop/shared/return-path.mjs';
let passed=0;
const check=async(name,fn)=>{try{await fn();passed++;}catch(error){error.message=name+': '+error.message;throw error;}};

await check('El comando en la TV solo lee /holy-api/health, termina con exit 0 y prefiere curl',()=>{
  const text=returnPathCommand('192.168.1.65',43190);
  assert.match(text,/u='http:\/\/192\.168\.1\.65:43190\/holy-api\/health'/);
  assert.match(text,/curl -s -m 4 -o \/dev\/null -w '%\{http_code\}' "\$u"/);
  assert.match(text,/echo "curl \$\{c:-000\}"/);
  assert.match(text,/wget -q -T 4 -O \/dev\/null "\$u"/);
  assert.ok(text.trim().endsWith('exit 0'));
  assert.ok(!/luna-send|ares-|launch|reboot|rm /.test(text),'no toca la pantalla ni el sistema de la TV');
});
await check('Cualquier código HTTP es camino abierto; 000 es bloqueo; lo demás es desconocido',()=>{
  assert.deepEqual(readReturnPath('curl 200'),{ok:true,code:'200'});
  assert.deepEqual(readReturnPath('curl 403\n'),{ok:true,code:'403'});
  assert.deepEqual(readReturnPath('curl 000'),{ok:false,code:'000'});
  assert.deepEqual(readReturnPath('wget 000'),{ok:false,code:'000'});
  for(const text of ['none','','sh: curl: not found','curl'])assert.equal(readReturnPath(text).ok,null);
});
await check('Mensajes: perfil Privado sin regla da el comando; con regla apunta al router o VPN',()=>{
  const blocked=describeReturnPath({host:'192.168.1.65',port:43190,firewall:{category:'Private',network:'INFINITUME248 2',allowed:false}});
  assert.match(blocked,/192\.168\.1\.65:43190/);assert.match(blocked,/«INFINITUME248 2» como red Privada/);assert.match(blocked,/windows\\Firewall-LAN\.ps1/);
  const allowed=describeReturnPath({host:'192.168.1.65',port:43190,firewall:{category:'Public',network:'Casa',allowed:true}});
  assert.match(allowed,/red Pública/);assert.match(allowed,/aislamiento de clientes del router/);assert.ok(!allowed.includes('Firewall-LAN'));
  assert.match(describeReturnPath({host:'mac.local',port:43190,firewall:null}),/Revisa el firewall de esta computadora para el puerto 43190/);
});
await check('Ritmo: túnel nuevo al momento, 5 min si llega, 1 min mientras falla; sin solapes',async()=>{
  let now=0,calls=0,answer='curl 000',hints=0;
  const path=createReturnPathCheck({host:()=> '192.168.1.65',now:()=>now,hint:async()=>{hints++;return{category:'Private',network:'Casa',allowed:false};}});
  const run=async()=>{calls++;return answer;};
  assert.deepEqual(path.status(),{ok:null,checked:0,code:'',hint:''});
  const first=path.check(run),again=path.check(run);assert.equal(first,again,'una sola consulta a la vez');
  let result=await first;assert.equal(result.ok,false);assert.match(result.hint,/red Privada/);assert.equal(calls,1);assert.equal(hints,1);
  now=30000;await path.check(run);assert.equal(calls,1,'espera el reintento de 1 min');
  now=60001;result=await path.check(run);assert.equal(calls,2);assert.equal(hints,1,'la causa de Windows se consulta una vez por cambio');assert.match(result.hint,/Privada/);
  answer='curl 200';now=120002;result=await path.check(run);assert.deepEqual([result.ok,result.code,result.hint],[true,'200','']);
  now=120002+4*60000;await path.check(run);assert.equal(calls,3,'con camino abierto espera 5 min');
  const other=async()=>{calls++;return 'curl 200';};await path.check(other);assert.equal(calls,4,'un túnel nuevo comprueba al momento');
  answer='curl 000';now+=5*60000+1;result=await path.check(run);assert.equal(result.ok,false);assert.equal(hints,2,'un fallo nuevo vuelve a mirar el firewall');
});
await check('SSH caído, sin curl/wget o host raro: desconocido, nunca bloqueo ni comando con texto inyectado',async()=>{
  const path=createReturnPathCheck({host:'192.168.1.65',hint:async()=>assert.fail('sin fallo no se consulta Windows')});
  assert.equal((await path.check(async()=>{throw Error('Se cerró la conexión');})).ok,null);
  assert.equal((await createReturnPathCheck({host:'192.168.1.65',hint:async()=>null}).check(async()=>'none')).ok,null);
  let ran=0;const odd=createReturnPathCheck({host:"x'; reboot; '",hint:async()=>null});
  assert.equal((await odd.check(async()=>{ran++;return 'curl 000';})).ok,null);assert.equal(ran,0);
});
await check('La consulta del firewall de Windows no usa filtros de puerto (piden administrador) y tolera errores',async()=>{
  let script='';
  const found=await windowsFirewallHint({program:"C:\\Program Files\\nodejs\\node.exe",run:async text=>{script=text;return '{"category":"Private","network":"Casa","allowed":false}';}});
  assert.deepEqual(found,{category:'Private',network:'Casa',allowed:false});
  assert.match(script,/Get-NetConnectionProfile/);assert.match(script,/Get-NetFirewallApplicationFilter/);assert.ok(!/PortFilter/.test(script));
  assert.match(script,/DomainAuthenticated/);
  assert.equal(await windowsFirewallHint({run:async()=>{throw Error('Acceso denegado');}}),null);
  assert.equal(await windowsFirewallHint({run:async()=>'no es json'}),null);
});
console.log(passed+' comprobaciones del camino TV → computadora: comando de solo lectura, ritmo, causa en Windows y sin falsos bloqueos.');
