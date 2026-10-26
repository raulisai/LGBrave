import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrashMemory, STABLE_MS } from './crash-memory.mjs';

const file = join(mkdtempSync(join(tmpdir(), 'luma-crash-')), 'crash-sites.json');
let clock = 1000;
const memory = new CrashMemory(file, { now: () => clock });
const home = url => url.startsWith('http://192.168.1.148:43187/');

memory.begin('https://site.example/watch?token=secret', home);
clock += 3000;
assert.equal(memory.closed(), 'site.example', 'cierre durante la carga se anota');
assert.deepEqual(memory.riskyHosts(), [], 'un solo cierre no marca el sitio');
memory.begin('https://site.example/', home); clock += 2000;
memory.closed();
assert.deepEqual(memory.riskyHosts(), ['site.example'], 'dos seguidos lo marcan');
assert.ok(!readFileSync(file, 'utf8').includes('token') && !readFileSync(file, 'utf8').includes('/watch'), 'solo el nombre del sitio, nunca rutas ni parámetros');
// Windows uses inherited NTFS ACLs; POSIX mode bits are not implemented there.
if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);

memory.begin('https://site.example/', home);
memory.stable('site.example');
assert.deepEqual(memory.riskyHosts(), [], 'sobrevivir lo limpia');
assert.equal(new CrashMemory(file).riskyHosts().length, 0, 'persiste en disco');

memory.begin('https://slow.example/', home); clock += STABLE_MS + 1;
assert.equal(memory.closed(), null, 'un cierre tardío (el usuario salió de la app) no cuenta');
memory.begin('http://192.168.1.148:43187/luma-home/', home);
assert.equal(memory.closed(), null, 'el Inicio de Luma no se rastrea');
memory.begin('about:blank', home);
assert.equal(memory.closed(), null);
assert.equal(new CrashMemory('/nonexistent/dir/x.json').riskyHosts().length, 0);
memory.stop();
console.log('Memoria de cierres: durante la carga, dos seguidos, limpieza, sin rutas y sin falsos cierres correctos.');
