// Evidence collection only: this records open findings, not a passing security gate.
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {startServer,mutationAllowed} from '../../scripts/holy/server.mjs';
import {Catalog} from '../../scripts/holy/catalog.mjs';
import {Library} from '../../scripts/holy/library.mjs';
const directory=mkdtempSync(join(tmpdir(),'luma-audit-'));
process.env.HOLY_LOG_DIR = join(directory,'logs');
mkdirSync('.local/audit-20261107',{recursive:true});
const originalFetch=globalThis.fetch,servers=[];
const result={date:'2026-11-07',scope:'Controlled local probes; no TV, no production service requests, no external downloads.',checks:[]};
const listen=async server=>{servers.push(server);if(!server.listening)await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;};
let child;
try {
 let reached=0;
 const target=http.createServer((req,res)=>{reached++;res.end('CONTROLLED_PRIVATE_RESPONSE');}).listen(0,'127.0.0.1');
 const targetBase=await listen(target);
 const first=http.createServer((req,res)=>{res.writeHead(302,{Location:targetBase+'/private-fixture'}).end();}).listen(0,'127.0.0.1');
 const firstBase=await listen(first);
 globalThis.fetch=(url,options)=>originalFetch(url==='https://public.example/show'?firstBase+'/start':url,options);
 let dnsChecks=0;
 const site={id:'audit',name:'Audit',site:'https://public.example/',episodes:async(url,load)=>{await load(url);return [];}};
 const catalog=new Catalog({file:join(directory,'cat.json'),detailsFile:join(directory,'details.json'),connectors:[site]});
 const library=new Library(join(directory,'lib.json'));
 const server=startServer({catalog,library,port:0,root:directory,webRoot:null,imageDir:join(directory,'images'),log:()=>{},resolveHost:async()=>{dnsChecks++;return ['93.184.216.34'];}});
 const base=await listen(server);
 const response=await originalFetch(base+'/holy-api/episodes?source=audit&show='+encodeURIComponent('https://public.example/show'));
 result.checks.push({id:'SEC-01',status:response.status,initialDnsChecks:dnsChecks,redirectTargetHits:reached,confirmed:reached===1,method:'Public HTTPS first hop and DNS simulated; actual HTTP redirect followed between two ephemeral loopback fixtures through API -> Catalog -> fetchText. No real private system queried.'});
 const item={source:'audit',kind:'movie',title:'Audit fixture',url:'https://public.example/movie'};
 let post=await originalFetch(base+'/holy-api/queue',{method:'POST',headers:{Origin:'http://192.168.1.200:'+new URL(base).port,'Content-Type':'text/plain'},body:JSON.stringify({item})});
 result.checks.push({id:'SEC-02',status:post.status,queued:(await post.json()).queued,remotePrivateCallerAccepted:mutationAllowed({socket:{remoteAddress:'192.168.1.200'},headers:{origin:'http://192.168.1.201:43190'}},43190),method:'Actual loopback HTTP client with unrelated private Origin, plus authorization helper with private source IP; no credentials.'});
 for(let n=1;n<100;n++)library.toggleQueue({...item,url:item.url+n});
 post=await originalFetch(base+'/holy-api/queue',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:JSON.stringify({item:{...item,url:item.url+'overflow'}})});
 result.checks.push({id:'QUAL-01',status:post.status,body:await post.json(),capacity:library.watchQueue.length});
 globalThis.fetch=originalFetch;
 const root=new URL('../../',import.meta.url);
 const moduleURL=path=>new URL(path,root).href;
 const childFile=join(directory,'child.mjs');
 writeFileSync(childFile,`import {startServer} from ${JSON.stringify(moduleURL('scripts/holy/server.mjs'))};\nimport {installCrashGuard} from ${JSON.stringify(moduleURL('scripts/crash-guard.mjs'))};\ninstallCrashGuard(message=>process.send({warning:message}));\nconst server=startServer({catalog:{items:[],sources:()=>[]},library:{entries:[],votes:[]},port:0,root:${JSON.stringify(directory)},webRoot:null,imageDir:${JSON.stringify(join(directory,'child-images'))},log:()=>{}});server.once('listening',()=>process.send({port:server.address().port}));`);
 child=fork(childFile,{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,HOLY_LOG_DIR:join(directory,'logs')}});
 const [ready]=await once(child,'message');let warning='';child.on('message',m=>{if(m.warning)warning=m.warning;});
 const badResult=await new Promise(resolve=>{
  const req=http.request({hostname:'127.0.0.1',port:ready.port,path:'http://[',headers:{Host:'localhost'}});
  req.on('response',res=>{res.resume();resolve({status:res.statusCode});});
  req.on('error',()=>resolve({closed:true}));req.end();setTimeout(()=>{resolve({timedOut:true});req.destroy();},400);
 });
 const healthy=await originalFetch('http://127.0.0.1:'+ready.port+'/holy-api/health');
 result.checks.push({id:'SEC-03',...badResult,unhandledRejectionLogged:warning.includes('Invalid URL'),subsequentHealthStatus:healthy.status,method:'Malformed absolute request target sent only to fresh isolated child using production crash guard; worker stays alive but request receives no response.'});
} finally {
 globalThis.fetch=originalFetch;if(child){child.kill();await once(child,'exit');}
 for(const server of servers)server.closeAllConnections?.();
 await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 rmSync(directory,{recursive:true,force:true});
}
writeFileSync('.local/audit-20261107/probes.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
