import assert from 'node:assert/strict';
import vm from 'node:vm';
import {navigationShieldSource} from './navigation-shield.mjs';
import {createEngine,checkRequest} from './filter-engine.mjs';
import {scriptletSource} from './browser-bridge.mjs';
const fixture=(origin,ancestors=[])=>{
 const callbacks={};const open=()=> 'original'; const window={open};
 const context={innerWidth:1920,innerHeight:1080,MutationObserver:class{constructor(callback){callbacks.mutation=callback}observe(){}disconnect(){}},location:{origin,hostname:new URL(origin).hostname,ancestorOrigins:ancestors,assign:url=>{context.destination=url}},URL,window,document:{addEventListener:(k,v)=>callbacks[k]=v}};
 vm.runInNewContext(navigationShieldSource,context);return {window,callbacks,context};
};
const top=fixture('https://cuevana3c.pro');assert.equal(top.window.open('https://ads.example'),null);assert.equal(top.window.__lumaNavigationShield.blockedPopups,1);
top.window.open=()=> 'replaced';assert.equal(top.window.open('about:blank'),null);
vm.runInNewContext(navigationShieldSource,top.context);assert.equal(top.window.__lumaNavigationShield.blockedPopups,2);
assert.equal(fixture('https://embed.example',['https://cuevana3c.pro']).window.open('https://ad.example'),null);
assert.equal(fixture('https://example.com').window.open(),'original');
assert.equal(fixture('https://cuevana3c.pro.attacker.example').window.open(),'original');
assert.equal(fixture('https://jkanime.net').window.open('https://ad.example'),null);
assert.equal(fixture('https://embed.example',['https://jkanime.net']).window.open('https://ad.example'),null);
assert.equal(fixture('https://repelishd.blog').window.open('https://ad.example'),null);
assert.equal(fixture('https://embed.example',['https://repelishd.blog']).window.open('https://ad.example'),null);
assert.equal(fixture('https://repelishd.blog.attacker.example').window.open(),'original');
assert.equal(fixture('https://jkanime.net.attacker.example').window.open(),'original');
const a={tagName:'A',target:'_blank',href:'https://cuevana3c.pro/pelicula/test'};top.callbacks.click({composedPath:()=>[a]});assert.equal(a.target,'_self');
let prevented=false;
const server={hasAttribute:key=>key==='data-server',getAttribute:()=> 'https://tungtungsahur.cuevana3c.pro/?token=fixture'};
top.callbacks.click({isTrusted:true,button:0,composedPath:()=>[server],preventDefault(){prevented=true},stopImmediatePropagation(){}});
assert.equal(top.context.destination,'https://tungtungsahur.cuevana3c.pro/?token=fixture&pops=false');assert.equal(prevented,true);
top.context.destination=null;
const unknown={...server,getAttribute:()=> 'https://unrelated.example/player'};
top.callbacks.click({isTrusted:true,button:0,composedPath:()=>[unknown],preventDefault(){throw Error('Must keep unknown original action')}});
assert.equal(top.context.destination,null);
const overlay={tagName:'DIV',style:{position:'fixed',zIndex:'2147483647',opacity:'0.01'},onclick:function(){window.open('https://ad.example')},getBoundingClientRect:()=>({width:1920,height:1080}),remove(){this.removed=true}};
top.callbacks.mutation([{addedNodes:[overlay]}]);assert.equal(overlay.removed,true);assert.equal(top.window.__lumaNavigationShield.blockedOverlays,1);
const controls={...overlay,removed:false,onclick:function(){video.play()}};
top.callbacks.mutation([{addedNodes:[controls]}]);assert.equal(controls.removed,false,'Legitimate player controls must survive');
const small={...overlay,removed:false,getBoundingClientRect:()=>({width:20,height:20})};
top.callbacks.mutation([{addedNodes:[small]}]);assert.equal(small.removed,false);
const qrFixture = () => {
 const f=fixture('https://jkanime.net');const mutations=f.callbacks.mutation;
 const doc={body:{textContent:"Confirm you're not a robot. Scan the qr-code with your phone"},querySelector:()=>({tagName:'CANVAS'})};
 const frame={tagName:'IFRAME',style:{position:'fixed',zIndex:'2147483646'},isConnected:true,
  getAttribute:()=>null,hasAttribute:()=>false,contentDocument:doc,
  getBoundingClientRect:()=>({width:1920,height:1080}),addEventListener(){},
  remove(){this.removed=true;this.isConnected=false}};
 return {...f,mutations,doc,frame};
};
const qr=qrFixture();qr.mutations([{addedNodes:[qr.frame]}]);
assert.equal(qr.frame.removed,true,'Observed QR ad signature removed');
assert.equal(qr.window.__lumaNavigationShield.blockedQrOverlays,1);
for(const change of [
 f=>f.doc.body.textContent='Scan this QR to log in to your account',
 f=>f.frame.getAttribute=()=> 'https://player.example/embed',
 f=>f.frame.hasAttribute=name=>name==='srcdoc',
 f=>f.frame.style.position='relative',
 f=>f.frame.style.zIndex='100',
 f=>f.frame.getBoundingClientRect=()=>({width:300,height:200}),
 f=>f.doc.querySelector=()=>null,
 f=>Object.defineProperty(f.frame,'contentDocument',{get(){throw Error('Cross-origin')}})
]){
 const f=qrFixture();change(f);f.mutations([{addedNodes:[f.frame]}]);
 assert.notEqual(f.frame.removed,true,'Legitimate/unknown QR or player must survive');
}
const late=qrFixture();late.doc.body.textContent='';late.mutations([{addedNodes:[late.frame]}]);
assert.notEqual(late.frame.removed,true);
late.doc.body.textContent="Confirm you're not a robot. Scan the qr-code with your phone";
// The child-document observer sees content inserted after the iframe itself.
late.callbacks.mutation([]);assert.equal(late.frame.removed,true,'Late QR body removed');
const e=createEngine();
assert.equal(checkRequest(e,'https://db.unboltsecole.com/rotating-path/123','https://jkanime.net/','Script').should_block,true);
assert.equal(checkRequest(e,'https://db.unboltsecole.com/rotating-path/123','https://unrelated.example/','Script').should_block,false);
for(const [url,type] of [
 ['https://jkanime.net/jkplayer/um?test=1','Document'],
 ['https://cdn.jkdesa.com/assets/dplayer-1.27.js','Script'],
 ['https://nika.playmudos.com/video.m3u8','XHR'],
 ['https://cdn3.ducvomes.com/ja/segs/2/v1x/video/20v2x.ts','XHR']
])assert.equal(checkRequest(e,url,'https://jkanime.net/',type).should_block,false,url);
for(const url of ['https://latgw.fun/js/lib.js','https://cuevana3c.pro/js/varkus.js','https://bh.dingerepilobe.com/a','https://gw.waughyciliary.com/a'])assert.equal(checkRequest(e,url,'https://cuevana3c.pro/','Script').should_block,true,url);
for(const [url,type] of [['https://cuevana3c.pro/js/popa.js','Script'],['https://cuevana3c.pro/js/movie-player.js','Script'],['https://tungtungsahur.cuevana3c.pro/?token=test','Document'],['https://video.example/master.txt','XHR'],['https://video.example/seg-1.woff2','XHR'],['https://video.example/movie.mp4','Media']])assert.equal(checkRequest(e,url,'https://cuevana3c.pro/',type).should_block,false,url);
assert.equal(checkRequest(e,'https://latgw.fun/','https://unrelated.example/','Script').should_block,false);
assert.ok(e.urlCosmeticResources('https://cuevana3c.pro/').injected_script.includes('noWindowOpenIf'));
assert.ok(e.urlCosmeticResources('https://streamwish.to/').injected_script.includes('setConstant'));
const sandbox={Request,XMLHttpRequest:function(){},EventTarget,console,document:{currentScript:null}};
sandbox.self=sandbox;sandbox.window=sandbox;
vm.runInNewContext(scriptletSource(e.urlCosmeticResources('https://streamwish.to/').injected_script),sandbox);
assert.equal(sandbox.xRds,true,'Resource dependencies must execute, not just appear in generated JS');
assert.equal(sandbox.cRAds,false);
console.log('Escudo de navegación: ámbito, ventanas, enlaces, recursos y medios correctos.');
