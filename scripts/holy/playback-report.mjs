import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../desktop-config.mjs';
const file = join(ROOT, '.local/logs/holy-playback.jsonl');
const rows = [];
for (const path of [file + '.1', file]) {
  try { for (const line of readFileSync(path, 'utf8').split('\n')) { try { rows.push(JSON.parse(line)); } catch { /* Ignore partial lines. */ } } } catch { /* No incidents yet. */ }
}
if (!rows.length) console.log('Todavía no hay registros de reproducción en esta computadora. Se generan al usar Holy con el servicio actualizado.');
else {
  const counts = new Map();
  for (const row of rows) counts.set(row.event, (counts.get(row.event) || 0) + 1);
  console.log('Registros locales conservados: ' + rows.length);
  console.table([...counts].map(([evento, cantidad]) => ({ evento, cantidad })));
  console.table(rows.slice(-30).map(row => ({ fecha: row.at, evento: row.event, título: row.title, segundo: Math.round(row.seconds ?? row.position), servidor: row.host, detalle: row.reason || row.mediaError || row.phase })));
}
