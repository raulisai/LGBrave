import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideCleaning, CleanerRules, cleanerSource } from './ad-cleaner.mjs';
import { BrowserBridge } from './browser-bridge.mjs';

const directory = mkdtempSync(join(tmpdir(), 'luma-cleaner-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

try {
  await check('Decisión: motor de Brave o pista fuerte; nada por pistas débiles', () => {
    const decisions = decideCleaning([
      { id: 'a', score: 0, urls: [{ url: 'https://googleads.g.doubleclick.net/pagead/ads', type: 'Document' }] },
      { id: 'b', score: 0, urls: [{ url: 'https://images.example.org/foto.jpg', type: 'Image' }] },
      { id: 'c', score: 3, urls: [] },
      { id: 'd', score: 2, urls: [] },
      { id: 'e', score: 4, urls: [], overlay: true }
    ], url => url.includes('doubleclick'));
    assert.deepEqual(decisions, [
      { id: 'a', confirmed: true, overlay: false }, { id: 'c', confirmed: false, overlay: false }, { id: 'e', confirmed: false, overlay: true }
    ]);
  });
  await check('Solo se recuerdan selectores de anuncio sencillos', () => {
    for (const selector of ['div.ad-slot', 'ins.adsbygoogle', '#publicidad-top', 'aside.sponsored']) assert.ok(CleanerRules.valid(selector), selector);
    for (const selector of ['div.header', 'main', 'div > p', '#content', 'div.load-more', '*', 'body.ads:has(main)']) assert.ok(!CleanerRules.valid(selector), selector);
  });
  await check('Reglas por sitio con escritura atómica', () => {
    const rules = new CleanerRules(join(directory, 'rules.json'));
    assert.deepEqual(rules.add('news.example', ['div.ad-slot', 'div.header', 'div.ad-slot']), ['div.ad-slot']);
    assert.deepEqual(new CleanerRules(join(directory, 'rules.json')).selectorsFor('news.example'), ['div.ad-slot']);
    rules.remove('news.example', ['div.ad-slot']);
    assert.deepEqual(new CleanerRules(join(directory, 'rules.json')).selectorsFor('news.example'), []);
  });
  await check('El código de página es autónomo y sin innerHTML', () => {
    const source = cleanerSource('scan', 'f0');
    assert.ok(!/\.innerHTML\s*=/.test(source));
    assert.doesNotThrow(() => new Function(source));
  });

  // Bridge with a fake TV: one page frame and one ad frame.
  const calls = [];
  let scripts = 0;
  const scans = {
    'w-main': { url: 'https://news.example/story', candidates: [
      { id: 'f0:0', score: 0, urls: [{ url: 'https://googleads.g.doubleclick.net/pagead/ads?x=1', type: 'Document' }] },
      { id: 'f0:1', score: 0, urls: [{ url: 'https://news.example/foto.jpg', type: 'Image' }] },
      { id: 'f0:2', score: 3, urls: [] }
    ] },
    'w-child': { url: 'https://widgets.example/frame', candidates: [{ id: 'f1:0', score: 4, urls: [] }] }
  };
  const cdp = {
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://news.example/story' }, childFrames: [{ frame: { id: 'child', url: 'https://widgets.example/frame' } }, { frame: { id: 'blank', url: 'about:blank' } }] } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 'w-' + params.frameId };
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(++scripts) };
      return {};
    },
    async evaluate(expression, contextId) {
      calls.push({ method: 'evaluate', expression, contextId });
      if (expression.includes('"scan"')) return scans[contextId];
      if (expression.includes('"apply"')) {
        const decisions = JSON.parse(expression.slice(expression.lastIndexOf(',[') + 1, -1));
        return { hidden: decisions.length, overlays: 0, learned: contextId === 'w-main' ? ['div.ad-slot', 'div.header'] : ['div.frame-ad'] };
      }
      if (expression.includes('"undo"')) return { restored: contextId === 'w-main' ? 2 : 1 };
      if (expression.includes('hasContent')) return { url: 'https://news.example/story', ready: 'complete', hasContent: true };
      return 'https://news.example/story';
    },
    onEvent() { return () => {}; }
  };
  const bridge = await new BrowserBridge(cdp, { preferencesFile: join(directory, 'settings.json') }).start();
  bridge.frames.set(bridge.mainFrame, 'https://news.example/story');
  bridge.toolbarContext = 'toolbar';
  bridge.mainContext = 'page';
  let mark = calls.length;
  await bridge.command({ action: 'clean-ads' });
  const report = () => calls.slice(mark).filter(call => call.contextId === 'toolbar' && call.expression.includes('__lumaCleanResult')).map(call => JSON.parse(call.expression.match(/__lumaCleanResult\((.*)\)$/)[1])).at(-1);
  await check('Limpieza: cada marco http se escanea en un mundo aislado', () => {
    const worlds = calls.slice(mark).filter(call => call.method === 'Page.createIsolatedWorld').map(call => call.params.frameId);
    assert.deepEqual(worlds.sort(), ['child', 'main']);
  });
  await check('El motor de Brave confirma el iframe publicitario y respeta la foto', () => {
    const apply = calls.slice(mark).find(call => call.contextId === 'w-main' && call.expression.includes('"apply"'));
    const decisions = JSON.parse(apply.expression.slice(apply.expression.lastIndexOf(',[') + 1, -1));
    assert.deepEqual(decisions.map(decision => [decision.id, decision.confirmed]), [['f0:0', true], ['f0:2', false]]);
  });
  await check('Resultado enviado a la barra', () => {
    const result = report();
    assert.equal(result.ok, true);
    assert.equal(result.hidden, 3);
    assert.equal(result.frames, 2);
    assert.equal(result.learned, 1);
  });
  await check('Recuerda solo selectores válidos del marco principal y los aplica', () => {
    const saved = JSON.parse(readFileSync(join(directory, 'cleaner-rules.json'), 'utf8'));
    assert.deepEqual(saved, { 'news.example': ['div.ad-slot'] });
    assert.ok(calls.slice(mark).some(call => call.contextId === 'page' && call.expression.includes('__lumaCleanerSheet') && call.expression.includes('div.ad-slot{display:none!important}')));
    assert.ok(bridge.documentSource('https://news.example/otra', 'true').includes('div.ad-slot{display:none!important}'));
  });
  mark = calls.length;
  await bridge.command({ action: 'clean-undo' });
  await check('Deshacer restaura la página y olvida lo aprendido', () => {
    assert.deepEqual(report(), { ok: true, undone: true, restored: 3 });
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'cleaner-rules.json'), 'utf8')), {});
    assert.ok(!bridge.documentSource('https://news.example/otra', 'true')?.includes('div.ad-slot'));
  });
  mark = calls.length;
  bridge.frames.set(bridge.mainFrame, 'http://192.168.1.148:43187/luma-home/');
  await bridge.command({ action: 'clean-ads' });
  await check('En Inicio no se escanea nada', () => {
    assert.equal(report().ok, false);
    assert.ok(!calls.slice(mark).some(call => call.method === 'Page.createIsolatedWorld'));
  });
  await bridge.stop();
  console.log(`${checks.length} comprobaciones del limpiador de anuncios correctas.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
