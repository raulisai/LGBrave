import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostTrust, trustedSessionTarget, beginTrustedSession } from './ssh-host-trust.mjs';
const directory = mkdtempSync(join(tmpdir(), 'luma-host-trust-'));
const first = 'a'.repeat(64), changed = 'b'.repeat(64);
try {
  const trust = createHostTrust('lg-lab', { directory });
  assert.equal(trust.verify(first), true); assert.equal(readdirSync(directory).length, 0, 'Handshake alone must not persist trust');
  trust.commit(); const files = readdirSync(directory); assert.equal(files.length, 1);
  const file = join(directory, files[0]), pin = JSON.parse(readFileSync(file));
  assert.equal(pin.fingerprint, first);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  const same = trustedSessionTarget({ name: 'lg-lab', host: '192.168.1.88', port: 9922, privateKey: 'client-only' }, 'lg-lab', { directory });
  assert.equal(same.target.hostHash, 'sha256'); assert.equal(same.target.privateKey, 'client-only');
  assert.equal(same.target.hostVerifier(first), true); same.trust.commit();
  assert.equal(same.target.hostVerifier(changed), false); assert.match(same.trust.error.message, /cambió/); assert.throws(() => same.trust.commit());
  assert.equal(JSON.parse(readFileSync(file)).fingerprint, first, 'Mismatch never replaces the pin');
  // Two successful handshakes racing to enroll different identities cannot both win.
  const a = createHostTrust('other', { directory }), b = createHostTrust('other', { directory });
  assert.equal(a.verify(first), true); assert.equal(b.verify(changed), true); a.commit(); assert.throws(() => b.commit());
  const duplicate = createHostTrust('other', { directory }); assert.equal(duplicate.verify(first), true); duplicate.commit();
  writeFileSync(file, '{broken'); const corrupt = createHostTrust('lg-lab', { directory }); assert.equal(corrupt.verify(first), false); assert.throws(() => corrupt.commit());
  writeFileSync(file, JSON.stringify(pin));
  assert.throws(() => trust.forget(changed)); trust.forget(first); assert.ok(!readdirSync(directory).includes(files[0]));
  assert.throws(() => createHostTrust('../escape', { directory }));
  const invalid = createHostTrust('invalid', { directory }); assert.equal(invalid.verify('bad-hash'), false);
  // The production wrapper commits only the SDK's authenticated-ready callback.
  const authDir = join(directory, 'auth');
  let key = first, allowed, authenticated = false, destroyed = 0;
  const begin = (target, callback) => { allowed = target.hostVerifier(key); callback(authenticated && allowed ? null : Error('auth failed'), { ssh: { destroy() { destroyed++; } } }); };
  const authenticate = () => new Promise((resolve, reject) => beginTrustedSession(begin, { name: 'tv', host: '192.168.1.1' }, 'tv', (error, value) => error ? reject(error) : resolve(value), { directory: authDir }));
  await assert.rejects(authenticate(), /auth failed/);
  const uncommitted = createHostTrust('tv', { directory: authDir }); assert.equal(uncommitted.verify(changed), true, 'Unauthenticated host was not enrolled');
  authenticated = true; await authenticate(); key = changed;
  await assert.rejects(authenticate(), { code: 'TV_HOST_IDENTITY' }); assert.equal(allowed, false);
  assert.equal(destroyed, 0);
  console.log('SSH: primer uso solo tras autenticación, pin persistente, cambio/DHCP, carreras, archivo dañado y recuperación explícita correctos (sin TV).');
} finally { rmSync(directory, { recursive: true, force: true }); }
