import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library, titleKey, FINISHED } from './holy/library.mjs';
import { Catalog } from './holy/catalog.mjs';

// `npm run holy:taste-eval [biblioteca.json] [catalogo.json]`: how well Holy's match predicts
// what the owner really watched. Leave one out: each title the owner finished, liked or left
// early is hidden, the profile is rebuilt from everything else, and the hidden title is ranked
// against the whole catalogue. Reads local files only; no TV, no network.
//   Gustó:     «me gusta/encanta», finished, or ≥ 60 % watched (series: ≥ 40 min in total).
//   No gustó:  «no es para mí», or a film left before 15 % after ≥ 2 min (not a broken player).
export function labelOf(entry, vote) {
  if (vote) return vote > 0 ? 1 : 0;
  const watched = entry?.watched || 0, duration = entry?.duration || 0;
  if (!entry || watched < 120) return null;
  if (entry.finished || FINISHED(entry.t, duration) || (duration && watched / duration >= 0.6) || (entry.kind !== 'movie' && watched >= 2400)) return 1;
  if (entry.kind === 'movie' && duration > 1800 && watched / duration < 0.15) return 0;
  return null;
}

export function evaluate(data, catalogItems, { now = Date.now(), Model = Library } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'holy-taste-'));
  try {
    const all = new Model(join(dir, 'all.json'), () => now);
    Object.assign(all, { entries: data.entries || [], votes: data.votes || [], prefs: data.prefs || [] });
    all.entries = all.entries.map(entry => ({ ...entry })); all.votes = all.votes.map(vote => ({ ...vote }));
    const cases = new Map();
    for (const entry of all.entries) {
      const key = titleKey(entry), label = labelOf(entry, all.voteOf(entry));
      if (label !== null && (!cases.has(key) || entry.watched > cases.get(key).item.watched)) cases.set(key, { item: entry, label });
    }
    for (const vote of all.votes) if (!cases.has(titleKey(vote))) cases.set(titleKey(vote), { item: vote, label: vote.vote > 0 ? 1 : 0 });
    const pool = [...new Map(catalogItems.filter(item => item?.title).map(item => [titleKey(item), item])).values()];
    const rows = [];
    for (const [key, { item, label }] of cases) {
      const without = new Model(join(dir, 'one.json'), () => now);
      without.learnCatalogue(pool, 'eval');
      without.entries = all.entries.filter(entry => titleKey(entry) !== key);
      without.votes = all.votes.filter(vote => titleKey(vote) !== key);
      without.prefs = all.prefs; without.profileCache = null;
      const target = { ...item, vote: 0 };
      const own = without.match(target).percent;
      const others = pool.filter(other => titleKey(other) !== key && other.kind === item.kind).map(other => without.match(other).percent ?? 50);
      const score = own ?? 50;
      const below = others.filter(value => value < score).length, same = others.filter(value => value === score).length;
      rows.push({ title: item.title, kind: item.kind, label, match: own, genres: (item.genres || []).length, percentile: others.length ? Math.round((below + same / 2) / others.length * 100) : 50 });
    }
    const liked = rows.filter(row => row.label === 1), disliked = rows.filter(row => row.label === 0);
    let pairs = 0, wins = 0;
    for (const good of liked) for (const bad of disliked) { pairs++; wins += good.match > bad.match ? 1 : good.match === bad.match ? 0.5 : 0; }
    const mean = list => list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
    return {
      rows: rows.sort((a, b) => b.label - a.label || b.percentile - a.percentile),
      liked: liked.length, disliked: disliked.length,
      // Where a liked title lands among the catalogue (100 = first place, 50 = random).
      likedPercentile: mean(liked.map(row => row.percentile)),
      dislikedPercentile: mean(disliked.map(row => row.percentile)),
      // Liked titles that would make the top 20 % of the catalogue.
      likedInTop20: liked.length ? Math.round(liked.filter(row => row.percentile >= 80).length / liked.length * 100) : null,
      // Chance a liked title scores above a disliked one (0.5 = coin toss).
      auc: pairs ? Math.round(wins / pairs * 100) / 100 : null,
      withoutGenres: rows.filter(row => !row.genres).length
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1]?.endsWith('/eval-holy-taste.mjs')) {
  const [libraryFile = '.local/holy-library.json', catalogFile = '.local/holy-catalog.json'] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const data = JSON.parse(readFileSync(libraryFile, 'utf8'));
  // The catalogue as Holy loads it (one genre vocabulary), from a copy: the real files stay untouched.
  const copy = mkdtempSync(join(tmpdir(), 'holy-taste-catalog-'));
  writeFileSync(join(copy, 'c.json'), readFileSync(catalogFile));
  try { writeFileSync(join(copy, 'd.json'), readFileSync(catalogFile.replace('catalog', 'details'))); } catch { /* No details yet. */ }
  const catalog = new Catalog({ file: join(copy, 'c.json'), detailsFile: join(copy, 'd.json'), knownLists: null });
  // --fetch: first fills the genres of watched titles that lack them, as Holy does (reads the sites).
  if (process.argv.includes('--fetch')) {
    const library = new Library(join(copy, 'l.json'));
    Object.assign(library, { entries: data.entries, votes: data.votes });
    console.log('Géneros encontrados:', await library.fillGenres(item => catalog.genresFor(item)));
  }
  const items = catalog.items;
  rmSync(copy, { recursive: true, force: true });
  const result = evaluate(data, items);
  if (process.argv.includes('--save-genres')) writeFileSync(join(tmpdir(), 'holy-taste-library.json'), JSON.stringify(data));
  console.table(result.rows.map(row => ({ título: row.title.slice(0, 34), tipo: row.kind, real: row.label ? 'gustó' : 'no gustó', afinidad: row.match, puesto: row.percentile + ' %', géneros: row.genres })));
  const { rows, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  if (process.argv.includes('--json')) writeFileSync('.local/holy-taste-eval.json', JSON.stringify(result, null, 2));
}
