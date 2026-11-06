import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LabRuntime,inspectorClosed,failureCode} from './lab-runtime.mjs';
import {DiagnosticLog} from './diagnostics.mjs';
import {Library} from './holy/library.mjs';
import {PeerSync} from '../desktop/shared/peer-sync.mjs';
import {readConnection,summarize} from './connection-report.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-connection-log-'));let passed=0;
const check=async(name,fn)=>{await fn();passed++;};
const reset=code=>Object.assign(new TypeError('fetch failed'),{cause:Object.assign(Error('socket'),{code})});
try{
 await check('A reset inspector socket means no developer app is open; a timeout or a TV that is off does not',()=>{
  for(const code of ['ECONNRESET','UND_ERR_SOCKET','ECONNREFUSED'])assert.equal(inspectorClosed(reset(code)),true);
  assert.equal(inspectorClosed(Object.assign(Error('The operation was aborted due to timeout'),{name:'TimeoutError'})),false);
  assert.equal(inspectorClosed(Error('La TV no respondió a la conexión de desarrollo.')),false);
  assert.equal(failureCode(reset('ECONNRESET')),'ECONNRESET');assert.equal(failureCode(Object.assign(Error('x'),{name:'TimeoutError'})),'TimeoutError');
 });
 await check('Holy closed on a TV that answers keeps one SSH session and its reservation, then attaches when Holy opens',async()=>{
  let opened=0,closed=0,app=false,attached=0;
  const lab=new LabRuntime({log:()=>{},openTunnel:async()=>{opened++;return {endpoint:'fake',closed:new Promise(()=>{}),close(){closed++;},assertActive(){}};},
   targets:async()=>{if(!app)throw reset('ECONNRESET');return [{id:'holy',description:'com.lgapp.holy',url:'file:///holy/'}];},
   connect:async()=>{attached++;return {target:{id:'holy',description:'com.lgapp.holy'},closed:new Promise(()=>{}),close(){}};},
   selectTarget:list=>list[0],makeBridge:()=>({async start(){},async status(){},async stop(){}})});
  for(let i=0;i<5;i++)await lab.step();
  assert.equal(lab.state,'waiting');assert.equal(lab.lastError,null);assert.equal(lab.lastCause,'inspector-closed');
  assert.equal(opened,1,'No SSH churn while Holy is closed');assert.equal(closed,0);
  app=true;await lab.step();assert.equal(lab.state,'connected');assert.equal(attached,1);assert.equal(opened,1);assert.equal(lab.lastCause,'');
 });
 await check('Other failures still rebuild the connection and say why in the log',async()=>{
  let opened=0;
  const lab=new LabRuntime({log:()=>{},openTunnel:async()=>{opened++;return {endpoint:'fake',close(){},assertActive(){}};},
   targets:async()=>{throw Object.assign(Error('The operation was aborted due to timeout'),{name:'TimeoutError'});}});
  await lab.step();assert.equal(lab.state,'offline');assert.equal(lab.lastCause,'TimeoutError');assert.equal(lab.tunnel,null);
  await lab.step();assert.equal(opened,2);
 });
 await check('The connection life is kept monthly, every level, with repeats folded and nothing else mixed in',()=>{
  let time=Date.parse('2026-11-06T10:00:00Z');const now=()=>new Date(time).toISOString();
  const log=new DiagnosticLog({file:join(dir,'logs','diagnostics.jsonl'),now});
  log.event('service','stopping',{reason:'network-changed'});
  log.event('connection','state',{state:'waiting',code:'inspector-closed'});
  for(let i=0;i<3;i++){time+=1000;log.event('connection','state',{state:'offline',code:'TimeoutError',error:'La TV no respondió'},'warn');}
  log.event('catalog','source-loaded',{source:'cuevana',count:3});
  time+=700000;log.event('connection','state',{state:'offline',code:'TimeoutError',error:'La TV no respondió'},'warn');
  const rows=readFileSync(join(dir,'logs','connection-2026-11.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(row=>row.code||row.reason),['network-changed','inspector-closed','TimeoutError','TimeoutError']);
  assert.equal(rows.at(-1).repeats,2,'Repeats within ten minutes are counted on the next line');
  assert.ok(!rows.some(row=>row.component==='catalog'));
  assert.ok(readdirSync(join(dir,'logs')).includes('incidents-2026-11.jsonl'),'Warnings still reach the incidents file');
 });
 await check('The report gives time per state, each cut of a live connection with its cause, stops and sleep',()=>{
  const t=minute=>new Date(Date.parse('2026-11-06T10:00:00Z')+minute*60000).toISOString();
  const rows=[{at:t(0),component:'connection',event:'state',state:'connected'},{at:t(30),component:'connection',event:'state',state:'offline',code:'lost',error:{message:'Se perdió'}},
   {at:t(31),component:'connection',event:'state',state:'connected'},{at:t(40),component:'service',event:'stopping',reason:'network-changed'},{at:t(41),component:'service',event:'worker-exit',code:'1'},
   {at:t(100),component:'service',event:'resumed',durationMs:3540000},{at:t(101),component:'connection',event:'state',state:'waiting',code:'inspector-closed'}];
  const report=summarize(rows,Date.parse(t(111)));
  assert.deepEqual(Object.fromEntries(Object.entries(report.states).map(([k,v])=>[k,v/60000])),{connected:39,offline:1,waiting:10});
  assert.deepEqual(report.cuts.map(cut=>cut.code),['lost']);assert.deepEqual(report.stops,{'network-changed':1});assert.deepEqual(report.exits,{'1':1});assert.equal(report.slept,3540000);
  assert.equal(readConnection(join(dir,'logs'),Date.parse('2026-11-01')).length,4);
 });
 await check('A computer\'s old address that never answered does not hold the sync at «pending»',async()=>{
  const library=new Library(join(dir,'library.json'));
  const answers={'192.168.1.148':'ok','192.168.1.102':'down'};
  const sync=new PeerSync({library,file:join(dir,'peer.json'),host:()=> '192.168.1.65',peers:()=>['192.168.1.102','192.168.1.148']});
  sync.settings.key='a'.repeat(64);sync.discover=async()=>{};
  sync.fetcher=async url=>{const host=new URL(url).hostname;if(answers[host]==='down')throw reset('ECONNREFUSED');return {ok:false,status:503};};
  await sync.step();
  assert.equal(sync.status().state,'pending');
  assert.deepEqual(sync.status().peers.map(peer=>peer.state),['offline','offline']);
  const link=sync.links.get('192.168.1.148');Object.assign(link,{state:'synced',updated:1,ack:sync.replica.hash()});
  assert.equal(sync.status().pending,false);assert.equal(sync.status().state,'synced');
  assert.equal(sync.links.get('192.168.1.102').code,'ECONNREFUSED');
  await sync.stop();
 });
 console.log(passed+' comprobaciones de conexión: Holy cerrado sin reconectar en bucle, causas en el log, registro mensual y estado de sincronización.');
}finally{rmSync(dir,{recursive:true,force:true});}
