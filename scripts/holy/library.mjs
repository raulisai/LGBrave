import { readFileSync, mkdirSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// What the owner watched, where they stopped, what they told Holy they like, and
// what that says about their taste. Series (anime, doramas, shows) are kept per
// show, so «Continuar viendo» shows one card per show. Stored only on the Mac.
const MAX_ENTRIES = 300;
const MAX_VOTES = 500;
const DAY = 86400000;
export const FINISHED = (t, duration) => duration > 0 && (t >= duration * 0.92 || duration - t < 90);

export const entryKey = item => item.show || item.url;
// Same film or show on two sites: compare titles without accents, case or punctuation.
export const titleKey = item => String(item?.title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + (item?.kind === 'movie' ? 'movie' : 'show');
const number = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const strings = value => (Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry).slice(0, 12) : []);

// Next episode by each site's own address pattern; null when unknown.
export function nextEpisode(entry) {
  const url = entry.url || '';
  let match;
  if ((match = /^(https:\/\/jkanime\.net\/[^/]+\/)(\d+)\/$/.exec(url))) return { url: match[1] + (Number(match[2]) + 1) + '/', label: 'Episodio ' + (Number(match[2]) + 1), episode: Number(match[2]) + 1 };
  if ((match = /^(https:\/\/[^/]+\/cap\/.+-capitulo-)(\d+)\/$/.exec(url))) return { url: match[1] + (Number(match[2]) + 1) + '/', label: 'Capitulo ' + (Number(match[2]) + 1), episode: Number(match[2]) + 1 };
  if ((match = /^(.+\/episodio-)(\d+)x(\d+)$/.exec(url))) return { url: `${match[1]}${match[2]}x${Number(match[3]) + 1}`, label: `Episodio ${match[2]}x${Number(match[3]) + 1}` };
  if ((match = /^(https:\/\/[^/]+\/capitulos\/[\w-]+-)(\d+)x(\d+)$/.exec(url))) return { url: `${match[1]}${match[2]}x${Number(match[3]) + 1}`, label: `T${match[2]} · Capítulo ${Number(match[3]) + 1}`, episode: Number(match[3]) + 1 };
  return null;
}

// The shape every stored title keeps, whatever arrives (old files, odd site data).
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string' || !/^https:\/\//.test(String(entry.url || ''))) return null;
  return { ...entry, title: String(entry.title || ''), genres: strings(entry.genres), t: number(entry.t), duration: number(entry.duration), plays: Math.max(1, number(entry.plays)),
    watched: number(entry.watched), updatedAt: number(entry.updatedAt) || 0, finished: entry.finished === true };
}
function cleanVote(vote) {
  if (!vote || typeof vote.key !== 'string' || ![1, -1].includes(vote.vote)) return null;
  return { key: vote.key, url: String(vote.url || ''), title: String(vote.title || ''), kind: String(vote.kind || ''), source: String(vote.source || ''), show: String(vote.show || ''),
    genres: strings(vote.genres), poster: String(vote.poster || ''), backdrop: String(vote.backdrop || ''), year: String(vote.year || ''), vote: vote.vote, at: number(vote.at) };
}

