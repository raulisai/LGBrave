import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTV,waitFor} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
const origin=process.env.LAB_ORIGIN||'http://192.168.1.148:43187';
const c=await connectTV(process.argv[2]);const b=await new BrowserBridge(c,{lists:false,fixtures:true}).start();
const run='cuevana-regression-'+Date.now();
try{
 await b.command({action:'navigate',value:origin+'/fixture?run='+run});
 await waitFor(()=>c.evaluate('window.fixtureReady===true'));
 await new Promise(r=>setTimeout(r,700));await b.refreshCosmetics();
 const delivered=(await(await fetch(origin+'/lab-log')).json()).filter(r=>r.run===run);
 const rejected=b.records.filter(r=>r.blocked&&r.url.includes('/ad-fixture/'));
 const result={scope:"Isolated fixture rules, matching original regression; active lists separately respect generichide on private IPs.",capturedAt:new Date().toISOString(),blocked:rejected.length,legitimate:delivered.filter(r=>r.path.startsWith('/content-fixture/')||r.path==='/ad-fixture/allowed.js').length,adsDelivered:delivered.filter(r=>r.path.startsWith('/ad-fixture/')&&r.path!=='/ad-fixture/allowed.js'),page:await c.evaluate(`({good:window.goodScriptExecuted,exception:window.adScriptExecuted,earlyScriptlet:window.scriptletValue,visibleIds:[...document.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(n=>getComputedStyle(n).display!=='none').map(n=>({id:n.id,cls:n.className})),ads:[...document.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(n=>getComputedStyle(n).display!=='none').length})`)};
 mkdirSync('evidence/cuevana',{recursive:true});writeFileSync('evidence/cuevana/fixture-regression.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert.equal(result.blocked,7);assert.equal(result.legitimate,8);assert.equal(result.adsDelivered.length,0);assert.equal(result.page.ads,0);assert.equal(result.page.good,true);assert.equal(result.page.exception,1);assert.equal(result.page.earlyScriptlet,'injected');

}finally{await b.stop();c.close()}
