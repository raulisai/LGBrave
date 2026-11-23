import net from 'node:net';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {config, saveConfig, tvAddress, lanAddress, webosRegistry} from './desktop-config.mjs';
import {syncDeviceProfile} from '../../scripts/webos-cli.mjs';
const require = createRequire(import.meta.url);

// The router hands the TV a new IP now and then (.134 → .154 → .155, 18–19/11) and the
// service kept knocking on the old one. When the saved address stops answering, look on
// this computer's /24 for something with the webOS developer port open, and accept it only
// if it lets this computer in with its own webOS key: that key works on the user's TV alone,
// so a printer or a neighbour's LG with Developer Mode is never mistaken for it.

export function tcpOpen(host, port, timeout = 1200) {
  return new Promise(resolve => {
    const socket = net.connect({host, port});
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Every other address of this computer's /24 (home networks), never itself.
export function subnetHosts(lan) {
  if (net.isIP(lan) !== 4 || !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(lan)) return [];
  const prefix = lan.split('.').slice(0, 3).join('.');
  return Array.from({length: 254}, (_, i) => `${prefix}.${i + 1}`).filter(ip => ip !== lan);
}

export async function scanPort(hosts, port, {open = tcpOpen, timeout = 1500, batch = 64} = {}) {
  const found = [];
  for (let i = 0; i < hosts.length; i += batch) {
    const slice = hosts.slice(i, i + batch);
    const results = await Promise.all(slice.map(host => open(host, port, timeout)));
    slice.forEach((host, index) => { if (results[index]) found.push(host); });
  }
  return found;
}

// SSH login with the webOS profile's key (the same one the SDK uses); true only if it is accepted.
export function sshKeyAccepted(host, profile, {home = process.env.USERPROFILE || process.env.HOME || homedir(), timeout = 8000} = {}) {
  return new Promise(resolve => {
    let privateKey;
    try { privateKey = readFileSync(join(home, '.ssh', profile.privateKey?.openSsh || '')); } catch { resolve(false); return; }
    let Client;
    try { Client = createRequire(require.resolve('@webos-tools/cli/package.json'))('ssh2').Client; } catch { resolve(false); return; }
    const ssh = new Client();
    let settled = false;
    const done = value => { if (settled) return; settled = true; clearTimeout(timer); try { ssh.end(); } catch { /* already closed */ } resolve(value); };
    const timer = setTimeout(() => done(false), timeout + 1000);
    ssh.once('ready', () => done(true));
    ssh.once('error', () => done(false));
    ssh.once('close', () => done(false));
    try {
      ssh.connect({host, port: Number(profile.port) || 9922, username: profile.username || 'prisoner', privateKey,
        passphrase: profile.passphrase || undefined, readyTimeout: timeout,
        algorithms: {kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1']}});
    } catch { done(false); }
  });
}

export async function findMovedTv({current, lan, port = 9922, open = tcpOpen, verify}) {
  const candidates = await scanPort(subnetHosts(lan).filter(ip => ip !== current), port, {open});
  for (const host of candidates) if (await verify(host)) return {host, candidates: candidates.length};
  return {host: '', candidates: candidates.length};
}

// Runs from the service loop. It looks only while the TV is offline, the saved address does
// not answer at all (a TV that answers but refuses is a different problem), and at most every
// `interval` (doubling up to `maxInterval` while nothing is found, e.g. the TV is off).
export function createTvFinder({address, lan, profile, save, log = () => {}, now = Date.now, open = tcpOpen,
  verify = host => sshKeyAccepted(host, profile()), interval = 60000, maxInterval = 600000, find = findMovedTv} = {}) {
  let next = 0, wait = interval, running = null;
  async function run() {
    const tv = address();
    if (!tv.host || !tv.configured || !profile()) return {skipped: 'not-configured'};
    if (await open(tv.host, tv.port)) { wait = interval; return {skipped: 'answers'}; }
    const result = await find({current: tv.host, lan: lan(), port: tv.port, open, verify});
    if (!result.host) {
      next = now() + wait; wait = Math.min(wait * 2, maxInterval);
      log('tv-search', {state: 'not-found', candidates: result.candidates});
      return {found: ''};
    }
    save(result.host);
    wait = interval;
    log('tv-moved', {state: 'found', from: tv.host, to: result.host});
    return {found: result.host, from: tv.host};
  }
  const start = () => {
    running = run().catch(error => { log('tv-search', {state: 'error', error}); return {found: ''}; }).finally(() => { running = null; });
    return running;
  };
  return {
    maybe(state) {
      if (state !== 'offline' || running || now() < next) return null;
      next = now() + interval;
      return start();
    },
    // Doctor: look right now, whatever the wait (still one search at a time).
    search() { return running || start(); },
    get busy() { return !!running; },
  };
}

// This computer's real wiring: saved config, webOS profile and its key.
export const tvProfile = () => webosRegistry().devices?.find(entry => entry.name === config().device);
export function saveTvAddress(tvIp) { saveConfig({...config(), tvIp}); syncDeviceProfile(config()); }
export const localTvFinder = (options = {}) => createTvFinder({address: tvAddress, lan: lanAddress, profile: tvProfile, save: saveTvAddress, ...options});
