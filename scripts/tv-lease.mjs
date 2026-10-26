import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

// A temporary lease on the TV arbitrates Windows/Mac. No firmware or system configuration.
// Both computers must use this protocol. An unmodified old Mac runtime cannot cooperate.
const LOCK = '/tmp/luma-desktop-assist';
export const LEASE_SECONDS = 60;
export function sshCommand(ssh, command, timeout = 3000) {
  return new Promise((resolve, reject) => {
    let stream, text = '', finished = false;
    const closeStream = () => { try { stream?.close(); } catch { /* SSH may already be gone. */ } };
    const disconnected = () => done(Error('Se cerró la conexión de desarrollo con la TV.'));
    const done = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); ssh.off?.('close', disconnected);
      closeStream(); error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => done(Error('La TV no confirmó la reserva de conexión.')), timeout);
    ssh.once?.('close', disconnected);
    try {
      ssh.exec(command, (error, channel) => {
        if (error) return done(error);
        stream = channel;
        // Install the error handler even if the channel arrives after timeout.
        stream.on('error', error => done(error));
        if (finished) { closeStream(); return; }
        stream.on('data', chunk => { text += chunk.toString(); if (text.length > 4096) done(Error('Respuesta de reserva inválida.')); });
        stream.on('close', code => code === 0 ? done(null, text.trim()) : done(Error('No se pudo reservar la conexión con la TV.')));
      });
    } catch (error) { done(error); }
  });
}
export async function acquireTVLease(ssh, {
  run = command => sshCommand(ssh, command), interval = 5000, onLost = () => {},
  clock = () => performance.now(), activeFor = 15000
} = {}) {
  const token = randomUUID(); // generated locally, never supplied to the shell by the user
  const claim = `d=${LOCK}; if mkdir "$d" 2>/dev/null; then echo '${token}' > "$d/owner"; date +%s > "$d/at"; echo acquired; else echo busy; fi`;
  let result = await run(claim);
  if (result === 'busy') {
    // Serialize stale recovery; renewers fail closed long before 60 seconds.
    await run(`d=${LOCK}; g=${LOCK}-reap; n=$(date +%s); ga=$(stat -c %Y "$g" 2>/dev/null || echo "$n"); if [ "$((n-ga))" -gt ${LEASE_SECONDS} ]; then rmdir "$g" 2>/dev/null || true; fi; if mkdir "$g" 2>/dev/null; then a=$(cat "$d/at" 2>/dev/null || stat -c %Y "$d" 2>/dev/null || echo "$n"); if [ "$((n-a))" -gt ${LEASE_SECONDS} ]; then rm -f "$d/owner" "$d/at"; rmdir "$d" 2>/dev/null || true; fi; rmdir "$g"; fi; echo checked`);
    result = await run(claim);
  }
  if (result !== 'acquired') { const error = Error('La TV tiene una reserva de asistencia vigente; esta computadora espera a que se libere o expire.'); error.code = 'TV_BUSY'; error.reason = 'lease'; throw error; }
  let active = true, busy = false, lastRenewed = clock(), releasePromise, watchdog;
  let lostResolve;
  const lost = new Promise(resolve => { lostResolve = resolve; });
  const lose = () => {
    if (!active) return;
    active = false; clearInterval(timer); clearTimeout(watchdog); lostResolve();
    try { onLost(); } catch { /* A consumer cannot prevent fail-closed cleanup. */ }
  };
  const assertActive = () => {
    if (!active || clock()-lastRenewed >= activeFor) { lose(); throw Error('La reserva de la TV dejó de estar vigente.'); }
  };
  const armWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(lose, activeFor); watchdog.unref();
  };
  const renew = async () => {
    if (!active || busy) return;
    busy = true;
    try {
      assertActive();
      const response = await run(`d=${LOCK}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then date +%s > "$d/at"; echo renewed; else echo lost; fi`);
      // A delayed response (for example after suspend/resume or release) must
      // never resurrect a lease whose watchdog already stopped interception.
      if (!active) return;
      assertActive();
      if (response !== 'renewed') lose();
      else { lastRenewed = clock(); armWatchdog(); }
    } catch { lose(); } finally { busy = false; }
  };
  const timer = setInterval(renew, interval); timer.unref(); armWatchdog();
  return {lost, assertActive, async commitSnapshot(temporary) {
    assertActive();
    if(!/^\/tmp\/luma-desktop-profile\.json\.[0-9a-f-]{36}\.tmp$/.test(temporary))throw Error('Ruta de perfil temporal inválida.');
    const result=await run(`d=${LOCK}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then mv '${temporary}' /tmp/luma-desktop-profile.json && chmod 600 /tmp/luma-desktop-profile.json && echo committed; else echo stale; fi`);
    assertActive();return result==='committed';
  }, release() {
    if (releasePromise) return releasePromise;
    active = false; clearInterval(timer); clearTimeout(watchdog);
    // Also retire a lost lease when SSH remains available. Ownership is checked
    // remotely, so cleanup cannot remove a different computer's reservation.
    releasePromise = Promise.resolve().then(() => run(`d=${LOCK}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then rm -f "$d/owner" "$d/at"; rmdir "$d" 2>/dev/null || true; fi; echo released`)).catch(() => {});
    return releasePromise;
  }};
}
