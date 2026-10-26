import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

// A temporary lease on the TV arbitrates Windows/Mac. No firmware or system configuration.
// Both computers must use this protocol. An unmodified old Mac runtime cannot cooperate.
const LOCK = '/tmp/luma-desktop-assist';
// A computer that wants the TV leaves a request here; the one serving it yields on its next renewal.
const HANDOFF = '/tmp/luma-desktop-handoff';
export const LEASE_SECONDS = 60;
// «Name (IP)» of a computer, safe inside single-quoted shell text and short.
export const leaseLabel = (name, ip) => `${String(name || 'computadora').replace(/[^\w .()-]/g, '').slice(0, 40)} (${String(ip || '').replace(/[^0-9a-f.:]/gi, '').slice(0, 40)})`.replace(/ \(\)$/, '');
const LEASE_FILES = '"$d/owner" "$d/at" "$d/since" "$d/info"';
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
  clock = () => performance.now(), activeFor = 15000, label = ''
} = {}) {
  const token = randomUUID(); // generated locally, never supplied to the shell by the user
  const info = leaseLabel(...String(label).split('|'));
  // Taking the TV also clears a handover request (it was for this computer or is now stale).
  const claim = `d=${LOCK}; if mkdir "$d" 2>/dev/null; then echo '${token}' > "$d/owner"; date +%s > "$d/at"; date +%s > "$d/since"; printf '%s' '${info}' > "$d/info"; rm -f ${HANDOFF}; echo acquired; else echo busy; fi`;
  let result = await run(claim);
  if (result === 'busy') {
    // Serialize stale recovery; renewers fail closed long before 60 seconds.
    await run(`d=${LOCK}; g=${LOCK}-reap; n=$(date +%s); ga=$(stat -c %Y "$g" 2>/dev/null || echo "$n"); if [ "$((n-ga))" -gt ${LEASE_SECONDS} ]; then rmdir "$g" 2>/dev/null || true; fi; if mkdir "$g" 2>/dev/null; then a=$(cat "$d/at" 2>/dev/null || stat -c %Y "$d" 2>/dev/null || echo "$n"); if [ "$((n-a))" -gt ${LEASE_SECONDS} ]; then rm -f ${LEASE_FILES}; rmdir "$d" 2>/dev/null || true; fi; rmdir "$g"; fi; echo checked`);
    result = await run(claim);
  }
  if (result !== 'acquired') {
    // Who is serving the TV, when that computer said it (older versions do not).
    const holder = String(await run(`cat ${LOCK}/info 2>/dev/null || true`).catch(() => '')).replace(/[^\w .():-]/g, '').slice(0, 90);
    const error = Error(holder ? `La TV la atiende ${holder}; esta computadora espera a que se libere o expire.` : 'La TV tiene una reserva de asistencia vigente; esta computadora espera a que se libere o expire.');
    error.code = 'TV_BUSY'; error.reason = 'lease'; error.holder = holder; throw error;
  }
  let active = true, busy = false, lastRenewed = clock(), releasePromise, watchdog;
  let lostResolve;
  const lost = new Promise(resolve => { lostResolve = resolve; });
  // reason: {type:'lost'} or {type:'handoff', by:'Name (IP)'} when another computer asked for the TV.
  const lose = (reason = {type:'lost'}) => {
    if (!active) return;
    active = false; clearInterval(timer); clearTimeout(watchdog); lostResolve(reason);
    try { onLost(reason); } catch { /* A consumer cannot prevent fail-closed cleanup. */ }
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
      // A handover request (line 1: TV time, line 2: who) only counts if made after this lease began.
      const response = await run(`d=${LOCK}; h=${HANDOFF}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then date +%s > "$d/at"; t=$(head -n 1 "$h" 2>/dev/null); s=$(cat "$d/since" 2>/dev/null); case "$t" in ''|*[!0-9]*) t=0;; esac; case "$s" in ''|*[!0-9]*) s=0;; esac; if [ "$t" -gt 0 ] && [ "$t" -ge "$s" ]; then echo "handoff $(tail -n 1 "$h" 2>/dev/null)"; else echo renewed; fi; else echo lost; fi`);
      // A delayed response (for example after suspend/resume or release) must
      // never resurrect a lease whose watchdog already stopped interception.
      if (!active) return;
      assertActive();
      if (response.startsWith('handoff')) { lose({type:'handoff', by:response.slice(8).replace(/[^\w .():-]/g, '').slice(0, 90)}); handle.release(); }
      else if (response !== 'renewed') lose();
      else { lastRenewed = clock(); armWatchdog(); }
    } catch { lose(); } finally { busy = false; }
  };
  const timer = setInterval(renew, interval); timer.unref(); armWatchdog();
  const handle = {lost, assertActive, async commitSnapshot(temporary) {
    assertActive();
    if(!/^\/tmp\/luma-desktop-profile\.json\.[0-9a-f-]{36}\.tmp$/.test(temporary))throw Error('Ruta de perfil temporal inválida.');
    const result=await run(`d=${LOCK}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then mv '${temporary}' /tmp/luma-desktop-profile.json && chmod 600 /tmp/luma-desktop-profile.json && echo committed; else echo stale; fi`);
    assertActive();return result==='committed';
  }, release() {
    if (releasePromise) return releasePromise;
    active = false; clearInterval(timer); clearTimeout(watchdog);
    // Also retire a lost lease when SSH remains available. Ownership is checked
    // remotely, so cleanup cannot remove a different computer's reservation.
    releasePromise = Promise.resolve().then(() => run(`d=${LOCK}; if [ "$(cat "$d/owner" 2>/dev/null)" = '${token}' ]; then rm -f ${LEASE_FILES}; rmdir "$d" 2>/dev/null || true; fi; echo released`)).catch(() => {});
    return releasePromise;
  }};
  return handle;
}

// Asks the computer serving the TV to hand it over. It yields on its next renewal (about 5 s)
// and waits before trying again, so this one can take it. Returns {state:'free'|'requested', holder}.
export async function requestTVHandoff(run, label = '') {
  const info = leaseLabel(...String(label).split('|'));
  const response = String(await run(`d=${LOCK}; if [ -d "$d" ]; then printf '%s\\n%s\\n' "$(date +%s)" '${info}' > ${HANDOFF}; echo "requested $(cat "$d/info" 2>/dev/null)"; else echo free; fi`));
  const holder = response.replace(/^requested ?/, '').replace(/[^\w .():-]/g, '').slice(0, 90);
  return response.startsWith('requested') ? {state:'requested', holder} : {state:'free', holder:''};
}
// Who holds the TV now ('' when it is free or the holder does not say).
export async function tvLeaseHolder(run) {
  const response = String(await run(`d=${LOCK}; if [ -d "$d" ]; then echo "held $(cat "$d/info" 2>/dev/null)"; else echo free; fi`));
  return response.startsWith('held') ? {held:true, holder:response.slice(5).replace(/[^\w .():-]/g, '').slice(0, 90)} : {held:false, holder:''};
}
