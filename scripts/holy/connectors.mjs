import { cuevana, repelishd, jkanime, doramasmp4 } from './sources.mjs';
import { doramasflix, asialiveaction, animeyt, onlyflix, doramasflixbeer, pelisflix } from './more-sources.mjs';
import { youtube } from './youtube.mjs';

// Every site Holy reads, in the order their rows and search results are shown.
// YouTube is search only: it adds no rows of its own to the catalogue.
export const CONNECTORS = [cuevana, repelishd, jkanime, animeyt, doramasflix, doramasmp4, asialiveaction, onlyflix, doramasflixbeer, pelisflix, youtube];
// Sources taken out for good. Their cached titles and notes are dropped when the catalogue loads.
// 'tmdb' (public IMDb/TMDB catalogue): search worked, but its id-based players (vidfast, vidapi,
// CDNM, Nontongo) never played on this TV in any logged attempt, and every title it could play
// was already on one of the owner's own sites (docs/CATALOGO-PUBLICO-RETIRADO-20261106.md).
export const RETIRED_SOURCES = new Set(['tmdb']);
export const connectorFor = id => CONNECTORS.find(connector => connector.id === id);
