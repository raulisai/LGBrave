// Site connectors for Holy. Each one reads the newest titles from a site the owner
// already bookmarked, adds details (genres, synopsis, backdrop) and finds the
// player the site itself would open, so the TV can go straight to the video.
// Nothing here downloads media or removes a site's protections: the TV still
// loads the same player page, with the referrer it would have had.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export async function fetchText(url, { referrer, timeout = 15000, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(url, {
    method, body,
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.5', ...(referrer ? { Referer: referrer } : {}), ...headers },
    redirect: 'follow', signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw Error(`${new URL(url).hostname} respondió ${response.status}`);
  const text = await response.text();
  if (/<title>Just a moment|cf-chl-|challenges\.cloudflare\.com\/turnstile/.test(text) && !/<article|<li class="TPostMv|class="card/.test(text)) throw Error(`${new URL(url).hostname} pidió verificación de Cloudflare`);
  return text;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#039': "'", '#8217': '’', '#8211': '–', '#8230': '…' };
export function decode(value = '') {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (ENTITIES[code.toLowerCase()] !== undefined) return ENTITIES[code.toLowerCase()];
    if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : match; }
    return match;
  }).replace(/\s+/g, ' ').trim();
}
export const text = html => decode(String(html || '').replace(/<[^>]+>/g, ' '));
// Attribute values may be quoted or bare (Cuevana writes src=https://…).
export function attr(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag || '');
  return match ? decode(match[1] ?? match[2] ?? match[3]) : '';
}
export const absolute = (value, base) => { try { return value ? new URL(value, base).href : ''; } catch { return ''; } };
export const between = (html, start, end) => {
  const from = html.indexOf(start);
  if (from < 0) return '';
  const to = end ? html.indexOf(end, from + start.length) : -1;
  return html.slice(from, to < 0 ? undefined : to);
};
// TMDB serves any size from the same path; small posters keep the TV light.
export const tmdb = (url, size) => url.replace(/(image\.tmdb\.org\/t\/p\/)(w\d+|original)\//, `$1${size}/`);

// Genres become one vocabulary across sites so tastes carry over.
const GENRES = {
  accion: 'Acción', aventura: 'Aventura', aventuras: 'Aventura', animacion: 'Animación', comedia: 'Comedia', crimen: 'Crimen', drama: 'Drama',
  fantasia: 'Fantasía', terror: 'Terror', suspenso: 'Suspenso', thriller: 'Suspenso', misterio: 'Misterio', romance: 'Romance', 'ciencia ficcion': 'Ciencia ficción',
  'sci-fi': 'Ciencia ficción', documental: 'Documental', familia: 'Familia', guerra: 'Bélica', belica: 'Bélica', historica: 'Historia', historicas: 'Historia', historia: 'Historia',
  musical: 'Música', musica: 'Música', western: 'Western', biografia: 'Biografía', intriga: 'Misterio', deportes: 'Deportes', escolares: 'Escolar', escolar: 'Escolar',
  shounen: 'Shounen', seinen: 'Seinen', shoujo: 'Shoujo', josei: 'Josei', isekai: 'Isekai', mecha: 'Mecha', magia: 'Magia', 'super poderes': 'Superpoderes',
  'recuentos de la vida': 'Vida cotidiana', 'slice of life': 'Vida cotidiana', sobrenatural: 'Sobrenatural', psicologico: 'Psicológico', juegos: 'Juegos', samurai: 'Samurái',
  vampiros: 'Vampiros', militar: 'Bélica', policial: 'Crimen', medico: 'Médico', melodrama: 'Melodrama', juvenil: 'Juvenil', 'artes marciales': 'Artes marciales'
};
export const fold = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function genre(value) {
  const key = fold(decode(value));
  // Quality and format tags are not genres.
  if (/^(\d+k|hd|full hd|fhd|uhd|latino|castellano|subtitulado|sub espanol|tv|ova|ona|pelicula)$/.test(key)) return '';
  return GENRES[key] || (key ? key[0].toUpperCase() + key.slice(1) : '');
}
// Countries in one spelling across sites (DoramasFlix uses slugs).
const COUNTRIES = { corea: 'Corea del Sur', 'corea del sur': 'Corea del Sur', 'south korea': 'Corea del Sur', china: 'China', japon: 'Japón', tailandia: 'Tailandia', taiwan: 'Taiwán',
  filipinas: 'Filipinas', 'estados unidos': 'Estados Unidos', 'reino unido': 'Reino Unido', mexico: 'México', espana: 'España', francia: 'Francia', india: 'India', canada: 'Canadá', alemania: 'Alemania', italia: 'Italia',
  korea: 'Corea del Sur', 'republic of korea': 'Corea del Sur', japan: 'Japón', thailand: 'Tailandia', philippines: 'Filipinas', 'united states': 'Estados Unidos', usa: 'Estados Unidos',
  'united kingdom': 'Reino Unido', uk: 'Reino Unido', spain: 'España', france: 'Francia', germany: 'Alemania', italy: 'Italia', 'hong kong': 'Hong Kong', vietnam: 'Vietnam', indonesia: 'Indonesia' };
export function country(value) {
  const key = fold(decode(value || ''));
  if (!key || key === 'paises') return '';
  return COUNTRIES[key] || key.replace(/(^|\s)\S/g, letter => letter.toUpperCase());
}
// RePelisHD lists genres as plain words ("Comedia Crimen"); match known names, longest first.
export function genresFromWords(value) {
  let rest = ' ' + fold(decode(value)) + ' ';
  const found = [];
  for (const key of Object.keys(GENRES).sort((a, b) => b.length - a.length)) {
    if (rest.includes(' ' + key + ' ')) { found.push(GENRES[key]); rest = rest.replace(' ' + key + ' ', ' '); }
  }
  return [...new Set(found)];
}

// og:description sometimes repeats its own opening after the full text.
const unrepeated = value => { const again = value.indexOf(value.slice(0, 30), 30); return again > 0 ? value.slice(0, again).trim() : value; };
// Extra listing pages (genre pages, directories) for a bigger catalogue. A page that only
// repeats the site's default listing (unknown genre slug) is skipped, so no title is mislabelled.
export async function genrePages(load, pages, parse, defaultURL) {
  const first = defaultURL ? parse(await load(defaultURL).catch(() => '')).slice(0, 3).map(entry => entry.url).join('|') : '';
  const out = [];
  for (let index = 0; index < pages.length; index += 3) {
    const lists = await Promise.all(pages.slice(index, index + 3).map(async ([url, name]) => {
      const items = parse(await load(url).catch(() => ''));
      if (!items.length || (first && items.slice(0, 3).map(entry => entry.url).join('|') === first)) return [];
      return items.map(entry => ({ ...entry, genres: name ? [genre(name)] : entry.genres, listed: name || entry.listed }));
    }));
    out.push(...lists.flat());
  }
  return out;
}
// «hace 11 horas», «hace 2 días»… → hours (unknown → far away).
export function hoursAgo(value) {
  const match = /(\d+)\s*(minuto|hora|d[ií]a|semana|mes|año)/i.exec(String(value || ''));
  if (!match) return 1e6;
  const unit = { minuto: 1 / 60, hora: 1, dia: 24, día: 24, semana: 168, mes: 720, año: 8760 }[match[2].toLowerCase()];
  return Number(match[1]) * unit;
}
// Audio/subtitle versions as one label («Latino · Subtitulado»); unknown words are ignored, none → ''.
const VERSIONS = [['Latino', /latino|lat\b/i], ['Castellano', /castellano|espa[ñn]a\b|\bcast\b/i], ['Inglés', /ingl[ée]s|english|\beng\b/i], ['Subtitulado', /subtitulad|\bsub\b|sub\.? ?espa/i]];
export function languageLabel(words) {
  const found = new Set();
  for (const word of [].concat(words || [])) for (const [name, pattern] of VERSIONS) if (pattern.test(String(word))) found.add(name);
  return VERSIONS.map(([name]) => name).filter(name => found.has(name)).join(' · ');
}
export const item = fields => ({ genres: [], overview: '', backdrop: '', year: '', rating: '', badge: '', subtitle: '', ...fields });

export const cuevana = {
  id: 'cuevana', name: 'Cuevana 3', site: 'https://cuevana3c.pro/', pageFallback: true,
  // The tabs of the player list the versions the site has: Latino, Castellano, Subtitulado.
  languages: html => languageLabel([...html.matchAll(/class="tab-item-name">\s*([^<]+)/g)].map(match => match[1])),
  parseHome(html, base = this.site) {
    const items = [];
    for (const block of between(html, '<section class="home-movies"', '</section').split('<li class="TPostMv').slice(1)) {
      const link = /<a href="?([^"\s>]+)/.exec(block)?.[1];
      if (!/\/pelicula\//.test(link || '')) continue;
      const image = /<img[^>]*>/.exec(block)?.[0];
      items.push(item({
        source: 'cuevana', kind: 'movie', url: absolute(link, base), title: text(/<h2 class="Title">([\s\S]*?)<\/h2>/.exec(block)?.[1]),
        poster: tmdb(absolute(attr(image, 'src'), base), 'w342'), year: text(/class="Date">([^<]*)/.exec(block)?.[1] || /class="Year">([^<]*)/.exec(block)?.[1]),
        rating: text(/class="Vote">([^<]*)/.exec(block)?.[1]), badge: text(/class="Qlty">([^<]*)/.exec(block)?.[1]),
        overview: text(/class="Description"><p>([\s\S]*?)<\/p>/.exec(block)?.[1]).replace(/\s*\[\.\.\.\]$/, '…')
      }));
    }
    for (const block of between(html, '<section class="home-series home-episodes"', '</section').split('<article class="TPost C"').slice(1)) {
      const link = /<a href="?([^"\s>]+)/.exec(block)?.[1];
      if (!/\/episodio-/.test(link || '')) continue;
      const image = /<img[^>]*>/.exec(block)?.[0];
      const episode = text(/Episodio <span>([^<]*)/.exec(block)?.[1]);
      items.push(item({
        source: 'cuevana', kind: 'series', url: absolute(link, base), show: absolute(link, base).replace(/\/episodio-[^/]+$/, ''),
        title: text(/<h2 class="Title">([\s\S]*?)<\/h2>/.exec(block)?.[1]), subtitle: episode ? 'Episodio ' + episode : '', badge: episode,
        poster: tmdb(absolute(attr(image, 'src'), base), 'w342'), backdrop: tmdb(absolute(attr(image, 'src'), base), 'w780')
      }));
    }
    return items;
  },
  parseDetail(html, base) {
    const hero = between(html, 'backdrop-info', 'class="player"');
    return {
      genres: [...html.matchAll(/genero=[^"]*" class="jump-link">([^<]*)/g)].map(match => genre(match[1])).filter(Boolean),
      overview: text(/<\/h1>\s*<p>([\s\S]*?)<\/p>/.exec(hero)?.[1]),
      backdrop: tmdb(absolute(attr(/backdrop-image"><figure><img[^>]*>/.exec(html)?.[0], 'src'), base), 'w1280'),
      players: [...html.matchAll(/data-server="([^"]+)"/g)].map(match => decode(match[1])),
      language: this.languages(html)
    };
  },
  async more(load) {
    const slugs = [['accion', 'Acción'], ['comedia', 'Comedia'], ['drama', 'Drama'], ['terror', 'Terror'], ['suspense', 'Suspenso'], ['ciencia-ficcion', 'Ciencia ficción'], ['romance', 'Romance'],
      ['animacion', 'Animación'], ['aventura', 'Aventura'], ['crimen', 'Crimen'], ['fantasia', 'Fantasía'], ['familia', 'Familia'], ['misterio', 'Misterio'], ['documental', 'Documental'], ['belica', 'Bélica']];
    const pages = [['https://cuevana3c.pro/peliculas?page=2', ''], ...slugs.map(([slug, name]) => ['https://cuevana3c.pro/peliculas?genero=' + slug, name])];
    return genrePages(load, pages, html => this.parseSearch(html), 'https://cuevana3c.pro/peliculas');
  },
  searchURL: query => 'https://cuevana3c.pro/explorar?s=' + encodeURIComponent(query),
  parseSearch(html, base = this.site) {
    return html.split('<div class="movie-item">').slice(1).map(block => {
      const link = absolute(/<a href="?([^"\s>]+)/.exec(block)?.[1], base);
      const image = /<img[^>]*>/.exec(block)?.[0];
      const movie = /\/pelicula\//.test(link);
      if (!movie && !/\/serie\/[^/]+$/.test(link)) return null;
      return item({ source: 'cuevana', kind: movie ? 'movie' : 'series', url: link, ...(movie ? {} : { show: link, isShow: true }),
        title: text(/<div class="item-detail"><p>([\s\S]*?)<\/p>/.exec(block)?.[1]), year: text(/class="year[^"]*">([^<]*)/.exec(block)?.[1]),
        poster: tmdb(absolute(attr(image, 'src'), base), 'w342') });
    }).filter(Boolean);
  },
  // Seasons are separate pages; each lists its episodes.
  async episodes(show, load) {
    const html = await load(show);
    const seasons = [...new Set([...html.matchAll(/href="([^"]+\/temporada-(\d+))"/g)].map(match => match[1]))].slice(0, 15);
    const lists = await Promise.all(seasons.map(async url => {
      const number = Number(/temporada-(\d+)$/.exec(url)[1]);
      const page = await load(url).catch(() => '');
      const episodes = [...new Set([...page.matchAll(/href="([^"]+\/episodio-(\d+)x(\d+))"/g)].map(match => match[1]))]
        .map(link => { const [, season, episode] = /episodio-(\d+)x(\d+)$/.exec(link); return { url: absolute(link, show), season: Number(season), episode: Number(episode), label: `Episodio ${season}x${episode}` }; })
        .filter(entry => entry.season === number).sort((a, b) => a.episode - b.episode);
      return { title: 'Temporada ' + number, number, episodes };
    }));
    return lists.filter(list => list.episodes.length).sort((a, b) => a.number - b.number);
  },
  // The page lists Latino first. The site's own player supports pops=false (fewer ad windows).
  // The rest of the site's servers stay as alternatives if the first never starts.
  player(detail, page) {
    const urls = [];
    for (const value of detail.players) {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !/(^|\.)cuevana3c\.pro$/.test(url.hostname)) continue;
        url.searchParams.set('pops', 'false');
        if (!urls.includes(url.href)) urls.push(url.href);
      } catch { /* Next server. */ }
    }
    return urls.length ? { url: urls[0], referrer: page, alternatives: urls.slice(1, 4) } : null;
  }
};

export const jkanime = {
  id: 'jkanime', name: 'JKAnime', site: 'https://jkanime.net/', pageFallback: true, language: 'Subtitulado',
  detailURL: entry => entry.show || entry.url,
  parseHome(html, base = this.site) {
    // Only the «Animes» tab: the page also carries donghua and adult tabs.
    const pane = between(html, 'id="animes" role="tabpanel"', 'class="tab-pane');
    const items = [];
    // «Animes recientes»: new series, opened as a show with its episode list.
    for (const block of between(html, '<h4>Animes recientes</h4>', '</section>').split('custom_thumb_home').slice(1)) {
      const show = absolute(/<a href="([^"]+)"/.exec(block)?.[1], base);
      if (!/^https:\/\/jkanime\.net\/[^/]+\/$/.test(show)) continue;
      items.push(item({ source: 'jkanime', kind: 'anime', url: show, show, isShow: true, title: text(/card-title">\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]),
        poster: absolute(attr(/<img[^>]*>/.exec(block)?.[0], 'src'), base), badge: text(/class="badge TV">([^<]*)/.exec(block)?.[1]) || 'Serie' }));
    }
    for (const block of pane.split('class="card ').slice(1)) {
      const link = /<a href="([^"]+)"/.exec(block)?.[1];
      const match = /^(https?:\/\/[^/]+\/[^/]+\/)(\d+)\/?$/.exec(absolute(link, base));
      if (!match) continue;
      const image = /<img[^>]*>/.exec(block)?.[0];
      const episode = match[2];
      items.push(item({
        source: 'jkanime', kind: 'anime', url: match[1] + episode + '/', show: match[1], episode: Number(episode),
        title: text(/card-title">([\s\S]*?)<\/h5>/.exec(block)?.[1]), subtitle: 'Episodio ' + episode, badge: 'Ep ' + episode,
        poster: absolute(attr(image, 'data-animepic'), base), backdrop: absolute(attr(image, 'src'), base)
      }));
    }
    return items;
  },
  // «Horario»: the anime airing now (One Piece and the like), each with its latest episode.
  parseAiring(html, base = this.site) {
    const items = [];
    for (const block of html.split("class='box img'").slice(1)) {
      const show = absolute(/<a href="([^"]+)"/.exec(block)?.[1], base);
      if (!/^https:\/\/jkanime\.net\/[^/]+\/$/.test(show)) continue;
      const image = /<img[^>]*>/.exec(block)?.[0];
      const latest = Number(/Último capítulo:\s*(\d+)/.exec(block)?.[1]) || 0;
      items.push(item({ source: 'jkanime', kind: 'anime', url: show, show, isShow: true, airing: true, latest, ago: hoursAgo(/<time>([^<]*)<\/time>/.exec(block)?.[1]),
        title: text(/<h3>([\s\S]*?)<\/h3>/.exec(block)?.[1]) || attr(image, 'title'), poster: absolute(attr(image, 'src'), base),
        badge: 'En emisión', subtitle: latest ? 'Último episodio: ' + latest : 'En emisión' }));
    }
    return items;
  },
  more(load) { return load('https://jkanime.net/horario/').then(html => this.parseAiring(html)); },
  parseDetail(html) {
    return {
      genres: [...new Set([...html.matchAll(/\/genero\/[^"]*\/?">([^<]+)</g)].map(match => genre(match[1])))].filter(Boolean),
      overview: text(/<p class="scroll">([\s\S]*?)<\/p>/.exec(html)?.[1]),
      studios: [...new Set([...between(html, 'Studios:</span>', '</li>').matchAll(/>([^<]+)<\/a>/g)].map(match => decode(match[1])))].filter(Boolean).slice(0, 3), country: 'Japón'
    };
  },
  // video[0] is the site's own player (Desu), the one validated on the TV.
  async resolve(entry, load) {
    const html = await load(entry.url);
    const frames = [...html.matchAll(/video\[\d+\]\s*=\s*'<iframe[^']*?src="([^"]+)"/g)].map(match => decode(match[1]));
    const own = frames.filter(value => /^https:\/\/jkanime\.net\/jkplayer\//.test(value));
    return own.length ? { url: own[0], referrer: entry.url, alternatives: own.slice(1, 3) } : null;
  },
  searchURL: query => 'https://jkanime.net/buscar/' + encodeURIComponent(query.trim().replace(/\s+/g, '_')) + '/',
  parseSearch(html, base = this.site) {
    return html.split('class="anime__item">').slice(1).map(block => {
      const show = absolute(/<a\s+href="([^"]+)"/.exec(block)?.[1], base);
      if (!/^https:\/\/jkanime\.net\/[^/]+\/$/.test(show)) return null;
      return item({ source: 'jkanime', kind: 'anime', url: show, show, isShow: true, title: text(/<h5><a[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1]),
        poster: absolute(attr(/<div[^>]*data-setbg="[^"]*"[^>]*>/.exec(block)?.[0], 'data-setbg'), base),
        badge: text(/<li class="anime">([^<]*)/.exec(block)?.[1]), subtitle: text(/<ul><li>([^<]*)/.exec(block)?.[1]) });
    }).filter(Boolean);
  },
  // The site's own episode list (paginated JSON); ongoing shows report 0 on the page itself.
  async episodes(show, load, post) {
    const html = await load(show);
    const id = /ajax\/episodes\/(\d+)\//.exec(html)?.[1];
    if (!id) return [];
    const page = async n => JSON.parse(await post(`https://jkanime.net/ajax/episodes/${id}/${n}`, show));
    const first = await page(1);
    const last = first.last_page > 1 ? await page(first.last_page) : first;
    const thumbs = new Map([...first.data, ...last.data].map(entry => [entry.number, entry.image]));
    const top = Math.max(0, ...last.data.map(entry => entry.number), ...first.data.map(entry => entry.number));
    const episodes = Array.from({ length: top }, (_, index) => {
      const number = top - index;
      const image = thumbs.get(number);
      return { url: show + number + '/', episode: number, label: 'Episodio ' + number, still: image ? 'https://cdn.jkdesa.com/assets/images/animes/video/image/' + image : '' };
    });
    // Long shows read better in blocks of 50, newest first.
    const blocks = [];
    for (let index = 0; index < episodes.length; index += 50) {
      const chunk = episodes.slice(index, index + 50);
      blocks.push({ title: `Episodios ${chunk.at(-1).episode}–${chunk[0].episode}`, episodes: chunk });
    }
    return blocks;
  },
  episodeURL: (show, episode) => show + episode + '/',
  next(entry) {
    return entry.show && entry.episode ? { ...entry, url: entry.show + (entry.episode + 1) + '/', episode: entry.episode + 1, subtitle: 'Episodio ' + (entry.episode + 1), badge: 'Ep ' + (entry.episode + 1) } : null;
  }
};

export const repelishd = {
  id: 'repelishd', name: 'RePelisHD', site: 'https://repelishd.blog/', language: 'Latino',
  parseHome(html, base = this.site) {
    const items = [];
    for (const heading of ['Últimas Películas Agregadas', 'Películas en Cines', 'Tendencias de hoy', 'Películas Recomendadas']) {
      const section = between(html, '>' + heading + '</h2>', '<h2');
      for (const block of section.split('<article class="item movies"').slice(1)) {
        const link = /<a href="([^"]+)"/.exec(block)?.[1];
        if (!/\/ver-pelicula\//.test(link || '')) continue;
        const image = /<img[^>]*>/.exec(block)?.[0];
        items.push(item({
          source: 'repelishd', kind: 'movie', url: absolute(link, base), title: text(/<h3>([\s\S]*?)<\/h3>/.exec(block)?.[1]) || attr(image, 'alt'),
          poster: absolute(attr(image, 'src') || attr(image, 'data-src'), base), year: text(/<\/h3>\s*<span>([^<]*)/.exec(block)?.[1]),
          rating: text(/icon-star2><\/span>([^<]*)/.exec(block)?.[1]), badge: text(/class="quality">([^<]*)/.exec(block)?.[1])
        }));
      }
    }
    return items;
  },
  parseDetail(html) {
    const extra = between(html, '<div class="extra">', '</div>');
    const spans = [...extra.matchAll(/<span>([^<]*)<\/span>/g)].map(match => match[1]);
    return {
      genres: spans.flatMap(genresFromWords),
      overview: unrepeated(decode(/og:description" content="([^"]*)"/.exec(html)?.[1] || '')),
      imdb: /var imdb\s*=\s*'(tt\d+)'/.exec(html)?.[1] || '',
      country: country(/class="country"><a[^>]*>([^<]+)/.exec(html)?.[1])
    };
  },
  async more(load) {
    const slugs = [['accion', 'Acción'], ['comedia', 'Comedia'], ['drama', 'Drama'], ['terror', 'Terror'], ['thriller', 'Suspenso'], ['ciencia-ficcion', 'Ciencia ficción'], ['romance', 'Romance'],
      ['animacion', 'Animación'], ['aventuras', 'Aventura'], ['crimen', 'Crimen'], ['fantasia', 'Fantasía'], ['familia', 'Familia'], ['misterio', 'Misterio'], ['documental', 'Documental'], ['belica', 'Bélica'], ['suspenso', 'Suspenso']];
    return genrePages(load, slugs.map(([slug, name]) => [`https://repelishd.blog/${slug}/`, name]), html => this.parseSearch(html));
  },
  searchURL: query => 'https://repelishd.blog/index.php?do=search&subaction=search&story=' + encodeURIComponent(query),
  parseSearch(html, base = this.site) {
    return html.split('<article class="item movies"').slice(1).map(block => {
      const link = /<a href="([^"]+)"/.exec(block)?.[1];
      if (!/\/ver-pelicula\//.test(link || '')) return null;
      const image = /<img[^>]*>/.exec(block)?.[0];
      return item({ source: 'repelishd', kind: 'movie', url: absolute(link, base), title: text(/<h3>([\s\S]*?)<\/h3>/.exec(block)?.[1]) || attr(image, 'alt'),
        poster: absolute(attr(image, 'src') || attr(image, 'data-src'), base), year: text(/<\/h3>\s*<span>([^<]*)/.exec(block)?.[1]),
        rating: text(/icon-star2><\/span>([^<]*)/.exec(block)?.[1]), badge: text(/class="quality">([^<]*)/.exec(block)?.[1]) });
    }).filter(Boolean);
  },
  // The page embeds playlatinsrc.co/movie/<imdb>, which asks its own API for servers.
  // Holy asks the same API and opens Mixdrop (then Doodstream) directly. Dropload/
  // dr0pstream and UnlimPlay load a Cloudflare check that closes the TV app: a title
  // with only those is refused instead of opened.
  async resolve(entry, load) {
    const detail = this.parseDetail(await load(entry.url));
    if (!detail.imdb) throw Error('RePelisHD no indicó el reproductor de este título.');
    const page = 'https://playlatinsrc.co/movie/' + detail.imdb;
    const html = await load(page, { referrer: entry.url });
    const token = /token:\s*"([^"]+)"/.exec(html)?.[1];
    if (!token) throw Error('PlayLatinSrc cambió su página.');
    const data = JSON.parse(await load('https://playlatinsrc.co/api/embed-links', {
      method: 'POST', referrer: page, headers: { 'Content-Type': 'application/json', Origin: 'https://playlatinsrc.co' },
      body: JSON.stringify({ type: 'movie', id: detail.imdb, token })
    }));
    const [choice, ...rest] = rankServers(data.sources || []);
    if (!choice) throw Object.assign(Error('Este título solo tiene servidores que cierran la app en la TV.'), { unsafe: true });
    return { url: choice.url, referrer: page, server: choice.name, version: choice.version, alternatives: rest.slice(0, 3).map(source => source.url) };
  }
};

