import { spawn } from 'node:child_process';
import { connectTV } from './cdp.mjs';
import { BrowserBridge, packagedHome } from './browser-bridge.mjs';

let stopping = false;
let inspector;
let cdp;
let bridge;
let tick;
const directory = process.cwd();
process.on('SIGINT', finish); process.on('SIGTERM', finish);
async function finish() {
  stopping = true; clearInterval(tick);
  await bridge?.stop().catch(() => {});
  cdp?.close(); inspector?.kill('SIGTERM');
  process.exit(0);
}
function inspect() {
  return new Promise((resolve, reject) => {
    inspector = spawn(process.execPath, ['node_modules/@webos-tools/cli/bin/ares-inspect.js', '--device', 'lg-lab', 'com.lgapp.lab'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    inspector.stdout.on('data', bytes => {
      const output = bytes.toString();
      const match = /Application Debugging - (http:\/\/localhost:\d+)/.exec(output);
      if (match && !settled) { settled = true; resolve(match[1]); }
    });
    inspector.stderr.on('data', bytes => console.error(bytes.toString().trim()));
    inspector.once('exit', () => { if (!settled) reject(Error('El inspector terminó antes de conectar.')); });
    inspector.once('error', reject);
  });
}
console.log('Servidor de fixtures requerido: npm run lab:server');
while (!stopping) {
  try {
    const endpoint = await inspect();
    cdp = await connectTV(endpoint);
    bridge = await new BrowserBridge(cdp, { fixtures: true }).start();
    if (await cdp.evaluate('location.href') === packagedHome) await bridge.command({ action: 'home' });
    else await bridge.status();
    console.log('Luma conectado: ' + endpoint + '. Navegación y filtros listos.');
    let checking = false;
    tick = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const targets = await (await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(3000) })).json();
        const target = targets.find(t => t.description === 'com.lgapp.lab' || t.url?.includes('/com.lgapp.lab/'));
        if (!target || target.id !== cdp.target.id) { cdp.close(); return; }
        await bridge.status();
      } catch { cdp.close(); }
      finally { checking = false; }
    }, 1500);
    await cdp.closed;
  } catch (error) { if (!stopping) console.error(error.message); }
  clearInterval(tick); cdp?.close(); inspector?.kill('SIGTERM');
  if (!stopping) { console.log('Reconectando con la TV…'); await new Promise(resolve => setTimeout(resolve, 2000)); }
}
