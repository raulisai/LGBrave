import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
import { resolveNavigation } from '../src/navigation.js';
import { BrowserBridge, home } from './browser-bridge.mjs';

const directory = 'evidence/navigation-fix';
mkdirSync(directory, { recursive: true });
const cdp = await connectTV(process.argv[2]);
const bridge = await new BrowserBridge(cdp, { fixtures: true }).start();
const tick = setInterval(() => bridge.status().catch(() => {}), 500);
const report = { capturedAt: new Date().toISOString(), tests: [] };
const save = () => writeFileSync(`${directory}/validation.json`, JSON.stringify(report, null, 2));
async function capture(name) {
  const image = await waitFor(() => cdp.call('Page.captureScreenshot', { format: 'png' }), 8000);
  writeFileSync(`${directory}/${name}.png`, Buffer.from(image.data, 'base64'));
}
async function toolbar(expression) {
  await waitFor(() => bridge.toolbarContext);
  return cdp.evaluate(expression, bridge.toolbarContext);
}
async function settle(timeout = 35000) { return waitFor(() => ['complete', 'error'].includes(bridge.navigation.phase) && bridge.navigation, timeout); }
async function enterText(text) {
  await cdp.call('Input.insertText', { text });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function clickFeedback(name) {
  await waitFor(async () => {
    const state = await toolbar('window.__lumaToolbarSnapshot()');
    return state?.overlay && state.buttons[name].width > 0;
  }, 5000);
  const rect = (await toolbar('window.__lumaToolbarSnapshot()')).buttons[name];
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: 'left', clickCount: 1 };
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
}
try {
  await bridge.command({ action: 'home' });
  await waitFor(() => cdp.evaluate('window.__lumaReady===true'));
  await cdp.evaluate('document.querySelector("input").focus();document.querySelector("input").select()');
  await enterText('anime j k');
  await waitFor(() => bridge.navigation.url.startsWith(resolveNavigation('anime j k', bridge.preferences.searchEngine)));
  await settle();
  const search = await cdp.evaluate('({url:location.href,title:document.title,text:document.body?.innerText.slice(0,1800),links:[...document.querySelectorAll("a[href]")].map(a=>a.href).filter(u=>u.startsWith("https://")&&!u.includes("search.brave.com")).slice(0,12)})');
  report.tests.push({ name: 'Búsqueda desde inicio con teclado', navigation: { ...bridge.navigation }, page: search });
  await capture('search-home'); save();
  assert.equal(bridge.navigation.phase, 'complete', 'La búsqueda inicial no terminó');
  assert.ok(search.links.length > 0, 'No hay enlaces de resultados');

  await toolbar(`window.__lumaToolbarSnapshot().submit;`);
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 38, button: 'left', clickCount: 3 });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900, y: 38, button: 'left', clickCount: 3 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await enterText('anime de Jota k');
  await waitFor(() => bridge.navigation.url.includes('q=anime%20de%20Jota%20k'));
  await settle();
  const nextSearch = await cdp.evaluate('({url:location.href,title:document.title,textLength:document.body?.innerText.length,links:[...document.querySelectorAll("a[href]")].filter(a=>a.href.startsWith("https://")&&!a.href.includes("search.brave.com")).length})');
  report.tests.push({ name: 'Búsqueda desde barra de página con teclado', navigation: { ...bridge.navigation }, page: nextSearch });
  assert.equal(bridge.navigation.phase, 'complete');
  assert.ok(nextSearch.links > 0);
  await capture('search-toolbar'); save();

  report.step = 'Carga lenta';
  const slow = bridge.command({ action: 'navigate', value: 'http://192.168.1.148:43187/navigation-slow?delay=5000' });
  await waitFor(() => bridge.navigation.phase === 'loading');
  await new Promise(resolve => setTimeout(resolve, 300));
  await capture('loading');
  const loading = await waitFor(() => toolbar('window.__lumaToolbarSnapshot()'));
  assert.equal(loading.phase, 'loading'); assert.equal(loading.overlay, true);
  assert.equal(loading.toolbarHeight, 76);
  assert.equal(loading.spinnerAnimation, 'spin');
  await cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal((await toolbar('window.__lumaToolbarSnapshot()')).spinnerAnimation, 'none');
  await cdp.call('Emulation.setEmulatedMedia', { features: [] });
  await slow; await settle();
  assert.equal(bridge.navigation.phase, 'complete');
  await waitFor(async () => (await toolbar('window.__lumaToolbarSnapshot()'))?.overlay === false, 5000);
  report.tests.push({ name: 'Carga lenta y fin de animación', loading, complete: true }); save();

  for (const [name, path] of [['HTTP 503', 'navigation-error'], ['Página vacía', 'navigation-empty']]) {
    await bridge.command({ action: 'navigate', value: 'http://192.168.1.148:43187/' + path });
    await settle();
    assert.equal(bridge.navigation.phase, 'error', name);
    await waitFor(() => toolbar('window.__lumaToolbarSnapshot()?.overlay'));
    await capture(path);
    report.tests.push({ name, state: { ...bridge.navigation } }); save();
    if (name === 'HTTP 503') {
      const id = bridge.navigationId;
      await clickFeedback('retry');
      await waitFor(() => bridge.navigationId > id);
      await settle();
      assert.equal(bridge.navigation.phase, 'error');
      report.tests.push({ name: 'Botón Reintentar envía nueva navegación', pass: true });
    }
  }

  bridge.navigationTimeout = 1200;
  const timeoutRequest = bridge.command({ action: 'navigate', value: 'http://192.168.1.148:43187/navigation-slow?delay=3500' });
  await waitFor(() => bridge.navigation.phase === 'loading');
  await waitFor(() => bridge.navigation.phase === 'error');
  assert.match(bridge.navigation.error, /tardando/);
  report.tests.push({ name: 'Timeout visible', state: { ...bridge.navigation } }); save();
  await timeoutRequest;
  await waitFor(() => cdp.evaluate('window.__lumaReady===true'));
  await waitFor(() => cdp.evaluate('document.body.innerText.includes("tardando")'));
  await capture('timeout-recovery');
  bridge.navigationTimeout = 25000;
  await bridge.command({ action: 'navigate', value: 'http://192.168.1.148:43187/simple' });
  await settle(); assert.equal(bridge.navigation.phase, 'complete');
  report.tests.push({ name: 'Recuperación después del error', pass: true });
  await bridge.command({ action: 'home' });
  await waitFor(() => cdp.evaluate('window.__lumaReady===true'));
  await capture('home-final');
  report.errors = bridge.errors;
  report.pass = true;
} catch (error) { report.pass = false; report.failure = error.stack; console.error(error); process.exitCode = 1; }
finally { save(); clearInterval(tick); await bridge.stop(); cdp.close(); }
console.log(JSON.stringify({ pass: report.pass, tests: report.tests.map(t => t.name), failure: report.failure }, null, 2));
