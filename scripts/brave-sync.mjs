// Follows Brave's own pipeline (docs/BRAVE-ACTUALIZACIONES.md): its list catalog,
// its validated mirror and the uBlock commit its packager pins. The list
// processing below is ported from brave/brave-core-crx-packager
// (lib/adBlockRustUtils.js, scripts/generateAdBlockRustDataFiles.js, MPL-2.0).
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import adblock from 'adblock-rs';

export const BRAVE = {
  catalog: 'https://raw.githubusercontent.com/brave/adblock-resources/master/filter_lists/list_catalog.json',
  customResources: 'https://raw.githubusercontent.com/brave/adblock-resources/master/dist/resources.json',
  mirrorRepo: 'https://github.com/brave/adblock-lists-mirror',
  packagerRepo: 'https://github.com/brave/brave-core-crx-packager',
  mirrorFile: (commit, source) => `https://raw.githubusercontent.com/brave/adblock-lists-mirror/${commit}/lists/${createHash('md5').update(source).digest('hex')}.txt`,
  uBlockPin: commit => `https://api.github.com/repos/brave/brave-core-crx-packager/contents/submodules/uBlock?ref=${commit}`,
  uBlockTree: commit => `https://api.github.com/repos/brave/uBlock/git/trees/${commit}?recursive=1`,
  uBlockFile: (commit, path) => `https://raw.githubusercontent.com/brave/uBlock/${commit}/${path}`
};
const SHA = /^[0-9a-f]{40}$/;

// The same choice a desktop Brave in Spanish makes: hidden defaults, visible
// defaults (cookies, app promos) and the first list for the locale.
export function selectComponents(catalog, locale = 'es') {
  if (!Array.isArray(catalog) || catalog.length < 5) throw Error('Catálogo de Brave inválido.');
  const desktop = entry => !Array.isArray(entry.platforms) || entry.platforms.some(name => ['DESKTOP', 'LINUX', 'MAC', 'WINDOWS'].includes(name));
  const regional = catalog.find(entry => (entry.langs || []).includes(locale) && desktop(entry));
  const chosen = catalog.filter(entry => (entry.default_enabled && desktop(entry)) || entry === regional);
  return chosen.map(entry => {
    if (!Array.isArray(entry.sources) || !entry.sources.length) throw Error(`Lista sin fuentes: ${entry.title}`);
    return {
      id: String(entry.title).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
      title: entry.title, uuid: entry.uuid, permissions: Number(entry.permission_mask) || 0,
      sources: entry.sources.map(source => {
        const url = new URL(source.url);
        if (url.protocol !== 'https:') throw Error(`Fuente sin HTTPS: ${source.url}`);
        return {url: source.url, title: source.title || entry.title, format: source.format === 'Hosts' ? 'Hosts' : 'Standard'};
      })
    };
  });
}

const IF_CONDITIONS = new Map([
  ['ext_ublock', true], ['ext_devbuild', false], ['env_devbuild', false], ['env_chromium', true], ['env_edge', false],
  ['env_firefox', false], ['env_legacy', false], ['env_safari', false], ['cap_html_filtering', false],
  ['cap_user_stylesheet', true], ['false', false], ['ext_abp', false], ['adguard', false], ['adguard_app_android', false],
  ['adguard_app_ios', false], ['adguard_app_mac', false], ['adguard_app_windows', false], ['adguard_ext_android_cb', false],
  ['adguard_ext_chromium', true], ['adguard_ext_edge', false], ['adguard_ext_firefox', false], ['adguard_ext_opera', true],
  ['adguard_ext_safari', false]
]);
const [NORMAL, IF_BRAVE, IF_NOT_BRAVE, IF_WHATEVER] = [0, 1, 2, 3];

