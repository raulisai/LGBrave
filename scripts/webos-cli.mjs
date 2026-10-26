import {createRequire} from 'node:module';
import {join, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {tvAddress, ROOT} from './desktop-config.mjs';
const require = createRequire(import.meta.url);
// Execute the CLI's actual JS entry point, never a POSIX shim or a Windows .cmd shell.
export const webosTool = name => {
  const packagePath = require.resolve('@webos-tools/cli/package.json');
  const info = require(packagePath);
  if (!info.bin[name]) throw Error('Herramienta webOS desconocida.');
  return join(dirname(packagePath),info.bin[name]);
};
export function syncDeviceProfile({device,tvIp}) {
  if (!tvIp) return;
  const current = tvAddress();
  const action = current.configured ? '--modify' : '--add';
  execFileSync(process.execPath,[webosTool('ares-setup-device'),action,device,'--info',`host=${tvIp}`,
    ...(!current.configured ? ['--info','port=9922','--info','username=prisoner'] : [])],
    {cwd:ROOT,timeout:10000,windowsHide:true,stdio:['ignore','pipe','pipe']});
}
