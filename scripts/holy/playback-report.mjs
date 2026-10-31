import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../desktop-config.mjs';

// `npm run holy:errors`: every title tried and how it ended, how each server does, and why
// the app closed during a video. Reads the permanent monthly files plus the rotating logs.
const readRows = path => { try { return readFileSync(path, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); } catch { return []; } };
const unique = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));

// Groups the events of one play into a single line with its outcome.
export function attempts(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.title) continue;
    const key = `${row.runId}|${row.session}|${row.title}|${row.episode ?? ''}`;
    if (!groups.has(key)) groups.set(key, { at: row.at, title: row.title, episode: row.episode, source: row.source, tried: [], failed: [], started: false, closed: false, gaveUp: '', position: 0, duration: 0 });
    const group = groups.get(key);
    if (row.position) group.position = row.position;
    if (row.duration) group.duration = row.duration;
    if (row.event === 'server-opening' && row.host) group.tried.push(row.host);
    if (row.event === 'server-failed') group.failed.push({ host: row.host, reason: row.reason || 'sin motivo registrado' });
    if (row.event === 'attempt-failed') group.gaveUp = row.reason || 'sin motivo registrado';
    if (['playback-started', 'recovery-started'].includes(row.event)) { group.started = true; group.host = row.host; group.startMs ??= row.elapsedMs; }
    if (row.event === 'player-disconnected') group.closed = true;
  }
  return [...groups.values()].map(group => ({ ...group, outcome: group.gaveUp || (!group.started && group.failed.length) ? 'FALLÓ' : !group.started ? 'sin arrancar' : group.failed.length ? 'rescatado' : 'reproducido' }));
}

export function serverStats(rows) {
  const hosts = new Map();
  const of = host => { if (!hosts.has(host)) hosts.set(host, { servidor: host, abiertos: 0, arrancaron: 0, fallaron: 0 }); return hosts.get(host); };
  for (const row of rows) {
    if (!row.host) continue;
    if (row.event === 'server-opening') of(row.host).abiertos++;
    if (row.event === 'playback-started') of(row.host).arrancaron++;
    if (row.event === 'server-failed') of(row.host).fallaron++;
  }
  return [...hosts.values()].sort((a, b) => b.fallaron - a.fallaron || b.abiertos - a.abiertos);
}

// Why the player went away, judged by what the connection did right after.
export function closures(rows, connection) {
  return rows.filter(row => row.event === 'player-disconnected').map(row => {
    const after = connection.filter(item => item.at > row.at && Date.parse(item.at) - Date.parse(row.at) < 120000 && item.state !== 'waiting')[0];
    const cause = after?.state === 'offline' ? 'la TV se apagó o perdió la red' : after?.state === 'connected' ? 'la app se cerró y se volvió a abrir' : 'la app se cerró con la TV encendida';
    return { at: row.at, title: row.title, position: Math.round(row.position || 0), duration: Math.round(row.duration || 0), cause };
  });
}

export function incidentSummary(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = [row.component, row.event, row.error?.message || row.state || row.host || row.action || ''].join(' · ').slice(0, 110);
    counts.set(key, (counts.get(key) || 0) + 1 + (row.repeats || 0));
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([incidente, veces]) => ({ veces, incidente }));
}

if (process.argv[1]?.endsWith('playback-report.mjs')) {
  const logs = join(ROOT, '.local/logs');
  const names = (() => { try { return readdirSync(logs); } catch { return []; } })();
  const rows = unique(names.filter(name => /^(history-|holy-playback\.jsonl)/.test(name)).flatMap(name => readRows(join(logs, name))));
  const diagnostics = unique(names.filter(name => /^diagnostics\.jsonl/.test(name)).flatMap(name => readRows(join(logs, name))));
  const incidents = unique(names.filter(name => /^incidents-/.test(name)).flatMap(name => readRows(join(logs, name))));
  if (!rows.length) console.log('Todavía no hay registros de reproducción en esta computadora.');
  else {
    const list = attempts(rows);
    console.log(`Reproducciones registradas: ${list.length}, desde ${rows[0].at}`);
    console.table(list.slice(-40).map(item => ({ fecha: item.at?.slice(0, 16), título: item.title + (item.episode ? ' ' + item.episode : ''), resultado: item.outcome, sitio: item.source, servidor: item.host || item.tried.at(-1) || '', fallos: item.failed.map(fail => `${fail.host}: ${fail.reason}`).join(' | ') || item.gaveUp })));
    console.log('Servidores:'); console.table(serverStats(rows));
    const closed = closures(rows, diagnostics.filter(row => row.component === 'connection'));
    if (closed.length) { console.log('Cierres durante un vídeo:'); console.table(closed); }
  }
  if (incidents.length) { console.log('Incidentes:'); console.table(incidentSummary(incidents).slice(0, 25)); }
}
