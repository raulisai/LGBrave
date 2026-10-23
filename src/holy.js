// Shelves for each section of Holy's home, built from the Mac's catalogue.
export const SECTIONS = [
  { id: 'inicio', name: 'Inicio' },
  { id: 'movie', name: 'Películas' },
  { id: 'anime', name: 'Anime' },
  { id: 'dorama', name: 'Doramas' },
  { id: 'series', name: 'Series' },
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
  for (const source of data?.sources || []) {
    const list = items.filter(item => item.source === source.id);
    if (list.length) out.push({ id: 'source-' + source.id, title: 'Lo nuevo en ' + source.name, items: list });
  }
  const counts = new Map();
  for (const item of items) for (const name of item.genres || []) counts.set(name, (counts.get(name) || 0) + 1);
  for (const [name] of [...counts].filter(([, count]) => count >= 4).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    out.push({ id: 'genre-' + name, title: name, items: items.filter(item => item.genres?.includes(name)) });
  }
  return out.map(withLayout);
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

export function clock(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
export function remaining(t, duration) {
  const minutes = Math.max(1, Math.round((duration - t) / 60));
  return minutes >= 60 ? `Quedan ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `Quedan ${minutes} min`;
}
