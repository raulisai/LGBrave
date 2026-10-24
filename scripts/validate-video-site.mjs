// Controlled public-site regression, muted. One interceptor only.
// node scripts/validate-video-site.mjs http://localhost:PORT [desktop|tv]
import {mkdirSync,writeFileSync} from 'node:fs';
import {connectTV,waitFor} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
const platform=process.argv[3]||'tv';
const directory=`evidence/cuevana/${platform}`;mkdirSync(directory,{recursive:true});
const c=await connectTV(process.argv[2]);const b=await new BrowserBridge(c).start();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={capturedAt:new Date().toISOString(),platform,scope:'Short playback samples, not entire movies or universal compatibility.',movies:[],errors:[]};
const save=()=>writeFileSync(`${directory}/validation.json`,JSON.stringify(report,null,2));
const bounded=async(p,ms=5000)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic deadline')),ms)})]);}finally{clearTimeout(timer)}};
const snapshotCode=`({url:location.href.split('?')[0],title:document.title,guard:window.__lumaNavigationShield||null,adOverlays:[...document.querySelectorAll('iframe')].filter(i=>!i.src&&i.style.position==='fixed').length,video:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,ready:v.readyState,error:v.error?.code||null,decoded:v.getVideoPlaybackQuality?.().totalVideoFrames||0})),frames:[...document.querySelectorAll('iframe')].map(i=>i.src.split('?')[0])})`;
async function frames(){return (await Promise.all([...b.contexts].filter(([,ctx])=>ctx.auxData?.isDefault).map(async([id])=>{try{return {id,...await bounded(c.evaluate(snapshotCode,id),2500)}}catch{return null}}))).filter(Boolean)}
async function gesture(code,id){const r=await bounded(c.call('Runtime.evaluate',{expression:code,contextId:id,userGesture:true,awaitPromise:true,returnByValue:true}));if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value}
const mute=(await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){this.muted=true;return play.apply(this,arguments)}})()`})).identifier;
const watchdog=setTimeout(()=>{report.errors.push('Overall deadline');save();c.close();process.exitCode=1},240000);
try{
 for(const slug of ['omaha','bad-apples','solomamma']){
  const item={slug,stages:[]};report.movies.push(item);save();
  const base=b.records.length;
  try{
   await bounded(b.command({action:'navigate',value:`https://cuevana3c.pro/pelicula/${slug}`}),20000);
   await waitFor(async()=>await bounded(c.evaluate(`document.querySelector('.video-play')&&location.pathname.includes('/pelicula/')`)),25000);
   item.stages.push({stage:'detail',frames:await frames()});save();
   await c.evaluate(`document.querySelector('.video-play').scrollIntoView({block:'center',behavior:'instant'})`);
   await sleep(700);
   const rect=await c.evaluate(`(()=>{const r=document.querySelector('.video-play').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1});
   await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1});
   await sleep(5000);
   item.stages.push({stage:'player',frames:await frames()});save();
   let media;
   await waitFor(async()=>{const all=await frames();media=all.find(f=>f.video.length);return media},25000);
   const playButton=await gesture(`(()=>{document.querySelector('video').muted=true;const e=document.querySelector('.jw-icon-display');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`,media.id);
   if(playButton?.width){
    item.playMethod='player-button';
    // The lighter player fills the viewport, so its local coordinates are the
    // TV viewport coordinates. No direct media.play() bypass of its controls.
    const {x,y}=playButton;
    item.playButton=playButton;
    await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await sleep(250);
    await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
   } else item.playMethod='already-playing';
   await sleep(6000);item.before=await frames();save();
   await sleep(5000);item.after=await frames();
   const initial=item.before.find(f=>f.id===media.id)?.video[0];const final=item.after.find(f=>f.id===media.id)?.video[0];
   item.playbackPass=!!(initial&&final&&!final.error&&!final.paused&&final.time>initial.time+1&&final.decoded>initial.decoded);
   if(item.playbackPass){
    await gesture(`(()=>{const v=document.querySelector('video');v.currentTime=Math.min(60,v.duration/2);return true})()`,media.id);
    await sleep(5000);item.seek=await frames();
    const sought=item.seek.find(f=>f.id===media.id)?.video[0];
    item.seekPass=!!(sought&&!sought.error&&!sought.paused&&sought.time>Math.min(60,sought.duration/2)+1);
   }
   item.blocked=b.records.slice(base).filter(r=>r.blocked);item.blockedNavigations=b.blockedNavigations;
   const shot=await bounded(c.call('Page.captureScreenshot',{format:'png'}));writeFileSync(`${directory}/${slug}.png`,Buffer.from(shot.data,'base64'));
   console.log(JSON.stringify({slug,playbackPass:item.playbackPass,before:initial,after:final,blocked:item.blocked.length}));save();
  }catch(e){item.error=e.message;item.records=b.records.slice(base);save();console.log(JSON.stringify({slug,error:e.message}));
   // A replaced or frozen target invalidates further TV tests. Do not repeatedly
   // trigger video starts against a renderer that no longer answers.
   try{await bounded(c.evaluate('location.href'),2000)}catch{throw Error('Target no longer responsive; stop playback tests')}
  }
 }
}catch(e){report.errors.push(e.message)}finally{
 clearTimeout(watchdog);report.bridgeErrors=b.errors;save();
 await bounded(c.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:mute}),2000).catch(()=>{});
 await bounded(b.stop(),3000).catch(()=>{});c.close();
}
