import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
const origin = process.env.LAB_ORIGIN || 'http://192.168.1.148:43187';
const cdp = await connectTV(process.argv[2]);
try {
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Fetch.disable');
  await waitFor(() => cdp.evaluate('window.__lumaReady && typeof window.__lumaRunNative === "function"'), 10000);
  await fetch(`${origin}/lab-reset`, { method: 'POST' });
  // Solo observación por CDP. No hay Fetch.enable ni motor Node en esta prueba.
  await cdp.evaluate('window.__nativeValidationFinished=false;window.__lumaRunNative().then(r=>{window.__nativeValidationReport=r;window.__nativeValidationFinished=true}).catch(e=>{window.__nativeValidationError=String(e);window.__nativeValidationFinished=true})');
  await waitFor(() => cdp.evaluate('window.__nativeValidationFinished'), 60000);
  const result = await cdp.evaluate('({error:window.__nativeValidationError,report:window.__nativeValidationReport})');
  if (result.error) throw Error(result.error);
  const logs = await (await fetch(`${origin}/lab-log`)).json();
  const initialAds = logs.filter(item => item.path.startsWith('/ad-fixture/') && item.path !== '/ad-fixture/allowed.js' && item.run === 'native');
  const leakedLateAds = logs.filter(item => item.path === '/ad-fixture/late-fetch');
  const allowedLate = logs.filter(item => item.path === '/content-fixture/late-fetch');
  const report = { capturedAt: new Date().toISOString(), mode: 'TV autónoma: WASM y hooks JavaScript; CDP solo observa', ...result.report, serverRequests: logs, metrics: {
    initialAdRequestsReachingServer: initialAds.length,
    initialAdRequestsExpected: 7,
    initialNetworkBlockingPercentage: Math.round(100 * (7 - initialAds.length) / 7),
    lateFetchBlocked: leakedLateAds.length === 0,
    lateAllowedFetchPreserved: allowedLate.length === 1
  } };
  writeFileSync('evidence/browser-lab/native-validation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.cases.every(test => test.pass), true);
  assert.equal(report.after.visibleAds, 0);
  assert.equal(report.after.editorialVisible, true);
  assert.equal(leakedLateAds.length, 0);
  assert.equal(allowedLate.length, 1);
  assert.equal(initialAds.length, 7, 'La prueba debe registrar que los recursos iniciales NO se interceptan.');
  await fetch(`${origin}/lab-reset`, { method: 'POST' });
  await cdp.evaluate('window.__prefilterFinished=false;window.__lumaRunPrefilter().then(r=>{window.__prefilterReport=r;window.__prefilterFinished=true}).catch(e=>{window.__prefilterError=String(e);window.__prefilterFinished=true})');
  await waitFor(() => cdp.evaluate('window.__prefilterFinished'), 20000);
  const prefilter = await cdp.evaluate('({error:window.__prefilterError,report:window.__prefilterReport})');
  if (prefilter.error) throw Error(prefilter.error);
  const prefilterLogs = await (await fetch(`${origin}/lab-log`)).json();
  const leaked = prefilterLogs.filter(item => item.path.startsWith('/ad-fixture/') && item.path !== '/ad-fixture/allowed.js');
  const allowed = prefilterLogs.filter(item => item.path.startsWith('/content-fixture/') || item.path === '/ad-fixture/allowed.js');
  const prefilterReport = { capturedAt: new Date().toISOString(), ...prefilter.report, serverRequests: prefilterLogs, metrics: { adRequestsReachingServer: leaked.length, expectedAdRequests: 7, blockedPercentage: Math.round(100*(7-leaked.length)/7), legitimateRequestsPreserved: allowed.length, expectedLegitimateRequests: 8 } };
  writeFileSync('evidence/browser-lab/native-prefilter-validation.json', JSON.stringify(prefilterReport, null, 2));
  console.log('Prefiltrado autónomo:', prefilterReport.metrics);
  assert.equal(leaked.length, 0);
  assert.equal(allowed.length, 8);
  assert.equal(prefilterReport.visibleAds, 0);
  assert.equal(prefilterReport.goodScript, true);
} finally { cdp.close(); }
