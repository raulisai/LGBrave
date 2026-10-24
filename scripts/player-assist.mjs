// Document-start helper for the movie players seen on this TV (scoped by host).
// 1) PlayLatinSrc (Repelishd) lists several servers and plays the first. Servers whose
//    player loads a Cloudflare check (Dropload/dr0pstream) or UnlimPlay close this TV's
//    web app (observed 2026-10-23), so they are moved to the end of the list, marked,
//    and never preselected. They stay selectable: nothing is hidden or blocked.
// 2) Mixdrop's inner <video> ignores remote/mouse clicks in this WebView but plays when
//    told to; a click or OK/Space inside that frame starts it.
export function playerAssist() {
  const host = location.hostname;
  if (window.__lumaPlayerAssist) return;
  if (/(^|\.)playlatinsrc\.co$/.test(host)) {
    Object.defineProperty(window, '__lumaPlayerAssist', { value: 'servers' });
    const risky = /(^|\.)(dr0pstream\.com|dropload\.io|unlimplay\.com)$/;
    const preferred = /(^|\.)(mixdrop\.[a-z]+|mxdrop\.[a-z]+)$/;
    const hostOf = li => { try { return new URL(li.dataset.link).hostname; } catch { return ''; } };
    const arrange = () => {
      const list = document.getElementById('_sourceList');
      if (!list) return;
      const items = [...list.children].filter(node => node.tagName === 'LI' && node.dataset.link);
      if (!items.length || list.dataset.lumaArranged === items.map(li => li.dataset.link).join('|')) return;
      const safe = items.filter(li => !risky.test(hostOf(li)));
      const rank = li => (preferred.test(hostOf(li)) ? 0 : 1);
      const ordered = [...safe].sort((a, b) => rank(a) - rank(b)).concat(items.filter(li => risky.test(hostOf(li))));
      for (const li of ordered) {
        if (risky.test(hostOf(li)) && !li.dataset.lumaMarked) {
          li.dataset.lumaMarked = '1';
          const label = li.querySelector('span');
          if (label) label.textContent += ' · puede cerrar la app';
        }
        list.append(li);
      }
      if (safe.length) {
        for (const li of items) li.classList.remove('active');
        ordered[0].classList.add('active');
      }
      list.dataset.lumaArranged = ordered.map(li => li.dataset.link).join('|');
    };
    new MutationObserver(arrange).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', arrange);
    return;
  }
  if (/(^|\.)(mixdrop\.[a-z]+|mxdrop\.[a-z]+)$/.test(host) && window.top !== window) {
    Object.defineProperty(window, '__lumaPlayerAssist', { value: 'mixdrop' });
    const start = event => {
      if (event.type === 'keydown' && ![13, 32].includes(event.keyCode)) return;
      const video = document.querySelector('video');
      if (video && video.paused) video.play().catch(() => {});
    };
    document.addEventListener('click', start, true);
    document.addEventListener('keydown', start, true);
  }
}
