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
// Ratings: 2 «Me encanta», 1 «Me gusta», −1 «No es para mí».
export const RATINGS = [2, 1, -1];
const RATING_WEIGHT = { 2: 2.5, 1: 1.5, '-1': -1.5 };
function cleanVote(vote) {
  if (!vote || typeof vote.key !== 'string' || !RATINGS.includes(vote.vote)) return null;
  return { key: vote.key, url: String(vote.url || ''), title: String(vote.title || ''), kind: String(vote.kind || ''), source: String(vote.source || ''), show: String(vote.show || ''),
    genres: strings(vote.genres), studios: strings(vote.studios), country: String(vote.country || ''), poster: String(vote.poster || ''), backdrop: String(vote.backdrop || ''),
    year: String(vote.year || ''), vote: vote.vote, at: number(vote.at) };
}
// Explicit tastes chosen in «Gustos»: a genre, a producer/studio or a country, liked (1) or not (−1).
export const PREF_TYPES = ['genre', 'studio', 'country'];
const cleanPref = pref => (pref && PREF_TYPES.includes(pref.type) && typeof pref.name === 'string' && pref.name.trim() && [1, -1].includes(pref.value)
  ? { type: pref.type, name: pref.name.trim().slice(0, 60), value: pref.value, at: number(pref.at) } : null);

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
    this.prefs = (Array.isArray(data.prefs) ? data.prefs : []).map(cleanPref).filter(Boolean);
    this.asked = data.asked && typeof data.asked === 'object' && !Array.isArray(data.asked) ? Object.fromEntries(Object.entries(data.asked).filter(([, at]) => Number.isFinite(at))) : {};
  }
  save() {
    this.version++;
    this.profileCache = null;
    this.entries.sort((a, b) => b.updatedAt - a.updatedAt).splice(MAX_ENTRIES);
    this.votes.sort((a, b) => b.at - a.at).splice(MAX_VOTES);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    for (const key of Object.keys(this.asked).slice(0, -200)) delete this.asked[key];
    writeFileSync(temporary, JSON.stringify({ entries: this.entries, votes: this.votes, prefs: this.prefs, asked: this.asked }, null, 2) + '\n', { mode: 0o600 });
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
      studios: item.studios?.length ? item.studios : previous?.studios || [], country: item.country || previous?.country || '',
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

  // ---- Ratings: «Me encanta» (2), «Me gusta» (1), «No es para mí» (−1) or forget (0).
  vote(item, value) {
    const key = entryKey(item || {});
    if (!/^https:\/\//.test(String(key))) throw Error('Ese título no tiene una dirección válida.');
    this.votes = this.votes.filter(vote => vote.key !== key);
    if (RATINGS.includes(value)) {
      const vote = cleanVote({ ...item, key, vote: value, at: this.now() });
      if (vote) this.votes.unshift(vote);
    }
    this.asked[key] = this.now();
    this.save();
    return this.voteOf(item);
  }
  voteOf(item) { return this.votes.find(vote => vote.key === entryKey(item || {}))?.vote || 0; }
  // Calibration resets ratings and chosen tastes; what was watched keeps counting.
  clearVotes() { this.votes = []; this.prefs = []; this.save(); }
  prefer(type, name, value) {
    if (!PREF_TYPES.includes(type) || !String(name || '').trim()) throw Error('Ese gusto no es válido.');
    const pref = cleanPref({ type, name: String(name), value, at: this.now() });
    this.prefs = this.prefs.filter(other => !(other.type === type && other.name === String(name).trim().slice(0, 60)));
    if (pref) this.prefs.unshift(pref);
    this.save();
    return pref?.value || 0;
  }
  prefOf(type, name) { return this.prefs.find(pref => pref.type === type && pref.name === name)?.value || 0; }
  // After watching a good while (finished, 60 %, or 15 min), ask once what the owner thought.
  pendingRating() {
    for (const entry of [...this.entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (this.now() - entry.updatedAt > 3 * DAY) break;
      const enough = entry.finished || (entry.duration && entry.t / entry.duration >= 0.6) || Math.max(entry.watched || 0, entry.t || 0) >= 900;
      if (enough && !this.voteOf(entry) && !this.asked[entry.key]) return { ...entry };
    }
    return null;
  }
  dismissRating(item) { this.asked[entryKey(item || {})] = this.now(); this.save(); }

  // ---- Taste profile. Each signal spreads its weight over its genres:
  //   watched:  (0.35 + 0.65 × how much was watched) × recency (half every 21 days) × (1 + log2 plays)
  //   «me gusta» +1.5 / «no me gusta» −1.5, fading slowly (half every 180 days).
  // Affinities are scaled to 0…1 (by the strongest like) and −1…0 (by the strongest dislike).
  profile() {
    if (this.profileCache) return this.profileCache;
    const genres = new Map(), kinds = new Map(), decades = new Map(), studios = new Map(), countries = new Map();
    const add = (map, key, value) => key && map.set(key, (map.get(key) || 0) + value);
    const signal = (item, weight) => {
      const list = strings(item.genres);
      for (const name of list) add(genres, name, weight / Math.sqrt(list.length));
      for (const name of strings(item.studios)) add(studios, name, weight);
      add(countries, item.country, weight * 0.7);
      add(kinds, item.kind, weight);
      const year = Number(String(item.year || '').slice(0, 4));
      if (year > 1900) add(decades, Math.floor(year / 10) * 10, weight * 0.5);
    };
    for (const entry of this.entries) {
      const days = Math.max(0, (this.now() - entry.updatedAt) / DAY);
      const engagement = entry.duration ? Math.min(1, (entry.watched || entry.t) / Math.min(entry.duration, 1800)) : 0.2;
      signal(entry, (0.35 + 0.65 * engagement) * Math.pow(0.5, days / 21) * (1 + Math.log2(entry.plays || 1)));
    }
    for (const vote of this.votes) signal(vote, RATING_WEIGHT[vote.vote] * Math.pow(0.5, Math.max(0, this.now() - vote.at) / DAY / 180));
    // Chosen tastes weigh like a couple of ratings each, and never fade.
    for (const pref of this.prefs) add({ genre: genres, studio: studios, country: countries }[pref.type], pref.name, pref.value * 3);
    // Likes and dislikes are scaled separately, so one «no me gusta» never dims the favourites.
    const scale = map => {
      const top = Math.max(0, ...map.values()), bottom = Math.min(0, ...map.values());
      return new Map([...map].map(([key, value]) => [key, value > 0 ? value / top : value < 0 ? -value / bottom : 0]).sort((a, b) => b[1] - a[1]));
    };
    const liked = this.votes.filter(vote => vote.vote > 0).length;
    this.profileCache = { genres: scale(genres), kinds: scale(kinds), decades: scale(decades), studios: scale(studios), countries: scale(countries), liked, disliked: this.votes.length - liked,
      loved: this.votes.filter(vote => vote.vote === 2).length, watched: this.entries.length, prefs: this.prefs.length, signals: this.entries.length + this.votes.length + this.prefs.length };
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
    const studioList = strings(item.studios).map(name => profile.studios.get(name) || 0);
    const studio = studioList.length ? Math.max(...studioList.map(Math.abs)) * Math.sign(studioList.reduce((sum, value) => sum + value, 0)) : 0;
    const place = profile.countries.get(item.country) || 0;
    // Neutral genres ≈ 50 %, every genre loved ≈ 95 %, disliked ones ≈ 5 %; studio and country nudge it.
    const z = 1.9 * genre + 0.35 * kind + 0.3 * decade + 0.35 * rating + 0.6 * studio + 0.5 * place - 0.35 - (list.length ? 0 : 0.4);
    // Few signals → stay near 50 %; the scale opens as the owner watches and rates more.
    const confidence = profile.signals / (profile.signals + 4);
    const percent = Math.max(5, Math.min(99, Math.round(50 + (100 / (1 + Math.exp(-z)) - 50) * confidence)));
    const best = list.map(name => [name, profile.genres.get(name) || 0]).filter(([, value]) => value > 0.25).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
    const studioName = strings(item.studios).find(name => (profile.studios.get(name) || 0) > 0.25);
    const reason = [best.length ? 'Te gusta ' + best.join(' y ') : '', studioName || '', place > 0.25 ? 'de ' + item.country : ''].filter(Boolean).join(' · ');
    return { percent, reason };
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
    const top = map => [...map].filter(([, value]) => value > 0.05).slice(0, 5).map(([name, value]) => ({ name, value: Math.round(value * 100) }));
    return { liked: profile.liked, disliked: profile.disliked, loved: profile.loved, watched: profile.watched, prefs: profile.prefs, signals: profile.signals,
      genres: list.filter(entry => entry.value > 5).slice(0, 8), avoid: list.filter(entry => entry.value < -5).sort((a, b) => a.value - b.value).slice(0, 5),
      studios: top(profile.studios), countries: top(profile.countries),
      kinds: [...profile.kinds].map(([name, value]) => ({ name, value: Math.round(value * 100) })) };
  }
}
