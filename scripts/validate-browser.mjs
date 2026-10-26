import {lumaOrigin} from './desktop-config.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
import { BrowserBridge, home, packagedHome } from './browser-bridge.mjs';
import { createEngine, checkRequest } from './filter-engine.mjs';

const endpoint = process.argv[2];
const fixtureOrigin = lumaOrigin();
const directory = 'evidence/browser-lab';
mkdirSync(directory, { recursive: true });
const cdp = await connectTV(endpoint);
const report = { capturedAt: new Date().toISOString(), hardware: 'LG 75UR8750PSA / webOS SDK 10.3.2', autonomous: {}, controlled: {}, engine: {}, realSites: [], errors: [] };
let bridge;
const logEntries = [];
cdp.onEvent(event => { if (event.method === 'Log.entryAdded') logEntries.push(event.params.entry); });
async function screenshot(name) { const result = await cdp.call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${directory}/${name}.png`, Buffer.from(result.data, 'base64')); }
async function navigate(url, expression = 'document.readyState === "complete"') {
  const result = bridge && /^https?:/.test(url) ? (await bridge.command({ action: 'navigate', value: url }), {}) : await cdp.call('Page.navigate', { url });
  if (result.errorText) throw Error(result.errorText);
  await waitFor(() => cdp.evaluate(expression), 20000);
}
async function fixture(run) {
  await navigate(`${fixtureOrigin}/fixture?run=${run}`, 'window.fixtureReady === true');
  await new Promise(resolve => setTimeout(resolve, 700));
  return cdp.evaluate(`({url:location.href, goodScript:window.goodScriptExecuted===true, adScripts:window.adScriptExecuted||0, scriptlet:window.__labScriptlet||null, scriptletBeforePageScript:window.scriptletValue, editorialVisible:getComputedStyle(document.querySelector('#good-content')).display!=='none', visibleAds:[...document.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(n=>getComputedStyle(n).display!=='none').length, cookie:document.cookie})`);
}
try {
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable'); await cdp.call('Log.enable');
  await navigate(packagedHome, 'window.__lumaReady === true');
  await screenshot('safari-home');
  report.autonomous.runtime = await cdp.evaluate(`({userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,chromeWebRequest:typeof window.chrome?.webRequest,chromeDeclarativeNetRequest:typeof window.chrome?.declarativeNetRequest,webviewLoadURL:typeof document.createElement('webview').loadURL,serviceWorkerAPI:!!navigator.serviceWorker,wasm:typeof WebAssembly,webOSBridge:typeof PalmServiceBridge})`);
  report.autonomous.crossOrigin = await cdp.evaluate(`(async()=>{
    const output={}; const frame=document.createElement('iframe');frame.id='probe';frame.src=${JSON.stringify(fixtureOrigin + '/simple')};document.body.append(frame);
    await new Promise(resolve=>{frame.onload=resolve;setTimeout(resolve,2500)});
    try{output.readDOM=!!frame.contentWindow.document.querySelector('h2')}catch(error){output.readDOM=false;output.domError=error.name}
    try{frame.contentWindow.document.head.append(document.createElement('style'));output.injectCSS=true}catch(error){output.injectCSS=false;output.cssError=error.name}
    try{const response=await fetch(${JSON.stringify(fixtureOrigin + '/no-cors')});output.fetchWithoutCORS={success:true,status:response.status}}catch(error){output.fetchWithoutCORS={success:false,error:error.name}}
    frame.remove();return output;
  })()`);
  report.autonomous.framePolicies = { testedSeparately: true, reason: 'La prueba de X-Frame-Options produjo un rechazo explícito y destruyó el contexto. Se aísla para no invalidar las siguientes mediciones.' };
  report.autonomous.policyConsole = logEntries.filter(item => /frame|ancestor|X-Frame|CORS|cross-origin/i.test(item.text)).map(item => ({ text: item.text, level: item.level }));
  await fetch(`${fixtureOrigin}/lab-reset`, { method: 'POST' });
  report.controlled.baseline = await fixture('baseline');
  report.controlled.baselineRequests = await (await fetch(`${fixtureOrigin}/lab-log`)).json();
  await screenshot('fixture-before');
  console.log('Autonomía y línea base registradas.');

  bridge = await new BrowserBridge(cdp, { lists: false, fixtures: true }).start();
  await fetch(`${fixtureOrigin}/lab-reset`, { method: 'POST' });
  bridge.records.length = 0;
  report.controlled.filtered = await fixture('filtered');
  await bridge.refreshCosmetics();
  report.controlled.filtered = { ...report.controlled.filtered, ...await cdp.evaluate(`({visibleAds:[...document.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(n=>getComputedStyle(n).display!=='none').length})`) };
  report.controlled.filteredRequests = await (await fetch(`${fixtureOrigin}/lab-log`)).json();
  report.controlled.decisions = [...bridge.records];
  await screenshot('fixture-after');
  const baselineBlockedCandidates = report.controlled.baselineRequests.filter(item => item.path.startsWith('/ad-fixture/') && item.path !== '/ad-fixture/allowed.js');
  const leaks = report.controlled.filteredRequests.filter(item => item.path.startsWith('/ad-fixture/') && item.path !== '/ad-fixture/allowed.js');
  const baselineAllowed = report.controlled.baselineRequests.filter(item => item.path.startsWith('/content-fixture/') || item.path === '/ad-fixture/allowed.js');
  const filteredAllowed = report.controlled.filteredRequests.filter(item => item.path.startsWith('/content-fixture/') || item.path === '/ad-fixture/allowed.js');
  report.controlled.metrics = {
    expectedAdRequests: baselineBlockedCandidates.length,
    adRequestsReachingServerWithFilter: leaks.length,
    blockedPercentage: baselineBlockedCandidates.length ? Math.round(100 * (baselineBlockedCandidates.length - leaks.length) / baselineBlockedCandidates.length) : null,
    expectedAllowedRequests: baselineAllowed.length,
    allowedRequestsPreserved: filteredAllowed.length,
    visibleAdElementsBefore: report.controlled.baseline.visibleAds,
    visibleAdElementsAfter: report.controlled.filtered.visibleAds,
    scope: 'Solo fixtures controlados; no representa el porcentaje de anuncios de Internet ni la paridad con Brave.'
  };
  assert.equal(baselineBlockedCandidates.length, 7, 'Línea base incompleta');
  assert.equal(leaks.length, 0, 'Fuga de solicitudes en fixtures');
  assert.equal(filteredAllowed.length, baselineAllowed.length, 'Se bloquearon recursos legítimos');
  assert.equal(report.controlled.filtered.goodScript, true);
  assert.equal(report.controlled.filtered.adScripts, 1, 'Debe ejecutarse solo la excepción');
  assert.equal(report.controlled.filtered.visibleAds, 0);
  assert.equal(report.controlled.filtered.editorialVisible, true);
  console.log('Fixtures con filtros:', report.controlled.metrics);

  const engine = createEngine({ lists: true });
  const cases = [
    ['Google Ads script','https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js','https://example.org/','Script',true],
    ['Google Analytics','https://www.google-analytics.com/analytics.js','https://example.org/','Script',true],
    ['DoubleClick','https://googleads.g.doubleclick.net/pagead/ads','https://example.org/','Image',true],
    ['Editorial image','https://example.org/photos/cat.png','https://example.org/','Image',false],
    ['Editorial script','https://example.org/app.js','https://example.org/','Script',false]
  ];
  report.engine.cases = cases.map(([name,url,source,type,expected]) => { const decision=checkRequest(engine,url,source,type); return {name,url,expected,blocked:decision.should_block,pass:decision.should_block===expected}; });
  for (const test of report.engine.cases) assert.equal(test.pass, true, test.name);
  bridge.engine = engine;
  for (const url of ['https://example.com/', 'https://developer.mozilla.org/en-US/', 'https://www.bbc.com/']) {
    bridge.records.length = 0;
    try {
      await navigate(url);
      await new Promise(resolve => setTimeout(resolve, 2500));
      await bridge.refreshCosmetics();
      const state = await cdp.evaluate('({url:location.href,title:document.title,textLength:document.body?.innerText.length||0,toolbar:!!document.getElementById("__luma-toolbar")})');
      const result = { requested: url, ...state, observedRequests: bridge.records.length, blockedRequests: bridge.records.filter(r=>r.blocked).length, decisions: [...bridge.records] };
      report.realSites.push(result);
      await screenshot('site-' + new URL(url).hostname.replaceAll('.', '-'));
      console.log('Sitio real:', state.title, result.blockedRequests, 'bloqueadas');
    } catch (error) { report.realSites.push({ requested: url, error: error.message }); }
  }
  report.bridgeErrors = bridge.errors;
  report.subframesAttached = bridge.subframesAttached;
  await navigate(home, 'window.__lumaReady === true');
  await bridge.status();
  await screenshot('safari-home-connected');
} catch (error) {
  report.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(`${directory}/validation.json`, JSON.stringify(report, null, 2));
  if (bridge) await bridge.stop();
  cdp.close();
}
