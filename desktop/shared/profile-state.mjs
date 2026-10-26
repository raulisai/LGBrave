import {cleanTasteMeta,cleanLanguages,mergeLibraryState} from '../../scripts/holy/taste-state.mjs';
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {copyFileSync,existsSync} from 'node:fs';
import {SEARCH_ENGINES} from '../../src/navigation.js';

const text=(value,max=160)=>typeof value==='string'?value.slice(0,max):'';
const number=value=>Number.isFinite(value)&&value>=0?Math.min(value,31536000000000):0;
const words=value=>Array.isArray(value)?value.slice(0,12).map(value=>text(value,60)).filter(Boolean):[];
export function publicURL(value) {
  try {
    const url=new URL(value);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.href.length>2048)return '';
    // Only catalogue/source addresses travel, never signed player links or credentials.
    if([...url.searchParams.keys()].some(name=>/token|auth|password|secret|signature|session|api.?key/i.test(name)))return '';
    url.hash='';return url.href;
  }catch{return '';}
}
export function cleanItem(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const url=publicURL(value.url);if(!url||!url.startsWith('https:'))return null;
  const item={url};
  for(const field of ['source','kind','title','subtitle','country','language','overview','year','rating'])item[field]=text(value[field],field==='overview'?800:160);
  for(const field of ['show','poster','backdrop'])item[field]=publicURL(value[field]);
  item.genres=words(value.genres);item.studios=words(value.studios);
  item.episode=Number.isFinite(value.episode)?Math.max(0,value.episode):text(value.episode,24)||null;
  return item;
}
export function cleanProfile(snapshot) {
  if(!snapshot||snapshot.v!==1||!snapshot.preferences||!snapshot.library)throw Error('El perfil compartido no tiene un formato compatible.');
  const pref=snapshot.preferences, lib=snapshot.library;
  if(!Array.isArray(pref.categories)||pref.categories.length>8||!Array.isArray(pref.favorites)||pref.favorites.length>200 ||
    !Array.isArray(lib.entries)||lib.entries.length>300||!Array.isArray(lib.votes)||lib.votes.length>500||!Array.isArray(lib.prefs)||lib.prefs.length>1000)throw Error('El perfil compartido excede los límites.');
  if(lib.languages!==undefined&&(!lib.languages||typeof lib.languages!=='object'||Array.isArray(lib.languages)||Object.keys(lib.languages).length>300))throw Error('Las preferencias de idioma compartidas exceden los límites.');
  const categories=[...new Set(pref.categories.map(name=>text(name,24).trim()).filter(Boolean))];
  const favorites=pref.favorites.flatMap(value=>{
    const url=publicURL(value?.url),category=text(value?.category,24).trim();
    return url&&categories.includes(category)?[{url,title:text(value.title,60)||new URL(url).hostname,category}]:[];
  });
  const entries=lib.entries.flatMap(value=>{
    const item=cleanItem(value);if(!item)return [];
    return [{...item,key:item.show||item.url,t:number(value.t),duration:number(value.duration),plays:Math.max(1,number(value.plays)),
      watched:number(value.watched),updatedAt:number(value.updatedAt),finished:value.finished===true}];
  });
  const votes=lib.votes.flatMap(value=>{
    const item=cleanItem(value);return item&&[2,1,-1].includes(value.vote)?[{...item,key:item.show||item.url,vote:value.vote,at:number(value.at)}]:[];
  });
  const prefs=lib.prefs.flatMap(value=>['genre','studio','country'].includes(value?.type)&&[1,-1].includes(value.value)&&text(value.name,60).trim()
    ?[{type:value.type,name:text(value.name,60).trim(),value:value.value,at:number(value.at)}]:[]);
  const asked=Object.fromEntries(Object.entries(lib.asked&&typeof lib.asked==='object'?lib.asked:{}).slice(-200)
    .filter(([key,at])=>publicURL(key)&&Number.isFinite(at)).map(([key,at])=>[publicURL(key),number(at)]));
  const tasteMeta=cleanTasteMeta(lib.tasteMeta);
  tasteMeta.removedEntries=Object.fromEntries(Object.entries(tasteMeta.removedEntries).filter(([key])=>publicURL(key)));
  return {v:1,preferences:{searchEngine:SEARCH_ENGINES.some(item=>item.id===pref.searchEngine)?pref.searchEngine:'google',bookmarksVersion:2,categories,favorites},library:{entries,votes,prefs,asked,tasteMeta,languages:cleanLanguages(lib.languages)}};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ProfileState {
  constructor({preferences,library,now=Date.now,log=console.log,diagnostics}={}) {
    Object.assign(this,{preferences,library,now,log,diagnostics});this.state='local';this.generation=0;
  }
  capture() {return cleanProfile({v:1,preferences:this.preferences,library:this.library});}
  async connect(store) {
    const generation=++this.generation;this.store=store;this.retryStore=null;this.hash=null;this.state='connecting';
    try {
      const incoming=await store.read();
      if(generation!==this.generation)return;
      if(incoming) {
        const clean=cleanProfile(incoming);
        // Backups contain user settings only, never SSH credentials or player tokens.
        for(const target of [this.preferences.file,this.library.file])if(target&&existsSync(target)&&!existsSync(target+'.before-sync'))copyFileSync(target,target+'.before-sync');
        const before=this.capture();
        const merged=mergeLibraryState(before.library,clean.library);
        try {
          Object.assign(this.preferences,clean.preferences);this.preferences.syncCategories();this.preferences.save();
          Object.assign(this.library,merged);this.library.save();
        } catch(error) {
          Object.assign(this.preferences,before.preferences);Object.assign(this.library,before.library);
          this.library.profileCache=null;
          // Each file is atomic; restore both logical records if either save fails.
          try{this.preferences.save();}catch{}
          try{this.library.save();}catch{}
          throw Error('No se pudo guardar el perfil compartido; se conserva la copia local.');
        }
        this.hash=digest(clean);this.updated=this.now();this.state='synced';
      } else this.state='local';
      this.error='';
      this.diagnostics?.event('profile','merged',{count:this.library.votes.length,state:this.state});
    }catch(error){if(generation===this.generation){this.state='error';this.error=String(error.message).slice(0,160);this.store=null;this.retryStore=store;this.retryAt=this.now()+30000;this.diagnostics?.event('profile','merge-error',{error},'error');}}
  }
  flush() {
    if(this.pending)return this.pending;
    if(!this.store){
      if(this.retryStore&&this.now()>=this.retryAt)return this.connect(this.retryStore).then(()=>this.store?this.flush():false);
      return Promise.resolve(false);
    }
    const generation=this.generation,store=this.store;
    const task=(async()=>{
      try {
        const profile=this.capture(),hash=digest(profile);
        if(hash===this.hash)return false;
        const saved=await store.write({...profile,updated:this.now(),source:hostname()});
        if(generation!==this.generation)return false;
        if(saved!==false){this.hash=hash;this.updated=this.now();this.state='synced';this.error='';return true;}
      }catch(error){if(generation===this.generation){this.state='error';this.error=String(error.message).slice(0,160);}}
      return false;
    })();
    this.pending=task;return task.finally(()=>{if(this.pending===task)this.pending=null;});
  }
  disconnect(){this.generation++;this.store=null;this.retryStore=null;if(this.state!=='error')this.state='local';}
  status(){return {state:this.state,updated:this.updated||null,error:this.error||'',transport:'TV por SSH; gustos combinados y copias locales persistentes'};}
}
