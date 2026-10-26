import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {webosTool} from './webos-cli.mjs';
import {config} from './desktop-config.mjs';

const device = process.argv[2] || config().device;
const directory = resolve('evidence', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true });
const checks = [
  ['identity', 'ares-device', ['--system-info', '--device', device]],
  ['permissions', 'ares-novacom', ['--device', device, '--run', 'id']],
  ['kernel', 'ares-novacom', ['--device', device, '--run', 'uname -a']],
  ['cpu', 'ares-novacom', ['--device', device, '--run', 'cat /proc/cpuinfo']],
  ['memory', 'ares-novacom', ['--device', device, '--run', 'cat /proc/meminfo']],
  ['storage', 'ares-novacom', ['--device', device, '--run', 'df -h']],
  ['partitions', 'ares-novacom', ['--device', device, '--run', 'cat /proc/partitions']],
  ['os-release', 'ares-novacom', ['--device', device, '--run', 'cat /etc/os-release']],
  ['device-tree', 'ares-novacom', ['--device', device, '--run', 'cat /sys/firmware/devicetree/base/model']],
  ['development-apps', 'ares-install', ['--device', device, '--list']],
  ['running-apps', 'ares-launch', ['--device', device, '--running']]
];
const results = [];
for (const [name, binary, args] of checks) {
  let output;
  let status = 0;
  try {
    output = execFileSync(process.execPath, [webosTool(binary), ...args], { encoding: 'utf8', timeout: 20000, windowsHide:true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    status = error.status ?? -1;
    output = `${error.stdout || ''}\n${error.stderr || ''}`;
  }
  writeFileSync(resolve(directory, `${name}.txt`), output);
  results.push({ name, command: [binary, ...args], status });
  console.log(`${name}: ${status === 0 ? 'OK' : `no disponible (${status})`}`);
}
writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
  capturedAt: new Date().toISOString(),
  localTime: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
  device,
  scope: 'Lectura mediante Developer Mode; no es un respaldo de firmware.',
  results
}, null, 2));
console.log(directory);
