import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from './desktop-config.mjs';
if(process.platform!=='win32'){
 console.log('Lanzador nativo: prueba de carpetas reales reservada a Windows.');
}else{
 const output=execFileSync(process.execPath,[join(ROOT,'scripts/install-windows-app.mjs'),'--build-only'],{cwd:ROOT,windowsHide:true,encoding:'utf8',timeout:60000});
 const receipt=JSON.parse(output.trim());
 const self=JSON.parse(readFileSync(join(ROOT,'.local/windows-native/self-test.json'),'utf8'));
 assert.equal(receipt.selfTest,true);assert.equal(receipt.installed,false,'La prueba no debe reinstalar el panel');
 assert.equal(self.environmentVerified,true);
 assert.match(self.environmentHash,/^[A-F0-9]{64}$/);
 console.log('Lanzador Windows real: compilación y Node hijo conservan carpetas bajo entorno normal y contaminado; sin instalar ni navegar TV.');
}
