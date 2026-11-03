// YouTube as one more site in Holy's search: only whole films and whole episodes (or whole
// series in one upload) that YouTube itself hosts, never shorts, trailers, reviews, recaps or
// game «movies». Read from YouTube's own public results page (no API key), with its «long
// videos» filter, then a stricter pass here: length, Spanish audio or subtitles, what the
// title says it is, and the words that were searched for. Ranked so verified channels and
// 4K/HD uploads come first. Search only: YouTube adds nothing to the catalogue's rows.
import { decode, genresFromWords } from './sources.mjs';

const SITE = 'https://www.youtube.com/';
// YouTube's own «Duración: más de 20 minutos» filter.
const LONG = 'EgIYAg%3D%3D';
const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const watchURL = id => `https://www.youtube.com/watch?v=${id}`;
// The privacy-enhanced embed, for the web page's in-page player.
export const embedURL = id => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
const validId = id => /^[\w-]{11}$/.test(String(id || ''));

// «1:36:32» → 5792 seconds; '' when YouTube does not say (live, premieres).
export function seconds(value) {
  const parts = String(value || '').split(':').map(Number);
  if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}
const views = value => Number(String(value || '').replace(/[^\d]/g, '')) || 0;

// What the title says the video is not: a whole film or episode.
const NOT_WHOLE = /\b(resena|review|revision|facts|datos|explicacion|explicada|explained|resumen|recap|reaccion|reaction|trailer|teaser|avance|analisis|en \d+ minutos|en minutos|pelicula del juego|gameplay|walkthrough|cutscenes|pc version|fan ?film|fanmade|parodia|making of|detras de camaras|behind the scenes|asmr|podcast|audiolibro|audiobook|clip|escenas?)\b/;
// Recordings and resolutions that are not watchable on a TV.
const LOW_QUALITY = /\b(cam|camrip|ts|telesync|hdcam|240p|360p)\b/;
const SPANISH = /\b(espanol|espanola|latino|castellano|doblad[oa]|subtitulad[oa]|sub esp|subs? espanol)\b/;
const EPISODE = /\b(capitulo|cap|episodio|ep|chapter|episode)\.?\s*(\d{1,4})\b|\bs\d{1,2}\s*e(\d{1,4})\b|\b\d{1,2}x(\d{1,4})\b/;
const WHOLE_SERIES = /\b(serie completa|temporada completa|todos los capitulos|todos los episodios|toda la serie)\b/;
// Words that say «full film / Spanish / quality», not which film: ignored when matching what was typed.
const FILLER = new Set(['pelicula', 'peliculas', 'completa', 'completas', 'completo', 'completos', 'serie', 'series', 'capitulo', 'capitulos', 'episodio', 'episodios', 'en', 'espanol', 'latino', 'castellano', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'hd', 'full', 'movie', 'the', 'a', 'un', 'una', '4k', 'youtube']);
const BOILERPLATE = /pel[ií]cula|completa|completo|espa[ñn]ol|latino|castellano|doblad|subtitulad|\bhd\b|\b4k\b|full movie|estreno|^\s*(drama|acci[oó]n|comedia|terror|romance|suspenso|aventura|ciencia ficci[oó]n|animaci[oó]n)\b/i;

