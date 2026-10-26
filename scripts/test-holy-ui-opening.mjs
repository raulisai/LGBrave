import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {parse,compileModule} from 'svelte/compiler';

// Compile the actual TV component's playback flow with Svelte, rather than replacing
// its reactivity with plain objects. Episode rows are raw objects; search rows can be proxies.
const source=readFileSync(new URL('../src/Holy.svelte',import.meta.url),'utf8');
const ast=parse(source,{modern:true});const body=ast.instance.content.body;
const pick=name=>{const node=body.find(node=>node.id?.name===name||node.declarations?.some(d=>d.id.name===name));assert.ok(node,name);return source.slice(node.start,node.end);};
const code=[pick('opening'),pick('langSheet'),
 'let openingTimer,navigationError="",notice="",apiBase="http://127.0.0.1";',
 'let info,available=true,commands=[],timer=null;',
 'const setTimeout=(fn,ms)=>{timer={fn,ms};return timer;};const clearTimeout=()=>{timer=null;};',
 'const hasVersions=item=>item.source==="doramasflix";',
 'const versionsFor=async()=>await info;',
 'const getJSON=async()=>({ok:true});',
 'const command=(action,value)=>{commands.push({action,value});return available;};',
 pick('chooseLanguage'),pick('play'),
 'export function setup(value,connected=true){info=value;available=connected;commands=[];opening=null;langSheet=null;notice="";timer=null;}',
 'export function state(){return {opening:$state.snapshot(opening),sheet:$state.snapshot(langSheet),notice,commands:$state.snapshot(commands),timeout:timer?.ms};}',
 'export async function run(item){await play(item);return state();}',
 'export async function choose(version){await chooseLanguage(version);return state();}',
 'export function reactive(value){let item=$state(value);return item;}',
 'export function cancel(){opening=null;}',
 'export function expire(){timer?.fn();return state();}'
].join('\n');
const output=compileModule(code,{filename:'tv-opening.svelte.js',generate:'client',dev:false}).js.code
 .replace(/from ['"]svelte\/internal\/client['"]/g,'from '+JSON.stringify(import.meta.resolve('svelte/internal/client')));
const dir=mkdtempSync(join(tmpdir(),'holy-ui-opening-'));
try{
 const file=join(dir,'opening.mjs');writeFileSync(file,output);const ui=await import(pathToFileURL(file).href);
 const item={source:'doramasflix',title:'Between Steps',kind:'dorama',url:'https://source.example/episode-4',show:'https://source.example/show',episode:4};
 const spanish={id:'38',kind:'dub',label:'Español latino'},korean={id:'13109',kind:'sub',label:'Coreano · subtítulos en español'};
 const choices={versions:[spanish,korean],remembered:null};
 for(const entry of [item,ui.reactive({...item})]){
  ui.setup(choices);const state=await ui.run(entry);
  assert.equal(state.sheet?.versions.length,2,'Raw episode and reactive search cards must both show the language picker');assert.equal(state.opening,null);assert.equal(state.commands.length,0);
  const selected=await ui.choose(spanish);assert.equal(selected.commands.length,1);assert.equal(selected.commands[0].value.version,'38');assert.equal(selected.commands[0].value.versionKind,'dub');
 }
 ui.setup({...choices,remembered:spanish});const remembered=await ui.run(item);assert.equal(remembered.commands[0]?.value.version,'38');assert.equal(remembered.sheet,null);
 ui.setup(choices,false);const disconnected=await ui.run({...item,source:'animeyt'});assert.equal(disconnected.opening,null,'A missing bridge must clear the opening overlay');assert.match(disconnected.notice,/computadora/);
 ui.setup(choices);await ui.run({...item,source:'animeyt'});assert.equal(ui.state().timeout,40000);assert.equal(ui.expire().opening,null,'A raw card must leave opening when its timeout expires');
 let finish;ui.setup(new Promise(resolve=>{finish=resolve;}));const pending=ui.run(item);ui.cancel();finish(choices);await pending;assert.equal(ui.state().sheet,null);assert.equal(ui.state().commands.length,0,'Late responses after cancel must not launch playback');
 console.log('Interfaz TV compilada con Svelte: episodios raw/búsqueda reactiva, idiomas, español, preferencia recordada, desconexión, timeout y cancelación correctos.');
}finally{rmSync(dir,{recursive:true,force:true});}
