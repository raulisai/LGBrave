// Lists of well-known titles from public sources, matched against the owner's catalogue:
// awards and festivals (Wikidata: Oscars, Cannes, Venice, Berlin, BAFTA, Golden Globes, Goya, Ariel,
// César, Japan Academy, Emmy), K-drama awards (Wikipedia: Baeksang), critics' polls published on
// Wikipedia (BBC, AFI), each country's most celebrated films (Wikidata: in how many of the world's
// Wikipedias they have an article, without English-language co-productions), the films of the
// owner's favourite actors and directors, and AniList's anime charts. Nothing is invented: every
// entry comes from its source, with the date it was read. «Imprescindibles» and the decade rows are
// Holy's own consensus over those lists (`consensus`). Cached in `.local/`; a committed snapshot
// covers the first start without Internet. Titles not in the catalogue become «search your sites» cards.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { RETIRED_SOURCES } from './connectors.mjs';

const UA = 'HolyLab/0.9 (personal TV catalogue; github.com/raulisai/LGBrave)';
const DAY = 24 * 3600 * 1000;
export const LIST_TTL = { awards: 7 * DAY, anime: DAY / 2, canon: 30 * DAY, world: 30 * DAY, people: 30 * DAY };
const key = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const main = value => String(value || '').split(/[:(]/)[0].trim();

// ------------------------------------------------------------------ fetchers
// A busy answer (429, 503) is asked once more after the wait the server asks for (3 s by default).
async function json(url, { timeout = 20000, retry = true, ...options } = {}) {
  const response = await fetch(url, { ...options, headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(timeout) });
  if ([429, 503].includes(response.status) && retry) {
    await new Promise(resolve => setTimeout(resolve, Math.min(30, Number(response.headers.get('retry-after')) || 3) * 1000));
    return json(url, { timeout, retry: false, ...options });
  }
  if (!response.ok) throw Error(new URL(url).hostname + ' respondió ' + response.status);
  return response.json();
}
// Wikidata's query service (by POST: long lists of ids do not fit in an address), one row per binding.
// It stops any question at 60 s.
async function sparql(query) {
  const data = await json('https://query.wikidata.org/sparql', { timeout: 65000, method: 'POST', body: 'query=' + encodeURIComponent(query),
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  return (data.results?.bindings || []).map(row => Object.fromEntries(Object.entries(row).map(([name, cell]) => [name, cell.value])));
}
// What every Wikidata list reads of a work: English and Spanish names, Spanish/English aliases, first
// release (or start) year, IMDb id and in how many Wikipedias it has an article (`?links`, bound by the query).
// Since 2025 a name shared by many languages («The Godfather») is often kept once as «mul» instead of «en».
const NAMES = `OPTIONAL { ?work wdt:P577 ?released } OPTIONAL { ?work wdt:P580 ?released }
    OPTIONAL { ?work rdfs:label ?en FILTER(LANG(?en) = "en") } OPTIONAL { ?work rdfs:label ?mul FILTER(LANG(?mul) = "mul") } OPTIONAL { ?work rdfs:label ?es FILTER(LANG(?es) = "es") }
    OPTIONAL { ?work skos:altLabel ?alias FILTER(LANG(?alias) IN ("es", "en", "mul")) } OPTIONAL { ?work wdt:P345 ?imdb }`;
const FIELDS = '(MIN(YEAR(?released)) AS ?first) (SAMPLE(?en) AS ?english) (SAMPLE(?mul) AS ?common) (SAMPLE(?es) AS ?spanish) (SAMPLE(?imdb) AS ?id) (MAX(?links) AS ?reach) (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)';
const work = (row, kind) => {
  const en = row.english || row.common || '', es = row.spanish || '';
  return { title: es || en, original: en, year: Number(row.first) || 0, kind, aliases: [...new Set([en, es, ...String(row.aliases || '').split('|')].filter(Boolean))].slice(0, 8),
    imdb: /^tt\d+$/.test(row.id || '') ? row.id : '', id: String(row.work || '').split('/').pop(), links: Number(row.reach) || 0 };
};
// Works that received an award (Wikidata P166) and, with `nominees`, those only nominated (P1411),
// with the award year. type: what the work must be (film, television series): no people or seasons.
async function awarded(award, kind, type, nominees = false) {
  const wins = `?work p:P166 ?won . ?won ps:P166 wd:${award} . OPTIONAL { ?won pq:P585 ?when }`;
  const picks = nominees ? `{ ${wins} BIND(1 AS ?win) } UNION { ?work p:P1411 ?named . ?named ps:P1411 wd:${award} . OPTIONAL { ?named pq:P585 ?when } BIND(0 AS ?win) }` : `${wins} BIND(1 AS ?win)`;
  const rows = await sparql(`SELECT ?work (MAX(?win) AS ?winner) (MIN(YEAR(?when)) AS ?year) ${FIELDS} WHERE {
    ${picks} ?work wdt:P31/wdt:P279* wd:${type} ; wikibase:sitelinks ?links . ${NAMES} } GROUP BY ?work`);
  // A win without its date sorts as if awarded the year after release (as most are).
  const when = entry => entry.awardYear || entry.year + 1;
  return rows.map(row => ({ ...work(row, kind), awardYear: Number(row.year) || 0, winner: Number(row.winner) === 1 })).filter(entry => entry.title)
    .map(entry => ({ ...entry, year: entry.year || entry.awardYear }))
    .sort((a, b) => Number(b.winner) - Number(a.winner) || when(b) - when(a));
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
// The films a Wikipedia table links in italics, in the order they appear: the ranking of a
// critics' poll (directors and countries are links too, but never in italics).
export function tableFilms(wikitext) {
  const text = String(wikitext || '');
  const start = text.search(/\{\|[^\n]*wikitable/);
  if (start < 0) return [];
  const end = text.indexOf('\n|}', start);
  const table = text.slice(start, end < 0 ? undefined : end);
  return [...new Set([...table.matchAll(/''\s*\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]\s*''/g)].map(match => match[1].trim()))];
}
// A poll published as a Wikipedia table: its films named and dated by Wikidata, keeping its order.
async function poll(page, kind = 'movie') {
  const data = await json(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2&redirects=1&origin=*`);
  const titles = tableFilms(data.parse?.wikitext);
  if (titles.length < 20) throw Error('la tabla de la lista cambió');
  const ids = new Map();
  for (let index = 0; index < titles.length; index += 50) {
    const chunk = titles.slice(index, index + 50);
    const answer = await json(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(chunk.join('|'))}`);
    // Article names are normalized and redirected before they reach their page.
    const renamed = new Map([...(answer.query?.normalized || []), ...(answer.query?.redirects || [])].map(entry => [entry.from, entry.to]));
    const item = new Map((answer.query?.pages || []).map(found => [found.title, found.pageprops?.wikibase_item]));
    for (const title of chunk) {
      let name = title;
      for (let hop = 0; hop < 3 && renamed.has(name); hop++) name = renamed.get(name);
      if (/^Q\d+$/.test(item.get(name) || '')) ids.set(title, item.get(name));
    }
  }
  const order = [...new Set(titles.map(title => ids.get(title)).filter(Boolean))];
  const rows = await sparql(`SELECT ?work ${FIELDS} WHERE { VALUES ?work { ${order.map(id => 'wd:' + id).join(' ')} } ?work wikibase:sitelinks ?links . ${NAMES} } GROUP BY ?work`);
  const byId = new Map(rows.map(row => [String(row.work).split('/').pop(), work(row, kind)]));
  return order.map((id, index) => byId.get(id)?.title ? { ...byId.get(id), rank: index + 1 } : null).filter(Boolean);
}
// A BBC Culture critics' poll, from its own article («100. Toni Erdmann (Maren Ade, 2016)»): Wikipedia
// only keeps the top ten. Ties share their place.
const entities = { amp: '&', quot: '"', apos: "'", rsquo: "'", lsquo: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—' };
export function pollLines(html) {
  const text = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => entities[name.toLowerCase()] ?? whole).replace(/[’‘]/g, "'");
  return [...text.matchAll(/^[ \t]*(\d{1,3})\.[ \t]+(.+?)[ \t]+\(([^()\n]*?),[ \t]*(\d{4})\)[ \t]*$/gm)].map(match => ({ rank: Number(match[1]), title: match[2].trim(), director: match[3].trim(), year: Number(match[4]) }));
}
const literal = value => '"' + String(value).replace(/["\\\n\r]/g, ' ').trim() + '"';
async function bbc(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('bbc.com respondió ' + response.status);
  const lines = pollLines(await response.text());
  if (lines.length < 50) throw Error('la página de la encuesta cambió');
  // Each film by its English title, as a film, within a year of the one the poll gives.
  const candidates = await sparql(`SELECT ?label ?work (MIN(YEAR(?date)) AS ?first) WHERE {
    VALUES ?label { ${[...new Set(lines.map(line => line.title))].flatMap(title => [literal(title) + '@en', literal(title) + '@mul']).join(' ')} }
    ?work rdfs:label|skos:altLabel ?label ; wdt:P31/wdt:P279* wd:Q11424 . OPTIONAL { ?work wdt:P577 ?date } } GROUP BY ?label ?work`);
  const pick = line => candidates.filter(row => key(row.label) === key(line.title) && Math.abs((Number(row.first) || 0) - line.year) <= 1)
    .sort((a, b) => Math.abs(Number(a.first) - line.year) - Math.abs(Number(b.first) - line.year))[0]?.work.split('/').pop();
  const order = lines.map(line => ({ ...line, id: pick(line) })).filter(line => line.id);
  const rows = await sparql(`SELECT ?work ${FIELDS} WHERE { VALUES ?work { ${[...new Set(order.map(line => 'wd:' + line.id))].join(' ')} } ?work wikibase:sitelinks ?links . ${NAMES} } GROUP BY ?work`);
  const byId = new Map(rows.map(row => [String(row.work).split('/').pop(), work(row, 'movie')]));
  const seen = new Set();
  return order.sort((a, b) => a.rank - b.rank).map(line => (byId.get(line.id)?.title && !seen.has(line.id) && seen.add(line.id) ? { ...byId.get(line.id), rank: line.rank } : null)).filter(Boolean);
}
// A country's most celebrated films: made there, in its own language (no English-language
// co-productions shot there), ordered by in how many Wikipedias they have an article.
async function celebrated({ countries, languages }) {
  const ids = list => list.map(id => 'wd:' + id).join(' ');
  const rows = await sparql(`SELECT ?work ${FIELDS} WHERE {
    VALUES ?country { ${ids(countries)} } VALUES ?language { ${ids(languages)} } VALUES ?type { wd:Q11424 wd:Q24869 }
    ?work wdt:P495 ?country ; wdt:P364 ?language ; wdt:P31 ?type ; wikibase:sitelinks ?links . FILTER(?links >= 12)
    FILTER NOT EXISTS { ?work wdt:P364 wd:Q1860 } ${NAMES} } GROUP BY ?work ORDER BY DESC(?reach) LIMIT 60`);
  return rows.map((row, index) => ({ ...work(row, 'movie'), rank: index + 1 })).filter(entry => entry.title && entry.year);
}
// A person's best-known films (as an actor or as the director), by fame across Wikipedias.
export const safeName = name => (/^[\p{L}\p{M} .'’-]{3,60}$/u.test(String(name || '')) ? String(name).trim() : '');
async function filmography(name, role) {
  const person = safeName(name);
  if (!person) return [];
  const rows = await sparql(`SELECT ?work ${FIELDS} WHERE {
    { SELECT ?person WHERE { VALUES ?name { "${person}"@en "${person}"@mul } ?person rdfs:label ?name ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?fame } ORDER BY DESC(?fame) LIMIT 1 }
    ?work wdt:${role === 'director' ? 'P57' : 'P161'} ?person ; wdt:P31/wdt:P279* wd:Q11424 ; wikibase:sitelinks ?links . ${NAMES}
  } GROUP BY ?work ORDER BY DESC(?reach) LIMIT 60`);
  return rows.map(row => work(row, 'movie')).filter(entry => entry.title && entry.year);
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

// The lists Holy shows. kind: the section; group: what it is (and how long it is kept); place:
// 'home' (Inicio, its section and «Lo mejor»), 'section' (its section and «Lo mejor») or 'best' («Lo
// mejor» only); note: who chose it, under the row title; weight: what it adds to the consensus.
// family: lists that reward the same films (the Hollywood awards season, AFI's lists) count once, by their best.
const BIG = { win: 3, nominee: 1 }, AWARD = { win: 1.5 }, POLL = { poll: 4 }, NATIONAL = { poll: 3 }, FAME = { poll: 1 };
const film = (id, title, short, award, place, note, extra = {}) => ({ id, title, short, kind: 'movie', group: 'awards', place, source: 'Wikidata', note, weight: AWARD, read: () => awarded(award, 'movie', 'Q11424', !!extra.nominees), ...extra });
const country = (id, name, spec) => ({ id: 'country-' + id, title: 'Lo más célebre del cine de ' + name, kind: 'movie', group: 'world', place: 'best', source: 'Wikidata', badge: 'none', weight: FAME,
  note: 'En cuántas Wikipedias del mundo tiene artículo · en su propio idioma', read: () => celebrated(spec) });
export const LISTS = [
  film('oscar', 'Óscar a mejor película', 'Óscar', 'Q102427', 'home', 'Ganadoras y nominadas de la Academia de Hollywood', { weight: BIG, nominees: true, max: 600, family: 'hollywood' }),
  film('palme', "Palma de Oro · Festival de Cannes", 'Palma de Oro', 'Q179808', 'section', 'El premio mayor del festival de cine más prestigioso del mundo', { weight: BIG }),
  film('golden-lion', 'León de Oro · Festival de Venecia', 'León de Oro', 'Q209459', 'section', 'El festival de cine más antiguo del mundo', { weight: BIG }),
  film('golden-bear', 'Oso de Oro · Festival de Berlín', 'Oso de Oro', 'Q154590', 'section', 'El gran premio de la Berlinale', { weight: BIG }),
  film('oscar-international', 'Óscar a mejor película internacional', 'Óscar internacional', 'Q105304', 'section', 'Lo mejor del cine en otros idiomas según la Academia', { weight: { win: 2.5 } }),
  { id: 'bbc-21', title: 'Las 100 mejores del siglo XXI · BBC', short: 'BBC', kind: 'movie', group: 'canon', place: 'section', source: 'BBC Culture', weight: POLL,
    note: 'Encuesta de BBC Culture a 177 críticos de 36 países (2016)', read: () => bbc('https://www.bbc.com/culture/article/20160819-the-21st-centurys-100-greatest-films') },
  { id: 'bbc-foreign', title: 'Las 100 mejores en otros idiomas · BBC', short: 'BBC', kind: 'movie', group: 'canon', place: 'section', source: 'BBC Culture', weight: POLL,
    note: 'Encuesta de BBC Culture a 209 críticos de 43 países (2018)', read: () => bbc('https://www.bbc.com/culture/article/20181029-the-100-greatest-foreign-language-films') },
  { id: 'afi', title: 'Las 100 mejores del cine de EE. UU. · AFI', short: 'AFI', kind: 'movie', group: 'canon', place: 'section', source: 'Wikipedia', weight: NATIONAL, family: 'afi',
    note: 'American Film Institute, edición de 2007', read: () => poll("AFI's 100 Years...100 Movies (10th Anniversary Edition)") },
  { id: 'afi-laughs', title: 'Las 100 mejores comedias · AFI', short: 'AFI', kind: 'movie', group: 'canon', place: 'section', source: 'Wikipedia', weight: NATIONAL, family: 'afi',
    note: 'American Film Institute: las comedias más divertidas del cine de EE. UU.', read: () => poll("AFI's 100 Years...100 Laughs") },
  { id: 'afi-thrills', title: 'Las 100 de más suspenso · AFI', short: 'AFI', kind: 'movie', group: 'canon', place: 'section', source: 'Wikipedia', weight: NATIONAL, family: 'afi',
    note: 'American Film Institute: las películas que más tensión y miedo dan', read: () => poll("AFI's 100 Years...100 Thrills") },
  { id: 'bfi', title: 'Las 100 mejores británicas · BFI', short: 'BFI', kind: 'movie', group: 'canon', place: 'best', source: 'Wikipedia', weight: NATIONAL,
    note: 'British Film Institute: votación de 1000 profesionales del cine (1999)', read: () => poll('BFI Top 100 British films') },
  country('mx', 'México', { countries: ['Q96'], languages: ['Q1321'] }),
  country('jp', 'Japón', { countries: ['Q17'], languages: ['Q5287'] }),
  country('kr', 'Corea del Sur', { countries: ['Q884'], languages: ['Q9176'] }),
  country('fr', 'Francia', { countries: ['Q142'], languages: ['Q150'] }),
  country('it', 'Italia', { countries: ['Q38'], languages: ['Q652'] }),
  country('es', 'España', { countries: ['Q29'], languages: ['Q1321'] }),
  country('ar', 'Argentina', { countries: ['Q414'], languages: ['Q1321'] }),
  country('br', 'Brasil', { countries: ['Q155'], languages: ['Q5146', 'Q750553'] }),
  country('in', 'la India', { countries: ['Q668'], languages: ['Q1568', 'Q9610', 'Q5885', 'Q8097', 'Q36236'] }),
  country('cn', 'China, Hong Kong y Taiwán', { countries: ['Q148', 'Q8646', 'Q865', 'Q29520'], languages: ['Q9192', 'Q9186', 'Q7850'] }),
  country('de', 'Alemania', { countries: ['Q183', 'Q713750', 'Q16957', 'Q41304'], languages: ['Q188'] }),
  country('ir', 'Irán', { countries: ['Q794'], languages: ['Q9168'] }),
  country('ru', 'Rusia y la URSS', { countries: ['Q159', 'Q15180'], languages: ['Q7737'] }),
  country('nordic', 'los países nórdicos', { countries: ['Q34', 'Q35', 'Q20', 'Q33', 'Q189'], languages: ['Q9027', 'Q9035', 'Q9043', 'Q25167', 'Q1412', 'Q294'] }),
  film('bafta', 'BAFTA a mejor película', 'BAFTA', 'Q139184', 'best', 'La academia de cine británica', { family: 'hollywood' }),
  film('globe-comedy-film', 'Globo de Oro · mejor comedia o musical', 'Globo de Oro', 'Q670282', 'section', 'Para reír: las comedias y musicales premiados', { family: 'hollywood' }),
  film('globe-drama-film', 'Globo de Oro · mejor película dramática', 'Globo de Oro', 'Q1011509', 'best', 'La prensa extranjera de Hollywood', { family: 'hollywood' }),
  film('ariel', 'Premio Ariel a mejor película · México', 'Ariel', 'Q2108656', 'section', 'La Academia Mexicana de Artes y Ciencias Cinematográficas'),
  film('goya', 'Premio Goya a mejor película · España', 'Goya', 'Q1467554', 'best', 'La Academia de cine de España'),
  film('cesar', 'César a mejor película · Francia', 'César', 'Q645595', 'best', 'La Academia de cine de Francia'),
  film('japan-academy', 'Premio de la Academia Japonesa a mejor película', 'Academia Japonesa', 'Q378567', 'best', 'La Academia de cine de Japón'),
  film('oscar-animated', 'Óscar a mejor película animada', 'Óscar animación', 'Q106800', 'best', 'Lo mejor de la animación según la Academia', { family: 'hollywood' }),
  { id: 'emmy-drama', title: 'Series ganadoras del Emmy a mejor drama', short: 'Emmy', kind: 'series', group: 'awards', place: 'section', source: 'Wikidata', read: () => awarded('Q989438', 'series', 'Q5398426') },
  { id: 'emmy-comedy', title: 'Series ganadoras del Emmy a mejor comedia', short: 'Emmy', kind: 'series', group: 'awards', place: 'section', source: 'Wikidata', read: () => awarded('Q2110156', 'series', 'Q5398426') },
  { id: 'globe-drama', title: 'Globo de Oro · mejor serie dramática', short: 'Globo de Oro', kind: 'series', group: 'awards', place: 'section', source: 'Wikidata', read: () => awarded('Q1255198', 'series', 'Q5398426') },
  { id: 'globe-tv-comedy', title: 'Globo de Oro · mejor serie de comedia', short: 'Globo de Oro', kind: 'series', group: 'awards', place: 'best', source: 'Wikidata', read: () => awarded('Q596294', 'series', 'Q5398426') },
  { id: 'baeksang', title: 'Doramas premiados · Baeksang a mejor drama', short: 'Baeksang', kind: 'dorama', group: 'awards', place: 'home', source: 'Wikipedia', note: 'El premio más importante de la televisión coreana', read: baeksang },
  { id: 'anime-trending', title: 'Anime en tendencia · AniList', kind: 'anime', group: 'anime', place: 'home', source: 'AniList', read: () => anilist('trending') },
  { id: 'anime-season', title: 'Lo más popular de la temporada · AniList', kind: 'anime', group: 'anime', place: 'home', source: 'AniList', read: () => anilist('season') }
];
// «Lo mejor», top to bottom: Holy's consensus, the great awards and festivals, the critics, each
// decade, each country, then the other academies and the series awards.
export const BEST = ['essentials', 'oscar', 'palme', 'golden-lion', 'golden-bear', 'oscar-international', 'bbc-21', 'bbc-foreign', 'afi', 'afi-laughs', 'afi-thrills',
  'decade-2010', 'decade-2000', 'decade-1990', 'decade-1980', 'decade-1970', 'decade-1960', 'golden-age', ...LISTS.filter(list => list.group === 'world').map(list => list.id),
  'bfi', 'bafta', 'globe-comedy-film', 'globe-drama-film', 'ariel', 'goya', 'cesar', 'japan-academy', 'oscar-animated', 'emmy-drama', 'emmy-comedy', 'globe-drama', 'globe-tv-comedy', 'baeksang'];
// Holy's own lists, computed from the ones above: the consensus films of every era and by decade.
const DERIVED = [
  { id: 'classics', title: 'Clásicos imprescindibles', place: 'home', note: 'Lo que más premios y críticos reúne, de hace 25 años o más (cálculo de Holy)', pick: (films, year) => films.filter(entry => entry.year && entry.year <= year - 25) },
  { id: 'essentials', title: 'Imprescindibles del cine', place: 'best', note: 'Lo que más premios, festivales y encuestas de críticos de todo el mundo reúne (cálculo de Holy)', pick: films => films },
  ...[[2010, 'los 2010'], [2000, 'los 2000'], [1990, 'los 90'], [1980, 'los 80'], [1970, 'los 70'], [1960, 'los 60']].map(([decade, name]) => ({ id: 'decade-' + decade, title: 'Lo mejor de ' + name, place: 'best',
    note: 'Las películas más premiadas y celebradas de esa década', pick: films => films.filter(entry => entry.year >= decade && entry.year < decade + 10) })),
  { id: 'golden-age', title: 'Época de oro · antes de 1960', place: 'best', note: 'Los clásicos que fundaron el cine', pick: films => films.filter(entry => entry.year && entry.year < 1960) }
].map(list => ({ kind: 'movie', group: 'consensus', source: 'Holy', short: '', ...list }));

// Holy's ranking of films over every film list above: what many independent juries and critics
// agree on (the way «They Shoot Pictures, Don't They?» merges thousands of critics' lists). A win at
// the Oscars or the big three festivals weighs 3, an Oscar nomination 1, the Oscar for international
// film 2.5, other academies 1.5, an international critics' poll (BBC) 4 for its first place down to 2
// for its last, a national one (AFI, BFI) 3 down to 1.5, a country's most celebrated films 1 down to
// 0.5, and fame across the world's Wikipedias adds up to ~3.5. Lists of one family (Oscar, BAFTA and
// Golden Globes reward the same Hollywood season; AFI's three lists) count once, by their best, so
// English-language films do not win by sheer number of ceremonies.
export function consensus(lists, entriesOf) {
  const films = new Map();
  for (const list of lists.filter(list => list.kind === 'movie' && list.weight)) {
    const entries = entriesOf(list.id);
    entries.forEach((entry, index) => {
      if (!entry.year) return;
      const id = /^Q\d+$/.test(entry.id || '') ? entry.id : key(entry.title) + entry.year;
      const rank = entry.rank || index + 1;
      const points = list.weight.poll ? list.weight.poll * (1 - (rank - 1) / (2 * entries.length)) : entry.winner === false ? list.weight.nominee || 0 : list.weight.win || 0;
      if (!points) return;
      // The badge prefers an award to a poll place of about the same weight («Óscar 1995» over «#40 AFI»).
      const honor = list.badge === 'none' ? '' : list.weight.poll ? `#${rank} ${list.short}` : `${entry.winner === false ? 'Nominada · ' : ''}${list.short} ${entry.awardYear || entry.year}`;
      const shine = points * (list.weight.poll ? 0.75 : 1);
      const film = films.get(id) || { title: entry.title, original: entry.original, year: entry.year, kind: 'movie', aliases: [], imdb: '', id: entry.id, links: 0, families: new Map(), honor: '', best: 0 };
      film.aliases = [...new Set([...film.aliases, ...(entry.aliases || [])])].slice(0, 10);
      film.imdb ||= entry.imdb || ''; film.links = Math.max(film.links, entry.links || 0);
      const family = list.family || list.id;
      film.families.set(family, Math.max(film.families.get(family) || 0, points));
      if (honor && shine > film.best) Object.assign(film, { honor, best: shine });
      films.set(id, film);
    });
  }
  return [...films.values()].map(({ families, best, ...film }) => ({ ...film, score: Math.round(([...families.values()].reduce((sum, value) => sum + value, 0) + Math.log2(1 + film.links) / 2) * 100) / 100 }))
    .sort((a, b) => b.score - a.score || b.links - a.links);
}

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
// «Óscar 2024», «Nominada · Baeksang 2023», «#3» on AniList charts, «#3 BBC» on a poll, the best
// honor on Holy's own lists; nothing on fame lists, whose order is not a judgment.
const badgeOf = (list, entry) => list.badge === 'none' ? '' : entry.honor ? entry.honor
  : list.group === 'awards' ? `${entry.winner === false ? 'Nominada · ' : ''}${list.short || ''} ${entry.awardYear || entry.year || ''}`.trim()
    : entry.rank ? `#${entry.rank}${list.short ? ' ' + list.short : ''}` : '';
// A list as a row: owned titles first (playable), then the rest as search cards.
export function listRow(list, entries, index, { limit = 40, discover = 12 } = {}) {
  const seen = new Set();
  const owned = [], missing = [];
  for (const entry of entries) {
    const item = matchEntry(entry, index);
    const badge = badgeOf(list, entry);
    if (item) { if (seen.has(item.url)) continue; seen.add(item.url); owned.push({ ...item, badge: badge || item.badge, listNote: list.title }); continue; }
    if (missing.length >= discover) continue;
    missing.push({ kind: entry.kind || list.kind, source: 'lists', url: 'holy:list:' + list.id + ':' + (entry.id || key(entry.title) + entry.year), title: entry.title, year: entry.year ? String(entry.year) : '',
      poster: entry.poster || '', genres: [], discover: true, classicQuery: entry.original || entry.title, classicYear: entry.year || '', badge,
      subtitle: (entry.year ? entry.year + ' · ' : '') + 'Buscar en tus sitios', overview: `De la lista «${list.title}» (${list.source}). Busca el título para ver si está en tus sitios.` });
  }
  return { id: 'list-' + list.id, title: list.title, kind: list.kind, listSource: list.source, group: list.group, place: list.place, ...(list.note ? { note: list.note } : {}),
    items: [...owned, ...missing].slice(0, limit), owned: owned.length };
}

// ------------------------------------------------------------------ cache
const personId = name => 'person-' + key(name).slice(0, 40);
// An entry as the committed snapshot keeps it: no kind (its list's), no names repeated in the
// aliases, at most three other aliases, and `winner` only when it is a nomination.
export function compactEntry({ kind: _, aliases = [], winner, original, ...entry }) {
  const others = aliases.filter(alias => alias !== entry.title && alias !== original).slice(0, 3);
  return { ...entry, ...(original && original !== entry.title ? { original } : {}), ...(others.length ? { aliases: others } : {}), ...(winner === false ? { winner } : {}) };
}
export class KnownLists {
  constructor({ file = '.local/holy-known-lists.json', snapshot = new URL('./known-lists-snapshot.json', import.meta.url), lists = LISTS, derived = DERIVED, now = Date.now, log = () => {} } = {}) {
    Object.assign(this, { file, lists, derived, now, log, people: [], stamp: 1 });
    const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
    const saved = existsSync(file) ? read(file) : null;
    const base = read(snapshot) || { lists: {} };
    this.data = { lists: { ...(base.lists || {}), ...(saved?.lists || {}) }, finds: saved?.finds && typeof saved.finds === 'object' ? saved.finds : {} };
    // The committed snapshot keeps entries short (`compactEntry`): kind and names come back here.
    for (const list of lists) for (const entry of this.data.lists[list.id]?.entries || []) {
      entry.kind ||= list.kind;
      entry.original ??= entry.title;
      entry.aliases = [...new Set([entry.title, entry.original, ...(entry.aliases || [])].filter(Boolean))];
    }
    // Finds were kept per list («oscar|Q123»); a Wikidata work is now looked up once for every list it is on.
    for (const [id, found] of Object.entries(this.data.finds)) { const work = /^[^|]+\|(Q\d+)$/.exec(id)?.[1]; if (work && !this.data.finds['wd|' + work]) this.data.finds['wd|' + work] = found; }
    // A match found on a retired source cannot be played: drop it, so the title is looked up again on the sites left.
    for (const [id, found] of Object.entries(this.data.finds)) if (RETIRED_SOURCES.has(found?.item?.source)) delete this.data.finds[id];
  }
  // Every list shown: the people the owner likes first, then the public lists, then Holy's own.
  all() { return [...this.people, ...this.lists, ...this.derived]; }
  // Titles of the lists looked up on the owner's sites (playable copies, or null = not there).
  static findKey(list, entry) { return /^Q\d+$/.test(entry.id || '') ? 'wd|' + entry.id : list.id + '|' + (entry.id || key(entry.title) + entry.year); }
  // The films of up to three favourite people («Con Adam Sandler»): [{ name, role: 'cast' | 'director' }].
  setPeople(people) {
    const next = (Array.isArray(people) ? people : []).map(person => ({ ...person, name: safeName(person?.name) })).filter(person => person.name).slice(0, 3)
      .map(person => ({ id: personId(person.name), title: (person.role === 'director' ? 'Dirigidas por ' : 'Con ') + person.name, short: '', kind: 'movie', group: 'people', place: 'home', source: 'Wikidata',
        note: person.note || 'Sus películas más conocidas', badge: 'none', person: person.name, read: () => filmography(person.name, person.role) }));
    const changed = next.map(list => list.id + list.title).join() !== this.people.map(list => list.id + list.title).join();
    if (changed) { this.people = next; this.stamp++; }
    return changed;
  }
  entries(id) {
    const list = this.derived.find(entry => entry.id === id);
    if (!list) return this.data.lists[id]?.entries || [];
    return list.pick(this.ranked(), new Date(this.now()).getUTCFullYear()).slice(0, 60);
  }
  // The consensus over the film lists, computed once per change of the lists.
  ranked() {
    if (this.rankCache?.stamp !== this.stamp) this.rankCache = { stamp: this.stamp, films: consensus(this.lists, id => this.data.lists[id]?.entries || []) };
    return this.rankCache.films;
  }
  // How acclaimed a title is (0…1): Holy's consensus for films, wins and nominations for series and
  // doramas. Matched by name and a year at most one apart; used by the taste profile.
  acclaimOf(item) {
    if (this.acclaimCache?.stamp !== this.stamp) {
      const index = new Map();
      const add = (entry, group, score) => { for (const name of new Set((entry.aliases || []).concat(entry.title).map(key))) if (name.length >= 2) index.set(name, [...(index.get(name) || []), { year: entry.year, group, score }]); };
      for (const entry of this.ranked()) add(entry, 'movie', entry.score);
      for (const list of this.lists.filter(list => list.kind !== 'movie' && list.group === 'awards')) for (const entry of this.entries(list.id)) add(entry, 'show', entry.winner === false ? 2.5 : 5);
      this.acclaimCache = { stamp: this.stamp, index };
    }
    const group = item?.kind === 'movie' ? 'movie' : ['series', 'dorama'].includes(item?.kind) ? 'show' : '';
    const year = Number(String(item?.year || '').slice(0, 4)) || 0;
    const hits = [key(item?.title), key(main(item?.title))].flatMap(name => this.acclaimCache.index.get(name) || []).filter(hit => hit.group === group && (!year || !hit.year || Math.abs(hit.year - year) <= 1));
    return group && hits.length ? Math.min(1, Math.max(...hits.map(hit => hit.score)) / 6) : 0;
  }
  // Entries not in the catalogue and not looked up in the last week: the owner's people first, then
  // the lists shown on Inicio, then the rest; winners before nominees, a poll's first places first.
  pending(items, limit = 40, now = this.now()) {
    const index = indexCatalogue(items);
    const out = [], seen = new Set();
    // A film on several lists is searched for the most visible of them.
    const place = list => (list.group === 'people' ? 0 : { home: 1, section: 2, best: 3 }[list.place] ?? 3);
    for (const list of this.all().sort((a, b) => place(a) - place(b))) {
      this.entries(list.id).forEach((entry, position) => {
        const id = KnownLists.findKey(list, entry);
        if (seen.has(id)) return;
        seen.add(id);
        const found = this.data.finds[id];
        if ((found && now - (found.at || 0) < 7 * DAY) || matchEntry(entry, index)) return;
        out.push({ list, entry, id, rank: place(list) * 1000 + (entry.winner === false ? 500 : 0) + position });
      });
    }
    // Spread the work over the lists: a few of each per round, in that order.
    out.sort((a, b) => a.rank - b.rank);
    const perList = new Map(), share = Math.ceil(limit / Math.max(1, Math.min(this.all().length, 12))) + 2;
    return out.filter(job => { const n = (perList.get(job.list.id) || 0) + 1; perList.set(job.list.id, n); return n <= share; }).slice(0, limit);
  }
  remember(id, item, now = this.now()) {
    this.data.finds[id] = { at: now, item: item ? { ...item, genres: item.genres || [] } : null };
    const ids = Object.keys(this.data.finds);
    for (const old of ids.slice(0, Math.max(0, ids.length - 4000))) delete this.data.finds[old];
  }
  foundItems() { return Object.values(this.data.finds).map(found => found?.item).filter(Boolean); }
  // Reads what is older than its time to live, two lists at a time; a source that fails keeps its last list.
  async refresh({ force = false } = {}) {
    const due = [...this.people, ...this.lists].filter(list => { const current = this.data.lists[list.id]; return force || !current || this.now() - (current.fetchedAt || 0) >= LIST_TTL[list.group]; });
    let read = 0, next = 0;
    await Promise.all(Array.from({ length: Math.min(2, due.length) }, async () => {
      while (next < due.length) {
        const list = due[next++];
        try {
          const entries = (await list.read()).slice(0, list.max || 120);
          if (!entries.length) throw Error('lista vacía');
          this.data.lists[list.id] = { fetchedAt: this.now(), source: list.source, entries };
          read++;
        } catch (error) { this.log(`Holy: lista «${list.title}»: ${error.message}`); }
      }
    }));
    if (read) { this.stamp++; this.save(); }
    return read;
  }
  save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
      renameSync(this.file + '.tmp', this.file);
    } catch { /* The lists are rebuilt on the next refresh. */ }
  }
  // Rows for the given catalogue (already scored), in list order, with where each one goes.
  rows(items, options) {
    // Copies found on the owner's sites count as owned (playable) titles too.
    const urls = new Set(items.map(item => item.url));
    const index = indexCatalogue([...items, ...this.foundItems().filter(item => !urls.has(item.url))]);
    return this.all().map(list => listRow(list, this.entries(list.id), index, options)).filter(row => row.items.length);
  }
}
