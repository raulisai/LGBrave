import assert from 'node:assert/strict';
import { devtoolsQuiet } from './devtools-quiet.mjs';

function run(hostname) {
  const calls = [];
  const consoleDouble = {};
  for (const name of ['log', 'table', 'dir', 'clear', 'warn']) consoleDouble[name] = (...args) => calls.push([name, args]);
  const win = {};
  new Function('window', 'console', 'location', 'Object', `(${devtoolsQuiet.toString()})()`)(win, consoleDouble, { hostname }, Object);
  return { consoleDouble, calls, win };
}

// Bait objects like disable-devtool's: they only "fire" if the console serializes them.
const page = run('framextv.cc');
let fired = 0;
const bait = { get id() { fired++; return 'x'; }, toString() { fired++; return ''; } };
page.consoleDouble.log(bait); page.consoleDouble.table([bait]); page.consoleDouble.dir(bait); page.consoleDouble.clear(); page.consoleDouble.warn(bait);
assert.equal(page.calls.length, 0, 'las llamadas a console no llegan al navegador');
assert.equal(fired, 0, 'el señuelo no se activa');
assert.equal(page.win.__lumaConsoleQuiet, true);
assert.equal(typeof page.consoleDouble.log, 'function', 'console sigue siendo llamable');

const second = run('framextv.cc');
const again = second.consoleDouble.log;
assert.equal(again(), undefined);

const challenge = run('challenges.cloudflare.com');
challenge.consoleDouble.log('x');
assert.equal(challenge.calls.length, 1, 'la verificación de Cloudflare no se toca');
assert.equal(challenge.win.__lumaConsoleQuiet, undefined);
console.log('Consola silenciada en páginas web: el señuelo anti-depurador no se activa y Cloudflare queda intacto.');
