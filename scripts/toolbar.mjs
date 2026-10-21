import { resolveNavigation } from '../src/navigation.js';

// This function runs in a CDP isolated world, including at document start.
function installToolbar(resolve, initial, homeURLs) {
  if (window.top !== window || homeURLs.includes(location.href)) return;
  if (window.__lumaSetNavigation) { window.__lumaSetNavigation(initial); return; }
  let state = { phase: 'loading', progress: 10, error: '', url: location.href, ...initial };
  let root;
  let input;
  let host;
  let safety;
  let lastHeartbeat = Date.now();
  const send = (action, value) => {
    if (typeof window.__lgLabCommand !== 'function') {
      update({ phase: 'error', error: 'Se perdió la conexión. Espera un momento y vuelve a intentar.' });
      return;
    }
    window.__lgLabCommand(JSON.stringify({ action, value }));
  };
  const update = next => {
    const previousPhase = state.phase;
    state = { ...state, ...next };
    if (!root) return;
    const busy = state.phase === 'loading';
    const failed = state.phase === 'error';
    host.dataset.phase = state.phase;
    root.querySelector('#veil').hidden = !busy && !failed;
    root.querySelector('#spinner').hidden = !busy;
    root.querySelector('#failure').hidden = !failed;
    root.querySelector('#heading').textContent = failed ? 'No pudimos abrir esta página' : 'Abriendo tu página';
    root.querySelector('#explanation').textContent = failed ? state.error : 'Estamos preparando el contenido para ti.';
    root.querySelector('#target').textContent = state.url || location.href;
    root.querySelector('#retry').hidden = !failed;
    root.querySelector('#home').hidden = !failed;
    root.querySelector('#progress').style.transform = `scaleX(${Math.max(.02, (state.progress || 0) / 100)})`;
    const progress = root.querySelector('#progress');
    progress.style.opacity = busy || (state.phase === 'complete' && previousPhase === 'loading') ? '1' : '0';
    if (state.phase === 'complete' && previousPhase === 'loading') setTimeout(() => { if (state.phase !== 'loading') progress.style.opacity = '0'; }, 400);
    root.querySelector('#activity').hidden = !busy;
    if (state.url && root.activeElement !== input) input.value = state.url;
    if (failed && previousPhase !== 'error') root.querySelector('#retry').focus();
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
  const mount = () => {
    if (!document.documentElement) return false;
    // A repeated event can arrive before the first mount observer fires.
    if (root) return true;
    document.getElementById('__luma-toolbar')?.remove();
    host = document.createElement('div'); host.id = '__luma-toolbar';
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important';
    root = host.attachShadow({ mode: 'closed' });
    const markup = `<style>
      *{box-sizing:border-box}[hidden]{display:none!important}nav{pointer-events:auto;height:76px;display:flex;align-items:center;gap:18px;padding:12px 24px;background:#e7eaf1fa;border-bottom:1px solid #bcc6d2;font:20px Arial;color:#3f5265;box-shadow:0 3px 15px #0002}button{background:#f8faff;border:0;border-radius:8px;padding:9px 15px;color:#43566b;font:22px Arial;transition:background .16s,transform .16s}button:hover{background:#e0ebf7}button:active{transform:scale(.96)}button:focus-visible,input:focus-visible{outline:3px solid #3884dc}form{display:flex;flex:1;gap:8px}input{background:#fff;border:0;border-radius:9px;flex:1;min-width:0;text-align:center;font:20px Arial;color:#40536a;padding:10px}#count{font-size:17px;white-space:nowrap;color:#447763}#activity{width:18px;height:18px;border:2px solid #cad8e5;border-top-color:#527c9c;border-radius:50%;animation:spin .85s linear infinite}#progress{position:absolute;top:73px;left:0;width:100%;height:3px;transform-origin:left;background:#6c9ec6;transition:transform .35s ease,opacity .3s}#veil{pointer-events:auto;position:absolute;inset:76px 0 0;display:grid;place-items:center;background:#edf2f8fa;font:22px Arial;color:#6a7d8e;animation:appear .2s ease-out}#sheet{background:#ffffffc9;max-width:950px;padding:50px 65px;border-radius:26px;box-shadow:0 15px 60px #536b8112;text-align:center}h2{font-size:32px;font-weight:500;color:#334b60;margin:26px 0 14px}#target{font-size:17px;max-width:760px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:22px auto;color:#7c8c9c}#spinner{display:inline-block;width:44px;height:44px;border:3px solid #dbe5ef;border-top-color:#678fb0;border-radius:50%;animation:spin .85s linear infinite}#failure{display:inline-grid;place-items:center;width:50px;height:50px;border:2px solid #c58b72;color:#a56850;border-radius:50%;font-size:32px}.actions{display:flex;justify-content:center;gap:16px;margin-top:30px}.actions button{padding:13px 22px;border:1px solid #c7d5e2;border-radius:12px;background:#f8fbff;color:#486581;font-size:20px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){#veil,#spinner,#activity{animation:none}button,#progress{transition:none}}
      </style><nav><button data-action="home" title="Inicio">Inicio</button><button data-action="back" title="Atrás">‹</button><button data-action="forward" title="Adelante">›</button><button data-action="reload" title="Recargar">Recargar</button><form><input aria-label="Buscar o introducir dirección" placeholder="Buscar o introducir dirección"><button type="submit">Ir</button></form><span id="activity" hidden></span><button id="count" data-action="toggle">Protección activa</button><button id="settings" data-action="settings" title="Configuración">Config.</button></nav><div id="progress"></div><section id="veil" role="status" aria-live="polite" hidden><div id="sheet"><span id="spinner"></span><span id="failure" hidden>!</span><h2 id="heading"></h2><p id="explanation"></p><div id="target"></div><div class="actions"><button id="retry">Reintentar</button><button id="home">Volver al inicio</button></div></div></section>`;
    const styleEnd = markup.indexOf('</style>');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(markup.slice('<style>'.length, styleEnd));
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = markup.slice(styleEnd + '</style>'.length);
    input = root.querySelector('input'); input.value = state.url || location.href;
    root.querySelector('form').onsubmit = event => { event.preventDefault(); submit(); };
    root.querySelectorAll('[data-action]').forEach(button => button.onclick = () => send(button.dataset.action));
    root.querySelector('#retry').onclick = () => { input.value = state.url; submit(); };
    root.querySelector('#home').onclick = () => send('home');
    document.documentElement.append(host);
    window.__lumaUpdate = (blocked, enabled, navigation, searchEngine) => {
      lastHeartbeat = Date.now();
      clearTimeout(safety);
      if (searchEngine) state.searchEngine = searchEngine;
      input.placeholder = 'Buscar con ' + ({ google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo', brave: 'Brave Search' }[state.searchEngine] || 'Google') + ' o introducir dirección';
      root.querySelector('#count').textContent = (enabled ? 'Protección · ' : 'Pausada · ') + blocked;
      if (navigation) update(navigation);
    };
    window.__lumaSetNavigation = update;
    // A closed shadow tree keeps sites from calling this function.
    window.__lumaToolbarSnapshot = () => ({ phase: state.phase, searchEngine: state.searchEngine, error: state.error, target: state.url, input: input.value, overlay: !root.querySelector('#veil').hidden, toolbarHeight: root.querySelector('nav').getBoundingClientRect().height, spinnerAnimation: getComputedStyle(root.querySelector('#spinner')).animationName, buttons: Object.fromEntries(['retry','home','settings'].map(name=>[name,root.querySelector('#'+name).getBoundingClientRect().toJSON()])), submit: submit });
    setInterval(() => {
      if (Date.now() - lastHeartbeat > 6500 && state.phase !== 'error') update({ phase: 'error', error: 'Se perdió la conexión con el navegador. Estamos intentando reconectar.' });
    }, 2000);
    document.addEventListener('keydown', event => {
      if (event.keyCode === 461) { event.preventDefault(); send('home'); return; }
      const active = root.activeElement;
      if (active === input) return;
      if ([37, 38, 39, 40].includes(event.keyCode) && (active || (event.keyCode === 38 && scrollY === 0))) {
        event.preventDefault();
        const controls = [...root.querySelectorAll('button,input')].filter(el => !el.hidden && el.getClientRects().length);
        const direction = event.keyCode === 37 || event.keyCode === 38 ? -1 : 1;
        controls[(controls.indexOf(active) + direction + controls.length) % controls.length]?.focus();
      }
      if (event.keyCode === 13 && active?.tagName === 'BUTTON') { event.preventDefault(); active.click(); }
    }, true);
    update(state);
    return true;
  };
  if (!mount()) {
    const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  }
}

export function toolbarSource(state, homeURLs, searchEngine = 'google') {
  return `(${installToolbar.toString()})(${resolveNavigation.toString()},${JSON.stringify({ ...state, searchEngine })},${JSON.stringify(homeURLs)})`;
}
