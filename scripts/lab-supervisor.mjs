import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// `npm run lab`: keeps the passive lab alive. If start-lab.mjs stops unexpectedly it is
// started again (2 s; 30 s after five failures in a minute). Exit code 2 means another
// lab already holds the lock, so nothing is restarted. Ctrl-C stops both.
const script = fileURLToPath(new URL('./start-lab.mjs', import.meta.url));
let stopping = false;
let child = null;
let failures = [];

function start() {
  child = spawn(process.execPath, [script], {stdio:'inherit', env:process.env});
  child.on('exit', (code, signal) => {
    if (stopping) { process.exit(0); return; }
    if (code === 2) { process.exit(1); return; }
    failures = failures.filter(at => Date.now() - at < 60000);
    failures.push(Date.now());
    const wait = failures.length > 5 ? 30000 : 2000;
    console.log(`El laboratorio se detuvo (${signal || 'código ' + code}); se vuelve a iniciar en ${wait / 1000} s.`);
    setTimeout(start, wait);
  });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); else process.exit(0); });
start();
