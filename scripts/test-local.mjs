import {spawnSync} from 'node:child_process';
import {ROOT} from './desktop-config.mjs';
const files = ['test-navigation','test-shields','test-brave-sync','test-ad-cleaner','test-navigation-shield','test-player-assist',
  'test-turnstile-defer','test-devtools-quiet','test-crash-memory','test-bridge','test-browser-tabs','test-lab-runtime','test-crash-guard',
  'test-playback-policy','test-playback-sources','test-playback-media','test-playback-handoff','test-holy','test-holy-discovery','test-holy-next','test-holy-robust','test-holy-pause','test-holy-versions','test-holy-ui-opening','test-holy-lists','test-holy-web','test-holy-doctor','test-desktop','test-windows-launcher','test-desktop-handoff','test-desktop-repair','test-doctor-coverage','test-tv-profile-store','test-profile-handoff','test-shared-languages','test-peer-sync','test-peer-network','test-web-progress','test-sync-api','test-companion','validate-engine'];
for (const name of files) {
  const result = spawnSync(process.execPath,[`scripts/${name}.mjs`],{cwd:ROOT,stdio:'inherit',windowsHide:true});
  if (result.error) {console.error(result.error.message);process.exit(1);}
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Pruebas locales correctas (sin TV).');
