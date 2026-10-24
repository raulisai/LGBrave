import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

let passed = 0;
const check = (name,fn) => { fn(); passed++; };
const guard = JSON.stringify(new URL('./crash-guard.mjs', import.meta.url).href);
// A child process with the guard throws outside any try, like the webOS tools do when the TV drops.
const run = message => spawnSync(process.execPath,['--input-type=module','-e',
 `import {installCrashGuard} from ${guard};installCrashGuard(()=>{});setImmediate(()=>{throw new Error(${JSON.stringify(message)})});setTimeout(()=>process.exit(0),200);`],{encoding:'utf8'});

check('A dropped TV connection does not end the lab process',()=>{
 for(const message of ['Callback was already called.','read ETIMEDOUT','read ECONNRESET','connect EHOSTUNREACH 192.168.1.134:9922','novacom: session lost'])
  assert.equal(run(message).status,0,message);
});
check('Any other error still exits so the supervisor can restart it',()=>{
 const result=run('otra cosa rota');assert.equal(result.status,1);assert.match(result.stderr,/otra cosa rota/);
});
check('npm run lab uses the supervisor and start-lab installs the guard first',()=>{
 assert.equal(JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).scripts.lab,'node scripts/lab-supervisor.mjs');
 const source=readFileSync(new URL('./start-lab.mjs',import.meta.url),'utf8');
 assert.ok(source.indexOf('installCrashGuard();')<source.indexOf('acquireRuntimeLock()'));
});
console.log(`${passed} comprobaciones de la guardia del laboratorio correctas.`);
