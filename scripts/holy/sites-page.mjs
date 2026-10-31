// The window «Webs» of the Mac menu: a small self-contained page, served by the service.
export const SITES_PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webs de Holy</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--soft:#6e6e73;--line:#d9d9de;--ok:#1a8f3c;--warn:#c56a00;--bad:#c9302c;--accent:#0a66d8}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1e;--card:#2a2a2d;--text:#f5f5f7;--soft:#a1a1a6;--line:#3d3d41;--ok:#4cd471;--warn:#ffb340;--bad:#ff6b63;--accent:#5aa2ff}}
*{box-sizing:border-box}body{margin:0;padding:20px;background:var(--bg);color:var(--text);font:14px -apple-system,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}p.note{margin:0 0 14px;color:var(--soft)}
.site{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:8px}
.top{display:flex;align-items:center;gap:10px}.dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--soft)}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}
.name{font-weight:600}.meta{margin-left:auto;color:var(--soft);font-size:12px;text-align:right}.url{color:var(--soft);font-size:12px;margin:3px 0 0 20px;word-break:break-all}.msg{margin:4px 0 0 20px;font-size:12px}.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}
.row{display:flex;gap:6px;margin:8px 0 0 20px;flex-wrap:wrap}input{flex:1;min-width:180px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
button{padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;cursor:pointer}button.main{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.5}
</style></head><body>
<h1>Webs de Holy</h1><p class="note">Sitios de donde salen las películas y series. Si uno cambia de dirección, actualízala aquí.</p>
<div id="error" class="msg bad"></div>
<h2>Integradas</h2><div id="live"></div>
<h2>Por integrar</h2><p class="note">Se guardan aquí, pero todavía no dan títulos: cada sitio nuevo necesita que se programe su lector.</p><div id="pending"></div>
<div class="site"><div class="name">Agregar web</div><div class="row"><input id="newUrl" placeholder="https://sitio.com/" aria-label="Dirección"><input id="newName" placeholder="Nombre (opcional)" aria-label="Nombre"><button id="add" class="main">Agregar</button></div></div>
<script>
const API='/holy-api/sites',$=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const node=Object.assign(document.createElement(tag),props);node.append(...kids);return node};
const post=async body=>{const response=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'No se pudo.');return data};
const when=at=>at?new Date(at).toLocaleString('es-MX',{dateStyle:'short',timeStyle:'short'}):'nunca';
async function act(button,body,message){button.disabled=true;$('error').textContent='';try{const data=await post(body);await load();return data}catch(error){(message||$('error')).textContent=error.message}finally{button.disabled=false}}
function liveCard(site){
  const tone=!site.health?'':site.health.ok?'ok':site.count?'warn':'bad';
  const msg=el('div',{className:'msg'}),input=el('input',{value:site.site,ariaLabel:'Dirección de '+site.name});
  const check=el('button',{textContent:'Comprobar'}),save=el('button',{textContent:'Guardar dirección',className:'main'});
  check.onclick=async()=>{check.disabled=true;msg.className='msg';msg.textContent='Comprobando…';try{const r=await post({action:'check',url:input.value});msg.className='msg '+(r.ok&&!r.moved?'ok':'bad');msg.textContent=r.moved?'Redirige a '+r.final+' ; probablemente se mudó.':r.ok?'Responde bien ('+r.ms+' ms).':'No responde bien: '+(r.error||'código '+r.status);if(r.moved)input.value=r.final}catch(error){msg.className='msg bad';msg.textContent=error.message}check.disabled=false};
  save.onclick=()=>act(save,{action:'move',id:site.id,url:input.value},msg);
  const row=el('div',{className:'row'},input,check,save);
  if(site.moved){const reset=el('button',{textContent:'Volver a la original'});reset.onclick=()=>act(reset,{action:'reset',id:site.id},msg);row.append(reset)}
  return el('div',{className:'site'},el('div',{className:'top'},el('span',{className:'dot '+tone}),el('span',{className:'name',textContent:site.name}),el('span',{className:'meta',textContent:site.count+' títulos · revisado '+when(site.health?.at)})),
    el('div',{className:site.error?'msg bad':'url',textContent:site.error?'Último fallo: '+site.error:(site.search?'Con búsqueda':'Sin búsqueda')+(site.moved?' · dirección original '+site.original:'')}),row,msg);
}
function pendingCard(site){
  const card=el('div',{className:'site'},el('div',{className:'top'},el('span',{className:'dot'}),el('span',{className:'name',textContent:site.name})),el('div',{className:'url',textContent:site.url+' · '+site.reason}));
  if(!site.known){const remove=el('button',{textContent:'Quitar'});remove.onclick=()=>act(remove,{action:'remove',url:site.url});card.append(el('div',{className:'row'},remove))}
  return card;
}
async function load(){const data=await(await fetch(API,{cache:'no-store'})).json();$('live').replaceChildren(...data.sites.map(liveCard));$('pending').replaceChildren(...data.pending.map(pendingCard))}
$('add').onclick=async()=>{const done=await act($('add'),{action:'add',url:$('newUrl').value,name:$('newName').value});if(done){$('newUrl').value='';$('newName').value=''}};
load().catch(error=>{$('error').textContent='No se pudo leer la lista: '+error.message});
</script></body></html>`;
