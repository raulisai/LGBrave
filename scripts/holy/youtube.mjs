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
// The official privacy-enhanced player, shared by TV and web.
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
export function pageData(html) {
  // Two shapes seen (2026-11-03): `var ytInitialData = {…};` and, on channel pages, a JSON script tag.
  const tag = /<script[^>]*id="yt-initial-data"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const start = html.indexOf('var ytInitialData = ');
  const end = start < 0 ? -1 : html.indexOf(';</script>', start);
  if (!tag && (start < 0 || end < 0)) throw Error('YouTube no entregó resultados (¿cambió su página?)');
  try { return JSON.parse(tag || html.slice(start + 'var ytInitialData = '.length, end)); } catch { throw Error('YouTube cambió su página de resultados'); }
}
// A lockup card in the videoRenderer shape toItem reads; on a channel page the channel is the page's.
function fromLockup(card, channel) {
  const badges = [];
  const walk = node => { if (!node || typeof node !== 'object') return; if (node.thumbnailBadgeViewModel) badges.push(node.thumbnailBadgeViewModel.text); for (const value of Object.values(node)) walk(value); };
  walk(card.contentImage);
  const length = badges.find(text => /^\d{1,2}(:\d{2}){1,2}$/.test(String(text || ''))) || '';
  const parts = (card.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || []).flatMap(row => row.metadataParts || []).map(part => part.text?.content || '');
  let byline;
  const owner = node => {
    if (!node || typeof node !== 'object' || byline) return;
    if (node.content) {
      let endpoint;
      const scan = value => {
        if (!value || typeof value !== 'object' || endpoint) return;
        if (value.browseEndpoint) endpoint = value.browseEndpoint;
        for (const child of Object.values(value)) scan(child);
      };
      scan(node);
      if (endpoint) { byline = { text: node.content, navigationEndpoint: { browseEndpoint: endpoint } }; return; }
    }
    for (const value of Object.values(node)) owner(value);
  };
  owner(card.metadata?.lockupMetadataViewModel?.metadata);
  return { videoId: card.contentId, title: { simpleText: card.metadata?.lockupMetadataViewModel?.title?.content || '' }, lengthText: { simpleText: length },
    badges: badges.filter(text => text !== length).map(label => ({ metadataBadgeRenderer: { label } })),
    ownerText: byline ? { runs: [byline] } : channel ? { runs: [{ text: channel.title, navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: channel.path } } }] } : undefined,
    viewCountText: { simpleText: parts.find(text => /vistas|views|\d\s*(k|m|mil)\b/i.test(text)) || '' } };
}
export function results(html, data = typeof html === 'string' ? pageData(html) : html) {
  const found = [];
  const own = data?.metadata?.channelMetadataRenderer;
  const channel = own?.title ? { title: own.title, path: /\/(@[\w.-]+)$/.exec(own.vanityChannelUrl || '')?.[0] || '' } : null;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.videoRenderer) { found.push(node.videoRenderer); return; }
    if (node.playlistVideoRenderer) { const video = node.playlistVideoRenderer; found.push({ ...video, ownerText: video.shortBylineText }); return; }
    // The newer card (channel pages and some searches) carries the same facts in other places.
    if (node.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') { found.push(fromLockup(node.lockupViewModel, channel)); return; }
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
  // Spanish TV channels (RCN, Caracol…) only say «Capítulo 3»: that word is Spanish enough.
  if (!SPANISH.test(title) && !/\b(capitulo|episodio|temporada)\b/.test(title)) return null;
  const wanted = fold(query).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(word => word && !FILLER.has(word));
  const words = title.replace(/[^a-z0-9ñ]+/g, ' ').split(' '), joined = words.join('');
  if (wanted.some(word => !words.includes(word) && !(word.length >= 6 && joined.includes(word)))) return null;
  const episode = EPISODE.exec(title);
  const whole = WHOLE_SERIES.test(title);
  // A film: 1 to 4 hours. An episode: 18 minutes to 2 h 30. A whole series in one upload: up to a day.
  let kind;
  if (whole && length >= 3600 && length <= 86400) kind = 'series';
  // Turkish and Korean episodes run past two hours.
  else if (episode && length >= 1080 && length <= 9000) kind = 'series';
  else if (!episode && length >= 3600 && length <= 14400) kind = 'movie';
  else return null;
  const owner = video.ownerText?.runs?.[0] || video.longBylineText?.runs?.[0] || {};
  const channel = owner.text || '';
  const channelPath = /^\/@[\w.-]+$/.test(owner.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '') ? owner.navigationEndpoint.browseEndpoint.canonicalBaseUrl : '';
  const names = kind === 'series' && !whole ? episodeNames(raw, channel, query) : null;
  const verified = (video.ownerBadges || []).some(badge => /VERIFIED/.test(badge.metadataBadgeRenderer?.style || ''));
  const quality = /\b4k\b|2160p/.test(labels + ' ' + title) ? '4K' : /\b(hd|1080p|720p|full hd|blu-?ray)\b/.test(labels + ' ' + title) ? 'HD' : '';
  const language = /\blatino\b/.test(title) ? 'Latino' : /\bcastellano\b/.test(title) ? 'Castellano' : /subtitulad|sub esp|subs? espanol/.test(title) ? 'Subtitulado' : '';
  const hours = Math.floor(length / 3600), minutes = Math.round(length % 3600 / 60);
  const number = Number(episode?.[2] || episode?.[3] || episode?.[4]) || null;
  return {
    source: 'youtube', kind, url: watchURL(id), title: names?.series || cleanTitle(raw), ...(names ? { series: names.series, episodeTitle: names.episode } : {}),
    subtitle: [kind === 'series' ? (whole ? 'Serie completa' : number ? 'Capítulo ' + number : 'Episodio') : '', channel, hours ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`].filter(Boolean).join(' · '),
    year: /\((19|20)\d{2}\)/.exec(raw)?.[0].slice(1, 5) || '', language, badge: quality,
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, backdrop: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    // Genres only from the words around the name («El libro de la vida» is no «Vida cotidiana»).
    genres: genresFromWords(fold(decode(raw)).replace(fold(cleanTitle(raw)), ' ')), overview: decode(raw), episode: number,
    duration: length, channel, channelPath, verified, views: views(video.viewCountText?.simpleText)
  };
}

// «Mercedes Ramos busca respuestas | Capítulo 3 | Dr. Mata» → series «Dr. Mata», episode «Mercedes
// Ramos busca respuestas»; «Super Campeones   Cap 61 Latino» → series «Super Campeones».
// channel: a last part that is just the channel's name («… | Capítulo 3 | Distrito Comedia») is not the series.
export function episodeNames(raw, channel = '', query = '') {
  const parts = decode(raw).replace(/[\u{1F000}-\u{1FFFF}☀-➿️]/gu, ' ').split(/\s[|│•·\/–—-]\s|\s?\|\s?|[\[\]]/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const marked = part => EPISODE.test(fold(part)) || WHOLE_SERIES.test(fold(part));
  const plain = value => fold(value).replace(/[^a-z0-9ñ]+/g, '');
  const named = parts.filter(part => !marked(part) && !BOILERPLATE.test(part) && !(channel && plain(part) === plain(channel)));
  const wanted = fold(query).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(word => word && !FILLER.has(word) && !/^\d+$/.test(word));
  const matching = wanted.length ? named.filter(part => wanted.every(word => fold(part).split(/[^a-z0-9ñ]+/).includes(word))) : [];
  if (matching.length === 1) return { series: cleanTitle(matching[0]), episode: named.find(part => part !== matching[0]) || '' };
  if (named.length >= 2) return { series: cleanTitle(named.at(-1)), episode: named[0] };
  if (named.length === 1) return { series: cleanTitle(named[0]), episode: '' };
  const part = parts.find(marked) || decode(raw);
  const before = part.slice(0, EPISODE.exec(fold(part))?.index ?? part.length).replace(/[\s,.:;(-]+$/, '').trim();
  return { series: cleanTitle(before || part), episode: '' };
}
const seriesKey = item => (item.channelPath || item.channel) + '|' + fold(item.series).replace(/[^a-z0-9ñ]+/g, '');
// Two or more episodes of one series from one channel become that series: its card opens the
// episode list (the channel's own search for the series name), like any other site's show.
export function groupSeries(items) {
  const groups = new Map();
  for (const item of items) if (item.series && item.channelPath) groups.set(seriesKey(item), [...(groups.get(seriesKey(item)) || []), item]);
  const shown = new Set();
  return items.flatMap(item => {
    const group = item.series && item.channelPath ? groups.get(seriesKey(item)) : null;
    if (!group || group.length < 2) return [item];
    if (shown.has(seriesKey(item))) return [];
    shown.add(seriesKey(item));
    const first = [...group].sort((a, b) => (a.episode || 1e9) - (b.episode || 1e9))[0];
    const show = `${SITE}${item.channelPath.slice(1)}/search?query=${encodeURIComponent(item.series)}`;
    return [{ ...first, kind: 'series', isShow: true, show, url: show, title: item.series, episode: null,
      subtitle: [item.channel, 'Serie en YouTube'].filter(Boolean).join(' · '), overview: `${item.series} · capítulos completos en ${item.channel || 'YouTube'}` }];
  });
}

// Verified channels and 4K/HD uploads first, then the most watched; each video once.
export function rank(items) {
  const score = item => (item.verified ? 3 : 0) + (item.badge === '4K' ? 2 : item.badge === 'HD' ? 1 : 0) + Math.log10(item.views + 1) / 2;
  const seen = new Set();
  return items.filter(item => item && !seen.has(item.url) && seen.add(item.url)).sort((a, b) => score(b) - score(a));
}
const pick = (videos, query) => groupSeries(rank(videos.map(video => toItem(video, query)))).slice(0, 24);
// Like every site reader, garbage in gives an empty list, never an exception.
export function parseSearch(html, query = '') {
  try { return pick(results(String(html || '')), query); } catch { return []; }
}


// Continuations stay on YouTube's public browse/search endpoints.
export function continuation(data) {
  let next = null;
  const walk = node => {
    if (!node || typeof node !== 'object' || next) return;
    if (node.continuationCommand?.token) {
      const api = node.commandMetadata?.webCommandMetadata?.apiUrl;
      if (!api || ['/youtubei/v1/browse', '/youtubei/v1/search'].includes(api))
        next = { token: node.continuationCommand.token, api: api?.endsWith('/search') ? 'search' : 'browse' };
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return next;
}
export function playlistResults(html, name, owner) {
  let data;
  try { data = pageData(html); } catch { return []; }
  const words = fold(name).replace(/[^a-z0-9ñ]+/g, ' ').split(' ').filter(word => word && !FILLER.has(word));
  const found = [];
  const pick = (card, modern) => {
    const id = modern ? card.contentId : card.playlistId;
    const title = modern ? card.metadata?.lockupMetadataViewModel?.title?.content : card.title?.simpleText || card.title?.runs?.map(run => run.text).join('');
    if (!/^[\w-]{10,80}$/.test(id || '') || !words.length ||
        words.some(word => !fold(title).split(/[^a-z0-9ñ]+/).includes(word)) ||
        /canciones|imperdibles|mejores momentos|trailer/i.test(title)) return;
    const identities = [];
    const scan = node => {
      if (!node || typeof node !== 'object') return;
      if (node.browseEndpoint) identities.push(node.browseEndpoint);
      for (const value of Object.values(node)) scan(value);
    };
    scan(modern ? card.metadata?.lockupMetadataViewModel : card);
    if (identities.some(identity => identity.canonicalBaseUrl?.toLowerCase() === owner.path.toLowerCase() ||
        owner.id && identity.browseId === owner.id)) found.push(id);
  };
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.playlistRenderer) { pick(node.playlistRenderer, false); return; }
    if (node.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') { pick(node.lockupViewModel, true); return; }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return [...new Set(found)];
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
  // Prefer the channel's complete playlist: channel-search ranking omits real episodes.
  async episodes(show, load) {
    const match = /^https:\/\/www\.youtube\.com\/(@[\w.-]+)\/search\?query=([^&]+)$/.exec(show || '');
    if (!match) return [];
    const name = decodeURIComponent(match[2]), key = value => fold(value).replace(/[^a-z0-9ñ]+/g, '');
    const html = await load(show), first = pageData(html), owner = first.metadata?.channelMetadataRenderer;
    const expires = Date.now() + 20000;
    const found = new Map();
    const read = (data, preserveDuplicates = false, wanted = null) => {
      let added = 0;
      for (const video of results(null, data)) {
        const item = toItem(video, name);
        if (!item?.episode || key(item.series) !== key(name) || found.has(item.url)) continue;
        if (wanted && (item.channelPath.toLowerCase() !== ('/' + match[1]).toLowerCase() || !wanted.has(item.episode))) continue;
        if (!preserveDuplicates && [...found.values()].some(entry => entry.episode === item.episode)) continue;
        found.set(item.url, { url: item.url, episode: item.episode, label: 'Capítulo ' + item.episode + (item.episodeTitle ? ' · ' + item.episodeTitle : ''), still: item.backdrop });
        added++;
      }
      return added;
    };
    const walk = async (pageHTML, pages, skipEmpty = false, preserveDuplicates = false) => {
      const initial = pageData(pageHTML); read(initial, preserveDuplicates);
      const version = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(pageHTML)?.[1];
      let next = continuation(initial), empty = 0;
      const seen = new Set();
      for (let page = 0; version && next && page < pages && Date.now() < expires && !seen.has(next.token); page++) {
        seen.add(next.token);
        const text = await load(SITE + 'youtubei/v1/' + next.api + '?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version, hl: 'es-419' } }, continuation: next.token }),
          timeout: Math.max(250, Math.min(5000, expires - Date.now())) }).catch(() => '');
        let data;
        try { data = JSON.parse(text); } catch { break; }
        empty = read(data, preserveDuplicates) ? 0 : empty + 1;
        if (skipEmpty && empty >= 2) break;
        next = continuation(data);
      }
    };
    read(first);
    let playlist = false;
    // Use the same channel identity, never somebody else's similarly named playlist.
    if (owner?.title) {
      const query = name + ' ' + owner.title;
      const listing = await load(SITE + 'results?search_query=' + encodeURIComponent(query) + '&sp=EgIQAw%3D%3D').catch(() => '');
      const lists = playlistResults(listing, name, { path: '/' + match[1], id: owner.externalId });
      for (const list of lists.slice(0, 2)) {
        const before = found.size;
        await load(SITE + 'playlist?list=' + encodeURIComponent(list)).then(h => walk(h, 24, false, true)).catch(() => {});
        playlist ||= found.size > before;
      }
    }
    const gaps = () => {
      const numbers = new Set([...found.values()].map(entry => entry.episode)), max = Math.max(0, ...numbers);
      return max <= 2000 ? Array.from({ length: max }, (_, index) => index + 1).filter(number => !numbers.has(number)) : [];
    };
    // Public playlists can omit a published upload. Fill small gaps only with the exact
    // episode from this channel; never manufacture URLs or renumber the publisher's titles.
    const missing = gaps();
    if (playlist && missing.length <= 12) {
      for (const number of missing) {
        if (Date.now() >= expires) break;
        const query = name + ' capítulo ' + number + ' ' + owner.title;
        const extra = await load(SITE + 'results?search_query=' + encodeURIComponent(query), { timeout: Math.max(250, Math.min(4000, expires - Date.now())) }).catch(() => '');
        try { read(pageData(extra), false, new Set([number])); } catch { /* Keep the confirmed playlist. */ }
      }
    }
    if (!playlist) await walk(html, 12);
    // Search is not exhaustive even when it found more than 30. Uploads are a bounded fallback.
    if (!playlist && (found.size < 30 || gaps().length)) await load(SITE + match[1] + '/videos').then(h => walk(h, 10, true)).catch(() => {});
    const episodes = [...found.values()].sort((a, b) => a.episode - b.episode);
    return episodes.length ? [{ title: 'Capítulos', episodes }] : [];
  },
  // Everything shown comes from the results page itself: no page to read per title.
  async detail(entry) { return { genres: entry.genres || genresFromWords(entry.overview || entry.title), overview: entry.overview || '', poster: entry.poster || '', backdrop: entry.backdrop || '', show: '' }; },
  // TV and web use YouTube's official player when embedding is allowed. Keep the watch
  // address for the explicit fallback when the uploader restricts embedding.
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
