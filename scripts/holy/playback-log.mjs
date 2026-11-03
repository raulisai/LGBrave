import { redact, monthlyFile } from '../diagnostics.mjs';
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';

// Fixed fields only: never persist player URLs, query tokens, cookies or raw exceptions.
export class PlaybackLog {
  constructor(file = '.local/logs/holy-playback.jsonl', maxBytes = 1024 * 1024) { this.file = file; this.maxBytes = maxBytes; }
  write(event, session, detail = {}) {
    try {
      const item = session?.item || {};
      const kind = value => ['dub','sub','orig'].includes(value) ? value : '';
      const host = value => { try { return new URL(value).hostname; } catch { return ''; } };
      const row = { at: new Date().toISOString(), runId: this.runId || '', event, session: session?.token || 0,
        title: String(item.title || '').slice(0, 160), episode: item.episode || null, source: item.source || '',
        host: host(session?.target), phase: session?.phase || '', position: session?.position?.t || 0,
        requestedKind: kind(session?.choice?.kind), playingKind: kind(session?.versionKind || session?.versions?.find(version=>version.id===session?.version)?.kind),
        duration: session?.position?.d || 0, attempts: session?.rescues || 0 };
      for (const key of ['reason', 'elapsedMs', 'ready', 'network', 'mediaError', 'bufferAhead', 'paused', 'seconds', 'phase', 'count', 'heapMB']) {
        if (['string', 'number', 'boolean'].includes(typeof detail[key])) row[key] = typeof detail[key] === 'string' ? redact(detail[key]).slice(0, 200) : detail[key];
      }
      mkdirSync(dirname(this.file), { recursive: true });
      if ((() => { try { return statSync(this.file).size; } catch { return 0; } })() >= this.maxBytes) {
        rmSync(this.file + '.1', { force: true }); renameSync(this.file, this.file + '.1');
      }
      appendFileSync(this.file, JSON.stringify(row) + '\n', { mode: 0o600 });
      // Every attempt stays forever, by month; pauses are the only noise left out.
      if (!/^pause-/.test(event)) appendFileSync(monthlyFile(this.file, 'history', row.at), JSON.stringify(row) + '\n', { mode: 0o600 });
    } catch { /* A diagnostic failure must never interrupt playback. */ }
  }
}

// Bounded tail read for Doctor after the service restarted. Never returns a player URL.
export function latestPlaybackExit(file = '.local/logs/holy-playback.jsonl') {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = statSync(file).size, bytes = Buffer.alloc(Math.min(size, 65536));
    readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    for (const line of bytes.toString('utf8').split('\n').reverse()) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.event !== 'player-disconnected' || !Number.isFinite(Date.parse(row.at))) continue;
      const reason = ['target_closed','replaced_with_devtools','render_process_gone','canceled_by_user','Inspector.detached','Inspector.targetCrashed','Target.targetCrashed'].includes(row.reason) ? row.reason : 'unspecified';
      return { at: Date.parse(row.at), title: String(row.title || '').slice(0,160), reason, position: Number.isFinite(row.position) ? row.position : 0 };
    }
  } catch { /* Missing or damaged logs must not break Doctor. */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
  return null;
}

export function describePlaybackExit(incident) {
  const what = incident.reason === 'target_closed' ? 'La TV cerró el reproductor; causa sin confirmar'
    : incident.reason === 'replaced_with_devtools' ? 'Otro inspector sustituyó la conexión'
    : /targetCrashed/.test(incident.reason) ? 'El inspector notificó un fallo del reproductor'
    : 'Se perdió la conexión del reproductor; causa sin confirmar';
  return (incident.title || 'Contenido') + ' · minuto ' + Math.floor((incident.position || 0) / 60) + ': ' + what;
}
