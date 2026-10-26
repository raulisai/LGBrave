import net from 'node:net';
import {execFileSync} from 'node:child_process';

// The service's fixed ports (Luma fixtures 43187/43188, Holy 43190).
export const SERVICE_PORTS = [43187, 43188, Number(process.env.HOLY_PORT) || 43190];

const free = port => new Promise(resolve => {
  const probe = net.createServer();
  probe.once('error', error => resolve(error.code !== 'EADDRINUSE'));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '0.0.0.0');
});
// Best effort «name (pid N)» of whoever listens on a port; '' when the system does not say.
export function portOwner(port, platform = process.platform, run = (file, args) => execFileSync(file, args, {encoding:'utf8', timeout:3000, windowsHide:true, stdio:['ignore','pipe','ignore']})) {
  try {
    if (platform === 'win32') {
      const line = run('netstat', ['-ano', '-p', 'TCP']).split(/\r?\n/).find(row => new RegExp(`:${port}\\s+\\S+\\s+LISTENING`, 'i').test(row));
      const pid = Number(line?.trim().split(/\s+/).pop());
      if (!pid) return '';
      const name = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).split(',')[0]?.replace(/"/g, '').trim();
      return `${name || 'programa'} (pid ${pid})`;
    }
    const out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
    const pid = out.match(/^p(\d+)/m)?.[1], name = out.match(/^c(.+)$/m)?.[1];
    return pid ? `${name || 'programa'} (pid ${pid})` : '';
  } catch { return ''; }
}
// [{port, owner}] for each port another program already holds.
export async function busyPorts(ports = SERVICE_PORTS, owner = portOwner) {
  const busy = [];
  for (const port of ports) if (!(await free(port))) busy.push({port, owner:owner(port)});
  return busy;
}
export const describeBusy = busy => `${busy.length === 1 ? 'El puerto' : 'Los puertos'} ${busy.map(item => item.port + (item.owner ? ` (lo usa ${item.owner})` : '')).join(', ')} ${busy.length === 1 ? 'está ocupado' : 'están ocupados'} por otro programa. Ciérralo; el servicio reintentará solo cada 30 s.`;
