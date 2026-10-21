import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
import { BrowserBridge } from './browser-bridge.mjs';
import { Preferences } from './preferences.mjs';

const endpoint = process.argv[2];
const directory = 'evidence/search-settings';
mkdirSync(directory, { recursive: true });
let cdp, bridge, tick;
const report = { capturedAt: new Date().toISOString(), checks: [] };
async function attach() {
  cdp = await connectTV(endpoint);
  bridge = await new BrowserBridge(cdp, { fixtures: true }).start();
  tick = setInterval(() => bridge.status().catch(() => {}), 500);
}
async function detach() { clearInterval(tick); await bridge.stop(); cdp.close(); }
async function capture(name) {
  const result = await waitFor(() => cdp.call('Page.captureScreenshot', { format: 'png' }), 8000);
  writeFileSync(`${directory}/${name}.png`, Buffer.from(result.data, 'base64'));
}
async function typeSearch(query) {
  await cdp.evaluate('document.querySelector("input").focus();document.querySelector("input").select()');
  await cdp.call('Input.insertText', { text: query });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
async function settingsFromToolbar() {
  await waitFor(() => bridge.toolbarContext);
  const state = await cdp.evaluate('window.__lumaToolbarSnapshot()', bridge.toolbarContext);
  const rect = state.buttons.settings;
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: 'left', clickCount: 1 };
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
  await waitFor(() => cdp.evaluate('!!document.querySelector("[role=radiogroup]")'));
}
async function select(engine) {
  await waitFor(() => cdp.evaluate(`!!document.querySelector('[data-engine="${engine}"]:not(:disabled)')`));
  await cdp.evaluate(`document.querySelector('[data-engine="${engine}"]').click()`);
  await waitFor(() => bridge.preferences.searchEngine === engine);
  await waitFor(() => cdp.evaluate(`document.querySelector('[data-engine="${engine}"]')?.getAttribute('aria-checked')==='true'`));
}
try {
  await attach();
  assert.equal(bridge.preferences.searchEngine, 'google');
  await bridge.command({ action: 'home' });
  await waitFor(() => cdp.evaluate('window.__lumaReady===true'));
  await waitFor(() => cdp.evaluate('document.querySelector("input").placeholder.includes("Google")'));
  report.checks.push({ name: 'Google predeterminado en la barra inicial', pass: true });
  await cdp.evaluate('document.querySelector(".settings-button").click()');
  await waitFor(() => cdp.evaluate('!!document.querySelector("[role=radiogroup]")'));
  await select('bing');
  report.checks.push({ name: 'Configuración accesible desde páginas y elección de Bing', pass: true });
  await bridge.command({ action: 'reload' });
  await waitFor(() => cdp.evaluate('document.querySelector("[data-engine=bing]")?.getAttribute("aria-checked")==="true"'));
  assert.equal(new Preferences().searchEngine, 'bing');
  report.checks.push({ name: 'Preferencia conservada tras recargar', pass: true });
  await detach();
  await attach();
  assert.equal(bridge.preferences.searchEngine, 'bing');
  report.checks.push({ name: 'Preferencia conservada al reiniciar el puente', pass: true });
  await cdp.evaluate('document.querySelector(".back-settings").click()');
  await bridge.command({ action: 'navigate', value: 'http://192.168.1.148:43187/simple' });
  await waitFor(() => bridge.navigation.phase === 'complete', 15000);
  await waitFor(() => bridge.toolbarContext);
  const toolbar = await cdp.evaluate('window.__lumaToolbarSnapshot()', bridge.toolbarContext);
  assert.equal(toolbar.searchEngine, 'bing');
  report.checks.push({ name: 'Bing aplicado a la barra de páginas', pass: true });
  await settingsFromToolbar();
  await select('duckduckgo');
  await select('brave');
  await select('google');
  assert.equal(new Preferences().searchEngine, 'google');
  report.checks.push({ name: 'Cuatro opciones seleccionables; Google restaurado y guardado', pass: true });
  const layout = await cdp.evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})');
  assert.equal(layout.scrollWidth, layout.width); assert.equal(layout.scrollHeight, layout.height);
  await capture('settings-google');
  report.layout = layout; report.pass = true;
} catch (error) { report.pass = false; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  if (bridge) { bridge.preferences.setSearchEngine('google'); await bridge.status().catch(() => {}); await detach(); }
  writeFileSync(`${directory}/validation.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
