// Follows Brave: same catalog, same mirrored list files, same uBlock commit.
// Immutable generations, regression checks, then one atomic manifest switch.
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import adblock from 'adblock-rs';
import {acquireRuntimeLock} from './runtime-lock.mjs';
import {BRAVE,selectComponents,processSource,probeBrave,checkCommit} from './brave-sync.mjs';

const MAX_BYTES=8*1024*1024;
const sha=text=>createHash('sha256').update(text).digest('hex');
const atomicJSON=(path,data)=>{const tmp=path+'.tmp-'+randomUUID();writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');renameSync(tmp,path)};
export function validateDownload(name,text){
 if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Descarga demasiado grande');
 if(name.endsWith('.json')){
  const data=JSON.parse(text);const names=new Set();
  if(!Array.isArray(data)||data.length<10||data.length>2000)throw Error('Recursos inválidos');
  for(const r of data){
   if(typeof r.name!=='string'||names.has(r.name)||!Array.isArray(r.aliases)||typeof r.content!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(r.content)||!(r.kind==='template'||typeof r.kind?.mime==='string'))throw Error('Formato de recurso incompatible');
   names.add(r.name);
  }
 // Some Brave lists are only a few lines long; the sanity check catches harmful content.
 }else if(!text.trim()||/<(?:html|!doctype)/i.test(text.slice(0,300)))throw Error('Respuesta no válida como lista');
}
async function download(url,fetcher,headers={}){
 const response=await fetcher(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'LumaBrowserLab/0.8',...headers}});
 if(!response.ok)throw Error(`HTTP ${response.status}: ${new URL(url).hostname}`);
 if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Descarga demasiado grande');
 const reader=response.body.getReader();const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BYTES)throw Error('Descarga demasiado grande');chunks.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{})}
 return Buffer.concat(chunks).toString('utf8');
}
async function pool(items,limit,work){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length)await work(items[next++])}))}
async function validateGeneration(directory){
 for(const script of ['test-shields.mjs','test-navigation-shield.mjs','test-bridge.mjs','validate-engine.mjs'])await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/'+script],{env:{...process.env,LUMA_FILTER_GENERATION:directory},stdio:'pipe'});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  child.once('error',e=>{clearTimeout(timer);reject(e)});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(script+': '+output.slice(-2000)))});
 });
}

