import { writeFileSync, mkdirSync } from 'node:fs';

const endpoint = process.argv[2];
const directory = process.argv[3] || 'evidence/runtime';
if (!endpoint || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint)) {
  throw Error('Indica el origen local de ares-inspect, por ejemplo http://localhost:57545');
}
mkdirSync(directory, { recursive: true });
const tabs = await (await fetch(`${endpoint}/json`)).json();
const tab = tabs.find(item => item.url?.includes('/com.lgapp.lab/'));
if (!tab) throw Error('LG Lab no aparece en el inspector; vuelve a lanzarla.');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params);
  const promise = pending.get(message.id);
  if (promise) {
    pending.delete(message.id);
    message.error ? promise.reject(message.error) : promise.resolve(message.result);
  }
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const current = ++id;
    pending.set(current, { resolve, reject });
    ws.send(JSON.stringify({ id: current, method, params }));
    setTimeout(() => {
      if (pending.delete(current)) reject(Error(`DevTools timeout: ${method}`));
    }, 10000).unref();
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const key = (code, name) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({ key: name, keyCode: code, bubbles: true })}))`);
try {
  await call('Runtime.enable');
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await evaluate("!!document.querySelector('h1')")) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const before = await evaluate('({title:document.title,text:document.body?.innerText || "",width:innerWidth,height:innerHeight,userAgent:navigator.userAgent})');
  if (!before.text.includes('Tu pantalla.')) throw Error('La interfaz no se renderizó.');
  const initialCount = Number(await evaluate("document.querySelector('.readout strong').textContent"));
  await key(13, 'Enter');
  const count = Number(await evaluate("document.querySelector('.readout strong').textContent"));
  if (count !== initialCount + 1) throw Error('Falló OK.');
  await key(39, 'ArrowRight');
  await key(13, 'Enter');
  if (!await evaluate("!!document.querySelector('.pattern')")) throw Error('Falló patrón de color.');
  await key(461, 'Back');
  if (await evaluate("!!document.querySelector('.pattern')")) throw Error('Falló Atrás.');
  await key(37, 'ArrowLeft');
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${directory}/app-tv.png`, Buffer.from(screenshot.data, 'base64'));
  const report = {
    capturedAt: new Date().toISOString(), before,
    checks: { rendered: true, enter: true, arrows: true, colorPattern: true, back: true },
    exceptionsDuringCheck: exceptions,
    note: 'Teclas simuladas mediante DevTools. Control físico pendiente.'
  };
  writeFileSync(`${directory}/app-runtime.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  ws.close();
}
// Algunos inspectores de TV no completan el cierre del WebSocket.
// Los artefactos anteriores ya se escribieron de forma síncrona.
process.exit(0);
