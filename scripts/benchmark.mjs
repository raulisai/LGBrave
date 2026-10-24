// Mide cargas reales en la TV: caché HTTP desactivada (0.5.x) frente a activada (0.6.0).
//   node scripts/benchmark.mjs http://127.0.0.1:PUERTO
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
import { BrowserBridge } from './browser-bridge.mjs';

const sites = process.argv.slice(3).length ? process.argv.slice(3) : ['https://es.wikipedia.org/wiki/Televisor', 'https://developer.mozilla.org/es/', 'https://www.bbc.com/mundo'];
const cdp = await connectTV(process.argv[2]);
const bridge = await new BrowserBridge(cdp).start();
const tick = setInterval(() => bridge.status().catch(() => {}), 1000);
const report = { capturedAt: new Date().toISOString(), scope: 'Una TV, una red, pocas muestras: orientativo, no un promedio de Internet.', runs: [] };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

async function load(url) {
  const blockedBefore = bridge.blocked;
  const started = Date.now();
  await bridge.command({ action: 'navigate', value: url });
  await waitFor(() => ['complete', 'error'].includes(bridge.navigation.phase), 40000);
  const visible = Date.now() - started;
  await waitFor(() => cdp.evaluate('document.readyState === "complete"'), 40000).catch(() => {});
  const timing = await cdp.evaluate(`(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const resources = performance.getEntriesByType('resource');
    return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0),
      resources: resources.length, networkKB: Math.round((resources.reduce((sum, item) => sum + (item.transferSize || 0), 0) + (nav.transferSize || 0)) / 1024),
      cachedResources: resources.filter(item => item.transferSize === 0 && item.decodedBodySize > 0).length };
  })()`);
  return { url, phase: bridge.navigation.phase, visibleMs: visible, ...timing, blocked: bridge.blocked - blockedBefore };
}

try {
  for (const cache of [false, true]) {
    await cdp.call('Network.setCacheDisabled', { cacheDisabled: !cache });
    for (const url of sites) for (const visit of [1, 2]) {
      const result = { cache, visit, ...await load(url) };
      report.runs.push(result);
      console.log(`${cache ? 'caché' : 'sin caché'} · visita ${visit} · ${new URL(url).hostname}: ${result.load} ms load, ${result.networkKB} KB red, ${result.blocked} bloqueados`);
    }
  }
  const summary = cache => {
    const runs = report.runs.filter(run => run.cache === cache && run.visit === 2 && run.phase === 'complete');
    return { repeatVisitLoadMs: median(runs.map(run => run.load)), repeatVisitNetworkKB: median(runs.map(run => run.networkKB)) };
  };
  report.summary = { withoutCache: summary(false), withCache: summary(true) };
  console.log(report.summary);
} finally {
  clearInterval(tick);
  await bridge.command({ action: 'home' }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  await bridge.stop(); cdp.close();
  mkdirSync('evidence/performance', { recursive: true });
  writeFileSync('evidence/performance/benchmark.json', JSON.stringify(report, null, 2));
}
