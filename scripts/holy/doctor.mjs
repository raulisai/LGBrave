import net from 'node:net';

// «El Doctor»: mira qué está bien y qué no en el Mac de Holy (dirección, TV, puente,
// catálogo, arranque automático) y puede «recetar» los arreglos seguros. Nunca abre
// ni navega la TV: solo reconecta la sesión pasiva y reinicia el proceso del Mac.
// Niveles: ok = verde, warn = naranja (hay algo), info = nota que no cambia el color.
// El rojo lo decide quien mira (la pantalla o el menú) cuando no alcanza al Mac.
// El arranque automático es decisión del dueño: solo se instala si se pide expresamente.
const STALE_CATALOG = 3 * 3600 * 1000;
const MAX_RSS = 1.5 * 1024 ** 3;

export const tcpOpen = (host, port, ms = 2500) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  const done = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(ms, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});

// Every dependency is injected so the tests need no TV, network or launchctl.
export function createDoctor({
  catalog, library, runtime, tv = { host: '192.168.1.134', port: 9922 }, startedAddress, currentAddress,
  autostart = { status: async () => ({ installed: true, loaded: true }), install: async () => {} },
  supervised = !!process.env.HOLY_SUPERVISED, restart = () => process.kill(process.pid, 'SIGTERM'),
  probe = tcpOpen, now = Date.now, rss = () => process.memoryUsage().rss, log = console.log
} = {}) {
  const check = (id, label, level, detail, fix = null, hint = '') => ({ id, label, level, detail, fix, hint });

  async function diagnose() {
    const checks = [];
    const address = currentAddress();
    checks.push(address === startedAddress
      ? check('ip', 'Dirección del Mac', 'ok', address)
      : check('ip', 'Dirección del Mac', 'warn', `Cambió de ${startedAddress} a ${address}`, 'restart', 'Se reinicia para anunciar la nueva dirección.'));

    const reachable = await probe(tv.host, tv.port);
    checks.push(reachable
      ? check('tv-net', 'TV en la red', 'ok', `${tv.host} responde`)
      : check('tv-net', 'TV en la red', 'warn', `${tv.host} no responde`, null, 'Enciende la TV y comprueba que está en el mismo Wi-Fi que el Mac.'));

    const state = runtime?.state;
    if (state === 'connected') checks.push(check('tv-link', 'Conexión con Holy en la TV', 'ok', 'Conectado'));
    else if (state === 'waiting') checks.push(check('tv-link', 'Conexión con Holy en la TV', 'warn', 'Holy no está abierta en la TV', null, 'Abre Holy con el control; el Mac no la abre solo.'));
    else checks.push(check('tv-link', 'Conexión con Holy en la TV', 'warn', state === 'offline' ? 'Sin conexión con la TV' + (runtime.lastError ? ` (${runtime.lastError})` : '') : 'Todavía sin conectar', reachable ? 'reconnect' : null,
      reachable ? 'Se cierra la sesión vieja y se vuelve a conectar.' : 'Primero hay que encender la TV.'));

    const failing = catalog.sources().filter(source => source.health && !source.health.ok).map(source => source.name || source.id);
    const age = now() - (catalog.updatedAt || 0);
    if (!catalog.items.length) checks.push(check('catalog', 'Catálogo', 'warn', 'Vacío', 'refresh', 'Se vuelve a leer cada sitio.'));
    else if (age > STALE_CATALOG) checks.push(check('catalog', 'Catálogo', 'warn', `Sin actualizar hace ${Math.round(age / 3600000)} h`, 'refresh', 'Se vuelve a leer cada sitio.'));
    else if (failing.length) checks.push(check('catalog', 'Catálogo', 'warn', `Sitios con fallo: ${failing.join(', ')}`, 'refresh', 'Se reintenta; si el sitio cambió, no hay arreglo automático.'));
    else checks.push(check('catalog', 'Catálogo', 'ok', `${catalog.items.length} títulos`));

    checks.push(Array.isArray(library.entries) ? check('library', 'Historial y gustos', 'ok', `${library.entries.length} títulos vistos`) : check('library', 'Historial y gustos', 'warn', 'No se pudo leer'));

    const login = await autostart.status().catch(() => ({ installed: false, loaded: false }));
    checks.push(login.installed && login.loaded
      ? check('autostart', 'Arranque al encender el Mac', 'ok', 'Activado')
      : check('autostart', 'Arranque al encender el Mac', 'info', 'Desactivado: tras reiniciar el Mac hay que abrir Holy en el Mac', 'autostart', 'Se activa con `npm run holy:autostart -- on` (se quita con `-- off`).'));

    checks.push(supervised
      ? check('supervisor', 'Vigilante', 'ok', 'Reinicia Holy si se cae')
      : check('supervisor', 'Vigilante', 'warn', 'Holy corre sin vigilante', null, 'Inicia con `npm run holy` para que se reinicie sola.'));

    checks.push(rss() > MAX_RSS ? check('memory', 'Memoria del proceso', 'warn', `${Math.round(rss() / 1048576)} MB`, 'restart', 'Se reinicia para liberarla.') : check('memory', 'Memoria del proceso', 'ok', `${Math.round(rss() / 1048576)} MB`));

    const pending = checks.filter(item => item.level === 'warn');
    const level = pending.length ? 'orange' : 'green';
    return { level, summary: level === 'green' ? 'Todo en orden' : `${pending.length} cosa(s) por revisar`, checks, at: now() };
  }

  let busy = null;
  // Applies every available fix once; «restart» goes last, after the answer is sent.
  // { autostart: true } also installs the login start (only when the owner asks for it).
  async function prescribe({ autostart: withAutostart = false } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const before = await diagnose();
      const fixes = [...new Set(before.checks.filter(item => (item.level === 'warn' || (withAutostart && item.id === 'autostart' && item.level !== 'ok')) && item.fix).map(item => item.fix))];
      const done = [];
      for (const fix of fixes.filter(name => name !== 'restart')) {
        try {
          if (fix === 'refresh') { catalog.refresh().catch(() => {}); done.push({ fix, ok: true, text: 'Buscando títulos en los sitios' }); }
          else if (fix === 'reconnect') { await runtime.disconnect(); done.push({ fix, ok: true, text: 'Sesión con la TV reiniciada; se reconecta sola' }); }
          else if (fix === 'autostart') { await autostart.install(); done.push({ fix, ok: true, text: 'Arranque automático activado' }); }
        } catch (error) { done.push({ fix, ok: false, text: error.message }); }
      }
      let restarting = false;
      if (fixes.includes('restart')) {
        if (supervised) { restarting = true; done.push({ fix: 'restart', ok: true, text: 'Reiniciando Holy en el Mac (vuelve en unos segundos)' }); setTimeout(() => { log('Holy: el Doctor reinicia el proceso.'); restart(); }, 600); }
        else done.push({ fix: 'restart', ok: false, text: 'Hace falta reiniciar, pero no hay vigilante: ejecuta `npm run holy` de nuevo' });
      }
      return { done, restarting, notFixable: before.checks.filter(item => item.level === 'warn' && !item.fix).map(item => ({ id: item.id, hint: item.hint })), before: before.level };
    })().finally(() => { busy = null; });
    return busy;
  }
  return { diagnose, prescribe };
}
