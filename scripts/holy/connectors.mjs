import { cuevana, repelishd, jkanime, doramasmp4 } from './sources.mjs';
import { doramasflix, asialiveaction, animeyt, doramasflixbeer } from './more-sources.mjs';
import { youtube } from './youtube.mjs';

// Every site Holy reads, in the order their rows and search results are shown.
// YouTube is search only: it adds no rows of its own to the catalogue.
export const CONNECTORS = [cuevana, repelishd, jkanime, animeyt, doramasflix, doramasmp4, asialiveaction, doramasflixbeer, youtube];
// Sources taken out for good. Their cached titles and notes are dropped when the catalogue loads.
// 'tmdb' (public IMDb/TMDB catalogue): search worked, but its id-based players (vidfast, vidapi,
// CDNM, Nontongo) never played on this TV in any logged attempt, and every title it could play
// was already on one of the owner's own sites (docs/CATALOGO-PUBLICO-RETIRADO-20261106.md).
// 'pelisflix' and 'onlyflix' (2026-11-17): their players never started on this TV (Nupload 0 of 16,
// OnlyFlix's vidapi/vidfast/nontongo/medmedia 0 of 8) and failed again in the desktop simulation with
// Holy's own filters: Nupload stays empty behind QR «not a robot» adverts, voe.sx answers 404, vidapi 404.
// Their series (Big Bang, Juego de tronos) play on Cuevana (docs/REPRODUCCION-REVISION-20261117.md).
// The connectors stay in more-sources.mjs, unlisted, should their players come back.
export const RETIRED_SOURCES = new Set(['tmdb', 'pelisflix', 'onlyflix']);
export const connectorFor = id => CONNECTORS.find(connector => connector.id === id);
