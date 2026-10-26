import {classicAnimeRow} from './anime-classics.js';
import { curatedRows } from './holy-curation.js';
// The home travels packed: every title once (empty fields left out) and rows that point
// at them by position; only cards that differ from the catalogue copy (Continuar viendo,
// Para ti…) go inline. About a fifth of the plain JSON, and the TV parses it faster.
const empty = value => value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
const trimmed = item => Object.fromEntries(Object.entries(item || {}).filter(([, value]) => !empty(value)));
const same = (a, b) => {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => (Array.isArray(a[key]) && Array.isArray(b[key]) ? a[key].join('\u0001') === b[key].join('\u0001') : a[key] === b[key]));
};
export function packHome(home) {
  const items = (home.items || []).map(trimmed);
  const index = new Map(items.map((item, at) => [item.url, at]));
  const rows = (home.rows || []).map(({ items: list, ...row }) => ({ ...row, refs: (list || []).map(item => {
    const small = trimmed(item);
    const at = index.get(small.url);
    return at !== undefined && same(small, items[at]) ? at : small;
  }) }));
  return { ...home, v: 2, items, rows };
}
const filled = item => ({ genres: [], ...item });
export function unpackHome(packed) {
  if (packed?.v !== 2) return packed;
  const items = (packed.items || []).map(filled);
  const rows = (packed.rows || []).map(({ refs, ...row }) => ({ ...row, items: (refs || []).map(ref => (typeof ref === 'number' ? items[ref] : filled(ref))).filter(Boolean) }));
  return { ...packed, items, rows };
}

// Shelves for each section of Holy's home, built from the Mac's catalogue.
export const SECTIONS = [
  { id: 'inicio', name: 'Inicio' },
  { id: 'movie', name: 'Películas' },
  { id: 'anime', name: 'Anime' },
  { id: 'dorama', name: 'Doramas' },
  { id: 'series', name: 'Series' },
  { id: 'gustos', name: 'Gustos' },
  { id: 'buscar', name: 'Buscar' }
];
const KINDS = { movie: 'Película', anime: 'Anime', dorama: 'Dorama', series: 'Serie' };
export const kindLabel = kind => KINDS[kind] || '';
// «Latino · Subtitulado» → «LAT · SUB» for the corner of a card; unknown stays empty.
const SHORT = { Latino: 'LAT', Castellano: 'CAST', 'Inglés': 'ING', Subtitulado: 'SUB' };
export const languageTag = language => String(language || '').split(' · ').map(name => SHORT[name]).filter(Boolean).join(' · ');

// Episode rows read best as wide stills; films as posters.
export function withLayout(row) {
  const wide = row.id === 'continue' || (row.items.filter(item => item.backdrop).length >= row.items.length * 0.7 && row.items.some(item => item.kind !== 'movie'));
  return { ...row, layout: wide ? 'landscape' : 'poster' };
}

export function sectionRows(data, section) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (section === 'inicio') return rows.filter(row => row.items?.length).map(withLayout);
  const items = (Array.isArray(data?.items) ? data.items : rows.flatMap(row => row.items)).filter(item => item.kind === section);
  const out = [];
  const pick = id => rows.find(row => row.id === id)?.items.filter(item => item.kind === section) || [];
  if (pick('continue').length) out.push({ id: 'continue', title: 'Continuar viendo', items: pick('continue') });
  if (pick('foryou').length) out.push({ id: 'foryou', title: 'Recomendado para ti', items: pick('foryou') });
  if (pick('anime-airing').length) out.push({ id: 'anime-airing', title: 'Anime en emisión', items: pick('anime-airing') });
  if(section==='anime')out.push(classicAnimeRow(items));
  // Recommendations first, then genres; small catalogues still expose every genre.
  out.push(...genreShelves(items));
  for (const source of data?.sources || []) {
    const list = items.filter(item => item.source === source.id && !item.airing);
    if (list.length) out.push({ id: 'source-' + source.id, title: 'Lo nuevo en ' + source.name, items: list });
  }
  return out.map(withLayout);
}

