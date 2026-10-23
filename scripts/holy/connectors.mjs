import { cuevana, repelishd, jkanime, doramasmp4 } from './sources.mjs';
import { doramasflix, asialiveaction, animeyt } from './more-sources.mjs';

// Every site Holy reads, in the order their rows and search results are shown.
export const CONNECTORS = [cuevana, repelishd, jkanime, animeyt, doramasflix, doramasmp4, asialiveaction];
export const connectorFor = id => CONNECTORS.find(connector => connector.id === id);
