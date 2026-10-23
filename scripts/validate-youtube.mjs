// Comprueba el escudo de YouTube en la TV, con el vídeo silenciado.
//   node scripts/validate-youtube.mjs http://127.0.0.1:PUERTO [URL de vídeo]
import { mkdirSync, writeFileSync } from 'node:fs';
import { connectTV, waitFor } from './cdp.mjs';
import { BrowserBridge } from './browser-bridge.mjs';

const directory = 'evidence/youtube';
mkdirSync(directory, { recursive: true });
const video = process.argv[3] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const cdp = await connectTV(process.argv[2]);
const bridge = await new BrowserBridge(cdp).start();
const tick = setInterval(() => bridge.status().catch(() => {}), 1000);
const report = { capturedAt: new Date().toISOString(), scope: 'Una visita por página; los anuncios de YouTube varían por cuenta, país y momento.', pages: [] };
// Test-only: keep the TV silent while a video plays.
const mute = (await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { this.muted = true; this.volume = 0; return play.apply(this, arguments); }; document.addEventListener('volumechange', event => { if (!event.target.muted) event.target.muted = true; }, true); })();` })).identifier;
const inspect = () => cdp.evaluate(`(() => {
  const visible = selector => [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none').length;
  const media = document.querySelector('video');
  const player = window.ytInitialPlayerResponse;
  return { url: location.href, title: document.title, shield: window.__lumaYouTube === true,
    adElementsInDOM: document.querySelectorAll('ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,#masthead-ad,ytd-banner-promo-renderer,ytd-companion-slot-renderer,#player-ads').length,
    adElementsVisible: visible('ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,#masthead-ad,ytd-banner-promo-renderer,ytd-companion-slot-renderer,#player-ads'),
    adShowing: !!document.querySelector('.ad-showing,.ad-interrupting'),
    playerHasAdPlacements: !!(player && (player.adPlacements || player.playerAds || player.adSlots)),
    video: media ? { paused: media.paused, muted: media.muted, currentTime: Math.round(media.currentTime * 10) / 10, duration: Math.round(media.duration || 0) } : null };
})()`);

try {
  for (const [name, url, wait] of [['home', 'https://www.youtube.com/', 6000], ['watch', video, 12000]]) {
    const blocked = bridge.blocked;
    await bridge.command({ action: 'navigate', value: url });
    await waitFor(() => ['complete', 'error'].includes(bridge.navigation.phase), 40000);
    await new Promise(resolve => setTimeout(resolve, wait));
    const page = { name, requested: url, phase: bridge.navigation.phase, ...await inspect(), blocked: bridge.blocked - blocked,
      blockedSample: bridge.records.filter(record => record.blocked).slice(-8).map(record => record.url) };
    report.pages.push(page);
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${directory}/${name}.png`, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify(page, null, 2));
  }
} finally {
  clearInterval(tick);
  await cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: mute }).catch(() => {});
  await bridge.command({ action: 'home' }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  await bridge.stop(); cdp.close();
  writeFileSync(`${directory}/validation.json`, JSON.stringify(report, null, 2));
}