// Downloaded uBlock code runs in a child that can only read its own copy.
export async function buildUBlockScriptlets(directory){
 // Real paths: the permission model does not follow symlinks such as /var → /private/var.
 const source=realpathSync(directory);const helper=realpathSync(fileURLToPath(new URL('./ublock-scriptlets.mjs',import.meta.url)));
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--permission',`--allow-fs-read=${source}`,`--allow-fs-read=${helper}`,helper,source],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});
  let output='',errors='';child.stdout.on('data',x=>{output+=x;if(output.length>MAX_BYTES)child.kill('SIGKILL')});child.stderr.on('data',x=>errors+=x);
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  child.once('error',e=>{clearTimeout(timer);reject(e)});
  child.once('exit',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Scriptlets de uBlock: '+errors.slice(-1000)));try{resolve(JSON.parse(output))}catch(e){reject(e)}});
 });
}
// Same assembly as Brave's packager: uBlock redirect resources + uBlock scriptlets.
async function uBlockResources(commit,fetcher,scratch,build){
 const save=async path=>{
  if(!/^src\/[\w./-]+$/.test(path)||path.includes('..'))throw Error('Ruta de uBlock no permitida: '+path);
  const response=await fetcher(BRAVE.uBlockFile(commit,path),{signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error(`HTTP ${response.status}: ${path}`);
  const bytes=Buffer.from(await response.arrayBuffer());const target=resolve(scratch,path);
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);return bytes.toString('utf8');
 };
 const tree=JSON.parse(await download(BRAVE.uBlockTree(commit),fetcher,{Accept:'application/vnd.github+json'}));
 const assets=(tree.tree||[]).filter(item=>item.type==='blob'&&/^src\/web_accessible_resources\/[\w./-]+$/.test(item.path)).map(item=>item.path);
 if(assets.length<20)throw Error('Copia de uBlock incompleta');
 await pool([...assets,'src/js/redirect-resources.js'],6,save);
 // Only the modules scriptlets.js really imports, followed through relative imports.
 const seen=new Set(),queue=['src/js/resources/scriptlets.js'];
 while(queue.length){
  const batch=queue.splice(0).filter(path=>!seen.has(path)&&seen.add(path));
  if(seen.size>300)throw Error('Demasiados módulos de uBlock');
  await pool(batch,6,async path=>{
   const code=await save(path);
   for(const [,spec] of code.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
    const next=new URL(spec,'file:///'+path).pathname.slice(1);
    if(!seen.has(next))queue.push(next);
   }
  });
 }
 const redirects=adblock.uBlockResources(resolve(scratch,'src/web_accessible_resources'),resolve(scratch,'src/js/redirect-resources.js')).filter(r=>r.name!=='google-ima-dai.js');
 const scriptlets=await build(scratch);
 if(!scriptlets.some(r=>r.name==='json-prune.js')||!redirects.some(r=>r.name==='noop.js'))throw Error('Faltan recursos esenciales de uBlock');
 return JSON.stringify([...redirects,...scriptlets]);
}

export async function updateLists({directory=resolve('research/lists'),fetcher=fetch,validate=validateGeneration,probe=probeBrave,build=buildUBlockScriptlets,force=false,locale='es'}={}){
 mkdirSync(directory,{recursive:true});
 const release=acquireRuntimeLock(resolve(directory,'.update.lock'));
 const stage=resolve(directory,'.stage-'+randomUUID());
 const state=resolve(directory,'sync-state.json');
 try{
  const heads=await probe();
  checkCommit(heads.mirrorCommit,'el espejo');checkCommit(heads.packagerCommit,'el empaquetador');
  const pointer=resolve(directory,'lists.json');const old=existsSync(pointer)?JSON.parse(readFileSync(pointer,'utf8')):null;
  const checkedAt=new Date().toISOString();
  if(!force&&old?.brave?.mirrorCommit===heads.mirrorCommit&&old.brave.packagerCommit===heads.packagerCommit){
   atomicJSON(state,{checkedAt,...heads,changed:false});
   return {changed:false,revision:old.revision,mirrorCommit:heads.mirrorCommit};
  }
  mkdirSync(stage);
  const catalogText=await download(BRAVE.catalog,fetcher);
  const components=selectComponents(JSON.parse(catalogText),locale);
  const pin=JSON.parse(await download(BRAVE.uBlockPin(heads.packagerCommit),fetcher,{Accept:'application/vnd.github+json'}));
  const uBlockCommit=checkCommit(pin.sha,'brave/uBlock');
  const manifest={updatedAt:checkedAt,enabled:components.map(c=>c.id),lists:{},resources:{},
   brave:{...heads,uBlockCommit,locale,catalogSha256:sha(catalogText)}};
  // Brave's packager joins every source of a catalog entry into one list.
  const sources=components.flatMap(component=>component.sources.map(source=>({component,source})));
  const texts=new Map();
  await pool(sources,4,async ({component,source})=>{
   const raw=await download(BRAVE.mirrorFile(heads.mirrorCommit,source.url),fetcher);
   validateDownload(component.id,raw);
   texts.set(source.url+'\n'+component.id,{raw,processed:processSource(component,source,raw)});
  });
  for(const component of components){
   const parts=component.sources.map(source=>texts.get(source.url+'\n'+component.id));
   const text=parts.map(part=>part.processed).join('\n');
   writeFileSync(resolve(stage,component.id+'.txt'),text);
   manifest.lists[component.id]={title:component.title,uuid:component.uuid,permissions:component.permissions,format:'Standard',
    bytes:Buffer.byteLength(text),sha256:sha(text),lines:text.split('\n').length,
    sources:component.sources.map((source,i)=>({url:source.url,sha256:sha(parts[i].raw)}))};
  }
  // Scriptlets only change when Brave moves its uBlock pin: reuse otherwise.
  const oldResources=old?.directory&&old.brave?.uBlockCommit===uBlockCommit?resolve(directory,old.directory,'resources.json'):null;
  let resourcesText;
  if(oldResources&&existsSync(oldResources))resourcesText=readFileSync(oldResources,'utf8');
  else{const scratch=resolve(stage,'.ublock');try{resourcesText=await uBlockResources(uBlockCommit,fetcher,scratch,build)}finally{rmSync(scratch,{recursive:true,force:true})}}
  const customText=await download(BRAVE.customResources,fetcher);
  for(const [file,text] of [['resources.json',resourcesText],['custom-resources.json',customText]]){
   validateDownload(file,text);writeFileSync(resolve(stage,file),text);
   manifest.resources[file]={bytes:Buffer.byteLength(text),sha256:sha(text)};
  }
  manifest.revision=sha(JSON.stringify([manifest.enabled,manifest.lists,manifest.resources]));
  atomicJSON(resolve(stage,'lists.json'),manifest);await validate(stage);
  const generation='generations/'+manifest.revision.slice(0,20);
  mkdirSync(resolve(directory,'generations'),{recursive:true});
  if(existsSync(resolve(directory,generation)))rmSync(stage,{recursive:true});else renameSync(stage,resolve(directory,generation));
  if(old&&old.revision!==manifest.revision){mkdirSync(resolve(directory,'previous'),{recursive:true});atomicJSON(resolve(directory,'previous/lists.json'),old)}
  atomicJSON(pointer,{...manifest,directory:generation});
  atomicJSON(state,{checkedAt,...heads,uBlockCommit,changed:old?.revision!==manifest.revision});
  return {changed:old?.revision!==manifest.revision,revision:manifest.revision,enabled:manifest.enabled.length,mirrorCommit:heads.mirrorCommit,uBlockCommit,updatedAt:manifest.updatedAt};
 }finally{rmSync(stage,{recursive:true,force:true});release()}
}
export function rollbackLists(directory=resolve('research/lists')){
 const release=acquireRuntimeLock(resolve(directory,'.update.lock'));
 try{
  const previous=JSON.parse(readFileSync(resolve(directory,'previous/lists.json'),'utf8'));
  const root=previous.directory?resolve(directory,previous.directory):directory;
  for(const name of previous.enabled)if(!existsSync(resolve(root,name+'.txt')))throw Error('Versión anterior incompleta');
  atomicJSON(resolve(directory,'lists.json'),previous);
 }finally{release()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.includes('--rollback')){rollbackLists();console.log('Versión anterior restaurada.')}else console.log(JSON.stringify(await updateLists({force:process.argv.includes('--force')})));}
 catch(e){console.error('Se conserva la versión activa: '+e.message);process.exitCode=1}
}
