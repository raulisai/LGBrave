import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {CONNECTORS} from './holy/connectors.mjs';import {Catalog} from './holy/catalog.mjs';import {fetchText} from './holy/sources.mjs';import {redact} from './diagnostics.mjs';
const directory=mkdtempSync(join(tmpdir(),'holy-provider-check-'));
const report={v:1,at:new Date().toISOString(),scope:'Lectura HTTP y resolución de muestras. Sin reproducir vídeo, tocar TV o cambiar biblioteca/servicios.',sites:[]};
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
if(only&&!CONNECTORS.some(c=>c.id===only))throw Error('Fuente desconocida.');
async function check(connector){
 const started=Date.now(),row={source:connector.id,ok:false,samples:[]};
 const loader=(url,options={})=>{const left=45000-(Date.now()-started);if(left<=0)throw Error('Plazo agotado de45s.');return fetchText(url,{referrer:connector.site,...options,timeout:Math.min(12000,left)});};
 const catalog=new Catalog({file:join(directory,connector.id+'.json'),detailsFile:join(directory,connector.id+'-details.json'),connectors:[connector],knownLists:null,fetch:loader});
 try{
  const items=await(connector.home?connector.home(loader):loader(connector.site).then(html=>connector.parseHome(html,connector.site)));
  row.titles=items.length;let samples=items.filter(i=>!i.isShow).slice(0,connector.id==='doramasmp4'?2:1);
  if(!samples.length){const show=items.find(i=>i.show&&connector.episodes);if(show){const seasons=await connector.episodes(show.show,loader),episode=seasons.flatMap(s=>s.episodes)[0];if(episode)samples=[{...show,...episode,isShow:false}];}}
  if(connector.id==='doramasflix')samples=[{source:connector.id,title:'Between Steps5 español',kind:'dorama',show:'https://doramasflix.io/doramas/between-steps',url:'https://doramasflix.io/capitulos/between-steps-1x5',episode:5}];
  if(connector.id==='doramasmp4')samples.push({source:connector.id,title:'Between Steps5',kind:'dorama',show:'https://doramasmp4.cyou/series/between-steps/',url:'https://doramasmp4.cyou/cap/between-steps-capitulo-5/',episode:5});
  if(!samples.length)throw Error('Sin muestra de episodios/películas.');
  for(const item of samples){
   const sample={title:item.title,ok:false};
   try{
    const target=await catalog.resolve(item,connector.id==='doramasflix'?{kind:'dub'}:{});
    if(!target?.url)throw Error('La página no entregó un enlace de reproductor.');
    sample.host=new URL(target.url).hostname;sample.alternatives=target.alternatives?.length||0;sample.language=target.versionKind||'';sample.ok=true;
   }catch(error){sample.reason=redact(String(error.message||error)).slice(0,200);}
   row.samples.push(sample);
  }
  row.ok=row.samples.some(s=>s.ok);row.availability=row.samples.every(s=>s.ok)?'samples-resolved':row.ok?'partial':'unavailable';
 }catch(error){row.reason=redact(String(error.message||error)).slice(0,200);}
 finally{catalog.stop();row.ms=Date.now()-started;report.sites.push(row);console.log(JSON.stringify(row));}
}
try{
 const sources=CONNECTORS.filter(c=>!only||c.id===only);
 for(let i=0;i<sources.length;i+=2)await Promise.all(sources.slice(i,i+2).map(check));
 report.ok=report.sites.length===sources.length&&report.sites.every(s=>s.ok);
 report.allSamplesResolved=report.ok&&report.sites.every(s=>s.availability==='samples-resolved');
}finally{mkdirSync('.local/playback-validation',{recursive:true});writeFileSync('.local/playback-validation/providers.json',JSON.stringify(report,null,2)+'\n');rmSync(directory,{recursive:true,force:true});}
process.exitCode=report.ok?0:1;
