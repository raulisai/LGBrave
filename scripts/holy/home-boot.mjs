import {homeAddressMatches} from './home-address.mjs';

// Runs at document start in the bridge's isolated world. It survives the old
// player's teardown by painting again in the new document before Svelte loads.
export function holyHomeBoot(homes, matches) {
  if (window.top !== window || !homes.some(home => matches(location.href, home)) || window.__holyHomeBoot) return;
  Object.defineProperty(window, '__holyHomeBoot', {value:true});
  let host, observer, finished=false, visibleFrames=0;
  const blockBack=event=>{if(!finished && [461,27].includes(event.keyCode)){event.preventDefault();event.stopImmediatePropagation();}};
  addEventListener('keydown',blockBack,true);
  const draw=()=>{
    if(host||!document.documentElement)return;
    host=document.createElement('holy-returning');
    host.style.cssText='position:fixed;inset:0;z-index:2147483647;display:block;pointer-events:none';
    const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');
    style.textContent='.w{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:24px;background:#101013;color:#fff;font:500 32px system-ui,Arial,sans-serif}.r{width:42px;height:42px;border:4px solid #ffffff30;border-top-color:#e50914;border-radius:50%;animation:holy-return-spin .8s linear infinite}@keyframes holy-return-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.r{animation:none}}';
    const wrap=document.createElement('div');wrap.className='w';wrap.setAttribute('role','status');
    const ring=document.createElement('span');ring.className='r';ring.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent='Cargando el inicio…';
    wrap.append(ring,label);root.append(style,wrap);document.documentElement.append(host);
  };
  const ready=()=>{
    if(finished)return;
    draw();
    const header=document.querySelector('#app .app header');
    const rect=header?.getBoundingClientRect();
    // A timer or load event is insufficient: wait for the actual menu, including
    // older installed IPKs which do not expose a dedicated ready binding.
    if(rect?.width>0 && rect.height>0 && header.textContent.trim().length>8)visibleFrames++;
    else visibleFrames=0;
    if(visibleFrames>=2){
      finished=true;host?.remove();observer?.disconnect();removeEventListener('keydown',blockBack,true);
      if(document.documentElement)document.documentElement.dataset.holyHomePainted=String(performance.now());
      return;
    }
    requestAnimationFrame(ready);
  };
  observer=new MutationObserver(draw);observer.observe(document,{childList:true,subtree:true});
  draw();requestAnimationFrame(ready);
}
export const homeBootSource=homes=>`(${holyHomeBoot.toString()})(${JSON.stringify(homes)},${homeAddressMatches.toString()});`;
