import { Agent } from 'undici';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { privateAddress, publicTarget } from './public-url.mjs';

const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const fault = (code, message) => Object.assign(new Error(message), { code });
const resolveAddresses = async host => (await lookup(host, { all: true, verbatim: true })).map(entry => entry.address);

export async function publicAddresses(host, resolveHost = resolveAddresses) {
  const records = isIP(host) ? [host] : await resolveHost(host);
  const addresses = records?.map(entry => typeof entry === 'string' ? entry : entry.address);
  if (!addresses?.length || addresses.some(address => !isIP(address) || privateAddress(address))) {
    throw fault('PRIVATE_DESTINATION', 'La descarga apunta a una dirección de red privada o no válida.');
  }
  return addresses.map(address => ({ address, family: isIP(address) }));
}

// This lookup is used by the TCP/TLS connection itself, not just a preflight DNS check.
export function publicLookup(resolveHost) {
  return (host, options, callback) => {
    publicAddresses(host, resolveHost).then(records => {
      const choices = options.family ? records.filter(record => record.family === options.family) : records;
      if (!choices.length) throw fault('DNS_ADDRESS', 'No hay una dirección compatible para el sitio.');
      if (options.all) callback(null, choices);
      else callback(null, choices[0].address, choices[0].family);
    }).catch(callback);
  };
}

export async function readLimited(response, maxBytes = MAX_PAGE_BYTES) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw fault('RESPONSE_TOO_LARGE', 'La respuesta del sitio supera el tamaño permitido.');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const parts = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw fault('RESPONSE_TOO_LARGE', 'La respuesta del sitio supera el tamaño permitido.');
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

// Bound active downloads AND callers waiting behind them, including redirects/body decoding.
function downloadSlots(limit, maxWaiting) {
  let active = 0; const waiting = [];
  return async signal => {
    signal.throwIfAborted();
    if (active >= limit) {
      if (waiting.length >= maxWaiting) throw fault('DOWNLOAD_BUSY', 'Hay demasiadas descargas pendientes; vuelve a intentarlo.');
      await new Promise((resolve, reject) => {
        const entry = { resolve: () => { signal.removeEventListener('abort', cancel); resolve(); } };
        const cancel = () => { const index = waiting.indexOf(entry); if (index >= 0) waiting.splice(index, 1); reject(signal.reason); };
        signal.addEventListener('abort', cancel, { once: true });
        waiting.push(entry);
      });
    } else active++;
    return () => { const next = waiting.shift(); if (next) next.resolve(); else active--; };
  };
}

export function createPublicFetcher({ resolveHost, fetcher = (...args) => globalThis.fetch(...args), connections = 8, maxWaiting = 64 } = {}) {
  const dispatcher = new Agent({ connect: { lookup: publicLookup(resolveHost), timeout: 10000 }, connections: 2 });
  const acquire = downloadSlots(connections, maxWaiting);
  const request = async (value, { timeout, maxBytes = MAX_PAGE_BYTES, maxRedirects = 5, signal: callerSignal, redirect = 'follow', ...options } = {}) => {
    const deadline = timeout === undefined && callerSignal ? null : AbortSignal.timeout(timeout ?? 15000);
    const signal = callerSignal && deadline ? AbortSignal.any([callerSignal, deadline]) : callerSignal || deadline;
    const release = await acquire(signal);
    let response;
    try {
      let url = new URL(value), method = String(options.method || 'GET').toUpperCase(), body = options.body;
      const headers = new Headers(options.headers);
      for (let hop = 0; ; hop++) {
        signal.throwIfAborted();
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !publicTarget(url.href)) {
          throw fault('PRIVATE_DESTINATION', 'La descarga requiere un sitio público sin credenciales en la dirección.');
        }
        // Check every hop even for an already pooled socket. DNS failures fail closed.
        const host = url.hostname.replace(/^\[|\]$/g, '');
        let signalCleanup;
        await Promise.race([publicAddresses(host, resolveHost), new Promise((_, reject) => {
          if (signal.aborted) { reject(signal.reason); return; }
          const aborted = () => reject(signal.reason);
          signal.addEventListener('abort', aborted, { once: true });
          // Removed below when resolution wins, without retaining request data for the timeout.
          signalCleanup = () => signal.removeEventListener('abort', aborted);
        })]).finally(() => signalCleanup?.());
        response = await fetcher(url.href, { ...options, method, body, headers, signal, redirect: 'manual', dispatcher });
        const location = response.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(response.status) && location && redirect !== 'manual') {
          await response.body?.cancel().catch(() => {});
          if (redirect === 'error' || hop >= maxRedirects) throw fault('REDIRECT_LIMIT', 'El sitio redirige demasiadas veces.');
          const next = new URL(location, url);
          if (next.origin !== url.origin) for (const name of ['authorization', 'proxy-authorization', 'cookie', 'x-csrf-token', 'x-requested-with']) headers.delete(name);
          if ((response.status === 303 && method !== 'HEAD') || ([301, 302].includes(response.status) && method === 'POST')) {
            method = 'GET'; body = undefined; headers.delete('content-type'); headers.delete('content-length');
          }
          url = next; continue;
        }
        const bytes = await readLimited(response, maxBytes);
        const result = new Response([204, 205, 304].includes(response.status) || method === 'HEAD' ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
        Object.defineProperties(result, { url: { value: url.href }, redirected: { value: hop > 0 } });
        return result;
      }
    } finally { release(); }
  };
  // Only for isolated tests / short-lived tools; the service reuses its bounded connections.
  request.close = () => dispatcher.close();
  return request;
}

export const publicFetch = createPublicFetcher();
