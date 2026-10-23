import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// What the owner watched, where they stopped, and what that says about their taste.
// Series (anime, doramas, shows) are kept per show, so «Continuar viendo» shows one
// card per show with its current episode. Stored only on the Mac.
const MAX_ENTRIES = 300;
const DAY = 86400000;
export const FINISHED = (t, duration) => duration > 0 && (t >= duration * 0.92 || duration - t < 90);

export const entryKey = item => item.show || item.url;
// Same film or show on two sites: compare titles without accents, case or punctuation.
export const titleKey = item => String(item.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (item.kind === 'movie' ? 'movie' : 'show');

// Next episode by each site's own address pattern; null when unknown.
export function nextEpisode(entry) {
  const url = entry.url || '';
  let match;
  if ((match = /^(https:\/\/jkanime\.net\/[^/]+\/)(\d+)\/$/.exec(url))) return { url: match[1] + (Number(match[2]) + 1) + '/', label: 'Episodio ' + (Number(match[2]) + 1), episode: Number(match[2]) + 1 };
  if ((match = /^(https:\/\/[^/]+\/cap\/.+-capitulo-)(\d+)\/$/.exec(url))) return { url: match[1] + (Number(match[2]) + 1) + '/', label: 'Capitulo ' + (Number(match[2]) + 1), episode: Number(match[2]) + 1 };
  if ((match = /^(.+\/episodio-)(\d+)x(\d+)$/.exec(url))) return { url: `${match[1]}${match[2]}x${Number(match[3]) + 1}`, label: `Episodio ${match[2]}x${Number(match[3]) + 1}` };
  return null;
}

export class Library {
  constructor(file = '.local/holy-library.json', now = () => Date.now()) {
    this.file = file; this.now = now; this.version = 1;
    let data = {};
    try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* First run. */ }
    this.entries = Array.isArray(data.entries) ? data.entries.filter(entry => entry && typeof entry.key === 'string') : [];
  }
  save() {
    this.version++;
    this.entries.sort((a, b) => b.updatedAt - a.updatedAt).splice(MAX_ENTRIES);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ entries: this.entries }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  get(key) { return this.entries.find(entry => entry.key === key) || null; }
  // Seconds to resume from when this exact page was left unfinished.
  resumeAt(item) {
    const entry = this.get(entryKey(item));
    return entry && entry.url === item.url && !entry.finished && entry.t > 20 ? entry.t : 0;
  }
  start(item) {
    const key = entryKey(item);
    const previous = this.get(key);
    const sameEpisode = previous && previous.url === item.url;
    const entry = {
      ...(previous || {}), key, url: item.url, source: item.source, kind: item.kind, title: item.title, subtitle: item.subtitle || '',
      poster: item.poster || previous?.poster || '', backdrop: item.backdrop || previous?.backdrop || '', genres: item.genres?.length ? item.genres : previous?.genres || [],
      show: item.show || '', episode: item.episode || null, overview: item.overview || previous?.overview || '',
      year: item.year || previous?.year || '', rating: item.rating || previous?.rating || '',
      t: sameEpisode ? previous.t : 0, duration: sameEpisode ? previous.duration : 0, finished: sameEpisode ? previous.finished : false,
      plays: (previous?.plays || 0) + 1, watched: previous?.watched || 0, updatedAt: this.now()
    };
    this.entries = [entry, ...this.entries.filter(other => other.key !== key)];
    this.save();
    return entry;
  }
  progress(key, url, t, duration) {
    const entry = this.get(key);
    if (!entry || entry.url !== url || !(t >= 0) || !(duration > 0)) return null;
    entry.watched = Math.max(entry.watched || 0, 0) + Math.max(0, Math.min(30, t - (entry.t || 0)));
    Object.assign(entry, { t: Math.round(t), duration: Math.round(duration), finished: FINISHED(t, duration), updatedAt: this.now() });
    this.save();
    return entry;
  }
  remove(key) { this.entries = this.entries.filter(entry => entry.key !== key); this.save(); }
  // Unfinished first; a finished episode becomes its next episode when the site's pattern allows it.
  continueWatching(limit = 20) {
    const list = [];
    for (const entry of [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!entry.finished && entry.t > 20) list.push({ ...entry, resume: true, percent: entry.duration ? Math.min(99, Math.round(entry.t / entry.duration * 100)) : 0 });
      else if (entry.finished && entry.kind !== 'movie') {
        const next = nextEpisode(entry);
        if (next) list.push({ ...entry, url: next.url, subtitle: next.label, episode: next.episode || null, t: 0, percent: 0, upNext: true });
      }
      if (list.length >= limit) break;
    }
    return list;
  }
  // Genre and kind weights: recent, longer and repeated viewing counts more.
  taste() {
    const genres = new Map(), kinds = new Map();
    for (const entry of this.entries) {
      const days = Math.max(0, (this.now() - entry.updatedAt) / DAY);
      const engagement = entry.duration ? Math.min(1, (entry.watched || entry.t) / Math.min(entry.duration, 1800)) : 0.2;
      const weight = (0.35 + 0.65 * engagement) * Math.pow(0.5, days / 21) * (1 + Math.log2(entry.plays || 1));
      for (const name of entry.genres || []) genres.set(name, (genres.get(name) || 0) + weight);
      kinds.set(entry.kind, (kinds.get(entry.kind) || 0) + weight);
    }
    const total = [...genres.values()].reduce((sum, value) => sum + value, 0) || 1;
    const kindTotal = [...kinds.values()].reduce((sum, value) => sum + value, 0) || 1;
    return {
      genres: new Map([...genres].map(([name, value]) => [name, value / total]).sort((a, b) => b[1] - a[1])),
      kinds: new Map([...kinds].map(([name, value]) => [name, value / kindTotal]))
    };
  }
  // Rank fresh catalogue items by taste; skip what was already started.
  recommend(items, limit = 20) {
    if (!this.entries.length) return [];
    const { genres, kinds } = this.taste();
    const seen = new Set(this.entries.map(entry => entry.key));
    const seenTitles = new Set(this.entries.map(titleKey));
    const scored = [];
    items.forEach((item, index) => {
      if (seen.has(entryKey(item)) || seenTitles.has(titleKey(item))) return;
      seenTitles.add(titleKey(item));
      const genreScore = (item.genres || []).reduce((sum, name) => sum + (genres.get(name) || 0), 0);
      const kindScore = kinds.get(item.kind) || 0;
      // A title with known genres must share one; without genres, the kind alone may qualify it.
      if (!genreScore && (item.genres?.length || !kindScore)) return;
      const rating = Number(item.rating) || 0;
      const freshness = 1 / (1 + index / 40);
      const score = genreScore * 3 + kindScore * 1.5 + (rating ? (rating - 5) * 0.04 : 0) + freshness * 0.15;
      const match = this.entries.map(entry => ({ entry, shared: (entry.genres || []).filter(name => item.genres?.includes(name)).length }))
        .filter(candidate => candidate.shared).sort((a, b) => b.shared - a.shared || b.entry.updatedAt - a.entry.updatedAt)[0];
      scored.push({ ...item, score, reason: match ? 'Porque viste ' + match.entry.title : '' });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  favouriteGenres(limit = 3) { return [...this.taste().genres.keys()].slice(0, limit); }
}
