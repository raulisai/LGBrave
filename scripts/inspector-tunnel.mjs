import net from 'node:net';
import {createRequire} from 'node:module';
import {config} from './desktop-config.mjs';
import {acquireTVLease, sshCommand} from './tv-lease.mjs';
import {createTVProfileStore} from '../desktop/shared/tv-profile-store.mjs';
const require = createRequire(import.meta.url);

// novacom adds five process listeners per session and never removes them; on
// Ctrl+C they force process.exit() before the lab can stop cleanly. The tunnel
// closes its own SSH session, so they are dropped right away.
const PROCESS_EVENTS = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'exit'];
export async function connectSession(device) {
  // SSH only. inspect._runApp() can launch an app the user has closed.
  const {Session} = require('@webos-tools/cli/lib/base/novacom');
  class AssistSession extends Session {
    begin(target, next) {
      return super.begin({...target, keepaliveInterval:5000, keepaliveCountMax:2}, next);
    }
  }
  const before = new Map(PROCESS_EVENTS.map(event => [event, new Set(process.listeners(event))]));
  const dropHooks = () => {
    for (const event of PROCESS_EVENTS) for (const listener of process.listeners(event)) if (!before.get(event).has(listener)) process.removeListener(event, listener);
  };
  return new Promise((resolve, reject) => {
    let settled = false, session;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); dropHooks();
      if (error) { session?.ssh?.destroy(); reject(error instanceof Error ? error : Error('No se pudo abrir la conexión de desarrollo.')); }
      else resolve(session);
    };
    const timer = setTimeout(() => finish(Error('La TV no respondió a la conexión de desarrollo.')), 12000);
    try { session = new AssistSession(device, false, finish); } catch (error) { finish(error); }
  });
}

export async function openInspectorTunnel({
  device = config().device, connect = connectSession, reserve = connect === connectSession,
  acquireLease = acquireTVLease, command = sshCommand
} = {}) {
  const session = await connect(device);
  let lease, ended = false, closing, resolveClosed;
  const sockets = new Set();
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const server = net.createServer(client => {
    if (ended) { client.destroy(); return; }
    sockets.add(client);
    client.on('error', () => client.destroy());
    client.once('close', () => sockets.delete(client));
    try {
      session.ssh.forwardOut('127.0.0.1', client.remotePort, '127.0.0.1', 9998, (error, remote) => {
        // SSH can deliver its forward after the local socket or lease is gone.
        remote?.on('error', () => client.destroy());
        if (error || ended || client.destroyed) { client.destroy(); remote?.destroy(); return; }
        sockets.add(remote);
        remote.once('close', () => { sockets.delete(remote); client.destroy(); });
        client.once('close', () => remote.destroy());
        client.pipe(remote); remote.pipe(client);
      });
    } catch { client.destroy(); }
  });
  function close() {
    if (closing) return closing;
    ended = true;
    for (const socket of sockets) socket.destroy();
    sockets.clear(); server.close();
    closing = Promise.resolve().then(() => lease?.release()).catch(() => {}).finally(() => {
      try { session.ssh.end(); } catch { /* A failed SSH transport is already closed. */ }
      resolveClosed();
    });
    return closing;
  }
  session.ssh.once('close', close);
  session.ssh.on('error', close);
  server.on('error', close);
  server.on('listening', () => { if (ended) server.close(); });
  try {
    if (reserve) {
      lease = await acquireLease(session.ssh);
      if (ended) throw Error('La conexión se cerró durante la reserva.');
      lease.lost.then(close);
      // Older runtimes do not know the lease. Respect every established
      // inspector client, including a user's DevTools session.
      const clients = await command(session.ssh, `for f in /proc/net/tcp /proc/net/tcp6; do if [ -r "$f" ]; then cat "$f"; fi; done | awk '$2 ~ /:270E$/ && $4 == "01" {n++} END {print n+0}'`);
      if (ended) throw Error('La conexión se cerró al consultar el inspector.');
      lease.assertActive();
      if (!/^\d+$/.test(clients) || Number(clients) > 0) {
        const count = Number(clients);
        const message = /^\d+$/.test(clients)
          ? `El inspector de la TV conserva ${count} ${count === 1 ? 'conexión abierta' : 'conexiones abiertas'} fuera de esta reserva. Puede ser una sesión anterior o DevTools; se espera sin interrumpirla.`
          : 'La TV no confirmó el estado del inspector; se reintentará sin interceptar.';
        const error = Error(message);
        error.code = 'TV_BUSY'; error.reason = 'inspector'; throw error;
      }
    }
    await Promise.race([
      new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', listening); reject(error); };
        const listening = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', listening);
        server.listen(0, '127.0.0.1');
      }),
      closed.then(() => { throw Error('La conexión se cerró antes de abrir el túnel.'); })
    ]);
    if (ended) throw Error('La conexión se cerró antes de abrir el túnel.');
    const assertActive=() => {
      if (ended) throw Error('El túnel está cerrado.');
      lease?.assertActive();
    };
    const profile=reserve&&typeof session.ssh.sftp==='function'&&lease?.commitSnapshot
      ?createTVProfileStore({ssh:session.ssh,guard:assertActive,commit:path=>lease.commitSnapshot(path)}):null;
    return {endpoint:`http://127.0.0.1:${server.address().port}`, closed, close, assertActive, profile};
  } catch (error) {
    await close();
    // A lease can arrive after a transport error already completed close().
    await lease?.release();
    throw error;
  }
}
