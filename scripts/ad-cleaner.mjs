// «Limpiar anuncios»: on demand, scans every frame of the page, asks the Brave
// engine about each iframe/link/image and hides what is clearly advertising.
// Page functions run in an isolated world per frame; they only hide (inline
// display:none) so "Deshacer" can restore everything.
import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {dirname} from 'node:path';

// ---- Runs in the page (isolated world). Must stay self-contained. ----
function lumaCleanerPage(mode, prefix, payload) {
  const TOKEN = /^(ad|ads|adv|advert|adverts|advertising|advertisement|advertisements|adslot|adslots|adunit|adunits|adbox|adbanner|adcontainer|adwrapper|adwrap|adframe|adsense|adsbygoogle|adspace|adzone|admanager|bannerad|sponsored|publicidad|publi|anuncio|anuncios|patrocinado|promocionado|taboola|outbrain|mgid|teads|criteo|prebid|revcontent|zergnet|ezoic|adthrive|mediavine|googleads|doubleclick)$/i;
  const LABEL = /^(publicidad|anuncio|anuncios|advertisement|advertisements|advertising|ad|ads|sponsored|patrocinado|contenido patrocinado|promocionado|publicit[ée]|werbung|anzeige)$/i;
  const ANTI = /(ad ?block|bloqueador de (anuncios|publicidad)|desactiva(r)? (tu |el )?bloqueador|disable (your )?ad ?block|lista blanca|whitelist|permit(e|ir) (los )?anuncios)/i;
  const IAB = [[300, 250], [728, 90], [160, 600], [300, 600], [320, 50], [320, 100], [336, 280], [468, 60], [970, 90], [970, 250], [250, 250], [200, 200], [120, 600], [300, 100], [300, 50]];
  const W = innerWidth, H = innerHeight, VA = W * H;
  const tokens = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/);
  const adName = value => tokens(value).some(token => TOKEN.test(token));
  const area = rect => Math.max(0, rect.width) * Math.max(0, rect.height);
  const visible = node => { const rect = node.getBoundingClientRect(); return rect.width > 1 && rect.height > 1 && getComputedStyle(node).visibility !== 'hidden'; };
  const isOurs = node => node.id === '__luma-toolbar' || !!node.closest?.('#__luma-toolbar');

  // Never hide the page's own structure or anything people interact with.
  const safe = (node, {confirmed = false, overlay = false} = {}) => {
    if (!node || node === document.documentElement || node === document.body || isOurs(node)) return false;
    if (/^(main|header|nav|footer|form|html|body)$/i.test(node.localName)) return false;
    if (/^(main|navigation|banner|contentinfo|search|dialog)$/i.test(node.getAttribute('role') || '') && !overlay) return false;
    if (node.querySelector('main,[role=main],h1,nav,form,input,textarea,select')) return false;
    if (!confirmed && !overlay && node.querySelector('video')) return false;
    const rect = node.getBoundingClientRect();
    if (!overlay && area(rect) > 0.55 * VA) return false;
    if (!confirmed && !overlay && (node.innerText || '').trim().length > 600) return false;
    return true;
  };
  const meaningful = node => (node.innerText || '').trim().length > 30 || [...node.querySelectorAll('img,video,canvas,input')].some(child => area(child.getBoundingClientRect()) > 2000);
  // Climb through wrappers that only hold the ad (and maybe its label) so no gap remains.
  const collapse = node => {
    let current = node;
    for (let level = 0; level < 4; level++) {
      const parent = current.parentElement;
      if (!parent || parent === document.body || !safe(parent)) break;
      // Inline links report a line-high box; measure the media they hold instead.
      const outer = parent.getBoundingClientRect();
      const inner = Math.max(current.getBoundingClientRect().height, ...[...current.querySelectorAll('img,iframe,video,ins')].map(child => child.getBoundingClientRect().height));
      if (outer.height > inner + 90) break;
      if ([...parent.children].some(child => child !== current && !child.contains(current) && meaningful(child) && !LABEL.test((child.innerText || '').trim()))) break;
      current = parent;
    }
    return current;
  };
  const stable = value => value && value.length <= 40 && /^[A-Za-z][\w-]*$/.test(value) && !/\d{3,}|[0-9a-f]{8,}|__/i.test(value);
  const selectorFor = node => {
    let selector = null;
    if (node.localName === 'ins' && node.classList.contains('adsbygoogle')) selector = 'ins.adsbygoogle';
    else if (stable(node.id) && adName(node.id)) selector = '#' + CSS.escape(node.id);
    else {
      const classes = [...node.classList].filter(name => stable(name) && adName(name)).slice(0, 2);
      if (classes.length) selector = node.localName + classes.map(name => '.' + CSS.escape(name)).join('');
    }
    if (!selector) return null;
    // Learn only selectors that would never catch large or structural parts of the page.
    const matches = [...document.querySelectorAll(selector)];
    return matches.length && matches.length <= 12 && matches.every(match => !match.querySelector('main,[role=main],h1,nav,form') && area(match.getBoundingClientRect()) <= 0.55 * VA) ? selector : null;
  };
  const absolute = value => { try { return new URL(value, location.href).href; } catch { return ''; } };

  if (mode === 'scan') {
    for (const old of document.querySelectorAll('[data-luma-scan]')) old.removeAttribute('data-luma-scan');
    const found = new Map();
    const add = (node, score, reason, urls = []) => {
      if (!node || isOurs(node)) return;
      const entry = found.get(node) || {score: 0, reasons: new Set(), urls: []};
      entry.score += score; entry.reasons.add(reason); entry.urls.push(...urls.filter(item => /^https?:/.test(item.url)));
      found.set(node, entry);
    };
    const all = [...document.body?.querySelectorAll('*') || []].slice(0, 20000);
    for (const node of all) {
      if (isOurs(node)) continue;
      const name = node.localName;
      if (name === 'ins' && node.classList.contains('adsbygoogle')) add(node, 5, 'adsense');
      if ((node.id && adName(node.id)) || [...node.classList].some(adName)) add(node, 3, 'nombre');
      for (const attribute of node.attributes) {
        if (/^data-(ad|ads|adunit|ad-slot|ad-client|google-query-id|native-ad)(-|$)/i.test(attribute.name) || (attribute.name === 'aria-label' && LABEL.test(attribute.value.trim()))) { add(node, 4, 'atributo'); break; }
      }
      if (name === 'iframe' || name === 'embed' || name === 'object') {
        const rect = node.getBoundingClientRect();
        if (area(rect) < 400) continue;
        const iab = IAB.some(([w, h]) => Math.abs(rect.width - w) <= 6 && Math.abs(rect.height - h) <= 6);
        const src = absolute(node.getAttribute('src') || node.getAttribute('data') || '');
        add(node, iab ? 3 : 0, iab ? 'tamaño de anuncio' : 'marco', src ? [{url: src, type: 'Document'}] : []);
      } else if (name === 'a' && node.href && node.querySelector('img,picture,video')) {
        if (area(node.getBoundingClientRect()) >= 2000) add(node, 0, 'enlace', [{url: node.href, type: 'Other'}]);
      } else if (name === 'img' && area(node.getBoundingClientRect()) >= 2000) {
        const src = absolute(node.currentSrc || node.getAttribute('src') || '');
        if (src) add(node, 0, 'imagen', [{url: src, type: 'Image'}]);
      } else if (!node.childElementCount && LABEL.test((node.textContent || '').trim())) {
        let container = node;
        for (let level = 0; level < 4 && container.parentElement; level++) {
          container = container.parentElement;
          if (container.getBoundingClientRect().height >= 60 && container.querySelector('iframe,img,a[href]')) { add(container, 3, 'etiqueta'); break; }
        }
      }
    }
    // Overlays that cover the page: ad interstitials and "disable your blocker" walls.
    for (const node of all) {
      if (isOurs(node)) continue;
      const rect = node.getBoundingClientRect();
      if (area(rect) < 0.25 * VA) continue;
      const style = getComputedStyle(node);
      if (!/fixed|sticky/.test(style.position) || (parseInt(style.zIndex, 10) || 0) < 100) continue;
      const text = (node.innerText || '').slice(0, 2000);
      const hit = found.get(node)?.score >= 3 || ANTI.test(text) || [...node.querySelectorAll('iframe')].some(frame => IAB.some(([w, h]) => Math.abs(frame.offsetWidth - w) <= 6 && Math.abs(frame.offsetHeight - h) <= 6));
      if (hit) { add(node, 4, 'superposición'); found.get(node).overlay = true; }
    }
    const candidates = [];
    let index = 0;
    for (const [node, entry] of found) {
      if (!visible(node) && !entry.overlay) continue;
      // Keep the outermost hit that can really be hidden; inner ones are covered by it.
      let ancestor = node.parentElement, covered = false;
      while (ancestor) {
        const outer = found.get(ancestor);
        if (outer?.score >= 3 && safe(ancestor, {overlay: outer.overlay})) { covered = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (covered && entry.score >= 3 && !entry.urls.length) continue;
      const id = prefix + ':' + (index++);
      node.setAttribute('data-luma-scan', id);
      candidates.push({id, score: entry.score, reasons: [...entry.reasons], urls: entry.urls.slice(0, 4), overlay: !!entry.overlay});
      if (candidates.length >= 1500) break;
    }
    return {url: location.href, candidates};
  }

  if (mode === 'apply') {
    const hidden = [], learned = new Set();
    let overlays = 0;
    for (const {id, confirmed, overlay} of payload) {
      const node = document.querySelector(`[data-luma-scan="${CSS.escape(id)}"]`);
      if (!node || node.hasAttribute('data-luma-cleaned') || node.closest('[data-luma-cleaned]')) continue;
      if (!safe(node, {confirmed, overlay})) continue;
      const target = overlay ? node : collapse(node);
      if (target.closest('[data-luma-cleaned]')) continue;
      target.setAttribute('data-luma-prev', target.style.getPropertyValue('display') + '|' + target.style.getPropertyPriority('display'));
      target.setAttribute('data-luma-cleaned', overlay ? 'overlay' : '1');
      target.style.setProperty('display', 'none', 'important');
      hidden.push(id);
      if (overlay) overlays++;
      const selector = selectorFor(target) || selectorFor(node);
      if (selector && window.top === window) learned.add(selector);
    }
    if (overlays) {
      // Walls lock scrolling and leave a dark backdrop behind.
      for (const node of [document.documentElement, document.body]) {
        if (node && getComputedStyle(node).overflowY === 'hidden') { node.setAttribute('data-luma-overflow', node.style.getPropertyValue('overflow')); node.style.setProperty('overflow', 'auto', 'important'); }
      }
      for (const node of document.body.querySelectorAll('div')) {
        if (isOurs(node) || node.hasAttribute('data-luma-cleaned')) continue;
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        if (style.position === 'fixed' && area(rect) > 0.8 * VA && (parseInt(style.zIndex, 10) || 0) >= 100 && !(node.innerText || '').trim() && !node.querySelector('img,video,iframe,canvas')) {
          node.setAttribute('data-luma-prev', node.style.getPropertyValue('display') + '|' + node.style.getPropertyPriority('display'));
          node.setAttribute('data-luma-cleaned', 'backdrop');
          node.style.setProperty('display', 'none', 'important');
        }
      }
    }
    for (const node of document.querySelectorAll('[data-luma-scan]')) node.removeAttribute('data-luma-scan');
    return {hidden: hidden.length, overlays, learned: [...learned]};
  }

  if (mode === 'undo') {
    let restored = 0;
    for (const node of document.querySelectorAll('[data-luma-cleaned]')) {
      const [value, priority] = (node.getAttribute('data-luma-prev') || '|').split('|');
      if (value) node.style.setProperty('display', value, priority); else node.style.removeProperty('display');
      node.removeAttribute('data-luma-cleaned'); node.removeAttribute('data-luma-prev');
      restored++;
    }
    for (const node of document.querySelectorAll('[data-luma-overflow]')) {
      const value = node.getAttribute('data-luma-overflow');
      if (value) node.style.setProperty('overflow', value); else node.style.removeProperty('overflow');
      node.removeAttribute('data-luma-overflow');
    }
    return {restored};
  }
}
export const cleanerPageFunction = lumaCleanerPage;
export const cleanerSource = (mode, prefix, payload = null) => `(${lumaCleanerPage.toString()})(${JSON.stringify(mode)},${JSON.stringify(prefix)},${JSON.stringify(payload)})`;

// ---- Mac side ----
// Engine verdict first; heuristics alone need a score of 3 (an ad name, label,
// ad-sized frame or ad attribute). Score-0 entries only exist to ask the engine.
export function decideCleaning(candidates, isBlocked) {
  const decisions = [];
  for (const candidate of candidates) {
    const confirmed = candidate.urls.some(item => { try { return isBlocked(item.url, item.type); } catch { return false; } });
    if (confirmed || candidate.score >= 3) decisions.push({id: candidate.id, confirmed, overlay: !!candidate.overlay});
  }
  return decisions;
}

const MAX_RULES = 40;
// Selectors learned per site: from the next visit the page arrives clean.
export class CleanerRules {
  constructor(file = '.local/cleaner-rules.json') {
    this.file = file;
    try { this.rules = JSON.parse(readFileSync(file, 'utf8')); } catch { this.rules = {}; }
    if (!this.rules || typeof this.rules !== 'object' || Array.isArray(this.rules)) this.rules = {};
  }
  static valid(selector) {
    return typeof selector === 'string' && selector.length <= 80 && /^(#[\w-]+|[a-z][\w-]*(\.[\w-]+){1,2})$/i.test(selector) && /(^|[^a-z])(ad|ads|adv|advert|advertising|advertisement|adslot|adunit|adsbygoogle|sponsored|publicidad|anuncio|patrocinado|taboola|outbrain)/i.test(selector);
  }
  selectorsFor(hostname) { return (this.rules[hostname] || []).filter(CleanerRules.valid); }
  add(hostname, selectors) {
    const current = this.selectorsFor(hostname);
    const added = [...new Set(selectors)].filter(selector => CleanerRules.valid(selector) && !current.includes(selector));
    if (!added.length) return [];
    this.rules[hostname] = [...current, ...added].slice(-MAX_RULES);
    this.save();
    return added;
  }
  remove(hostname, selectors) {
    const kept = this.selectorsFor(hostname).filter(selector => !selectors.includes(selector));
    if (kept.length) this.rules[hostname] = kept; else delete this.rules[hostname];
    this.save();
  }
  save() {
    mkdirSync(dirname(this.file), {recursive: true});
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify(this.rules, null, 2) + '\n', {mode: 0o600});
    renameSync(temporary, this.file);
  }
}
