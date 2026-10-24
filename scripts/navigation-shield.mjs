import { playerAssist } from './player-assist.mjs';

// Main-world guard registered before any site script, including nested frames.
// Scoped to the tested site and its embeds: script-opened windows are not needed
// to play inline media. It does not touch fetch, media URLs, play(), or cookies.
export function navigationShield() {
  // The owner's bookmarked sites (and their embeds, through ancestorOrigins). window.open replaces the
  // single page on this TV, so popups are blocked on all of them; the rest of the shield is exact-match.
  const SITES = /(^|\.)(cuevana3c\.pro|jkanime\.net|repelishd\.blog|animeyt\.cc|animeonline\.ninja|asialiveaction\.com|framextv\.(cc|xyz)|onlyflix\.to|doramasflix\.(io|beer|in)|doramasia\.com|doramasmp4\.cyou)$/;
  if (location.hostname === 'challenges.cloudflare.com') return; // human check: leave untouched
  const origins = [location.origin, ...Array.from(location.ancestorOrigins || [])];
  const protectedSite = origins.some(origin => {
    try { return SITES.test(new URL(origin).hostname); } catch { return false; }
  });
  if (!protectedSite || window.__lumaNavigationShield) return;
  const state = { blockedPopups: 0, blockedOverlays: 0, blockedQrOverlays: 0 };
  Object.defineProperty(window, '__lumaNavigationShield', { value: state });
  const original = window.open;
  const blockedOpen = new Proxy(original, {
    apply() { state.blockedPopups++; return null; }
  });
  try { Object.defineProperty(window, 'open', { get: () => blockedOpen, set() {}, configurable: false }); }
  catch { window.open = blockedOpen; }
  // The observed host's pickDirect() inserts a nearly transparent fullscreen
  // div that steals the first Play click. Match both presentation and behavior;
  // do not hide ordinary player overlays or automatically click advertisements.
  const functionText = Function.prototype.toString;
  const removeAdOverlay = node => {
    if (node?.tagName !== 'DIV' || typeof node.onclick !== 'function') return;
    const style = node.style;
    if (style.position !== 'fixed' || Number(style.zIndex) < 2147483600 ||
        !(Number(style.opacity) > 0 && Number(style.opacity) <= 0.05)) return;
    if (!/window\.open\s*\(/.test(functionText.call(node.onclick))) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < innerWidth * 0.9 || rect.height < innerHeight * 0.9) return;
    node.remove(); state.blockedOverlays++;
  };
  // The observed QR ad is written into a same-origin blank iframe after load.
  // Match its presentation AND both exact messages. A QR in a player, login,
  // ordinary document or an inaccessible cross-origin frame is left untouched.
  const qrObservers = new Map();
  const inspectQrFrame = frame => {
    if (frame?.tagName !== 'IFRAME') return;
    const src = frame.getAttribute('src');
    if ((src && src !== 'about:blank') || frame.hasAttribute('srcdoc') ||
        frame.style.position !== 'fixed' || Number(frame.style.zIndex) < 2147483600) return;
    const rect = frame.getBoundingClientRect();
    if (rect.width < innerWidth * 0.9 || rect.height < innerHeight * 0.9) return;
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc) return;
    const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    if (/Confirm you[’']re not a robot/i.test(text) && /Scan the qr-code with your phone/i.test(text) && doc.querySelector('canvas,svg,img')) {
      qrObservers.get(frame)?.observer.disconnect(); qrObservers.delete(frame);
      frame.remove(); state.blockedQrOverlays++; return;
    }
    if (qrObservers.get(frame)?.doc === doc) return;
    qrObservers.get(frame)?.observer.disconnect();
    const observer = new MutationObserver(() => inspectQrFrame(frame));
    observer.observe(doc, { childList: true, subtree: true, characterData: true });
    qrObservers.set(frame, { doc, observer });
    frame.addEventListener('load', () => inspectQrFrame(frame), { once: true });
  };
  const scan = node => {
    removeAdOverlay(node);
    inspectQrFrame(node);
    for (const child of node?.querySelectorAll?.('div[style*="214748"]') || []) removeAdOverlay(child);
    for (const frame of node?.querySelectorAll?.('iframe') || []) inspectQrFrame(frame);
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') inspectQrFrame(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
    for (const [frame, { observer }] of qrObservers) if (!frame.isConnected) {
      observer.disconnect(); qrObservers.delete(frame);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src', 'srcdoc'] });
  scan(document);
  // Real hyperlinks remain usable in this single-page TV browser. An ad URL is
  // still subject to document filtering before it can replace the movie page.
  document.addEventListener('click', event => {
    const path = event.composedPath();
    // The normal site rebuilds the full poster catalogue behind two player
    // frames. In WAM that route repeatedly replaced/crashed the app target.
    // Open exactly the player supplied by the selected server, in this tab.
    // This keeps its original origin and headers and avoids the heavy catalogue.
    // Keyboard libraries may synthesize .click(); the destination is still
    // restricted to this site's supplied HTTPS player, with no privileged API.
    if (event.button === 0 && /^(www\.)?cuevana3c\.pro$/.test(location.hostname)) {
      const server = path.find(node => node?.hasAttribute?.('data-server'));
      const play = path.some(node => node?.classList?.contains('video-play'));
      const candidate = server || (play && document.querySelector('.tab-video-item li[data-server]'));
      if (candidate) {
        try {
          const url = new URL(candidate.getAttribute('data-server'));
          if (url.protocol === 'https:' && url.hostname === 'tungtungsahur.cuevana3c.pro' && !url.username && !url.password) {
            // The site's own player supports this ad preference; do not change
            // cookies, rewrite media, or remove any security response headers.
            url.searchParams.set('pops', 'false');
            event.preventDefault(); event.stopImmediatePropagation();
            location.assign(url.href); return;
          }
        } catch { /* Unknown player layout: leave the original action intact. */ }
      }
    }
    const link = path.find(node => node?.tagName === 'A');
    if (link && link.target && !['_self', '_top', '_parent'].includes(link.target.toLowerCase())) {
      if (/^https?:/.test(link.href)) link.target = '_self';
      else event.preventDefault();
    }
  }, true);
}

export const navigationShieldSource = `(${navigationShield.toString()})();(${playerAssist.toString()})();`;
