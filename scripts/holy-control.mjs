// One-click control of Holy's Mac side for the menu-bar app (mac/LumaMenu.swift).
// Usage: node scripts/holy-control.mjs <status|start|stop|restart|doctor|open>
// Prints one JSON line. It never navigates the TV; «open» only launches Holy on it
// (the owner clicked for it), like pressing its icon with the remote.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PORT, APP_ID, lanAddress } from './holy/config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const api = `http://127.0.0.1:${PORT}/holy-api`;
const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const parentOf = pid => { try { return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } };
const commandOf = pid => { try { return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const holyPid = () => { const lock = read(join(local, 'holy-runtime.lock')); return lock && alive(lock.pid) ? lock.pid : 0; };
const ask = async (path, options = {}) => {
  const response = await fetch(api + path, { ...options, signal: AbortSignal.timeout(options.timeout || 4000) });
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
};

// green: all well · orange: something to look at · red: Holy off on the Mac or no TV.
export async function status() {
  const pid = holyPid();
  const report = await ask('/doctor').catch(() => null);
  const find = id => report?.checks?.find(check => check.id === id);
  const tv = find('tv-net');
  const link = find('tv-link');
  let state, label;
  if (!report) [state, label] = pid ? ['starting', 'Holy arrancando en el Mac…'] : ['stopped', 'Holy apagado en el Mac'];
  else if (tv?.level !== 'ok') [state, label] = ['offline', 'No encuentro la LG'];
  else if (link?.level === 'ok') [state, label] = report.level === 'green' ? ['connected', 'Holy conectado a la LG'] : ['attention', 'Holy conectado · revisar'];
  else if (/no está abierta/i.test(link?.detail || '')) [state, label] = ['waiting', 'LG encendida: abre Holy'];
  else [state, label] = ['connecting', 'Conectando con Holy en la LG…'];
  const level = { connected: 'green', stopped: 'red', offline: 'red' }[state] || 'orange';
  const checks = (report?.checks || []).filter(check => check.level !== 'ok').map(check => ({ label: check.label, detail: check.detail, level: check.level, fixable: !!check.fix && check.level === 'warn' }));
  return { state, label, level, mac: !!pid || !!report, macIp: lanAddress(), tvIp: (tv?.detail || '').split(' ')[0] || '', tvReachable: tv?.level === 'ok', checks };
}

export async function start() {
  if (!holyPid() && !(await ask('/health').catch(() => null))) {
    mkdirSync(join(local, 'logs'), { recursive: true });
    const out = openSync(join(local, 'logs', 'holy.log'), 'a');
    spawn(process.execPath, [join(root, 'scripts', 'holy-supervisor.mjs')], { cwd: root, detached: true, stdio: ['ignore', out, out] }).unref();
  }
  for (let i = 0; i < 40; i++) { await sleep(500); if (await ask('/health', { timeout: 1500 }).catch(() => null)) break; }
  return status();
}

export async function stop() {
  const pid = holyPid();
  if (pid) {
    // Its supervisor would start it again, so that goes first.
    const parent = parentOf(pid);
    if (parent > 1 && /holy-supervisor\.mjs/.test(commandOf(parent))) { try { process.kill(parent, 'SIGTERM'); } catch { /* Already gone. */ } }
    try { process.kill(pid, 'SIGTERM'); } catch { /* Already gone. */ }
    for (let i = 0; i < 20 && holyPid(); i++) await sleep(300);
  }
  return status();
}

// The Doctor's safe fixes (reconnect, refresh, restart). With Holy off, it is started first.
export async function doctor() {
  if (!(await ask('/health').catch(() => null))) {
    const after = await start();
    return { ...after, done: [after.mac ? 'Holy estaba apagado en el Mac: se encendió' : 'No se pudo encender Holy en el Mac'] };
  }
  const result = await ask('/doctor', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, timeout: 30000 }).catch(error => ({ error: error.message }));
  if (result.restarting) await sleep(6000);
  const done = result.error ? ['El Doctor no respondió: ' + result.error] : [...(result.done || []).map(step => (step.ok ? '' : '✗ ') + step.text), ...(result.notFixable || []).map(item => 'Pendiente: ' + item.hint)];
  return { ...(await status()), done: done.length ? done : ['No había nada que arreglar'] };
}

export async function open() {
  const tool = join(root, 'node_modules', '.bin', 'ares-launch');
  await new Promise(resolve => execFile(tool, ['--device', 'lg-lab', APP_ID], { cwd: root, timeout: 30000 }, () => resolve()));
  await sleep(4000);
  return status();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const action = process.argv[2] || 'status';
  const run = { status, start, stop, doctor, open, restart: async () => { await stop(); await sleep(800); return start(); } }[action];
  if (!run) { console.error('Uso: holy-control.mjs <status|start|stop|restart|doctor|open>'); process.exit(64); }
  console.log(JSON.stringify(await run()));
  process.exit(0);
}
