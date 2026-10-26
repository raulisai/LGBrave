import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flixLanguages, flixVersions } from './holy/more-sources.mjs';
import { cuevana, jkanime } from './holy/sources.mjs';
import { matchVersion, publicVersion, dedupe, targetMatchesLanguage } from './holy/versions.mjs';
import { Catalog } from './holy/catalog.mjs';
import { Library } from './holy/library.mjs';
import { HolyBridge } from './holy/holy-bridge.mjs';
import { startServer } from './holy/server.mjs';
import { home } from './browser-bridge.mjs';

// Languages of a title: the site lists them, the owner picks, Holy remembers per series.
const directory = mkdtempSync(join(tmpdir(), 'holy-versions-'));
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
// A DoramasFlix link: embedshortener.co carries the real host base64-encoded in its token.
const shortLink = target => `https://embedshortener.co/e/h.${Buffer.from(JSON.stringify({ link: Buffer.from(target).toString('base64') })).toString('base64url')}.s`;

try {
  await check('DoramasFlix: «Latino» (doblado) y «Coreano» con subtítulos en español son dos versiones con sus servidores', () => {
    const languages = flixLanguages('"langs":[{"name":"Coreano","code":"ko","code_flix":"13109","flag":"x","__typename":"Language"},{"name":"Latino","code":"es","code_flix":"38","flag":"y"}]');
    assert.deepEqual(languages, { 13109: { name: 'Coreano', code: 'ko' }, 38: { name: 'Latino', code: 'es' } });
    const links = [
      { server: '4721', lang: '13109', link: shortLink('https://primeload.co/embed/KOR1'), subtitles: [{ language_code: 'es', type: 'HARDSUB' }] },
      { server: '38585', lang: '13109', link: shortLink('https://flaswish.com/e/KOR2'), subtitles: [{ language_code: 'es', type: 'HARDSUB' }] },
      { server: '3889', lang: '38', link: shortLink('https://mixdrop.ag/e/LAT1') },
      { server: '99999', lang: '38', link: shortLink('https://unknown.example/e/x') }];
    const versions = flixVersions(links, languages, 'https://doramasflix.io/capitulos/x-1x1');
    assert.deepEqual(versions.map(version => [version.id, version.label, version.kind]), [['38', 'Español latino', 'dub'], ['13109', 'Coreano · subtítulos en español', 'sub']]);
    assert.equal(versions[0].target.url, 'https://mixdrop.ag/e/LAT1');
    // The site's own server ranking decides the order inside a language (38585 before 4721).
    assert.deepEqual([versions[1].target.url, versions[1].target.alternatives, versions[1].target.referrer], ['https://flaswish.com/e/KOR2', ['https://primeload.co/embed/KOR1'], 'https://doramasflix.io/capitulos/x-1x1']);
    // Without subtitles the original audio is just «original»; one unknown language id still shows up.
    const original = flixVersions([{ server: '4721', lang: '7', link: shortLink('https://primeload.co/embed/J1') }], { 7: { name: 'Japonés', code: 'ja' } }, 'r');
    assert.deepEqual(original.map(version => [version.label, version.kind]), [['Japonés (original)', 'orig']]);
    assert.deepEqual(flixVersions([{ server: '4721', lang: '9', link: shortLink('https://primeload.co/embed/Z') }], {}, 'r').map(version => version.label), ['Idioma 9 (original)']);
  });

  await check('Cuevana: una pestaña por versión (Latino, Castellano, Subtitulado, multilenguaje) con sus servidores', async () => {
    const tab = (name, ...servers) => `<li class="tab-video-item"><div><div class="tab-item-name"> ${name} <div>Calidad · HD</div></div></div><ul>${servers.map(url => `<li data-server="${url}"><span>S</span></li>`).join('')}</ul></li>`;
    const page = `<div class="player"><ul class="tabs-video">${tab('Latino', 'https://tungtungsahur.cuevana3c.pro/?t=L1', 'https://tungtungsahur.cuevana3c.pro/?t=L2')}${tab('Subtitulado', 'https://tungtungsahur.cuevana3c.pro/?t=S1')}${tab('Multilenguaje [CC]', 'https://tungtungsahur.cuevana3c.pro/?t=M1')}</ul></div>`;
    const versions = await cuevana.versions({ url: 'https://cuevana3c.pro/pelicula/x' }, async () => page);
    assert.deepEqual(versions.map(version => [version.id, version.label, version.kind]), [['latino', 'Español latino', 'dub'], ['subtitulado', 'Subtitulado en español', 'sub'], ['multilenguajecc', 'Varios idiomas (multilenguaje)', 'orig']]);
    assert.equal(versions[0].target.url, 'https://tungtungsahur.cuevana3c.pro/?t=L1&pops=false');
    assert.deepEqual(versions[0].target.alternatives, ['https://tungtungsahur.cuevana3c.pro/?t=L2&pops=false']);
    // A page without tabs falls back to its servers as one (Spanish) version.
    const single = await cuevana.versions({ url: 'https://cuevana3c.pro/pelicula/y' }, async () => '<div class="player"><ul><li data-server="https://tungtungsahur.cuevana3c.pro/?t=A"></li></ul></div>');
    assert.deepEqual(single.map(version => version.id), ['x']);
  });

  await check('JKAnime: cada botón de servidor trae su idioma (lg_1 subtitulado, lg_3 Latino)', async () => {
    const frame = (n, path) => `video[${n}] = '<iframe class="player_conte" src="https://jkanime.net/jkplayer/${path}?e=T${n}" width="565"></iframe>';`;
    const button = (n, code, name) => `<a  id="btn-show-${n}"  data-id="${n}" class="servers btn-show lg_${code} mode_normal"  rev="1"  href="#option${n}" >${name}</a>`;
    const both = `<select><option value="1">Japones Sub. Español</option><option value="3">Espanol latino</option><option value="0">No reproduce</option></select>${frame(0, 'um')}${frame(1, 'umv')}${frame(2, 'um')}${frame(3, 'jk')}${button(0, 1, 'Desu')}${button(1, 1, 'Magi')}${button(2, 3, 'Desu')}${button(3, 3, 'Jk')}`;
    const versions = await jkanime.versions({ url: 'https://jkanime.net/x/1/' }, async () => both);
    assert.deepEqual(versions.map(version => [version.id, version.label, version.kind]), [['1', 'Japonés · subtítulos en español', 'sub'], ['3', 'Español latino', 'dub']]);
    assert.deepEqual([versions[0].target.url, versions[0].target.alternatives.length, versions[1].target.url], ['https://jkanime.net/jkplayer/um?e=T0', 1, 'https://jkanime.net/jkplayer/um?e=T2']);
    // One language only, or a page that does not say: a single (subtitled) version, no choice to make.
    const one = await jkanime.versions({ url: 'https://jkanime.net/x/2/' }, async () => `<select><option value="3">Espanol latino</option></select>${frame(0, 'um')}${button(0, 3, 'Desu')}`);
    assert.deepEqual(one.map(version => version.label), ['Español latino']);
    const bare = await jkanime.versions({ url: 'https://jkanime.net/x/3/' }, async () => frame(0, 'um'));
    assert.deepEqual(bare.map(version => [version.id, version.kind]), [['x', 'sub']]);
  });

  await check('Catálogo: elegir por id o por tipo; sin coincidencia, la primera; una sola versión no es elección', async () => {
    const list = [{ id: 'a', label: 'A', kind: 'dub', target: { url: 'https://p.example/a' } }, { id: 'b', label: 'B', kind: 'sub', target: { url: 'https://p.example/b' } }];
    assert.equal(matchVersion(list, { id: 'b' }).id, 'b');
    assert.equal(matchVersion(list, { id: 'zz', kind: 'sub' }).id, 'b');
    assert.equal(matchVersion(list, { id: 'zz', kind: 'orig' }), null);
    assert.deepEqual(publicVersion({ id: 3, label: 'L', kind: 'weird', target: {} }), { id: '3', label: 'L', kind: 'orig' });
    assert.equal(dedupe([...list, list[0], { id: 'c', target: {} }]).length, 2);
    let asked = 0, answer = list;
    const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [], versions: async () => { asked++; return answer; } };
    const catalog = new Catalog({ file: join(directory, 'c.json'), detailsFile: join(directory, 'cd.json'), fetch: async () => '', connectors: [site] });
    const item = { source: 'x', kind: 'dorama', title: 'T', url: 'https://x.example/t' };
    const first = await catalog.resolve(item);
    assert.deepEqual([first.version, first.matched, first.versions.map(version => version.id), first.versions[0].target], ['a', false, ['a', 'b'], undefined]);
    assert.deepEqual([(await catalog.resolve(item, { version: 'b' })).url, (await catalog.resolve(item, { kind: 'sub' })).version, (await catalog.resolve(item, { version: 'b' })).matched], ['https://p.example/b', 'b', true]);
    assert.equal(asked, 1);
    assert.deepEqual((await catalog.versionsOf(item)).map(version => version.label), ['A', 'B']);
    assert.deepEqual(await catalog.versionsOf({ source: 'nada', url: 'https://x.example/q' }), []);
    answer = [list[1]];
    catalog.forgetPlayer(item.url);
    const single = await catalog.resolve(item);
    assert.deepEqual([single.url, single.versions], ['https://p.example/b', undefined]);
    assert.deepEqual(catalog.sources().map(source => source.versions), [true]);
    catalog.stop();
  });

  await check('Compatibilidad: el idioma se conserva entre sitios sin compartir IDs',async()=>{
    assert.equal(targetMatchesLanguage({versionKind:'sub'},{language:'Latino'},{kind:'dub'}),false);
    assert.equal(targetMatchesLanguage({},{language:'Subtitulado en español'},{kind:'dub'}),false);
    assert.equal(targetMatchesLanguage({},{language:'Latino'},{kind:'dub'}),true);
    assert.equal(targetMatchesLanguage({},{},{kind:'dub'}),false);
    assert.equal(targetMatchesLanguage({},{},{}),true);
    const sub={id:'sub-only',site:'https://sub.example/',versions:async()=>[{id:'1',kind:'sub',label:'Subtítulos en español',target:{url:'https://player.example/sub'}}]};
    const dub={id:'dub-only',site:'https://dub.example/',versions:async()=>[{id:'2',kind:'dub',label:'Español latino',target:{url:'https://player.example/dub'}}]};
    const c=new Catalog({file:join(directory,'guard.json'),detailsFile:join(directory,'guard-details.json'),connectors:[sub,dub],fetch:async()=>''});
    c.preference=async()=>null;c.elsewhere=async()=>[{source:'dub-only',url:'https://dub.example/e1',title:'T',kind:'dorama'}];
    const found=await c.resolvePlayable({source:'sub-only',url:'https://sub.example/e1',title:'T',kind:'dorama'},{kind:'dub'});assert.equal(found.item.source,'dub-only');assert.equal(found.target.versionKind,'dub');c.stop();
  });

  await check('IDs de idioma locales: una colisión no impone subtítulos sobre doblaje entre fuentes', async () => {
    const original={id:'original',site:'https://original.example/',versions:async()=>[]};
    const other={id:'other',site:'https://other.example/',versions:async()=>[
      {id:'38',kind:'sub',label:'Subtítulos en español',target:{url:'https://player.example/sub'}},
      {id:'9',kind:'dub',label:'Español latino',target:{url:'https://player.example/dub'}}]};
    assert.equal(matchVersion([{id:'38',kind:'sub'},{id:'9',kind:'dub'}],{id:'38',kind:'dub'}).id,'9');
    assert.equal(matchVersion([{id:'38',kind:'sub'}],{id:'38',kind:'dub'}),null);
    const catalog=new Catalog({file:join(directory,'collisions.json'),detailsFile:join(directory,'collisions-details.json'),connectors:[original,other],fetch:async()=>''});
    const item={source:'original',kind:'dorama',title:'Same show',episode:1,url:'https://original.example/e1',show:'https://original.example/show'};
    const copy={...item,source:'other',url:'https://other.example/e1',show:'https://other.example/show'};
    catalog.preference=async()=>null;catalog.elsewhere=async()=>[copy];
    const choice={version:'38',kind:'dub'};
    let bridge;
    try {
      const web=await catalog.resolvePlayable(item,choice);
      assert.equal(web.item.source,'other');assert.equal(web.target.version,'9');assert.equal(web.target.versionKind,'dub');
      const library=new Library(join(directory,'collision-library.json'));
      const cdp={async evaluate(){return true;},async call(){return{};}};
      bridge=new HolyBridge(cdp,{library,catalog,preferencesFile:join(directory,'collision-settings.json'),recorder:false});
      bridge.session={item,choice,tried:new Set([item.source]),candidates:[copy],searched:true};
      const target=await bridge.findElsewhere(bridge.session);
      assert.equal(target.url,'https://player.example/dub');assert.equal(target.versionKind,'dub');
      assert.equal(bridge.session.item.source,'other');
      // The selected mode survives opening even when only one version is exposed.
      await bridge.openTarget(bridge.session,{...target,versions:[]});
      assert.equal(bridge.session.versionKind,'dub');
    }finally{if(bridge)await bridge.stop();catalog.stop();}
  });

  await check('Historial: el idioma elegido se recuerda por serie, sobrevive al reinicio y no admite basura', () => {
    const file = join(directory, 'lang.json');
    const library = new Library(file);
    const episode = { source: 'doramasflix', kind: 'dorama', title: 'Between Steps', url: 'https://doramasflix.io/capitulos/between-steps-1x2', show: 'https://doramasflix.io/doramas/between-steps' };
    assert.equal(library.languageOf(episode), null);
    library.setLanguage(episode, { id: '13109', kind: 'sub', label: 'Coreano · subtítulos en español' });
    const other = { ...episode, url: 'https://doramasflix.io/capitulos/between-steps-1x9' };
    assert.deepEqual([library.languageOf(other).id, library.languageOf(other).kind], ['13109', 'sub']);
    assert.equal(new Library(file).languageOf(episode).label, 'Coreano · subtítulos en español');
    library.setLanguage(episode, null);
    assert.equal(new Library(file).languageOf(episode), null);
    writeBad(file);
    assert.deepEqual(new Library(file).languages, { 'https://a/': { id: 'ok', kind: 'dub', label: '', at: 0 } });
  });

  await check('Servidor: /holy-api/versions y /holy-api/language (solo desde orígenes permitidos)', async () => {
    const library = new Library(join(directory, 'srv.json'));
    const site = { id: 'x', name: 'X', site: 'https://x.example/', parseHome: () => [], versions: async () => [{ id: 'a', label: 'Español latino', kind: 'dub', target: { url: 'https://p.example/a' } }, { id: 'b', label: 'Coreano · subtítulos en español', kind: 'sub', target: { url: 'https://p.example/b' } }] };
    const plain = { id: 'y', name: 'Y', site: 'https://y.example/', parseHome: () => [] };
    const catalog = new Catalog({ file: join(directory, 'sc.json'), detailsFile: join(directory, 'scd.json'), fetch: async () => '', connectors: [site, plain] });
    const server = startServer({ catalog, library, port: 0, log: () => {}, imageDir: join(directory, 'img'), root: directory });
    await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const query = (source, url) => fetch(`${base}/holy-api/versions?source=${source}&url=${encodeURIComponent(url)}&show=${encodeURIComponent('https://x.example/serie')}`).then(response => response.json());
      assert.deepEqual((await query('x', 'https://x.example/e1')).versions.map(version => version.id), ['a', 'b']);
      assert.deepEqual(await query('y', 'https://y.example/e1'), { versions: [], remembered: null });
      assert.deepEqual(await query('x', 'javascript:alert(1)'), { versions: [], remembered: null });
      const save = (body, headers = {}) => fetch(base + '/holy-api/language', { method: 'POST', headers: { 'Content-Type': 'text/plain', ...headers }, body: JSON.stringify(body) });
      const saved = await save({ item: { source: 'x', url: 'https://x.example/e1', show: 'https://x.example/serie' }, version: { id: 'b', kind: 'sub', label: 'Coreano · subtítulos en español' } });
      assert.deepEqual([saved.status, (await saved.json()).remembered.id], [200, 'b']);
      assert.equal((await query('x', 'https://x.example/e2')).remembered.id, 'b');
      assert.equal((await save({ item: { source: 'x', url: 'https://x.example/e1', show: 'https://x.example/serie' }, version: null })).status, 200);
      assert.equal((await query('x', 'https://x.example/e2')).remembered, null);
      assert.equal((await save({ item: { source: 'x', url: 'nada' } })).status, 400);
      assert.equal((await save({ item: { source: 'x', url: 'https://x.example/e1' } }, { Origin: 'https://evil.example' })).status, 403);
    } finally { server.close(); catalog.stop(); }
  });

  await check('Puente: usa el idioma recordado o el pedido; en pausa ofrece «Idioma» y cambia en el mismo segundo', async () => {
    const calls = [], drawn = [], resolved = [];
    let video = { t: 100, d: 1400, paused: false, ready: 4, area: 1, ended: false };
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
        if (method === 'Runtime.evaluate') return { result: { value: params.expression.includes('v.play()') ? true : { url: 'https://p.example/', top: true, videos: [video], action: '' } } };
        return {};
      },
      async evaluate(expression) { drawn.push(expression); return 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const versions = [{ id: '38', label: 'Español latino', kind: 'dub' }, { id: '13109', label: 'Coreano · subtítulos en español', kind: 'sub' }];
    const show = 'https://doramasflix.io/doramas/between-steps';
    const catalog = { version: 1, find: () => null, pageFallback: () => false, forgetPlayer: () => {},
      resolve: async (item, options = {}) => { resolved.push(options); const chosen = versions.find(version => version.id === options.version) || versions.find(version => version.kind === options.kind) || versions[0]; return { url: 'https://p.example/play?v=' + chosen.id, versions, version: chosen.id, versionKind: chosen.kind }; },
      next: async item => ({ url: show.replace('doramas', 'capitulos') + '-1x' + (item.episode + 1), episode: item.episode + 1, label: 'Capítulo ' + (item.episode + 1) }), previous: async () => null };
    const library = new Library(join(directory, 'bridge.json'));
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'bridge-settings.json'), catalog, library, recorder: false, pauseDelay: 20 }).start();
    clearInterval(bridge.watchTimer);
    bridge.contexts.set(5, { id: 5, auxData: { isDefault: true, frameId: 'main' } });
    bridge.remoteContexts.add(9);
    const navigated = () => calls.filter(call => call.method === 'Page.navigate').at(-1)?.params.url;
    const key = code => bridge.event({ method: 'Runtime.bindingCalled', params: { name: '__lgLabCommand', executionContextId: 9, payload: JSON.stringify({ action: 'card', key: code }) } });
    const start = async value => {
      await bridge.command({ action: 'play', value });
      bridge.frames.set(bridge.mainFrame, 'https://p.example/'); bridge.navigation.phase = 'complete';
      video = { ...video, t: 100, paused: false };
      await new Promise(resolve => setTimeout(resolve, 60));
      await bridge.watch();
      assert.equal(bridge.session.phase, 'playing');
    };
    const episode = { source: 'doramasflix', kind: 'dorama', title: 'Between Steps', show, url: show.replace('doramas', 'capitulos') + '-1x1', episode: 1 };
    // Nothing remembered: the site's first; the TV asked first when it wanted a choice.
    await start(episode);
    assert.deepEqual(resolved.at(-1), {});
    assert.equal(navigated(), 'https://p.example/play?v=38');
    // The TV passes the chosen language; it is used for this episode.
    await start({ ...episode, version: '13109', versionKind: 'sub' });
    assert.deepEqual(resolved.at(-1), { version: '13109', kind: 'sub' });
    assert.equal(navigated(), 'https://p.example/play?v=13109');
    // Remembered per series: the next episode comes in that language by itself.
    library.setLanguage(episode, versions[1]);
    await start({ ...episode, url: show.replace('doramas', 'capitulos') + '-1x2', episode: 2 });
    assert.deepEqual(resolved.at(-1), { version: '13109', kind: 'sub' });
    // Paused: «Idioma» is offered with the language now playing.
    video = { ...video, t: 700, paused: true };
    await bridge.watch(); await new Promise(resolve => setTimeout(resolve, 40)); await bridge.watch();
    assert.deepEqual(bridge.session.card.options.map(option => option.action), ['resume', 'play', 'versions', 'episodes']);
    const panel = drawn.find(expression => expression.includes('"mode":"pause"') && expression.includes('Idioma'));
    assert.ok(panel.includes('Coreano · subtítulos en español') && panel.includes('🌐'));
    assert.deepEqual(bridge.session.card.options[1].item.version, '13109');
    // ↑ → → OK on «Idioma»: the languages card, with the current one selected.
    await key(38); await key(39); await key(39); await key(13);
    assert.equal(bridge.session.card.kind, 'versions');
    assert.equal(bridge.session.card.focus, 1);
    const card = drawn.filter(expression => expression.includes('"kicker":"IDIOMA"')).at(-1);
    assert.ok(card.includes('Español latino') && card.includes('"detail":"Ahora"') && card.includes('"start":1'));
    // Back from the languages card returns to the pause panel (does not leave the episode).
    bridge.frames.set(bridge.mainFrame, 'https://p.example/');
    const before = calls.length;
    await bridge.command({ action: 'back' });
    assert.equal(bridge.session.card.kind, 'pause');
    assert.ok(!calls.slice(before).some(call => call.method === 'Page.navigate'));
    // Choose «Español latino»: the same episode restarts in it at the same second, and it is remembered.
    await key(38); await key(39); await key(39); await key(13);
    await key(37); assert.equal(bridge.session.card.focus, 0);
    await key(13);
    assert.deepEqual(resolved.at(-1), { version: '38', kind: 'dub' });
    assert.equal(navigated(), 'https://p.example/play?v=38');
    assert.equal(bridge.session.item.episode, 2);
    assert.equal(library.languageOf(episode).id, '38');
    assert.equal(library.get(show)?.t, 700);
    await bridge.stop();
    // The TV: asks once per series, remembers, and shows the languages while resting on a card.
    const source = readFileSync(new URL('../src/Holy.svelte', import.meta.url), 'utf8');
    assert.match(source, /holy-api\/versions\?source=/);
    assert.match(source, /¿En qué idioma\?/);
    assert.match(source, /holy-api\/language/);
    assert.match(source, /versionInfo\[preview\.url\]\?\.versions\?\.length > 1/);
  });
  await check('Puente: conserva español elegido, rechaza copias subtituladas y avisa si falta', async () => {
    const calls = [], drawn = [], resolved = [];
    const failing = new Set(['https://p.example/play?v=38']);
    const cdp = {
      async call(method, params = {}) {
        calls.push({ method, params });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://example.com/' } } };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: String(calls.length) };
        if (method === 'Page.navigate' && failing.has(params.url)) return { errorText: 'net::ERR_CONNECTION_REFUSED' };
        if (method === 'Runtime.evaluate') return { result: { value: { url: 'https://p.example/', top: true, videos: [], action: '' } } };
        return {};
      },
      async evaluate(expression) { drawn.push(expression); return 'https://example.com/'; },
      onEvent() { return () => {}; }
    };
    const versions = [{ id: '38', label: 'Español latino', kind: 'dub' }, { id: '13109', label: 'Coreano · subtítulos en español', kind: 'sub' }];
    const show = 'https://doramasflix.io/doramas/between-steps';
    let offered = versions;
    const catalog = { version: 1, find: () => null, pageFallback: () => false, forgetPlayer: () => {},
      resolve: async (item, options = {}) => {
        resolved.push(options);
        const asked = offered.find(version => version.id === options.version) || offered.find(version => version.kind === options.kind);
        const chosen = asked || offered[0];
        return { url: 'https://p.example/play?v=' + chosen.id, versions: offered, version: chosen.id, versionKind: chosen.kind, matched: !!asked };
      } };
    const library = new Library(join(directory, 'fallback.json'));
    const bridge = await new HolyBridge(cdp, { preferencesFile: join(directory, 'fallback-settings.json'), catalog, library, recorder: false }).start();
    clearInterval(bridge.watchTimer);
    bridge.remoteContexts.add(9);
    const navigations = () => calls.filter(call => call.method === 'Page.navigate').map(call => call.params.url);
    const episode = { source: 'doramasflix', kind: 'dorama', title: 'Between Steps', show, url: show.replace('doramas', 'capitulos') + '-1x1', episode: 1 };
    try {
      library.setLanguage(episode, versions[0]);
      await bridge.command({ action: 'play', value: episode });
      assert.deepEqual(navigations(), ['https://p.example/play?v=38']);
      assert.equal(bridge.session.phase,'failed');
      assert.equal(resolved.some(options=>options.kind==='sub'),false,'Spanish failure cannot select Korean');
      assert.equal(library.languageOf(episode).id, '38', 'a fallback does not change the remembered language');
      // Every language fails: it ends instead of looping.
      failing.add('https://p.example/play?v=13109'); calls.length = 0;
      await bridge.command({ action: 'play', value: { ...episode, url: episode.url + '-b' } });
      assert.deepEqual(navigations(), ['https://p.example/play?v=38']);
      // The remembered language is missing in this episode: the screen says which one opens.
      failing.clear(); offered = [versions[1], { id: '77', label: 'Coreano original', kind: 'orig' }]; drawn.length = 0;
      await bridge.command({ action: 'play', value: { ...episode, url: episode.url + '-c' } });
      assert.equal(bridge.session.phase,'failed');assert.match(bridge.session.error,/En español/);
      assert.equal(navigations().some(url=>url.includes('v=13109')),false);
      // Cross-site recovery must skip subtitled/unknown audio and retain a Spanish copy.
      const wrong={...episode,source:'other',language:'Subtitulado',url:'https://other.example/e1'};
      const right={...episode,source:'spanish',language:'Latino',url:'https://spanish.example/e1'};
      catalog.resolve=async item=>({url:'https://player.example/'+item.source});catalog.elsewhere=async()=>[];
      bridge.session.candidates=[wrong,{...wrong,source:'unknown',language:''},right];bridge.session.searched=true;bridge.session.tried=new Set([episode.source]);
      const recovered=await bridge.findElsewhere(bridge.session);assert.equal(recovered.url,'https://player.example/spanish');assert.equal(bridge.session.item.source,'spanish');
    } finally { await bridge.stop(); }
  });
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log(`${checks.length} comprobaciones de idiomas y versiones correctas.`);

function writeBad(file) {
  writeFileSync(file, JSON.stringify({ entries: [], votes: [], languages: { 'https://a/': { id: 'ok', kind: 'dub' }, 'https://b/': { id: 5, kind: 'dub' }, 'https://c/': { id: 'x', kind: 'weird' }, 'https://d/': null, '': { id: 'e', kind: 'sub' } } }));
}
