import assert from 'node:assert/strict';
import vm from 'node:vm';
import {HolyBridge} from './holy/holy-bridge.mjs';
import {remoteSource,curtainSource} from './holy/page-scripts.mjs';
import {homeBootSource} from './holy/home-boot.mjs';
import {homeAddressMatches} from './holy/home-address.mjs';

let passed=0;
const check=async(name,test)=>{await test();passed++;};
const home='http://192.168.1.65:43190/holy/';
const never=()=>new Promise(()=>{});
const item={source:'jkanime',kind:'anime',title:'Serie',show:'https://jkanime.net/serie/',url:'https://jkanime.net/serie/1/',episode:1};
function bridgeFixture({navigate=async()=>({}),failSave=false}={}) {
  const calls=[],saved=[],errors=[];
  const bridge=Object.create(HolyBridge.prototype);
  Object.assign(bridge,{home,mainFrame:'main',mainContext:7,frames:new Map([['main','https://player.example/']]),
    remoteContexts:new Set([11]),childSessions:new Map(),sessionToken:2,curtainScript:'old-curtain',errors,navigation:{phase:'complete'},
    session:{item,key:item.show,token:2,phase:'playing',position:{t:321,d:1400},card:{timer:null}},
    library:{progress(...args){if(failSave)throw Error('disk unavailable');saved.push(args);}},
    recordPlayback(){},beginNavigation(url){this.navigation={url,phase:'loading'};},status:never,
    cdp:{evaluate(expression,id){calls.push({method:'Runtime.evaluate',expression,id});return never();},call(method,params){calls.push({method,params});return method==='Page.navigate'?navigate():never();}}});
  return {bridge,calls,saved,errors};
}
function page({live=true,binding=true,child=false,homePage=false}={}) {
  const listeners=new Map(),timers=new Map(),sent=[],assigned=[],messages=[];
  let timerId=0,stamp=0;
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.attributes={};}
    append(...nodes){this.children.push(...nodes);}
    attachShadow(){return this.shadow=new Node('shadow');}
    setAttribute(key,value){this.attributes[key]=value;}
    remove(){this.removed=true;}
  }
  const root=new Node('html');root.dataset.holyBridge='world|'+(live?Date.now():1);
  let href=homePage?home:'https://player.example/';
  const location={get href(){return href;},set href(url){href=url;assigned.push(url);}};
  const win={location};win.top=child?{postMessage:message=>messages.push(message),location:{set href(url){throw Error('cross-origin');}}}:win;
  if(binding)win.__lgLabCommand=payload=>sent.push(JSON.parse(payload));
  const context=vm.createContext({window:win,location,document:{documentElement:root,createElement:tag=>new Node(tag)},
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},Date,URL});
  vm.runInContext(remoteSource([home],home,'world'),context);
  const press=(code=461)=>{const event={keyCode:code,timeStamp:++stamp,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of listeners.get('keydown')||[])fn(event);return event;};
  const fire=()=>{const pending=[...timers.values()];timers.clear();for(const timer of pending)timer.fn();};
  return {win,root,timers,sent,assigned,messages,press,fire,context,listeners,Node};
}

