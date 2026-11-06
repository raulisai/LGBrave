import { cuevana, repelishd, jkanime, doramasmp4 } from './sources.mjs';
import { doramasflix, asialiveaction, animeyt, onlyflix, doramasflixbeer, tmdb, pelisflix } from './more-sources.mjs';
import { youtube } from './youtube.mjs';

// Every site Holy reads, in the order their rows and search results are shown.
// YouTube is search only: it adds no rows of its own to the catalogue.
export const CONNECTORS = [cuevana, repelishd, jkanime, animeyt, doramasflix, doramasmp4, asialiveaction, onlyflix, doramasflixbeer, tmdb, pelisflix, youtube];
export const connectorFor = id => CONNECTORS.find(connector => connector.id === id);
