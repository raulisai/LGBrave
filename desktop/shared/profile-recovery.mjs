import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {config,webosRegistry} from './desktop-config.mjs';
// The backup holds public registry metadata, never the private key, PIN or passwords.
export function createProfileRecovery({registry=()=>webosRegistry(),device=()=>config().device,home=()=>process.env.HOME||process.env.USERPROFILE||homedir(),cache=join(process.env.LOCALAPPDATA||homedir(),'HolyLuma','profile-recovery.json'),diagnostics}={}) {
  const load=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
  const keyExists=profile=>typeof profile?.privateKey?.openSsh==='string'&&basename(profile.privateKey.openSsh)===profile.privateKey.openSsh&&existsSync(join(home(),'.ssh',profile.privateKey.openSsh));
  const safe=profile=>{
    if(!profile||profile.username!=='prisoner'||!keyExists(profile))return null;
    const out={};for(const field of ['name','host','port','username','type','description','default'])if(['string','number','boolean'].includes(typeof profile[field]))out[field]=profile[field];
    out.privateKey={openSsh:profile.privateKey.openSsh};return out;
  };
  let last='';
  function capture() {
    const {devices}=registry(),profile=safe(devices?.find(item=>item.name===device()));
    if(!profile)return false;
    const content=JSON.stringify({v:1,profile});
    if(content===last)return false;
    mkdirSync(dirname(cache),{recursive:true});writeFileSync(cache+'.tmp',content+'\n',{mode:0o600});renameSync(cache+'.tmp',cache);last=content;return true;
  }
  function restore() {
    const current=registry();
    if(current.devices?.some(item=>item.name===device()))return {restored:false,reason:'present'};
    // An unreadable existing registry must be investigated rather than replaced.
    if(existsSync(current.file)&&!current.devices)return {restored:false,reason:'registry-unreadable'};
    const saved=load(cache),profile=saved?.v===1&&saved.profile?.name===device()?safe(saved.profile):null;
    if(!profile)return {restored:false,reason:'authorization-required'};
    mkdirSync(dirname(current.file),{recursive:true});
    writeFileSync(current.file+'.luma-tmp',JSON.stringify([...(current.devices||[]),profile],null,2)+'\n',{mode:0o600});renameSync(current.file+'.luma-tmp',current.file);
    diagnostics?.event('profile','registry-restored',{source:device()});return {restored:true,reason:'restored-existing-key'};
  }
  return {capture,restore,keyPresent(){return keyExists(registry().devices?.find(item=>item.name===device()));}};
}
