import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserBridge, home } from './browser-bridge.mjs';
import { toolbarSource } from './toolbar.mjs';

// Fake CDP target: records calls in order, no TV involved.
const directory = mkdtempSync(join(tmpdir(), 'luma-bridge-'));
const calls = [];
let script = 0;
let dropConnection;
let history = { currentIndex: 0, entries: [{ id: 1, url: 'https://example.com/' }] };
const cdp = {
  async call(method, params = {}) {
    calls.push({ method, params });
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(++script) };
    if (method === 'Page.getNavigationHistory') return history;
    return {};
  },
  async evaluate(expression, contextId) {
    calls.push({ method: 'evaluate', expression, contextId });
    if (contextId === 'stuck') return new Promise(() => {});
    if (expression.includes('hasContent')) return { url: navigationURL(), ready: 'interactive', hasContent: true };
    return 'https://example.com/';
  },
  onEvent() { return () => {}; },
  closed: new Promise(resolve => { dropConnection = resolve; })
};
let navigationURL = () => 'https://example.com/';
const paused = (requestId, url, resourceType, frameId = 'main') => ({ method: 'Fetch.requestPaused', params: { requestId, request: { url, method: 'GET' }, resourceType, frameId } });
const after = index => calls.slice(index);
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };

try {
  const bridge = await new BrowserBridge(cdp, { fixtures: true, preferencesFile: join(directory, 'settings.json') }).start();
  await check('Caché HTTP activa y sin búfer de cuerpos', () => {
    assert.ok(!calls.some(call => call.method === 'Network.setCacheDisabled'));
    assert.deepEqual(calls.find(call => call.method === 'Network.enable').params, { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 });
  });

  await check('Escudo de YouTube registrado al arrancar para cualquier subdominio', () => {
    const preset = calls.find(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('youtubeShield'));
    assert.ok(preset.params.source.startsWith('if(/(^|\\.)youtube(-nocookie)?\\.com$/.test(location.hostname)&&'));
    assert.ok(preset.params.source.includes('ytd-ad-slot-renderer'));
  });

  let mark = calls.length;
  await bridge.event(paused('1', 'https://news.example/story', 'Document'));
  await check('Sin registros mientras el documento está en pausa (evita el bloqueo de WAM)', () => {
    assert.ok(!after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument'));
    assert.equal(after(mark).at(-1).method, 'Fetch.continueRequest');
  });

  mark = calls.length;
  await bridge.event({ method: 'Target.attachedToTarget', params: { sessionId: 'turnstile', targetInfo: { type: 'iframe', url: 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/x' } } });
  await bridge.event({ method: 'Fetch.requestPaused', params: { requestId: 'v1', request: { url: 'https://challenges.cloudflare.com/turnstile/v0/api.js', method: 'GET' }, resourceType: 'Script', frameId: 'main' } });
  await check('Verificación humana de Cloudflare: sin interceptar ni filtrar', () => {
    assert.ok(!after(mark).some(call => call.method === 'Fetch.enable'));
    assert.equal(after(mark).at(-1).method, 'Fetch.continueRequest');
  });

  mark = calls.length;
  await bridge.command({ action: 'navigate', value: 'https://news.example/story' });
  await check('Dirección escrita: filtros registrados antes de navegar', () => {
    const steps = after(mark).map(call => call.method);
    const registered = steps.indexOf('Page.addScriptToEvaluateOnNewDocument');
    assert.ok(registered >= 0 && registered < steps.indexOf('Page.navigate'));
    assert.ok(after(mark)[registered].params.source.startsWith('if(location.hostname==="news.example"&&'));
  });

  mark = calls.length;
  await bridge.command({ action: 'navigate', value: 'https://www.youtube.com/watch?v=lab' });
  await bridge.command({ action: 'navigate', value: 'https://news.example/other' });
  await check('Sin duplicados: YouTube ya cubierto y dominio ya registrado', () => assert.ok(!after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument')));

  mark = calls.length;
  await bridge.command({ action: 'navigate', value: home });
  await check('El inicio no recibe filtros', () => assert.ok(!after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument')));

  bridge.frames.set('main', 'https://docs.example/guide');
  mark = calls.length;
  await bridge.event({ method: 'Page.domContentEventFired', params: {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  await check('Al cargar, el dominio actual queda listo para los siguientes enlaces', () => assert.ok(after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('"docs.example"'))));

  mark = calls.length;
  await bridge.event(paused('3', 'https://www.youtube.com/api/stats/ads?ver=2', 'XHR'));
  await check('Anuncio respondido localmente y contado', () => {
    assert.ok(after(mark).some(call => call.method === 'Fetch.fulfillRequest'));
    assert.equal(bridge.blocked, 1);
    assert.equal(bridge.statusPayload().blocked, 1);
  });

  mark = calls.length;
  await bridge.event(paused('4', 'https://www.youtube.com/s/player/base.js', 'Script'));
  await check('Recurso legítimo continúa', () => assert.equal(after(mark).at(-1).method, 'Fetch.continueRequest'));

  mark = calls.length;
  await bridge.command({ action: 'set-protection', value: false });
  await bridge.event(paused('5', 'https://news.example/', 'Document'));
  await bridge.event(paused('6', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'Script'));
  await check('Pausa retira scripts y deja pasar todo', () => {
    assert.ok(after(mark).some(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument'));
    assert.ok(!after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' || call.method === 'Fetch.fulfillRequest'));
  });
  mark = calls.length;
  await bridge.command({ action: 'set-protection', value: true });
  await check('Al reactivar vuelve el escudo de YouTube', () => assert.ok(after(mark).some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('youtubeShield'))));

  bridge.mainContext = 7;
  bridge.frames.set('main', 'https://news.example/');
  mark = calls.length;
  await bridge.command({ action: 'cosmetic', value: { classes: ['ad-banner', 'story'], ids: ['ad_container'] } });
  await bridge.command({ action: 'cosmetic', value: { classes: ['ad-banner'], ids: [] } });
  await check('Cosmética genérica incremental sin duplicados', () => {
    const evaluations = after(mark).filter(call => call.method === 'evaluate');
    assert.equal(evaluations.length, 1);
    assert.ok(evaluations[0].expression.includes('insertRule'));
  });

  const readSaved = () => JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'));
  await check('Primer arranque con las páginas del dueño en sus tres categorías', () => {
    const saved = readSaved();
    assert.deepEqual(saved.categories, ['Anime', 'Películas', 'Doramas']);
    const count = name => saved.favorites.filter(item => item.category === name).length;
    assert.deepEqual([count('Anime'), count('Películas'), count('Doramas')], [4, 4, 5]);
    assert.ok(saved.favorites.some(item => item.category === 'Películas' && item.url === 'https://cuevana3c.pro/'));
    assert.equal(saved.bookmarksVersion, 2);
  });
  const seeded = bridge.preferences.favorites.length;
  await bridge.command({ action: 'favorite', value: { url: 'https://news.example/#top', title: 'Noticias', category: 'Lectura' } });
  await check('Favorito en categoría nueva guardado en el Mac', () => {
    const saved = readSaved();
    assert.deepEqual(saved.favorites.at(-1), { url: 'https://news.example/', title: 'Noticias', category: 'Lectura' });
    assert.ok(saved.categories.includes('Lectura'));
    assert.equal(bridge.statusPayload().favorite, true);
    assert.deepEqual(bridge.statusPayload().favoriteCategories, ['Lectura']);
  });
  await bridge.command({ action: 'add-bookmark', value: { url: 'news.example', title: 'x', category: 'Anime' } }).catch(() => {});
  await bridge.command({ action: 'add-bookmark', value: { url: 'https://news.example/', title: 'Noticias', category: 'anime' } });
  await check('La misma dirección vive en varias categorías sin duplicarse en una', () => {
    assert.deepEqual(bridge.preferences.categoriesOf('https://news.example/').sort(), ['Anime', 'Lectura']);
    assert.equal(bridge.preferences.favorites.length, seeded + 2);
  });
  await bridge.command({ action: 'favorite', value: { url: 'https://news.example/', title: 'Noticias', category: 'Lectura' } });
  await check('Segundo toque quita el favorito y la categoría vacía se conserva', () => {
    assert.ok(bridge.preferences.categories.includes('Lectura'));
    assert.deepEqual(bridge.preferences.categoriesOf('https://news.example/'), ['Anime']);
  });
  await bridge.command({ action: 'remove-favorite', value: { url: 'https://news.example/', category: 'Anime' } });
  await check('Quitar desde el inicio respeta la categoría', () => {
    assert.equal(bridge.preferences.favorites.length, seeded);
    assert.ok(bridge.preferences.favorites.some(item => item.title === 'RePelisHD' && item.category === 'Películas'));
  });
  await bridge.command({ action: 'remove-category', value: 'Lectura' });
  await bridge.command({ action: 'add-category', value: 'Series' });
  await bridge.command({ action: 'rename-category', value: { from: 'doramas', to: 'Doramas coreanos' } });
  await check('Categorías: añadir, renombrar (con sus marcadores) y eliminar', () => {
    const saved = readSaved();
    assert.deepEqual(saved.categories, ['Anime', 'Películas', 'Doramas coreanos', 'Series']);
    assert.equal(saved.favorites.filter(item => item.category === 'Doramas coreanos').length, 5);
    assert.ok(!saved.favorites.some(item => item.category === 'Doramas'));
  });
  await check('Categorías: duplicadas, vacías y eliminar con marcadores', async () => {
    assert.throws(() => bridge.preferences.addCategory('series'), /ya existe/);
    assert.throws(() => bridge.preferences.addCategory('  '), /Escribe/);
    assert.throws(() => bridge.preferences.renameCategory('Series', 'anime'), /Ya existe/);
    bridge.preferences.removeCategory('Doramas coreanos');
    assert.ok(!bridge.preferences.favorites.some(item => item.category === 'Doramas coreanos'));
  });
  await check('Las categorías vacías persisten y las predeterminadas también se pueden quitar', () => {
    for (const item of [...bridge.preferences.favorites]) bridge.preferences.removeFavorite(item.url, item.category);
    assert.deepEqual(bridge.preferences.categories, ['Anime', 'Películas', 'Series']);
  });
  await check('URL no web rechazada', () => assert.throws(() => bridge.preferences.toggleFavorite('javascript:alert(1)')));

  bridge.frames.set(bridge.mainFrame, 'https://cuevana3c.pro/');
  mark = calls.length;
  await bridge.event(paused('navigation-ad', 'https://latgw.fun/probe', 'Document', bridge.mainFrame));
  await check('Anuncio en ventana principal: se cancela sin navegar a página vacía', () => {
    assert.equal(after(mark).find(call => call.method === 'Fetch.failRequest')?.params.errorReason, 'Aborted');
    assert.ok(!after(mark).some(call => call.method === 'Page.navigate'));
    assert.equal(bridge.blockedNavigations, 1);
  });
  mark = calls.length;
  await bridge.event(paused('media-stream', 'https://video.example/seg-1.woff2', 'XHR', bridge.mainFrame));
  await check('Segmento de video con extensión de fuente sigue permitido', () => assert.ok(after(mark).some(call => call.method === 'Fetch.continueRequest')));
  mark = calls.length;
  await bridge.event({method:'Page.frameRequestedNavigation',params:{frameId:bridge.mainFrame,url:'https://unknown-ad.example/landing',reason:'scriptInitiated'}});
  await bridge.event(paused('script-exit','https://unknown-ad.example/landing','Document',bridge.mainFrame));
  await check('Salida automática a dominio nuevo no sustituye la película', () => assert.equal(after(mark).find(call => call.method === 'Fetch.failRequest')?.params.errorReason, 'Aborted'));
  mark = calls.length;
  await bridge.event({method:'Page.frameRequestedNavigation',params:{frameId:bridge.mainFrame,url:'https://legitimate.example/','reason':'anchorClick'}});
  await bridge.event(paused('real-link','https://legitimate.example/','Document',bridge.mainFrame));
  await check('Enlace normal a otro dominio sigue permitido', () => assert.ok(after(mark).some(call => call.method === 'Fetch.continueRequest')));
  mark = calls.length;
  await bridge.event({method: 'Target.attachedToTarget', params: {sessionId:'worker',targetInfo:{type:'worker'}}});
  await check('Targets worker no reciben Fetch inexistente', () => assert.equal(after(mark).length, 0));

  mark = calls.length;
  await bridge.command({ action: 'stop' });
  await check('Detener conserva la página', () => {
    assert.ok(after(mark).some(call => call.method === 'Page.stopLoading'));
    assert.ok(!after(mark).some(call => call.method === 'Page.navigate'));
    assert.equal(bridge.navigation.phase, 'complete');
  });

  mark = calls.length;
  await bridge.command({ action: 'back' });
  await check('Atrás sin historial vuelve al inicio', () => assert.equal(after(mark).find(call => call.method === 'Page.navigate')?.params.url, home));

  // Cloudflare's human check arrives as a 403 document: it is the page to show, a plain 403 is still an error.
  const loadMain = async (id, status, headers) => {
    bridge.beginNavigation('https://ver2.animeonline.ninja/');
    await bridge.event({ method: 'Network.requestWillBeSent', params: { requestId: id, type: 'Document', frameId: bridge.mainFrame, request: { url: 'https://ver2.animeonline.ninja/' } } });
    await bridge.event({ method: 'Network.responseReceived', params: { requestId: id, type: 'Document', response: { status, headers } } });
  };
  await loadMain('cf-1', 403, { 'Cf-Mitigated': 'challenge', server: 'cloudflare' });
  await check('Verificación de Cloudflare (403 + cf-mitigated) no se muestra como error', () => assert.equal(bridge.navigation.phase, 'loading'));
  await loadMain('cf-2', 403, { server: 'cloudflare' });
  await check('Un 403 normal sigue siendo error', () => assert.equal(bridge.navigation.phase, 'error'));
  clearTimeout(bridge.navigationTimer);
  mark = calls.length;
  await bridge.setProtection(false);
  await check('El aplazador de Turnstile sigue activo con la protección en pausa', () => {
    assert.ok(calls.some(call => call.method === 'Page.addScriptToEvaluateOnNewDocument' && call.params.source.includes('__lumaTurnstileDefer')));
    assert.ok(!after(mark).some(call => call.method === 'Page.removeScriptToEvaluateOnNewDocument' && call.params.identifier === bridge.turnstileScript));
  });
  await bridge.setProtection(true);

  // An iframe that never answers (busy ad frame) must not keep the page loading.
  bridge.beginNavigation('https://slow.example/');
  bridge.committedNavigation = bridge.navigationId;
  navigationURL = () => 'https://slow.example/';
  bridge.contexts.set('stuck', { id: 'stuck', auxData: { isDefault: true, frameId: 'ad-frame' } });
  const finished = await Promise.race([bridge.event({ method: 'Page.domContentEventFired', params: {} }).then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 500))]);
  await check('Un iframe lento no retrasa el fin de la carga', () => { assert.ok(finished); assert.equal(bridge.navigation.phase, 'complete'); });
  bridge.contexts.delete('stuck');
  clearTimeout(bridge.navigationTimer);

  await check('Barra sin innerHTML (YouTube exige Trusted Types)', () => assert.ok(!/\.innerHTML\s*=/.test(toolbarSource({}, [home]))));

  // The app dying while a site is still opening is remembered and shown in the status; two in a row mark the site.
  bridge.beginNavigation('https://crashy.example/watch?t=1');
  dropConnection();
  await new Promise(resolve => setTimeout(resolve, 10));
  await check('Cierre de la app durante la carga se anota por sitio', () => {
    assert.equal(bridge.crashMemory.sites['crashy.example'].crashes, 1);
    assert.deepEqual(bridge.statusPayload().riskySites, []);
    assert.ok(!JSON.stringify(bridge.crashMemory.sites).includes('watch'));
  });
  bridge.crashMemory.sites['crashy.example'].crashes = 2;
  await check('Dos cierres seguidos marcan el sitio en el estado', () => assert.deepEqual(bridge.statusPayload().riskySites, ['crashy.example']));

  await bridge.stop();
  console.log(`${checks.length} comprobaciones del puente correctas.`);
} finally { rmSync(directory, { recursive: true, force: true }); }
