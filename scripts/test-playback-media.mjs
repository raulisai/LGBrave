import assert from 'node:assert/strict';
import vm from 'node:vm';
import {holySeek,holyResume,seekSource,resumeSource} from './holy/page-scripts.mjs';
import {HolyBridge} from './holy/holy-bridge.mjs';

// Run the actual page functions in separate player worlds, then drive the real
// bridge methods through those worlds. This is controlled CDP/DOM simulation,
// not provider availability or physical TV playback.
const video=(duration,options={})=>{
 let time=options.t??1;
 const listeners={};
 const v={duration,paused:options.paused??false,ended:false,readyState:options.ready??4,networkState:2,error:null,
  clientWidth:options.width??1920,clientHeight:options.height??1080,dataset:{},buffered:{length:0},plays:0,ignoreSeek:options.ignoreSeek??false,
  get currentTime(){return time;},set currentTime(value){if(!this.ignoreSeek)time=value;},
  addEventListener(name,fn){(listeners[name]??=[]).push(fn);},
  getBoundingClientRect(){return{width:this.clientWidth,height:this.clientHeight};},
  async play(){this.plays++;if(options.rejectPlay)throw Error('provider rejected play');this.paused=false;for(const fn of listeners.play||[])fn();}
 };
 return v;
};
const world=(direct=[],shadow=[])=>{
 const win={};win.top=win;
 const shadowRoot={querySelectorAll:selector=>selector==='video'?shadow:[]};
 const document={querySelectorAll:selector=>selector==='video'?direct:selector==='*'&&shadow.length?[{shadowRoot}]:[],querySelector:()=>null};
 return vm.createContext({window:win,document,location:{href:'https://player.example/fixture',hostname:'player.example',pathname:'/fixture'},getComputedStyle:()=>({visibility:'visible'}),setTimeout,clearTimeout});
};
const evaluate=async(ctx,expression)=>JSON.parse(JSON.stringify(await vm.runInContext(expression,ctx)));
const ad=video(120,{t:2,width:320,height:180}),feature=video(3000,{t:10});
const adWorld=world([ad]),featureWorld=world([],[feature]);
assert.equal(await evaluate(adWorld,seekSource(30,3000)),false);
assert.equal(ad.currentTime,2,'An advert cannot acknowledge a feature seek');
assert.equal(await evaluate(featureWorld,seekSource(30,3000)),true);
assert.equal(feature.currentTime,30,'Seek traverses shadow DOM');
feature.currentTime=10;feature.ignoreSeek=true;
assert.equal(await evaluate(featureWorld,seekSource(30,3000)),false,'A setter that ignores the seek cannot acknowledge success');
feature.ignoreSeek=false;feature.readyState=0;
assert.equal(await evaluate(featureWorld,seekSource(30,3000)),false,'No seek before metadata readiness');
feature.readyState=4;
const together=world([ad,feature]);feature.currentTime=1;ad.currentTime=2;
assert.equal(await evaluate(together,seekSource(30)),true);
assert.equal(feature.currentTime,30);assert.equal(ad.currentTime,2,'Without duration, choose the longer feature');
feature.paused=ad.paused=true;
assert.equal(await evaluate(adWorld,resumeSource(3000)),false);assert.equal(ad.plays,0);
assert.equal(await evaluate(featureWorld,resumeSource(3000)),true);assert.equal(feature.plays,1);assert.equal(feature.paused,false);
const rejecting=video(3000,{paused:true,rejectPlay:true});
assert.equal(await evaluate(world([rejecting]),resumeSource(3000)),false);assert.equal(rejecting.paused,true);

const hanging=video(3000,{paused:true});hanging.play=()=>new Promise(()=>{});const hangingWorld=world([hanging]);hangingWorld.setTimeout=callback=>{queueMicrotask(callback);return 1;};hangingWorld.clearTimeout=()=>{};assert.equal(await evaluate(hangingWorld,resumeSource(3000)),false,'An unresolved play promise has a deadline');

