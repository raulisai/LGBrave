import adblock from 'adblock-rs';
import { readFileSync } from 'node:fs';

export const fixtureRules = [
  '/ad-fixture/',
  '@@/ad-fixture/allowed.js',
  '192.168.1.148##.lab-ad',
  '## #generic-lab-ad'.replace('## ', '##'),
  '192.168.1.148##+js(lab-marker)',
].join('\n');

export function createEngine({ lists = true, fixtures = false } = {}) {
  const set = new adblock.FilterSet(true);
  if (lists) for (const name of ['easylist', 'easyprivacy']) set.addFilters(readFileSync(`research/lists/${name}.txt`, 'utf8'));
  if (fixtures) set.addFilters(fixtureRules);
  const engine = new adblock.Engine(set);
  const resources = JSON.parse(readFileSync('research/brave/resources.json', 'utf8'));
  engine.useResources([...resources,
    { name: 'lab-marker.js', aliases: [], kind: 'template', content: Buffer.from('window.__labScriptlet = "injected";').toString('base64') },
    { name: 'lab-noop', aliases: [], kind: { mime: 'application/javascript' }, content: Buffer.from('/* Local redirect fixture. */').toString('base64') }
  ]);
  return engine;
}

export function checkRequest(engine, url, source, type, method = 'GET') {
  const mapping = { Stylesheet: 'stylesheet', Script: 'script', Image: 'image', Media: 'media', Font: 'font', XHR: 'xmlhttprequest', Fetch: 'xmlhttprequest', Document: 'subdocument', Ping: 'ping', Other: 'other', Manifest: 'other' };
  return engine.check(url, source, mapping[type] || type.toLowerCase(), method.toLowerCase(), true);
}
