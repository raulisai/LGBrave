import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

// The server downloads pages on behalf of whoever asks (episode lists, versions, players), so it
// must never be steered at this computer, the home network or a router. Titles live on public
// https sites with a real name: anything else is refused before a single request is made.
const LOCAL_NAME = /(^|\.)(localhost|local|lan|home|internal|intranet|corp|localdomain|home\.arpa)$/i;

const privateV4 = ([a, b, c]) =>
  a === 0 || a === 10 || a === 127 || a >= 224 ||
  (a === 100 && b >= 64 && b <= 127) ||           // carrier-grade NAT
  (a === 169 && b === 254) ||                     // link-local (router / cloud metadata)
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 198 && (b === 18 || b === 19));          // benchmarking

// True for any address that is not a normal public one (IPv4 or IPv6).
export function privateAddress(address) {
  const value = String(address || '').replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  const kind = isIP(value);
  if (kind === 4) return privateV4(value.split('.').map(Number));
  if (kind !== 6) return true;
  // IPv4 carried inside IPv6 (::ffff:a.b.c.d, 64:ff9b::a.b.c.d): judge the IPv4 part.
  const embedded = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value);
  if (embedded) return privateV4(embedded[1].split('.').map(Number));
  const mapped = /^(?:0{0,4}:){2,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (mapped) { const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16); return privateV4([high >> 8, high & 255, low >> 8, low & 255]); }
  if (value === '::' || value === '::1') return true;
  const first = parseInt(value.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 ||           // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 ||                // link-local fe80::/10
    (first & 0xff00) === 0xff00 ||                // multicast
    value.startsWith('2001:db8');                 // documentation
}

// Shape only (no network): https, no credentials, a real public-looking name.
export function publicHostURL(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || isIP(host) || !host.includes('.') || LOCAL_NAME.test(host)) return null;
  return url;
}

// Any scheme: is this address aimed at a public host (not an IP of this network, not a LAN name)?
export function publicTarget(value) {
  try {
    const host = new URL(String(value || '')).hostname.replace(/^\[|\]$/g, '');
    return isIP(host) ? !privateAddress(host) : host.includes('.') && !LOCAL_NAME.test(host);
  } catch { return false; }
}

const defaultResolve = async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);

// Shape plus DNS: refuses names that point at a private address (the usual SSRF disguise).
// A name that does not resolve at all is let through: the request that follows fails by itself.
// Addresses are checked here and again by the OS when fetching, so this narrows the window for
// DNS rebinding rather than closing it; the Host check and the origin rules cover the rest.
export async function publicHttpsURL(value, { resolve = defaultResolve, timeout = 1500 } = {}) {
  const url = publicHostURL(value);
  if (!url) return false;
  let addresses;
  try {
    addresses = await Promise.race([resolve(url.hostname), new Promise((_, reject) => setTimeout(() => reject(Error('dns')), timeout).unref())]);
  } catch { return true; }
  return Array.isArray(addresses) && addresses.every(address => !privateAddress(address));
}
