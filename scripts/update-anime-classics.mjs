import { writeFileSync } from 'node:fs';
const query = `query($page:Int){Page(page:$page,perPage:50){media(type:ANIME,isAdult:false,startDate_lesser:20070101,popularity_greater:10000,format_in:[TV,TV_SHORT,OVA,ONA,MOVIE],sort:[SCORE_DESC,POPULARITY_DESC,ID]){id idMal title{romaji english}synonyms startDate{year}averageScore popularity format siteUrl coverImage{large}}}}`;
const items = [];
for (const page of [1, 2]) {
  const response = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { page } }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('AniList HTTP ' + response.status);
  const data = await response.json();
  if (data.errors) throw Error(JSON.stringify(data.errors));
  items.push(...data.data.Page.media.map((item, index) => ({ rank: (page - 1) * 50 + index + 1, id: item.id, malId: item.idMal, title: item.title.romaji, english: item.title.english || '', aliases: [...new Set([item.title.romaji, item.title.english, ...item.synonyms].filter(Boolean))], year: item.startDate.year, score: item.averageScore, popularity: item.popularity, format: item.format, url: item.siteUrl, poster: item.coverImage.large })));
}
if (items.length !== 100 || new Set(items.map(item => item.id)).size !== 100 || items.some(item => item.year > 2006 || !item.score)) throw Error('La lista no cumple los criterios; se conserva la copia previa.');
const result = { source: 'AniList', sourceURL: 'https://anilist.co/search/anime', capturedAt: new Date().toISOString(), cutoffYear: 2006, minimumPopularity: 10001, criteria: 'Weighted averageScore desc; popularity desc then ID. Premiere before 2007; non-adult; TV, TV_SHORT, OVA, ONA, MOVIE. Separate seasons and films remain separate.', query, items };
writeFileSync(new URL('../src/anime-classics-data.js', import.meta.url), '// Public metadata snapshot, refreshed only with npm run anime:classics:update.\nexport default ' + JSON.stringify(result, null, 2) + ';\n');
console.log('Anime clásico: 100 entradas AniList verificadas; copia fechada ' + result.capturedAt);
