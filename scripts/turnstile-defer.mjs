// Document-start helper for Cloudflare Turnstile widgets kept in hidden forms.
// AnimeYT renders six widgets inside its closed login/recover/register dialogs and
// AsiaLiveAction four; each starts a challenge at page load. Together they exhaust
// this TV and webOS restarts its whole web runtime, closing Luma (measured on the TV
// 2026-10-23). A widget whose container is not displayed now waits until it is shown
// (the user opens that form) and then renders exactly as the site configured it.
// Visible widgets, Cloudflare's own check pages and its challenge frames are untouched:
// the verification is never blocked, answered or altered.
export function turnstileDefer() {
  if (window.__lumaTurnstileDefer || location.hostname === 'challenges.cloudflare.com') return;
  const state = { deferred: 0, released: 0 };
  Object.defineProperty(window, '__lumaTurnstileDefer', { value: state });
  const WAIT = 'luma-turnstile-wait';
  const pending = new Set();
  let timer = null;
  // Same settings the site wrote as data-* attributes, for explicit rendering.
  const settings = element => {
    const options = {};
    for (const { name, value } of Array.from(element.attributes)) {
      if (!name.startsWith('data-') || name.startsWith('data-luma')) continue;
      const key = name.slice(5) === 'cdata' ? 'cData' : name.slice(5);
      if (key.endsWith('callback')) options[key] = (...args) => (typeof window[value] === 'function' ? window[value](...args) : undefined);
      else if (value === 'true' || value === 'false') options[key] = value === 'true';
      else if (['tabindex', 'retry-interval'].includes(key) && value !== '' && !Number.isNaN(Number(value))) options[key] = Number(value);
      else options[key] = value;
    }
    return options;
  };
  const release = element => {
    pending.delete(element);
    element.classList.replace(WAIT, 'cf-turnstile');
    element.dataset.lumaTurnstile = 'shown';
    state.released++;
    // Before Turnstile loads its own scan finds the restored class; afterwards render it here.
    if (window.turnstile && typeof window.turnstile.render === 'function' && !element.querySelector('iframe')) {
      try { window.turnstile.render(element, settings(element)); } catch { /* The site can still render or reset it. */ }
    }
  };
  const check = () => {
    for (const element of pending) {
      if (!element.isConnected) pending.delete(element);
      else if (element.getClientRects().length) release(element);
    }
    if (!pending.size && timer) { clearInterval(timer); timer = null; }
  };
  const hold = element => {
    if (element.dataset.lumaTurnstile || element.querySelector('iframe')) return;
    element.dataset.lumaTurnstile = 'wait';
    element.classList.replace('cf-turnstile', WAIT);
    pending.add(element);
    state.deferred++;
    if (!timer) timer = setInterval(check, 800);
  };
  const scan = node => {
    if (node.nodeType !== 1) return;
    if (node.classList.contains('cf-turnstile')) hold(node);
    for (const element of node.querySelectorAll('.cf-turnstile')) hold(element);
  };
  // Hold every widget while the page is parsed (layout is not final yet), then let the
  // displayed ones go as soon as the document is ready; hidden ones wait for display.
  if (document.documentElement) scan(document.documentElement);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', check);
  window.addEventListener('load', check);
}

export const turnstileDeferSource = `(${turnstileDefer.toString()})();`;
