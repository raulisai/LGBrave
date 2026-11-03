import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT} from './desktop-config.mjs';
const files = ['test-navigation','test-shields','test-brave-sync','test-ad-cleaner','test-navigation-shield','test-player-safety','test-player-assist',
  'test-turnstile-defer','test-devtools-quiet','test-crash-memory','test-bridge','test-browser-tabs','test-lab-runtime','test-crash-guard','test-holy-logging','test-holy-sites','test-holy-taste',
  'test-playback-policy','test-playback-sources','test-playback-media','test-playback-handoff','test-holy','test-holy-discovery','test-holy-next','test-holy-robust','test-holy-pause','test-holy-versions','test-holy-ui-opening','test-holy-lists','test-holy-web','test-holy-doctor','test-desktop','test-windows-launcher','test-desktop-handoff','test-desktop-repair','test-doctor-coverage','test-app-package','test-tv-profile-store','test-profile-handoff','test-shared-languages','test-peer-sync','test-peer-network','test-web-progress','test-sync-api','test-companion','validate-engine'];
// Tests that start servers or bridges log there by default: keep it out of the owner's real log.
const logs = mkdtempSync(join(tmpdir(),'holy-test-logs-'));
for (const name of files) {
  const result = spawnSync(process.execPath,[`scripts/${name}.mjs`],{cwd:ROOT,stdio:'inherit',windowsHide:true,env:{...process.env,HOLY_LOG_DIR:logs}});
  if (result.error) {console.error(result.error.message);process.exit(1);}
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Pruebas locales correctas (sin TV).');
