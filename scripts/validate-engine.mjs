import assert from 'node:assert/strict';
import adblock from 'adblock-rs';
import { writeFileSync } from 'node:fs';
const tests = [];
function test(name, fn) {
  try { fn(); tests.push({ name, pass: true }); }
  catch (error) { tests.push({ name, pass: false, error: error.message }); }
}
function engine(filters) {
  const set = new adblock.FilterSet(true); set.addFilters(filters);
  const result = new adblock.Engine(set);
  result.useResources([
    { name: 'lab-noop', aliases: [], kind: { mime: 'application/javascript' }, content: Buffer.from('/* replacement */').toString('base64') },
    { name: 'marker.js', aliases: [], kind: 'template', content: Buffer.from('window.marker=true;').toString('base64') }
  ]);
  return result;
}
const source = 'https://editorial.example/';
const checks = [
  ['Bloqueo por dominio', '||ads.example^', 'https://ads.example/ad.js', source, 'script', true],
  ['No confundir dominio parecido', '||ads.example^', 'https://notads.example/app.js', source, 'script', false],
  ['Excepción', '||ads.example^\n@@||ads.example/allowed.js', 'https://ads.example/allowed.js', source, 'script', false],
  ['Tipo script', '||ads.example^$script', 'https://ads.example/pixel.png', source, 'image', false],
  ['Terceros', '||ads.example^$third-party', 'https://ads.example/ad.js', source, 'script', true],
  ['Mismo sitio permitido por third-party', '||ads.example^$third-party', 'https://ads.example/ad.js', 'https://ads.example/', 'script', false],
  ['Regla específica del sitio', '||ads.example^$domain=editorial.example', 'https://ads.example/ad.js', source, 'script', true],
  ['Regla no afecta otro sitio', '||ads.example^$domain=editorial.example', 'https://ads.example/ad.js', 'https://other.example/', 'script', false],
  ['important domina excepción', '||ads.example^$important\n@@||ads.example^', 'https://ads.example/a.js', source, 'script', true]
];
for (const [name, rules, url, origin, type, expected] of checks) test(name, () => assert.equal(engine(rules).check(url, origin, type, 'get', true).should_block, expected));
test('Respuesta de reemplazo', () => { const result=engine('||ads.example^$script,redirect=lab-noop').check('https://ads.example/a.js',source,'script','get',true); assert.equal(result.should_block,true); assert.ok(result.redirect?.startsWith('data:')); });
test('Eliminar parámetro de seguimiento', () => { const result=engine('||editorial.example^$removeparam=utm_source').check('https://editorial.example/page?utm_source=test&article=1',source,'document','get',true); assert.equal(result.rewritten_url,'https://editorial.example/page?article=1'); });
test('CSS por dominio', () => assert.ok(engine('editorial.example##.ad').urlCosmeticResources(source).hide_selectors.includes('.ad')));
test('Excepción de CSS', () => assert.ok(!engine('editorial.example##.ad\neditorial.example#@#.ad').urlCosmeticResources(source).hide_selectors.includes('.ad')));
test('Selector genérico', () => assert.ok(engine('##.generic-ad').hiddenClassIdSelectors(['generic-ad'],[],[]).includes('.generic-ad')));
test('Generación de scriptlet', () => assert.ok(engine('editorial.example##+js(marker)').urlCosmeticResources(source).injected_script.includes('window.marker=true')));
const report = { capturedAt: new Date().toISOString(), scope: 'Semántica del motor Node; cada integración en TV se mide por separado.', passed: tests.filter(t=>t.pass).length, total: tests.length, tests };
writeFileSync('evidence/browser-lab/engine-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(tests.some(t=>!t.pass))process.exitCode=1;
