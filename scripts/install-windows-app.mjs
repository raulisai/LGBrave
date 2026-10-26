import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,existsSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './desktop-config.mjs';
if(process.platform!=='win32') throw Error('La aplicación de bandeja se instala en Windows.');
const compiler=['Framework64','Framework'].map(framework=>join(process.env.SystemRoot,'Microsoft.NET',framework,'v4.0.30319','csc.exe')).find(existsSync);
if(!compiler) throw Error('No se encontró el compilador de .NET Framework incluido en Windows.');
const buildOnly=process.argv.includes('--build-only');
const directory=join(process.env.LOCALAPPDATA,'Programs','HolyLuma');
const exe=join(directory,'HolyLuma.exe');
const wasInstalled=existsSync(exe);
const startupLink=join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs','Startup','Holy y Luma.lnk');
const autostart=process.argv.includes('--without-autostart')?false:!wasInstalled||existsSync(startupLink);
const build=join(ROOT,'.local','windows-native');mkdirSync(build,{recursive:true});
const output=join(build,'HolyLuma.exe');
async function run(binary,args) {
  await new Promise((resolve,reject)=>{
    const explain=error=>error.code==='UNKNOWN'&&binary.endsWith('.exe')?
      Error('Windows no permitió ejecutar la nueva aplicación. Comprueba Device Guard o la política de aplicaciones de tu equipo. Se conserva la instalación anterior.'):error;
    let child;
    try{child=spawn(binary,args,{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch(error){reject(explain(error));return;}
    let output='';
    child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
    const timer=setTimeout(()=>{child.kill();reject(Error('La instalación tardó demasiado: '+output));},45000);
    child.once('error',error=>{clearTimeout(timer);reject(explain(error));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(output||'Error de instalación: '+code));});
  });
}
await run(compiler,['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:Microsoft.CSharp.dll','/out:'+output,join(ROOT,'windows','HolyLuma.cs')]);
// Validate the new binary and configuration before touching the running icon.
writeFileSync(join(build,'installation.json'),JSON.stringify({root:ROOT,node:process.execPath},null,2));
rmSync(join(build,'self-test.json'),{force:true});
await run(output,['--self-test']);
if(!JSON.parse(readFileSync(join(build,'self-test.json'),'utf8')).ok)throw Error('Falló la autoprueba de la nueva aplicación.');
if(buildOnly) {
  console.log(JSON.stringify({built:true,exe:output,selfTest:true,installed:false}));
} else {
mkdirSync(directory,{recursive:true});
await run(output,['--stop-for-update']);
copyFileSync(output,exe);
writeFileSync(join(directory,'installation.json'),JSON.stringify({root:ROOT,node:process.execPath},null,2));
await run(exe,['--install',...(autostart?[]:['--without-autostart'])]);
await run(exe,['--self-test']);
const receipt=JSON.parse(readFileSync(join(directory,'installed.json'),'utf8'));
const validation=JSON.parse(readFileSync(join(directory,'self-test.json'),'utf8'));
if(receipt.autostart!==autostart||!validation.ok)throw Error('No se pudo verificar la instalación o el arranque automático.');
console.log(JSON.stringify({installed:true,exe,autostart,selfTest:true}));
const child=spawn(exe,['--background'],{cwd:directory,windowsHide:true,detached:true,stdio:'ignore'});
await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
