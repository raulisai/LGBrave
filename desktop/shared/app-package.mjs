import {existsSync,mkdirSync,readdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

// Windows gives each Store (MSIX) app a private copy of AppData and ends its child processes when
// the app closes or updates. Same paths, different files: comparing environment variables cannot
// see it, so a service started from such an app loses its data and dies with it.
export function packageCaches(local=process.env.LOCALAPPDATA) {
  if(!local)return [];
  try{return readdirSync(join(local,'Packages')).map(name=>({name,cache:join(local,'Packages',name,'LocalCache')})).filter(item=>existsSync(item.cache));}
  catch{return [];}
}
// Private copies of a file under AppData\Roaming or AppData\Local, newest first.
export function packagedCopies(area,relative,local) {
  return packageCaches(local).flatMap(({name,cache})=>{
    const file=join(cache,area,relative);
    try{return [{name,file,at:statSync(file).mtimeMs}];}catch{return [];}
  }).sort((a,b)=>b.at-a.at);
}
// The app this process lives in, or ''. Only a real write shows the redirection.
export function currentPackage({local=process.env.LOCALAPPDATA,write=writeFileSync}={}) {
  if(!local)return '';
  const folder=join(local,'HolyLuma'),name='.package-probe-'+randomUUID(),probe=join(folder,name);
  try{
    mkdirSync(folder,{recursive:true});write(probe,'');
    return packageCaches(local).find(item=>existsSync(join(item.cache,'Local','HolyLuma',name)))?.name||'';
  }catch{return '';}
  finally{try{rmSync(probe,{force:true});}catch{}}
}
// Settings written while a Store app owned the service: adopt them once, atomically.
export function adoptPackagedSettings(target,relative,usable,local) {
  const read=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
  if(usable(read(target)))return '';
  const found=packagedCopies('Local',relative,local).find(item=>usable(read(item.file)));
  if(!found)return '';
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target+'.tmp',readFileSync(found.file),{mode:0o600});renameSync(target+'.tmp',target);
  return found.name;
}
// Explorer opens the shortcut from the user's session, as logging in would. The installed icon
// then starts the service there, outside the app that asked for it.
export async function launchThroughShell({appData=process.env.APPDATA,windows=process.env.SystemRoot||'C:\\Windows',launch=spawn}={}) {
  const link=join(appData||'','Microsoft','Windows','Start Menu','Programs','Holy y Luma.lnk');
  if(!existsSync(link))return false;
  try{
    const child=launch(join(windows,'explorer.exe'),[link],{detached:true,windowsHide:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();return true;
  }catch{return false;}
}