// Accent/case aliases from different sites share the same category.
const genreKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const aliases = { horror: 'terror', action: 'accion', romance: 'romance', thriller: 'suspenso', 'sci-fi': 'ciencia ficcion' };
const canonical = value => aliases[genreKey(value)] || genreKey(value);
const genreNames = { terror: 'Terror', accion: 'Acción', romance: 'Romance', comedia: 'Comedia', drama: 'Drama', suspenso: 'Suspenso', 'ciencia ficcion': 'Ciencia ficción' };
const uniqueTitles = items => {
  const seen = new Set();
  return items.filter(item => {
    const key = genreKey(item.title) + '|' + item.kind + '|' + (item.year || '') + '|' + (item.isShow ? 'show' : item.kind === 'movie' ? (item.language || '') : item.url);
    return !seen.has(key) && seen.add(key);
  });
};
export function genreShelves(items) {
  const groups = new Map();
  for (const item of items) for (const key of new Set((item.genres || []).map(canonical).filter(Boolean))) {
    if (!groups.has(key)) groups.set(key, { id: 'genre-' + key, genre: key, title: genreNames[key] || item.genres.find(name => canonical(name) === key), items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.title.localeCompare(b.title, 'es'));
}
export function categoryRows(data, section, genre, year = new Date().getFullYear()) {
  const items = uniqueTitles((data?.items || []).filter(item => (section === 'inicio' || item.kind === section) && item.genres?.some(name => canonical(name) === canonical(genre))));
  const rating = item => { const n = Number(String(item.rating || '').replace(',', '.')); return n > 0 && n <= 10 ? n : 0; };
  const rows = [
    { id: 'category-recommended', title: 'Recomendadas para ti', items: [...items].filter(item => item.match != null && item.vote !== -1).sort((a, b) => b.match - a.match) },
    { id: 'category-new', title: 'Nuevas · últimos dos años', items: items.filter(item => Number(item.year) >= year - 1 && Number(item.year) <= year).sort((a, b) => Number(b.year) - Number(a.year)) },
    { id: 'category-watched', title: 'Más vistas en tu biblioteca', items: items.filter(item => item.localWatched > 0).sort((a, b) => b.localWatched - a.localWatched) },
    ...curatedRows(items),
    { id: 'category-rated', title: 'Mejor valoradas en los sitios · sobre 10', items: items.filter(item => rating(item)).sort((a, b) => rating(b) - rating(a)) },
    { id: 'category-classics', title: 'Clásicas · hace 20 años o más', items: items.filter(item => Number(item.year) > 1900 && Number(item.year) <= year - 20).sort((a, b) => rating(b) - rating(a) || Number(a.year) - Number(b.year)) },
    { id: 'category-all', title: 'Todos los títulos · ' + items.length, items }
  ];
  return rows.filter(row => row.items.length).map(withLayout);
}

// How well a title answers what was typed: 3 exactly it, 2 starts with it, 1 contains it
// (spaces, accents and punctuation ignored: «onepiece» is «One Piece»).
const compact = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export function searchScore(item, query) {
  const [title, wanted] = [compact(item?.title), compact(query)];
  if (!title || wanted.length < 2) return 0;
  return title === wanted ? 3 : title.startsWith(wanted) ? 2 : title.includes(wanted) ? 1 : 0;
}

// «Mejores resultados» over every site that answered: the title named exactly what was
// typed first, then those starting with it; for each kind the owner's site first
// (anime: JKAnime), whole series before single films, then whoever answered first.
export function bestResults(groups, query, preferred = {}) {
  const seen = new Set();
  const found = [];
  groups.forEach((group, order) => (group.items || []).forEach((item, index) => {
    const score = searchScore(item, query);
    if (score >= 2 && item.url && !seen.has(item.url) && seen.add(item.url)) found.push({ item, score, order, index });
  }));
  const own = item => (preferred[item.kind] === item.source ? 1 : 0);
  return found.sort((a, b) => b.score - a.score || own(b.item) - own(a.item) || !!b.item.isShow - !!a.item.isShow || a.order - b.order || a.index - b.index)
    .slice(0, 12).map(entry => entry.item);
}

// A show's seasons (or blocks of episodes) as wide rows of playable episodes.
export function episodeRows(show, seasons) {
  return seasons.map((season, index) => ({
    id: 'season-' + index, title: season.title, layout: 'landscape',
    items: season.episodes.map(episode => ({
      source: show.source, kind: show.kind, title: show.title, poster: show.poster, genres: show.genres || [], overview: show.overview || '',
      show: show.show, url: episode.url, episode: episode.episode || null, subtitle: episode.label, backdrop: episode.still || show.backdrop || ''
    }))
  }));
}

// 87 → green, 60 → amber, lower → grey: how sure Holy is that you'll like it.
export const matchTone = percent => (percent >= 75 ? 'high' : percent >= 55 ? 'mid' : 'low');

// fetch with a deadline and one retry: a slow or restarting Mac never freezes the TV.
// Share an in-flight read for one computer, and ignore a slower reply from its
// predecessor after a handover. Failed current reads remain retryable.
export function latestRequest(work) {
  let generation = 0, pending = null;
  return key => {
    if (pending?.key === key) return pending.promise;
    const token = ++generation;
    const promise = Promise.resolve().then(() => work(key)).then(
      value => token === generation ? { value } : null,
      error => { if (token === generation) throw error; return null; }
    ).finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { key, promise };
    return promise;
  };
}

export async function getJSON(url, { timeout = 12000, retries = 1, ...options } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
      if (!response.ok) throw Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 800));
    } finally { clearTimeout(timer); }
  }
}

export function clock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
export function remaining(t, duration) {
  const minutes = Math.max(1, Math.round((duration - t) / 60));
  return minutes >= 60 ? `Quedan ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `Quedan ${minutes} min`;
}
