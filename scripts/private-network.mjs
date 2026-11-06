import { isIP } from 'node:net';
import { privateAddress } from './holy/public-url.mjs';

// A page from the Internet has no business asking for things on this computer or the home
// network (the router, the NAS, Holy's own server): that is how a hostile ad would try to read
// the owner's tastes or push an action. Pages of the home network (Holy, Luma, the lab) may.
const LAN_NAME = /(^|\.)(localhost|local|lan|internal|localdomain|home\.arpa)$/i;
export function privateHost(host) {
  const name = String(host || '').replace(/^\[|\]$/g, '');
  if (!name) return false;
  return isIP(name) ? privateAddress(name) : !name.includes('.') || LAN_NAME.test(name);
}

// Is `target` on this network while the page asking (`source`) is not? Pages being opened
// (resourceType Document) are left alone: typing the router's address in the bar is allowed.
export function intoPrivateNetwork(target, source, resourceType) {
  if (resourceType === 'Document') return false;
  try {
    const to = new URL(target), from = new URL(source);
    if (!/^https?:$/.test(to.protocol) || !/^https?:$/.test(from.protocol)) return false;
    return privateHost(to.hostname) && !privateHost(from.hostname);
  } catch { return false; }
}
