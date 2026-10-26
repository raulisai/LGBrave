// Compatibility for the Mac menu. Windows and macOS share one service for both apps.
import * as desktop from './desktop-control.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const adapt = result => ({...result, lab:result.running, server:result.running && result.build.luma, tvIp:result.tv.host, ok:result.state === 'connected'});
export const status = async () => adapt(await desktop.status({probe:true}));
export const start = async () => adapt(await desktop.start());
export const stop = async () => adapt(await desktop.stop());
export const restart = async () => adapt(await desktop.restart());
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const run = {status,start,stop,restart}[process.argv[2] || 'status'];
    if (!run) throw Error('Uso: luma-control.mjs status|start|stop|restart');
    console.log(JSON.stringify(await run()));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
