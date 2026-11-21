import assert from 'node:assert/strict';
import net from 'node:net';
import {createRequire} from 'node:module';
import {refreshDeviceList} from './inspector-tunnel.mjs';
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

console.log(`${passed} comprobaciones de la TV con otra IP: búsqueda en la red, solo con la llave propia, espera creciente y sin TV.`);
