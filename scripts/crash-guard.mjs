// The webOS tools can throw from inside their SSH session when the TV drops off the
// network (seen 2026-10-23: «Callback was already called» after read ETIMEDOUT). That
// only ends one connection attempt: the runtime reconnects on its next step. Anything
// else exits, and lab-supervisor.mjs starts the lab again.
export const CONNECTION_ERROR = /Callback was already called|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|novacom|ssh2/i;
export function installCrashGuard(log = console.log, diagnostics) {
  process.on('uncaughtException', error => {
    diagnostics?.event('process', 'uncaught-exception', { error }, 'error');
    if (CONNECTION_ERROR.test(String(error?.stack || error))) { log('Laboratorio: se cortó la conexión con la TV; se reintentará.'); return; }
    console.error('Laboratorio: error inesperado:', error?.stack || error);
    process.exit(1);
  });
  process.on('unhandledRejection', error => { diagnostics?.event('process', 'unhandled-rejection', { error }, 'error'); log('Laboratorio: aviso: ' + (error?.message || error)); });
}
