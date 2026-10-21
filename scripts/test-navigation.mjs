import assert from 'node:assert/strict';
import { resolveNavigation } from '../src/navigation.js';
const cases = [
  ['anime j k', 'https://www.google.com/search?q=anime%20j%20k'],
  ['  anime de Jota k  ', 'https://www.google.com/search?q=anime%20de%20Jota%20k'],
  ['anime', 'https://www.google.com/search?q=anime'],
  ['anime & acción', 'https://www.google.com/search?q=anime%20%26%20acci%C3%B3n'],
  ['example.com', 'https://example.com/'],
  ['example.com/path?q=anime', 'https://example.com/path?q=anime'],
  ['https://example.com/una página', 'https://example.com/una%20p%C3%A1gina'],
  ['http://192.168.1.148:43187/simple', 'http://192.168.1.148:43187/simple'],
  ['localhost:43187/simple', 'https://localhost:43187/simple'],
];
for (const [input, expected] of cases) assert.equal(resolveNavigation(input), expected, input);
for (const input of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'https://bad host/', 'https://user:password@example.com']) assert.throws(() => resolveNavigation(input), undefined, input);
for (const [engine, expected] of Object.entries({ google: 'https://www.google.com/search?q=anime', bing: 'https://www.bing.com/search?q=anime', duckduckgo: 'https://html.duckduckgo.com/html/?q=anime', brave: 'https://search.brave.com/search?q=anime' })) {
  assert.equal(resolveNavigation('anime', engine), expected);
  assert.equal(resolveNavigation('https://example.com/', engine), 'https://example.com/');
}
assert.equal(resolveNavigation('anime', 'unknown'), 'https://www.google.com/search?q=anime');
console.log(`${cases.length + 15} comprobaciones de búsqueda y direcciones correctas.`);
