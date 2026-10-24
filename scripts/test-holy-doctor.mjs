import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createDoctor, tcpOpen } from './holy/doctor.mjs';
import { createAutostart, plist, LABEL } from './holy/autostart.mjs';
import { startServer } from './holy/server.mjs';

// El Doctor y el arranque automático: sin TV, sin launchctl real, sin Internet.
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };
const NOW = 1_000_000_000_000;
const make = (over = {}) => {
  const calls = [];
  const runtime = { state: 'connected', disconnect: async () => calls.push('reconnect') };
  const catalog = { items: [{}], updatedAt: NOW - 60000, sources: () => [{ id: 'a', name: 'A', health: { ok: true } }], refresh: async () => calls.push('refresh') };
  const doctor = createDoctor({ catalog, library: { entries: [] }, runtime, startedAddress: '10.0.0.2', currentAddress: () => '10.0.0.2',
    autostart: { status: async () => ({ installed: true, loaded: true }), install: async () => calls.push('autostart') },
    supervised: true, restart: () => calls.push('restart'), probe: async () => true, now: () => NOW, rss: () => 1e8, log: () => {}, ...over });
  return { doctor, calls, runtime, catalog };
};

await check('Todo bien → verde y nada que recetar', async () => {
  const { doctor, calls } = make();
  const report = await doctor.diagnose();
  assert.equal(report.level, 'green'); assert.ok(report.checks.every(item => item.level === 'ok'));
  const result = await doctor.prescribe();
  assert.deepEqual(result.done, []); assert.deepEqual(calls, []);
});
await check('Holy cerrada en la TV → naranja sin arreglo automático (no se abre sola)', async () => {
  const { doctor, runtime } = make(); runtime.state = 'waiting';
  const report = await doctor.diagnose();
  const link = report.checks.find(item => item.id === 'tv-link');
  assert.equal(report.level, 'orange'); assert.equal(link.fix, null); assert.match(link.hint, /Abre Holy/);
});
await check('Sin conexión pero la TV responde → receta reconectar; TV apagada → solo consejo', async () => {
  const a = make(); a.runtime.state = 'offline';
  assert.equal((await a.doctor.diagnose()).checks.find(item => item.id === 'tv-link').fix, 'reconnect');
  await a.doctor.prescribe(); assert.deepEqual(a.calls, ['reconnect']);
  const b = make({ probe: async () => false }); b.runtime.state = 'offline';
  const report = await b.doctor.diagnose();
  assert.equal(report.checks.find(item => item.id === 'tv-net').level, 'warn');
  assert.equal(report.checks.find(item => item.id === 'tv-link').fix, null);
  assert.deepEqual((await b.doctor.prescribe()).done, []);
});
await check('IP del Mac cambiada → reinicia al final; sin vigilante lo dice en vez de matar el proceso', async () => {
  const a = make({ currentAddress: () => '10.0.0.9' });
  const result = await a.doctor.prescribe();
  assert.equal(result.restarting, true); assert.deepEqual(a.calls, []);
  await new Promise(r => setTimeout(r, 700)); assert.deepEqual(a.calls, ['restart']);
  const b = make({ currentAddress: () => '10.0.0.9', supervised: false });
  const noGuard = await b.doctor.prescribe();
  assert.equal(noGuard.restarting, false); assert.equal(noGuard.done.at(-1).ok, false); await new Promise(r => setTimeout(r, 700)); assert.deepEqual(b.calls, []);
});
await check('Catálogo viejo, vacío o con sitios caídos → recarga; arranque automático ausente: nota, solo se instala si se pide', async () => {
  const stale = make(); stale.catalog.updatedAt = NOW - 5 * 3600000;
  assert.match((await stale.doctor.diagnose()).checks.find(item => item.id === 'catalog').detail, /5 h/);
  const down = make(); down.catalog.sources = () => [{ id: 'x', name: 'Sitio X', health: { ok: false } }];
  assert.match((await down.doctor.diagnose()).checks.find(item => item.id === 'catalog').detail, /Sitio X/);
  await down.doctor.prescribe(); assert.deepEqual(down.calls, ['refresh']);
  const bare = make({ autostart: { status: async () => ({ installed: false, loaded: false }), install: async () => bare.calls.push('autostart') } });
  const report = await bare.doctor.diagnose();
  assert.deepEqual([report.level, report.checks.find(item => item.id === 'autostart').level], ['green', 'info']);
  await bare.doctor.prescribe(); assert.deepEqual(bare.calls, []);
  await bare.doctor.prescribe({ autostart: true }); assert.deepEqual(bare.calls, ['autostart']);
});
await check('Un arreglo que falla se informa y no impide los demás; dos recetas a la vez comparten trabajo', async () => {
  const c = make({ autostart: { status: async () => ({ installed: false }), install: async () => { throw Error('sin permiso'); } } });
  c.catalog.items = [];
  const [one, two] = await Promise.all([c.doctor.prescribe({ autostart: true }), c.doctor.prescribe()]);
  assert.equal(one, two);
  assert.deepEqual(one.done.map(item => [item.fix, item.ok]), [['refresh', true], ['autostart', false]]);
  assert.deepEqual(c.calls, ['refresh']);
});
await check('tcpOpen distingue puerto abierto y cerrado', async () => {
  const server = net_server(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  assert.equal(await tcpOpen('127.0.0.1', server.address().port), true);
  const port = server.address().port; await new Promise(r => server.close(r));
  assert.equal(await tcpOpen('127.0.0.1', port, 500), false);
});
function net_server() { return http.createServer(); }

await check('LaunchAgent: plist correcto, escapado, sin root, y se instala/quita con launchctl simulado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'holy-auto-'));
  try {
    const text = plist({ node: '/n/node', script: '/w/a&b/holy-supervisor.mjs', cwd: '/w/a&b', log: '/w/log' });
    assert.match(text, new RegExp(`<string>${LABEL}</string>`)); assert.match(text, /a&amp;b/); assert.match(text, /<key>KeepAlive<\/key><true\/>/); assert.match(text, /<key>RunAtLoad<\/key><true\/>/);
    const log = [];
    const auto = createAutostart({ cwd: dir, node: '/n/node', home: dir, uid: 501, exec: async (cmd, args) => { log.push([cmd, ...args].join(' ')); if (args[0] === 'print' && !log.some(l => l.includes('bootstrap'))) throw Error('no'); } });
    assert.deepEqual(await auto.status(), { installed: false, loaded: false });
    await auto.install();
    assert.match(readFileSync(auto.file, 'utf8'), /holy-supervisor\.mjs/);
    assert.ok(log.some(l => l === `launchctl bootstrap gui/501 ${auto.file}`));
    assert.deepEqual(await auto.status(), { installed: true, loaded: true });
    await auto.uninstall(); assert.equal((await auto.status()).installed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

await check('Servidor: GET /holy-api/doctor mira, POST receta, y sigue cerrado a quien no es de la red local', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'holy-doc-srv-'));
  const { doctor, calls } = make({ currentAddress: () => '10.0.0.9' });
  const server = startServer({ catalog: { items: [], sources: () => [], home: () => ({}), version: 1 }, library: { entries: [], votes: [], version: 1 }, doctor, port: 0, root: dir, imageDir: join(dir, 'img'), log: () => {} });
  await new Promise(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/holy-api/doctor`;
    const report = await (await fetch(base)).json();
    assert.equal(report.level, 'orange'); assert.equal(report.checks.find(item => item.id === 'ip').fix, 'restart');
    const done = await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain' } })).json();
    assert.equal(done.restarting, true); assert.equal(done.report.level, 'orange');
    await new Promise(r => setTimeout(r, 700)); assert.deepEqual(calls, ['restart']);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
console.log(`${passed} comprobaciones del Doctor, la receta y el arranque automático correctas.`);
