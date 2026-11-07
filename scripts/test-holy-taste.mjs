import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Library, entryKey } from './holy/library.mjs';
import { genreList } from './holy/sources.mjs';
import { genreLabel } from '../src/holy-genres.js';
import { evaluate, labelOf } from './eval-holy-taste.mjs';
import { mergeLibraryState, tasteKey } from './holy/taste-state.mjs';
import { Catalog } from './holy/catalog.mjs';
import { packHome } from '../src/holy.js';
import { Credits } from './holy/credits.mjs';

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
  const seen = (title, genres, extra = {}) => film(title, genres, { watched: 5000, t: 5900, finished: true, ...extra });
  await check('Sagas: gustar del anime sube sus películas; dos títulos iguales sin subtítulo son remakes, no saga', () => {
    const library = new Library(join(dir, 's.json'), () => NOW);
    library.votes = [{ key: 'https://x.test/op', url: 'https://x.test/op', title: 'One Piece', kind: 'anime', genres: ['Acción', 'Aventura'], studios: [], vote: 2, at: NOW },
      { key: 'https://x.test/crash', url: 'https://x.test/crash', title: 'Crash', kind: 'movie', year: '2005', genres: ['Drama'], studios: [], vote: 1, at: NOW }];
    const saga = library.match({ title: 'One Piece: Red', kind: 'movie', genres: ['Animación'], url: 'https://x.test/red' });
    const other = library.match({ title: 'Otra animada', kind: 'movie', genres: ['Animación'], url: 'https://x.test/otra' });
    // Two signals only (Holy keeps scores near 50 % until it knows more): still ten points up.
    assert.ok(saga.percent >= other.percent + 8, `${saga.percent} >= ${other.percent} + 8`);
    assert.equal(saga.reason.split(' · ')[0], 'Porque viste One Piece');
    assert.ok(!library.match({ title: 'Crash', kind: 'movie', year: '1996', genres: ['Drama'], url: 'https://x.test/crash96' }).reason.includes('Porque viste'));
  });
  await check('Actores: el que más ves sube sus otras películas y lo dice; elegir a alguien en Gustos también cuenta', () => {
    const cast = { Click: ['Adam Sandler', 'Kate Beckinsale'], 'Grown Ups': ['Adam Sandler', 'Kevin James'], Blended: ['Adam Sandler', 'Drew Barrymore'], Otra: ['Nadie Conocido'] };
    const facts = { people: item => (cast[item.title] || []).map((name, order) => ({ name, role: 'cast', order })) };
    const library = new Library(join(dir, 'p.json'), () => NOW);
    library.learnFacts(facts, 1);
    library.entries = [seen('Click', ['Comedia']), seen('Grown Ups', ['Comedia'])];
    const sandler = library.match({ title: 'Blended', kind: 'movie', genres: ['Comedia'], url: 'https://x.test/blended' });
    const plain = library.match({ title: 'Otra', kind: 'movie', genres: ['Comedia'], url: 'https://x.test/otra' });
    assert.ok(sandler.percent > plain.percent, `${sandler.percent} > ${plain.percent}`);
    assert.ok(sandler.reason.includes('Con Adam Sandler'));
    assert.deepEqual(library.favouritePeople().map(person => [person.name, person.role]), [['Adam Sandler', 'cast']]);
    const chosen = new Library(join(dir, 'p2.json'), () => NOW);
    chosen.learnFacts(facts, 1);
    chosen.entries = [seen('Uno', ['Comedia']), seen('Dos', ['Comedia'])];
    assert.equal(chosen.prefer('person', 'Drew Barrymore', 1), 1);
    assert.ok(chosen.match({ title: 'Blended', kind: 'movie', genres: ['Comedia'], url: 'https://x.test/blended' }).percent > chosen.match({ title: 'Otra', kind: 'movie', genres: ['Comedia'], url: 'https://x.test/otra' }).percent);
    assert.deepEqual(chosen.favouritePeople().map(person => [person.name, person.note]), [['Drew Barrymore', 'Lo elegiste en Gustos']]);
  });
  await check('Premiadas: a quien ve películas premiadas le suben las premiadas; a quien nunca, apenas', () => {
    const prized = new Set(['Amadeus', 'Gladiator', 'Coda', 'Ganadora']);
    const facts = { acclaim: item => (prized.has(item.title) ? 1 : 0), base: 0.05 };
    const fan = new Library(join(dir, 'a1.json'), () => NOW), casual = new Library(join(dir, 'a2.json'), () => NOW);
    for (const [library, titles] of [[fan, ['Amadeus', 'Gladiator', 'Coda']], [casual, ['Uno', 'Dos', 'Tres']]]) { library.learnFacts(facts, 1); library.entries = titles.map(title => seen(title, ['Drama'])); }
    const gap = library => library.match({ title: 'Ganadora', kind: 'movie', genres: ['Misterio'], url: 'https://x.test/g' }).percent - library.match({ title: 'Cualquiera', kind: 'movie', genres: ['Misterio'], url: 'https://x.test/c' }).percent;
    assert.ok(fan.profile().acclaim > 0.9 && casual.profile().acclaim < 0);
    assert.ok(gap(fan) > gap(casual) + 3, `${gap(fan)} > ${gap(casual)} + 3`);
  });
  await check('Recomendado para ti con variedad: una saga no llena la fila', () => {
    const library = new Library(join(dir, 'v.json'), () => NOW);
    library.entries = [seen('Terror 1', ['Terror']), seen('Comedia 1', ['Comedia'])];
    const items = [...[...Array(8)].map((_, i) => ({ title: 'Saw: parte ' + (i + 1), kind: 'movie', genres: ['Terror'], url: 'https://x.test/saw' + i })),
      ...[...Array(4)].map((_, i) => ({ title: 'Risa ' + i, kind: 'movie', genres: ['Comedia'], url: 'https://x.test/risa' + i }))];
    const top = library.recommend(items, 6).map(item => item.title);
    assert.ok(top.filter(title => title.startsWith('Saw')).length < 6, top.join());
    assert.ok(top.some(title => title.startsWith('Risa')));
  });
  await check('Porque viste…: lo más parecido a lo que te gustó (géneros raros, saga, personas), sin lo ya visto', () => {
    const library = new Library(join(dir, 'b.json'), () => NOW);
    library.learnCatalogue([...Array(20)].map((_, i) => ({ genres: i < 2 ? ['Música'] : ['Drama'] })), 1);
    library.entries = [seen('Amadeus', ['Drama', 'Música', 'Historia'], { year: '1984' }), film('Apenas', ['Drama'], { watched: 200 })];
    const [anchor] = library.anchors();
    assert.equal(anchor.title, 'Amadeus');
    const near = library.similarTo(anchor, [{ title: 'Whiplash', kind: 'movie', genres: ['Drama', 'Música'], url: 'u1' }, { title: 'Otro drama', kind: 'movie', genres: ['Drama'], url: 'u2' }, { title: 'Amadeus', kind: 'movie', genres: ['Drama', 'Música'], url: 'u3' }]);
    assert.deepEqual(near.map(item => [item.title, item.reason]), [['Whiplash', 'Porque viste Amadeus']]);
  });
  await check('Reparto: el IMDb de la página o el de Wikidata (mismo nombre, tipo y año), luego Cinemeta; un nombre dudoso no se adivina', async () => {
    const asked = [];
    const work = (label, id, imdb, first, kind) => ({ label: { value: label }, work: { value: 'http://www.wikidata.org/entity/' + id }, imdb: { value: imdb }, first: { value: first }, classes: { value: kind } });
    const fake = async url => {
      asked.push(url.includes('wikidata') ? 'wikidata' : /tt\d+/.exec(url)[0]);
      if (url.includes('wikidata')) return Response.json({ results: { bindings: [work('El rito', 'Q1', 'tt1161864', '2011', 'Q11424'), work('El rito', 'Q2', 'tt0064897', '1969', 'Q506240'),
        work('City Hunter', 'Q3', 'tt1982229', '2011', 'Q5398426'), work('City Hunter', 'Q4', 'tt0159208', '1987', 'Q63952888 Q5398426'), work('Amadeus', 'Q5', 'nm0023741', '', 'Q5')] } });
      return Response.json({ meta: { name: 'X', cast: ['Colin O&apos;Donoghue', 'Anthony Hopkins', 'Ciarán Hinds', 'Cuarto'], director: ['Mikael Håfström'], imdbRating: '6.0' } });
    };
    const credits = new Credits({ file: join(dir, 'credits.json'), fetch: fake, now: () => NOW });
    const rito = { title: 'El rito', kind: 'movie', year: '2011', url: 'https://x.test/rito' }, hunter = { title: 'City Hunter', kind: 'dorama', url: 'https://x.test/ch' };
    const gladiator = { title: 'Gladiator', kind: 'movie', year: '2000', imdb: 'tt0172495', url: 'https://x.test/g' }, anime = { title: 'One Piece', kind: 'anime', url: 'https://x.test/op' };
    assert.equal(await credits.fill([rito, hunter, gladiator, anime]), 2);
    assert.deepEqual([credits.idOf(rito), credits.idOf(hunter)], ['tt1161864', ''], 'dos series con ese nombre y sin año: ninguna');
    assert.deepEqual(credits.people(rito).map(person => [person.name, person.role, person.order]), [["Colin O'Donoghue", 'cast', 0], ['Anthony Hopkins', 'cast', 1], ['Ciarán Hinds', 'cast', 2], ['Mikael Håfström', 'director', 0]]);
    assert.deepEqual(credits.people(anime), []);
    asked.length = 0;
    assert.equal(await credits.fill([rito, hunter, gladiator]), 0);
    assert.deepEqual(asked, [], 'lo ya sabido no se vuelve a pedir');
    assert.equal(new Credits({ file: join(dir, 'credits.json') }).people(gladiator)[0].name, "Colin O'Donoghue");
  });

  await check('Votos: primera coincidencia de dirección o título; acentos, tipo, año y objeto modificado', () => {
    const library = new Library(join(dir, 'vote-identities.json'), () => NOW);
    const first = { ...film('Café', ['Drama'], { url:'https://x.test/a', key:'https://x.test/a', year:'2001' }), vote:1, at:NOW };
    const second = { ...film('Otra', ['Comedia'], { url:'https://x.test/b', key:'https://x.test/b', year:'2001' }), vote:-1, at:NOW };
    const item = { title:'CAFE!', kind:'movie', year:'2001', url:second.url };
    library.votes = [first, second];
    assert.equal(library.voteOf(item),1,'título anterior gana a dirección posterior');
    library.votes = [second, first];
    assert.equal(library.voteOf(item),-1,'dirección anterior gana a título posterior');
    library.votes = [first];
    item.url='https://x.test/c';assert.equal(library.voteOf(item),1);
    item.title='Otra';assert.equal(library.voteOf(item),0,'no memorizar un título por identidad de objeto');
    item.title='Café';item.year='2002';assert.equal(library.voteOf(item),0);
    item.year='2001';item.kind='anime';assert.equal(library.voteOf(item),0);
    item.kind='movie';item.show=first.url;item.title='Otra';assert.equal(library.voteOf(item),1,'la dirección de serie también cuenta');
  });
  await check('Votos: cambios, borrado, importación, reemplazo y versión no conservan un índice antiguo', () => {
    const library=new Library(join(dir,'vote-changes.json'),()=>NOW);
    const item=film('Título', ['Drama'], {key:'https://x.test/one',url:'https://x.test/one'});
    assert.equal(library.voteOf(item),0);
    assert.equal(library.vote(item,1),1);assert.equal(library.voteOf(item),1);
    assert.equal(library.vote(item,-1),-1);assert.equal(library.voteOf(item),-1);
    library.vote(item,0);assert.equal(library.voteOf(item),0);
    const incoming=new Library(join(dir,'vote-incoming.json'),()=>NOW+1000);
    incoming.vote(item,2);library.mergeTastes(incoming.exportTastes());assert.equal(library.voteOf(item),2);
    library.clearVotes();assert.equal(library.voteOf(item),0);
    library.votes=[{...item,vote:1,at:NOW}];assert.equal(library.voteOf(item),1);
    library.votes.push({...film('Otra',[],{key:'https://x.test/two',url:'https://x.test/two'}),vote:-1,at:NOW});
    assert.equal(library.voteOf({title:'Otra',kind:'movie',url:'https://x.test/copy'}),-1);
    library.votes.splice(0,1);assert.equal(library.voteOf(item),0);
    library.votes[0]={...item,vote:2,at:NOW};library.version++;
    assert.equal(library.voteOf(item),2);
    library.votes=[];assert.equal(library.voteOf(item),0);
  });
  await check('Votos: consultas repetidas no vuelven a normalizar toda la lista', () => {
    const library=new Library(join(dir,'vote-warm.json'),()=>NOW);let reads=0;
    library.votes=Array.from({length:22},(_,index)=>({key:'https://x.test/v'+index,kind:'movie',vote:1,
      get title(){reads++;return 'Película '+index;}}));
    const item={title:'Película 21',kind:'movie',url:'https://x.test/other'};
    assert.equal(library.voteOf(item),1);const cold=reads;
    for(let i=0;i<100;i++)assert.equal(library.voteOf({...item}),1);
    assert.equal(reads,cold,'cien consultas no recorren los veintidós títulos otra vez');
    library.version++;assert.equal(library.voteOf(item),1);assert.ok(reads>cold);
  });
  await check('Catálogo: mismo JSON de recomendaciones, orden, afinidad y motivos que la búsqueda lineal anterior', () => {
    const items=Array.from({length:160},(_,index)=>film('Título '+index,[index%2?'Comedia':'Drama',index%3?'Acción':'Música'],{
      key:'https://x.test/c'+index,url:'https://x.test/c'+index,year:String(2000+index%20),
      kind:['movie','anime','dorama','series'][index%4],source:['cuevana','jkanime','doramasflix','cuevana'][index%4]}));
    const build=legacy=>{
      const library=new Library(join(dir,legacy?'scan.json':'indexed.json'),()=>NOW);
      library.entries=items.slice(0,47).map(item=>({...item,watched:5000,t:5900,finished:true}));
      library.votes=items.slice(0,22).map((item,index)=>({...item,vote:[1,-1,2][index%3],at:NOW}));
      if(legacy)library.voteOf=function(item){return this.votes.find(v=>v.key===entryKey(item||{})||tasteKey(v)===tasteKey(item))?.vote||0;};
      const catalog=new Catalog({file:join(dir,'missing.json'),detailsFile:join(dir,'missing-details.json'),knownLists:null,credits:null});
      catalog.items=structuredClone(items);catalog.updatedAt=NOW;
      return JSON.stringify(packHome(catalog.home(library)));
    };
    assert.equal(build(false),build(true));
  });
  console.log(`Gustos de Holy: ${passed} pruebas correctas.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
