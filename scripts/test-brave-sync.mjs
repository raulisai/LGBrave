import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BRAVE, selectComponents, preprocess, enforceBraveDirectives, sanityCheck, remoteHead} from './brave-sync.mjs';
import {updateLists, buildUBlockScriptlets} from './update-lists.mjs';

const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const temp = mkdtempSync(join(tmpdir(), 'luma-brave-'));

try {
  await check('!#if conserva Chromium y descarta Firefox/Safari', () => {
    const text = ['a', '!#if env_firefox', 'firefox', '!#else', 'otro', '!#endif', '!#if env_chromium', 'chromium', '!#if env_safari', 'safari', '!#endif', '!#endif', '!#if !cap_html_filtering', 'sin-html', '!#endif', '!#if desconocida', 'se-conserva', '!#endif'].join('\n');
    assert.deepEqual(preprocess(text).split('\n'), ['a', 'otro', 'chromium', 'sin-html', 'se-conserva']);
    assert.throws(() => preprocess('!#if env_chromium\nx'));
    assert.throws(() => preprocess('x\n!#endif'));
  });
  await check('Directivas brave- solo en listas de Brave', () => {
    const text = 'a.com##+js(brave-fix)\na.com##+js(set, x, 1)';
    assert.equal(enforceBraveDirectives('uBlock Origin Filters', text), 'a.com##+js(set, x, 1)');
    assert.equal(enforceBraveDirectives('Brave Default Adblock Filters', text), text);
  });
  await check('Prueba de cordura rechaza listas que bloquean webs legítimas', () => {
    assert.throws(() => sanityCheck('rota', '||wikipedia.org^'));
    sanityCheck('sana', '||ads.example^\n##.banner-ad');
  });
  await check('Commit leído con git ls-remote', async () => {
    const commit = 'a'.repeat(40);
    assert.equal(await remoteHead('repo', 'refs/heads/lists', async () => ({stdout: `${commit}\trefs/heads/lists\n`})), commit);
    await assert.rejects(remoteHead('repo', 'x', async () => ({stdout: ''})));
  });

  const catalog = [
    {uuid: 'default', title: 'Brave Default Adblock Filters', default_enabled: true, hidden: true, permission_mask: 1, sources: [{url: 'https://lists.test/ubo.txt', title: 'uBlock Origin Filters', format: 'Standard'}, {url: 'https://lists.test/brave.txt', title: 'Brave Specific', format: 'Standard'}]},
    {uuid: 'ios', title: 'Brave IOS-Specific Filters', default_enabled: true, platforms: ['IOS'], sources: [{url: 'https://lists.test/ios.txt'}]},
    {uuid: 'social', title: 'Social media blocker', default_enabled: false, sources: [{url: 'https://lists.test/social.txt'}]},
    {uuid: 'es1', title: 'Spanish website ad blocker', langs: ['es'], sources: [{url: 'https://lists.test/es.txt'}]},
    {uuid: 'es2', title: 'Spanish and Portuguese website ad blocker', langs: ['es', 'pt'], sources: [{url: 'https://lists.test/es-pt.txt'}]}
  ];
  await check('Selección como un Brave de escritorio en español', () => {
    const components = selectComponents(catalog, 'es');
    assert.deepEqual(components.map(c => c.id), ['brave-default-adblock-filters', 'spanish-website-ad-blocker']);
    assert.equal(components[0].permissions, 1);
    assert.equal(components[1].permissions, 0);
  });

  await check('Scriptlets de uBlock en proceso aislado sin escritura', async () => {
    const good = join(temp, 'ubo-good');
    mkdirSync(join(good, 'src/js/resources'), {recursive: true});
    const entries = Array.from({length: 22}, (_, i) => `{name:'s${i}.js',aliases:['s${i}'],fn:function s${i}(){return ${i}},dependencies:[]}`);
    entries.push(`{name:'trusted-set.js',aliases:[],requiresTrust:true,fn:function trustedSet(){},dependencies:[]}`);
    writeFileSync(join(good, 'src/js/resources/scriptlets.js'), `export const builtinScriptlets=[${entries.join(',')}];`);
    const resources = await buildUBlockScriptlets(good);
    assert.equal(resources.length, 23);
    assert.equal(resources.find(r => r.name === 'trusted-set.js').permission, 1);
    assert.equal(resources[0].permission, undefined);
    const evil = join(temp, 'ubo-evil');
    mkdirSync(join(evil, 'src/js/resources'), {recursive: true});
    writeFileSync(join(evil, 'src/js/resources/scriptlets.js'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(join(temp, 'escaped.txt'))}, 'x'); export const builtinScriptlets=[];`);
    await assert.rejects(buildUBlockScriptlets(evil));
    assert.ok(!existsSync(join(temp, 'escaped.txt')));
  });

  // Full update with a fake network.
  const lists = join(temp, 'lists');
  const mirror = (commit, url) => BRAVE.mirrorFile(commit, url);
  let heads = {mirrorCommit: '1'.repeat(40), packagerCommit: '2'.repeat(40)};
  const uBlockCommit = '3'.repeat(40);
  const ubo = '! Title: uBO\n||ads.test^\n!#if env_firefox\n||solo-firefox.test^\n!#endif\nnews.test##+js(trusted-set)\n';
  const files = commit => new Map([
    [BRAVE.catalog, JSON.stringify(catalog)],
    [BRAVE.uBlockPin(heads.packagerCommit), JSON.stringify({sha: uBlockCommit})],
    [BRAVE.customResources, JSON.stringify(Array.from({length: 12}, (_, i) => ({name: `brave-${i}.js`, aliases: [], kind: 'template', content: Buffer.from(`/*${i}*/`).toString('base64')})))],
    [mirror(commit, 'https://lists.test/ubo.txt'), ubo],
    [mirror(commit, 'https://lists.test/brave.txt'), '! Title: Brave\n||brave-ads.test^\nx.test##+js(brave-fix)\n'],
    [mirror(commit, 'https://lists.test/es.txt'), '[Adblock Plus 2.0]\n! EasyList Spanish\n||anuncios.test^\n##.publicidad\n']
  ]);
  let requested = [];
  const fetcher = async url => {
    requested.push(url);
    const body = files(heads.mirrorCommit).get(url);
    if (body === undefined) return {ok: false, status: 404, headers: new Headers()};
    return new Response(body);
  };
  const resourcesFromUBlock = JSON.stringify([
    ...Array.from({length: 10}, (_, i) => ({name: `r${i}.js`, aliases: [], kind: {mime: 'application/javascript'}, content: ''})),
    {name: 'json-prune.js', aliases: [], kind: {mime: 'application/javascript'}, content: ''}
  ]);
  let builds = 0;
  const options = {directory: lists, fetcher, validate: async () => {}, probe: async () => heads,
    // The tree/raw downloads are exercised against GitHub in the real run; here the copy is faked.
    build: async () => { builds++; return []; }};
  // Short-circuit uBlock downloads: pretend the previous generation had these resources.
  mkdirSync(join(lists, 'generations/seed'), {recursive: true});
  writeFileSync(join(lists, 'generations/seed/resources.json'), resourcesFromUBlock);
  writeFileSync(join(lists, 'lists.json'), JSON.stringify({revision: 'seed', directory: 'generations/seed', enabled: [], brave: {uBlockCommit}}));

  let result;
  await check('Actualización completa desde el espejo de Brave', async () => {
    result = await updateLists(options);
    assert.equal(result.changed, true);
    const manifest = JSON.parse(readFileSync(join(lists, 'lists.json'), 'utf8'));
    assert.deepEqual(manifest.enabled, ['brave-default-adblock-filters', 'spanish-website-ad-blocker']);
    assert.equal(manifest.brave.mirrorCommit, heads.mirrorCommit);
    assert.equal(manifest.brave.uBlockCommit, uBlockCommit);
    assert.equal(manifest.lists['brave-default-adblock-filters'].permissions, 1);
    const text = readFileSync(join(lists, manifest.directory, 'brave-default-adblock-filters.txt'), 'utf8');
    assert.ok(text.includes('||ads.test^') && text.includes('||brave-ads.test^') && !text.includes('solo-firefox'));
    assert.ok(text.includes('+js(brave-fix)'), 'las listas de Brave conservan sus scriptlets');
    assert.ok(requested.some(url => url.startsWith('https://raw.githubusercontent.com/brave/adblock-lists-mirror/' + heads.mirrorCommit)));
    assert.equal(builds, 0, 'mismo commit de uBlock: se reutilizan los scriptlets');
    assert.equal(JSON.parse(readFileSync(join(lists, 'sync-state.json'), 'utf8')).mirrorCommit, heads.mirrorCommit);
  });
  await check('Sin cambios en Brave: no descarga nada', async () => {
    requested = [];
    const again = await updateLists(options);
    assert.equal(again.changed, false);
    assert.equal(requested.length, 0);
  });
  await check('Commit nuevo con el mismo contenido: misma versión, commit registrado', async () => {
    heads = {...heads, mirrorCommit: '4'.repeat(40)};
    const next = await updateLists(options);
    assert.equal(next.changed, false, 'mismo contenido, misma revisión');
    assert.equal(JSON.parse(readFileSync(join(lists, 'lists.json'), 'utf8')).brave.mirrorCommit, heads.mirrorCommit);
  });
  await check('Motor con permisos por lista: trusted solo en listas de confianza', async () => {
    const manifest = JSON.parse(readFileSync(join(lists, 'lists.json'), 'utf8'));
    const generation = join(lists, manifest.directory);
    const trusted = [{name: 'trusted-set.js', aliases: ['trusted-set'], kind: {mime: 'application/javascript'}, content: Buffer.from('window.T=1').toString('base64'), permission: 1}];
    const base = JSON.parse(readFileSync(join(generation, 'resources.json'), 'utf8'));
    writeFileSync(join(generation, 'resources.json'), JSON.stringify([...base, ...trusted]));
    writeFileSync(join(generation, 'spanish-website-ad-blocker.txt'), readFileSync(join(generation, 'spanish-website-ad-blocker.txt'), 'utf8') + '\nes.test##+js(trusted-set)\n');
    process.env.LUMA_FILTER_GENERATION = generation;
    const {createEngine} = await import('./filter-engine.mjs');
    const engine = createEngine({});
    assert.ok(engine.urlCosmeticResources('https://news.test/').injected_script.includes('window.T'));
    assert.ok(!engine.urlCosmeticResources('https://es.test/').injected_script.includes('window.T'));
    assert.ok(engine.check('https://ads.test/a.js', 'https://site.test/', 'script'));
    assert.ok(!engine.check('https://solo-firefox.test/a.js', 'https://site.test/', 'script'));
    delete process.env.LUMA_FILTER_GENERATION;
  });
  await check('Un fallo de descarga conserva la versión activa', async () => {
    const before = readFileSync(join(lists, 'lists.json'), 'utf8');
    heads = {...heads, mirrorCommit: '5'.repeat(40)};
    await assert.rejects(updateLists({...options, fetcher: async url => url.includes('adblock-lists-mirror') ? {ok: false, status: 500, headers: new Headers()} : fetcher(url)}));
    assert.equal(readFileSync(join(lists, 'lists.json'), 'utf8'), before);
  });
  console.log(`${checks.length} comprobaciones del seguimiento de Brave correctas.`);
} finally { rmSync(temp, {recursive: true, force: true}); }
