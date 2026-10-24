import {randomUUID} from 'node:crypto';
import {mkdirSync,openSync,readFileSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';

export function acquireRuntimeLock(file = '.local/lab-runtime.lock') {
  mkdirSync(dirname(file), {recursive:true});
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify({pid:process.pid, token})); } finally { closeSync(fd); }
      return () => {
        try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) unlinkSync(file); } catch { /* Already released. */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(file, 'utf8')); }
      catch { throw Error('El bloqueo del laboratorio no es válido; revisa si existe otra instancia antes de retirarlo.'); }
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw Error('Bloqueo del laboratorio inválido.');
      try { process.kill(owner.pid, 0); }
      catch (probe) {
        if (probe.code !== 'ESRCH') throw probe;
        try { unlinkSync(file); } catch (remove) { if (remove.code !== 'ENOENT') throw remove; }
        continue;
      }
      throw Error('Ya hay un laboratorio activo. No se iniciará otra conexión.');
    }
  }
  throw Error('No se pudo reservar una única instancia del laboratorio.');
}
