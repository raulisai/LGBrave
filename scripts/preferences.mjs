import { readFileSync, mkdirSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEARCH_ENGINES } from '../src/navigation.js';

const valid = value => SEARCH_ENGINES.some(engine => engine.id === value);
const MAX_FAVORITES = 200;
const MAX_CATEGORIES = 8;
export const DEFAULT_CATEGORIES = ['Anime', 'Películas', 'Doramas'];
const FALLBACK_CATEGORY = 'Otros';
const BOOKMARKS_VERSION = 2;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

// The owner's own pages. They are added once (and again only by the 0.8 migration); each can be removed.
const SEEDS = {
  Anime: [['AnimeYT', 'https://animeyt.cc/'], ['AnimeOnline Ninja', 'https://ww3.animeonline.ninja/'], ['JKAnime', 'https://jkanime.net/'], ['Asia Live Action', 'https://asialiveaction.com/']],
  'Películas': [['Cuevana 3', 'https://cuevana3c.pro/'], ['RePelisHD', 'https://repelishd.blog/'], ['FrameTV', 'https://framextv.xyz/'], ['OnlyFlix', 'https://onlyflix.to/']],
  Doramas: [['DoramasFlix', 'https://doramasflix.io/'], ['DoramasFlix Beer', 'https://doramasflix.beer/'], ['DoramasFlix In', 'https://doramasflix.in/'], ['Doramasia', 'https://doramasia.com/'], ['DoramasMP4', 'https://doramasmp4.cyou/']]
};
// Example bookmarks that shipped before version 2; the migration drops them unless the owner kept customising.
const OLD_EXAMPLE_URLS = new Set(['https://www.crunchyroll.com/', 'https://www3.animeflv.net/', 'https://www.netflix.com/', 'https://www.disneyplus.com/', 'https://www.primevideo.com/',
  'https://www.max.com/', 'https://www.youtube.com/', 'https://tv.apple.com/', 'https://pluto.tv/', 'https://www.cinepolis.com/', 'https://www.filminlatino.mx/',
  'https://es.wikipedia.org/', 'https://www.reddit.com/', 'https://github.com/', 'https://stackoverflow.com/', 'https://www.notion.so/', 'https://drive.google.com/', 'https://mail.google.com/']);

function favoriteURL(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function categoryName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return name || FALLBACK_CATEGORY;
}

function cleanFavorites(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map(item => ({ url: favoriteURL(item?.url), title: String(item?.title ?? '').trim().slice(0, 60), category: categoryName(item?.category) }))
    .filter(item => item.url && !seen.has(item.category + '\n' + item.url) && seen.add(item.category + '\n' + item.url))
    .map(item => ({ url: item.url, title: item.title || new URL(item.url).hostname.replace(/^www\./, ''), category: item.category }))
    .slice(-MAX_FAVORITES);
}

