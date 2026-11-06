import {readFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT} from './desktop-config.mjs';

// The permanent monthly connection log, summarised: time in each state, every cut with its
// cause, why the service stopped and how long the computer slept. `npm run desktop:log [días]`.
export function readConnection(dir, since) {
  let names=[];try{names=readdirSync(dir).filter(name=>/^connection-\d{4}-\d{2}\.jsonl$/.test(name)).sort();}catch{}
  return names.flatMap(name=>readFileSync(join(dir,name),'utf8').split('\n').flatMap(line=>{try{return line?[JSON.parse(line)]:[];}catch{return [];}}))
    .filter(row=>Date.parse(row.at)>=since).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
}
export function summarize(rows, until=Date.now()) {
  const states={},cuts=[],stops={},exits={};let slept=0,current=null;
  const close=at=>{if(current){states[current.state]=(states[current.state]||0)+Math.max(0,at-current.at);}};
  for(const row of rows){
    const at=Date.parse(row.at);
    if(row.component==='connection'&&row.event==='state'){
      if(current?.state==='connected'&&row.state!=='connected')cuts.push({at:row.at,state:row.state,code:row.code||'',error:row.error?.message||''});
      close(at);current={state:row.state,at};
    }else if(row.component==='service'&&row.event==='stopping'){close(at);current=null;stops[row.reason||'sin motivo']=(stops[row.reason||'sin motivo']||0)+1;}
    else if(row.component==='service'&&row.event==='worker-exit'){exits[row.code||'?']=(exits[row.code||'?']||0)+1;}
    else if(row.component==='service'&&row.event==='resumed')slept+=row.durationMs||0;
  }
  close(until);
  return {states,cuts,stops,exits,slept};
}
const minutes=ms=>Math.round(ms/60000);
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const days=Math.max(1,Number(process.argv[2])||7),since=Date.now()-days*86400000;
  const rows=readConnection(join(process.env.HOLY_LOG_DIR||join(ROOT,'.local','logs')),since);
  if(!rows.length){console.log(`Sin registro de conexión en los últimos ${days} días (se guarda desde 0.9.23).`);process.exit(0);}
  const {states,cuts,stops,exits,slept}=summarize(rows);
  console.log(`Conexión con la TV · últimos ${days} días · ${rows.length} eventos`);
  console.log('Minutos por estado: '+Object.entries(states).sort((a,b)=>b[1]-a[1]).map(([state,ms])=>`${state} ${minutes(ms)}`).join(' · '));
  console.log(`Suspensión del equipo: ${minutes(slept)} min · paradas: ${Object.entries(stops).map(([k,v])=>`${k} ${v}`).join(', ')||'ninguna'} · salidas del servicio: ${Object.entries(exits).map(([k,v])=>`código ${k} ×${v}`).join(', ')||'ninguna'}`);
  console.log(cuts.length?`Cortes de una conexión activa (${cuts.length}):`:'Ningún corte de una conexión activa.');
  for(const cut of cuts.slice(-20))console.log(`  ${new Date(cut.at).toLocaleString('es-MX')} → ${cut.state}${cut.code?' ['+cut.code+']':''} ${cut.error}`);
}
