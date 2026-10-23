// Remembers which sites close the TV app while they load, so a repeat can be seen at once
// (status «riskySites»; Luma marks the bookmark) instead of being rediscovered by chance.
// A site counts as closing the app when the connection drops within STABLE_MS of starting to open it.
// Opening it again and surviving STABLE_MS clears the record. Hosts only, never paths or queries.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export const STABLE_MS = 20000;
const RISKY_AFTER = 2;

export class CrashMemory {
  constructor(file = '.local/crash-sites.json', { now = Date.now } = {}) {
    this.file = file; this.now = now; this.pending = null; this.timer = null;
    try { this.sites = JSON.parse(readFileSync(file, 'utf8')); } catch { this.sites = {}; }
    if (!this.sites || typeof this.sites !== 'object' || Array.isArray(this.sites)) this.sites = {};
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = this.file + '.tmp';
      writeFileSync(temporary, JSON.stringify(this.sites, null, 2) + '\n', { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch { /* Diagnostics must never break browsing. */ }
  }
  static host(url) {
    try { const parsed = new URL(String(url)); return /^https?:$/.test(parsed.protocol) ? parsed.hostname : null; } catch { return null; }
  }
  // A page started opening. Local pages (the Luma home) are not tracked.
  begin(url, ignore = () => false) {
    clearTimeout(this.timer);
    const host = CrashMemory.host(url);
    if (!host || ignore(url)) { this.pending = null; return; }
    this.pending = { host, at: this.now() };
    this.timer = setTimeout(() => this.stable(host), STABLE_MS);
    this.timer.unref?.();
  }
  stable(host) {
    clearTimeout(this.timer);
    if (this.pending?.host === host) this.pending = null;
    const entry = this.sites[host];
    if (entry?.crashes) { this.sites[host] = { crashes: 0, lastOk: new Date(this.now()).toISOString() }; this.save(); }
  }
  // The connection to the app dropped without the bridge stopping it.
  closed() {
    clearTimeout(this.timer);
    const pending = this.pending; this.pending = null;
    if (!pending || this.now() - pending.at > STABLE_MS) return null;
    const entry = this.sites[pending.host] || { crashes: 0 };
    this.sites[pending.host] = { ...entry, crashes: (entry.crashes || 0) + 1, last: new Date(this.now()).toISOString() };
    this.save();
    return pending.host;
  }
  riskyHosts() { return Object.entries(this.sites).filter(([, entry]) => entry.crashes >= RISKY_AFTER).map(([host]) => host); }
  stop() { clearTimeout(this.timer); this.pending = null; }
}
