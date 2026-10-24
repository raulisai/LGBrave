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
  for (const source of data?.sources || []) {
    const list = items.filter(item => item.source === source.id && !item.airing);
    if (list.length) out.push({ id: 'source-' + source.id, title: 'Lo nuevo en ' + source.name, items: list });
  }
  const counts = new Map();
  for (const item of items) for (const name of item.genres || []) counts.set(name, (counts.get(name) || 0) + 1);
  for (const [name] of [...counts].filter(([, count]) => count >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    out.push({ id: 'genre-' + name, title: name, items: items.filter(item => item.genres?.includes(name)) });
  }
  return out.map(withLayout);
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
