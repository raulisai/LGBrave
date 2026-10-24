import assert from 'node:assert/strict';
import { turnstileDefer } from './turnstile-defer.mjs';

// Minimal DOM double: widgets with classes, data-* attributes and a "displayed" flag.
function widget(attributes, displayed) {
  const classes = new Set(['cf-turnstile']);
  const element = {
    nodeType: 1, isConnected: true, displayed, children: [],
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    dataset: {},
    classList: { contains: c => classes.has(c), replace: (a, b) => { if (!classes.has(a)) return false; classes.delete(a); classes.add(b); return true; } },
    getClientRects() { return this.displayed ? [{}] : []; },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  element.classes = classes;
  return element;
}

function run(hostname, widgets, { turnstile = null } = {}) {
  const listeners = {}; const timers = []; let observer;
  const root = { nodeType: 1, classList: { contains: () => false }, querySelectorAll: selector => (selector === '.cf-turnstile' ? widgets.filter(w => w.classes.has('cf-turnstile')) : []) };
  const doc = { documentElement: root, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const win = { addEventListener: (type, fn) => { listeners[type] = fn; }, turnstile, onLogin: token => (win.token = token) };
  const names = ['window', 'document', 'location', 'MutationObserver', 'setInterval', 'clearInterval', 'Object', 'Array', 'Number'];
  const Observer = class { constructor(fn) { observer = fn; } observe() {} };
  new Function(...names, `(${turnstileDefer.toString()})()`)(win, doc, { hostname }, Observer, fn => (timers.push(fn), timers.length), () => {}, Object, Array, Number);
  return { win, listeners, tick: () => timers.forEach(fn => fn()), add: node => observer([{ addedNodes: [node] }]) };
}

const renders = [];
const turnstile = { render: (element, options) => renders.push({ element, options }) };
const hidden = widget({ 'data-sitekey': 'site-key', 'data-action': 'login', 'data-callback': 'onLogin', 'data-cdata': 'x', 'data-response-field': 'false' }, false);
const visible = widget({ 'data-sitekey': 'visible-key' }, true);
const page = run('animeyt.cc', [hidden, visible], { turnstile });
assert.equal(page.win.__lumaTurnstileDefer.deferred, 2, 'todos se retienen mientras se analiza la página');
assert.ok(hidden.classes.has('luma-turnstile-wait') && !hidden.classes.has('cf-turnstile'));

page.listeners.DOMContentLoaded();
assert.ok(visible.classes.has('cf-turnstile'), 'el widget visible se libera al terminar el documento');
assert.equal(renders.length, 1);
assert.equal(renders[0].element, visible);
assert.ok(hidden.classes.has('luma-turnstile-wait'), 'el oculto sigue esperando');

hidden.displayed = true;
page.tick();
assert.equal(renders.length, 2, 'al mostrarse el formulario se renderiza');
const options = renders[1].options;
assert.deepEqual({ sitekey: options.sitekey, action: options.action, cData: options.cData, field: options['response-field'] }, { sitekey: 'site-key', action: 'login', cData: 'x', field: false });
options.callback('token-1');
assert.equal(page.win.token, 'token-1', 'el callback del sitio recibe la respuesta');
assert.equal(page.win.__lumaTurnstileDefer.released, 2);

// Before Turnstile loads, releasing only restores the class: its own scan renders it.
const early = widget({ 'data-sitekey': 'k' }, true);
const before = run('asialiveaction.com', [early]);
before.listeners.DOMContentLoaded();
assert.ok(early.classes.has('cf-turnstile'));

// Widgets added later (a dialog built by script) are also held while hidden.
const later = widget({ 'data-sitekey': 'k' }, false);
before.add(later);
assert.ok(later.classes.has('luma-turnstile-wait'));

// Cloudflare's own frame is never touched.
const challenge = widget({ 'data-sitekey': 'k' }, false);
const frame = run('challenges.cloudflare.com', [challenge]);
assert.equal(frame.win.__lumaTurnstileDefer, undefined);
assert.ok(challenge.classes.has('cf-turnstile'));

console.log('Aplazador de Turnstile: ocultos esperan, visibles y formularios abiertos se renderizan igual, Cloudflare intacto.');
