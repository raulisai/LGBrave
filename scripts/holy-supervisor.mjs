import { spawn } from 'node:child_process';

// `npm run holy`: keeps Holy's Mac process alive. If it stops unexpectedly it is
// started again (2 s; 30 s after five failures in a minute). Ctrl-C stops both.
let stopping = false;
let child = null;
let failures = [];

function start() {
  child = spawn(process.execPath, ['scripts/holy.mjs'], { stdio: 'inherit', env: { ...process.env, HOLY_SUPERVISED: '1' } });
  child.on('exit', (code, signal) => {
    if (stopping) { process.exit(0); return; }
    // 2 = another Holy owns the lock: wait and take over when it ends (not a failure).
    if (code === 2) { console.log('Hay otro Holy en marcha; se espera 30 s por si termina.'); setTimeout(start, 30000); return; }
    failures = failures.filter(at => Date.now() - at < 60000);
    failures.push(Date.now());
    const wait = failures.length > 5 ? 30000 : 2000;
    console.log(`Holy se detuvo (${signal || 'código ' + code}); se vuelve a iniciar en ${wait / 1000} s.`);
    setTimeout(start, wait);
  });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; if (child?.exitCode === null) child.kill('SIGTERM'); else process.exit(0); });
start();
