import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Catalog, playerGone } from './holy/catalog.mjs';
import { CONNECTORS } from './holy/connectors.mjs';

// `node scripts/validate-holy-servers.mjs [catalogo.json] [títulos por sitio]`: for real titles of
// every site, asks each server whether the video still exists and shows which one the TV would
// open first and what it falls back to. Real sites, no TV.
const file = process.argv[2] || '.local/holy-catalog.json', perSite = Number(process.argv[3]) || 5;
const items = JSON.parse(readFileSync(file, 'utf8')).items;
const dir = mkdtempSync(join(tmpdir(), 'holy-servers-'));
const gone = [];
const probe = async (url, referrer) => { const result = await playerGone(url, referrer); if (result) gone.push(new URL(url).hostname); return result; };
const catalog = new Catalog({ file: join(dir, 'c.json'), detailsFile: join(dir, 'd.json'), probe });
const report = [];
for (const connector of CONNECTORS) {
  const list = items.filter(item => item.source === connector.id && !item.isShow).sort(() => 0.5 - Math.random()).slice(0, perSite);
  const row = { sitio: connector.name, títulos: list.length, conServidor: 0, sinServidor: 0, conRespaldo: 0, caídos: 0, primeros: new Set(), errores: new Set() };
  for (const item of list) {
    const before = gone.length;
    const target = await catalog.resolve(item).catch(error => { row.errores.add(String(error.message).slice(0, 70)); return null; });
    row.caídos += gone.length - before;
    if (!target) { row.sinServidor++; continue; }
    row.conServidor++; if (target.alternatives?.length) row.conRespaldo++;
    row.primeros.add(new URL(target.url).hostname);
  }
  report.push({ ...row, primeros: [...row.primeros].join(' '), errores: [...row.errores].join(' | ') });
}
console.table(report);
writeFileSync('evidence/holy/servers.json', JSON.stringify({ at: new Date().toISOString(), scope: 'Consulta real a sitios y servidores desde la computadora; no prueba reproducción en TV', report, gone }, null, 2) + '\n');
rmSync(dir, { recursive: true, force: true });
process.exit(0);