await check('Back dispatches navigation without waiting for blocked player JS, cleanup or status',async()=>{
  const {bridge,calls,saved}=bridgeFixture();const exiting=bridge.command({action:'back'});
  assert.equal(bridge.session,null);assert.deepEqual(saved,[[item.show,item.url,321,1400]]);
  assert.deepEqual(calls.filter(call=>call.method.startsWith('Page.')).map(call=>call.method),['Page.removeScriptToEvaluateOnNewDocument','Page.stopLoading','Page.navigate']);
  assert.equal(calls.find(call=>call.method==='Page.navigate').params.url,home);
  assert.equal(calls.find(call=>call.method==='Runtime.evaluate').id,7,'Cleanup is pinned to the old context');
  assert.equal(await Promise.race([exiting.then(()=>true),new Promise(resolve=>setImmediate(()=>resolve(false)))]),true);
});
await check('Repeated Back while navigation is pending sends one destination',async()=>{
  let resolve;const pending=new Promise(done=>resolve=done),{bridge,calls}=bridgeFixture({navigate:()=>pending});
  const first=bridge.command({action:'back'}),second=bridge.command({action:'back'});
  assert.equal(calls.filter(call=>call.method==='Page.navigate').length,1);resolve({});await Promise.all([first,second]);
});
await check('A local history write error cannot trap the viewer',async()=>{
  const {bridge,calls,errors}=bridgeFixture({failSave:true});await bridge.command({action:'back'});
  assert.equal(calls.some(call=>call.method==='Page.navigate'),true);assert.equal(errors[0].phase,'exit-save');
});
await check('Back during resolve cancels the old request immediately',async()=>{
  const {bridge}=bridgeFixture();bridge.session.phase='resolving';await bridge.command({action:'back'});
  assert.equal(bridge.session,null);assert.equal(bridge.sessionToken,3);
});
await check('Explicit chapter list is still available and does not await player cleanup',async()=>{
  const {bridge,calls}=bridgeFixture();await bridge.toEpisodes(item);
  const destination=calls.find(call=>call.method==='Page.navigate').params.url;
  assert.ok(destination.startsWith(home+'#episodes='));assert.equal(JSON.parse(decodeURIComponent(destination.split('=')[1])).at,item.url);
});
await check('Home ignores Back without reviving a prior player',async()=>{
  const {bridge,calls}=bridgeFixture();bridge.session=null;bridge.frames.set('main',home);await bridge.command({action:'back'});assert.equal(calls.length,0);
});
await check('Local fallback arriving home processes its frame before cleanup can time out',async()=>{
  const {bridge}=bridgeFixture();await bridge.event({method:'Page.frameNavigated',params:{frame:{id:'main',url:home}}});
  assert.equal(bridge.session,null);assert.equal(bridge.frames.get('main'),home);
});
await check('Back dismissing an open language dialog acknowledges the remote fallback',async()=>{
  const {bridge,calls}=bridgeFixture();bridge.session.card.kind='versions';
  bridge.hideEndCard=async()=>{};bridge.showPauseCard=async()=>{};
  await bridge.command({action:'back'});
  assert.equal(calls.some(call=>call.expression?.includes('__holyBackHandled')),true);
  assert.equal(calls.some(call=>call.method==='Page.navigate'),false);
});
await check('Only an explicit exit accepts the site beforeunload prompt',async()=>{
  const {bridge,calls}=bridgeFixture();bridge.cdp.call=async(method,params)=>{calls.push({method,params});return {};};
  const dialog={method:'Page.javascriptDialogOpening',params:{type:'beforeunload'}};
  await bridge.event(dialog);assert.equal(calls.length,0);
  bridge.exitingPlayer=true;await bridge.event(dialog);
  assert.equal(calls[0].method,'Page.handleJavaScriptDialog');assert.equal(calls[0].params.accept,true);
  await bridge.event({method:'Page.frameNavigated',params:{frame:{id:'main',url:home}}});assert.equal(bridge.exitingPlayer,false);
});
await check('One press draws the animation before its bridge command and has a bounded fallback',()=>{
  const p=page();assert.equal(p.press().prevented,true);assert.equal(p.root.children.length,1);
  const overlay=p.root.children[0];assert.equal(overlay.tag,'holy-returning');
  assert.equal(overlay.shadow.children[1].children[1].textContent,'Volviendo al inicio…');
  assert.match(overlay.shadow.children[0].textContent,/prefers-reduced-motion/);
  assert.deepEqual(p.sent,[{action:'back'}]);assert.equal([...p.timers.values()][0].ms,800);
  p.press();assert.equal(p.sent.length,1);assert.equal(p.root.children.length,1);
  p.fire();assert.deepEqual(p.assigned,[home]);
});
await check('Bridge acknowledgement cancels the fallback and removes temporary feedback',()=>{
  const p=page();p.press();p.win.__holyBackHandled();assert.equal(p.timers.size,0);assert.equal(p.root.children[0].removed,true);
  p.fire();assert.equal(p.assigned.length,0);p.press();assert.equal(p.sent.length,2);p.win.__holyBackHandled();
});
await check('A committed return cancels duplicate navigation but keeps the animation',()=>{
  const p=page();p.press();p.win.__holyBackHandled(true);p.press();p.fire();
  assert.equal(p.timers.size,0);assert.equal(p.assigned.length,0);assert.equal(p.sent.length,1);assert.equal(p.root.children[0].removed,undefined);
});
await check('Fallback never reloads a home that already committed',()=>{
  const p=page();p.press();p.win.location.href=home;p.fire();assert.deepEqual(p.assigned,[home]);
});
await check('No bridge still returns directly and shows feedback',()=>{
  const p=page({live:false});p.press(27);assert.deepEqual(p.assigned,[home]);assert.equal(p.root.children.length,1);assert.equal(p.timers.size,0);
});
await check('A missing binding returns directly even with a fresh heartbeat',()=>{
  const p=page({binding:false});p.press();assert.deepEqual(p.assigned,[home]);
});
await check('An iframe requests top-level feedback and an escape despite cross-origin restrictions',()=>{
  const p=page({child:true});p.press();p.fire();assert.equal(p.messages[0].holyReturning,home);assert.equal(p.messages[1].holyHome,home);
  assert.equal(p.root.children.length,0);
});
await check('An older world does not steal Back from the current computer',()=>{
  const p=page();p.root.dataset.holyBridge='new-world|'+Date.now();assert.equal(p.press().prevented,undefined);assert.equal(p.sent.length,0);assert.equal(p.root.children.length,0);
});
await check('Home does not get player key handlers or an animation',()=>{
  const p=page({homePage:true});assert.equal(p.press().prevented,undefined);assert.equal(p.root.children.length,0);
});
await check('Late curtain removal cannot cover home with the old movie',()=>{
  const p=page({homePage:true});vm.runInContext(curtainSource({homes:[home],title:'Old film'}),p.context);
  assert.equal(p.root.children.length,0);assert.equal(p.win.__holyCurtain,undefined);
});
await check('WAM packaged host variants identify the same owned home only',()=>{
  const packaged='file:///media/developer/apps/usr/palm/applications/com.lgapp.holy/index.html';
  const actual=packaged.replace('file:///','file://com.lgapp.holy-webos/');
  assert.equal(homeAddressMatches(actual,packaged),true);
  assert.equal(homeAddressMatches('https://evil.example'+new URL(packaged).pathname,packaged),false);
  const {bridge}=bridgeFixture();bridge.packagedHome=packaged;assert.equal(bridge.isHome(actual),true);
  const p=page();p.win.location.href=actual;
  vm.runInContext(curtainSource({homes:[packaged],title:'Old film'}),p.context);assert.equal(p.root.children.length,0);
});
await check('Home context and assets do not wait for old JavaScript or go through ad filtering',async()=>{
  const {bridge,calls}=bridgeFixture();bridge.frames.set('main',home);bridge.uiContexts=new Set();bridge.apiBase=new URL(home).origin;
  bridge.cdp.call=async(method,params)=>{calls.push({method,params});return {};};
  await bridge.setupContext(9,{auxData:{isDefault:true,frameId:'main'}});
  assert.equal(bridge.uiContexts.has(9),true);assert.equal(calls.some(call=>call.method==='Runtime.evaluate'),false);
  await bridge.request({frameId:'main',resourceType:'Script',requestId:'asset',request:{url:home+'assets/menu.js'}});
  assert.equal(calls.at(-1).method,'Fetch.continueRequest');
});
function requestFixture(){
  const f=bridgeFixture();Object.assign(f.bridge,{apiBase:new URL(home).origin,homeAliases:new Set(),enabled:true,engine:{check:()=>({should_block:false})},records:[],blocked:0});
  f.bridge.cdp.call=async(method,params)=>{f.calls.push({method,params});return {};};return f;
}
await check('The first menu script is allowed before frameNavigated replaces the old player identity',async()=>{
  const {bridge,calls}=requestFixture();
  await bridge.event({method:'Network.requestWillBeSent',params:{requestId:'network-script',frameId:'main',documentURL:home,type:'Script',request:{url:home+'assets/menu.js'}}});
  assert.equal(bridge.frames.get('main'),'https://player.example/');
  await bridge.request({networkId:'network-script',requestId:'paused-script',frameId:'main',resourceType:'Script',request:{url:home+'assets/menu.js'}});
  assert.equal(calls.at(-1).method,'Fetch.continueRequest');assert.equal(bridge.homeResourceDocuments.size,0);
});
await check('A browser-observed root Home document authorizes its first asset without networkId',async()=>{
  const {bridge,calls}=requestFixture();
  await bridge.request({requestId:'document',frameId:'main',resourceType:'Document',request:{url:home}});
  await bridge.request({requestId:'script',frameId:'main',resourceType:'Script',request:{url:home+'assets/menu.js'}});
  assert.equal(calls.at(-1).method,'Fetch.continueRequest');
  await bridge.request({requestId:'outside',frameId:'main',resourceType:'Document',request:{url:'https://player.example/'}});
  await bridge.request({requestId:'script2',frameId:'main',resourceType:'Script',request:{url:home+'assets/menu.js'}});
  assert.equal(calls.at(-1).method,'Fetch.fulfillRequest');
});
await check('A pending root document grants neither assets to iframes nor API access',async()=>{
  const {bridge,calls}=requestFixture();await bridge.request({requestId:'document',frameId:'main',resourceType:'Document',request:{url:home}});
  for(const [frameId,type,url,session]of [['child','Script',home+'assets/menu.js',undefined],['main','Script',home+'assets/menu.js','iframe'],['main','Fetch',new URL('/holy-api/sites',home).href,undefined]]){
    await bridge.request({requestId:'blocked',frameId,resourceType:type,request:{url}},session);
    assert.equal(calls.at(-1).method,'Fetch.fulfillRequest');
  }
});
await check('An external root commit without a Document request clears the Home asset grant',async()=>{
  const {bridge,calls}=requestFixture();
  await bridge.request({requestId:'document',frameId:'main',resourceType:'Document',request:{url:home}});
  await bridge.event({method:'Page.frameNavigated',params:{frame:{id:'child',parentId:'main',url:'https://player.example/'}}});
  assert.ok(bridge.ownDocumentRequest,'a child commit cannot clear the root document');
  await bridge.event({method:'Page.frameNavigated',params:{frame:{id:'main',url:'https://player.example/'}}});
  assert.equal(bridge.ownDocumentRequest,null);
  await bridge.request({requestId:'script',frameId:'main',resourceType:'Script',request:{url:home+'assets/menu.js'}});
  assert.equal(calls.at(-1).method,'Fetch.fulfillRequest');
});
await check('Unknown, external or iframe sources cannot use the menu asset exception',async()=>{
  for(const mode of ['unknown','external','iframe','different-frame','forged-referer']){
    const {bridge,calls}=requestFixture();
    if(mode!=='unknown'&&mode!=='forged-referer')await bridge.event({method:'Network.requestWillBeSent',sessionId:mode==='iframe'?'child':undefined,params:{requestId:'network',frameId:mode==='different-frame'?'child-frame':'main',documentURL:mode==='external'?'https://evil.example/':home,type:'Script',request:{url:home+'assets/menu.js'}}});
    await bridge.request({networkId:'network',requestId:'paused',frameId:'main',resourceType:'Script',request:{url:home+'assets/menu.js',headers:{Referer:home}}},mode==='iframe'?'child':undefined);
    assert.equal(calls.at(-1).method,'Fetch.fulfillRequest',mode);assert.equal(calls.at(-1).params.body,'',mode);
  }
});
await check('Correlated menu identity grants neither API access nor other local resources',async()=>{
  for(const [url,type]of [[new URL('/holy-api/sites',home).href,'Fetch'],[home+'other.js','Script'],['http://192.168.1.1/holy/assets/menu.js','Script']]){
    const {bridge,calls}=requestFixture();await bridge.event({method:'Network.requestWillBeSent',params:{requestId:'network',frameId:'main',documentURL:home,type,request:{url}}});
    await bridge.request({networkId:'network',requestId:'paused',frameId:'main',resourceType:type,request:{url}});
    assert.equal(calls.at(-1).method,'Fetch.fulfillRequest',url);
  }
});
await check('Request identity bookkeeping remains bounded during a long episode',async()=>{
  const {bridge}=requestFixture();for(let n=0;n<300;n++)await bridge.event({method:'Network.requestWillBeSent',params:{requestId:String(n),frameId:'main',documentURL:home,type:'Script',request:{url:home+'assets/menu.js'}}});
  assert.equal(bridge.homeResourceDocuments.size,256);
});
function bootFixture() {
  const p=page({homePage:true}),frames=[];let header=null,backHandler;
  p.context.document.querySelector=()=>header;
  p.context.requestAnimationFrame=fn=>frames.push(fn);
  p.context.MutationObserver=class {observe(){} disconnect(){}};
  p.context.performance={now:()=>30000};
  p.context.removeEventListener=()=>{};
  p.context.addEventListener=(type,fn)=>{if(type==='keydown')backHandler=fn;};
  vm.runInContext(homeBootSource([home]),p.context);
  const frame=()=>{const pending=frames.splice(0);for(const fn of pending)fn();};
  return {...p,frame,ready(){header={textContent:'HOLY Inicio Películas Anime',getBoundingClientRect:()=>({width:1920,height:120})};},back(){const e={keyCode:461,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};backHandler(e);return e;}};
}
await check('The new document keeps feedback during a long boot rather than a timed fade',()=>{
  const p=bootFixture();assert.equal(p.root.children.length,1);
  for(let i=0;i<120;i++)p.frame();
  assert.equal(p.root.children[0].removed,undefined);assert.equal(p.back().prevented,true);
  p.ready();p.frame();assert.equal(p.root.children[0].removed,undefined);
  p.frame();assert.equal(p.root.children[0].removed,true);assert.equal(p.back().prevented,undefined);
  assert.equal(p.root.dataset.holyHomePainted,'30000');
});
await check('Boot feedback never covers an Internet player',()=>{
  const p=page();p.context.MutationObserver=class{observe(){}};
  vm.runInContext(homeBootSource([home]),p.context);assert.equal(p.root.children.length,0);
});
console.log(`${passed} comprobaciones de salida rápida, bloqueo del reproductor y animación correctas (sin TV).`);