export class Preferences {
  constructor(file = '.local/browser-settings.json') {
    this.file = file;
    let data = {};
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
      if (!record(data)) throw Error('shape');
    } catch {
      data = {};
      // Keep malformed or unsupported data available for recovery.
      try { copyFileSync(file, `${file}.dañado-${Date.now()}`); } catch { /* First run. */ }
    }
    this.searchEngine = valid(data.searchEngine) ? data.searchEngine : 'google';
    // 0.6.x stored favorites without a category: they move to "Otros".
    this.favorites = cleanFavorites(data.favorites);
    this.categories = [];
    for (const name of Array.isArray(data.categories) ? data.categories : DEFAULT_CATEGORIES) this.addCategoryName(name);
    if (data.bookmarksVersion !== BOOKMARKS_VERSION) {
      // First run, or upgrade from the example bookmarks: install the owner's pages and keep anything else they saved.
      const seeded = cleanFavorites(Object.entries(SEEDS).flatMap(([category, items]) => items.map(([title, url]) => ({ title, url, category }))));
      const seededURLs = new Set(seeded.map(item => item.url));
      const kept = this.favorites.filter(item => !seededURLs.has(item.url) && !(data.bookmarksVersion === 1 && OLD_EXAMPLE_URLS.has(item.url)));
      this.favorites = [...seeded, ...kept];
      this.categories = [];
      for (const name of DEFAULT_CATEGORIES) this.addCategoryName(name);
      this.syncCategories();
      this.save();
    }
    this.syncCategories();
  }
  addCategoryName(value) {
    const name = categoryName(value);
    if (!this.categories.some(item => item.toLowerCase() === name.toLowerCase()) && this.categories.length < MAX_CATEGORIES) this.categories.push(name);
    return this.categories.find(item => item.toLowerCase() === name.toLowerCase()) || null;
  }
  // Every bookmark's category exists. Categories are the owner's: they stay even when empty.
  syncCategories() {
    for (const item of this.favorites) {
      const name = this.addCategoryName(item.category);
      if (name) { item.category = name; continue; }
      // Old or imported files may exceed the limit. Keep every page in one
      // overflow bucket without letting the category list grow to nine.
      let fallback = this.categories.find(category => category.toLowerCase() === FALLBACK_CATEGORY.toLowerCase());
      if (!fallback) {
        const displaced = this.categories[MAX_CATEGORIES - 1];
        fallback = FALLBACK_CATEGORY;
        this.categories[MAX_CATEGORIES - 1] = fallback;
        for (const favorite of this.favorites) if (favorite.category.toLowerCase() === displaced.toLowerCase()) favorite.category = fallback;
      }
      item.category = fallback;
    }
    this.favorites = cleanFavorites(this.favorites);
  }
  addCategory(value) {
    if (!String(value ?? '').trim()) throw Error('Escribe un nombre para la categoría.');
    const name = categoryName(value);
    if (this.categories.some(item => item.toLowerCase() === name.toLowerCase())) throw Error('Esa categoría ya existe.');
    if (this.categories.length >= MAX_CATEGORIES) throw Error('Puedes tener hasta ' + MAX_CATEGORIES + ' categorías.');
    this.categories.push(name);
    this.save();
  }
  renameCategory(from, to) {
    const current = this.categories.find(item => item.toLowerCase() === categoryName(from).toLowerCase());
    if (!current) throw Error('Esa categoría no existe.');
    if (!String(to ?? '').trim()) throw Error('Escribe un nombre para la categoría.');
    const name = categoryName(to);
    const clash = this.categories.find(item => item.toLowerCase() === name.toLowerCase() && item !== current);
    if (clash) throw Error('Ya existe una categoría con ese nombre.');
    this.categories = this.categories.map(item => (item === current ? name : item));
    for (const item of this.favorites) if (item.category === current) item.category = name;
    this.save();
  }
  // Removing a category also removes its bookmarks; the same address saved in another category stays there.
  removeCategory(value) {
    const current = this.categories.find(item => item.toLowerCase() === categoryName(value).toLowerCase());
    if (!current) throw Error('Esa categoría no existe.');
    this.categories = this.categories.filter(item => item !== current);
    this.favorites = this.favorites.filter(item => item.category !== current);
    this.save();
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ searchEngine: this.searchEngine, bookmarksVersion: BOOKMARKS_VERSION, categories: this.categories, favorites: this.favorites }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  setSearchEngine(value) {
    if (!valid(value)) throw Error('Selecciona uno de los buscadores disponibles.');
    this.searchEngine = value;
    this.save();
  }
  isFavorite(url) {
    const normalized = favoriteURL(url);
    return !!normalized && this.favorites.some(item => item.url === normalized);
  }
  categoriesOf(url) {
    const normalized = favoriteURL(url);
    return normalized ? this.favorites.filter(item => item.url === normalized).map(item => item.category) : [];
  }
  // Saves or moves nothing: the same address may live in several categories.
  addBookmark(url, title, category) {
    const normalized = favoriteURL(url);
    if (!normalized) throw Error('Solo se pueden guardar páginas web http o https.');
    const name = this.addCategoryName(category);
    if (!name) throw Error('Puedes tener hasta ' + MAX_CATEGORIES + ' categorías.');
    const existing = this.favorites.find(item => item.url === normalized && item.category === name);
    if (existing) { if (String(title ?? '').trim()) existing.title = String(title).trim().slice(0, 60); }
    else this.favorites = cleanFavorites([...this.favorites, { url: normalized, title, category: name }]);
    this.syncCategories();
    this.save();
  }
  toggleFavorite(url, title, category) {
    const normalized = favoriteURL(url);
    if (!normalized) throw Error('Solo se pueden guardar páginas web http o https.');
    const name = this.addCategoryName(category);
    if (!name) throw Error('Puedes tener hasta ' + MAX_CATEGORIES + ' categorías.');
    if (this.favorites.some(item => item.url === normalized && item.category === name)) this.removeFavorite(normalized, name);
    else this.addBookmark(normalized, title, name);
  }
  removeFavorite(url, category) {
    const normalized = favoriteURL(url);
    const name = category == null ? null : categoryName(category).toLowerCase();
    this.favorites = this.favorites.filter(item => !(item.url === normalized && (name === null || item.category.toLowerCase() === name)));
    this.syncCategories();
    this.save();
  }
}
