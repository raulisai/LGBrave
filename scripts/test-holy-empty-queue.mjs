import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, compile } from 'svelte/compiler';
import { render } from 'svelte/server';

// Render the actual component's empty-shelf template. A successful empty queue must
// not display the loading skeleton or retain a title as if it were still queued.
const source = readFileSync(new URL('../src/Holy.svelte', import.meta.url), 'utf8');
const ast = parse(source, { modern: true });
let empty;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'IfBlock' && source.slice(node.test.start, node.test.end).trim() === '!rows.length') empty = node;
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
}
visit(ast.fragment); assert.ok(empty);
const template = `<script>let {section='cola',rows=[],episodesView=null,tasteLoading=false,searchStatus=[],query='',notice='',apiBase='http://fixture',data={sources:[]}}=$props();</script>` + source.slice(empty.start, empty.end);
const compiled = compile(template, { filename: 'EmptyQueue.svelte', generate: 'server' }).js.code.replace(/from ['"](svelte(?:\/[^'"]*)?)['"]/g, (_, module) => 'from ' + JSON.stringify(import.meta.resolve(module)));
const directory = mkdtempSync(join(tmpdir(), 'holy-empty-queue-'));
try {
  const file = join(directory, 'component.mjs'); writeFileSync(file, compiled);
  const { default: Component } = await import(pathToFileURL(file).href);
  const html = props => { const result = render(Component, { props }); return result.body || result.html; };
  const queue = html({ section: 'cola' });
  assert.match(queue, /Tu cola está vacía/); assert.match(queue, /botón amarillo/); assert.doesNotMatch(queue, /class="skeleton"/);
  assert.doesNotMatch(html({ section: 'cola', notice: 'Quitado de Mi cola' }), /class="skeleton"/);
  assert.match(html({ section: 'inicio' }), /class="skeleton"/, 'Loading an ordinary home still displays feedback');
  assert.match(html({ section: 'gustos', tasteLoading: false }), /No hay títulos para calificar/);
  assert.match(html({ section: 'buscar' }), /Busca en todos tus sitios/);
  console.log('Cola vacía: plantilla real Svelte sin carga indefinida; Inicio, Buscar y Gustos conservados.');
} finally { rmSync(directory, { recursive: true, force: true }); }
