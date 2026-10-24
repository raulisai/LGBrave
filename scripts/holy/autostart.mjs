import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

// Arranque automático de Holy al iniciar sesión en el Mac (LaunchAgent de usuario, sin root).
// launchd ejecuta el vigilante (`holy-supervisor.mjs`) y lo mantiene vivo; si ya hay otro
// Holy en marcha, el vigilante espera y toma el relevo cuando ese termine.
export const LABEL = 'com.lgapp.holy.mac';
const run = promisify(execFile);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const plistPath = (home = homedir()) => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);

export function plist({ node, script, cwd, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${escape(node)}</string><string>${escape(script)}</string></array>
  <key>WorkingDirectory</key><string>${escape(cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`;
}

export function createAutostart({ cwd = process.cwd(), node = process.execPath, home = homedir(), uid = process.getuid?.() ?? 501, exec = run } = {}) {
  const file = plistPath(home);
  const domain = `gui/${uid}`;
  return {
    file,
    async status() {
      const installed = existsSync(file);
      const loaded = installed && await exec('launchctl', ['print', `${domain}/${LABEL}`]).then(() => true, () => false);
      return { installed, loaded };
    },
    async install() {
      mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
      mkdirSync(join(cwd, '.local', 'logs'), { recursive: true });
      writeFileSync(file, plist({ node, script: join(cwd, 'scripts', 'holy-supervisor.mjs'), cwd, log: join(cwd, '.local', 'logs', 'holy-launchd.log') }));
      await exec('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
      await exec('launchctl', ['bootstrap', domain, file]);
    },
    async uninstall() {
      await exec('launchctl', ['bootout', `${domain}/${LABEL}`]).catch(() => {});
      if (existsSync(file)) unlinkSync(file);
    }
  };
}

// `npm run holy:autostart -- on|off|status`
if (process.argv[1]?.endsWith('/autostart.mjs')) {
  const autostart = createAutostart();
  const action = process.argv[2] || 'status';
  if (action === 'on') await autostart.install();
  else if (action === 'off') await autostart.uninstall();
  console.log(JSON.stringify(await autostart.status()));
}
