// Luma's own filters. They complement EasyList/EasyPrivacy, which carry no
// scriptlets and almost nothing for in-video YouTube ads.

// Runs in the page's main world at document start on YouTube hosts, served by
// the engine as the scriptlet `luma-youtube`. It must stay idempotent: the
// bridge may also inject it late when it reconnects to an open page.
function youtubeShield() {
  if (window.__lumaYouTube) return;
  Object.defineProperty(window, '__lumaYouTube', { value: true });
  const adKeys = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const marker = /"(?:adPlacements|adSlots|playerAds|adBreakHeartbeatParams|adSlotRenderer|tvMastheadRenderer|statementBannerRenderer)"/;
  const isAdItem = item => !!item && typeof item === 'object' && !!(
    item.adSlotRenderer || item.tvMastheadRenderer ||
    (item.richItemRenderer && item.richItemRenderer.content && item.richItemRenderer.content.adSlotRenderer) ||
    (item.richSectionRenderer && item.richSectionRenderer.content && item.richSectionRenderer.content.statementBannerRenderer)
  );
  const clean = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 28) return;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        if (isAdItem(value[index])) value.splice(index, 1);
        else clean(value[index], depth + 1);
      }
      return;
    }
    for (const key of adKeys) if (key in value) delete value[key];
    for (const key in value) {
      const child = value[key];
      if (child && typeof child === 'object') clean(child, depth + 1);
    }
  };
  const safeClean = value => { try { clean(value, 0); } catch (error) { /* Never break the page. */ } return value; };

  // Player and feed responses are parsed with JSON.parse (desktop, mobile and /tv).
  const parse = JSON.parse;
  const lumaParse = function (text) {
    const result = parse.apply(this, arguments);
    if (typeof text === 'string' && marker.test(text)) safeClean(result);
    return result;
  };
  JSON.parse = lumaParse;
  const text = Response.prototype.text;
  Response.prototype.json = function () { return text.call(this).then(body => lumaParse(body)); };
  const response = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');
  if (response && response.get) {
    const cleaned = new WeakSet();
    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
      ...response,
      get() {
        const value = response.get.call(this);
        if (this.responseType === 'json' && value && typeof value === 'object' && !cleaned.has(value)) { cleaned.add(value); safeClean(value); }
        return value;
      }
    });
  }
  // The first player response is an object literal in the HTML, not JSON.
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let stored = window[name];
    try {
      Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => stored, set: value => { stored = safeClean(value); } });
    } catch (error) { /* Already locked by the page. */ }
  }

  // Fallback for ads that still reach the player: speed through and skip.
  let muted = null;
  setInterval(() => {
    if (document.hidden) return;
    const player = document.querySelector('.ad-showing, .ad-interrupting');
    const video = (player || document).querySelector('video');
    if (player && video) {
      if (muted === null) muted = video.muted;
      video.muted = true;
      video.playbackRate = 16;
      if (isFinite(video.duration) && video.duration > 0) video.currentTime = Math.max(video.currentTime, video.duration - 0.05);
      for (const button of document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-slot button')) button.click();
    } else if (muted !== null && video) {
      video.muted = muted; video.playbackRate = 1; muted = null;
    }
    const notice = document.querySelector('ytd-enforcement-message-view-model');
    if (notice) {
      const dialog = notice.closest('tp-yt-paper-dialog');
      if (dialog) dialog.remove();
      document.querySelector('tp-yt-iron-overlay-backdrop.opened')?.remove();
      if (video && video.paused) video.play().catch(() => {});
    }
  }, 400);
}

const youtubeSource = `(${youtubeShield.toString()})();`;
// adblock-rust treats {{n}} as scriptlet arguments.
if (youtubeSource.includes('{{')) throw Error('El scriptlet de YouTube no puede contener {{');

export const lumaResources = [
  { name: 'luma-youtube.js', aliases: ['luma-youtube'], kind: 'template', content: Buffer.from(youtubeSource).toString('base64') }
];

const youtube = 'youtube.com,youtube-nocookie.com';
export const lumaRules = [
  '! Luma · reglas propias complementarias',
  // Cuevana's observed ad loaders: keep popa.js/movie-player.js and all media.
  '||cuevana3c.pro/js/varkus.js$script',
  '||latgw.fun^$domain=cuevana3c.pro',
  '||dingerepilobe.com^$domain=cuevana3c.pro',
  '||waughyciliary.com^$domain=cuevana3c.pro',
  // Observed player-side popunder loader. Keep JW Player, HLS and /dl intact.
  '||ikhjerbhye3wjkhoduh5xiczuvd.lol/assets/jquery/ev-player.js$script',
  'cuevana3c.pro##+js(no-window-open-if)',
  // TV trace 2026-10-23: this loader creates the delayed blank-frame QR ad.
  // Scope to the observed publisher; leave its player, HLS and segments intact.
  '||unboltsecole.com^$script,domain=jkanime.net',
  // Network: ad decisions, ad beacons and pings.
  '||youtube.com/api/stats/ads^',
  '||youtube.com/pagead/',
  '||youtube.com/ptracking^',
  '||youtube.com/get_midroll_info',
  '||youtube.com/youtubei/v1/player/ad_break',
  '||youtube.com/pcs/activeview',
  '||googleads.g.doubleclick.net^',
  '||static.doubleclick.net/instream/',
  '||imasdk.googleapis.com/js/sdkloader/ima3.js$domain=youtube.com',
  // Player/feed pruning at document start.
  `${youtube}##+js(luma-youtube)`,
  // Cosmetic: desktop, mobile and the anti-adblock notice.
  ...[
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer', 'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer', 'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-search-pyv-renderer',
    'ytd-merch-shelf-renderer', '#masthead-ad', '#player-ads', '.ytp-ad-overlay-container', '.ytp-ad-image-overlay',
    '.ytp-featured-product', 'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    'ad-slot-renderer', 'ytm-promoted-sparkles-web-renderer', 'ytm-companion-ad-renderer', 'ytm-rich-item-renderer:has(ad-slot-renderer)',
    'ytd-enforcement-message-view-model', 'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)'
  ].map(selector => `${youtube}##${selector}`)
].join('\n');
