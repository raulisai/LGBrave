import { genre } from '../scripts/holy/sources.mjs';

// One genre vocabulary for tastes: the sites' own (Spanish and English names alike).
export const genreLabel = value => genre(String(value || '')) || String(value || '').trim();
