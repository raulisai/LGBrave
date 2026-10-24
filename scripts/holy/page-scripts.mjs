// Code that runs inside the TV's pages. Kept as plain functions so tests can
// run them against a fake DOM; the bridge sends their source text.

// Holy's curtain: covers the site while the player is found and started. It is
// drawn in the bridge's isolated world, never takes clicks (pointer-events:none)
// and uses no innerHTML (Trusted Types on some players).
export function holyCurtain(data) {
  if (window.top !== window || window.__holyCurtain) return;
  let host = null, message = null;
  const draw = () => {
    if (host || !document.documentElement) return !!host;
    host = document.createElement('holy-curtain');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;transition:opacity .45s ease';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `.c{position:absolute;inset:0;background:#000 center/cover no-repeat;font-family:system-ui,"LG Smart UI",Arial,sans-serif;color:#fff}
      .v{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.92) 0%,rgba(0,0,0,.65) 45%,rgba(0,0,0,.25) 100%),linear-gradient(0deg,#000 0%,transparent 45%)}
      .t{position:absolute;left:120px;bottom:170px;max-width:1100px}
      .b{font-size:26px;font-weight:800;letter-spacing:6px;color:#e50914;margin-bottom:22px}
      h1{font-size:76px;line-height:1.02;margin:0 0 14px;font-weight:800;letter-spacing:-1px;text-shadow:0 6px 30px rgba(0,0,0,.6)}
      p{font-size:30px;margin:0;color:#d6d6d6}
      .s{display:flex;align-items:center;gap:22px;margin-top:44px;font-size:28px;color:#fff}
      .r{width:46px;height:46px;border-radius:50%;border:5px solid rgba(255,255,255,.25);border-top-color:#e50914;animation:spin .9s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}`;
    const card = document.createElement('div'); card.className = 'c';
    if (data.backdrop) card.style.backgroundImage = `url("${String(data.backdrop).replace(/["\\]/g, '')}")`;
    const veil = document.createElement('div'); veil.className = 'v';
    const text = document.createElement('div'); text.className = 't';
    const brand = document.createElement('div'); brand.className = 'b'; brand.textContent = 'HOLY';
    const title = document.createElement('h1'); title.textContent = data.title || '';
    const subtitle = document.createElement('p'); subtitle.textContent = data.subtitle || '';
    const status = document.createElement('div'); status.className = 's';
    const ring = document.createElement('div'); ring.className = 'r';
    message = document.createElement('span'); message.textContent = data.message || 'Preparando el vídeo…';
    status.append(ring, message); text.append(brand, title, subtitle, status);
    card.append(veil, text); root.append(style, card);
    document.documentElement.append(host);
    return true;
  };
  if (!draw()) {
    const observer = new MutationObserver(() => { if (draw()) observer.disconnect(); });
    observer.observe(document, { childList: true });
  }
  Object.defineProperty(window, '__holyCurtain', { value: {
    say(text) { if (message) message.textContent = text; },
    hide() { if (!host) return; host.style.opacity = '0'; const node = host; setTimeout(() => node.remove(), 500); }
  } });
}

// Back on the remote returns to Holy from any frame of a player page, even when
// focus sits inside the player's iframe. Runs in the bridge's isolated world.
// Each Mac connection stamps the page (data-holy-bridge="<its world>|<time>", visible to
// every world): only the handler of the live connection asks the Mac; handlers left by
// an older connection step aside; with no live connection at all, the first handler
// takes the page to Holy's home itself. Back never does nothing.
// A player iframe may not navigate the top page (cross-origin Location, sandbox), so
// it asks the top page's own handler to leave and also tries directly.
export function holyRemote(homes = [], home = '', world = '') {
  // Holy's own home handles its keys itself.
  if (window.__holyRemote || homes.some(entry => location.href.startsWith(entry))) return;
  Object.defineProperty(window, '__holyRemote', { value: true });
  const leave = () => {
    if (!home) return;
    if (window.top !== window) try { window.top.postMessage({ holyHome: home }, '*'); } catch { /* Try directly below. */ }
    try { window.top.location.href = home; } catch { /* The top page leaves on the message. */ }
  };
  addEventListener('message', event => {
    if (window.top !== window || event.data?.holyHome !== home || window.__holyLeaving) return;
    window.__holyLeaving = true;
    location.href = home;
  });
  addEventListener('keydown', event => {
    const root = document.documentElement;
    // While Holy's end card is up, OK and the arrows belong to it (not to the player).
    const card = root?.dataset.holyCard === '1' && [13, 37, 38, 39, 40].includes(event.keyCode);
    if (event.keyCode !== 461 && event.keyCode !== 27 && !card) return;
    const [owner, at] = String(root?.dataset.holyBridge || '').split('|');
    const live = Date.now() - Number(at || 0) < 6000;
    if (live && owner !== world) return; // A newer connection's handler answers.
    if (card) {
      if (!live || typeof window.__lgLabCommand !== 'function') return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { window.__lgLabCommand(JSON.stringify({ action: 'card', key: event.keyCode })); } catch { /* The card stays. */ }
      return;
    }
    if (root?.dataset.holyBack === String(event.timeStamp)) return;
    if (root) root.dataset.holyBack = String(event.timeStamp);
    event.preventDefault(); event.stopImmediatePropagation();
    if (live && typeof window.__lgLabCommand === 'function') {
      try { window.__lgLabCommand(JSON.stringify({ action: 'back' })); return; } catch { /* Go home directly below. */ }
    }
    leave();
  }, true);
}

// The end of a title, over the player (top page, bridge's isolated world): the next
// episode with a countdown, the last one available, or for a film «Volver al inicio»
// and similar films. The Mac decides; this only draws, counts down and passes clicks.
export function holyEndCard(data) {
  if (window.top !== window || !document.documentElement) return false;
  document.querySelector('holy-end')?.remove();
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const host = document.createElement('holy-end');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}.w{position:absolute;inset:0;font-family:system-ui,"LG Smart UI",Arial,sans-serif;color:#fff;animation:in .4s ease}
    .shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.95) 0%,rgba(0,0,0,.7) 38%,rgba(0,0,0,.15) 70%,transparent 100%)}
    .p{position:absolute;left:110px;right:110px;bottom:90px;pointer-events:auto}
    .k{font-size:24px;font-weight:800;letter-spacing:5px;color:#e50914;margin-bottom:14px}
    h1{font-size:58px;line-height:1.05;margin:0 0 10px;font-weight:800}
    .sub{font-size:28px;color:#cfcfcf;margin:0 0 34px}
    .row{display:flex;gap:26px;align-items:flex-end}
    .next{display:flex;gap:30px;align-items:center}
    .thumb{width:420px;height:236px;border-radius:12px;background:#222 center/cover no-repeat;flex:none;box-shadow:0 10px 40px rgba(0,0,0,.6)}
    .b{position:relative;overflow:hidden;min-width:250px;height:76px;padding:0 34px;border-radius:10px;border:0;font:700 28px system-ui,Arial,sans-serif;color:#fff;background:rgba(109,109,110,.7);display:flex;align-items:center;gap:14px;cursor:pointer;transition:transform .15s}
    .b .fill{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,.28)}
    .b span{position:relative}
    .b.f{background:#fff;color:#000;transform:scale(1.06)}
    .b.f .fill{background:rgba(0,0,0,.14)}
    .tile{width:230px;flex:none;border-radius:10px;overflow:hidden;background:#1d1d1d;border:4px solid transparent;cursor:pointer;transition:transform .15s}
    .tile .img{height:330px;background:#2a2a2a center/cover no-repeat}
    .tile .t{padding:10px 12px;font-size:21px;line-height:1.2;height:68px;overflow:hidden}
    .tile .m{color:#46d369;font-weight:700;font-size:19px;padding:0 12px 10px}
    .tile.f{border-color:#fff;transform:scale(1.06)}
    .home{width:230px;height:412px;flex:none;border-radius:10px;border:4px solid transparent;background:rgba(109,109,110,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-size:26px;font-weight:700;cursor:pointer;text-align:center;transition:transform .15s}
    .home .i{font-size:64px;line-height:1}
    .home.f{background:#fff;color:#000;transform:scale(1.06)}
    @keyframes in{from{opacity:0}to{opacity:1}}`;
  const wrap = make('div', 'w');
  const panel = make('div', 'p');
  const send = index => { try { window.__lgLabCommand?.(JSON.stringify({ action: 'card', choose: index })); } catch { /* Remote keys still work. */ } };
  const options = [];
  const option = (node, index) => { node.addEventListener('click', () => send(index)); options[index] = node; return node; };
  const image = (node, url) => { if (url) node.style.backgroundImage = `url("${String(url).replace(/["\\]/g, '')}")`; return node; };
  let fill = null, label = null, timer = null, left = Number(data.seconds) || 0;
  if (data.mode === 'next') {
    panel.append(make('div', 'k', 'SIGUIENTE CAPÍTULO'), make('h1', '', data.title || ''), make('p', 'sub', data.next || ''));
    const next = make('div', 'next');
    const play = option(make('button', 'b'), 0);
    fill = make('div', 'fill'); label = make('span', '', `▶  Ver ahora · ${left}`);
    play.append(fill, label);
    const actions = make('div', 'row');
    actions.style.flexDirection = 'column'; actions.style.alignItems = 'flex-start';
    actions.append(play, option(make('button', 'b'), 1));
    options[1].append(make('span', '', 'Volver al inicio'));
    next.append(image(make('div', 'thumb'), data.image), actions);
    panel.append(next);
    // The bar fills in the time the Mac waits before playing the next episode.
    requestAnimationFrame(() => { fill.style.transition = `width ${left}s linear`; fill.style.width = '100%'; });
    timer = setInterval(() => { left = Math.max(0, left - 1); label.textContent = `▶  Ver ahora · ${left}`; if (!left) clearInterval(timer); }, 1000);
  } else if (data.mode === 'last') {
    panel.append(make('div', 'k', 'TERMINASTE'), make('h1', '', data.title || ''), make('p', 'sub', 'Es el último capítulo disponible por ahora.'));
    const home = option(make('button', 'b'), 0); home.append(make('span', '', 'Volver al inicio'));
    panel.append(home);
  } else {
    panel.append(make('div', 'k', 'TERMINASTE'), make('h1', '', data.title || ''), make('p', 'sub', (data.options || []).length ? '¿Vuelves al inicio o ves algo parecido?' : ''));
    const row = make('div', 'row');
    const home = option(make('div', 'home'), 0); home.append(make('div', 'i', '⌂'), make('div', '', 'Volver al inicio'));
    row.append(home);
    (data.options || []).slice(0, 4).forEach((entry, index) => {
      const tile = option(make('div', 'tile'), index + 1);
      tile.append(image(make('div', 'img'), entry.poster), make('div', 't', entry.title || ''));
      if (entry.match) tile.append(make('div', 'm', `${entry.match} % para ti`));
      row.append(tile);
    });
    panel.append(row);
  }
  const focus = (index, stopped) => {
    options.forEach((node, at) => node.classList.toggle('f', at === index));
    if (stopped && fill) { clearInterval(timer); fill.style.transition = 'none'; fill.style.width = '0'; label.textContent = '▶  Ver ahora'; }
  };
  focus(0, false);
  wrap.append(make('div', 'shade'), panel); root.append(style, wrap);
  document.documentElement.append(host);
  window.__holyEnd = { focus, remove() { clearInterval(timer); host.remove(); } };
  return true;
}

// One automation step in one frame: report the videos, and if none is playing yet,
// press the site's own play control or ask its <video> to play. It only clicks known
// player controls and server buttons of the supported sites, never ads or links.
export function holyAutoplay(options = {}) {
  const state = window.__holyAuto || (window.__holyAuto = { steps: 0, clicked: {} });
  state.steps++;
  const visible = node => { const rect = node.getBoundingClientRect(); return rect.width > 20 && rect.height > 20 && getComputedStyle(node).visibility !== 'hidden'; };
  // Some players (ok.ru) keep their <video> inside a shadow root.
  const deep = (selector, root = document, out = []) => {
    out.push(...root.querySelectorAll(selector));
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) deep(selector, node.shadowRoot, out);
    return out;
  };
  let videos = [...document.querySelectorAll('video')];
  if (!videos.length) videos = deep('video');
  // Validation runs keep the TV silent.
  if (options.mute) for (const video of videos) video.muted = true;
  const report = videos.map(video => ({ t: video.currentTime, d: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused, ready: video.readyState, area: video.clientWidth * video.clientHeight, ended: video.ended }));
  const out = { url: location.href, top: window.top === window, videos: report, action: '' };
  if (videos.some(video => !video.paused && video.currentTime > 0)) return out;
  if (options.passive) return out;
  const once = (key, every = 4) => { const last = state.clicked[key]; if (last && state.steps - last < every) return false; state.clicked[key] = state.steps; return true; };
  // 1. Ask the main video to play (the step runs with a user gesture). With data it
  //    starts at once; without, play() makes lazy players load it.
  const main = videos.filter(video => !video.ended).sort((a, b) => b.readyState - a.readyState || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  const ready = main && main.readyState >= 2 ? main : null;
  if (main && main.paused && once('video', main.readyState >= 2 ? 2 : 5)) { const promise = main.play(); if (promise?.catch) promise.catch(() => {}); out.action = 'play'; if (ready) return out; }
  // 2. The player's own big play button.
  const buttons = ['.jw-display-icon-display', '.jw-icon-display', '.dplayer-mobile-play', '.dplayer-play-icon', '.vjs-big-play-button', '.plyr__control--overlaid',
    '.fp-play', '.mejs-overlay-button', '.vid_play', '.html5-vpl_panel_play', '.videoplayer_play', '[data-module="VideoPlayer"] .play', '.play-wrapper', '#vplayer .play', '.play-button', '.btn-play', 'button[aria-label="Play"]', 'button[aria-label="Reproducir"]'];
  if (!ready) for (const selector of buttons) {
    const button = document.querySelector(selector);
    if (button && visible(button) && once(selector)) { button.click(); out.action = 'click ' + selector; return out; }
  }
  const host = location.hostname;
  // ok.ru with autoplay sometimes waits for a press on its video area.
  if (/(^|\.)ok\.ru$/.test(host) && state.steps >= 3) {
    const area = document.querySelector('.vid_play, .one-video-player_display-w, .uv-display_controls-wrapper_inner');
    if (area && visible(area) && once('okru', 4)) { area.click(); out.action = 'ok.ru area'; return out; }
  }
  // 3. Site pages, when the direct player could not be resolved on the Mac.
  if (out.top && /(^|\.)jkanime\.net$/.test(host) && !/\/jkplayer\//.test(location.pathname)) {
    const frame = document.querySelector('iframe.player_conte[src^="https://jkanime.net/jkplayer/"]');
    if (frame && once('jk-frame', 99)) { location.assign(frame.src); out.action = 'open jkplayer'; return out; }
  }
  if (out.top && /^(www\.)?cuevana3c\.pro$/.test(host)) {
    const server = document.querySelector('.tab-video-item li[data-server]');
    if (server && once('cuevana-server', 99)) { server.click(); out.action = 'cuevana server'; return out; }
  }
  if (/(^|\.)playlatinsrc\.co$/.test(host)) {
    // player-assist already put Mixdrop first; start it when the list waits for a click.
    const active = document.querySelector('#_sourceList li.active') || document.querySelector('#_sourceList li[data-link]');
    const loaded = [...document.querySelectorAll('iframe')].some(frame => /^https?:/.test(frame.src) && visible(frame));
    if (active && !loaded && once('playlatin', 6)) { active.click(); out.action = 'playlatin server'; return out; }
  }
  return out;
}

// Once playing, the player fills the screen: the frame that holds it is pinned
// over the page (Netflix-like), without touching the player's own controls.
export function holyTheater() {
  if (window.top !== window || window.__holyTheater) return false;
  const playing = [...document.querySelectorAll('video')].some(video => !video.paused);
  const target = playing ? null : [...document.querySelectorAll('iframe')]
    .map(frame => ({ frame, rect: frame.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width * rect.height > innerWidth * innerHeight * 0.12)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0]?.frame;
  const style = document.createElement('style');
  style.textContent = 'html,body{background:#000!important;overflow:hidden!important}' +
    (target ? '[data-holy-theater]{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;z-index:2147483646!important;background:#000!important}' : '');
  if (target) target.setAttribute('data-holy-theater', '');
  (document.head || document.documentElement).append(style);
  Object.defineProperty(window, '__holyTheater', { value: true });
  return !!target;
}

// Resume: put the main video (shadow DOM included) at the saved second.
export function holySeek(seconds) {
  const deep = (root, out = []) => { out.push(...root.querySelectorAll('video')); for (const node of root.querySelectorAll('*')) if (node.shadowRoot) deep(node.shadowRoot, out); return out; };
  for (const video of deep(document)) {
    if (Number.isFinite(video.duration) && video.duration > seconds + 30) {
      if (video.currentTime < seconds - 5) video.currentTime = seconds;
      return true;
    }
  }
  return false;
}

export const seekSource = seconds => `(${holySeek.toString()})(${Number(seconds) || 0})`;
export const curtainSource = data => `(${holyCurtain.toString()})(${JSON.stringify(data)});`;
export const remoteSource = (homes, home = '', world = '') => `(${holyRemote.toString()})(${JSON.stringify(homes)},${JSON.stringify(home)},${JSON.stringify(world)});`;
// The live connection stamps each page every couple of seconds.
export const heartbeatSource = world => `document.documentElement&&(document.documentElement.dataset.holyBridge=${JSON.stringify(world)}+'|'+Date.now())`;
export const autoplaySource = options => `(${holyAutoplay.toString()})(${JSON.stringify(options || {})})`;
export const theaterSource = `(${holyTheater.toString()})()`;
export const endCardSource = data => `(${holyEndCard.toString()})(${JSON.stringify(data)})`;
// Marks every frame while the end card is up, so OK and the arrows reach it from the player's iframe.
export const cardFlagSource = on => (on ? "document.documentElement&&(document.documentElement.dataset.holyCard='1')"
  : 'document.documentElement&&delete document.documentElement.dataset.holyCard,window.top===window&&window.__holyEnd&&window.__holyEnd.remove()');
