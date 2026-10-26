import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Preferences} from './preferences.mjs';
import {Library} from './holy/library.mjs';
import {HolyBridge} from './holy/holy-bridge.mjs';
import {ProfileState,cleanProfile,publicURL} from '../desktop/shared/profile-state.mjs';
import {playbackDescriptor,validDescriptor} from './holy/handoff.mjs';
const dir=mkdtempSync(join(tmpdir(),'luma-profile-handoff-'));let passed=0;
const check=async(name,fn)=>{await fn();passed++;};
const item={source:'jkanime',kind:'anime',url:'https://jkanime.net/one-piece/7/',show:'https://jkanime.net/one-piece/',title:'One Piece',episode:7,genres:['Aventura']};
const make=name=>{const preferences=new Preferences(join(dir,name+'-settings.json')),library=new Library(join(dir,name+'-library.json'));return{preferences,library,profile:new ProfileState({preferences,library})};};
try {
  let remote=null;
  const store={async read(){return structuredClone(remote);},async write(value){remote=structuredClone(value);return true;}};
  const mac=make('mac'),pc=make('pc');
  await check('First computer publishes its settings and playback position',async()=>{
    await mac.profile.connect(store);mac.preferences.setSearchEngine('brave');mac.library.start(item);mac.library.progress(item.show,item.url,123,1200);mac.library.vote(item,2);
    assert.equal(await mac.profile.flush(),true);assert.equal(await mac.profile.flush(),false);
  });
  await check('Second computer restores state after the first is powered off',async()=>{
    mac.profile.disconnect();await pc.profile.connect(store);
    assert.equal(pc.preferences.searchEngine,'brave');assert.equal(pc.library.get(item.show).t,123);assert.equal(pc.library.voteOf(item),2);
    assert.equal(pc.profile.status().state,'synced');
  });
  await check('Deletes remain deleted on reverse takeover',async()=>{
    pc.preferences.removeCategory('Anime');pc.library.clearVotes();await pc.profile.flush();pc.profile.disconnect();await mac.profile.connect(store);
    assert.equal(mac.preferences.categories.includes('Anime'),false);assert.equal(mac.library.votes.length,0);
  });
  await check('A TV restart keeps each computer local data when temporary cache is absent',async()=>{
    const before=pc.library.entries.length;remote=null;await pc.profile.connect(store);assert.equal(pc.library.entries.length,before);assert.equal(await pc.profile.flush(),true);
  });
  await check('Incompatible remote profile never replaces local settings',async()=>{
    const before=pc.preferences.searchEngine;await pc.profile.connect({async read(){return{v:99};}});
    assert.equal(pc.profile.status().state,'error');assert.equal(pc.preferences.searchEngine,before);
  });
  await check('Snapshots exclude signed URLs, credentials, unknown fields and oversized shape',()=>{
    assert.equal(publicURL('https://u:p@example.com/'),'');assert.equal(publicURL('https://example.com/?token=secret'),'');
    const clean=cleanProfile({...remote,unknown:'secret',library:{...remote.library,entries:[{...item,key:item.show,player:'https://player.example/?token=secret',t:12,duration:50}]}});
    assert.equal(JSON.stringify(clean).includes('secret'),false);assert.throws(()=>cleanProfile({...remote,preferences:{...remote.preferences,categories:Array(9).fill('x')}}));
  });
  await check('A late previous connection cannot replace newer state',async()=>{
    let deliver;const pending=pc.profile.connect({read:()=>new Promise(resolve=>deliver=resolve)});
    await pc.profile.connect(store);const before=pc.preferences.searchEngine;
    deliver({...remote,preferences:{...remote.preferences,searchEngine:'bing'}});await pending;
    assert.equal(pc.preferences.searchEngine,before);
  });
  await check('A failed import restores both local records',async()=>{
    const before=pc.profile.capture(),save=pc.library.save;
    pc.library.save=()=>{throw Error('disk full');};
    try {
      await pc.profile.connect({async read(){return {...remote,preferences:{...remote.preferences,searchEngine:'bing'}};}});
      assert.equal(pc.profile.status().state,'error');
      assert.deepEqual(pc.profile.capture(),before);
    }finally{pc.library.save=save;}
  });
  await check('Playback handoff carries only a public source item',()=>{
    const descriptor=playbackDescriptor({item,position:{t:123,d:1200},target:'https://player.example/?token=secret'},'previous');
    assert.equal(JSON.stringify(descriptor).includes('secret'),false);assert.equal(validDescriptor(descriptor).item.url,item.url);
    assert.equal(validDescriptor({...descriptor,item:{...item,url:'https://evil.example/'}}),null);
  });
  await check('A temporary profile failure retries without overwriting unknown remote data',async()=>{
    let now=1000,reads=0,writes=0;
    const state=make('retry');state.profile.now=()=>now;
    const recovering={async read(){if(++reads===1)throw Error('temporary');return remote;},async write(){writes++;return true;}};
    await state.profile.connect(recovering);
    assert.equal(state.profile.state,'error');assert.equal(await state.profile.flush(),false);assert.equal(writes,0);
    now+=30000;await state.profile.flush();
    assert.equal(reads,2);assert.equal(state.profile.state,'synced');
    state.profile.disconnect();
  });
  await check('A new bridge adopts the current video without navigating or seeking',async()=>{
    const calls=[];const descriptor=playbackDescriptor({item,position:{t:123,d:1200}},'previous');
    const cdp={target:{id:'holy'},async evaluate(expression){calls.push(expression);return expression.includes('JSON.parse(text)')?descriptor:true;},async call(method){calls.push(method);return{};}};
    const bridge=new HolyBridge(cdp,{lists:false,preferencesFile:join(dir,'adopt-settings.json'),library:pc.library,catalog:{},recorder:false});
    bridge.mainFrame='main';bridge.frames.set('main','https://player.example/?token=secret');
    assert.equal(await bridge.adoptPlayback(),true);assert.equal(bridge.session.phase,'playing');assert.equal(bridge.session.resumeAt,0);
    assert.equal(calls.includes('Page.navigate'),false);assert.equal(bridge.session.position.t,123);
    await bridge.stop();
  });
  console.log(`${passed} comprobaciones de dos computadoras, perfil y reproducción transparente correctas (simuladas, sin TV).`);
}finally{rmSync(dir,{recursive:true,force:true});}
