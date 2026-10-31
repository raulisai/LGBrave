import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticLog, redact } from './diagnostics.mjs';
import { PlaybackLog } from './holy/playback-log.mjs';
import { Catalog } from './holy/catalog.mjs';
import { attempts, serverStats, closures, incidentSummary } from './holy/playback-report.mjs';

const dir = mkdtempSync(join(tmpdir(), 'holy-log-'));
const lines = file => readFileSync(join(dir, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
let passed = 0;
const check = (name, fn) => { fn(); passed++; };
try {
  check('Las direcciones siguen legibles sin token y las rutas privadas se ocultan', () => {
    assert.equal(redact('falló https://mxdrop.to/e/abc?token=zzz'), 'falló https://mxdrop.to/e/abc');
    assert.equal(redact('C:\\Users\\raul\\x.json roto'), '[local-path] roto');
    assert.equal(redact("open '/Users/djoker/x.json'"), "open '[local-path]'");
  });
  check('Los incidentes quedan en un archivo mensual y una repetición cuenta, no ensucia', () => {
    let clock = Date.parse('2026-10-05T10:00:00.000Z');
    const log = new DiagnosticLog({ file: join(dir, 'diagnostics.jsonl'), now: () => new Date(clock).toISOString() });
    log.event('catalog', 'source-error', { source: 'x', error: Error('caído') }, 'error');
    for (let i = 0; i < 5; i++) { clock += 1000; log.event('catalog', 'source-error', { source: 'x', error: Error('caído') }, 'error'); }
    clock += 700000; log.event('catalog', 'source-error', { source: 'x', error: Error('caído') }, 'error');
    log.event('playback', 'x', {}, 'info');
    const rows = lines('incidents-2026-10.jsonl');
    assert.equal(rows.length, 2); assert.equal(rows[1].repeats, 5);
    assert.equal(lines('diagnostics.jsonl').length, 8);
    assert.deepEqual(incidentSummary(rows), [{ veces: 7, incidente: 'catalog · source-error · caído' }]);
  });
  check('La rotación no borra el historial: cada intento sigue en el archivo del mes', () => {
    const log = new PlaybackLog(join(dir, 'holy-playback.jsonl'), 50);
    const session = { token: 1, item: { title: 'Coda', source: 'repelishd' }, target: 'https://mxdrop.to/e/1?t=secreto', phase: 'opening' };
    for (let i = 0; i < 4; i++) log.write('server-opening', session);
    log.write('pause-hold', session); log.write('server-failed', session, { reason: 'sin vídeo tras 14 s', elapsedMs: 14000 });
    const month = readdirSync(dir).find(name => name.startsWith('history-'));
    const rows = lines(month);
    assert.equal(rows.length, 5); assert.equal(rows[4].reason, 'sin vídeo tras 14 s'); assert.equal(rows[4].elapsedMs, 14000);
    assert.ok(!JSON.stringify(rows).includes('secreto'));
  });
  const row = (event, extra = {}) => ({ at: '2026-10-26T22:00:00.000Z', runId: 'r', session: 1, title: 'Coda', event, ...extra });
  check('Cada título sale con su resultado', () => {
    const rescued = attempts([row('server-opening', { host: 'a' }), row('server-failed', { host: 'a', reason: 'sin vídeo' }), row('server-opening', { host: 'b' }), row('playback-started', { host: 'b', elapsedMs: 9000 })]);
    assert.equal(rescued[0].outcome, 'rescatado'); assert.equal(rescued[0].host, 'b'); assert.equal(rescued[0].startMs, 9000);
    assert.equal(attempts([row('attempt-failed', { reason: 'sin reproductor' })])[0].outcome, 'FALLÓ');
    assert.equal(attempts([row('server-opening', { host: 'a' }), row('playback-started', { host: 'a' })])[0].outcome, 'reproducido');
    assert.equal(attempts([row('server-opening', { host: 'a' })])[0].outcome, 'sin arrancar');
    assert.deepEqual(serverStats([row('server-opening', { host: 'a' }), row('server-failed', { host: 'a' })]), [{ servidor: 'a', abiertos: 1, arrancaron: 0, fallaron: 1 }]);
  });
  check('Un cierre durante el vídeo se explica por lo que hizo la conexión después', () => {
    const closed = [row('player-disconnected', { position: 965, duration: 5826 })];
    const later = (seconds, state) => ({ at: new Date(Date.parse(closed[0].at) + seconds * 1000).toISOString(), state });
    assert.match(closures(closed, [later(1, 'waiting'), later(8, 'offline')])[0].cause, /apagó/);
    assert.match(closures(closed, [later(1, 'waiting'), later(30, 'connected')])[0].cause, /volvió a abrir/);
    assert.match(closures(closed, [later(1, 'waiting'), later(900, 'offline')])[0].cause, /TV encendida/);
  });
} finally { rmSync(dir, { recursive: true, force: true }); }

// City Hunter 1 (2026-10-31): ok.ru blocked and Streamtape deleted, Mixdrop and Uqload alive.
const urls = ['https://ok.ru/1', 'https://mix.example/1', 'https://st.example/1', 'https://uq.example/1'];
const resolved = async probe => {
  const connector = { id: 'x', name: 'X', site: 'https://x.example/', resolve: async () => ({ url: urls[0], alternatives: urls.slice(1) }) };
  const catalog = new Catalog({ file: join(dir, 'gone.json'), detailsFile: join(dir, 'gone-details.json'), connectors: [connector], fetch: async () => '', probe });
  return catalog.resolve({ source: 'x', url: 'https://x.example/e', title: 'City Hunter' });
};
mkdirSync(dir, { recursive: true });
const living = await resolved(async url => /ok\.ru|st\.example/.test(url));
assert.equal(living.url, urls[1]); assert.deepEqual(living.alternatives, [urls[3]]); passed++;
const allGone = await resolved(async () => true);
assert.equal(allGone.url, urls[0]); assert.equal(allGone.alternatives.length, 3); passed++;
const unknown = await resolved(async () => { throw Error('lento'); });
assert.equal(unknown.url, urls[0]); assert.equal(unknown.alternatives.length, 3); passed++;
rmSync(dir, { recursive: true, force: true });
console.log(`${passed} comprobaciones del registro de fallos y servidores caídos correctas.`);
