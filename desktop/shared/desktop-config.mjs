import {networkInterfaces, homedir, hostname} from 'node:os';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {execFileSync} from 'node:child_process';
const require = createRequire(import.meta.url);

// Background launchers can omit APPDATA/LOCALAPPDATA. Use this Windows user's
// standard directories consistently for both the SDK registry and installed app.
export function userDataEnvironment(env = process.env, platform = process.platform, home = homedir()) {
  if (platform !== 'win32') return {...env};
  const profile = env.USERPROFILE || home;
  return {...env, USERPROFILE: profile,
    APPDATA: env.APPDATA || join(profile, 'AppData', 'Roaming'),
    LOCALAPPDATA: env.LOCALAPPDATA || join(profile, 'AppData', 'Local')};
}
if (process.platform === 'win32') {
  const normalized = userDataEnvironment();
  for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
    if (!process.env[key]) process.env[key] = normalized[key];
}


export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CONFIG_FILE = join(ROOT, '.local', 'desktop-config.json');
export const readJSON = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
export function config() {
  const saved = readJSON(CONFIG_FILE) || {};
  return {device: process.env.TV_DEVICE || saved.device || 'lg-lab', tvIp: process.env.TV_IP || saved.tvIp || '',
    host: process.env.LAB_HOST || saved.host || '', peers: Array.isArray(saved.peers) ? saved.peers : []};
}
export function saveConfig(value) {
  const device = String(value.device || 'lg-lab');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(device)) throw Error('Nombre de perfil inválido.');
  const host = value.host || '', tvIp = value.tvIp || '';
  const peers = value.peers || [];
  const validHost = value => isIP(value)===4 || (!/^[\d.]+$/.test(value)&&/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value));
  if (!Array.isArray(peers)||![host, tvIp, ...peers].every(item => typeof item === 'string' && (!item || validHost(item))) || peers.length > 8) throw Error('Dirección inválida. Usa una IPv4 o nombre de equipo, sin puerto.');
  mkdirSync(dirname(CONFIG_FILE), {recursive:true});
  writeFileSync(CONFIG_FILE, JSON.stringify({device, host, tvIp, peers}, null, 2));
}
// One public registry locator is shared by the host, Doctor and CLI controls.
export function webosRegistry({env=process.env,home=homedir(),read=readJSON}={}) {
  let dataDir=join('.webos','tv');
  try{dataDir=readJSON(require.resolve('@webos-tools/cli/files/conf/config.json'))?.dataDir||dataDir;}catch{}
  const base=env.APPDATA||env.HOME||env.USERPROFILE||home;
  const file=join(base,dataDir,'novacom-devices.json');
  const devices=read(file);
  return {file,devices:Array.isArray(devices)?devices:null};
}
export function tvAddress() {
  const cfg=config(),registry=webosRegistry();
  const profile=registry.devices?.find(entry=>entry.name===cfg.device);
  return {host:cfg.tvIp||profile?.host||'',port:Number(profile?.port)||9922,device:cfg.device,configured:!!profile,
    needsUpdate:!!(cfg.tvIp&&profile?.host&&cfg.tvIp!==profile.host)};
}
export function lanAddress(interfaces = networkInterfaces(), cfg = config()) {
  if (cfg.host) return cfg.host;
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter(item => item.family === 'IPv4' && !item.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))
    .map(item => ({...item, name})));
  const target = cfg.tvIp || tvAddress().host;
  const score = item => (/vEthernet|virtual|docker|wsl|vmware|vbox|bridge|utun|tailscale/i.test(item.name) ? -100 : 0)
    + (target && item.address.split('.').slice(0,3).join('.') === target.split('.').slice(0,3).join('.') ? 20 : 0);
  return candidates.sort((a,b) => score(b)-score(a))[0]?.address || '127.0.0.1';
}
// How this computer names itself on the TV («Name|IP»), so the other one can say who serves it.
export const computerLabel = () => `${hostname().replace(/\.(local|lan|home)$/i, '')}|${lanAddress()}`;
// A friendly name for this computer's own web pages, best effort only (the IP in lanAddress()
// always works). On macOS, its Bonjour/mDNS name (e.g. the user renamed it to serve Holy at
// «holy-mac.local»); on Windows/Linux, the computer's own name, which a home network's
// NetBIOS/LLMNR usually resolves by itself, with no «.local» needed. '' when nothing to offer.
export function localName({platform = process.platform, run = (file, args) => execFileSync(file, args, {encoding: 'utf8', timeout: 2000}), hostOf = hostname} = {}) {
  try {
    if (platform === 'darwin') {
      const name = run('scutil', ['--get', 'LocalHostName']).trim();
      return /^[A-Za-z0-9-]{1,63}$/.test(name) ? name + '.local' : '';
    }
  } catch { /* No Bonjour name set, or scutil unavailable. */ }
  const name = hostOf().replace(/\.(local|lan|home)$/i, '');
  return /^[A-Za-z0-9-]{1,63}$/.test(name) ? name : '';
}
export const lumaOrigin = () => process.env.LAB_ORIGIN || `http://${lanAddress()}:43187`;
export function safePath(root, requested) {
  const base = resolve(root), path = resolve(base, requested);
  const prefix = base.endsWith('\\') || base.endsWith('/') ? base : base + (process.platform === 'win32' ? '\\' : '/');
  return path.startsWith(prefix) ? path : null;
}

// Compare process contexts without exposing account paths, keys or sync credentials.
export function userDataContext({env=process.env,home=homedir(),registry=webosRegistry({env,home}),platform=process.platform}={}) {
  const normalize=value=>{const text=String(value||'').replace(/\\/g,'/').replace(/\/$/,'');return platform==='win32'?text.toLowerCase():text;};
  const values=[registry.file,env.HOME||env.USERPROFILE||home,env.LOCALAPPDATA||join(home,'.config')].map(normalize);
  return {id:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
}
