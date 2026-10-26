import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBaeksang, indexCatalogue, matchEntry, listRow, KnownLists } from './holy/known-lists.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { sectionRows, categoryRows } from '../src/holy.js';

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
    assert.equal(list[0].reason.includes('Porque viste') || /Premiada o muy popular/.test(list[0].reason), true);
    assert.ok(!list.some(item => item.title === 'Lejana'));
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de listas conocidas y premios correctas.`);
