import assert from 'node:assert/strict';
import net from 'node:net';
import {createRequire} from 'node:module';
import {refreshDeviceList} from './inspector-tunnel.mjs';
import {createDoctor} from './holy/doctor.mjs';
import {createDesktopRepair} from '../desktop/shared/desktop-repair.mjs';
import {RepairJournal} from '../desktop/shared/repair-journal.mjs';
import {subnetHosts, scanPort, findMovedTv, createTvFinder, tcpOpen} from '../desktop/shared/tv-discovery.mjs';

// The TV changes IP by DHCP (.134 → .154 → .155, 18–19/11). Simulated network, no TV.
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };

await check('Solo la /24 propia de red local, sin esta computadora', () => {
  const hosts = subnetHosts('192.168.1.65');
  assert.equal(hosts.length, 253); assert.ok(!hosts.includes('192.168.1.65')); assert.equal(hosts[0], '192.168.1.1');
  assert.deepEqual(subnetHosts('8.8.8.8'), []); assert.deepEqual(subnetHosts(''), []); assert.equal(subnetHosts('172.20.0.9').length, 253);
});

const network = {'192.168.1.20': true, '192.168.1.155': true, '192.168.1.200': true};
const open = async host => !!network[host];

await check('Encuentra solo la TV que acepta la llave (no otra LG ni un aparato con el puerto abierto)', async () => {
  const tried = [];
  const result = await findMovedTv({current: '192.168.1.154', lan: '192.168.1.65', open, verify: async host => { tried.push(host); return host === '192.168.1.155'; }});
  assert.equal(result.host, '192.168.1.155'); assert.equal(result.candidates, 3);
  assert.deepEqual(tried, ['192.168.1.20', '192.168.1.155']);
  const none = await findMovedTv({current: '192.168.1.154', lan: '192.168.1.65', open, verify: async () => false});
  assert.equal(none.host, '');
});

