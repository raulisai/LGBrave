import {randomUUID} from 'node:crypto';

export const TV_PROFILE_PATH = '/tmp/luma-desktop-profile.json';
export const TV_PEER_REGISTRY_PATH = '/tmp/luma-peer-sync.json';
export const TV_PROFILE_MAX_BYTES = 1024 * 1024;
const fault = (code, message) => Object.assign(Error(message), {code});
const missing = error => error?.code === 2 || error?.code === 'ENOENT';
const valid = value => {
  try { return value && typeof value === 'object' && !Array.isArray(value) && value.v === 1; }
  catch { return false; }
};

export function createTVProfileStore({ssh, guard, commit, path = TV_PROFILE_PATH, timeout = 3000} = {}) {
  if (!ssh || typeof ssh.sftp !== 'function' || typeof guard !== 'function' || typeof commit !== 'function')
    throw fault('TV_PROFILE_CONFIG', 'El perfil compartido necesita una conexión y una reserva activas.');
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw fault('TV_PROFILE_CONFIG', 'El tiempo de espera del perfil compartido no es válido.');
  function checkLease() {
    try { if (guard() === false) throw Error(); }
    catch { throw fault('TV_PROFILE_LEASE', 'La reserva de la TV dejó de estar vigente.'); }
  }
  if(![TV_PROFILE_PATH,TV_PEER_REGISTRY_PATH].includes(path))throw fault('TV_PROFILE_CONFIG','Ruta de perfil inválida.');
  checkLease();

  function usingSFTP(operation) {
    return new Promise((resolve, reject) => {
      let channel, settled = false;
      const pending = new Set(), closedChannels = new WeakSet();
      const cancelled = () => fault('TV_PROFILE_CLOSED', 'Se cerró la transferencia del perfil compartido.');
      const closeChannel = (value, force = false) => {
        if (!value || closedChannels.has(value)) return;
        closedChannels.add(value);
        try {
          if (force && typeof value.destroy === 'function') value.destroy();
          else value.end();
        } catch { /* The SSH transport may already be gone. */ }
      };
      const finish = (error, value) => {
        if (settled) return;
        if (!error) { try { checkLease(); } catch (leaseError) { error = leaseError; } }
        settled = true; clearTimeout(timer); ssh.off?.('close', disconnected);
        const reason = error || cancelled();
        for (const fail of pending) fail(reason);
        pending.clear(); closeChannel(channel, !!error);
        if (error) reject(error.code?.startsWith?.('TV_PROFILE_') ? error : fault('TV_PROFILE_IO', 'No se pudo transferir el perfil compartido de la TV.'));
        else resolve(value);
      };
      const disconnected = () => finish(cancelled());
      const timer = setTimeout(() => finish(fault('TV_PROFILE_TIMEOUT', 'La transferencia del perfil compartido agotó su tiempo de espera.')), timeout);
      ssh.once?.('close', disconnected);
      const invoke = (method, args, cleanup = false) => new Promise((done, fail) => {
        if (settled) { fail(cancelled()); return; }
        try { if (!cleanup) checkLease(); } catch (error) { fail(error); return; }
        pending.add(fail);
        try {
          channel[method](...args, (error, ...values) => {
            pending.delete(fail);
            if (settled) { fail(cancelled()); return; }
            if (error) { fail(error); return; }
            try { if (!cleanup) checkLease(); done(values); } catch (leaseError) { fail(leaseError); }
          });
        } catch (error) { pending.delete(fail); fail(error); }
      });
      try {
        checkLease();
        ssh.sftp((error, opened) => {
          if (error) { closeChannel(opened, true); finish(error); return; }
          channel = opened;
          // A channel may arrive after a timeout. Always absorb its errors and
          // immediately close it instead of reviving a cancelled operation.
          channel.on('error', error => finish(error));
          channel.once('close', () => finish(cancelled()));
          if (settled) { closeChannel(channel, true); return; }
          Promise.resolve().then(() => { checkLease(); return operation(invoke, checkLease); }).then(value => finish(null, value), finish);
        });
      } catch (error) { finish(error); }
    });
  }

  return {
    read() {
      return usingSFTP(async invoke => {
        let handle;
        try {
          try { [handle] = await invoke('open', [path, 'r']); }
          catch (error) { if (missing(error)) return null; throw error; }
          const [stats] = await invoke('fstat', [handle]);
          if (!Number.isSafeInteger(stats?.size) || stats.size < 0 || stats.size > TV_PROFILE_MAX_BYTES)
            throw fault('TV_PROFILE_SIZE', 'El perfil compartido excede el límite de 1 MiB.');
          const chunks = []; let size = 0;
          while (true) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, TV_PROFILE_MAX_BYTES + 1 - size));
            const [bytes] = await invoke('read', [handle, buffer, 0, buffer.length, size]);
            if (!Number.isInteger(bytes) || bytes < 0 || bytes > buffer.length)
              throw fault('TV_PROFILE_IO', 'La TV devolvió una lectura de perfil inválida.');
            if (bytes === 0) break;
            size += bytes;
            if (size > TV_PROFILE_MAX_BYTES) throw fault('TV_PROFILE_SIZE', 'El perfil compartido excede el límite de 1 MiB.');
            chunks.push(buffer.subarray(0, bytes));
          }
          let snapshot;
          try { snapshot = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
          catch { throw fault('TV_PROFILE_FORMAT', 'El perfil compartido contiene un formato inválido.'); }
          if (!valid(snapshot)) throw fault('TV_PROFILE_FORMAT', 'La versión del perfil compartido no es compatible.');
          return snapshot;
        } finally {
          if (handle) await invoke('close', [handle], true).catch(() => {});
        }
      });
    },
    async write(snapshot) {
      checkLease();
      if (!valid(snapshot)) return Promise.reject(fault('TV_PROFILE_FORMAT', 'La versión del perfil compartido no es compatible.'));
      let body;
      try {
        const serialized = JSON.stringify(snapshot);
        if (typeof serialized !== 'string') throw Error();
        if (Buffer.byteLength(serialized) > TV_PROFILE_MAX_BYTES)
          return Promise.reject(fault('TV_PROFILE_SIZE', 'El perfil compartido excede el límite de 1 MiB.'));
        if (!valid(JSON.parse(serialized))) throw Error();
        body = Buffer.from(serialized);
      } catch { return Promise.reject(fault('TV_PROFILE_FORMAT', 'El perfil compartido contiene un formato inválido.')); }
      return usingSFTP(async (invoke, check) => {
        const temp = `${path}.${randomUUID()}.tmp`;
        let handle, created = false, committed = false;
        try {
          created = true;
          [handle] = await invoke('open', [temp, 'wx', {mode:0o600}]);
          await invoke('write', [handle, body, 0, body.length, 0]);
          await invoke('close', [handle], true); handle = null;
          check();
          committed = await commit(temp) === true;
          return committed;
        } finally {
          if (handle) await invoke('close', [handle], true).catch(() => {});
          if (created && !committed) await invoke('unlink', [temp], true).catch(() => {});
        }
      });
    }
  };
}
