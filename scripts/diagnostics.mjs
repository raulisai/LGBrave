import { appendFileSync, mkdirSync, statSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';
let build = 'unknown';
try { build = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version; } catch { /* Isolated tests. */ }
export function redact(value) {
  return String(value || '').replace(/https?:\/\/[^\s<>"']+/g, raw => {
    try { const url = new URL(raw); return url.origin + url.pathname.replace(/[A-Za-z0-9_-]{40,}/g, '[id]'); } catch { return '[url]'; }
  }).replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(["']?(?:token|authorization|password|passwd|passphrase|secret|signature|cookie|api[_-]?key)["']?\s*[=:]\s*)["']?[^\s,;"'}]+["']?/gi, '$1[redacted]')
    .replace(/(?<![A-Za-z])[A-Z]:\\[^\s:]+/g, '[local-path]').replace(/\/(?:Users|home)\/[^\s:'"]+/g, '[local-path]').slice(0, 1600);
}
const allowed = new Set(['phase','action','method','reason','code','status','durationMs','count','attempt','source','state','position','duration','ready','network','mediaError','bufferAhead','paused','frameCount','requestType','resourceHost','title','episode','seconds','recent','host','origin','elapsedMs','repeats','free']);
export function safeDetail(detail = {}) {
  const output = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'error' && value) {
      output.error = typeof value === 'object' ? { name: redact(value.name), message: redact(value.message), code: redact(value.code), stack: redact(value.stack).split('\n').slice(0, 6).join('\n') } : { message: redact(value) };
    } else if (allowed.has(key)) {
      if (key === 'recent' && Array.isArray(value)) output.recent = value.slice(-12).map(safeDetail);
      else if (typeof value === 'string') output[key] = redact(value).slice(0, 400);
      else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) output[key] = value;
    }
  }
  return output;
}
// Permanent records, one file per month: 'history' (every playback attempt) and 'incidents'
// (every warning or error). `npm run holy:errors` reads both.
export const monthlyFile = (file, kind, at = new Date().toISOString()) => join(dirname(file), `${kind}-${String(at).slice(0, 7)}.jsonl`);
// Failures must outlive rotation: warnings and errors also go, forever, to a monthly file.
// The same problem repeated within ten minutes is one line with a count.
const REPEAT_WINDOW = 600000, MONTH_LIMIT = 50 * 1024 * 1024;
export class DiagnosticLog {
  constructor({ file = '.local/logs/diagnostics.jsonl', maxBytes = 1024 * 1024, backups = 4, now = () => new Date().toISOString() } = {}) {
    Object.assign(this, { file, maxBytes, backups, now }); this.runId = randomUUID(); this.sequence = 0;
    this.device = createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
  }
  incident(row) {
    try {
      const key = [row.component, row.event, row.state, row.error?.message, row.action, row.source].join('|');
      const seen = (this.seen ||= new Map()), last = seen.get(key), now = Date.parse(row.at) || Date.now();
      if (last && now - last.at < REPEAT_WINDOW) { last.repeats++; return; }
      seen.set(key, { at: now, repeats: 0 });
      const file = monthlyFile(this.file, 'incidents', row.at);
      let size = 0; try { size = statSync(file).size; } catch { /* First of the month. */ }
      if (size < MONTH_LIMIT) appendFileSync(file, JSON.stringify(last?.repeats ? { ...row, repeats: last.repeats } : row) + '\n', { mode: 0o600 });
    } catch { /* A log problem cannot break the service. */ }
  }
  event(component, event, detail = {}, level = 'info') {
    if (level === 'warn' || level === 'error') this.incident({ at: this.now(), runId: this.runId, build, component, event, level, ...safeDetail(detail) });
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      let size = 0; try { size = statSync(this.file).size; } catch { /* First entry. */ }
      if (size >= this.maxBytes) {
        rmSync(this.file + '.' + this.backups, { force: true });
        for (let i = this.backups - 1; i >= 1; i--) { try { renameSync(this.file + '.' + i, this.file + '.' + (i + 1)); } catch { /* Missing archive. */ } }
        if (this.backups) renameSync(this.file, this.file + '.1'); else rmSync(this.file);
      }
      appendFileSync(this.file, JSON.stringify({ v: 1, at: this.now(), runId: this.runId, sequence: ++this.sequence, device: this.device, build, component, event, level, ...safeDetail(detail) }) + '\n', { mode: 0o600 });
    } catch { /* A log problem cannot break the service. */ }
  }
}
export const diagnosticFile = file => join(dirname(file || '.local/browser-settings.json'), 'logs', 'diagnostics.jsonl');