const RISKY = /(^|\.)(dr0pstream\.com|dropload\.(io|tv)|unlimplay\.com)$/;
const SERVER_RANK = [/(^|\.)(mixdrop|mxdrop|m1xdrop)\.[a-z]+$/, /(^|\.)(doodstream|dood|d0000d|dsvplay)\.[a-z]+$/];
const VERSION_RANK = ['latino', 'castellano', 'subtitulado'];
export const pickServer = sources => rankServers(sources)[0] || null;
// Safe servers only, best first (Mixdrop, Doodstream; Latino, Castellano, Subtitulado).
export function rankServers(sources) {
  const host = source => { try { const url = new URL(source.url); return url.protocol === 'https:' ? url.hostname : ''; } catch { return ''; } };
  const rank = source => {
    const server = SERVER_RANK.findIndex(pattern => pattern.test(host(source)));
    const version = VERSION_RANK.indexOf(String(source.version || '').toLowerCase());
    return (server < 0 ? SERVER_RANK.length : server) * 10 + (version < 0 ? VERSION_RANK.length : version);
  };
  return (Array.isArray(sources) ? sources : []).filter(source => host(source) && !RISKY.test(host(source))).sort((a, b) => rank(a) - rank(b));
}

export const doramasmp4 = {
  id: 'doramasmp4', name: 'DoramasMP4', site: 'https://doramasmp4.cyou/', language: 'Subtitulado',
  parseHome(html, base = this.site) {
    const items = [];
    for (const block of between(html, 'Últimos Estrenos', 'Más populares').split('<article class="bs"').slice(1)) {
      const anchor = /<a href="([^"]+)"[^>]*title="([^"]*)"/.exec(block);
      if (!anchor || !/\/cap\//.test(anchor[1])) continue;
      const image = /<img[^>]*>/.exec(block)?.[0];
      const name = text(/<div class="tt">([^<]*)</.exec(block)?.[1]) || decode(anchor[2]).replace(/\s+Capitulo\s+\d+.*$/i, '');
      const episode = /Capitulo\s+(\d+)/i.exec(decode(anchor[2]))?.[1] || '';
      items.push(item({
        source: 'doramasmp4', kind: 'dorama', url: absolute(anchor[1], base), title: name,
        subtitle: decode(anchor[2]).replace(name, '').trim(), badge: episode ? 'Cap ' + episode : '',
        poster: absolute(attr(image, 'src'), base).replace(/\?resize=\d+,\d+$/, '?resize=246,350')
      }));
    }
    return items;
  },
  parseDetail(html) {
    const players = [...html.matchAll(/<option[^>]*value="([A-Za-z0-9+/=]{20,})"[^>]*>([^<]*)/g)].map(match => {
      let src = '';
      try { src = attr(/<iframe[^>]*>/.exec(Buffer.from(match[1], 'base64').toString('utf8'))?.[0], 'src'); } catch { /* Not a player. */ }
      return { name: decode(match[2]), src };
    }).filter(player => /^https:\/\//.test(player.src));
    return {
      // Only the episode's own «genxed» block; the sidebar lists other series' genres.
      genres: [...new Set([...between(html, 'class="genxed"', '</div>').matchAll(/\/genres\/[^"]*" rel="tag">([^<]+)/g)].map(match => genre(match[1])))],
      country: country(/País:<\/b>\s*<a[^>]*>([^<]+)/.exec(html)?.[1]),
      players
    };
  },
  async more(load) {
    return genrePages(load, [['https://doramasmp4.cyou/series/?status=&type=&order=update', ''], ['https://doramasmp4.cyou/series/?page=2&status=&type=&order=update', '']], html => this.parseSearch(html));
  },
  searchURL: query => 'https://doramasmp4.cyou/?s=' + encodeURIComponent(query),
  parseSearch(html, base = this.site) {
    return html.split('<article class="bs"').slice(1).map(block => {
      const anchor = /<a href="([^"]+)"[^>]*title="([^"]*)"/.exec(block);
      if (!anchor) return null;
      const url = absolute(anchor[1], base);
      const image = /<img[^>]*>/.exec(block)?.[0];
      const show = /\/series\/[^/]+\/$/.test(url);
      if (!show && !/\/cap\//.test(url)) return null;
      return item({ source: 'doramasmp4', kind: 'dorama', url, ...(show ? { show: url, isShow: true } : {}), title: decode(anchor[2]),
        poster: absolute(attr(image, 'src'), base), badge: text(/class="epx">([^<]*)/.exec(block)?.[1]) });
    }).filter(Boolean);
  },
  async episodes(show, load) {
    const slug = /\/series\/([^/]+)\/$/.exec(show)?.[1];
    if (!slug) return [];
    const html = await load(show);
    const pattern = new RegExp(`href="(https://[^"]+/cap/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-capitulo-(\\d+)/)"`, 'g');
    const episodes = [...new Map([...html.matchAll(pattern)].map(match => [Number(match[2]), match[1]]))]
      .sort((a, b) => a[0] - b[0]).map(([episode, url]) => ({ url, episode, label: 'Capítulo ' + episode }));
    return episodes.length ? [{ title: 'Capítulos', episodes }] : [];
  },
  // Some episodes only offer pkaa.top, itself a server picker (go_to_player('…')): open it on the
  // Mac and use its servers, so the TV goes straight to ok.ru.
  async resolve(entry, load) {
    const detail = this.parseDetail(await load(entry.url));
    const players = [];
    for (const player of detail.players) {
      if (/(^|\.)pkaa\.top$/.test(new URL(player.src).hostname)) {
        const html = await load(player.src, { referrer: entry.url }).catch(() => '');
        const inner = [...html.matchAll(/go_to_player\('(https:\/\/[^']+)'\)/g)].map(match => ({ name: '', src: decode(match[1]) }));
        players.push(...(inner.length ? inner : [player]));
      } else players.push(player);
    }
    return this.player({ ...detail, players }, entry.url);
  },
  // ok.ru is a plain video host page: prefer it over unknown embeds; VK last.
  player(detail, page) {
    const host = player => { try { return new URL(player.src).hostname; } catch { return ''; } };
    const okru = player => /(^|\.)ok\.ru$/.test(host(player));
    const rank = player => (okru(player) ? 0 : /(^|\.)vk(video)?\.(ru|com)$/.test(host(player)) ? 2 : 1);
    const ordered = [...detail.players].filter(player => host(player)).sort((a, b) => rank(a) - rank(b));
    if (!ordered.length) return null;
    // ok.ru's embed supports starting on its own.
    const urls = ordered.map(player => { const url = new URL(player.src); if (okru(player)) url.searchParams.set('autoplay', '1'); return url.href; });
    return { url: urls[0], referrer: page, alternatives: urls.slice(1, 3) };
  }
};
