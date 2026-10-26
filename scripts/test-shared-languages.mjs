import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Library} from './holy/library.mjs';
import {Preferences} from './preferences.mjs';
import {ProfileState,cleanProfile} from '../desktop/shared/profile-state.mjs';
import {mergeLibraryState} from './holy/taste-state.mjs';
const dir=mkdtempSync(join(tmpdir(),'holy-shared-audio-'));let now=100000;
const item={title:'Show',kind:'dorama',url:'https://source.example/show/1',show:'https://source.example/show'};
const version={id:'latino',kind:'dub',label:'Español latino'};
const make=name=>{const library=new Library(join(dir,name+'-library.json'),()=>now),preferences=new Preferences(join(dir,name+'-preferences.json'));return {library,profile:new ProfileState({library,preferences,now:()=>now})};};
try{
 const a=make('mac'),b=make('windows');let snapshot=null;
 const store={async read(){return structuredClone(snapshot);},async write(value){snapshot=structuredClone(value);return true;}};
 await a.profile.connect(store);a.library.setLanguage(item,version);await a.profile.flush();a.profile.disconnect();
 await b.profile.connect(store);assert.equal(b.library.languageOf(item).id,'latino');
 now+=1000;b.library.setLanguage(item,{id:'coreano',kind:'sub',label:'Coreano · subtítulos en español'});await b.profile.flush();b.profile.disconnect();
 await a.profile.connect(store);assert.equal(a.library.languageOf(item).id,'coreano');
 const older=structuredClone(snapshot);now+=1000;a.library.setLanguage(item,null);await a.profile.flush();a.profile.disconnect();
 await b.profile.connect(store);assert.equal(b.library.languageOf(item),null);
 const mixed=mergeLibraryState(b.profile.capture().library,older.library);assert.deepEqual(mixed.languages,{});
 now+=1000;b.library.setLanguage(item,version);await b.profile.flush();
 assert.equal(new Library(b.library.file).languageOf(item).id,'latino');
 const legacy=structuredClone(snapshot);delete legacy.library.languages;delete legacy.library.tasteMeta.removedLanguages;
 await b.profile.connect({async read(){return legacy;}});assert.equal(b.library.languageOf(item).id,'latino');
 const dirty=structuredClone(snapshot);dirty.library.languages['https://source.example/show?token=SECRET']={...version,at:now,private:'SECRET'};
 assert.ok(!JSON.stringify(cleanProfile(dirty)).includes('SECRET'));
 assert.throws(()=>cleanProfile({...snapshot,library:{...snapshot.library,languages:[]}}));
 const many=make('bounded');for(let n=0;n<301;n++){now++;many.library.setLanguage({url:'https://source.example/show/'+n},version);}
 assert.equal(Object.keys(many.library.languages).length,300);assert.equal(many.library.languageOf({url:'https://source.example/show/300'}).id,'latino');
 assert.equal(many.library.languageOf({url:'https://source.example/show/0'}),null);assert.doesNotThrow(()=>many.profile.capture());
 console.log('Idioma compartido Mac/Windows: ida y vuelta, borrado, versión antigua, persistencia y limpieza correctos (simulado).');
}finally{rmSync(dir,{recursive:true,force:true});}
