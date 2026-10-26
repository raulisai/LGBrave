// Lists of well-known titles from public sources, matched against the owner's catalogue:
// awards (Wikidata: Oscar best picture, Emmy and Golden Globe drama series), K-drama awards
// (Wikipedia: Baeksang best drama, winners and nominees) and AniList's anime charts (trending,
// most popular this season). Nothing is invented: every entry comes from its source, with
// the date it was read. Cached for a day in `.local/`; a committed snapshot covers the first
// start without Internet. Titles not in the catalogue become «search your sites» cards.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const UA = 'HolyLab/0.9 (personal TV catalogue; github.com/raulisai/LGBrave)';
const DAY = 24 * 3600 * 1000;
export const LIST_TTL = { awards: 7 * DAY, anime: DAY / 2 };
const key = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const main = value => String(value || '').split(/[:(]/)[0].trim();

// ------------------------------------------------------------------ fetchers
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(new URL(url).hostname + ' respondió ' + response.status);
  return response.json();
}
// Works that received an award (Wikidata P166), with the award year, release/start year,
// English and Spanish names, Spanish/English aliases and IMDb id.
// type: what the work must be (film, television series): no people, duos or single seasons.
async function awardWinners(award, kind, type) {
  const query = `SELECT ?work (MIN(YEAR(?when)) AS ?year) (MIN(YEAR(?released)) AS ?released) (SAMPLE(?en) AS ?en) (SAMPLE(?es) AS ?es) (SAMPLE(?imdb) AS ?imdb)
    (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
    ?work p:P166 ?award . ?award ps:P166 wd:${award} . OPTIONAL { ?award pq:P585 ?when }
    ?work wdt:P31/wdt:P279* wd:${type} .
    OPTIONAL { ?work wdt:P577 ?released } OPTIONAL { ?work wdt:P580 ?released }
    OPTIONAL { ?work rdfs:label ?en FILTER(LANG(?en) = "en") } OPTIONAL { ?work rdfs:label ?es FILTER(LANG(?es) = "es") }
    OPTIONAL { ?work skos:altLabel ?alias FILTER(LANG(?alias) IN ("es", "en")) } OPTIONAL { ?work wdt:P345 ?imdb }
  } GROUP BY ?work`;
  const data = await json('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { headers: { Accept: 'application/sparql-results+json' } });
  return data.results.bindings.map(row => {
    const value = name => row[name]?.value || '';
    const en = value('en'), es = value('es');
    return { title: es || en, original: en, year: Number(value('released')) || Number(value('year')) || 0, awardYear: Number(value('year')) || 0, kind,
      aliases: [...new Set([en, es, ...value('aliases').split('|')].filter(Boolean))], imdb: /^tt\d+$/.test(value('imdb')) ? value('imdb') : '', id: value('work').split('/').pop() };
  }).filter(entry => entry.title).sort((a, b) => b.awardYear - a.awardYear);
}
// Baeksang Arts Award for Best Drama: winners and nominees by year, from the Wikipedia table.
export function parseBaeksang(wikitext) {
  const out = [];
  let year = 0, first = false;
  for (const line of String(wikitext).split('\n')) {
    const heading = /^!\s*(?:rowspan="\d+"\s*\|)?\s*(\d{4})/.exec(line);
    // The drama is the first cell after the year heading or a row separator; the next
    // cells of that row are its Korean title and channel (Netflix, tvN…).
    if (heading) { year = Number(heading[1]); first = true; continue; }
    if (/^\|-/.test(line)) { first = true; continue; }
    if (!year || !/^\|[^}]/.test(line)) continue;
    if (!first) continue;
    first = false;
    const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(line);
    if (!link) continue;
    const label = (link[2] || link[1]).replace(/'''?/g, '').trim();
    const target = link[1].replace(/\s*\((?:\d{4} )?(?:South Korean )?TV series\)$/i, '').trim();
    if (out.some(entry => entry.year === year && entry.key === key(label))) continue;
    out.push({ year, title: label, original: target, aliases: [...new Set([label, target])], winner: /double dagger/i.test(line), kind: 'dorama', key: key(label) });
  }
  // Ceremony year Y awards dramas aired the year before.
  return out.map(({ key: _, ...entry }) => ({ ...entry, awardYear: entry.year, year: entry.year - 1 }))
    .sort((a, b) => b.awardYear - a.awardYear || Number(b.winner) - Number(a.winner));
}
async function baeksang() {
  const data = await json('https://en.wikipedia.org/w/api.php?action=parse&page=Baeksang_Arts_Award_for_Best_Drama&prop=wikitext&format=json&formatversion=2&origin=*');
  return parseBaeksang(data.parse?.wikitext || '');
}
// AniList charts: trending now and the season's most popular.
async function anilist(kind) {
  const now = new Date();
  const month = now.getUTCMonth();
  const season = ['WINTER', 'WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL'][month];
  const query = kind === 'season'
    ? `query{Page(perPage:30){media(type:ANIME,isAdult:false,season:${season},seasonYear:${now.getUTCFullYear()},sort:POPULARITY_DESC){id title{romaji english}synonyms startDate{year}averageScore coverImage{large}siteUrl}}}`
    : 'query{Page(perPage:30){media(type:ANIME,isAdult:false,sort:TRENDING_DESC){id title{romaji english}synonyms startDate{year}averageScore coverImage{large}siteUrl}}}';
  const data = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  return (data.data?.Page?.media || []).map((media, index) => ({
    title: media.title?.english || media.title?.romaji || '', original: media.title?.romaji || '', year: media.startDate?.year || 0, kind: 'anime', rank: index + 1,
    aliases: [...new Set([media.title?.romaji, media.title?.english, ...(media.synonyms || [])].filter(Boolean))].slice(0, 8),
    poster: /^https:\/\//.test(media.coverImage?.large || '') ? media.coverImage.large : '', score: media.averageScore || 0, id: 'anilist-' + media.id
  })).filter(entry => entry.title);
}

// The lists Holy shows: where they go (kind/section) and how they are read.
export const LISTS = [
  { id: 'oscar', title: 'Ganadoras del Óscar a mejor película', short: 'Óscar', kind: 'movie', group: 'awards', source: 'Wikidata', read: () => awardWinners('Q102427', 'movie', 'Q11424') },
  { id: 'emmy-drama', title: 'Series ganadoras del Emmy a mejor drama', short: 'Emmy', kind: 'series', group: 'awards', source: 'Wikidata', read: () => awardWinners('Q989438', 'series', 'Q5398426') },
  { id: 'globe-drama', title: 'Globo de Oro · mejor serie dramática', short: 'Globo de Oro', kind: 'series', group: 'awards', source: 'Wikidata', read: () => awardWinners('Q1255198', 'series', 'Q5398426') },
  { id: 'baeksang', title: 'Doramas premiados · Baeksang a mejor drama', short: 'Baeksang', kind: 'dorama', group: 'awards', source: 'Wikipedia', read: baeksang },
  { id: 'anime-trending', title: 'Anime en tendencia · AniList', kind: 'anime', group: 'anime', source: 'AniList', read: () => anilist('trending') },
  { id: 'anime-season', title: 'Lo más popular de la temporada · AniList', kind: 'anime', group: 'anime', source: 'AniList', read: () => anilist('season') }
];

// ------------------------------------------------------------------ matching
// Catalogue titles indexed by every comparable name; a list entry matches by IMDb id, or by
// one of its names with the same kind and (when both know it) a year at most one apart.
const kinds = { movie: ['movie'], series: ['series', 'dorama'], dorama: ['dorama', 'series'], anime: ['anime'] };
export function indexCatalogue(items) {
  const byName = new Map(), byImdb = new Map();
  for (const item of items) {
    if (item.imdb) byImdb.set(item.imdb, [...(byImdb.get(item.imdb) || []), item]);
    for (const name of new Set([key(item.title), key(main(item.title))])) {
      if (name.length < 2) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(item);
    }
  }
  return { byName, byImdb };
}
export function matchEntry(entry, index) {
  const allowed = kinds[entry.kind] || [entry.kind];
  const near = item => !entry.year || !Number(item.year) || Math.abs(Number(item.year) - entry.year) <= 1;
  const fits = item => allowed.includes(item.kind) && near(item);
  const found = (entry.imdb && index.byImdb.get(entry.imdb)) || entry.aliases.flatMap(alias => [...(index.byName.get(key(alias)) || [])]);
  // A whole series (or the film itself) before a single episode; one card per title.
  return found.filter(fits).sort((a, b) => Number(!!b.isShow) - Number(!!a.isShow) || Number(!!a.episode) - Number(!!b.episode))[0] || null;
}
// A list as a row: owned titles first (playable), then the rest as search cards.
export function listRow(list, entries, index, { limit = 40, discover = 12 } = {}) {
  const seen = new Set();
  const owned = [], missing = [];
  for (const entry of entries) {
    const item = matchEntry(entry, index);
    // «Óscar 2024», «Nominada · Baeksang 2023», «#3» on AniList charts.
    const badge = list.group === 'awards' ? `${entry.winner === false ? 'Nominada · ' : ''}${list.short || ''} ${entry.awardYear || entry.year || ''}`.trim() : entry.rank ? '#' + entry.rank : '';
    if (item) { if (seen.has(item.url)) continue; seen.add(item.url); owned.push({ ...item, badge: badge || item.badge, listNote: list.title }); continue; }
    if (missing.length >= discover) continue;
    missing.push({ kind: list.kind, source: 'lists', url: 'holy:list:' + list.id + ':' + (entry.id || key(entry.title) + entry.year), title: entry.title, year: entry.year ? String(entry.year) : '',
      poster: entry.poster || '', genres: [], discover: true, classicQuery: entry.original || entry.title, classicYear: entry.year || '', badge,
      subtitle: (entry.year ? entry.year + ' · ' : '') + 'Buscar en tus sitios', overview: `De la lista «${list.title}» (${list.source}). Busca el título para ver si está en tus sitios.` });
  }
  return { id: 'list-' + list.id, title: list.title, kind: list.kind, listSource: list.source, items: [...owned, ...missing].slice(0, limit), owned: owned.length };
}

// ------------------------------------------------------------------ cache
export class KnownLists {
  constructor({ file = '.local/holy-known-lists.json', snapshot = new URL('./known-lists-snapshot.json', import.meta.url), lists = LISTS, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { file, lists, now, log });
    const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
    const saved = existsSync(file) ? read(file) : null;
    const base = read(snapshot) || { lists: {} };
    this.data = { lists: { ...(base.lists || {}), ...(saved?.lists || {}) }, finds: saved?.finds && typeof saved.finds === 'object' ? saved.finds : {} };
  }
  // Titles of the lists looked up on the owner's sites (playable copies, or null = not there).
  static findKey(list, entry) { return list.id + '|' + (entry.id || key(entry.title) + entry.year); }
  // Entries not in the catalogue and not looked up in the last week, oldest lists' winners first.
  pending(items, limit = 40, now = this.now()) {
    const index = indexCatalogue(items);
    const out = [];
    for (const list of this.lists) for (const entry of this.entries(list.id)) {
      const id = KnownLists.findKey(list, entry);
      const found = this.data.finds[id];
      if ((found && now - (found.at || 0) < 7 * DAY) || matchEntry(entry, index)) continue;
      out.push({ list, entry, id });
    }
    // Spread the work: winners before nominees, recent before old, a few of each list per round.
    out.sort((a, b) => Number(b.entry.winner !== false) - Number(a.entry.winner !== false) || (b.entry.awardYear || b.entry.year) - (a.entry.awardYear || a.entry.year));
    const perList = new Map();
    return out.filter(job => { const n = (perList.get(job.list.id) || 0) + 1; perList.set(job.list.id, n); return n <= Math.ceil(limit / this.lists.length) + 2; }).slice(0, limit);
  }
  remember(id, item, now = this.now()) {
    this.data.finds[id] = { at: now, item: item ? { ...item, genres: item.genres || [] } : null };
    const ids = Object.keys(this.data.finds);
    for (const old of ids.slice(0, Math.max(0, ids.length - 1500))) delete this.data.finds[old];
  }
  foundItems() { return Object.values(this.data.finds).map(found => found?.item).filter(Boolean); }
  entries(id) { return this.data.lists[id]?.entries || []; }
  // Reads what is older than its time to live; a source that fails keeps its last list.
  async refresh({ force = false } = {}) {
    const results = await Promise.all(this.lists.map(async list => {
      const current = this.data.lists[list.id];
      if (!force && current && this.now() - (current.fetchedAt || 0) < LIST_TTL[list.group]) return false;
      try {
        const entries = (await list.read()).slice(0, 120);
        if (!entries.length) throw Error('lista vacía');
        this.data.lists[list.id] = { fetchedAt: this.now(), source: list.source, entries };
        return true;
      } catch (error) { this.log(`Holy: lista «${list.title}»: ${error.message}`); return false; }
    }));
    if (results.some(Boolean)) this.save();
    return results.filter(Boolean).length;
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
      renameSync(this.file + '.tmp', this.file);
    } catch { /* The lists are rebuilt on the next refresh. */ }
  }
  // Rows for the given catalogue (already scored), in list order.
  rows(items, options) {
    // Copies found on the owner's sites count as owned (playable) titles too.
    const urls = new Set(items.map(item => item.url));
    const index = indexCatalogue([...items, ...this.foundItems().filter(item => !urls.has(item.url))]);
    return this.lists.map(list => listRow(list, this.entries(list.id), index, options)).filter(row => row.items.length);
  }
}
