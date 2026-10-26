// Handover between computers, holder names and port conflicts. No TV, no Internet.
import assert from 'node:assert/strict';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {acquireTVLease, leaseLabel, requestTVHandoff, tvLeaseHolder} from './tv-lease.mjs';
import {openInspectorTunnel, requestHandoff} from './inspector-tunnel.mjs';
import {LabRuntime} from './lab-runtime.mjs';
import {busyPorts, describeBusy, portOwner} from '../desktop/shared/port-check.mjs';

let passed = 0;
const check = async (label, fn) => { try { await fn(); passed++; } catch (error) { console.error('✗ ' + label); throw error; } };
const within = (promise, ms, what) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(what)), ms); })]).finally(() => clearTimeout(timer)); };

await check('A computer label cannot break out of the shell quotes', () => {
  const label = leaseLabel("Mac'; reboot; echo '", '192.168.1.5; rm -rf /');
  assert.ok(!/['";$`|&]/.test(label), label);
  assert.equal(leaseLabel('DESKTOP-PC', '192.168.1.9'), 'DESKTOP-PC (192.168.1.9)');
  assert.equal(leaseLabel('', ''), 'computadora');
});

await check('Taking the TV records who and since when, and clears an old handover request', async () => {
  const commands = [];
  const lease = await acquireTVLease(null, {label:'MacBook|192.168.1.5', run:async command => { commands.push(command); return command.includes('echo released') ? 'released' : 'acquired'; }});
  assert.match(commands[0], /printf '%s' 'MacBook \(192\.168\.1\.5\)' > "\$d\/info"/);
  assert.match(commands[0], /date \+%s > "\$d\/since"/);
  assert.match(commands[0], /rm -f \/tmp\/luma-desktop-handoff/);
  await lease.release();
  assert.match(commands.at(-1), /"\$d\/since" "\$d\/info"/, 'release removes every lease file so rmdir works');
});

await check('A busy TV says which computer serves it', async () => {
  await assert.rejects(acquireTVLease(null, {run:async command => command.includes('echo checked') ? 'checked' : command.startsWith('cat ') ? 'DESKTOP-PC (192.168.1.9)' : 'busy'}),
    error => error.code === 'TV_BUSY' && error.holder === 'DESKTOP-PC (192.168.1.9)' && /DESKTOP-PC/.test(error.message));
  // The stale reap also removes info/since, or rmdir would keep a dead lease forever.
  const commands = [];
  await assert.rejects(acquireTVLease(null, {run:async command => { commands.push(command); return command.includes('echo checked') ? 'checked' : command.startsWith('cat ') ? '' : 'busy'; }}),
    error => error.code === 'TV_BUSY' && error.holder === '' && /reserva de asistencia vigente/.test(error.message));
  assert.ok(commands.some(command => command.includes('echo checked') && command.includes('"$d/info"')));
});

await check('The serving computer yields on a handover request and frees the TV', async () => {
  let releases = 0, reason;
  const lease = await acquireTVLease(null, {interval:5, onLost:value => { reason = value; }, run:async command => {
    if (command.includes('echo released')) { releases++; return 'released'; }
    if (command.includes('echo acquired')) return 'acquired';
    return 'handoff DESKTOP-PC (192.168.1.9)';
  }});
  const lost = await within(lease.lost, 500, 'No cedió la TV');
  assert.deepEqual(lost, {type:'handoff', by:'DESKTOP-PC (192.168.1.9)'});
  assert.deepEqual(reason, lost);
  await lease.release();
  assert.equal(releases, 1, 'yielding releases the lease once');
  assert.throws(() => lease.assertActive(), /vigente/);
});

await check('A renewal only honours handover requests made after its lease began', async () => {
  let renew;
  const lease = await acquireTVLease(null, {interval:5, run:async command => {
    if (command.includes('echo acquired')) return 'acquired';
    if (command.includes('echo renewed')) { renew = command; return 'renewed'; }
    return 'released';
  }});
  await new Promise(resolve => setTimeout(resolve, 20));
  await lease.release();
  assert.match(renew, /\[ "\$t" -ge "\$s" \]/);
  assert.match(renew, /case "\$t" in ''\|\*\[!0-9\]\*\) t=0;; esac/);
});

await check('Asking for the TV writes a request only when someone holds it', async () => {
  const commands = [];
  assert.deepEqual(await requestTVHandoff(async command => { commands.push(command); return 'requested DESKTOP-PC (192.168.1.9)'; }, 'MacBook|192.168.1.5'),
    {state:'requested', holder:'DESKTOP-PC (192.168.1.9)'});
  assert.match(commands[0], /'MacBook \(192\.168\.1\.5\)' > \/tmp\/luma-desktop-handoff/);
  assert.deepEqual(await requestTVHandoff(async () => 'free'), {state:'free', holder:''});
  assert.deepEqual(await tvLeaseHolder(async () => 'held MacBook (192.168.1.5)'), {held:true, holder:'MacBook (192.168.1.5)'});
  assert.deepEqual(await tvLeaseHolder(async () => 'free'), {held:false, holder:''});
});

const fakeSession = () => {
  const ssh = new EventEmitter(); ssh.ended = 0; ssh.end = () => { ssh.ended++; };
  return {ssh};
};
await check('«Usar esta computadora» waits until the other computer yields', async () => {
  const session = fakeSession();
  let reads = 0;
  const result = await requestHandoff({connect:async () => session, label:'MacBook|192.168.1.5', sleep:async () => {}, command:async (_ssh, text) => {
    if (text.includes('luma-desktop-handoff')) return 'requested DESKTOP-PC (192.168.1.9)';
    return ++reads < 3 ? 'held DESKTOP-PC (192.168.1.9)' : 'free';
  }});
  assert.deepEqual(result, {state:'yielded', holder:'DESKTOP-PC (192.168.1.9)'});
  assert.equal(session.ssh.ended, 1, 'its own SSH session is closed');
  const old = await requestHandoff({connect:async () => fakeSession(), wait:3000, sleep:async () => {}, command:async (_ssh, text) =>
    text.includes('luma-desktop-handoff') ? 'requested ' : 'held '});
  assert.equal(old.state, 'requested', 'an older computer that ignores the request is reported, not hidden');
});

await check('The tunnel tells why it closed when the TV was handed over', async () => {
  const session = fakeSession();
  let yieldTV;
  const tunnel = await openInspectorTunnel({device:'test', connect:async () => session, reserve:true, label:'MacBook|192.168.1.5',
    command:async () => '0',
    acquireLease:async (_ssh, options) => {
      assert.equal(options.label, 'MacBook|192.168.1.5');
      return {lost:new Promise(resolve => { yieldTV = resolve; }), assertActive() {}, release:async () => {}};
    }});
  yieldTV({type:'handoff', by:'DESKTOP-PC (192.168.1.9)'});
  assert.deepEqual(await within(tunnel.closed, 500, 'El túnel no cerró'), {type:'handoff', by:'DESKTOP-PC (192.168.1.9)'});
});

await check('After yielding, a computer pauses before retrying; «Usar esta computadora» ends the pause', async () => {
  let now = 1000, opened = 0, handOver;
  const runtime = new LabRuntime({log:() => {}, now:() => now, handoffPause:120000,
    openTunnel:async () => { opened++; return {endpoint:'fake', closed:new Promise(resolve => { handOver = resolve; }), close() {}}; },
    targets:async () => [{id:'l', description:'com.lgapp.lab'}], connect:async () => ({target:{id:'l'}, close() {}}),
    makeBridge:() => ({async start() {}, async status() {}, async stop() {}})});
  try {
    await runtime.step(); assert.equal(runtime.state, 'connected');
    handOver({type:'handoff', by:'DESKTOP-PC (192.168.1.9)'});
    await new Promise(resolve => setImmediate(resolve)); await runtime.disconnecting;
    assert.equal(runtime.state, 'standby'); assert.match(runtime.lastError, /DESKTOP-PC.*2 min/);
    await runtime.step(); assert.equal(opened, 1, 'no retry during the pause');
    now += 121000; await runtime.step(); assert.equal(opened, 2, 'retries after the pause');
    handOver({type:'handoff', by:'DESKTOP-PC'}); await new Promise(resolve => setImmediate(resolve)); await runtime.disconnecting;
    runtime.wake(); await runtime.step(); assert.equal(opened, 3, 'wake ends the pause');
  } finally { await runtime.close(); }
});

await check('A busy TV leaves its holder on the runtime for the menu', async () => {
  const runtime = new LabRuntime({log:() => {}, openTunnel:async () => { const error = Error('ocupada'); error.code = 'TV_BUSY'; error.holder = 'DESKTOP-PC (192.168.1.9)'; throw error; }});
  try { await runtime.step(); assert.equal(runtime.state, 'standby'); assert.equal(runtime.holder, 'DESKTOP-PC (192.168.1.9)'); }
  finally { await runtime.close(); }
});

await check('A port held by another program is reported with its owner instead of crashing', async () => {
  const holder = net.createServer();
  await new Promise(resolve => holder.listen(0, '0.0.0.0', resolve));
  const port = holder.address().port;
  try {
    const busy = await busyPorts([port], () => 'node (pid 1907)');
    assert.deepEqual(busy, [{port, owner:'node (pid 1907)'}]);
    assert.match(describeBusy(busy), new RegExp(`El puerto ${port} \\(lo usa node \\(pid 1907\\)\\) está ocupado`));
  } finally { await new Promise(resolve => holder.close(resolve)); }
  assert.deepEqual(await busyPorts([port], () => 'x'), []);
  assert.equal(portOwner(43190, 'darwin', () => 'p1907\ncnode\n'), 'node (pid 1907)');
  assert.equal(portOwner(43190, 'win32', file => file === 'netstat'
    ? '  TCP    0.0.0.0:43190    0.0.0.0:0    LISTENING    4242\r\n' : '"node.exe","4242","Console","1","40,000 K"\r\n'), 'node.exe (pid 4242)');
  assert.equal(portOwner(43190, 'darwin', () => { throw Error('sin lsof'); }), '');
});

console.log(`${passed} comprobaciones de relevo entre computadoras, nombre del equipo activo y puertos ocupados correctas (sin TV).`);
