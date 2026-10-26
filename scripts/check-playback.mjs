import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from './desktop-config.mjs';
import {redact} from './diagnostics.mjs';
import {loadPlaybackMatrix,validatePlaybackMatrix} from './playback-policy.mjs';

const output=join(ROOT,'.local','playback-validation');mkdirSync(output,{recursive:true});
const git=args=>execFileSync('git',args,{cwd:ROOT,windowsHide:true,encoding:'utf8',timeout:10000});
const fingerprint=()=>{
 const paths=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','--','src','scripts','desktop','browser','windows','mac','package.json','package-lock.json','vite.config.js','.github']).trim().split(/\r?\n/).filter(Boolean))].sort();
 const hash=createHash('sha256');for(const file of paths){hash.update(file+'\0');hash.update(readFileSync(resolve(ROOT,file)));}
 return hash.digest('hex');
};
const report={v:1,started:new Date().toISOString(),scope:'Pruebas controladas offline y compilación. No acredita disponibilidad externa ni reproducción física.',node:process.version,platform:process.platform,commit:git(['rev-parse','HEAD']).trim(),checks:[],ok:false};
const save=()=>writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const step=(name,file,args=[],timeout=180000)=>new Promise(resolve=>{
 const started=Date.now();console.log('Validando: '+name);
 const child=spawn(process.execPath,[file,...args],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let tail='',done=false;
 const consume=buffer=>{const text=redact(buffer.toString());tail=(tail+text).slice(-6000);process.stdout.write(text);};
 child.stdout.on('data',consume);child.stderr.on('data',consume);
 const timer=setTimeout(()=>{child.kill();finish(null,'timeout');},timeout);
 const finish=(code,error='')=>{if(done)return;done=true;clearTimeout(timer);report.checks.push({name,ok:code===0&&!error,exitCode:code,durationMs:Date.now()-started,...(error?{error}:{}),...((code!==0||error)?{tail}: {})});save();resolve(code===0&&!error);};
 child.once('error',()=>finish(null,'no se pudo iniciar'));child.once('close',code=>finish(code));
});
try {
 report.matrix=validatePlaybackMatrix(loadPlaybackMatrix());
 report.inputHash=fingerprint();save();
 if(!await step('suite completa','scripts/test-local.mjs'))throw Error('Falló la suite.');
 for(const [name,mode] of [['Luma',null],['Holy TV','holy'],['Holy web','holy-web']]){
  if(!await step('build '+name,'scripts/playback-build.mjs',[mode||'production'],60000))throw Error('Falló build '+name);
 }
 report.outputHash=fingerprint();
 if(report.inputHash!==report.outputHash)throw Error('Cambió código durante la validación. Repite con una revisión estable.');
 report.ok=true;console.log('Validación de reproducción correcta: '+report.matrix.sources+' fuentes; '+report.matrix.cases+' casos documentados.');
} catch(error){report.error=String(error.message||error);process.exitCode=1;console.error(report.error);}
finally{report.finished=new Date().toISOString();save();console.log('Informe: .local/playback-validation/report.json');}
