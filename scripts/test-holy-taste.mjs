import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library } from './holy/library.mjs';
import { genreList } from './holy/sources.mjs';
import { genreLabel } from '../src/holy-genres.js';
import { evaluate, labelOf } from './eval-holy-taste.mjs';
import { mergeLibraryState } from './holy/taste-state.mjs';

const dir = mkdtempSync(join(tmpdir(), 'holy-taste-'));
let passed = 0;
const check = async (name, fn) => { await fn(); passed++; };
const NOW = Date.parse('2026-11-03T12:00:00Z');
const film = (title, genres, extra = {}) => ({ key: 'https://x.test/' + title, url: 'https://x.test/' + title, title, kind: 'movie', genres, t: 0, duration: 6000, watched: 0, plays: 1, updatedAt: NOW - 3600000, ...extra });
try {
  await check('Los géneros en inglés cuentan como los mismos gustos', () => {
    assert.deepEqual(genreList(['Horror', 'Mystery', 'Action & Adventure', 'Sci-Fi & Fantasy', 'Crime', 'HD']), ['Terror', 'Misterio', 'Acción', 'Aventura', 'Ciencia ficción', 'Fantasía', 'Crimen']);
    assert.equal(genreLabel('Animation'), 'Animación');
    assert.equal(genreLabel('Documentary'), 'Documental');
  });
  await check('Lo visto sin géneros los recibe una sola vez y empieza a contar', async () => {
    const library = new Library(join(dir, 'a.json'), () => NOW);
    library.entries = [film('Amadeus', [], { watched: 5000, t: 5900, finished: true }), film('Coda', ['Drama'])];
    const asked = [];
    assert.equal(await library.fillGenres(item => { asked.push(item.title); return ['Drama', 'Historia', 'Música']; }), 1);
    assert.deepEqual(library.get('https://x.test/Amadeus').genres, ['Drama', 'Historia', 'Música']);
    assert.equal(await library.fillGenres(() => { throw Error('no se vuelve a pedir'); }), 0);
    assert.deepEqual(asked, ['Amadeus']);
    assert.ok(library.profile().genres.get('Música') > 0);
  });
  await check('Combinar con la copia de la TV o de otra computadora no borra los géneros encontrados', () => {
    const mine = film('Amadeus', ['Drama', 'Música']), theirs = film('Amadeus', []);
    for (const [left, right] of [[{ entries: [mine] }, { entries: [theirs] }], [{ entries: [theirs] }, { entries: [mine] }]]) {
      assert.deepEqual(mergeLibraryState({ votes: [], prefs: [], ...left }, { votes: [], prefs: [], ...right }).entries[0].genres, ['Drama', 'Música']);
    }
  });
  await check('Un género raro pesa más que uno que está en todo el catálogo', () => {
    const library = new Library(join(dir, 'b.json'), () => NOW);
    library.entries = [film('Amadeus', ['Drama', 'Música'], { watched: 5000, t: 5900, finished: true }), film('Coda', ['Drama', 'Música'], { watched: 5000, t: 5900, finished: true })];
    assert.equal(library.profile().genres.get('Drama'), library.profile().genres.get('Música'));
    library.learnCatalogue([...Array(30)].map((_, i) => ({ genres: i < 2 ? ['Drama', 'Música'] : ['Drama'] })), 1);
    assert.ok(library.profile().genres.get('Música') > library.profile().genres.get('Drama'));
    const musical = library.match({ title: 'La La Land', kind: 'movie', genres: ['Música', 'Romance'] }).percent;
    const drama = library.match({ title: 'Otro drama', kind: 'movie', genres: ['Drama', 'Romance'] }).percent;
    assert.ok(musical > drama, `${musical} > ${drama}`);
  });
  await check('La medición separa lo que gustó de lo que se dejó y no cuenta reproductores rotos', () => {
    assert.equal(labelOf(film('a', [], { finished: true, watched: 5800 })), 1);
    assert.equal(labelOf(film('b', [], { watched: 300 })), 0);
    assert.equal(labelOf(film('c', [], { watched: 30 })), null);
    assert.equal(labelOf(film('d', []), -1), 0);
    const data = { entries: [film('Terror 1', ['Terror'], { watched: 5800, finished: true }), film('Terror 2', ['Terror'], { watched: 5800, finished: true }), film('Comedia', ['Comedia'], { watched: 400 })], votes: [], prefs: [] };
    const catalogue = [...Array(20)].map((_, i) => ({ title: 'T' + i, url: 'https://x.test/t' + i, kind: 'movie', genres: [i % 2 ? 'Terror' : 'Comedia'] }));
    const result = evaluate(data, catalogue, { now: NOW });
    assert.equal(result.liked, 2);
    assert.equal(result.disliked, 1);
    assert.ok(result.likedPercentile > result.dislikedPercentile);
  });
  console.log(`Gustos de Holy: ${passed} pruebas correctas.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
