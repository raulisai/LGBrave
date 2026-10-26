import { resolveNavigation } from '../src/navigation.js';
import { ICONS } from '../src/icons.js';

// This function runs in a CDP isolated world, including at document start.
function installToolbar(resolve, initial, homeURLs, icons) {
  if (window.top !== window || homeURLs.includes(location.href)) return;
  if (window.__lumaSetNavigation) { window.__lumaSetNavigation(initial); return; }
  const engines = { google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', brave: 'Brave Search' };
  let state = { phase: 'loading', progress: 10, error: '', url: location.href, blocked: 0, enabled: true, favorite: false, favoriteCategories: [], categories: ['Anime', 'Películas', 'Otros'], offline: false, ...initial };
  let root, host, bar, pill, input, label, lock, reload, progress, shine, veil, grabber, toast, hot, menu, star, clean;
  let menuAnchor = null;
  let cleanTimer = 0;
  let menuOpen = false;
  let editing = false;
  let shown = true;
  let hideTimer = 0;
  let toastTimer = 0;
  let safety = 0;
  let lastHeartbeat = Date.now();
  const rendered = {};
  // No innerHTML: sites with Trusted Types (YouTube) reject it, even from this isolated world.
  const el = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
    node.append(...children);
    return node;
  };
  const icon = (name, size = 26) => {
    const vector = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) vector.setAttribute(key, value);
    for (const [tag, attributes] of icons[name]) {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
      vector.append(shape);
    }
    return vector;
  };
  const put = (key, value, apply) => { if (rendered[key] !== value) { rendered[key] = value; apply(value); } };
  const display = url => { try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url || ''; } };
  const send = (action, value) => {
    if (typeof window.__lgLabCommand !== 'function') {
      update({ phase: 'error', error: 'Se perdió la conexión con la computadora. Espera un momento y vuelve a intentar.' });
      return false;
    }
    window.__lgLabCommand(JSON.stringify({ action, value }));
    return true;
  };
  const notify = text => {
    toast.textContent = text; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  // Safari-like chrome: visible while loading, failing or focused; out of the way while reading.
  const reveal = focus => {
    clearTimeout(hideTimer);
    if (!shown) { shown = true; bar.classList.remove('hidden'); root.getElementById('tabs').classList.remove('hidden'); grabber.classList.remove('visible'); hot.hidden = true; }
    if (focus && !root.activeElement) pill.focus();
    scheduleHide();
  };
  const conceal = () => {
    if (state.phase === 'loading' || state.phase === 'error' || editing || menuOpen || root.activeElement) return;
    shown = false; bar.classList.add('hidden'); root.getElementById('tabs').classList.add('hidden'); grabber.classList.add('visible'); hot.hidden = false;
  };
  const scheduleHide = (delay = 3500) => { clearTimeout(hideTimer); hideTimer = setTimeout(conceal, delay); };

  const renderProgress = () => {
    const busy = state.phase === 'loading';
    if (busy) {
      progress.style.transition = 'transform 2.4s cubic-bezier(.08,.82,.17,1), opacity .2s ease';
      progress.style.opacity = '1';
      progress.style.transform = `scaleX(${Math.min(.92, Math.max(.1, (state.progress || 0) / 100 + .2))})`;
    } else if (progress.style.opacity === '1') {
      progress.style.transition = 'transform .25s ease-out, opacity .35s ease .25s';
      progress.style.transform = 'scaleX(1)';
      progress.style.opacity = '0';
      setTimeout(() => { if (state.phase !== 'loading') { progress.style.transition = 'none'; progress.style.transform = 'scaleX(0)'; } }, 650);
    }
  };
  const update = next => {
    const previous = state.phase;
    state = { ...state, ...next };
    if (!root) return;
    const busy = state.phase === 'loading';
    const failed = state.phase === 'error';
    put('phase', state.phase, value => { bar.dataset.phase = value; });
    put('veil', failed, value => { veil.hidden = !value; });
    put('error', state.error, value => { root.getElementById('explanation').textContent = value; });
    put('target', state.url, value => { root.getElementById('target').textContent = value; });
    put('busy', busy, value => {
      reload.replaceChildren(icon(value ? 'stop' : 'reload', 22));
      reload.dataset.action = value ? 'stop' : 'reload';
      reload.setAttribute('aria-label', value ? 'Detener' : 'Recargar');
    });
    put('progress', state.phase + ':' + state.progress, renderProgress);
    put('secure', /^https:/i.test(state.url || ''), value => { lock.hidden = !value; });
    if (!editing) put('label', display(state.url || location.href), value => { label.textContent = value; });
    put('engine', state.searchEngine, value => { input.placeholder = 'Buscar con ' + (engines[value] || 'Google') + ' o escribir dirección'; });
    put('debug', state.debug === true, value => { root.getElementById('count').hidden = !value; });
    put('tabs', JSON.stringify([state.tabs, state.activeTabId, state.offline]), () => {
      const list = root.getElementById('tab-list');
      const focused = root.activeElement;
      const focusId = focused?.dataset.tabId;
      const focusAction = focused?.dataset.tabAction;
      list.replaceChildren(...(state.tabs || []).map(tab => {
        const select = el('button', { class: 'tab-select', 'aria-current': tab.id === state.activeTabId ? 'page' : null, title: tab.url, 'data-tab-id': tab.id, 'data-tab-action': 'select-tab', disabled: state.offline }, tab.title);
        const close = el('button', { class: 'tab-close', 'aria-label': 'Cerrar ' + tab.title, 'data-tab-id': tab.id, 'data-tab-action': 'close-tab', disabled: state.offline }, icon('stop', 18));
        select.onclick = () => send('select-tab', tab.id);
        close.onclick = () => send('close-tab', tab.id);
        return el('div', { class: 'tab' + (tab.id === state.activeTabId ? ' selected' : '') }, select, close);
      }));
      root.getElementById('new-tab').disabled = state.offline || (state.tabs || []).length >= 12;
      if (focusId) {
        const replacement = [...list.querySelectorAll('button')].find(button => button.dataset.tabId === focusId && button.dataset.tabAction === focusAction);
        (replacement || list.querySelector('[aria-current]') || root.getElementById('new-tab')).focus();
      }
      list.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    put('shield', `${state.enabled}:${state.offline}:${state.blocked}`, () => {
      const count = root.getElementById('count');
      count.className = 'chip' + (state.offline ? ' offline' : state.enabled ? '' : ' paused');
      count.replaceChildren(icon(state.enabled && !state.offline ? 'shieldCheck' : 'shield', 24), el('span', {}, state.offline ? 'Sin conexión' : state.enabled ? Number(state.blocked || 0).toLocaleString('es') : 'Pausa'));
      count.setAttribute('aria-label', state.offline ? 'Sin conexión con la computadora' : state.enabled ? 'Protección activa' : 'Protección en pausa');
    });
    put('favorite', !!state.favorite, value => {
      star.classList.toggle('on', value);
      star.setAttribute('aria-label', value ? 'Marcador guardado' : 'Guardar en marcadores');
    });
    if (busy || failed) reveal(false);
    if (failed && previous !== 'error') root.getElementById('retry').focus();
    if (state.phase === 'complete' && previous !== 'complete') scheduleHide(4000);
  };
  window.__lumaSetNavigation = update;

  function submit() {
    try {
      const url = resolve(input.value, state.searchEngine);
      clearTimeout(safety);
      update({ phase: 'loading', progress: 8, url, error: '' });
      safety = setTimeout(() => update({ phase: 'error', error: 'No llegó una respuesta. Reintenta o vuelve al inicio.' }), 30000);
      send('navigate', input.value);
      input.blur();
    } catch (error) {
      update({ phase: 'error', error: error.message, url: input.value });
      send('navigate', input.value);
    }
  }
  const closeMenu = refocus => {
    if (!menuOpen) return;
    menuOpen = false; menu.hidden = true;
    if (refocus) (menuAnchor || star).focus(); else scheduleHide(1500);
  };
  const placeMenu = anchor => {
    menuAnchor = anchor;
    menu.hidden = false; menuOpen = true; reveal(false);
    const rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(20, Math.min(innerWidth - menu.offsetWidth - 20, rect.right - menu.offsetWidth)) + 'px';
  };
  // «Limpiar anuncios»: the Mac scans every frame; the result arrives through __lumaCleanResult.
  const startCleaning = () => {
    if (clean.classList.contains('busy')) return;
    if (!send('clean-ads')) return;
    closeMenu(false);
    clean.classList.add('busy'); clean.setAttribute('aria-label', 'Buscando anuncios…');
    notify('Buscando anuncios en toda la página…');
    clearTimeout(cleanTimer);
    cleanTimer = setTimeout(() => showCleanResult({ ok: false, error: 'La limpieza tardó demasiado. Inténtalo de nuevo.' }), 25000);
  };
  const showCleanResult = result => {
    clearTimeout(cleanTimer); clearTimeout(toastTimer); toast.classList.remove('show');
    clean.classList.remove('busy'); clean.setAttribute('aria-label', 'Limpiar anuncios');
    const item = (label, action) => {
      const button = el('button', { class: 'item', 'data-clean': action }, el('span', {}, label));
      button.addEventListener('click', event => {
        event.stopPropagation();
        closeMenu(true);
        if (action === 'undo' && send('clean-undo')) notify('Restaurando la página…');
        if (action === 'again') startCleaning();
      });
      return button;
    };
    let title, note = '';
    const items = [];
    if (!result.ok) { title = 'No se pudo limpiar'; note = result.error || ''; items.push(item('Reintentar', 'again'), item('Cerrar', 'close')); }
    else if (result.undone) { notify(result.restored ? 'Página restaurada' : 'No había nada que restaurar'); return; }
    else if (result.hidden) {
      title = result.hidden === 1 ? 'Se quitó 1 anuncio' : `Se quitaron ${result.hidden} anuncios`;
      note = result.learned ? `Recordado para este sitio: la próxima visita llegará limpia.` : 'Si algo de la página desapareció, pulsa Deshacer.';
      items.push(item('Listo', 'close'), item('Buscar otra vez', 'again'), item('Deshacer', 'undo'));
    } else {
      title = 'No encontré anuncios visibles';
      note = result.remembered ? 'Este sitio ya tiene limpieza recordada.' : 'La protección ya bloqueó lo conocido.';
      items.push(item('Listo', 'close'), ...(result.remembered ? [item('Deshacer limpieza recordada', 'undo')] : []));
    }
    menu.replaceChildren(el('div', { class: 'menu-title' }, title), ...(note ? [el('div', { class: 'menu-note' }, note)] : []), ...items);
    placeMenu(clean);
    menu.querySelector('.item')?.focus();
  };
  const openMenu = () => {
    const saved = state.favoriteCategories || [];
    menu.replaceChildren(el('div', { class: 'menu-title' }, saved.length ? 'Marcador en…' : 'Guardar en…'),
      ...(state.categories || []).map(name => {
        const item = el('button', { class: 'item' + (saved.includes(name) ? ' on' : ''), 'data-category': name, role: 'menuitemcheckbox', 'aria-checked': saved.includes(name) ? 'true' : 'false' }, el('span', {}, name), el('span', { class: 'tick' }, icon('check', 22)));
        item.addEventListener('click', event => {
          event.stopPropagation();
          const wasSaved = (state.favoriteCategories || []).includes(name);
          if (!send('favorite', { url: location.href, title: document.title, category: name })) return;
          update({ favoriteCategories: wasSaved ? state.favoriteCategories.filter(entry => entry !== name) : [...(state.favoriteCategories || []), name] });
          update({ favorite: state.favoriteCategories.length > 0 });
          notify(wasSaved ? 'Quitado de ' + name : 'Guardado en ' + name);
          closeMenu(true);
        });
        return item;
      }));
    placeMenu(star);
    (menu.querySelector('.item.on') || menu.querySelector('.item'))?.focus();
  };
  const startEditing = () => {
    if (editing) return;
    editing = true; bar.classList.add('editing');
    input.value = state.url || location.href;
    input.focus(); input.select();
    reveal(false);
  };
  const stopEditing = () => {
    editing = false; bar.classList.remove('editing');
    rendered.label = undefined; update({});
    scheduleHide();
  };
  const controls = () => [...root.querySelectorAll('#tabs button, #bar button, #pill')].filter(element => !element.hidden && !element.disabled && element.getClientRects().length);
  const move = step => {
    const list = controls();
    const index = list.indexOf(root.activeElement);
    list[(index + step + list.length) % list.length]?.focus();
  };
  const leave = () => { root.activeElement?.blur(); scheduleHide(1500); };
  const canScrollUp = () => {
    if ((document.scrollingElement || document.documentElement).scrollTop > 0) return true;
    for (let node = document.activeElement; node && node !== document.body; node = node.parentElement) {
      if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return true;
    }
    return false;
  };
  const onKey = event => {
    const code = event.keyCode;
    const active = root.activeElement;
    const own = () => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (menuOpen) {
      if ([37, 38, 39, 40, 13, 461, 27].includes(code)) {
        own();
        const items = [...menu.querySelectorAll('.item')];
        const index = items.indexOf(active);
        if (code === 40 || code === 39) items[(index + 1) % items.length]?.focus();
        else if (code === 38 || code === 37) items[(index - 1 + items.length) % items.length]?.focus();
        else if (code === 13) active?.click();
        else closeMenu(true);
      }
      return;
    }
    if (active === input) {
      if (code === 461 || code === 27) { own(); input.blur(); pill.focus(); }
      else if (code === 40 || code === 38) { own(); input.blur(); if (code === 40) leave(); else pill.focus(); }
      return;
    }
    if (active) {
      if (![37, 38, 39, 40, 13, 461, 27].includes(code)) return;
      own();
      if (code === 37 || code === 39) { move(code === 37 ? -1 : 1); root.activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else if (code === 38) root.getElementById('tab-list').querySelector('[aria-current]')?.focus();
      else if (code === 40 && active.closest('#tabs')) pill.focus();
      else if (code === 40 || code === 461 || code === 27) leave();
      else if (code === 13) active === pill ? startEditing() : active.click();
      return;
    }
    // Color keys always open the bar, even inside TV-style web apps.
    if (code >= 403 && code <= 406) { own(); reveal(true); }
  };
  // Runs after the page: web apps that handle Up/Back themselves keep them.
  const onKeyAfterPage = event => {
    if (event.defaultPrevented || root.activeElement) return;
    if (event.keyCode === 38 && !canScrollUp()) { event.preventDefault(); reveal(true); }
    else if (event.keyCode === 461) { event.preventDefault(); send('back'); }
  };

  // Generic cosmetic filtering for content added after load. Only names go to the
  // Mac; it answers with selectors from the Brave engine.
  const seen = new Set();
  const queue = [];
  const classes = [];
  const ids = [];
  let flushTimer = 0;
  const collect = element => {
    if (element.id && !seen.has('#' + element.id)) { seen.add('#' + element.id); ids.push(element.id); }
    const list = element.classList;
    for (let index = 0; list && index < list.length; index++) {
      const name = list[index];
      if (!seen.has('.' + name)) { seen.add('.' + name); classes.push(name); }
    }
  };
  const flush = () => {
    flushTimer = 0;
    const started = performance.now();
    while (queue.length && performance.now() - started < 8) {
      const node = queue.shift();
      if (node.nodeType !== 1 || node === host || !node.isConnected) continue;
      collect(node);
      const nested = node.querySelectorAll('[id],[class]');
      for (let index = 0; index < nested.length && index < 3000; index++) collect(nested[index]);
    }
    if (seen.size > 30000) seen.clear();
    if ((classes.length || ids.length) && typeof window.__lgLabCommand === 'function') {
      try { window.__lgLabCommand(JSON.stringify({ action: 'cosmetic', value: { classes: classes.splice(0), ids: ids.splice(0) } })); }
      catch { /* Reconnecting; the next batch retries. */ }
    }
    if (queue.length) schedule();
  };
  const schedule = () => { if (!flushTimer) flushTimer = setTimeout(flush, 450); };
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) queue.push(node);
    if (queue.length > 4000) queue.splice(0, queue.length - 4000);
    if (queue.length) schedule();
  }).observe(document, { childList: true, subtree: true });

  const mount = () => {
    if (!document.documentElement) return false;
    // A repeated event can arrive before the first mount observer fires.
    if (root) return true;
    document.getElementById('__luma-toolbar')?.remove();
    host = document.createElement('div'); host.id = '__luma-toolbar';
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;contain:layout style!important';
    root = host.attachShadow({ mode: 'closed' });
    const css = `
      *{box-sizing:border-box;margin:0}[hidden]{display:none!important}
      #tabs{pointer-events:auto;position:absolute;inset:14px 28px auto;height:52px;display:flex;align-items:center;gap:12px;color:#f5f5f7;font:500 20px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:transform .45s,opacity .3s}
      #tabs.hidden{transform:translateY(-150%);opacity:0;pointer-events:none}
      #tab-list{display:flex;gap:8px;overflow-x:auto;min-width:0;scrollbar-width:none}
      .tab{display:flex;align-items:center;flex-shrink:0;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(24,24,28,.72);backdrop-filter:blur(24px)}
      .tab.selected{background:rgba(80,80,88,.85);border-color:rgba(255,255,255,.45)}
      .tab-select{max-width:250px;min-width:100px;padding:12px 16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:12px}
      .tab-close,#new-tab{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;flex-shrink:0}
      #new-tab{background:rgba(24,24,28,.72)}
      #tabs button:focus{outline:3px solid #fff;outline-offset:-3px;background:rgba(255,255,255,.22)}
      #tabs button:disabled{opacity:.4}
      #bar{--blue:#0a84ff;--text:#f5f5f7;--muted:#c7c7cc;--fill:rgba(255,255,255,.12);--raised:rgba(255,255,255,.24);
        pointer-events:auto;position:absolute;inset:76px 28px auto;height:76px;padding:0 14px;display:grid;grid-template-columns:1fr minmax(0,820px) 1fr;align-items:center;gap:20px;
        background:rgba(24,24,28,.52);-webkit-backdrop-filter:blur(30px) saturate(1.7);backdrop-filter:blur(30px) saturate(1.7);border:1px solid rgba(255,255,255,.18);border-radius:26px;
        box-shadow:0 18px 50px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.14);color:var(--text);
        font:500 21px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"LG Smart UI",Arial,sans-serif;-webkit-font-smoothing:antialiased;
        transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .3s ease;will-change:transform}
      #bar.hidden{transform:translateY(-220%);opacity:0;pointer-events:none}
      .group{display:flex;align-items:center;gap:6px}.end{justify-self:end}
      button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .icon{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;color:#f2f2f7;transition:background .2s,color .2s,transform .4s cubic-bezier(.34,1.56,.64,1),box-shadow .25s}
      .icon:hover,.chip:hover{background:var(--fill)}
      .icon:focus,.chip:focus,#pill:focus{outline:none;background:var(--raised);box-shadow:0 0 0 3px rgba(255,255,255,.9),0 8px 20px rgba(0,0,0,.3);transform:scale(1.08)}
      .icon:active,.chip:active{transform:scale(.92)}
      .chip{height:52px;min-width:52px;padding:0 16px;border-radius:14px;display:flex;align-items:center;gap:8px;color:#30d158;font-size:19px;font-variant-numeric:tabular-nums;transition:background .2s,color .3s,transform .4s cubic-bezier(.34,1.56,.64,1),box-shadow .25s}
      .chip.paused{color:#aeaeb2}.chip.offline{color:#ff9f0a}
      #favorite.on{color:#ffcc00}#favorite.on svg{fill:currentColor}
      form{position:relative;min-width:0}
      #pill{position:relative;height:52px;border-radius:14px;background:var(--fill);display:flex;align-items:center;justify-content:center;gap:10px;padding:0 60px;overflow:hidden;cursor:text;transition:background .25s,box-shadow .25s,transform .4s cubic-bezier(.34,1.56,.64,1)}
      #lock{display:flex;color:var(--muted)}
      #label{font-size:22px;line-height:1.35;padding-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.1px}
      input{display:none;position:absolute;inset:0;width:100%;padding:0 60px 0 22px;border:0;background:transparent;font:inherit;font-size:22px;color:var(--text);outline:none}
      input::placeholder{color:#aeaeb2}
      #bar.editing #pill{background:rgba(255,255,255,.2);box-shadow:0 0 0 3px rgba(255,255,255,.9),0 8px 20px rgba(0,0,0,.3);cursor:auto}
      #bar.editing input{display:block}#bar.editing #label,#bar.editing #lock{visibility:hidden}
      #reload{position:absolute;right:6px;top:6px;width:40px;height:40px;border-radius:11px;color:var(--muted)}
      #reload:focus{transform:scale(1.1)}
      #progress{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--blue);transform:scaleX(0);transform-origin:left;opacity:0;overflow:hidden;border-radius:0 2px 2px 0}
      #shine{position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.8),transparent);transform:translateX(-100%)}
      #bar[data-phase=loading] #shine{animation:luma-shimmer 1.1s ease-in-out infinite}
      #grabber{pointer-events:auto;position:absolute;top:12px;left:50%;width:120px;height:8px;margin-left:-60px;border-radius:4px;background:rgba(255,255,255,.55);box-shadow:0 2px 10px rgba(0,0,0,.45);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);opacity:0;transform:translateY(-14px);transition:opacity .3s ease,transform .45s cubic-bezier(.2,.8,.2,1);cursor:pointer}
      #grabber.visible{opacity:1;transform:none}
      #toast{position:absolute;top:108px;left:50%;padding:13px 24px;border-radius:999px;background:rgba(29,29,31,.9);color:#fff;font:500 19px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;opacity:0;transform:translate(-50%,-10px) scale(.96);transition:opacity .25s ease,transform .4s cubic-bezier(.34,1.56,.64,1)}
      #toast.show{opacity:1;transform:translate(-50%,0) scale(1)}
      #veil{pointer-events:auto;position:absolute;inset:104px 0 0;display:grid;place-items:center;background:#f5f5f7;color:#1d1d1f;font:400 21px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"LG Smart UI",Arial,sans-serif;animation:luma-fade .25s ease-out}
      #sheet{max-width:900px;padding:0 48px;text-align:center;animation:luma-rise .5s cubic-bezier(.2,.8,.2,1)}
      .mark{width:92px;height:92px;margin:0 auto 30px;border-radius:26px;display:grid;place-items:center;background:#fff;color:#ff9f0a;box-shadow:0 12px 30px rgba(0,0,0,.08)}
      h2{font-size:42px;font-weight:600;letter-spacing:-.6px;margin-bottom:14px}
      #explanation{font-size:23px;color:#6e6e73}
      #target{margin:18px auto 0;max-width:760px;font-size:18px;color:#8e8e93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .actions{display:flex;justify-content:center;gap:18px;margin-top:40px}
      .actions button{height:60px;padding:0 32px;border-radius:16px;background:rgba(118,118,128,.14);font-weight:600;font-size:21px;transition:transform .4s cubic-bezier(.34,1.56,.64,1),box-shadow .25s,background .2s}
      .actions .primary{background:#0a84ff;color:#fff}
      .actions button:focus{outline:none;transform:scale(1.07);box-shadow:0 0 0 3px #f5f5f7,0 0 0 6px #0a84ff,0 12px 26px rgba(0,0,0,.16)}
      .actions button:active{transform:scale(.95)}
      #hot{pointer-events:auto;position:absolute;inset:0 0 auto;height:40px;cursor:pointer}
      #menu{pointer-events:auto;position:absolute;top:100px;min-width:300px;padding:10px;border-radius:22px;background:rgba(28,28,32,.72);-webkit-backdrop-filter:blur(30px) saturate(1.7);backdrop-filter:blur(30px) saturate(1.7);border:1px solid rgba(255,255,255,.18);box-shadow:0 22px 60px rgba(0,0,0,.5);color:#f5f5f7;font:500 21px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;animation:luma-rise .35s cubic-bezier(.2,.8,.2,1)}
      .menu-title{padding:10px 16px 12px;font-size:16px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#aeaeb2}
      .item{width:100%;height:58px;padding:0 16px;border-radius:14px;display:flex;align-items:center;justify-content:space-between;text-align:left;transition:background .2s,transform .35s cubic-bezier(.34,1.56,.64,1)}
      .item:focus,.item:hover{outline:none;background:rgba(255,255,255,.24);box-shadow:0 0 0 3px rgba(255,255,255,.85)}
      .tick{display:flex;opacity:0;color:#30d158}.item.on .tick{opacity:1}
      .menu-note{max-width:380px;padding:0 16px 12px;font-size:17px;line-height:1.35;color:#d1d1d6}
      #clean.busy{color:#64d2ff}#clean.busy svg{animation:luma-sparkle 1s ease-in-out infinite}
      @keyframes luma-sparkle{50%{transform:scale(.82) rotate(18deg);opacity:.6}}
      @keyframes luma-shimmer{to{transform:translateX(100%)}}
      @keyframes luma-fade{from{opacity:0}}
      @keyframes luma-rise{from{opacity:0;transform:translateY(18px) scale(.98)}}
      @media (prefers-color-scheme:dark){
        #veil{background:#1c1c1e;color:#f5f5f7}.mark{background:#2c2c2e}.actions button{background:rgba(118,118,128,.28)}
        .actions button:focus{box-shadow:0 0 0 3px #1c1c1e,0 0 0 6px #0a84ff}
      }
      @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    const button = (attributes, ...children) => el('button', attributes, ...children);
    root.append(
      el('nav', { id: 'tabs', 'aria-label': 'Pestañas' }, el('div', { id: 'tab-list' }), button({ id: 'new-tab', 'aria-label': 'Nueva pestaña' }, icon('plus', 24))),
      el('div', { id: 'bar', role: 'toolbar', 'aria-label': 'Luma' },
        el('div', { class: 'group' },
          button({ class: 'icon', 'data-action': 'back', 'aria-label': 'Atrás' }, icon('back')),
          button({ class: 'icon', 'data-action': 'forward', 'aria-label': 'Adelante' }, icon('forward'))),
        el('form', {},
          el('div', { id: 'pill', tabindex: '0', role: 'button', 'aria-label': 'Dirección' },
            el('span', { id: 'lock', hidden: true }, icon('lock', 18)), el('span', { id: 'label' }),
            el('input', { 'aria-label': 'Buscar o escribir dirección', autocomplete: 'off', spellcheck: 'false' }),
            el('div', { id: 'progress' }, el('span', { id: 'shine' }))),
          button({ type: 'button', id: 'reload', class: 'icon', 'data-action': 'reload', 'aria-label': 'Recargar' })),
        el('div', { class: 'group end' },
          button({ class: 'icon', id: 'clean', 'data-action': 'clean', 'aria-label': 'Limpiar anuncios' }, icon('sparkles')),
          button({ class: 'icon', id: 'favorite', 'data-action': 'favorite', 'aria-label': 'Guardar en marcadores' }, icon('star')),
          button({ class: 'chip', id: 'count', 'data-action': 'toggle', hidden: true }),
          button({ class: 'icon', id: 'home-button', 'data-action': 'home', 'aria-label': 'Inicio' }, icon('home')),
          button({ class: 'icon', id: 'settings', 'data-action': 'settings', 'aria-label': 'Configuración' }, icon('gear')))),
      el('div', { id: 'hot', hidden: true, role: 'button', 'aria-label': 'Mostrar barra' }),
      el('div', { id: 'grabber', role: 'button', 'aria-label': 'Mostrar barra' }),
      el('div', { id: 'menu', role: 'menu', hidden: true, 'aria-label': 'Categorías' }),
      el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }),
      el('section', { id: 'veil', role: 'alert', hidden: true },
        el('div', { id: 'sheet' },
          el('div', { class: 'mark' }, icon('alert', 46)), el('h2', {}, 'No se puede abrir la página'),
          el('p', { id: 'explanation' }), el('div', { id: 'target' }),
          el('div', { class: 'actions' }, button({ id: 'retry', class: 'primary' }, 'Reintentar'), button({ id: 'home' }, 'Ir a Inicio')))));
    bar = root.getElementById('bar'); pill = root.getElementById('pill'); input = root.querySelector('input'); label = root.getElementById('label');
    lock = root.getElementById('lock'); reload = root.getElementById('reload'); progress = root.getElementById('progress'); shine = root.getElementById('shine');
    veil = root.getElementById('veil'); grabber = root.getElementById('grabber'); toast = root.getElementById('toast');
    hot = root.getElementById('hot'); menu = root.getElementById('menu'); star = root.getElementById('favorite'); clean = root.getElementById('clean');
    window.__lumaCleanResult = showCleanResult;
    root.getElementById('new-tab').onclick = () => send('new-tab');
    root.querySelector('form').onsubmit = event => { event.preventDefault(); submit(); };
    pill.addEventListener('click', startEditing);
    input.addEventListener('blur', stopEditing);
    root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const action = button.dataset.action;
      if (action === 'favorite') { menuOpen && menuAnchor === star ? closeMenu(true) : openMenu(); }
      else if (action === 'clean') startCleaning();
      else send(action);
    }));
    root.getElementById('retry').onclick = () => { input.value = state.url; submit(); };
    root.getElementById('home').onclick = () => send('home');
    grabber.onclick = () => reveal(true);
    hot.onclick = () => reveal(true);
    addEventListener('click', event => { if (event.target !== host) closeMenu(false); }, true);
    root.addEventListener('focusin', () => reveal(false));
    root.addEventListener('focusout', () => scheduleHide());
    document.documentElement.append(host);
    window.__lumaUpdate = status => {
      lastHeartbeat = Date.now();
      clearTimeout(safety);
      update({ tabs: status.tabs || state.tabs, activeTabId: status.activeTabId || state.activeTabId, debug: status.debug === true, blocked: status.blocked, enabled: status.enabled, favorite: status.favorite, favoriteCategories: status.favoriteCategories || [], categories: status.categories || state.categories, searchEngine: status.searchEngine || state.searchEngine, offline: false, ...(status.navigation || {}) });
    };
    window.__lumaSetNavigation = update;
    // A closed shadow tree keeps sites from calling this function.
    window.__lumaToolbarSnapshot = () => ({
      phase: state.phase, searchEngine: state.searchEngine, error: state.error, target: state.url, input: input.value, label: label.textContent,
      overlay: !veil.hidden, visible: shown, editing, toolbarHeight: bar.getBoundingClientRect().height,
      debugVisible: !root.getElementById('count').hidden,
      focusedControl: root.activeElement?.dataset.tabId ? 'tab' : root.activeElement?.id || '',
      tabs: [...root.querySelectorAll('#tab-list .tab')].map(tab => ({
        id: tab.querySelector('.tab-select').dataset.tabId,
        title: tab.querySelector('.tab-select').textContent,
        active: tab.classList.contains('selected'),
        select: tab.querySelector('.tab-select').getBoundingClientRect().toJSON(),
        close: tab.querySelector('.tab-close').getBoundingClientRect().toJSON()
      })),
      newTab: root.getElementById('new-tab').getBoundingClientRect().toJSON(),
      loadingAnimation: getComputedStyle(shine).animationName,
      cleaning: clean.classList.contains('busy'), menuText: menuOpen ? menu.innerText : '',
      buttons: Object.fromEntries(['retry', 'home', 'settings', 'favorite', 'count', 'clean'].map(name => [name, root.getElementById(name).getBoundingClientRect().toJSON()])),
      submit
    });
    setInterval(() => {
      if (Date.now() - lastHeartbeat > 6500 && !state.offline) update({ offline: true });
    }, 2000);
    let lastScroll = scrollY;
    let ticking = false;
    addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = scrollY;
        if (y < lastScroll - 12) reveal(false);
        else if (y > lastScroll + 12 && y > 60) conceal();
        lastScroll = y;
      });
    }, { passive: true });
    addEventListener('mousemove', event => { if (event.clientY < 36 && !shown) reveal(false); }, { passive: true });
    addEventListener('keydown', onKey, true);
    addEventListener('keydown', onKeyAfterPage);
    update(state);
    if (state.phase === 'complete') scheduleHide(4000);
    return true;
  };
  if (!mount()) {
    const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  }
}

// Icons travel as [tag, attributes] so the toolbar builds them without parsing HTML.
const iconShapes = Object.fromEntries(Object.entries(ICONS).map(([name, markup]) => [name,
  [...markup.matchAll(/<(\w+)([^>]*)\/>/g)].map(([, tag, attributes]) => [tag, Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))])]));

export function toolbarSource(state, homeURLs, searchEngine = 'google') {
  return `(${installToolbar.toString()})(${resolveNavigation.toString()},${JSON.stringify({ ...state, searchEngine })},${JSON.stringify(homeURLs)},${JSON.stringify(iconShapes)})`;
}
