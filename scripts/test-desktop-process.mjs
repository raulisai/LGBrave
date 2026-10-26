// Explicit process integration check: uses a fake worker, never a TV or Internet.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {start,stop,ask,restart} from './desktop-control.mjs';
import {ROOT} from './desktop-config.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
if(await ask('/status')) throw Error('Ya hay un servicio activo; no se cambiará durante esta prueba.');
const dir=mkdtempSync(join(tmpdir(),'luma-desktop-process-'));
const worker=join(dir,'worker.mjs');
writeFileSync(worker,`process.send({type:'status',status:{state:'waiting',pid:process.pid}});process.on('message',m=>{if(m==='stop')process.exit(0)});`);
process.env.LUMA_HOST_SCRIPT=worker;
const wait=async fn=>{for(let n=0;n<80;n++){const value=await fn();if(value)return value;await delay(100);}throw Error('El proceso no llegó al estado esperado.');};
try {
  await start(); const first=await wait(async()=>{const s=await ask('/status');return s?.state==='waiting' && s;});
  const second=await start();assert.equal(first.pid,second.pid,'Starting twice must not duplicate the supervisor');
  process.kill(first.pid,0);
  const duplicate=spawn(process.execPath,['scripts/desktop-supervisor.mjs'],{cwd:ROOT,stdio:'ignore',windowsHide:true,env:process.env});
  const code=await new Promise(resolve=>duplicate.once('exit',resolve));assert.equal(code,2);
  process.kill(first.workerPid,'SIGKILL');
  const recovered=await wait(async()=>{const s=await ask('/status');return s?.state==='waiting' && s.workerPid && s.workerPid!==first.workerPid && s;});
  assert.equal(recovered.pid,first.pid,'The supervisor must survive its worker crashing');
  await restart();const after=await wait(async()=>{const s=await ask('/status');return s?.state==='waiting'&&s;});assert.notEqual(after.pid,first.pid);
  await stop();assert.equal(await ask('/status'),null);
  process.env.LUMA_WORKER_STALL_MS='300';
  await start();const silent=await wait(async()=>{const s=await ask('/status');return s?.state==='waiting'&&s;});
  const revived=await wait(async()=>{const s=await ask('/status');return s?.state==='waiting'&&s.workerPid!==silent.workerPid&&s;});
  assert.equal(revived.pid,silent.pid,'Watchdog must replace a worker that stops reporting');
  await stop();delete process.env.LUMA_WORKER_STALL_MS;
  // A conflict (busy port, another runtime) is retried instead of leaving the service dead.
  const flaky=join(dir,'flaky.mjs');process.env.LUMA_TEST_MARK=join(dir,'conflicted');process.env.LUMA_CONFLICT_RETRY_MS='300';
  writeFileSync(flaky,`import {existsSync,writeFileSync} from 'node:fs';const mark=process.env.LUMA_TEST_MARK;
if(!existsSync(mark)){writeFileSync(mark,'1');process.send({type:'status',status:{state:'conflict',error:'El puerto 43190 está ocupado'}},()=>process.exit(2));}
else{process.send({type:'status',status:{state:'standby',pid:process.pid}});process.on('message',m=>{if(m==='stop')process.exit(0);if(m==='wake')process.send({type:'status',status:{state:'connected',pid:process.pid}});});}`);
  process.env.LUMA_HOST_SCRIPT=flaky;
  await start();await wait(async()=>{const s=await ask('/status');return s?.state==='conflict'&&/43190/.test(s.error)&&s;});
  await wait(async()=>{const s=await ask('/status');return s?.state==='standby'&&s;});
  assert.deepEqual(await ask('/wake','POST'),{ok:true});
  await wait(async()=>{const s=await ask('/status');return s?.state==='connected'&&s;});
  await stop();process.env.LUMA_HOST_SCRIPT=worker;delete process.env.LUMA_CONFLICT_RETRY_MS;delete process.env.LUMA_TEST_MARK;
  console.log('Inicio, inicio repetido, exclusión de supervisor, reinicio, conflicto reintentado, despertar y apagado reales correctos (hijo simulado, sin TV).');
} finally {await stop();delete process.env.LUMA_HOST_SCRIPT;delete process.env.LUMA_WORKER_STALL_MS;delete process.env.LUMA_CONFLICT_RETRY_MS;rmSync(dir,{recursive:true,force:true});}