// Where the film's name ends inside one part («Hansel y Gretel Pelicula Completa Español…»).
const TAIL = /[\s,.:;(-]+(mejor(es)? pel[ií]culas?\b|pel[ií]cula,?\s+completa|completa\b|en espa[ñn]ol|espa[ñn]ol latino|\(?\s*latino\b|doblad[ao]|subtitulad[ao]|\bhd\b|\b4k\b|full movie|estreno)/i;
// The film's own name out of a YouTube title («TE ENSEÑARÉ A SOÑAR | Película completa en
// Español Latino | Películas de amor» → «Te Enseñaré A Soñar»): the first part between
// separators that is not boilerplate, cut where the boilerplate starts; shouting titles are
// calmed down.
export function cleanTitle(raw) {
  const parts = decode(raw).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, ' ').split(/\s[|│•·\/–—-]\s|\s?\|\s?|\s\/\s|[\[\]]/).map(part => part.replace(/\(\s*(19|20)\d{2}\s*\)/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let name = parts.find(part => !BOILERPLATE.test(part)) || parts[0] || decode(raw);
  const tail = TAIL.exec(name);
  if (tail && tail.index >= 3) name = name.slice(0, tail.index).trim();
  const letters = name.replace(/[^\p{L}]/gu, '');
  return letters && letters === letters.toUpperCase() ? name.toLowerCase().replace(/(^|[\s¡¿("'])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase()) : name;
}

// The videos of a results page (ytInitialData), as they come.
export function results(html) {
  const start = html.indexOf('var ytInitialData = ');
  const end = start < 0 ? -1 : html.indexOf(';</script>', start);
  if (start < 0 || end < 0) throw Error('YouTube no entregó resultados (¿cambió su página?)');
  let data;
  try { data = JSON.parse(html.slice(start + 'var ytInitialData = '.length, end)); } catch { throw Error('YouTube cambió su página de resultados'); }
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.videoRenderer) { found.push(node.videoRenderer); return; }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return found;
}

// One result → a Holy title, or null when it is not a whole film or episode worth showing.
// query: what was typed (each meaningful word must be in the title); '' accepts any.
export function toItem(video, query = '') {
  const id = video?.videoId;
  if (!validId(id)) return null;
  const raw = (video.title?.runs || []).map(run => run.text).join('') || video.title?.simpleText || '';
  const title = fold(decode(raw));
  const length = seconds(video.lengthText?.simpleText);
  const labels = (video.badges || []).map(badge => fold(badge.metadataBadgeRenderer?.label)).join(' ');
  if (!title || !length || /miembros|members|en vivo|live/.test(labels) || NOT_WHOLE.test(title) || LOW_QUALITY.test(title)) return null;
  if (!SPANISH.test(title)) return null;
  const wanted = fold(query).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(word => word && !FILLER.has(word));
  if (wanted.some(word => !title.replace(/[^a-z0-9ñ]+/g, ' ').split(' ').includes(word))) return null;
  const episode = EPISODE.exec(title);
  const whole = WHOLE_SERIES.test(title);
  // A film: 1 to 4 hours. An episode: 18 minutes to 2 h 30. A whole series in one upload: up to a day.
  let kind;
  if (whole && length >= 3600 && length <= 86400) kind = 'series';
  // Turkish and Korean episodes run past two hours.
  else if (episode && length >= 1080 && length <= 9000) kind = 'series';
  else if (!episode && length >= 3600 && length <= 14400) kind = 'movie';
  else return null;
  const channel = video.ownerText?.runs?.[0]?.text || video.longBylineText?.runs?.[0]?.text || '';
  const verified = (video.ownerBadges || []).some(badge => /VERIFIED/.test(badge.metadataBadgeRenderer?.style || ''));
  const quality = /\b4k\b|2160p/.test(labels + ' ' + title) ? '4K' : /\b(hd|1080p|720p|full hd|blu-?ray)\b/.test(labels + ' ' + title) ? 'HD' : '';
  const language = /\blatino\b/.test(title) ? 'Latino' : /\bcastellano\b/.test(title) ? 'Castellano' : /subtitulad|sub esp|subs? espanol/.test(title) ? 'Subtitulado' : '';
  const hours = Math.floor(length / 3600), minutes = Math.round(length % 3600 / 60);
  const number = Number(episode?.[2] || episode?.[3] || episode?.[4]) || null;
  return {
    source: 'youtube', kind, url: watchURL(id), title: cleanTitle(raw),
    subtitle: [kind === 'series' ? (whole ? 'Serie completa' : number ? 'Capítulo ' + number : 'Episodio') : '', channel, hours ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`].filter(Boolean).join(' · '),
    year: /\((19|20)\d{2}\)/.exec(raw)?.[0].slice(1, 5) || '', language, badge: quality,
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, backdrop: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    // Genres only from the words around the name («El libro de la vida» is no «Vida cotidiana»).
    genres: genresFromWords(fold(decode(raw)).replace(fold(cleanTitle(raw)), ' ')), overview: decode(raw), episode: number,
    duration: length, channel, verified, views: views(video.viewCountText?.simpleText)
  };
}

// Verified channels and 4K/HD uploads first, then the most watched; each video once.
export function rank(items) {
  const score = item => (item.verified ? 3 : 0) + (item.badge === '4K' ? 2 : item.badge === 'HD' ? 1 : 0) + Math.log10(item.views + 1) / 2;
  const seen = new Set();
  return items.filter(item => item && !seen.has(item.url) && seen.add(item.url)).sort((a, b) => score(b) - score(a));
}
const pick = (videos, query) => rank(videos.map(video => toItem(video, query))).slice(0, 24);
// Like every site reader, garbage in gives an empty list, never an exception.
export function parseSearch(html, query = '') {
  try { return pick(results(String(html || '')), query); } catch { return []; }
}

export const youtube = {
  id: 'youtube', name: 'YouTube · completas', site: SITE,
  // Not refreshed into the catalogue: its «listing» is only ever a results page for a search.
  searchOnly: true,
  parseHome: html => parseSearch(html),
  // Searched with «completa» so YouTube itself leans to whole films and episodes.
  searchURL: query => `${SITE}results?search_query=${encodeURIComponent(/complet[ao]/i.test(query) ? query : query + ' completa')}&sp=${LONG}`,
  // A page that is not a results page fails loudly here, so search says «sin respuesta», not «nada».
  async search(query, load) { return pick(results(await load(this.searchURL(query))), query); },
  // Everything shown comes from the results page itself: no page to read per title.
  async detail(entry) { return { genres: entry.genres || genresFromWords(entry.overview || entry.title), overview: entry.overview || '', poster: entry.poster || '', backdrop: entry.backdrop || '', show: '' }; },
  // The TV opens YouTube's own watch page (its player, its quality menu). The web page embeds it
  // when the uploader allows embedding (YouTube's oEmbed says so); otherwise it opens a tab.
  async resolve(entry, load) {
    const id = /[?&]v=([\w-]{11})/.exec(entry.url || '')?.[1];
    if (!validId(id)) throw Error('Dirección de YouTube no válida.');
    let embed = embedURL(id);
    try {
      // An existing, public video answers with its oEmbed card; anything else is not confirmed.
      if (JSON.parse(await load(`${SITE}oembed?format=json&url=${encodeURIComponent(watchURL(id))}`))?.type !== 'video') throw SyntaxError('oembed');
    } catch (error) {
      if (/\b40[13]\b/.test(error.message)) embed = '';
      else if (/\b404\b/.test(error.message)) throw Error('Este vídeo de YouTube ya no está disponible.');
      else if (error instanceof SyntaxError) throw Error('YouTube no confirmó este vídeo.');
      else throw error;
    }
    return { url: watchURL(id), embed };
  }
};
