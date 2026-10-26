import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONNECTORS} from './holy/connectors.mjs';
import {Catalog} from './holy/catalog.mjs';
import {SOURCE_CONTRACTS} from './fixtures/playback/source-contracts.mjs';

// Offline parser -> catalogue -> target contract. No TV, user state, fetch or
// provider availability is claimed. Unexpected requests fail instead of going online.
const directory=mkdtempSync(join(tmpdir(),'holy-source-contracts-'));
const nativeFetch=globalThis.fetch;
globalThis.fetch=()=>{throw Error('Network forbidden in source-contract replay');};
let passed=0;
try {
 assert.deepEqual(SOURCE_CONTRACTS.map(x=>x.source).sort(),CONNECTORS.map(x=>x.id).sort(),'Every enabled source needs a replay fixture');
 for(const fixture of SOURCE_CONTRACTS){
  const connector=CONNECTORS.find(x=>x.id===fixture.source);
  const parsed=connector.parseHome(fixture.home,connector.site);
  assert.equal(parsed.length,1,fixture.source+': one parsed fixture item');
  const item=parsed[0];
  assert.equal(item.source,fixture.source);
  for(const [key,value] of Object.entries(fixture.identity))assert.equal(item[key],value,fixture.source+': parsed '+key);
  assert.equal(connector.language||null,fixture.declaredLanguage,fixture.source+': declared audio metadata (null means unknown)');
  assert.ok(item.title && item.url.startsWith('https://'),fixture.source+': parsed identity');
  const requests=[];
  const fetch=async(url,options={})=>{
   requests.push({url,...options});
   const row=fixture.responses.find(x=>x.url===url&&(x.method||'GET')===(options.method||'GET'));
   assert.ok(row,fixture.source+': unexpected offline request '+url);
   if(row.referrer)assert.equal(options.referrer,row.referrer,fixture.source+': request Referer');
   if(row.requestJSON)assert.deepEqual(JSON.parse(options.body),row.requestJSON,fixture.source+': API request body');
   return row.body;
  };
  const catalog=new Catalog({file:join(directory,fixture.source+'.json'),detailsFile:join(directory,fixture.source+'-details.json'),connectors:[connector],knownLists:null,fetch});
  try {
   const target=await catalog.resolve(item,fixture.choice||{});
   assert.ok(target,fixture.source+': target exists');
   for(const [key,value] of Object.entries(fixture.expected))assert.deepEqual(target[key],value,fixture.source+': '+key);
   for(const address of [target.url,...(target.alternatives||[])])assert.equal(new URL(address).protocol,'https:',fixture.source+': HTTPS only');
   assert.ok(![target.url,...(target.alternatives||[])].some(url=>url.startsWith('javascript:')||/mega\.nz|dr0pstream\.com|ignored\.example/.test(url)),fixture.source+': unsupported unsafe links excluded');
   assert.ok(requests.length,fixture.source+': real connector fetch path exercised');
   // Resolve cache must preserve language / Referer and not ask the source again.
   const before=requests.length;assert.deepEqual(await catalog.resolve(item,fixture.choice||{}),target);assert.equal(requests.length,before);
   catalog.forgetPlayer(item.url);
   catalog.fetch=async()=>'<html><p>formato cambiado; sin reproductor</p></html>';
   let malformed=null;try{malformed=await catalog.resolve(item,fixture.choice||{});}catch(error){assert.ok(error instanceof Error);}
   assert.equal(malformed,null,fixture.source+': malformed source cannot fabricate a playable target');
   catalog.forgetPlayer(item.url);
   catalog.fetch=async()=>{throw Error('fixture source unavailable');};
   await assert.rejects(catalog.resolve(item,fixture.choice||{}),/fixture source unavailable/,fixture.source+': network failure surfaces');
   passed++;
   console.log(fixture.source+': parser, resolución, metadatos de idioma, Referer, alternativas, caché y fallos correctos.');
  }finally{catalog.stop();}
 }
 console.log(passed+'/7 contratos de fuentes correctos (replay offline; sin TV ni Internet).');
}finally{globalThis.fetch=nativeFetch;rmSync(directory,{recursive:true,force:true});}
