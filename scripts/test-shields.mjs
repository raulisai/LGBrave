import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createEngine, checkRequest } from './filter-engine.mjs';
import {scriptletSource} from './browser-bridge.mjs';

const engine = createEngine({});
const page = 'https://www.youtube.com/watch?v=lab';
const resources = engine.urlCosmeticResources(page);
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };

check('Scriptlet de YouTube generado por el motor', () => assert.ok(resources.injected_script.includes('youtubeShield')));
check('Selectores cosméticos de YouTube', () => {
  // Quick Fixes deliberately exempts #player-ads upstream (uAssets #27415).
  // Assert stable ad selectors; CSS exceptions must keep their normal priority.
  for (const selector of ['ytd-ad-slot-renderer', 'ytd-enforcement-message-view-model']) assert.ok(resources.hide_selectors.includes(selector), selector);
});
check('Sin scriptlet de YouTube en otros sitios', () => assert.ok(!engine.urlCosmeticResources('https://example.com/').injected_script.includes('youtubeShield')));
for (const [url, type, expected] of [
  ['https://www.youtube.com/api/stats/ads?ver=2', 'XHR', true],
  ['https://www.youtube.com/pagead/viewthroughconversion/1', 'Image', true],
  ['https://www.youtube.com/ptracking?pltype=content', 'Image', true],
  ['https://www.youtube.com/youtubei/v1/player?prettyPrint=false', 'Fetch', false],
  ['https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1', 'Media', false],
  ['https://www.youtube.com/s/player/abc/player_ias.vflset/es_ES/base.js', 'Script', false]
]) check(`${expected ? 'Bloquea' : 'Permite'} ${new URL(url).pathname}`, () => assert.equal(checkRequest(engine, url, page, type).should_block, expected, url));

// Run the real scriptlet in a minimal browser-like sandbox.
class FakeResponse { constructor(body) { this.body = body; } text() { return Promise.resolve(this.body); } json() { return Promise.reject(Error('original json')); } }
class FakeXHR { get response() { return this._value; } }
const sandbox = { Response: FakeResponse, XMLHttpRequest: FakeXHR, setInterval: () => 0, isFinite, document: { hidden: true, querySelector: () => null, querySelectorAll: () => [] } };
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(scriptletSource(resources.injected_script), sandbox);
vm.runInContext('var ytInitialPlayerResponse = { videoDetails: { videoId: "lab" }, adPlacements: [1], playerAds: [1], adSlots: [1] };', sandbox);
check('Respuesta inicial del reproductor sin anuncios', () => assert.deepEqual(Object.keys(vm.runInContext('ytInitialPlayerResponse', sandbox)), ['videoDetails']));
const parsed = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({
  playerResponse: { adPlacements: [1], streamingData: {} },
  contents: { richGridRenderer: { contents: [{ richItemRenderer: { content: { videoRenderer: {} } } }, { richItemRenderer: { content: { adSlotRenderer: {} } } }] } }
}))})`, sandbox);
check('JSON.parse limpia reproductor y feed', () => {
  assert.deepEqual(Object.keys(parsed.playerResponse), ['streamingData']);
  assert.equal(parsed.contents.richGridRenderer.contents.length, 1);
});
// Objects come from another realm: compare their JSON.
check('JSON normal intacto', () => assert.equal(JSON.stringify(vm.runInContext('JSON.parse(\'{"adPlacementsLike":1,"a":[1]}\')', sandbox)), '{"adPlacementsLike":1,"a":[1]}'));
const fetched = await vm.runInContext(`new Response(${JSON.stringify(JSON.stringify({ adSlots: [1], playerAds: [1], videoDetails: {} }))}).json()`, sandbox);
check('Response.json limpia /player', () => assert.deepEqual(Object.keys(fetched), ['videoDetails']));
const xhr = vm.runInContext('const x = new XMLHttpRequest(); x.responseType = "json"; x._value = { adPlacements: [1], ok: true }; x.response', sandbox);
check('XHR con responseType json limpio', () => assert.deepEqual(Object.keys(xhr), ['ok']));
vm.runInContext(scriptletSource(resources.injected_script), sandbox);
check('Inyección repetida sin efectos', () => assert.equal(JSON.stringify(vm.runInContext('JSON.parse(\'{"adSlots":[1],"b":2}\')', sandbox)), '{"b":2}'));

console.log(`${checks.length} comprobaciones de YouTube y reglas propias correctas.`);
