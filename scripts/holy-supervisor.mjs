import { spawn } from 'node:child_process';

// `npm run holy`: keeps Holy's Mac process alive. If it stops unexpectedly it is
// started again (2 s; 30 s after five failures in a minute). Ctrl-C stops both.
let stopping = false;
let child = null;
let failures = [];

function start() {
  child = spawn(process.execPath, ['scripts/holy.mjs'], { stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (stopping) { process.exit(0); return; }
    failures = failures.filter(at => Date.now() - at < 60000);
    failures.push(Date.now());
    const wait = failures.length > 5 ? 30000 : 2000;
    console.log(`Holy se detuvo (${signal || 'código ' + code}); se vuelve a iniciar en ${wait / 1000} s.`);
    setTimeout(start, wait);
  });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; if (child?.exitCode === null) child.kill('SIGTERM'); else process.exit(0); });
start();
