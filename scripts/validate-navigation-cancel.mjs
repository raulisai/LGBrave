// Verify cancellation against the real renderer, not just mocked CDP calls.
// Stop the normal bridge first; keep fixtures and inspector running.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTV,waitFor} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
const origin=process.env.LAB_ORIGIN||'http://192.168.1.148:43187';
const c=await connectTV(process.argv[2]);const b=await new BrowserBridge(c,{fixtures:true}).start();
try{
 await b.command({action:'navigate',value:origin+'/simple'});
 await waitFor(()=>c.evaluate(`!!document.querySelector('#fixture-simple')`));
 await c.evaluate(`setTimeout(()=>location.assign('https://luma-navigation-block.invalid/ad'),20)`);
 await waitFor(()=>b.blockedNavigations===1);
 const result={capturedAt:new Date().toISOString(),url:await c.evaluate('location.href'),blockedNavigations:b.blockedNavigations,blocked:b.records.filter(r=>r.blocked)};
 assert.equal(result.url,origin+'/simple');
 assert.equal(await c.evaluate(`!!document.querySelector('#fixture-simple')`),true);
 mkdirSync('evidence/cuevana',{recursive:true});writeFileSync('evidence/cuevana/navigation-abort-tv.json',JSON.stringify(result,null,2));
 console.log('Navegación publicitaria cancelada; página original y diagnóstico siguen respondiendo.');
}finally{await b.stop();c.close()}
