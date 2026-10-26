(()=>{
 if(globalThis.__holyCompanionRunning)return;globalThis.__holyCompanionRunning=true;
 let session=null,checks=0,video=null,resumed=false,last=0,lastPosition=null;
 const select=()=>[...document.querySelectorAll('video')].filter(v=>{const r=v.getBoundingClientRect(),s=getComputedStyle(v);return r.width>=160&&r.height>=90&&s.visibility!=='hidden'&&s.display!=='none'&&Number.isFinite(v.duration)&&v.duration>=60;}).sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
 const send=()=>{if(!video||!Number.isFinite(video.duration))return;if(lastPosition!==null&&Math.abs(lastPosition-video.currentTime)<0.4)return;const position=video.currentTime;const r=video.getBoundingClientRect();chrome.runtime.sendMessage({type:'progress',value:{t:video.currentTime,d:video.duration,area:r.width*r.height}}).then(result=>{if(result?.ok)lastPosition=position;}).catch(()=>{});};
 const tick=async()=>{
  if(!session){try{const s=await chrome.runtime.sendMessage({type:'session'});if(s?.ok)session=s;}catch{}if(!session&&++checks>60){clearInterval(timer);globalThis.__holyCompanionRunning=false;return;}}
  if(!session)return;const next=select();if(next!==video){if(video)for(const e of['pause','ended','seeked'])video.removeEventListener(e,send);video=next;if(video)for(const e of['pause','ended','seeked'])video.addEventListener(e,send);}
  if(!video)return;
  if(!resumed&&video.readyState>=1){resumed=true;if(session.resumeAt>20&&session.resumeAt<video.duration-4&&video.currentTime<15){try{video.currentTime=session.resumeAt;}catch{resumed=false;}}}
  if(Date.now()-last>=5000){last=Date.now();send();}
 };
 const timer=setInterval(()=>tick().catch(()=>{}),1000);window.addEventListener('pagehide',send);tick().catch(()=>{});
})();