import adblock from 'adblock-rs';
import { existsSync, readFileSync } from 'node:fs';
import {resolve} from 'node:path';
import { lumaRules, lumaResources } from './shields.mjs';
import {lumaOrigin} from './desktop-config.mjs';
const fixtureHost = new URL(lumaOrigin()).hostname;

export const fixtureRules = [
  '/ad-fixture/',
  '||luma-navigation-block.invalid^$document',
  '@@/ad-fixture/allowed.js',
  'news.example,docs.example##.lab-ad',
  `${fixtureHost},192.168.1.148##.lab-ad`,
  '## #generic-lab-ad'.replace('## ', '##'),
  `${fixtureHost},192.168.1.148##+js(lab-marker)`,
].join('\n');

// scripts/update-lists.mjs writes the manifest; without it, the bundled pair.
export function filterConfiguration() {
  const root=resolve('research/lists');
  const override=process.env.LUMA_FILTER_GENERATION;
  const manifestFile=override ? resolve(override,'lists.json') : resolve(root,'lists.json');
  let manifest=existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile,'utf8')) : {enabled:['easylist','easyprivacy']};
  if(manifest.directory && !/^generations\/[a-f0-9]{20}$/.test(manifest.directory))throw Error('Directorio de filtros inválido.');
  let directory=override ? resolve(override) : manifest.directory ? resolve(root,manifest.directory) : root;
  // Ignored generations do not travel with a clone. Use the bundled lists until
  // the updater downloads a validated generation; never silently run with zero lists.
  if (!override && manifest.directory && !existsSync(directory)) {
    directory = root;
    manifest = {enabled:['easylist','easyprivacy','easylist-spanish','easylist-cookie','ublock-filters','ublock-privacy','ublock-unbreak'],
      revision:'bundled', fallback:true};
  }
  return {manifest,directory};
}
export function enabledLists() {
  const {manifest,directory}=filterConfiguration();
  return manifest.enabled.filter(name => /^[a-z0-9-]+$/.test(name) && existsSync(`${directory}/${name}.txt`));
}

export function createEngine({ lists = true, fixtures = false } = {}) {
  const set = new adblock.FilterSet(true);
  const {manifest,directory}=filterConfiguration();
  if (lists) {
    // Same parse options Brave uses per catalog entry: trusted scriptlets need permission bit 1.
    for (const name of enabledLists()) {
      const meta = manifest.lists?.[name] || {};
      set.addFilters(readFileSync(`${directory}/${name}.txt`, 'utf8'), { format: meta.format === 'Hosts' ? 'Hosts' : 'Standard', permissions: Number(meta.permissions) || 0 });
    }
    set.addFilters(lumaRules);
  }
  if (fixtures) set.addFilters(fixtureRules);
  const engine = new adblock.Engine(set);
  const resources = JSON.parse(readFileSync(existsSync(`${directory}/custom-resources.json`) ? `${directory}/custom-resources.json` : 'research/brave/resources.json', 'utf8'));
  const fullResources = JSON.parse(readFileSync(existsSync(`${directory}/resources.json`) ? `${directory}/resources.json` : 'research/brave/full/resources.json', 'utf8'));
  // Common uBO-compatible scriptlets and their dependencies are separate from
  // Brave's custom resources. Loading only the latter silently drops +js rules.
  const merged = new Map([...fullResources, ...resources, ...lumaResources].map(resource => [resource.name, resource]));
  engine.useResources([...merged.values(),
    { name: 'lab-marker.js', aliases: [], kind: 'template', content: Buffer.from('window.__labScriptlet = "injected";').toString('base64') },
    { name: 'lab-noop', aliases: [], kind: { mime: 'application/javascript' }, content: Buffer.from('/* Local redirect fixture. */').toString('base64') }
  ]);
  return engine;
}

export function checkRequest(engine, url, source, type, method = 'GET') {
  const mapping = { Stylesheet: 'stylesheet', Script: 'script', Image: 'image', Media: 'media', Font: 'font', XHR: 'xmlhttprequest', Fetch: 'xmlhttprequest', Document: 'subdocument', Ping: 'ping', Other: 'other', Manifest: 'other' };
  return engine.check(url, source, mapping[type] || type.toLowerCase(), method.toLowerCase(), true);
}
