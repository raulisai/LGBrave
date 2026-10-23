// One TV interceptor. Short playback samples, never full-episode coverage.
// Stop npm run lab first; use scripts/passive-inspect.mjs for the endpoint.
// Optional second argument restores the page saved before earlier diagnostics.
import {mkdirSync, writeFileSync} from 'node:fs';
import {connectTV, waitFor} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';

const directory='evidence/jkanime';mkdirSync(directory,{recursive:true});
const c=await connectTV(process.argv[2]);
const originalURL=process.argv[3] || await c.evaluate('location.href');
const b=await new BrowserBridge(c).start();
const searchEngine=b.preferences.searchEngine;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const bounded=async(p,ms=6000)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic deadline')),ms)})]);}finally{clearTimeout(timer)}};
const report={capturedAt:new Date().toISOString(),scope:'Three short TV playback samples; not entire episodes, all servers or universal ad coverage.',samples:[],errors:[]};
const save=()=>writeFileSync(`${directory}/validation.json`,JSON.stringify(report,null,2));
const snapshot=`({url:location.href.split('?')[0],guard:window.__lumaNavigationShield||null,qrAds:[...document.querySelectorAll('iframe')].filter(i=>{try{return /Scan the qr-code with your phone/i.test(i.contentDocument?.body?.textContent||'')}catch{return false}}).length,video:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ready:v.readyState,error:v.error?.code||null,decoded:v.getVideoPlaybackQuality?.().totalVideoFrames||0}))})`;
const frames=async()=> (await Promise.all([...b.contexts].filter(([,x])=>x.auxData?.isDefault).map(async([id])=>{try{return {id,...await bounded(c.evaluate(snapshot,id),2500)}}catch{return null}}))).filter(Boolean);
const click=async({x,y})=>{
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
 await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
};
const watchdog=setTimeout(()=>{report.errors.push('Overall deadline');save();c.close()},210000);
try{
 for(const [index,path] of ['/one-piece/1180','/one-piece/1179','/hyouken-no-majutsushi-ga-sekai-wo-suberu-ii/3/'].entries()){
  const sample={path};report.samples.push(sample);const start=b.records.length;
  await bounded(b.command({action:'navigate',value:'https://jkanime.net'+path}),20000);
  await waitFor(async()=>{const f=await frames();return f.some(x=>x.video.some(v=>v.ready>=2))},25000);
  // The baseline ad arrived after the initial load; don't sample only first paint.
  await sleep(18000);
  sample.afterDelay=await frames();save();console.log(JSON.stringify({path,stage:'delayed-load',qrAds:sample.afterDelay.reduce((n,f)=>n+f.qrAds,0)}));
  if(index===0){
   // Exercise the fallback even though the confirmed loader is now blocked.
   // This fixture uses no live ad destination and leaves login/player QR intact.
   await c.evaluate(`(()=>{
    const make=()=>{const i=document.createElement('iframe');i.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2147483646';document.body.append(i);return i};
    window.__qrAdFixture=make();window.__qrLoginFixture=make();
    __qrLoginFixture.contentDocument.body.textContent='Scan this QR to log in to your account';
    __qrLoginFixture.contentDocument.body.append(document.createElement('canvas'));
    setTimeout(()=>{__qrAdFixture.contentDocument.body.textContent="Confirm you're not a robot. Scan the qr-code with your phone";__qrAdFixture.contentDocument.body.append(document.createElement('canvas'))},100);
   })()`);
   await sleep(500);
   sample.fallback=await c.evaluate(`({adRemoved:!__qrAdFixture.isConnected,loginPreserved:__qrLoginFixture.isConnected,guard:window.__lumaNavigationShield})`);
   await c.evaluate(`__qrLoginFixture.remove();delete window.__qrAdFixture;delete window.__qrLoginFixture`);
  }
  const media=(await frames()).find(f=>f.video.length);
  if(!media)throw Error('No player video');
  await c.evaluate(`document.querySelector('video').muted=true`,media.id);
  const local=await c.evaluate(`(()=>{const r=document.querySelector('.dplayer-play-icon').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,height:innerHeight}})()`,media.id);
  const rect=await c.evaluate(`document.querySelector('iframe.player_conte').getBoundingClientRect().toJSON()`);
  await click({x:rect.x+local.x*rect.width/local.width,y:rect.y+local.y*rect.height/local.height});
  await sleep(5000);sample.before=await frames();
  await sleep(5000);sample.after=await frames();
  const first=sample.before.find(f=>f.id===media.id)?.video[0];
  const last=sample.after.find(f=>f.id===media.id)?.video[0];
  sample.playbackPass=!!(first&&last&&!last.error&&!last.paused&&last.time>first.time+1&&last.decoded>first.decoded);
  if(sample.playbackPass){
   await c.evaluate(`document.querySelector('video').currentTime=60`,media.id);
   await sleep(4500);sample.seek=await frames();
   const seek=sample.seek.find(f=>f.id===media.id)?.video[0];
   sample.seekPass=!!(seek&&!seek.error&&!seek.paused&&seek.time>61);
  }
  sample.blocked=b.records.slice(start).filter(r=>r.blocked);
  sample.qrAbsent=[sample.afterDelay,sample.before,sample.after,sample.seek||[]].every(stage=>stage.every(f=>f.qrAds===0));
  await c.evaluate(`document.querySelector('video')?.pause()`,media.id);
  const shot=await bounded(c.call('Page.captureScreenshot',{format:'png'}));
  writeFileSync(`${directory}/sample-${index+1}.png`,Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify({path,playback:sample.playbackPass,seek:sample.seekPass,qrAbsent:sample.qrAbsent,blocked:sample.blocked.length}));save();
 }
}catch(e){report.errors.push(e.message);console.error(e.message)}finally{
 clearTimeout(watchdog);
 try{
  if(b.preferences.searchEngine!==searchEngine)await b.command({action:'set-search-engine',value:searchEngine});
  if(/^https?:/.test(originalURL))await bounded(b.command({action:'navigate',value:originalURL}),15000);
  else if(originalURL.endsWith('/com.lgapp.lab/index.html'))await b.command({action:'home'});
  report.restored={url:(await bounded(c.evaluate('location.href'))).split('?')[0],searchEngine:b.preferences.searchEngine};
 }catch(e){report.errors.push('Restore: '+e.message)}
 report.bridgeErrors=b.errors;save();await bounded(b.stop()).catch(()=>{});c.close();
}
if(report.errors.length||report.samples.length!==3||report.samples.some(s=>!s.playbackPass||!s.seekPass||!s.qrAbsent)||!report.samples[0]?.fallback?.adRemoved||!report.samples[0]?.fallback?.loginPreserved)process.exitCode=1;
