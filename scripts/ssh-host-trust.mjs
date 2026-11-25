import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

export const hostTrustDirectory = () => join(process.env.LOCALAPPDATA || join(homedir(), '.config'), 'HolyLuma', 'tv-hosts');
const problem = message => Object.assign(new Error(message), { code: 'TV_HOST_IDENTITY' });

// Trust-on-first-use, committed only AFTER successful SSH client authentication.
// The pin follows the named TV profile across DHCP address changes, not an IP alone.
export function createHostTrust(profile, { directory = hostTrustDirectory() } = {}) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile || '')) throw problem('El perfil de la TV no es válido para verificar su identidad.');
  const file = join(directory, createHash('sha256').update(profile).digest('hex') + '.json');
  let observed = '', failure;
  const read = () => {
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw problem('No se pudo leer la identidad guardada de la TV.'); }
    let data; try { data = JSON.parse(text); } catch { throw problem('La identidad guardada de la TV está dañada; no se reemplazará automáticamente.'); }
    if (data?.v !== 1 || data.profile !== profile || !/^[a-f0-9]{64}$/.test(data.fingerprint || '')) throw problem('La identidad guardada de la TV no es válida.');
    return data.fingerprint;
  };
  const verify = hash => {
    try {
      if (!/^[a-f0-9]{64}$/.test(hash || '')) throw problem('La TV no presentó una identidad SSH válida.');
      const known = read();
      if (known && known !== hash) throw problem('La identidad SSH de la TV cambió. Comprueba el dispositivo antes de volver a vincular; Doctor no borrará esta protección.');
      observed = hash; return true;
    } catch (error) { failure = error; return false; }
  };
  return {
    verify,
    get error() { return failure; },
    commit() {
      if (failure) throw failure;
      if (!observed) throw problem('No se pudo verificar la identidad SSH de la TV.');
      const known = read();
      if (known === observed) return;
      if (known) throw problem('La identidad SSH de la TV cambió durante la vinculación.');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        writeFileSync(file, JSON.stringify({ v: 1, profile, fingerprint: observed }) + '\n', { flag: 'wx', mode: 0o600 });
      } catch (error) {
        // Two authenticated discovery/tunnel sessions may complete at once.
        if (error.code !== 'EEXIST' || read() !== observed) throw problem('No se pudo guardar con seguridad la identidad de la TV.');
      }
    },
    // Explicit local recovery only. Expected fingerprint prevents deleting a concurrently new pin.
    forget(expected) {
      const known = read();
      if (!known || known !== expected) throw problem('La huella indicada no coincide con la identidad guardada.');
      unlinkSync(file);
    }
  };
}

export function trustedSessionTarget(target, profile, options) {
  const trust = createHostTrust(target.name || profile, options);
  return { target: { ...target, keepaliveInterval: 5000, keepaliveCountMax: 2, hostHash: 'sha256', hostVerifier: trust.verify }, trust };
}

// Shared by inspector and peer discovery through connectSession; the SDK callback is auth-ready.
export function beginTrustedSession(begin, target, profile, next, options) {
  const verified = trustedSessionTarget(target, profile, options);
  return begin(verified.target, (error, result) => {
    if (error) return next(verified.trust.error || error);
    try { verified.trust.commit(); }
    catch (failure) { result?.ssh?.destroy(); return next(failure); }
    return next(null, result);
  });
}
