import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync,rmdirSync,readdirSync,renameSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';

const occupied = () => Error('Ya hay un laboratorio activo. No se iniciará otra conexión.');
const missing = error => error.code === 'ENOENT';
const directoryBusy = error => ['ENOTEMPTY','EEXIST','EPERM','EACCES'].includes(error.code);
function alive(owner) {
  if (!Number.isInteger(owner?.pid) || owner.pid <= 0) throw Error('Bloqueo del laboratorio inválido.');
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export function acquireRuntimeLock(file = '.local/lab-runtime.lock') {
  mkdirSync(dirname(file), {recursive:true});
  const token = randomUUID(), ownerName = `${token}.json`;
  const candidate = `${file}.${token}.pending`;
  // Publish a populated directory atomically. A stale contender can only remove
  // the old owner's unique file; rmdir can never remove a new populated lock.
  // This closes the read-dead-PID / unlink-new-owner race of a plain JSON file.
  mkdirSync(candidate, {mode:0o700});
  try {
    writeFileSync(join(candidate,ownerName), JSON.stringify({pid:process.pid,token}), {mode:0o600});
    for (let attempt=0; attempt<12; attempt++) {
      try {
        renameSync(candidate,file);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try { unlinkSync(join(file,ownerName)); } catch (error) { if (!missing(error)) return; }
          try { rmdirSync(file); } catch { /* A successor's nonempty lock remains intact. */ }
        };
      } catch (error) {
        // Windows uses EPERM/EACCES for an existing directory. Check the target
        // rather than mistaking permission failures on the parent for a lock.
        let stat;
        try { stat=lstatSync(file); } catch (probe) {
          if (missing(probe) && directoryBusy(error)) continue;
          if (missing(probe)) throw error;
          if (directoryBusy(probe)) continue;
          throw probe;
        }
        if (stat.isDirectory()) {
          let entries;
          try { entries=readdirSync(file); } catch (probe) { if (missing(probe) || directoryBusy(probe)) continue; throw probe; }
          if (!entries.length) {
            try { rmdirSync(file); } catch (remove) { if (!missing(remove) && !directoryBusy(remove)) throw remove; }
            continue;
          }
          if (entries.length !== 1 || !/^[0-9a-f-]{36}\.json$/.test(entries[0]))
            throw Error('El bloqueo del laboratorio no es válido; revisa si existe otra instancia antes de retirarlo.');
          let owner;
          try { owner=JSON.parse(readFileSync(join(file,entries[0]),'utf8')); }
          catch (probe) { if (missing(probe) || directoryBusy(probe)) continue; throw Error('Bloqueo del laboratorio inválido.'); }
          if (owner?.token + '.json' !== entries[0]) throw Error('Bloqueo del laboratorio inválido.');
          if (alive(owner)) throw occupied();
          try { unlinkSync(join(file,entries[0])); } catch (remove) { if (missing(remove) || directoryBusy(remove)) continue; throw remove; }
          try { rmdirSync(file); } catch (remove) { if (!missing(remove) && !directoryBusy(remove)) throw remove; }
        } else if (stat.isFile()) {
          // Respect an active older runtime. Migrate only a dead legacy JSON
          // lock; all updated runtimes publish directories, never a new file.
          let owner;
          try { owner=JSON.parse(readFileSync(file,'utf8')); }
          catch (probe) {
            if (missing(probe) || probe.code === 'EISDIR') continue;
            // On Windows opening a directory as the just-retired legacy file
            // can report EPERM/EACCES rather than EISDIR. Recheck its type.
            try { if (lstatSync(file).isDirectory()) continue; }
            catch (changed) { if (missing(changed)) continue; throw changed; }
            throw Error('Bloqueo del laboratorio inválido.');
          }
          if (alive(owner)) throw occupied();
          try { unlinkSync(file); }
          catch (remove) { if (!missing(remove) && !['EISDIR','EPERM','EACCES'].includes(remove.code)) throw remove; }
        } else throw Error('Bloqueo del laboratorio inválido.');
      }
    }
    throw Error('No se pudo reservar una única instancia del laboratorio.');
  } finally {
    try { unlinkSync(join(candidate,ownerName)); } catch { /* Already published. */ }
    try { rmdirSync(candidate); } catch { /* Already published. */ }
  }
}