// Keeps only the !#if branches a Chromium Brave would use. Unknown conditions keep their lines.
export function preprocess(text, title = 'lista') {
  const stack = [];
  const pop = () => { if (!stack.length) throw Error(`${title}: error de preprocesado (!#if desbalanceado).`); return stack.pop(); };
  const lines = text.split('\n').filter(raw => {
    const line = raw.trim();
    const current = stack.length ? stack[stack.length - 1] : NORMAL;
    const match = /^!#if (!?)(.*)$/.exec(line);
    if (match) {
      if (current === IF_NOT_BRAVE) { stack.push(IF_NOT_BRAVE); return false; }
      const value = IF_CONDITIONS.get(match[2]);
      if (value === undefined) { stack.push(IF_WHATEVER); return false; }
      stack.push((match[1] === '!' ? !value : value) ? IF_BRAVE : IF_NOT_BRAVE);
      return false;
    }
    if (line === '!#else') { const state = pop(); stack.push(state === IF_WHATEVER ? state : state === IF_BRAVE ? IF_NOT_BRAVE : IF_BRAVE); return false; }
    if (line === '!#endif') { pop(); return false; }
    return current !== IF_NOT_BRAVE;
  });
  if (stack.length) throw Error(`${title}: error de preprocesado (!#if sin cerrar).`);
  return lines.join('\n');
}

// Only Brave's own lists may call Brave's private scriptlets.
export function enforceBraveDirectives(title, text) {
  if (String(title).startsWith('Brave ') || title === 'Experimental ad blocker') return text;
  return text.split('\n').filter(line => !line.includes('+js(brave-')).join('\n');
}

export function removeIncompatibleRules(text) {
  return text.split('\n').filter(line => !line.trim().startsWith('/^dizipal\\d+\\.com$/##')).join('\n');
}

// Brave refuses to publish a list that blocks these known-good requests.
const SAFE_REQUESTS = [
  ['https://brave.com', 'https://brave.com', 'document'],
  ['https://brave.com/js/navigation.js', 'https://brave.com', 'script'],
  ['https://dev-pages.brave.software/static/js/site.js', 'https://dev-pages.brave.software/filtering/index.html', 'script'],
  ['https://en.wikipedia.org/wiki/Ad_blocking', 'https://en.wikipedia.org/wiki/Ad_blocking', 'document'],
  ['https://en.wikipedia.org/w/load.php?lang=en&modules=startup&only=scripts&raw=1&skin=vector-2022', 'https://en.wikipedia.org/wiki/Ad_blocking', 'script'],
  ['https://en.wikipedia.org/static/images/icons/wikipedia.png', 'https://en.wikipedia.org/wiki/Ad_blocking', 'image'],
  ['https://es.wikipedia.org/wiki/Televisor', 'https://es.wikipedia.org/wiki/Televisor', 'document'],
  ['https://brave.com', 'https://example.com', 'subdocument'],
  ['https://en.wikipedia.org/wiki/Ad_blocking', 'https://example.com', 'subdocument']
];
export function sanityCheck(title, text, format = 'Standard') {
  const set = new adblock.FilterSet(false);
  set.addFilters(text, {format});
  const engine = new adblock.Engine(set);
  for (const [url, source, type] of SAFE_REQUESTS) {
    if (engine.check(url, source, type)) throw Error(`${title} bloquea un recurso legítimo (${url}); posible lista corrupta.`);
  }
}

export function processSource(component, source, text) {
  const title = source.title || component.title;
  const processed = removeIncompatibleRules(preprocess(text, title));
  sanityCheck(title, processed, source.format);
  return enforceBraveDirectives(component.title, processed);
}

const run = promisify(execFile);
// `git ls-remote` asks only for a commit id: cheap and outside GitHub's API limits.
export async function remoteHead(repository, ref, exec = run) {
  const {stdout} = await exec('git', ['ls-remote', repository, ref], {timeout: 30000, env: {...process.env, GIT_TERMINAL_PROMPT: '0'}});
  const commit = stdout.trim().split(/\s+/)[0];
  if (!SHA.test(commit || '')) throw Error(`No se pudo leer ${ref} de ${repository}.`);
  return commit;
}
export async function probeBrave(exec) {
  const [mirrorCommit, packagerCommit] = await Promise.all([
    remoteHead(BRAVE.mirrorRepo, 'refs/heads/lists', exec), remoteHead(BRAVE.packagerRepo, 'refs/heads/master', exec)
  ]);
  return {mirrorCommit, packagerCommit};
}
export function checkCommit(value, what) {
  if (!SHA.test(value || '')) throw Error(`Commit inválido para ${what}.`);
  return value;
}
