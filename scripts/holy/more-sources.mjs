// More of the owner's sites. Same contract as sources.mjs; these also define
// home()/detail()/search() when the site needs more than one page or a JSON call.
import { decode, attr, text, absolute, between, genre, country, item, genrePages } from './sources.mjs';
import { dedupe } from './versions.mjs';

const tmdbPath = (path, size) => (/^\/[\w-]+\.(jpg|png|webp)$/.test(path || '') ? `https://image.tmdb.org/t/p/${size}${path}` : '');
const json = value => { try { return JSON.parse(value); } catch { return null; } };
const unique = list => [...new Set(list)];

// ---------------------------------------------------------------- DoramasFlix
// A Next.js site: titles travel inside the page as React "flight" data, and the
// players come from the site's own server actions. doramasflix.in and
// doramasia.com serve the same catalogue and are tried when .io fails.
export const FLIX_ORIGINS = ['https://doramasflix.io/', 'https://doramasflix.in/', 'https://doramasia.com/'];
export function flight(html) {
  let out = '';
  for (const match of String(html || '').matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { out += JSON.parse(match[1]); } catch { /* A broken chunk is skipped. */ }
  }
  return out;
}
const flatObjects = (data, typename) => [...data.matchAll(new RegExp(`\\{[^{}]*"__typename":"${typename}"[^{}]*\\}`, 'g'))].map(match => json(match[0])).filter(Boolean);
const actions = new Map();
// Action ids change whenever the site is redeployed: read them from its own scripts.
async function flixActions(origin, page, load, force = false) {
  const cached = actions.get(origin);
  if (cached && !force && Date.now() - cached.at < 6 * 3600000) return cached.ids;
  const ids = { ...(cached?.ids || {}) };
  const chunks = unique([...String(page).matchAll(/\/_next\/static\/chunks\/[\w.~-]+\.js/g)].map(match => match[0])).slice(0, 80);
  for (let index = 0; index < chunks.length; index += 8) {
    await Promise.all(chunks.slice(index, index + 8).map(async path => {
      const code = await load(origin.replace(/\/$/, '') + path).catch(() => '');
      for (const match of code.matchAll(/createServerReference\)\("([0-9a-f]{20,})",[^)]*?"(\w+)"\)/g)) ids[match[2]] = match[1];
    }));
  }
  actions.set(origin, { at: Date.now(), ids });
  return ids;
}
async function flixAction(origin, pageURL, page, name, argument, load) {
  for (const force of [false, true]) {
    const ids = await flixActions(origin, typeof page === 'function' ? await page() : page, load, force);
    if (!ids[name]) continue;
    const reply = await load(pageURL, { method: 'POST', body: JSON.stringify([argument]), headers: { 'Next-Action': ids[name], 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'text/x-component' } }).catch(() => '');
    const line = reply.split('\n').find(entry => entry.startsWith('1:') && !entry.startsWith('1:E'));
    const value = line && json(line.slice(2));
    if (value) return value;
  }
  throw Error('DoramasFlix cambió su forma de entregar ' + (name === 'searchQuickAction' ? 'la búsqueda.' : 'los enlaces.'));
}
// embedshortener.co/e/<token>: the token's payload carries the real host page, base64-encoded.
export function flixHost(link) {
  try {
    const url = new URL(link);
    if (!/(^|\.)embedshortener\.co$/.test(url.hostname)) return url.protocol === 'https:' ? url.href : '';
    const payload = JSON.parse(Buffer.from(url.pathname.split('/').pop().split('.')[1], 'base64url').toString('utf8'));
    const target = new URL(Buffer.from(payload.link, 'base64').toString('utf8'));
    return target.protocol === 'https:' ? target.href : '';
  } catch { return ''; }
}
// Server codes from the site's own list. ok.ru and Mixdrop are proven on this TV, Streamtape and
// Streamwish played on the Mac; Voe stalled on the TV (2026-10-23), so it comes later.
const FLIX_RANK = ['1113', '3889', '8309', '38585', '958695', '576857', '1230', '4721', '7286', '1233', '1234'];
// {code_flix → {name, code}} from the page's own language list.
export function flixLanguages(data) {
  return Object.fromEntries([...String(data).matchAll(/\{"name":"([^"]+)","code":"([a-z-]+)","code_flix":"(\d+)"/g)].map(match => [match[3], { name: decode(match[1]), code: match[2] }]));
}
// Links grouped by language: one version each, with its own ranked servers.
export function flixVersions(links, languages, referrer) {
  const groups = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    const key = String(link?.lang ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(link);
  }
  const versions = [...groups].map(([code, list]) => {
    const urls = rankFlixLinks(list);
    if (!urls.length) return null;
    const language = languages[code] || { name: '', code: '' };
    const spanish = ['es', 'es-la', 'es-mx'].includes(language.code) || /latino|castellano|espa[ñn]ol/i.test(language.name);
    const subtitled = list.some(link => (link.subtitles || []).some(entry => entry?.language_code === 'es'));
    const name = language.name || (code ? 'Idioma ' + code : 'Original');
    const castilian = /castellano|espa[ñn]a/i.test(name);
    const kind = spanish ? 'dub' : subtitled ? 'sub' : 'orig';
    const label = spanish ? (castilian ? 'Español (España)' : 'Español latino') : subtitled ? `${name} · subtítulos en español` : `${name} (original)`;
    return { id: code || 'x', label, kind, target: { url: urls[0], referrer, alternatives: urls.slice(1, 4) } };
  }).filter(Boolean);
  // Same order the site recommends: the group of its best-ranked server first.
  const best = link => FLIX_RANK.indexOf(String(link.server));
  const rank = version => Math.min(...(groups.get(version.id === 'x' ? '' : version.id) || []).map(best).filter(position => position >= 0), 99);
  return dedupe(versions.sort((a, b) => rank(a) - rank(b)));
}
export function rankFlixLinks(links) {
  const known = (Array.isArray(links) ? links : []).filter(link => FLIX_RANK.includes(String(link?.server)));
  return unique(known.sort((a, b) => FLIX_RANK.indexOf(String(a.server)) - FLIX_RANK.indexOf(String(b.server))).map(link => {
    const host = flixHost(link.link);
    if (!host) return '';
    const url = new URL(host);
    if (/(^|\.)ok\.ru$/.test(url.hostname)) url.searchParams.set('autoplay', '1');
    return url.href;
  }).filter(Boolean));
}
const flixGenres = data => {
  const named = /"genres":\[((?:\{"name":"[^"]+"[^{}]*\},?)+)\]/.exec(data)?.[1];
  if (named) return unique([...named.matchAll(/"name":"([^"]+)"/g)].map(match => genre(match[1]))).filter(Boolean);
  return unique([...data.matchAll(/"href":"\/generos\/([a-z0-9-]+)"/g)].map(match => genre(match[1].replace(/-/g, ' ')))).filter(Boolean);
};

export const doramasflix = {
  id: 'doramasflix', name: 'DoramasFlix', site: FLIX_ORIGINS[0],
  async home(load) {
    let lastError;
    for (const origin of FLIX_ORIGINS) {
      try {
        const items = this.parseHome(await load(origin), origin);
        if (items.length) return items;
      } catch (error) { lastError = error; }
    }
    throw lastError || Error('DoramasFlix no mostró títulos en ninguno de sus dominios.');
  },
  parseHome(html, base = this.site) {
    const data = flight(html);
    const episodes = flatObjects(data, 'EpisodeMin').filter(entry => /^[\w-]+-\d+x\d+$/.test(entry.slug || '')).map(entry => {
      const [, show, season, episode] = /^(.+)-(\d+)x(\d+)$/.exec(entry.slug);
      return item({
        source: 'doramasflix', kind: 'dorama', url: absolute('/capitulos/' + entry.slug, base), show: absolute('/doramas/' + show, base),
        title: decode(String(entry.name || '').replace(/\s+\d+x\d+$/, '')), episode: Number(episode), subtitle: `T${season} · Capítulo ${Number(episode)}`, badge: 'Cap ' + Number(episode),
        backdrop: tmdbPath(entry.still_path || entry.serie_backdrop_path, 'w780'), overview: decode(entry.overview || '')
      });
    });
    const slides = [...data.matchAll(/\{"id":"\/(doramas|peliculas)\/[^"]+","title":"[^"]*"[^{}]*\}/g)].map(match => json(match[0])).filter(Boolean).map(slide => {
      const movie = /^\/peliculas\//.test(slide.href);
      return item({ source: 'doramasflix', kind: movie ? 'movie' : 'dorama', url: absolute(slide.href, base), ...(movie ? {} : { show: absolute(slide.href, base), isShow: true }),
        title: decode(slide.title || ''), backdrop: tmdbPath(slide.imageUrl, 'w780'), badge: movie ? 'Película' : 'Dorama' });
    });
    return [...episodes, ...slides].filter(entry => entry.title);
  },
  detailURL: entry => entry.show || entry.url,
  parseDetail(html) {
    const data = flight(html);
    const networks = /"networks":\[((?:\{"name":"[^"]+"[^{}]*\},?)+)\]/.exec(data)?.[1] || '';
    return { genres: flixGenres(data), overview: decode(/"overview":"((?:[^"\\]|\\.){20,}?)"/.exec(data)?.[1]?.replace(/\\"/g, '"') || ''), poster: tmdbPath(/"poster_path":"([^"]+)"/.exec(data)?.[1], 'w342'),
      studios: unique([...networks.matchAll(/"name":"([^"]+)"/g)].map(match => decode(match[1]))).slice(0, 3),
      country: country([...data.matchAll(/"country":"([a-z-]+)"/g)].map(match => match[1]).find(value => value !== 'paises')) };
  },
  // The site lists each title's languages (`langs`: Coreano, Latino…) and tags every link with one.
  // Korean links come with Spanish hard subtitles; «Latino» is the Spanish dub.
  async versions(entry, load) {
    const origin = new URL(entry.url).origin + '/';
    const page = await load(entry.url);
    const data = flight(page);
    const movie = /\/peliculas\//.test(entry.url);
    const id = new RegExp(`"${movie ? 'movie' : 'episode'}":\\{"_id":"([0-9a-f]{24})"`).exec(data)?.[1];
    if (!id) throw Error('DoramasFlix no indicó el reproductor de este título.');
    const links = await flixAction(origin, entry.url, page + data, movie ? 'getMovieLinks' : 'getEpisodeLinks', movie ? { movie_id: id } : { episode_id: id }, load);
    if (!rankFlixLinks(links).length) throw Error(movie ? 'Esta película todavía no tiene servidores en DoramasFlix.' : 'Este capítulo todavía no tiene servidores en DoramasFlix.');
    return flixVersions(links, flixLanguages(data), entry.url);
  },
  async resolve(entry, load) {
    const [first] = await this.versions(entry, load);
    return first.target;
  },
  async search(query, load) {
    const origin = FLIX_ORIGINS[0];
    const result = await flixAction(origin, origin, () => load(origin), 'searchQuickAction', { q: query }, load);
    const data = result?.data || {};
    const map = (list, movie) => (Array.isArray(list) ? list : []).filter(entry => entry?.slug).map(entry => item({
      source: 'doramasflix', kind: movie ? 'movie' : 'dorama', url: absolute((movie ? '/peliculas/' : '/doramas/') + entry.slug, origin), ...(movie ? {} : { show: absolute('/doramas/' + entry.slug, origin), isShow: true }),
      title: decode(entry.name || ''), overview: decode(entry.name_es || '').trim(), poster: tmdbPath(entry.poster_path, 'w342'), year: String(entry.first_air_date || entry.release_date || '').slice(0, 4)
    }));
    return [...map(data.doramas, false), ...map(data.movies, true)];
  },
  async episodes(show, load) {
    const data = flight(await load(show));
    const seasons = new Map();
    for (const [, slug, season, episode] of data.matchAll(/"href":"\/capitulos\/([\w-]+?-(\d+)x(\d+))"/g)) {
      if (!seasons.has(+season)) seasons.set(+season, new Map());
      seasons.get(+season).set(+episode, { url: absolute('/capitulos/' + slug, show), season: +season, episode: +episode, label: `T${season} · Capítulo ${+episode}` });
    }
    return [...seasons].sort((a, b) => a[0] - b[0]).map(([season, list]) => ({ title: 'Temporada ' + season, episodes: [...list.values()].sort((a, b) => a.episode - b.episode) }));
  }
};

// ------------------------------------------------------------ Asia Live Action
// WordPress. Each episode page lists its players in `var allVideos`; ok.ru first.
const ALA_RANK = [/(^|\.)ok\.ru$/, /(^|\.)(filemoon|bysejikuar|moonplayer)\.[a-z]+$/, /(^|\.)vk(video)?\.(ru|com)$/];
export const asialiveaction = {
  id: 'asialiveaction', name: 'Asia Live Action', site: 'https://asialiveaction.com/',
  parseHome(html, base = this.site) {
    const section = between(html, 'Últimos Episodios</h3>', '</section>');
    return section.split('<li').slice(1).map(block => {
      const link = absolute(/<a href="([^"]+)"/.exec(block)?.[1], base);
      if (!/\/e\/[\w/-]+\/$/.test(link)) return null;
      const heading = /<h5>([\s\S]*?)<\/h5>/.exec(block)?.[1] || '';
      const episode = Number(/#[^<]*?<\/i>\s*(\d+)|(\d+)\s*<\/span>/.exec(heading)?.slice(1).find(Boolean)) || null;
      const image = attr(/<figure><img[^>]*>/.exec(block)?.[0] || /<img[^>]*loading[^>]*>/.exec(block)?.[0], 'src');
      return item({ source: 'asialiveaction', kind: 'dorama', url: link, title: text(heading.replace(/<span>[\s\S]*<\/span>/, '')), episode,
        subtitle: episode ? 'Episodio ' + episode : '', badge: episode ? 'Ep ' + episode : '',
        backdrop: image.replace(/\/t\/p\/w\d+_and_h\d+_multi_faces\//, '/t/p/w780/') });
    }).filter(entry => entry?.title);
  },
  // Genres and synopsis live on the show's page; the episode page links to it.
  async detail(entry, load) {
    const page = await load(entry.url);
    const show = /href="(https:\/\/asialiveaction\.com\/tv\/[^"]+\/)"/.exec(page)?.[1] || '';
    if (!show) return {};
    const html = await load(show);
    // The synopsis paragraph sits right after the quality tags; og:description is download SEO text.
    const synopsis = text(/class="quality-tags"[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html)?.[1]);
    const description = decode(/og:description" content="([^"]*)"/.exec(html)?.[1] || '');
    return { show, genres: unique([...html.matchAll(/class="tag genero[^"]*" href="[^"]*">([^<]+)</g)].map(match => genre(match[1]))).filter(Boolean),
      overview: synopsis || (/^Ver y Descargar/i.test(description) ? '' : description), poster: attr(/<meta property="og:image"[^>]*>/.exec(html)?.[0], 'content') };
  },
  async resolve(entry, load) {
    const players = this.parsePlayers(await load(entry.url));
    if (!players.length) throw Error('Este episodio no tiene reproductores todavía.');
    return { url: players[0], referrer: entry.url, alternatives: players.slice(1, 3) };
  },
  parsePlayers(html) {
    const all = json(/var allVideos\s*=\s*(\{[\s\S]*?\});/.exec(html)?.[1] || '') || {};
    const urls = Object.values(all).flat().map(entry => Array.isArray(entry) ? String(entry[1] || '') : '').filter(url => /^https:\/\//.test(url));
    const rank = url => { try { const host = new URL(url).hostname; const index = ALA_RANK.findIndex(pattern => pattern.test(host)); return index < 0 ? ALA_RANK.length : index; } catch { return 99; } };
    return unique(urls.sort((a, b) => rank(a) - rank(b)).map(url => { const parsed = new URL(url); if (/(^|\.)ok\.ru$/.test(parsed.hostname)) parsed.searchParams.set('autoplay', '1'); return parsed.href; }));
  },
  async episodes(show, load) {
    const html = await load(show);
    const episodes = unique([...html.matchAll(/<a href="(https:\/\/asialiveaction\.com\/e\/[^"]+)">[\s\S]{0,300}?Episodio\s*(\d+)/g)].map(match => match[1] + '|' + match[2]))
      .map(value => { const [url, number] = value.split('|'); return { url, episode: Number(number), label: 'Episodio ' + number }; }).sort((a, b) => a.episode - b.episode);
    return episodes.length ? [{ title: 'Episodios', episodes }] : [];
  }
};

// --------------------------------------------------------------------- AnimeYT
// Latest episodes and search come from the site's own JSON feeds; episodes play in
// its Mytsumi player. Holy opens that player directly, never AnimeYT's own pages
// (their hidden Cloudflare widgets are what closed the TV app).
export const animeyt = {
  id: 'animeyt', name: 'AnimeYT', site: 'https://animeyt.cc/', language: 'Subtitulado',
  async home(load) {
    const data = json(await load('https://animeyt.cc/wp-json/aniyt/v1/home/episodes'));
    if (!data?.html) throw Error('AnimeYT cambió su lista de episodios.');
    return this.parseHome(data.html);
  },
  parseHome(html, base = this.site) {
    return String(html || '').split('<article class="aniyt-episode-card').slice(1).map(block => {
      const anchor = /<a class="aniyt-episode-media" href="([^"]+)" aria-label="([^"]*)"/.exec(block);
      if (!anchor) return null;
      const url = absolute(decode(anchor[1]), base);
      // Uncensored adult releases are not part of Holy's catalogue.
      if (!/^https:\/\/animeyt\.cc\/\d+\/anime\/[\w-]+\/$/.test(url) || /sin-censura/.test(url)) return null;
      const label = /^Ver (.+?), episodio (\d+)(?::\s*(.*))?$/.exec(decode(anchor[2]));
      if (!label) return null;
      const season = text(/aniyt-episode-season">([^<]*)/.exec(block)?.[1]);
      return item({ source: 'animeyt', kind: 'anime', url, title: label[1], episode: Number(label[2]),
        subtitle: 'Episodio ' + label[2] + (label[3] ? ' · ' + label[3] : ''), badge: (season ? season + ' · ' : '') + 'Ep ' + label[2],
        backdrop: attr(/<img[^>]*>/.exec(block)?.[0], 'src').replace(/&#038;/g, '&') });
    }).filter(Boolean);
  },
  // The catalogue's first pages: series opened as shows with their episode list.
  async more(load) {
    return genrePages(load, [['https://animeyt.cc/tv/', ''], ['https://animeyt.cc/tv/page/2/', '']], html => this.parseCatalog(html));
  },
  parseCatalog(html, base = this.site) {
    return String(html || '').split('<article class="aniyt-anime-card">').slice(1).map(block => {
      const show = absolute(/<a class="aniyt-anime-poster" href="([^"]+)"/.exec(block)?.[1], base);
      if (!/^https:\/\/animeyt\.cc\/tv\/[\w-]+\/$/.test(show)) return null;
      const poster = attr(/<noscript><img[^>]*>/.exec(block)?.[0], 'src') || attr(/<img[^>]*data-src="[^"]*"[^>]*>/.exec(block)?.[0], 'data-src');
      const score = /aniyt-card-score">★\s*([\d,.]+)/.exec(block)?.[1]?.replace(',', '.');
      return item({ source: 'animeyt', kind: 'anime', url: show, show, isShow: true, title: text(/<h3><a[^>]*>([\s\S]*?)<\/a><\/h3>/.exec(block)?.[1]),
        poster: /^https:\/\//.test(poster) ? poster.replace(/&#038;/g, '&') : '', rating: score || '', badge: text(/aniyt-anime-type">([^<]*)/.exec(block)?.[1]),
        subtitle: text(/<div class="aniyt-anime-body">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(block)?.[1]) });
    }).filter(entry => entry?.title);
  },
  async detail(entry, load) {
    const page = entry.isShow ? '' : await load(entry.url);
    const show = entry.isShow ? entry.show : /href="(https:\/\/animeyt\.cc\/tv\/[\w-]+\/)"/.exec(page)?.[1] || '';
    if (!show) return {};
    const html = await load(show);
    const block = between(html, 'Géneros</dt>', '</dd>');
    const studios = between(html, 'Estudio</dt>', '</dd>');
    return { show, genres: unique([...block.matchAll(/>([^<]+)<\/a>/g)].map(match => genre(match[1]))).filter(Boolean),
      studios: unique([...studios.matchAll(/>([^<]+)<\/a>/g)].map(match => decode(match[1]))).slice(0, 3), country: 'Japón',
      overview: decode(/og:description" content="([^"]*)"/.exec(html)?.[1] || ''), poster: attr(/<meta property="og:image"[^>]*>/.exec(html)?.[0], 'content') };
  },
  // Mytsumi lists the real servers in its tabs (data-player-url). The direct MP4 file first
  // (no player code, no ads), then ok.ru (proven on the TV), then the rest; MEGA never.
  async resolve(entry, load) {
    const page = await load(entry.url);
    const src = decode(/<iframe[^>]*src="(https:\/\/mytsumi\.com\/container\.php\?[^"]+)"/.exec(page)?.[1] || '');
    if (!src) throw Error('AnimeYT no indicó el reproductor de este episodio.');
    const container = new URL(src);
    container.searchParams.set('open', '1');
    const players = this.parseContainer(await load(container.href, { referrer: entry.url }).catch(() => ''));
    if (!players.length) return { url: container.href, referrer: entry.url };
    return { url: players[0], referrer: container.href, alternatives: [...players.slice(1, 3), container.href] };
  },
  parseContainer(html) {
    const tabs = [...String(html || '').matchAll(/data-player-url="([^"]+)"\s+data-player-kind="([^"]*)"\s+data-player-label="([^"]*)"/g)]
      .map(([, url, kind, label]) => ({ url: decode(url), kind, label }))
      .filter(tab => /^https:\/\//.test(tab.url) && !/(^|\.)mega\.(nz|io)$/.test(new URL(tab.url).hostname));
    const rank = tab => (tab.kind === 'video' ? 0 : /(^|\.)ok\.ru$/.test(new URL(tab.url).hostname) ? 1 : 2);
    return unique(tabs.sort((a, b) => rank(a) - rank(b)).map(tab => { const url = new URL(tab.url); if (/(^|\.)ok\.ru$/.test(url.hostname)) url.searchParams.set('autoplay', '1'); return url.href; }));
  },
  async search(query, load) {
    const data = json(await load('https://animeyt.cc/wp-json/aniyt/v1/catalog/search?q=' + encodeURIComponent(query)));
    return (Array.isArray(data?.results) ? data.results : []).filter(entry => /^https:\/\/animeyt\.cc\/tv\/[\w-]+\/$/.test(entry?.url || '')).map(entry => item({
      source: 'animeyt', kind: 'anime', url: entry.url, show: entry.url, isShow: true, title: decode(entry.title || ''),
      poster: /^https:\/\//.test(entry.image || '') ? entry.image : '', badge: decode(entry.type || ''), subtitle: decode(entry.status || ''),
      rating: Number(entry.rating) ? String(Math.round(Number(entry.rating) * 10) / 10) : ''
    }));
  },
  async episodes(show, load) {
    const html = await load(show);
    // Arcs share the show's episode slugs (one-piece-arco-de-elbaph → one-piece-capitulo-1180): no slug filter.
    const found = new Map();
    for (const match of html.matchAll(/href="(https:\/\/animeyt\.cc\/\d+\/anime\/[\w-]+?-capitulo-(\d+)[\w-]*\/)"/g)) {
      const [, url, number] = match;
      if (/sin-censura/.test(url) || found.has(+number)) continue;
      found.set(+number, { url, episode: +number, label: 'Episodio ' + number });
    }
    const episodes = [...found.values()].sort((a, b) => a.episode - b.episode);
    return episodes.length ? [{ title: 'Episodios', episodes }] : [];
  }
};

// ---------------------------------------------------------------- OnlyFlix
// English catalogue (WordPress). Cards carry their data in attributes; each title or episode
// asks the site's own «available players» call, like the page does when Play is pressed.
const onlyflixURL = 'https://onlyflix.to/';
const onlyflixCard = block => {
  const url = decode(attr(block, 'data-url')), show = /\/series\//.test(url);
  const backdrop = decode(attr(block, 'data-backdrop'));
  return item({ source: 'onlyflix', kind: show ? 'series' : 'movie', url, title: decode(attr(block, 'data-title')), isShow: show, ...(show ? { show: url } : {}), language: 'Inglés',
    year: attr(block, 'data-year'), rating: attr(block, 'data-rating'), overview: decode(attr(block, 'data-overview')), backdrop,
    poster: attr(/<img class="of-title-card-v2__poster"[^>]*>/.exec(block)?.[0] || '', 'src'),
    genres: unique(decode(attr(block, 'data-genres')).split(',').map(name => genre(name.trim()))).filter(Boolean) });
};
// Lists use three card styles: search (attributes), home and «best» pages.
const onlyflixEntry = (url, title, fields) => item({ source: 'onlyflix', kind: /\/series\//.test(url) ? 'series' : 'movie', url, title, language: 'Inglés', ...(/\/series\//.test(url) ? { isShow: true, show: url } : {}), ...fields });
const onlyflixCards = html => {
  const page = String(html), cards = [...page.matchAll(/<article class="of-title-card-v2"[\s\S]*?<\/a>/g)].map(match => onlyflixCard(match[0]));
  for (const [block] of page.matchAll(/<article class="ofb-card">[\s\S]*?<\/article>/g)) {
    const link = /class="ofb-card-link" href="([^"]+)" aria-label="([^"]*)"/.exec(block);
    if (link) cards.push(onlyflixEntry(link[1], decode(link[2]), { poster: attr(/<img[^>]*>/.exec(block)?.[0] || '', 'src') }));
  }
  for (const [block] of page.matchAll(/<article class="of-media-card[\s\S]*?<\/article>/g)) {
    const url = /class="of-media-card__link" href="([^"]+)"/.exec(block)?.[1] || '';
    cards.push(onlyflixEntry(url, text(/class="of-media-card__name">([\s\S]*?)<\/span>/.exec(block)?.[1]), { backdrop: attr(/<article[^>]*>/.exec(block)?.[0] || '', 'data-of-lazy-bg'),
      genres: unique(text(/class="of-media-card__genres">([\s\S]*?)<\/span>/.exec(block)?.[1]).split(',').map(name => genre(name.trim()))).filter(Boolean) }));
  }
  return [...new Map(cards.filter(entry => entry.title && entry.url.startsWith(onlyflixURL)).map(entry => [entry.url, entry])).values()];
};
export const onlyflix = {
  id: 'onlyflix', name: 'OnlyFlix', site: onlyflixURL, language: 'Inglés',
  parseHome: html => onlyflixCards(html),
  more(load) {
    const year = new Date().getFullYear();
    return genrePages(load, [year, year - 1].flatMap(value => [[`${onlyflixURL}best/movies/${value}/`, ''], [`${onlyflixURL}best/tv-shows/${value}/`, '']]), onlyflixCards);
  },
  parseSearch: html => onlyflixCards(html),
  searchURL: query => onlyflixURL + '?s=' + encodeURIComponent(query),
  async episodes(show, load) {
    const html = await load(show);
    const id = /\bpostid-(\d+)/.exec(html)?.[1], nonce = /data-player-nonce="([^"]+)"/.exec(html)?.[1] || '';
    if (!id) return [];
    const body = new URLSearchParams({ action: 'mcs_home_hero_tv_episodes', nonce, show_id: id }).toString();
    const answer = json(await load(onlyflixURL + 'wp-admin/admin-ajax.php', { method: 'POST', body, referrer: show, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } }));
    return (answer?.data?.seasons || []).map(season => ({ title: 'Temporada ' + season.season, number: Number(season.season),
      episodes: (season.episodes || []).filter(episode => /^https:\/\/onlyflix\.to\/episodes\//.test(episode.permalink)).map(episode => ({ url: episode.permalink, season: Number(season.season), episode: Number(episode.episode), label: 'Episodio ' + episode.episode })) }))
      .filter(season => season.episodes.length).sort((a, b) => a.number - b.number);
  },
  async resolve(entry, load) {
    const html = await load(entry.url);
    const value = name => attr(/class="player-frame[\s\S]*?>/.exec(html)?.[0] || '', name);
    const post = value('data-player-post-id');
    if (!post) throw Error('OnlyFlix no muestra reproductor para este título.');
    const body = new URLSearchParams({ action: 'mcp_get_available_players', nonce: value('data-player-nonce'), post_id: post, type: value('data-player-content-type') || 'movie' }).toString();
    const answer = json(await load(onlyflixURL + 'wp-admin/admin-ajax.php', { method: 'POST', body, referrer: entry.url, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } }));
    const players = (answer?.data?.players || []).filter(player => /^https:\/\//.test(player.url) && ['EN', ''].includes(String(player.language || '').toUpperCase()));
    if (!players.length) throw Error('OnlyFlix todavía no tiene servidores para este título.');
    return { url: players[0].url, referrer: entry.url, alternatives: players.slice(1).map(player => player.url) };
  }
};
