import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sectionRows, categoryRows, packHome, unpackHome } from '../src/holy.js';
import { PlaybackLog } from './holy/playback-log.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
const dir = mkdtempSync(join(tmpdir(), 'holy-discovery-'));
const originalNow = Date.now;
try {
  const film = { title: 'Psicosis', kind: 'movie', year: '1960', genres: ['Horror', 'Terror'], source: 'a', url: 'https://a.example/film', match: 90, rating: '8.5', localWatched: 900 };
  const data = { items: [film, { ...film, source: 'b', url: 'https://b.example/film' },
    { ...film, title: 'Nueva', year: '2026', rating: '', localWatched: 0 },
    { ...film, title: 'Psicosis', year: '1998' },
    { ...film, kind: 'anime', title: 'Anime' },
    { ...film, title: 'Acción', genres: ['Acción'] }], rows: [], sources: [] };
  const shelves = sectionRows(data, 'movie');
  assert.equal(shelves.filter(row => row.genre === 'terror').length, 1);
  assert.equal(shelves.find(row => row.genre === 'terror').items.length, 4);
  const rows = categoryRows(unpackHome(packHome(data)), 'movie', 'Térror', 2026);
  const all = rows.find(row => row.id === 'category-all').items;
  assert.equal(all.length, 3); assert.ok(all.every(item => item.kind === 'movie' && item.title !== 'Acción'));
  assert.deepEqual(rows.find(row => row.id === 'category-new').items.map(item => item.title), ['Nueva']);
  assert.equal(rows.find(row => row.id === 'curated-afi-thrills').items.length, 1);
  assert.equal(rows.find(row => row.id === 'curated-afi-thrills').items[0].year, '1960');
  assert.ok(!categoryRows({ items: [film] }, 'anime', 'Terror').length);
  assert.ok(!categoryRows({ items: [{ ...film, match: null, rating: 'TV-MA', localWatched: 0 }] }, 'movie', 'Terror').some(row => ['category-rated', 'category-watched', 'category-recommended'].includes(row.id)));

  const file = join(dir, 'playback.jsonl'), log = new PlaybackLog(file, 500);
  const session = { token: 5, item: film, choice:{kind:'dub',version:'SECRET_ID'},versionKind:'dub',target: 'https://name:password@player.example/v?token=SECRET#private', phase: 'playing', position: { t: 600, d: 3000 } };
  log.write('video-stalled', session, { ready: 2, mediaError: 3, url: session.target, error: 'SECRET', reason: 'failed https://test.example/?secret=SECRET' });
  const row = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(row.requestedKind,'dub');assert.equal(row.playingKind,'dub');
  assert.equal(row.host, 'player.example'); assert.equal(row.position, 600); assert.equal(row.mediaError, 3);
  assert.ok(!readFileSync(file, 'utf8').includes('SECRET')); assert.match(row.at, /^\d{4}-/);
  const privateLogFile=join(dir,'playback-enum.jsonl');
  new PlaybackLog(privateLogFile).write('language', {...session,choice:{kind:'SECRET_KIND'},versionKind:'https://private.example/?token=SECRET'}, {requestedKind:'SECRET',playingKind:'SECRET'});
  const privateRow=JSON.parse(readFileSync(privateLogFile,'utf8'));assert.equal(privateRow.requestedKind,'');assert.equal(privateRow.playingKind,'');assert.equal(readFileSync(privateLogFile,'utf8').includes('SECRET'),false);
  const inferredFile=join(dir,'playback-version.jsonl');
  new PlaybackLog(inferredFile).write('language',{...session,versionKind:undefined,version:'SECRET_ID',versions:[{id:'SECRET_ID',kind:'sub'}]});
  const inferredRow=JSON.parse(readFileSync(inferredFile,'utf8'));assert.equal(inferredRow.playingKind,'sub');assert.equal(readFileSync(inferredFile,'utf8').includes('SECRET_ID'),false);
  for (let i = 0; i < 10; i++) log.write('test', session);
  assert.ok(existsSync(file + '.1')); assert.ok(readFileSync(file, 'utf8').length < 1000);
  new PlaybackLog(dir).write('cannot-write', session); // Diagnostics cannot crash playback.

  let now = 100000, video = { t: 600, d: 3000, paused: false, ready: 2 }, rescues = [], events = [];
  Date.now = () => now;
  const bridge = Object.create(HolyBridge.prototype);
  Object.assign(bridge, { session: { ...session, item: { ...film }, key: film.url, lastSave: now }, navigation: { phase: 'complete' }, frames: new Map([['main', 'https://player.example/']]), mainFrame: 'main', midStall: 25000, stallTimeout: 20000,
    playerContexts: async () => [{ id: 1 }], evaluateWithGesture: async () => ({ url: 'https://player.example/', videos: video ? [video] : [], top: true }),
    playbackLog: { write: event => events.push(event) }, library: { progress() {} }, rescue: async (s, at) => { rescues.push(at); s.rescues = 1; } });
  await bridge.watch(); now += 26000; await bridge.watch();
  assert.deepEqual(rescues, [600]); assert.ok(events.includes('video-stalled'));
  rescues = []; bridge.session.midStall = null; video.paused = true;
  await bridge.watch(); now += 60000; await bridge.watch(); assert.equal(rescues.length, 0);
  // Seeking backward must reset the timer too.
  video = { ...video, paused: false, t: 400 }; bridge.session.midStall = { t: 600, since: now - 60000 };
  await bridge.watch(); assert.equal(rescues.length, 0);
  // A player that disappears is detected, including failed frame evaluations.
  video = null; await bridge.watch(); now += 26000; await bridge.watch(); assert.equal(rescues.length, 1);
  rescues = []; video = { t: 800, d: 3000, paused: true, mediaError: 3 }; bridge.session.midStall = null;
  await bridge.watch(); now += 26000; await bridge.watch(); assert.deepEqual(rescues, [], 'A paused media error preserves the server');
  video.paused = false; await bridge.watch(); now += 26000; await bridge.watch(); assert.deepEqual(rescues, [800], 'The same error can recover once playback is unpaused');
  // A slow player can accept the saved position on a later poll, without losing it to a save at zero.
  rescues = []; video = { t: 2, d: 3000, paused: false };
  bridge.session.resumePending = { at: 795, until: now + 15000 };
  bridge.evaluateWithGesture = async expression => expression.includes('holySeek') ? true : { url: 'https://player.example/', videos: [video], top: true };
  await bridge.watch(); assert.equal(bridge.session.resumePending, null); assert.equal(rescues.length, 0);
  bridge.session.resumePending = { at: 795, until: now - 1 };
  await bridge.watch(); assert.ok(events.includes('resume-unconfirmed'));
  // No alternative: reload this episode once, save position and retain resume target.
  let opened = 0;
  Object.assign(bridge, { rescue: HolyBridge.prototype.rescue, errors: [], nextSite: async () => false, openServer: async () => { opened++; } });
  bridge.session.rescues = 0;
  await bridge.rescue(bridge.session, 800); assert.equal(opened, 1); assert.equal(bridge.session.resumeAt, 795);
  await bridge.rescue(bridge.session, 800); assert.equal(opened, 1); assert.equal(bridge.session.rescues, 3);
  await bridge.rescue(bridge.session, 800); assert.equal(opened, 1); assert.ok(events.includes('recovery-exhausted'));
  console.log('Categorías, fuentes, registro privado con rotación y recuperación: correctos (sin TV ni Internet).');
} finally { Date.now = originalNow; rmSync(dir, { recursive: true, force: true }); }
