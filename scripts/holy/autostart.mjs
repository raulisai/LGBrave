import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {fileURLToPath} from 'node:url';
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

// User login only. Prefer the menu app; the service supervises its own child.
// A successful, intentional stop must not be undone by launchd.
export const LABEL = 'com.lgapp.holy.mac';
const run = promisify(execFile);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const plistPath = (home = homedir()) => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);

export function plist({ node, script, executable, cwd, log }) {
  const argumentsXml = (executable ? [executable] : [node, script]).map(value => `<string>${escape(value)}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${argumentsXml}</array>
  <key>WorkingDirectory</key><string>${escape(cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${escape(log)}</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict>
</plist>
`;
}

export function createAutostart({ cwd = process.cwd(), node = process.execPath, home = homedir(), uid = process.getuid?.() ?? 501, exec = run, platform = process.platform,
  appData = process.env.APPDATA || join(home, 'AppData', 'Roaming'), localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local') } = {}) {
  if (platform === 'win32') {
    const file = join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Holy y Luma.lnk');
    return {
      file,
      async status() { const installed = existsSync(file); return { installed, loaded: installed }; },
      async install() {
        const executable = join(localAppData, 'Programs', 'HolyLuma', 'HolyLuma.exe');
        if (!existsSync(executable)) throw Error('Instala primero la aplicación nativa: npm run windows:install.');
        await exec(executable, ['--install'], { windowsHide: true, timeout: 10000 });
        if (!existsSync(file)) throw Error('No se pudo activar el inicio automático de Windows.');
      },
      async uninstall() { if (existsSync(file)) unlinkSync(file); }
    };
  }
  if (platform !== 'darwin') throw Error('El inicio automático está disponible en Windows y macOS.');
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
      const menu = join(home, 'Applications', 'Luma LG.app', 'Contents', 'MacOS', 'LumaMenu');
      writeFileSync(file, plist({ node, script: join(cwd, 'scripts', 'desktop-supervisor.mjs'),
        executable: existsSync(menu) ? menu : undefined, cwd, log: join(cwd, '.local', 'logs', 'holy-launchd.log') }));
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const autostart = createAutostart();
  const action = process.argv[2] || 'status';
  if (!['on', 'off', 'status'].includes(action)) throw Error('Uso: autostart.mjs on|off|status');
  if (action === 'on') await autostart.install();
  else if (action === 'off') await autostart.uninstall();
  console.log(JSON.stringify(await autostart.status()));
}
