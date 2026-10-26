import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HolyBridge} from './holy/holy-bridge.mjs';
import {Library} from './holy/library.mjs';
import {playbackDescriptor,validDescriptor} from './holy/handoff.mjs';

const directory=mkdtempSync(join(tmpdir(),'holy-playback-handoff-'));
const bridges=[];
const original={source:'doramasflix',kind:'dorama',title:'Between Steps',episode:5,url:'https://doramasflix.io/capitulos/between-steps-1x5',show:'https://doramasflix.io/doramas/between-steps'};
const active={...original,source:'doramasmp4',url:'https://doramasmp4.cyou/episodio/between-steps-5/',show:'https://doramasmp4.cyou/series/between-steps/',language:'Latino'};
try {
  const descriptor=playbackDescriptor({item:active,position:{t:210,d:3000},choice:{kind:'dub',version:'38',token:'private'},versionKind:'dub',target:'https://player.example/?token=private'},'previous');
  assert.deepEqual(descriptor.choice,{kind:'dub'},'Only the audio mode travels; provider IDs and secrets do not');
  assert.equal(JSON.stringify(descriptor).includes('private'),false);
  assert.deepEqual(validDescriptor(descriptor).choice,{kind:'dub'});
  assert.equal(validDescriptor(descriptor).versionKind,'dub');assert.equal(validDescriptor({...descriptor,versionKind:'private'}).versionKind,undefined);
  assert.equal(validDescriptor({...descriptor,choice:{kind:'unsupported'}}).choice,undefined);
  assert.equal(validDescriptor({...descriptor,choice:{kind:'dub',version:'foreign',unknown:'private'}}).choice.version,undefined);

  const library=new Library(join(directory,'library.json'));
  library.setLanguage(original,{id:'38',kind:'dub',label:'Español latino'});
  assert.equal(library.languageOf(active),null,'The active copy has no per-provider stored choice');
  const sub={...original,language:'Subtitulado'};
  const dub={...original,source:'asialiveaction',url:'https://asialiveaction.com/e/between-steps-5/',show:'https://asialiveaction.com/tv/between-steps/',language:'Latino'};
  const calls=[],resolved=[];
  let incoming=descriptor;
  const cdp={
    async evaluate(expression){return expression.includes('JSON.parse(text)')?incoming:true;},
    async call(method,params={}){
      calls.push({method,params});
      if(method==='Page.addScriptToEvaluateOnNewDocument')return{identifier:String(calls.length)};
      return{};
    }
  };
  const catalog={
    version:1,connector:source=>({name:source}),
    elsewhere:async()=>[sub,dub],
    resolve:async(item,choice)=>{resolved.push({source:item.source,choice});return{url:'https://player.example/'+item.source,versionKind:item.source==='doramasflix'?'sub':'dub'};}
  };
  const bridge=new HolyBridge(cdp,{catalog,library,preferencesFile:join(directory,'preferences.json'),recorder:false});
  bridges.push(bridge);
  bridge.mainFrame='main';bridge.frames.set('main','https://player.example/current');
  assert.equal(await bridge.adoptPlayback(),true);
  assert.equal(bridge.session.versionKind,'dub','The playing mode survives handoff without provider IDs');
  assert.deepEqual(bridge.session.choice,{kind:'dub'},'The TV intent survives a change of provider and computer');
  assert.equal(calls.some(call=>call.method==='Page.navigate'),false,'Adoption alone never navigates');
  await bridge.rescue(bridge.session,210);
  assert.equal(bridge.session.item.source,'asialiveaction','Recovery skips subtitled copy after handoff');
  assert.equal(bridge.session.resumeAt,205,'Recovery keeps the position');
  assert.deepEqual(resolved.map(entry=>entry.choice.kind),['dub','dub']);
  assert.deepEqual(calls.filter(call=>call.method==='Page.navigate').map(call=>call.params.url),['https://player.example/asialiveaction']);
  assert.deepEqual(playbackDescriptor(bridge.session,'next').choice,{kind:'dub'},'A second handoff keeps the same audio mode');

  // A saved provider preference must not override an explicit live TV choice.
  await bridge.endSession();
  library.setLanguage(active,{id:'sub-local',kind:'sub',label:'Subtítulos en español'});
  incoming=descriptor;
  assert.equal(await bridge.adoptPlayback(),true);
  assert.deepEqual(bridge.session.choice,{kind:'dub'});
  // Older descriptors remain compatible and use the local preference.
  await bridge.endSession();
  const legacy={...descriptor};delete legacy.choice;incoming=legacy;
  assert.equal(await bridge.adoptPlayback(),true);
  assert.deepEqual(bridge.session.choice,{version:'sub-local',kind:'sub'});
  console.log('Relevo de reproducción: idioma vivo, proveedor distinto, recuperación compatible, posición, privacidad y descriptor antiguo correctos (simulado, sin TV).');
}finally{
  for(const bridge of bridges)await bridge.stop();
  rmSync(directory,{recursive:true,force:true});
}
