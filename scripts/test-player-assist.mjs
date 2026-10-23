import assert from 'node:assert/strict';
import { playerAssist } from './player-assist.mjs';

// Minimal DOM double: enough for the server list and the Mixdrop click handler.
function run(hostname, { items = [], top = false } = {}) {
  const lis = items.map(link => {
    const classes = new Set(); const label = { textContent: 'Servidor' };
    return { tagName: 'LI', dataset: { link }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), has: c => classes.has(c) }, querySelector: () => label, label };
  });
  const list = { children: lis, dataset: {}, append(li) { this.children = [...this.children.filter(x => x !== li), li]; } };
  const listeners = {};
  const video = { paused: true, plays: 0, play() { this.plays++; return Promise.resolve(); } };
  const win = { top: top ? {} : null };
  win.top = top ? {} : win;
  const doc = { getElementById: id => (id === '_sourceList' ? list : null), querySelector: () => video, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const names = ['location', 'window', 'document', 'MutationObserver', 'URL', 'Object'];
  new Function(...names, `(${playerAssist.toString()})()`)({ hostname }, win, doc, class { observe() {} }, URL, Object);
  return { list, lis, listeners, video };
}

const links = ['https://dr0pstream.com/e/a', 'https://doodstream.com/e/b', 'https://mxdrop.to/e/c', 'https://unlimplay.com/f/embed/movie/tt1'];
const picker = run('playlatinsrc.co', { items: links });
picker.listeners.DOMContentLoaded();
assert.deepEqual(picker.list.children.map(li => li.dataset.link), ['https://mxdrop.to/e/c', 'https://doodstream.com/e/b', 'https://dr0pstream.com/e/a', 'https://unlimplay.com/f/embed/movie/tt1']);
assert.ok(picker.lis[2].classList.has('active') && !picker.lis[0].classList.has('active'));
assert.match(picker.lis[0].label.textContent, /puede cerrar la app/);
assert.doesNotMatch(picker.lis[2].label.textContent, /puede cerrar/);

const only = run('playlatinsrc.co', { items: [links[0]] });
only.listeners.DOMContentLoaded();
assert.equal(only.lis[0].classList.has('active'), false, 'sin alternativa no se cambia la selección');

const frame = run('mxdrop.click', { top: true });
frame.listeners.click({ type: 'click' });
assert.equal(frame.video.plays, 1);
frame.video.paused = false; frame.listeners.click({ type: 'click' });
assert.equal(frame.video.plays, 1, 'no interfiere si ya reproduce');
frame.video.paused = true; frame.listeners.keydown({ type: 'keydown', keyCode: 13 }); frame.listeners.keydown({ type: 'keydown', keyCode: 65 });
assert.equal(frame.video.plays, 2);

assert.equal(Object.keys(run('example.com').listeners).length, 0, 'otros sitios intactos');
console.log('Asistente de reproductores: orden de servidores, Mixdrop y ámbito correctos.');
