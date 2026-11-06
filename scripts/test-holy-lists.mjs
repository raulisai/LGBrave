import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBaeksang, indexCatalogue, matchEntry, listRow, KnownLists, tableFilms, pollLines, consensus, compactEntry, BEST } from './holy/known-lists.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { sectionRows, categoryRows, dedupeRows, genreShelves, packHome, unpackHome } from '../src/holy.js';

// Lists of well-known titles (awards, AniList charts), matched with the owner's catalogue.
const directory = mkdtempSync(join(tmpdir(), 'holy-lists-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const film = (title, year, extra = {}) => ({ source: 'cuevana', kind: 'movie', title, year: String(year), url: 'https://c.example/' + encodeURIComponent(title), genres: ['Drama'], ...extra });

try {
  await check('Baeksang: ganador y nominados por año desde la tabla; canales y títulos coreanos no cuentan', () => {
    const wikitext = `{| class="wikitable"
! rowspan="3" |2016<br/>([[52nd Baeksang Arts Awards|52nd]])
| style="background:#FAEB86;" |''[[Signal (South Korean TV series)|'''Signal''']] {{double dagger|alt=Award winner}}''
| style="background:#FAEB86;" |'''시그널'''
| style="background:#FAEB86;" |'''[[tvN (South Korean TV channel)|tvN]]'''
|-
| ''[[Descendants of the Sun]]''
| 태양의 후예
| [[KBS2]]
|-
| ''[[Reply 1988]]''
| 응답하라
| [[Netflix]]
|}`;
    const entries = parseBaeksang(wikitext);
    assert.deepEqual(entries.map(entry => [entry.title, entry.year, entry.awardYear, entry.winner]), [['Signal', 2015, 2016, true], ['Descendants of the Sun', 2015, 2016, false], ['Reply 1988', 2015, 2016, false]]);
    assert.deepEqual(entries[0].aliases, ['Signal']);
  });

  await check('Coincidencias: por IMDb, por nombre (sin acentos ni signos) del mismo tipo y año cercano; nunca otro tipo ni un remake', () => {
    const items = [film('Parásitos', 2019, { imdb: 'tt6751668' }), film('Mother', 2009), { source: 'doramasflix', kind: 'dorama', title: 'Mother', url: 'https://d.example/mother', show: 'https://d.example/mother', isShow: true, genres: [] },
      film('Psicosis', 1998), film('Psicosis', 1960), { source: 'cuevana', kind: 'series', title: 'Breaking Bad', url: 'https://c.example/bb', isShow: true, genres: [] }];
    const index = indexCatalogue(items);
    assert.equal(matchEntry({ title: 'Parasite', aliases: ['Parasite'], imdb: 'tt6751668', year: 2019, kind: 'movie' }, index).title, 'Parásitos');
    assert.equal(matchEntry({ title: 'Psycho', aliases: ['Psycho', 'Psicosis'], year: 1960, kind: 'movie' }, index).year, '1960');
    assert.equal(matchEntry({ title: 'Mother', aliases: ['Mother'], year: 2017, kind: 'dorama' }, index).source, 'doramasflix');
    assert.equal(matchEntry({ title: 'Breaking Bad', aliases: ['Breaking Bad'], year: 2008, kind: 'series' }, index).url, 'https://c.example/bb');
    assert.equal(matchEntry({ title: 'Breaking Bad', aliases: ['Breaking Bad'], year: 2008, kind: 'movie' }, index), null);
    // A row: owned titles first with the list's badge, then search cards (limited).
    const row = listRow({ id: 'oscar', title: 'Óscar', short: 'Óscar', kind: 'movie', group: 'awards', source: 'Wikidata' },
      [{ title: 'Nomadland', aliases: ['Nomadland'], year: 2020, awardYear: 2021, kind: 'movie' }, { title: 'Parásitos', aliases: ['Parasite'], imdb: 'tt6751668', year: 2019, awardYear: 2020, kind: 'movie' }], index);
    assert.deepEqual(row.items.map(item => [item.title, item.badge, !!item.discover]), [['Parásitos', 'Óscar 2020', false], ['Nomadland', 'Óscar 2021', true]]);
    assert.deepEqual([row.owned, row.items[1].classicQuery, row.items[1].classicYear, row.items[1].url.startsWith('holy:list:oscar:')], [1, 'Nomadland', 2020, true]);
  });

  await check('Caché de listas: lee al vencer, una fuente caída conserva su lista y la instantánea cubre el primer arranque', async () => {
    let calls = 0, fail = false, clock = 1000;
    const lists = [{ id: 'a', title: 'A', kind: 'movie', group: 'awards', source: 'X', read: async () => { calls++; if (fail) throw Error('caída'); return [{ title: 'T' + calls, aliases: ['T' + calls], year: 2000, kind: 'movie' }]; } }];
    const file = join(directory, 'kl.json');
    const known = new KnownLists({ file, snapshot: join(directory, 'nope.json'), lists, now: () => clock });
    assert.equal(await known.refresh(), 1);
    assert.equal(await known.refresh(), 0);
    clock += 8 * 24 * 3600 * 1000; fail = true;
    assert.equal(await known.refresh(), 0);
    assert.equal(known.entries('a')[0].title, 'T1');
    const again = new KnownLists({ file, snapshot: join(directory, 'nope.json'), lists, now: () => clock });
    assert.equal(again.entries('a')[0].title, 'T1');
    const fromSnapshot = new KnownLists({ file: join(directory, 'none.json'), lists: [{ id: 'oscar', title: 'O', kind: 'movie', group: 'awards', read: async () => [] }] });
    assert.ok(fromSnapshot.entries('oscar').length > 50);
  });

  await check('Catálogo: busca en tus sitios los títulos de las listas que faltan y los vuelve reproducibles', async () => {
    const searched = [];
    const site = (id, results) => ({ id, name: id, site: `https://${id}.example/`, parseHome: () => [film('Otra', 2026)].map(item => ({ ...item, source: id, url: `https://${id}.example/otra` })), parseDetail: () => ({ genres: [] }),
      search: async query => { searched.push(id + ':' + query); return results(query); } });
    const lists = [{ id: 'oscar', title: 'Óscar', short: 'Óscar', kind: 'movie', group: 'awards', source: 'Wikidata', read: async () => [
      { title: 'Oppenheimer', aliases: ['Oppenheimer'], year: 2023, awardYear: 2024, kind: 'movie', id: 'Q1' },
      { title: 'Anora', aliases: ['Anora'], year: 2024, awardYear: 2025, kind: 'movie', id: 'Q2' }] }];
    const known = new KnownLists({ file: join(directory, 'kl2.json'), snapshot: join(directory, 'nope.json'), lists });
    await known.refresh();
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'cd.json'), fetch: async () => '', knownLists: known,
      connectors: [site('cuevana', query => (query === 'Oppenheimer' ? [film('Oppenheimer', 2023, { url: 'https://cuevana.example/oppenheimer' }), film('Oppenheimer', 1990, { url: 'https://cuevana.example/viejo' })] : [])), site('repelishd', () => []), site('doramasflix', () => [])] });
    await catalog.refresh();
    assert.equal(await catalog.findListTitles(), 1);
    assert.deepEqual(searched.sort(), ['cuevana:Anora', 'cuevana:Oppenheimer', 'doramasflix:Anora', 'repelishd:Anora']);
    // Not found is remembered for a week: no second search.
    searched.length = 0;
    assert.equal(await catalog.findListTitles(), 0);
    assert.deepEqual(searched, []);
    const library = new Library(join(directory, 'l.json'));
    const home = catalog.home(library);
    const row = home.rows.find(entry => entry.id === 'list-oscar');
    assert.deepEqual(row.items.map(item => [item.title, item.url, !!item.discover, item.badge]), [['Oppenheimer', 'https://cuevana.example/oppenheimer', false, 'Óscar 2024'], ['Anora', row.items[1].url, true, 'Óscar 2025']]);
    // Sections and genre categories show the list for their kind.
    assert.ok(sectionRows(home, 'movie').some(entry => entry.id === 'list-oscar'));
    assert.ok(!sectionRows(home, 'anime').some(entry => entry.id === 'list-oscar'));
    assert.deepEqual(categoryRows(home, 'movie', 'Drama').find(entry => entry.id === 'category-list-oscar').items.map(item => item.title), ['Oppenheimer']);
    catalog.stop();
  });

  await check('Recomendado para ti: un título premiado que va con tus gustos sube un poco, nunca uno que no te gusta', () => {
    const library = new Library(join(directory, 'taste.json'));
    for (const n of [1, 2, 3]) { const seen = film('Vista ' + n, 2020, { genres: ['Drama', 'Crimen'] }); library.start(seen); library.progress(seen.url, seen.url, 3000, 3600); library.vote(seen, 2); }
    const plain = film('Normal', 2021, { genres: ['Drama', 'Crimen'] });
    const prized = { ...film('Premiada', 2021, { genres: ['Drama', 'Crimen'] }), acclaimed: true };
    const disliked = { ...film('Lejana', 2021, { genres: ['Terror'] }), acclaimed: true };
    const list = library.recommend([plain, prized, disliked]);
    assert.deepEqual(list.map(item => item.title).slice(0, 2), ['Premiada', 'Normal']);
    assert.equal(list[0].reason.includes('Porque viste') || /Premiada y va con tus gustos/.test(list[0].reason), true);
    assert.ok(!list.some(item => item.title === 'Lejana'));
  });

  await check('Encuestas: películas en cursiva de la tabla de Wikipedia, en orden; la BBC desde su página, con empates y entidades', () => {
    const wikitext = `Intro ''[[Not a film]]''\n{| class="wikitable sortable"\n! # !! Movie\n|-\n| 1 ||''[[Blazing Saddles]]''{{efn|x}}||[[1974 in film|1974]] || [[Mel Brooks]]\n|-\n| 2 ||''[[M*A*S*H (film)|M*A*S*H]]''\n|}\n''[[After the table]]''`;
    assert.deepEqual(tableFilms(wikitext), ['Blazing Saddles', 'M*A*S*H (film)']);
    const html = '<p>100. Toni Erdmann (Maren Ade, 2016)</p><p>100. Requiem for a Dream (Darren Aronofsky, 2000)</p><p>98. Heaven&#8217;s Gate (Michael Cimino, 1980)</p><p>1. 8&frac12; nope</p><h2>2. In the Mood for Love (Wong Kar-wai, 2000)</h2>';
    assert.deepEqual(pollLines(html).map(line => [line.rank, line.title, line.year]), [[100, 'Toni Erdmann', 2016], [100, 'Requiem for a Dream', 2000], [98, "Heaven's Gate", 1980], [2, 'In the Mood for Love', 2000]]);
  });

  await check('Consenso de Holy: premios de una misma temporada cuentan una vez, las encuestas pesan por puesto y la insignia prefiere el premio', () => {
    const lists = [{ id: 'oscar', kind: 'movie', short: 'Óscar', weight: { win: 3, nominee: 1 }, family: 'hollywood' }, { id: 'bafta', kind: 'movie', short: 'BAFTA', weight: { win: 1.5 }, family: 'hollywood' },
      { id: 'palme', kind: 'movie', short: 'Palma de Oro', weight: { win: 3 } }, { id: 'bbc', kind: 'movie', short: 'BBC', weight: { poll: 4 } }, { id: 'fame', kind: 'movie', badge: 'none', weight: { poll: 1 } }];
    const entries = { oscar: [{ id: 'Q1', title: 'Hollywood', year: 2000, awardYear: 2001 }, { id: 'Q3', title: 'Pulp Fiction', year: 1994, awardYear: 1995, winner: false }],
      bafta: [{ id: 'Q1', title: 'Hollywood', year: 2000, awardYear: 2001 }], palme: [{ id: 'Q2', title: 'Festival', year: 2000, awardYear: 2000 }, { id: 'Q3', title: 'Pulp Fiction', year: 1994, awardYear: 1994 }],
      bbc: [{ id: 'Q2', title: 'Festival', year: 2000, rank: 1 }, { id: 'Q4', title: 'Última', year: 2001, rank: 2 }], fame: [{ id: 'Q2', title: 'Festival', year: 2000, rank: 1, links: 63 }] };
    const films = consensus(lists, id => entries[id] || []);
    const score = id => films.find(film => film.id === id).score;
    assert.equal(score('Q1'), 3, 'Óscar y BAFTA de la misma temporada: 3, no 4,5');
    assert.equal(score('Q2'), 3 + 4 + 1 + 3, 'Palma, primer puesto BBC, fama de país y 6 de alcance (63 Wikipedias)');
    assert.equal(score('Q4'), 3, 'el último de 2 en una encuesta de 4 vale 3');
    assert.equal(films[0].id, 'Q2');
    assert.equal(films.find(film => film.id === 'Q3').honor, 'Palma de Oro 1994');
  });

  await check('Instantánea compacta: sin tipo ni nombres repetidos, y al leerla vuelven', () => {
    const entry = { title: 'Una batalla tras otra', original: 'One Battle After Another', year: 2025, awardYear: 2026, kind: 'movie', aliases: ['One Battle After Another', 'Una batalla tras otra', 'BC Project'], winner: true, id: 'Q9', links: 50 };
    assert.deepEqual(compactEntry(entry), { title: 'Una batalla tras otra', original: 'One Battle After Another', year: 2025, awardYear: 2026, aliases: ['BC Project'], id: 'Q9', links: 50 });
    assert.deepEqual(compactEntry({ ...entry, winner: false }).winner, false);
    const snapshot = join(directory, 'snap.json');
    writeFileSync(snapshot, JSON.stringify({ lists: { oscar: { fetchedAt: 1, entries: [compactEntry(entry)] } } }));
    const known = new KnownLists({ file: join(directory, 'none2.json'), snapshot, lists: [{ id: 'oscar', title: 'Óscar', kind: 'movie', group: 'awards', read: async () => [] }] });
    const back = known.entries('oscar')[0];
    assert.deepEqual([back.kind, back.original, back.aliases], ['movie', 'One Battle After Another', ['Una batalla tras otra', 'One Battle After Another', 'BC Project']]);
    assert.equal(matchEntry(back, indexCatalogue([film('One Battle After Another', 2025)])).title, 'One Battle After Another');
  });

  await check('Una pantalla sin repetidos: lo visto arriba sale de las filas de abajo; Continuar viendo y la emisión conservan todo', () => {
    const a = film('A', 2020), b = film('B', 2021), c = film('C', 2022);
    const many = n => [...Array(n)].map((_, i) => film('G' + i, 2000 + i));
    const rows = dedupeRows([
      { id: 'continue', items: [a] }, { id: 'foryou', items: [a, b, c, ...many(2)] }, { id: 'anime-airing', items: [b] },
      { id: 'list-oscar', items: [b, c, film('D', 1990)] }, { id: 'genre-Drama', items: [c, ...many(8)] }, { id: 'genre-Corto', items: [b, ...many(4)] }]);
    const titles = id => rows.find(row => row.id === id)?.items.map(item => item.title);
    assert.deepEqual(titles('foryou'), ['B', 'C', 'G0', 'G1']);
    assert.deepEqual(titles('anime-airing'), ['B']);
    assert.equal(titles('list-oscar'), undefined, 'una lista con menos de 3 títulos nuevos se va');
    assert.deepEqual(titles('genre-Drama'), ['G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
    // Two versions of one film in the same row stay; in a lower row they do not.
    const versions = dedupeRows([{ id: 'foryou', items: [film('V', 2020, { language: 'Latino' }), film('V', 2020, { language: 'Subtitulado', url: 'https://c.example/v-sub' }), b] }, { id: 'list-x', items: [film('V', 2020), c, ...many(3)] }]);
    assert.deepEqual(versions.map(row => row.items.length), [3, 4]);
    // Genre shelves of a section: each title once, under its rarest genre.
    const shelves = genreShelves([film('Amadeus', 1984, { genres: ['Drama', 'Música'] }), film('Coda', 2021, { genres: ['Drama', 'Música'] }), film('Otra', 2020, { genres: ['Drama'] })], { assign: true });
    assert.deepEqual(shelves.map(row => [row.title, row.items.map(item => item.title)]), [['Música', ['Amadeus', 'Coda']], ['Drama', ['Otra']]]);
  });

  await check('Lo mejor: Imprescindibles, décadas y listas de sección viajan aparte; Películas muestra las que tienen algo que ver', async () => {
    const reading = { palme: [{ id: 'Q1', title: 'Pulp Fiction', original: 'Pulp Fiction', aliases: ['Pulp Fiction'], year: 1994, awardYear: 1994, kind: 'movie', links: 70 },
      { id: 'Q2', title: 'Parásitos', original: 'Parasite', aliases: ['Parasite', 'Parásitos'], year: 2019, awardYear: 2019, kind: 'movie', links: 80 },
      { id: 'Q3', title: 'Titane', original: 'Titane', aliases: ['Titane'], year: 2021, awardYear: 2021, kind: 'movie', links: 30 }] };
    const lists = [{ id: 'palme', title: 'Palma de Oro', short: 'Palma de Oro', kind: 'movie', group: 'awards', place: 'section', source: 'Wikidata', weight: { win: 3 }, read: async () => reading.palme }];
    const known = new KnownLists({ file: join(directory, 'kl3.json'), snapshot: join(directory, 'nope.json'), lists });
    await known.refresh();
    const catalog = new Catalog({ file: join(directory, 'c3.json'), detailsFile: join(directory, 'cd3.json'), fetch: async () => '', knownLists: known, credits: null,
      connectors: [{ id: 'cuevana', name: 'Cuevana', site: 'https://cuevana.example/', parseHome: () => ['Pulp Fiction|1994', 'Parásitos|2019', 'Titane|2021', 'Nueva|2026'].map(text => film(...text.split('|'))), parseDetail: () => ({ genres: [] }) }] });
    await catalog.refresh();
    const home = catalog.home(new Library(join(directory, 'l3.json')));
    assert.ok(!home.rows.some(row => row.id === 'list-palme'), 'una lista de sección no ocupa el Inicio');
    assert.ok(home.rows.some(row => row.id === 'list-classics' && row.items[0].title === 'Pulp Fiction'), 'Clásicos imprescindibles en el Inicio');
    assert.deepEqual(home.best.map(row => row.id), ['list-essentials', 'list-palme', 'list-decade-2010', 'list-decade-1990'].filter(id => BEST.includes(id.slice(5))));
    assert.equal(home.best.find(row => row.id === 'list-essentials').items[0].badge, 'Palma de Oro 2019');
    const packed = unpackHome(JSON.parse(JSON.stringify(packHome(home))));
    assert.deepEqual(packed.best.map(row => row.items.length), home.best.map(row => row.items.length));
    const best = sectionRows(packed, 'mejor');
    assert.deepEqual(best.map(row => row.id), ['list-essentials']);
    assert.ok(sectionRows(packed, 'movie').some(row => row.id === 'list-palme' || row.id === 'list-classics'));
    catalog.stop();
  });

  await check('Actores favoritos: su filmografía es una fila «Con …» del Inicio y se busca primero en tus sitios', async () => {
    const known = new KnownLists({ file: join(directory, 'kl4.json'), snapshot: join(directory, 'nope.json'), lists: [] });
    assert.equal(known.setPeople([{ name: 'Adam Sandler', role: 'cast', note: 'Lo elegiste en Gustos' }, { name: 'Robert"; DROP', role: 'cast' }]), true);
    assert.equal(known.setPeople([{ name: 'Adam Sandler', role: 'cast', note: 'Lo elegiste en Gustos' }]), false, 'sin cambios no se vuelve a leer');
    assert.deepEqual(known.people.map(list => [list.id, list.title]), [['person-adamsandler', 'Con Adam Sandler']]);
    known.people[0].read = async () => [{ id: 'Q10', title: 'Click', original: 'Click', aliases: ['Click'], year: 2006, kind: 'movie' }, { id: 'Q11', title: 'Un papá genial', original: 'Big Daddy', aliases: ['Big Daddy', 'Un papá genial'], year: 1999, kind: 'movie' }];
    assert.equal(await known.refresh(), 1);
    const rows = known.rows([film('Click', 2006)]);
    assert.deepEqual(rows[0].items.map(item => [item.title, !!item.discover]), [['Click', false], ['Un papá genial', true]]);
    assert.equal(known.pending([film('Click', 2006)])[0].entry.original, 'Big Daddy');
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de listas conocidas y premios correctas.`);
