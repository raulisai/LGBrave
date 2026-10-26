import {createHash,createHmac,timingSafeEqual,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {copyFileSync,existsSync} from 'node:fs';
import {cleanProfile} from './profile-state.mjs';
import {mergeLibraryState} from '../../scripts/holy/taste-state.mjs';
export const SYNC_MAX_BYTES=1024*1024;
export const SYNC_WIRE_BYTES=Math.ceil((SYNC_MAX_BYTES+16384)*4/3)+2048;
export function seal(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const data=Buffer.from(JSON.stringify(value));if(data.length>SYNC_MAX_BYTES+16384)throw Error('Perfil demasiado grande.');return{box:1,iv:iv.toString('hex'),data:Buffer.concat([cipher.update(data),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('hex')};}
export function unseal(value,key){if(value?.box!==1||!/^[a-f0-9]{24}$/.test(value.iv||'')||!/^[a-f0-9]{32}$/.test(value.tag||'')||typeof value.data!=='string'||value.data.length>SYNC_WIRE_BYTES||! /^[A-Za-z0-9+/]*={0,2}$/.test(value.data))throw Error('Mensaje cifrado inválido.');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(value.iv,'hex'));decipher.setAuthTag(Buffer.from(value.tag,'hex'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8'));}

const emptyPreferences={searchEngine:'google',categories:[],favorites:[],bookmarksVersion:2};
export const cleanLibrary=library=>cleanProfile({v:1,preferences:emptyPreferences,library}).library;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const libraryHash=library=>createHash('sha256').update(JSON.stringify(canonical(cleanLibrary(library)))).digest('hex');
export const sign=(value,key)=>createHmac('sha256',key).update(JSON.stringify(value)).digest('hex');
export function authentic(value,signature,key){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))return false;
 return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(value,key),'hex'));
}
export class LibraryReplica{
 constructor(library){this.library=library;}
 capture(){return cleanLibrary(this.library);}
 hash(){return libraryHash(this.library);}
 merge(value){
  const before=this.capture(),incoming=cleanLibrary(value),merged=cleanLibrary(mergeLibraryState(before,incoming));
  if(libraryHash(before)===libraryHash(merged))return false;
  const file=this.library.file;if(file&&existsSync(file)&&!existsSync(file+'.before-sync'))copyFileSync(file,file+'.before-sync');
  Object.assign(this.library,merged);
  try{this.library.save();}catch(error){Object.assign(this.library,before);this.library.profileCache=null;throw error;}
  return true;
 }
}
export class SyncProtocol{
 constructor({replica,identity,key,now=Date.now}){Object.assign(this,{replica,identity,key,now});this.seen=new Map();}
 request(ack=''){const library=this.replica.capture(),hash=libraryHash(library);return{v:1,node:this.identity,nonce:randomUUID(),at:this.now(),hash,...(ack!==hash?{library}:{} )};}
 accept(value,signature){
  if(!authentic(value,signature,this.key())||value?.v!==1||!/^[-a-zA-Z0-9]{1,80}$/.test(value.node||'')||value.node===this.identity||!/^[-a-f0-9]{36}$/.test(value.nonce||'')||!Number.isFinite(value.at)||Math.abs(this.now()-value.at)>300000)throw Object.assign(Error('Sincronización no autorizada.'),{status:401});
  for(const [id,at]of this.seen)if(this.now()-at>300000)this.seen.delete(id);
  if(this.seen.has(value.nonce))throw Object.assign(Error('Petición de sincronización repetida.'),{status:409});
  if(this.seen.size>=2000)throw Object.assign(Error('Demasiadas peticiones de sincronización.'),{status:429});
  this.seen.set(value.nonce,this.now());
  if(value.library){const clean=cleanLibrary(value.library);if(libraryHash(clean)!==value.hash)throw Object.assign(Error('Perfil de sincronización inválido.'),{status:400});this.replica.merge(clean);}
  const library=this.replica.capture(),hash=libraryHash(library);
  return{v:1,node:this.identity,nonce:value.nonce,at:this.now(),hash,...(hash!==value.hash?{library}:{} )};
 }
 receive(request,value,signature){
  if(!authentic(value,signature,this.key())||value?.v!==1||value.nonce!==request.nonce||value.node===this.identity||!Number.isFinite(value.at)||Math.abs(this.now()-value.at)>300000)throw Error('La respuesta del otro equipo no es válida.');
  if(value.library){const clean=cleanLibrary(value.library);if(libraryHash(clean)!==value.hash)throw Error('El perfil recibido no coincide con su firma.');this.replica.merge(clean);}
  else if(value.hash!==request.hash)throw Error('El otro equipo no envió los cambios necesarios.');
  return value.hash;
 }
}
