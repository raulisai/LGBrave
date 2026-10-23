import net from 'node:net';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

// novacom adds five process listeners per session and never removes them; on
// Ctrl+C they force process.exit() before the lab can stop cleanly. The tunnel
// closes its own SSH session, so they are dropped right away.
const PROCESS_EVENTS = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM', 'exit'];
async function connectSession(device) {
  // SSH only. inspect._runApp() can launch an app the user has closed.
  const {Session} = require('@webos-tools/cli/lib/base/novacom');
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
    try { session = new Session(device, false, finish); } catch (error) { finish(error); }
  });
}

export async function openInspectorTunnel({device = 'lg-lab', connect = connectSession} = {}) {
  const session = await connect(device);
  const sockets = new Set();
  let ended = false, resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const server = net.createServer(client => {
    sockets.add(client);
    client.on('error', () => client.destroy());
    client.once('close', () => sockets.delete(client));
    session.ssh.forwardOut('127.0.0.1', client.remotePort, '127.0.0.1', 9998, (error, remote) => {
      if (error || ended || client.destroyed) { client.destroy(); remote?.destroy(); return; }
      sockets.add(remote);
      remote.on('error', () => client.destroy());
      remote.once('close', () => { sockets.delete(remote); client.destroy(); });
      client.once('close', () => remote.destroy());
      client.pipe(remote); remote.pipe(client);
    });
  });
  function close() {
    if (ended) return;
    ended = true;
    for (const socket of sockets) socket.destroy();
    sockets.clear(); server.close(); session.ssh.end(); resolveClosed();
  }
  session.ssh.once('close', close);
  session.ssh.on('error', close);
  server.on('error', close);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    if (ended) throw Error('La conexión se cerró antes de abrir el túnel.');
    return {endpoint: `http://127.0.0.1:${server.address().port}`, closed, close};
  } catch (error) { close(); throw error; }
}
