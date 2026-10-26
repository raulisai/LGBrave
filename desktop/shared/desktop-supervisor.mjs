import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {writeFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './desktop-config.mjs';
import {acquireRuntimeLock} from '../../scripts/runtime-lock.mjs';

process.chdir(ROOT);
let release;
try { release = acquireRuntimeLock('.local/desktop-supervisor.lock'); }
catch (error) { console.error(error.message); process.exit(2); }
const token = randomUUID();
let child, timer, watchdog, lastHeartbeat=Date.now(), stopping = false, failures = [], latest = {state:'starting'};
const ownerFile = join(ROOT, '.local', 'desktop-owner.json');
function start() {
  if (stopping) return;
  lastHeartbeat=Date.now();
  child = spawn(process.execPath, [process.env.LUMA_HOST_SCRIPT || join(ROOT, 'scripts', 'desktop-host.mjs')],
    {cwd:ROOT, windowsHide:true, stdio:['ignore','inherit','inherit','ipc'], env:{...process.env,HOLY_SUPERVISED:'1'}});
  child.on('message', message => { if (message?.type === 'status') {latest = message.status;lastHeartbeat=Date.now();} });
  child.on('error', error => { latest = {state:'error',error:error.message}; });
  child.on('exit', code => {
    child = null;
    if (stopping) return done();
    // A conflict (another local runtime, or a program on the ports) may clear on its own: try again.
    if (code === 2) {
      // The host says why before exiting; an older host does not.
      if (latest.state !== 'conflict' || !latest.error) latest = {state:'conflict',error:'Otro runtime local está activo. Detén npm run lab antes de iniciar el control común; se reintentará cada 30 s.'};
      timer = setTimeout(start, Number(process.env.LUMA_CONFLICT_RETRY_MS) || 30000); return;
    }
    failures = failures.filter(time => Date.now()-time < 60000); failures.push(Date.now());
    latest = {state:'restarting',error:`El servicio terminó (${code}); se reiniciará.`};
    timer = setTimeout(start, failures.length >= 5 ? 30000 : 2000);
  });
}
function done() {
  clearInterval(watchdog);
  try { unlinkSync(ownerFile); } catch {}
  release(); server.close(); process.exit(0);
}
function stop() {
  if (stopping) return;
  stopping = true; clearTimeout(timer);
  if (!child) return done();
  child.send('stop', () => {});
  setTimeout(() => child?.kill('SIGKILL'), 8000).unref();
}
const server = createServer((req,res) => {
  if (req.headers['x-luma-token'] !== token) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type','application/json');
  if (req.url === '/status' && req.method === 'GET') res.end(JSON.stringify({...latest,pid:process.pid,workerPid:child?.pid || null,root:ROOT,worker:!!child}));
  else if (req.url === '/stop' && req.method === 'POST') { res.end('{"ok":true}'); stop(); }
  else if (req.url === '/wake' && req.method === 'POST') { child?.send('wake', () => {}); res.end(JSON.stringify({ok:!!child})); }
  else res.writeHead(404).end();
});
server.on('error', error => { console.error(error); release(); process.exit(1); });
server.listen(0,'127.0.0.1', () => {
  writeFileSync(ownerFile, JSON.stringify({pid:process.pid,token,port:server.address().port}), {mode:0o600});
  start();
  watchdog=setInterval(()=>{if(!stopping&&child&&Date.now()-lastHeartbeat>(Number(process.env.LUMA_WORKER_STALL_MS)||40000)){latest={state:'restarting',error:'El servicio dejó de responder; se reiniciará automáticamente.'};lastHeartbeat=Date.now();child.kill();}},1000);watchdog.unref();
});
for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.once(signal, stop);
