import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './desktop-config.mjs';
import {safeDetail,redact} from './diagnostics.mjs';
export function debugBundle(root=ROOT){
 const read=name=>{try{return readFileSync(join(root,'.local/logs',name),'utf8');}catch{return '';}};
 const files=['diagnostics.jsonl.4','diagnostics.jsonl.3','diagnostics.jsonl.2','diagnostics.jsonl.1','diagnostics.jsonl','holy-playback.jsonl.1','holy-playback.jsonl'];
 const records=files.flatMap(file=>read(file).split('\n').flatMap(line=>{try{const row=JSON.parse(line);return [{file,at:row.at,runId:row.runId,build:row.build,event:row.event,component:row.component,level:row.level,host:row.host?redact(row.host):undefined,...safeDetail(row)}];}catch{return [];}}));
 return {v:1,generatedAt:new Date().toISOString(),scope:'Registros locales conservados; no equivale a prueba de reproducción en TV',records,flight:read('flight.log').split('\n').slice(-1000).map(redact)};
}
if(process.argv[1]&&new URL(import.meta.url).pathname.toLowerCase().endsWith(process.argv[1].replaceAll('\\','/').toLowerCase().replace(/^[a-z]:/i,''))){
 const result=debugBundle();const dir=join(ROOT,'artifacts');mkdirSync(dir,{recursive:true});
 const file=join(dir,'holy-debug-'+Date.now()+'.json');writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({file,records:result.records.length}));
}
