// One-click control of the Mac side of Luma (fixture server + passive lab), shared by the
// menu-bar app (mac/) and the future Windows tray. Usage: node scripts/luma-control.mjs <status|start|stop|restart>
// Prints one JSON line. Plain Node, no shell: it must also run on Windows.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, existsSync, unlinkSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const tvIp = process.env.TV_IP || '192.168.1.134';
const serverPort = 43187;
const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reach = (host, port, ms = 1200) => new Promise(resolve => {
  const socket = connect({ host, port, timeout: ms });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  for (const event of ['error', 'timeout']) socket.once(event, () => { socket.destroy(); resolve(false); });
});
const parentOf = pid => { try { return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } };
const commandOf = pid => { try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; } };

const labPid = () => { const lock = read(join(local, 'lab-runtime.lock')); return lock && alive(lock.pid) ? lock.pid : 0; };

export async function status() {
  const pid = labPid();
  const server = await reach('127.0.0.1', serverPort, 800);
  const tv = await reach(tvIp, 9922);
  const file = read(join(local, 'lab-status.json'));
  const fresh = file && Date.now() - file.updated < 15000 && file.pid === pid;
  let state = 'stopped';
  if (pid) state = fresh ? file.state : 'running';
  const labels = {
    connected: 'Conectado a la LG',
    waiting: 'LG encendida: abre Luma',
    offline: 'No encuentro la LG',
    starting: 'Conectando…',
    running: 'Activo (esperando datos)',
    stopped: 'Apagado'
  };
  return { state, label: labels[state] || state, lab: !!pid, server, tvReachable: tv, tvIp, ok: state === 'connected' };
}

function detached(script, logName, pidName) {
  mkdirSync(join(local, 'logs'), { recursive: true });
  const out = openSync(join(local, 'logs', logName), 'a');
  const child = spawn(process.execPath, [join(root, 'scripts', script)], { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  if (pidName) writeFileSync(join(local, pidName), String(child.pid));
  return child.pid;
}

export async function start() {
  if (!(await reach('127.0.0.1', serverPort, 800))) detached('fixture-server.mjs', 'fixture-server.log', 'luma-server.pid');
  if (!labPid()) detached('lab-supervisor.mjs', 'lab.log', 'luma-supervisor.pid');
  for (let i = 0; i < 20; i++) { await sleep(500); const s = await status(); if (s.lab && s.server) return s; }
  return status();
}

export async function stop() {
  const pid = labPid();
  if (pid) {
    // Its supervisor would restart it, so stop that first.
    const parent = parentOf(pid);
    if (parent > 1 && /supervisor\.mjs/.test(commandOf(parent))) { try { process.kill(parent, 'SIGTERM'); } catch { /* Already gone. */ } }
    try { process.kill(pid, 'SIGTERM'); } catch { /* Already gone. */ }
    for (let i = 0; i < 20 && labPid(); i++) await sleep(300);
  }
  // Only the server this tool started is stopped; one started by hand is left alone.
  const file = join(local, 'luma-server.pid');
  if (existsSync(file)) {
    const owned = Number(readFileSync(file, 'utf8'));
    if (alive(owned)) { try { process.kill(owned, 'SIGTERM'); } catch { /* Already gone. */ } }
    try { unlinkSync(file); } catch { /* Nothing to remove. */ }
  }
  return status();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const action = process.argv[2] || 'status';
  const run = { status, start, stop, restart: async () => { await stop(); await sleep(800); return start(); } }[action];
  if (!run) { console.error('Uso: luma-control.mjs <status|start|stop|restart>'); process.exit(64); }
  console.log(JSON.stringify(await run()));
}
