import { networkInterfaces } from 'node:os';

// Holy is a separate webOS app that reuses Luma's engine. Its own id lets both
// stay installed; only the one whose runtime is running gets the Mac's help.
export const APP_ID = 'com.lgapp.holy';
export const PORT = Number(process.env.HOLY_PORT) || 43190;
export const HOME_PATH = '/holy/';

// The Mac's LAN address changes; prefer an explicit one, then the first private IPv4.
export function lanAddress() {
  if (process.env.LAB_HOST) return process.env.LAB_HOST;
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal && /^(192\.168|10|172\.(1[6-9]|2\d|3[01]))\./.test(item.address)) return item.address;
    }
  }
  return '127.0.0.1';
}
export const origin = () => process.env.LAB_ORIGIN || `http://${lanAddress()}:${PORT}`;
export const packagedPrefix = `file:///media/developer/apps/usr/palm/applications/${APP_ID}/`;