export class Library {
  constructor(file = '.local/holy-library.json', now = () => Date.now()) {
    this.file = file; this.now = now; this.version = 1;
    let data = {};
    if (existsSync(file)) {
      try { data = JSON.parse(readFileSync(file, 'utf8')); }
      catch {
        // A damaged file is kept aside, never silently overwritten.
        try { copyFileSync(file, `${file}.dañado-${Date.now()}`); } catch { /* Nothing to keep. */ }
      }
    }
    this.entries = (Array.isArray(data.entries) ? data.entries : []).map(cleanEntry).filter(Boolean);
    this.votes = (Array.isArray(data.votes) ? data.votes : []).map(cleanVote).filter(Boolean);
  }
  save() {
    this.version++;
    this.profileCache = null;
    this.entries.sort((a, b) => b.updatedAt - a.updatedAt).splice(MAX_ENTRIES);
    this.votes.sort((a, b) => b.at - a.at).splice(MAX_VOTES);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ entries: this.entries, votes: this.votes }, null, 2) + '\n', { mode: 0o600 });
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
    const entry = cleanEntry({
      ...(previous || {}), key, url: item.url, source: item.source, kind: item.kind, title: item.title, subtitle: item.subtitle || '',
      poster: item.poster || previous?.poster || '', backdrop: item.backdrop || previous?.backdrop || '', genres: item.genres?.length ? item.genres : previous?.genres || [],
      show: item.show || '', episode: item.episode || null, overview: item.overview || previous?.overview || '',
      year: item.year || previous?.year || '', rating: item.rating || previous?.rating || '',
      t: sameEpisode ? previous.t : 0, duration: sameEpisode ? previous.duration : 0, finished: sameEpisode ? previous.finished : false,
      plays: (previous?.plays || 0) + 1, watched: previous?.watched || 0, updatedAt: this.now()
    });
    if (!entry) return null;
    this.entries = [entry, ...this.entries.filter(other => other.key !== key)];
    this.save();
    return entry;
  }
  progress(key, url, t, duration) {
    const entry = this.get(key);
    if (!entry || entry.url !== url || !(t >= 0) || !(duration > 0) || !Number.isFinite(t) || !Number.isFinite(duration)) return null;
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

  // ---- Calibration: «me gusta» (1), «no me gusta» (-1) or forget (0).
  vote(item, value) {
    const key = entryKey(item || {});
    if (!/^https:\/\//.test(String(key))) throw Error('Ese título no tiene una dirección válida.');
    this.votes = this.votes.filter(vote => vote.key !== key);
    if (value === 1 || value === -1) {
      const vote = cleanVote({ ...item, key, vote: value, at: this.now() });
      if (vote) this.votes.unshift(vote);
    }
    this.save();
    return this.voteOf(item);
  }
  voteOf(item) { return this.votes.find(vote => vote.key === entryKey(item || {}))?.vote || 0; }
  clearVotes() { this.votes = []; this.save(); }

  // ---- Taste profile. Each signal spreads its weight over its genres:
  //   watched:  (0.35 + 0.65 × how much was watched) × recency (half every 21 days) × (1 + log2 plays)
  //   «me gusta» +1.5 / «no me gusta» −1.5, fading slowly (half every 180 days).
  // Affinities are scaled to 0…1 (by the strongest like) and −1…0 (by the strongest dislike).
  profile() {
    if (this.profileCache) return this.profileCache;
    const genres = new Map(), kinds = new Map(), decades = new Map();
    const add = (map, key, value) => key && map.set(key, (map.get(key) || 0) + value);
    const signal = (item, weight) => {
      const list = strings(item.genres);
      for (const name of list) add(genres, name, weight / Math.sqrt(list.length));
      add(kinds, item.kind, weight);
      const year = Number(String(item.year || '').slice(0, 4));
      if (year > 1900) add(decades, Math.floor(year / 10) * 10, weight * 0.5);
    };
    for (const entry of this.entries) {
      const days = Math.max(0, (this.now() - entry.updatedAt) / DAY);
      const engagement = entry.duration ? Math.min(1, (entry.watched || entry.t) / Math.min(entry.duration, 1800)) : 0.2;
      signal(entry, (0.35 + 0.65 * engagement) * Math.pow(0.5, days / 21) * (1 + Math.log2(entry.plays || 1)));
    }
    for (const vote of this.votes) signal(vote, vote.vote * 1.5 * Math.pow(0.5, Math.max(0, this.now() - vote.at) / DAY / 180));
    // Likes and dislikes are scaled separately, so one «no me gusta» never dims the favourites.
    const scale = map => {
      const top = Math.max(0, ...map.values()), bottom = Math.min(0, ...map.values());
      return new Map([...map].map(([key, value]) => [key, value > 0 ? value / top : value < 0 ? -value / bottom : 0]).sort((a, b) => b[1] - a[1]));
    };
    const liked = this.votes.filter(vote => vote.vote === 1).length;
    this.profileCache = { genres: scale(genres), kinds: scale(kinds), decades: scale(decades), liked, disliked: this.votes.length - liked, watched: this.entries.length, signals: this.entries.length + this.votes.length };
    return this.profileCache;
  }
  // Probability (5–99 %) that the owner likes a title, or null until there are
  // at least two signals. Logistic over genre fit (mean + half the best), kind,
  // decade and the site's rating, pulled toward 50 % while there are few signals.
  match(item, profile = this.profile()) {
    if (!item || profile.signals < 2) return { percent: null, reason: '' };
    const list = strings(item.genres);
    const affinities = list.map(name => profile.genres.get(name) || 0);
    const genre = affinities.length ? affinities.reduce((sum, value) => sum + value, 0) / affinities.length + 0.5 * Math.max(...affinities) : 0;
    const kind = profile.kinds.get(item.kind) || 0;
    const year = Number(String(item.year || '').slice(0, 4));
    const decade = year > 1900 ? (profile.decades.get(Math.floor(year / 10) * 10) || 0) : 0;
    const rating = Number(item.rating) > 0 ? Math.max(-1, Math.min(1, (Number(item.rating) - 6) / 4)) : 0;
    // Neutral genres ≈ 50 %, every genre loved ≈ 95 %, disliked ones ≈ 5 %.
    const z = 1.9 * genre + 0.35 * kind + 0.3 * decade + 0.35 * rating - 0.35 - (list.length ? 0 : 0.4);
    // Few signals → stay near 50 %; the scale opens as the owner watches and rates more.
    const confidence = profile.signals / (profile.signals + 4);
    const percent = Math.max(5, Math.min(99, Math.round(50 + (100 / (1 + Math.exp(-z)) - 50) * confidence)));
    const best = list.map(name => [name, profile.genres.get(name) || 0]).filter(([, value]) => value > 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
    return { percent, reason: best.length ? 'Te gusta ' + best.join(' y ') : '' };
  }
  // Copies of the items with their match, vote and a short reason.
  scored(items, profile = this.profile()) {
    return (Array.isArray(items) ? items : []).filter(Boolean).map(item => {
      const { percent, reason } = this.match(item, profile);
      return { ...item, match: percent, matchReason: reason, vote: this.voteOf(item) };
    });
  }
  // Fresh titles not started yet, best match first; «Porque viste X» when a watched title shares genres.
  recommend(items, limit = 20) {
    const profile = this.profile();
    if (profile.signals < 2) return [];
    const seen = new Set([...this.entries.map(entry => entry.key), ...this.votes.map(vote => vote.key)]);
    const seenTitles = new Set([...this.entries, ...this.votes].map(titleKey));
    const scored = [];
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      if (!item || seen.has(entryKey(item)) || seenTitles.has(titleKey(item))) return;
      seenTitles.add(titleKey(item));
      const { percent, reason } = this.match(item, profile);
      if (percent === null || percent < 55) return;
      const because = this.entries.map(entry => ({ entry, shared: entry.genres.filter(name => item.genres?.includes(name)).length }))
        .filter(candidate => candidate.shared).sort((a, b) => b.shared - a.shared || b.entry.updatedAt - a.entry.updatedAt)[0];
      scored.push({ ...item, match: percent, matchReason: reason, score: percent + 6 / (1 + index / 40), reason: because ? 'Porque viste ' + because.entry.title : reason });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  favouriteGenres(limit = 3) { return [...this.profile().genres].filter(([, value]) => value > 0.3).slice(0, limit).map(([name]) => name); }
  // For the «Gustos» screen.
  summary() {
    const profile = this.profile();
    const list = [...profile.genres].map(([name, value]) => ({ name, value: Math.round(value * 100) }));
    return { liked: profile.liked, disliked: profile.disliked, watched: profile.watched, signals: profile.signals,
      genres: list.filter(entry => entry.value > 5).slice(0, 8), avoid: list.filter(entry => entry.value < -5).sort((a, b) => a.value - b.value).slice(0, 5),
      kinds: [...profile.kinds].map(([name, value]) => ({ name, value: Math.round(value * 100) })) };
  }
}
