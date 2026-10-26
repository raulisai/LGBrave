import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {ROOT} from './desktop-config.mjs';
if(process.platform !== 'win32') throw Error('La bandeja WinForms requiere Windows. En Mac usa el menú existente o desktop:start.');
const exe=join(process.env.LOCALAPPDATA,'Programs','HolyLuma','HolyLuma.exe');
if(!existsSync(exe))throw Error('Instala la aplicación con npm run windows:install.');
const child=spawn(exe, ['--background'],
  {cwd:ROOT,windowsHide:true,detached:true,stdio:'ignore'});
await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
child.unref();
