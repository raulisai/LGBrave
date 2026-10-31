import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {config,webosRegistry} from './desktop-config.mjs';
import {packagedCopies} from './app-package.mjs';
// The backup holds public registry metadata, never the private key, PIN or passwords. An encrypted
// key also needs its passphrase, which only the SDK's own registry keeps: a registry another app's
// private AppData holds is moved whole, and the backup alone cannot rebuild such a profile.
export function createProfileRecovery({registry=()=>webosRegistry(),device=()=>config().device,home=()=>process.env.HOME||process.env.USERPROFILE||homedir(),cache=join(process.env.LOCALAPPDATA||homedir(),'HolyLuma','profile-recovery.json'),packaged=()=>packagedCopies('Roaming',webosRegistry().relative),diagnostics}={}) {
  const load=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
  const keyExists=profile=>typeof profile?.privateKey?.openSsh==='string'&&basename(profile.privateKey.openSsh)===profile.privateKey.openSsh&&existsSync(join(home(),'.ssh',profile.privateKey.openSsh));
  const safe=profile=>{
    if(!profile||profile.username!=='prisoner'||!keyExists(profile))return null;
    const out={};for(const field of ['name','host','port','username','type','profile','description','default','files'])if(['string','number','boolean'].includes(typeof profile[field]))out[field]=profile[field];
    out.privateKey={openSsh:profile.privateKey.openSsh};return out;
  };
  const encrypted=profile=>{try{return readFileSync(join(home(),'.ssh',profile.privateKey.openSsh),'utf8').slice(0,200).includes('ENCRYPTED');}catch{return false;}};
  const fromBackup=()=>{
    const saved=load(cache),profile=saved?.v===1&&saved.profile?.name===device()?safe(saved.profile):null;
    return profile&&!encrypted(profile)?profile:null;
  };
  const fromPackage=()=>{
    for(const source of packaged()){
      const entries=load(source.file),found=Array.isArray(entries)?entries.find(item=>item?.name===device()):null,profile=safe(found);
      if(profile)return {...source,profile:typeof found.passphrase==='string'?{...profile,passphrase:found.passphrase}:profile};
    }
    return null;
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
    const found=fromPackage(),profile=found?.profile||fromBackup();
    if(!profile)return {restored:false,reason:'authorization-required'};
    mkdirSync(dirname(current.file),{recursive:true});
    writeFileSync(current.file+'.luma-tmp',JSON.stringify([...(current.devices||[]),profile],null,2)+'\n',{mode:0o600});renameSync(current.file+'.luma-tmp',current.file);
    diagnostics?.event('profile','registry-restored',{source:found?.name||device()});return {restored:true,reason:'restored-existing-key'};
  }
  function inspect() {
    const current=registry(),profile=current.devices?.find(item=>item.name===device());
    return {registry:current.devices?'ok':existsSync(current.file)?'unreadable':'missing',profilePresent:!!profile,keyPresent:keyExists(profile),backupUsable:!!fromBackup(),packagedProfile:!!fromPackage()};
  }
  return {capture,restore,inspect,keyPresent(){return keyExists(registry().devices?.find(item=>item.name===device()));}};
}
