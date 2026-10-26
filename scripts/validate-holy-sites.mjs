// Live check of every site Holy reads (from the Mac, never the TV): newest titles,
// details, player for two titles, search and an episode list. Run it when a row
// looks empty or after a site changes. Report: evidence/holy/sites.json.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Catalog } from './holy/catalog.mjs';
import { CONNECTORS } from './holy/connectors.mjs';

const QUERIES = { cuevana: 'batman', repelishd: 'batman', jkanime: 'one piece', animeyt: 'one piece', doramasflix: 'amor', doramasmp4: 'amor', asialiveaction: 'amor' };
const scratch = mkdtempSync(join(tmpdir(), 'holy-sites-'));
const catalog = new Catalog({ file: join(scratch, 'c.json'), detailsFile: join(scratch, 'd.json') });
const report = { capturedAt: new Date().toISOString(), scope: 'Lectura desde el Mac de cada sitio; no reproduce vídeo ni toca la TV.', sites: [] };
const timed = async work => { const started = Date.now(); try { return { ok: true, value: await work(), ms: Date.now() - started }; } catch (error) { return { ok: false, error: error.message, ms: Date.now() - started }; } };
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);

await catalog.refresh();
for (const connector of CONNECTORS) {
  if (only && connector.id !== only) continue;
  const items = catalog.items.filter(item => item.source === connector.id);
  const site = { id: connector.id, name: connector.name, titles: items.length, error: catalog.errors[connector.id] || '', withGenres: items.filter(item => item.genres.length).length, checks: {} };
  report.sites.push(site);
  const playable = items.filter(item => !item.isShow).slice(0, 2);
  site.checks.players = [];
  for (const item of playable) {
    const result = await timed(() => catalog.resolve(item));
    site.checks.players.push({ title: item.title, ok: result.ok && !!result.value?.url, host: result.value?.url ? new URL(result.value.url).hostname : '', alternatives: result.value?.alternatives?.length || 0, ms: result.ms, error: result.error || '' });
  }
  if (connector.search || connector.searchURL) {
    const result = await timed(() => catalog.search(connector.id, QUERIES[connector.id] || 'amor'));
    site.checks.search = { query: QUERIES[connector.id], ok: result.ok && result.value.length > 0, results: result.value?.length || 0, ms: result.ms, error: result.error || '' };
  } else site.checks.search = { ok: null, note: 'El sitio no ofrece búsqueda utilizable.' };
  const show = items.find(item => item.show)?.show;
  if (show && connector.episodes) {
    const result = await timed(() => catalog.episodes(connector.id, show));
    site.checks.episodes = { show, ok: result.ok && result.value.some(season => season.episodes.length), episodes: (result.value || []).reduce((sum, season) => sum + season.episodes.length, 0), ms: result.ms, error: result.error || '' };
  }
  // Images must pass Holy's image cache (its allowed hosts).
  const { IMAGE_HOSTS } = await import('./holy/server.mjs');
  const images = items.flatMap(item => [item.poster, item.backdrop]).filter(Boolean);
  site.checks.images = { total: images.length, refused: images.filter(url => { try { return !IMAGE_HOSTS.test(new URL(url).hostname); } catch { return true; } }).length };
  site.ok = site.checks.images.refused === 0 && site.titles > 0 && !site.error && site.checks.players.length > 0 && site.checks.players.every(player => player.ok) && site.checks.search.ok !== false && (site.checks.episodes?.ok ?? true);
  console.log(`${site.ok ? 'OK ' : 'MAL'} ${connector.name.padEnd(18)} títulos ${String(site.titles).padStart(3)} · géneros ${site.withGenres} · reproductor ${site.checks.players.map(player => player.ok ? player.host : 'falla').join(', ')} · búsqueda ${site.checks.search.ok === null ? '—' : site.checks.search.results} · episodios ${site.checks.episodes?.episodes ?? '—'}${site.error ? ' · ' + site.error : ''}`);
}
mkdirSync('evidence/holy', { recursive: true });
writeFileSync('evidence/holy/sites.json', JSON.stringify(report, null, 2));
rmSync(scratch, { recursive: true, force: true });
process.exitCode = report.sites.every(site => site.ok) ? 0 : 1;
console.log('Informe: evidence/holy/sites.json');