// Actual exported functions are serializable/self-contained for CDP worlds.
assert.equal(typeof holySeek,'function');assert.equal(typeof holyResume,'function');
const makeBridge=()=>{
 const worlds=new Map([[11,adWorld],[12,featureWorld]]);
 const calls=[];
 const bridge=Object.create(HolyBridge.prototype);
 Object.assign(bridge,{
  stopped:false,watching:false,navigation:{phase:'complete'},mainFrame:'main',frames:new Map([['main','https://player.example/fixture']]),
  midStall:25000,stallTimeout:20000,endStall:6000,pauseDelay:1200,serverTimeout:28000,startTimeout:45000,emptyTimeout:15000,
  catalog:{},library:{progress(){throw Error('No persistence expected during the seek handshake');}},
  session:{token:1,item:{title:'Feature',url:'https://source.example/fixture',kind:'movie'},key:'feature',phase:'opening',opened:Date.now(),resumeAt:30,lastSave:0,queue:[],tried:new Set()},
  isHome:()=>false,recordPlayback(){},curtain:async()=>{},status:async()=>{},playerContexts:async()=>[{id:11},{id:12}],
  cdp:{async call(method,params){calls.push({method,params});assert.equal(method,'Runtime.evaluate');return{result:{value:await evaluate(worlds.get(params.contextId),params.expression)}};}}
 });
 return{bridge,calls};
};
feature.currentTime=10;feature.paused=false;ad.currentTime=2;ad.paused=false;
const a=makeBridge();await a.bridge.watch();
assert.equal(feature.currentTime,30,'Opening passes the observed duration before session.position is saved');
assert.equal(ad.currentTime,2);
assert.equal(a.bridge.session.phase,'playing');assert.equal(a.bridge.session.resumePending,null);
const seeks=a.calls.filter(x=>x.params.expression.includes('function holySeek'));
assert.deepEqual(seeks.map(x=>x.params.contextId),[11,12]);
assert.ok(seeks.every(x=>x.params.expression.endsWith('(30,3000)')),'Both worlds receive the feature duration');

// A deferred seek retries the feature, never the earlier advert context.
feature.currentTime=10;feature.ignoreSeek=true;ad.currentTime=2;
const b=makeBridge();await b.bridge.watch();
assert.equal(b.bridge.session.resumePending.duration,3000);
assert.equal(feature.currentTime,10);assert.equal(ad.currentTime,2);
feature.ignoreSeek=false;await b.bridge.watch();
assert.equal(b.bridge.session.resumePending,null);assert.equal(feature.currentTime,30);assert.equal(ad.currentTime,2);

// Explicit resume honors the same feature duration. A missing feature retains hold.
feature.paused=ad.paused=true;feature.plays=ad.plays=0;
b.bridge.session.position={t:30,d:3000};b.bridge.session.userPaused=b.bridge.session.lastPaused=true;
await b.bridge.resumeVideo(b.bridge.session);
assert.equal(feature.plays,1);assert.equal(ad.plays,0);assert.equal(feature.paused,false);
feature.paused=true;b.bridge.playerContexts=async()=>[{id:11}];
await b.bridge.resumeVideo(b.bridge.session);
assert.equal(ad.plays,0);assert.equal(b.bridge.isUserPaused(b.bridge.session),true);
await b.bridge.watch();
assert.equal(ad.plays,0);assert.equal(feature.paused,true,'A paused missing feature is not replaced or autoplayed');
const cancelled=makeBridge();feature.paused=true;feature.plays=0;cancelled.bridge.session.position={t:30,d:3000};const actualEvaluate=cancelled.bridge.evaluateWithGesture.bind(cancelled.bridge);cancelled.bridge.evaluateWithGesture=async(expression,id,sessionId)=>{const result=await actualEvaluate(expression,id,sessionId);if(id===11)cancelled.bridge.session={token:2};return result;};await cancelled.bridge.resumeVideo(cancelled.bridge.session);assert.equal(feature.plays,0,'A cancelled session cannot resume another frame later');
console.log('Medio observado: seek confirmado, duración, shadow DOM, dos contextos, reintento, play explícito y pausa protegida correctos (sin TV).');
