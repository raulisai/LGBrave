import { redact } from '../diagnostics.mjs';
import { appendFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
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
      for (const key of ['reason', 'ready', 'network', 'mediaError', 'bufferAhead', 'paused', 'seconds', 'phase']) {
        if (['string', 'number', 'boolean'].includes(typeof detail[key])) row[key] = typeof detail[key] === 'string' ? redact(detail[key]).slice(0, 200) : detail[key];
      }
      mkdirSync(dirname(this.file), { recursive: true });
      if ((() => { try { return statSync(this.file).size; } catch { return 0; } })() >= this.maxBytes) {
        rmSync(this.file + '.1', { force: true }); renameSync(this.file, this.file + '.1');
      }
      appendFileSync(this.file, JSON.stringify(row) + '\n', { mode: 0o600 });
    } catch { /* A diagnostic failure must never interrupt playback. */ }
  }
}