await check('scanPort usa sockets reales', async () => {
  const server = net.createServer(socket => socket.end()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const {port} = server.address();
  assert.equal(await tcpOpen('127.0.0.1', port), true);
  assert.deepEqual(await scanPort(['127.0.0.1'], port), ['127.0.0.1']);
  server.close();
  assert.equal(await tcpOpen('127.0.0.1', port, 500), false);
});

function finder(over = {}) {
  let time = 0, saved = '', address = {host: '192.168.1.154', port: 9922, configured: true};
  const events = [];
  const f = createTvFinder({address: () => address, lan: () => '192.168.1.65', profile: () => ({privateKey: {openSsh: 'k'}}),
    save: ip => { saved = ip; address = {...address, host: ip}; }, log: (event, data) => events.push([event, data.state]),
    now: () => time, open, verify: async host => host === '192.168.1.155', ...over});
  return {f, events, saved: () => saved, tick: ms => { time += ms; }, setNetwork: (ip, on) => { network[ip] = on; }};
}

await check('Fuera de línea y la IP guardada mudo: guarda la nueva', async () => {
  const t = finder();
  assert.equal(t.f.maybe('connected'), null); assert.equal(t.f.maybe('waiting'), null); assert.equal(t.f.maybe('standby'), null);
  const result = await t.f.maybe('offline');
  assert.deepEqual(result, {found: '192.168.1.155', from: '192.168.1.154'});
  assert.equal(t.saved(), '192.168.1.155'); assert.deepEqual(t.events, [['tv-moved', 'found']]);
});

await check('No busca si la IP guardada contesta (la TV está, solo falla otra cosa)', async () => {
  const t = finder({address: () => ({host: '192.168.1.155', port: 9922, configured: true})});
  assert.deepEqual(await t.f.maybe('offline'), {skipped: 'answers'}); assert.equal(t.saved(), '');
});

await check('TV apagada: espera cada vez más entre búsquedas, sin cambiar nada', async () => {
  const t = finder({verify: async () => false});
  assert.deepEqual(await t.f.maybe('offline'), {found: ''});
  t.tick(30000); assert.equal(t.f.maybe('offline'), null);
  t.tick(31000); assert.deepEqual(await t.f.maybe('offline'), {found: ''});
  t.tick(61000); assert.equal(t.f.maybe('offline'), null, 'segunda espera de 2 min');
  t.tick(60000); assert.deepEqual(await t.f.maybe('offline'), {found: ''});
  assert.equal(t.saved(), ''); assert.ok(t.events.every(([event]) => event === 'tv-search'));
  assert.deepEqual(await t.f.search(), {found: ''}, 'el Doctor busca ya, sin esperar el turno');
});

await check('Sin perfil webOS no busca; una búsqueda a la vez', async () => {
  assert.deepEqual(await finder({profile: () => undefined}).f.maybe('offline'), {skipped: 'not-configured'});
  let release;
  const t = finder({find: () => new Promise(resolve => { release = resolve; })});
  const first = t.f.maybe('offline');
  await new Promise(resolve => setImmediate(resolve));
  t.tick(120000); assert.equal(t.f.maybe('offline'), null); assert.equal(t.f.busy, true);
  release({host: ''}); await first; assert.equal(t.f.busy, false);
});

await check('El SDK usa la IP nueva sin reiniciar el servicio (relee novacom-devices.json)', () => {
  const Appdata = createRequire(import.meta.url)('@webos-tools/cli/lib/base/cli-appdata');
  const data = new Appdata(), original = data.deviceList;
  try {
    refreshDeviceList({read: () => [{name: 'lg-lab', host: '192.168.1.155'}]});
    assert.equal(new Appdata().getDeviceList().find(d => d.name === 'lg-lab').host, '192.168.1.155');
    refreshDeviceList({read: () => { throw Error('roto'); }});
    refreshDeviceList({read: () => []});
    assert.equal(new Appdata().getDeviceList()[0].host, '192.168.1.155', 'un archivo roto o vacío no borra la copia');
  } finally { data.deviceList = original; }
});

await check('Doctor de la TV: si no responde, busca la TV y dice dónde quedó o qué revisar', async () => {
  const make = findTv => {
    const runtime = {state: 'offline', disconnect: async () => {}};
    const catalog = {items: [{}], updatedAt: Date.now(), sources: () => [], refresh: async () => {}};
    return createDoctor({catalog, library: {entries: []}, runtime, startedAddress: '10.0.0.2', currentAddress: () => '10.0.0.2', tv: () => ({host: '192.168.1.154', port: 9922}),
      autostart: {status: async () => ({installed: true, loaded: true}), install: async () => {}}, supervised: true, restart: () => {}, probe: async () => false, rss: () => 1e8, log: () => {}, findTv});
  };
  let searches = 0;
  const found = make(async () => { searches++; return {found: '192.168.1.155', from: '192.168.1.154'}; });
  assert.equal((await found.diagnose()).checks.find(item => item.id === 'tv-net').fix, 'find-tv');
  const result = await found.prescribe();
  assert.equal(searches, 1); assert.match(result.done.find(item => item.fix === 'find-tv').text, /ahora está en 192\.168\.1\.155/);
  const off = await make(async () => ({found: ''})).prescribe();
  const missing = off.done.find(item => item.fix === 'find-tv');
  assert.equal(missing.ok, false); assert.match(missing.text, /enciéndela/);
  const old = await make(undefined).diagnose();
  assert.equal(old.checks.find(item => item.id === 'tv-net').fix, null, 'sin buscador, solo el consejo');
});

await check('Doctor del panel: TV inaccesible → la busca, guarda y despierta; no la encuentra → espera sin reiniciar', async () => {
  const base = {state: 'offline', running: true, tv: {configured: true, needsUpdate: false}, tvReachable: false};
  const recovery = {restore: () => ({restored: false}), capture() {}, keyPresent: () => true};
  let state = {...base}, wakes = 0, restarts = 0;
  const repair = createDesktopRepair({status: async () => state, recovery, start: async () => {}, restart: async () => { restarts++; },
    wake: async () => { wakes++; state = {...base, state: 'waiting', tvReachable: true}; }, journal: new RepairJournal(), verifyAttempts: 2, verifyDelay: 1,
    findTv: async () => ({found: '192.168.1.155', from: '192.168.1.154'})});
  const fixed = await repair();
  assert.equal(fixed.diagnosis.code, 'tv-unreachable'); assert.equal(wakes, 1); assert.equal(fixed.state, 'waiting');
  assert.ok(fixed.actions.some(text => /ahora está en 192\.168\.1\.155/.test(text)));
  state = {...base};
  const none = await createDesktopRepair({status: async () => state, recovery, start: async () => {}, restart: async () => { restarts++; }, wake: async () => { wakes++; },
    journal: new RepairJournal(), findTv: async () => ({found: ''})})();
  assert.equal(none.repair.outcome, 'waiting'); assert.equal(none.repair.ok, true); assert.equal(wakes, 1); assert.equal(restarts, 0);
  assert.ok(none.actions.some(text => /enciéndela/.test(text)));
});

console.log(`${passed} comprobaciones de la TV con otra IP: búsqueda en la red, solo con la llave propia, espera creciente y sin TV.`);
