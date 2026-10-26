// Holy is a separate webOS app that reuses Luma's engine. Its own id lets both
// stay installed; only the one whose runtime is running gets the Mac's help.
export const APP_ID = 'com.lgapp.holy';
export const PORT = Number(process.env.HOLY_PORT) || 43190;
export const HOME_PATH = '/holy/';

// Shared LAN selection skips virtual Windows adapters.
export {lanAddress} from '../desktop-config.mjs';
import {lanAddress} from '../desktop-config.mjs';
export const origin = () => process.env.HOLY_ORIGIN || `http://${lanAddress()}:${PORT}`;
export const packagedPrefix = `file:///media/developer/apps/usr/palm/applications/${APP_ID}/`;
