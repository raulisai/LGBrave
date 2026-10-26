// Compatibility for Holy's existing Mac menu; both apps use the shared desktop service.
import * as desktop from './desktop-control.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {webosTool} from './webos-cli.mjs';
import {config, ROOT} from './desktop-config.mjs';
const adapt = value => ({...value,mac:value.running,macIp:value.host,tvIp:value.tv.host,
  level:value.state === 'connected' ? 'green' : value.running ? 'orange' : 'red',
  checks:(value.checks || []).map(detail=>({label:'Revisar',detail,level:'warn'}))});
export const status = async () => adapt(await desktop.doctor());
export const start = async () => adapt(await desktop.start());
export const stop = async () => adapt(await desktop.stop());
export const restart = async () => adapt(await desktop.restart());
export const doctor = async () => {await desktop.restart(); return {...(await status()),done:['Servicio reiniciado; revisa el diagnóstico.']};};
export const open = async () => {
  await promisify(execFile)(process.execPath,[webosTool('ares-launch'),'--device',config().device,'com.lgapp.holy'],{cwd:ROOT,timeout:30000,windowsHide:true});
  return status();
};
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {const run={status,start,stop,restart,doctor,open}[process.argv[2] || 'status']; if(!run)throw Error('Acción desconocida.'); console.log(JSON.stringify(await run()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
