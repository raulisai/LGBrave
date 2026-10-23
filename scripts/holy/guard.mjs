// The webOS tools can throw from inside their SSH session when the TV drops off the
// network (seen 2026-10-23: «Callback was already called» after ETIMEDOUT). That only
// ends one connection attempt: the runtime reconnects on its next step. Anything else
// exits, and holy-supervisor.mjs starts Holy again.
export const CONNECTION_ERROR = /Callback was already called|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|novacom|ssh2/i;
export function installCrashGuard(log = console.log) {
  process.on('uncaughtException', error => {
    if (CONNECTION_ERROR.test(String(error?.stack || error))) { log('Holy: se cortó la conexión con la TV; se reintentará.'); return; }
    console.error('Holy: error inesperado:', error?.stack || error);
    process.exit(1);
  });
  process.on('unhandledRejection', error => log('Holy: aviso: ' + (error?.message || error)));
}
