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
const text = html => decode(String(html || '').replace(/<[^>]+>/g, ' '));
// Attribute values may be quoted or bare (Cuevana writes src=https://…).
export function attr(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag || '');
  return match ? decode(match[1] ?? match[2] ?? match[3]) : '';
}
const absolute = (value, base) => { try { return value ? new URL(value, base).href : ''; } catch { return ''; } };
const between = (html, start, end) => {
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
const fold = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function genre(value) {
  const key = fold(decode(value));
  return GENRES[key] || (key ? key[0].toUpperCase() + key.slice(1) : '');
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
const item = fields => ({ genres: [], overview: '', backdrop: '', year: '', rating: '', badge: '', subtitle: '', ...fields });

export const cuevana = {
  id: 'cuevana', name: 'Cuevana 3', site: 'https://cuevana3c.pro/',
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
      players: [...html.matchAll(/data-server="([^"]+)"/g)].map(match => decode(match[1]))
    };
  },
  // The page lists Latino first. The site's own player supports pops=false (fewer ad windows).
  player(detail, page) {
    for (const value of detail.players) {
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !/(^|\.)cuevana3c\.pro$/.test(url.hostname)) continue;
        url.searchParams.set('pops', 'false');
        return { url: url.href, referrer: page };
      } catch { /* Next server. */ }
    }
    return null;
  }
};

export const jkanime = {
  id: 'jkanime', name: 'JKAnime', site: 'https://jkanime.net/',
  parseHome(html, base = this.site) {
    // Only the «Animes» tab: the page also carries donghua and adult tabs.
    const pane = between(html, 'id="animes" role="tabpanel"', 'class="tab-pane');
    const items = [];
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
  parseDetail(html) {
    return {
      genres: [...new Set([...html.matchAll(/\/genero\/[^"]*\/?">([^<]+)</g)].map(match => genre(match[1])))].filter(Boolean),
      overview: text(/<p class="scroll">([\s\S]*?)<\/p>/.exec(html)?.[1])
    };
  },
  // video[0] is the site's own player (Desu), the one validated on the TV.
  async resolve(entry, load) {
    const html = await load(entry.url);
    const frames = [...html.matchAll(/video\[\d+\]\s*=\s*'<iframe[^']*?src="([^"]+)"/g)].map(match => decode(match[1]));
    const url = frames.find(value => /^https:\/\/jkanime\.net\/jkplayer\//.test(value));
    return url ? { url, referrer: entry.url } : null;
  },
  next(entry) {
    return entry.show && entry.episode ? { ...entry, url: entry.show + (entry.episode + 1) + '/', episode: entry.episode + 1, subtitle: 'Episodio ' + (entry.episode + 1), badge: 'Ep ' + (entry.episode + 1) } : null;
  }
};

export const repelishd = {
  id: 'repelishd', name: 'RePelisHD', site: 'https://repelishd.blog/',
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
      imdb: /var imdb\s*=\s*'(tt\d+)'/.exec(html)?.[1] || ''
    };
  },
  // The page embeds playlatinsrc.co/movie/<imdb>, which asks its own API for servers.
  // Holy asks the same API and opens Mixdrop (then Doodstream) directly. Dropload/
  // dr0pstream and UnlimPlay load a Cloudflare check that closes the TV app: a title
  // with only those is refused instead of opened.
  noPageFallback: true,
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
    const choice = pickServer(data.sources || []);
    if (!choice) throw Object.assign(Error('Este título solo tiene servidores que cierran la app en la TV.'), { unsafe: true });
    return { url: choice.url, referrer: page, server: choice.name, version: choice.version };
  }
};

const RISKY = /(^|\.)(dr0pstream\.com|dropload\.(io|tv)|unlimplay\.com)$/;
const SERVER_RANK = [/(^|\.)(mixdrop|mxdrop|m1xdrop)\.[a-z]+$/, /(^|\.)(doodstream|dood|d0000d|dsvplay)\.[a-z]+$/];
const VERSION_RANK = ['latino', 'castellano', 'subtitulado'];
export function pickServer(sources) {
  const host = source => { try { const url = new URL(source.url); return url.protocol === 'https:' ? url.hostname : ''; } catch { return ''; } };
  const rank = source => {
    const server = SERVER_RANK.findIndex(pattern => pattern.test(host(source)));
    const version = VERSION_RANK.indexOf(String(source.version || '').toLowerCase());
    return (server < 0 ? SERVER_RANK.length : server) * 10 + (version < 0 ? VERSION_RANK.length : version);
  };
  return sources.filter(source => host(source) && !RISKY.test(host(source))).sort((a, b) => rank(a) - rank(b))[0] || null;
}

export const doramasmp4 = {
  id: 'doramasmp4', name: 'DoramasMP4', site: 'https://doramasmp4.cyou/',
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
      players
    };
  },
  // ok.ru is a plain video host page: prefer it over unknown embeds.
  player(detail, page) {
    const choice = detail.players.find(player => /(^|\.)ok\.ru$/.test(new URL(player.src).hostname)) || detail.players[0];
    if (!choice) return null;
    const url = new URL(choice.src);
    // ok.ru's embed supports starting on its own.
    if (/(^|\.)ok\.ru$/.test(url.hostname)) url.searchParams.set('autoplay', '1');
    return { url: url.href, referrer: page };
  }
};

export const CONNECTORS = [cuevana, repelishd, jkanime, doramasmp4];
export const connectorFor = id => CONNECTORS.find(connector => connector.id === id);
