import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserTabs } from './browser-tabs.mjs';
import { BrowserBridge, home, packagedHome } from './browser-bridge.mjs';

let count = 0;
const check = async (fn) => { await fn(); count++; };
const tabs = new BrowserTabs(home, 3);
const first = tabs.create('https://a.example/');
await check(() => {
  tabs.commit('https://a.example/story', 'Una historia'); tabs.remember(520);
  tabs.create('https://b.example/'); tabs.commit('https://b.example/video', 'Video');
  tabs.select(first.id);
  assert.equal(tabs.current.url, 'https://a.example/story');
  assert.equal(tabs.current.scroll, 520);
  assert.equal(tabs.move(-1).url, 'https://a.example/');
  assert.equal(tabs.move(-1), null);
  assert.equal(tabs.move(1).url, 'https://a.example/story');
  assert.equal(tabs.move(1), null);
});
await check(() => {
  const video = new BrowserTabs(home, 3);
  video.create('https://c.example/watch');
  video.remember(0, 'Peli', { t: 1234.9, playing: true });
  assert.deepEqual(video.current.media, { t: 1234, playing: true });
  video.remember(0, 'Peli', { t: 1.2, playing: true }); // too early to be worth resuming
  assert.equal(video.current.media, undefined);
  video.remember(0, 'Peli', null);
  assert.equal(video.current.media, undefined);
});
await check(() => {
  tabs.move(-1); tabs.commit('https://a.example/new', 'Nueva');
  assert.equal(tabs.move(1), null); // a new branch discards forward history
  const id = tabs.activeId;
  tabs.close(tabs.items[1].id);
  assert.equal(tabs.activeId, id);
  tabs.close(id);
  assert.equal(tabs.items.length, 1);
  assert.equal(tabs.current.url, home);
  assert.notEqual(tabs.activeId, id);
});
await check(() => {
  tabs.create(); tabs.create();
  assert.throws(() => tabs.create(), /hasta 3/);
  assert.throws(() => tabs.select('missing'), /cerrada/);
  assert.equal(tabs.close('missing'), false);
  tabs.commit('https://a.example/', '');
  tabs.commit('https://a.example/redirect', 'Destino', true);
  assert.equal(tabs.active.entries.length, 2);
  assert.equal(tabs.active.title, 'Destino');
});

const directory = mkdtempSync(join(tmpdir(), 'luma-tabs-'));
let page = { url: 'https://a.example/', title: 'Página A', scroll: 245 };
const calls = [];
const cdp = {
  async call(method, params = {}) {
    calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: page.url } } };
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
    return {};
  },
  async evaluate(expression) {
    if (expression === 'location.href') return page.url;
    if (expression === 'document.title') return page.title;
    if (expression.includes('hasContent')) return { ...page, hasContent: true };
    if (expression.includes('scroll:window.scrollY')) return { ...page };
    if (expression.startsWith('window.scrollTo')) { calls.push({ method: 'scroll', expression }); }
  },
  onEvent() { return () => {}; }
};
let bridge;
const finish = async (url, title = 'Página') => {
  page = { url, title, scroll: 0 };
  bridge.frames.set('main', url);
  bridge.committedNavigation = bridge.navigationId;
  await bridge.navigationFinished();
};
try {
  bridge = await new BrowserBridge(cdp, { fixtures: true, debug: false, preferencesFile: join(directory, 'settings.json') }).start();
  const original = bridge.tabs.activeId;
  await check(async () => {
    assert.equal(bridge.statusPayload().debug, false);
    assert.equal(bridge.statusPayload().tabs.length, 1);
    await bridge.command({ action: 'new-tab' });
    assert.equal(bridge.tabs.items.length, 2);
    assert.equal(calls.at(-1).params.url, home);
    assert.equal(bridge.tabs.items[0].entries[0].scroll, 245);
  });
  const second = bridge.tabs.activeId;
  await check(async () => {
    // Switch again while the home navigation is still pending. Old page A must
    // not overwrite the newly created home tab's URL.
    await bridge.command({ action: 'select-tab', value: original });
    assert.equal(bridge.tabs.items[1].entries[0].url, home);
    await finish('https://a.example/', 'Página A');
    assert.equal(calls.findLast(call => call.method === 'scroll').expression, 'window.scrollTo(0,245)');
  });
  await check(async () => {
    await bridge.command({ action: 'navigate', value: 'https://a.example/next' });
    await finish('https://a.example/next', 'Segunda página A');
    await bridge.command({ action: 'select-tab', value: second });
    await finish(home, 'Luma');
    await bridge.command({ action: 'navigate', value: 'https://b.example/' });
    await finish('https://b.example/', 'Página B');
    await bridge.command({ action: 'back' });
    assert.equal(calls.findLast(call => call.method === 'Page.navigate').params.url, home);
    await finish(home, 'Luma');
    await bridge.command({ action: 'select-tab', value: original });
    await finish('https://a.example/next', 'Segunda página A');
    await bridge.command({ action: 'back' });
    assert.equal(calls.findLast(call => call.method === 'Page.navigate').params.url, 'https://a.example/');
    await finish('https://a.example/', 'Página A');
    await bridge.command({ action: 'forward' });
    assert.equal(calls.findLast(call => call.method === 'Page.navigate').params.url, 'https://a.example/next');
    await finish('https://a.example/next', 'Segunda página A');
  });
  await check(async () => {
    const before = calls.filter(call => call.method === 'Page.navigate').length;
    await bridge.command({ action: 'close-tab', value: second });
    assert.equal(calls.filter(call => call.method === 'Page.navigate').length, before);
    await bridge.command({ action: 'close-tab', value: original });
    assert.equal(bridge.tabs.items.length, 1);
    assert.equal(bridge.tabs.current.url, home);
    assert.ok(!calls.some(call => /Target.createTarget|launch|activate/i.test(call.method)));
  });
  await check(() => {
    bridge.debug = true;
    assert.equal(bridge.statusPayload().debug, true);
    bridge.debug = false;
    assert.ok(bridge.statusPayload().tabs.every(tab => typeof tab.title === 'string'));
  });
  await check(async () => {
    bridge.tabs.commit(packagedHome, 'Inicio', true);
    await bridge.restoreTab();
    assert.equal(calls.findLast(call => call.method === 'Page.navigate').params.url, home);
    await finish(home, 'Inicio');
    assert.equal(bridge.tabs.current.url, home);
  });
  console.log(`${count} comprobaciones de pestañas e historial independiente correctas.`);
} finally {
  await bridge?.stop();
  rmSync(directory, { recursive: true, force: true });
}
