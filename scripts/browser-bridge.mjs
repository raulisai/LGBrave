import { connectTV } from './cdp.mjs';
import { createEngine, checkRequest } from './filter-engine.mjs';
import { resolveNavigation } from '../src/navigation.js';
import { toolbarSource } from './toolbar.mjs';
import { Preferences } from './preferences.mjs';

export const packagedHome = 'file:///media/developer/apps/usr/palm/applications/com.lgapp.lab/index.html';
export const home = (process.env.LAB_ORIGIN || 'http://192.168.1.148:43187') + '/luma-home/';

export class BrowserBridge {
  constructor(cdp, options = {}) {
    this.cdp = cdp;
    this.preferences = new Preferences(options.preferencesFile);
    this.showSettings = false;
    this.engine = createEngine(options);
    this.enabled = true;
    this.records = [];
    this.contexts = new Map();
    this.frames = new Map();
    this.uiContexts = new Set();
    this.errors = [];
    this.subframesAttached = 0;
    this.toolbar = options.toolbar !== false;
    this.navigation = { phase: 'idle', progress: 0, url: '', error: '' };
    this.navigationTimeout = options.navigationTimeout || 25000;
    this.toolbarWorld = 'luma-toolbar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  async start() {
    this.unsubscribe = this.cdp.onEvent(event => this.event(event));
    await this.cdp.call('Page.enable');
    await this.cdp.call('Runtime.enable');
    await this.cdp.call('Network.enable');
    await this.cdp.call('Network.setCacheDisabled', { cacheDisabled: true });
    await this.cdp.call('Network.setBypassServiceWorker', { bypass: true });
    const { frameTree } = await this.cdp.call('Page.getFrameTree');
    this.mainFrame = frameTree.frame.id;
    this.frames.set(this.mainFrame, frameTree.frame.url);
    await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.cdp.call('Runtime.addBinding', { name: '__lgLabCommand', executionContextName: this.toolbarWorld });
    if (this.toolbar) this.toolbarScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', {
      source: toolbarSource({ phase: 'loading', progress: 18 }, [home, packagedHome], this.preferences.searchEngine), worldName: this.toolbarWorld
    })).identifier;
    try { await this.cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); }
    catch (error) { this.errors.push({ phase: 'autoAttach', error: error.message }); }
    for (const [id, context] of this.contexts) if (context.auxData?.isDefault) await this.setupContext(id, context);
    const initialURL = await this.cdp.evaluate('location.href');
    this.navigation = { phase: 'complete', progress: 100, url: initialURL, error: '' };
    await this.status();
    return this;
  }
  async event({ method, params, sessionId }) {
    try {
      if (method === 'Target.attachedToTarget') {
        this.subframesAttached++;
        await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, params.sessionId);
      }
      if (method === 'Fetch.requestPaused') return await this.request(params, sessionId);
      if (method === 'Page.frameNavigated') {
        this.frames.set(params.frame.id, params.frame.url);
        if (!params.frame.parentId) {
          this.mainFrame = params.frame.id;
          if (params.frame.url.includes('/wam/loaderror.html')) await this.navigationFailed('La página no pudo cargarse en la pantalla. Reintenta o prueba otra dirección.');
          else if (this.navigation.phase === 'loading') { this.navigation.url = params.frame.url; this.navigation.progress = 40; this.committedNavigation = this.navigationId; }
        }
      }
      if (method === 'Page.navigatedWithinDocument' && params.frameId === this.mainFrame) {
        this.navigation.url = params.url; this.committedNavigation = this.navigationId;
        if (this.navigation.phase === 'loading') await this.navigationFinished();
        else await this.status();
      }
      if (method === 'Network.requestWillBeSent' && params.type === 'Document' && params.frameId === this.mainFrame && !sessionId && !params.request.url.includes('/wam/loaderror.html')) {
        if (!(this.recovering && params.request.url === home)) {
          this.mainRequest = params.requestId;
          if (this.navigation.phase !== 'loading') this.beginNavigation(params.request.url);
          else this.navigation.url = params.request.url;
        }
      }
      if (method === 'Network.responseReceived' && params.requestId === this.mainRequest && params.type === 'Document' && !sessionId) {
        if (params.response.status >= 400) await this.navigationFailed(`El sitio respondió con un error (${params.response.status}). Puedes reintentar o volver al inicio.`);
        else { this.navigation.progress = 60; await this.status(); }
      }
      if (method === 'Network.loadingFailed' && params.requestId === this.mainRequest && !params.canceled && !sessionId) {
        await this.navigationFailed(this.readableError(params.errorText));
      }
      if (method === 'Runtime.executionContextsCleared') { this.contexts.clear(); this.uiContexts.clear(); this.toolbarContext = null; }
      if (method === 'Runtime.executionContextDestroyed') { this.contexts.delete(params.executionContextId); this.uiContexts.delete(params.executionContextId); }
      if (method === 'Runtime.executionContextCreated' && !sessionId) {
        const context = params.context;
        this.contexts.set(context.id, context);
        if (context.auxData?.isDefault && this.mainFrame) await this.setupContext(context.id, context);
      }
      if (method === 'Page.domContentEventFired') { await this.refreshCosmetics(); await this.navigationFinished(); }
      if (method === 'Page.loadEventFired') await this.navigationFinished(true);
      if (method === 'Runtime.bindingCalled' && params.name === '__lgLabCommand' && this.uiContexts.has(params.executionContextId)) {
        const command = JSON.parse(params.payload);
        try { await this.command(command); }
        catch (error) { await this.navigationFailed(error.message); }
      }
    } catch (error) {
      if (!/Cannot find context|Execution context was destroyed|Inspected target navigated|No frame with given id/.test(error.message)) {
        this.errors.push({ phase: method, error: error.message });
      }
    }
  }
  beginNavigation(url) {
    this.recovering = false;
    this.navigationId = (this.navigationId || 0) + 1;
    const id = this.navigationId;
    clearTimeout(this.navigationTimer);
    this.navigation = { phase: 'loading', progress: 12, url, error: '' };
    this.navigationTimer = setTimeout(() => {
      if (this.navigationId === id) this.navigationFailed('El sitio está tardando demasiado en responder. Puedes reintentar o volver al inicio.', true).catch(() => {});
    }, this.navigationTimeout);
  }
  readableError(error) {
    if (/NAME_NOT_RESOLVED/.test(error)) return 'No encontramos ese sitio. Revisa la dirección o busca por su nombre.';
    if (/INTERNET_DISCONNECTED|CONNECTION|NETWORK/.test(error)) return 'No pudimos conectar con el sitio. Revisa tu conexión y vuelve a intentar.';
    if (/CERT_|SSL_/.test(error)) return 'No se pudo establecer una conexión segura con el sitio.';
    return 'No pudimos cargar esta página. Reintenta o vuelve al inicio.';
  }
  async navigationFailed(error, recover = false) {
    clearTimeout(this.navigationTimer);
    this.navigation = { ...this.navigation, phase: 'error', error, progress: 0 };
    if (recover) {
      this.recovering = true; this.navigationId = (this.navigationId || 0) + 1; this.mainRequest = null;
      await this.cdp.call('Page.stopLoading').catch(() => {});
      await this.cdp.call('Page.navigate', { url: home }).catch(() => {});
    }
    await this.status();
  }
  async navigationFinished(final = false) {
    if (this.navigation.phase !== 'loading') return;
    const content = await this.cdp.evaluate(`({url:location.href,ready:document.readyState,hasContent:!!document.body && (document.body.innerText.trim().length>1 || !!document.body.querySelector('img,video,canvas,svg,iframe'))})`).catch(() => null);
    if (!content || content.url === 'about:blank') return;
    // Events from the previous document may arrive while Page.navigate is pending.
    if (content.url !== this.navigation.url) return;
    if (this.committedNavigation !== this.navigationId) return;
    if (content.hasContent || content.url === home || content.url === packagedHome) {
      clearTimeout(this.navigationTimer);
      this.navigation = { phase: 'complete', progress: 100, url: content.url, error: '' };
      await this.status();
    } else if (final) await this.navigationFailed('El sitio no mostró contenido. Reintenta o abre otra página.');
  }
  async request(params, sessionId) {
    const { requestId, request, resourceType, frameId } = params;
    const source = this.frames.get(frameId) || this.frames.get(this.mainFrame) || request.url;
    let result = { should_block: false };
    try {
      if (this.enabled && /^https?:/.test(request.url) && !(resourceType === 'Document' && frameId === this.mainFrame)) {
        result = checkRequest(this.engine, request.url, source, resourceType, request.method);
      }
      const record = { url: request.url.split('?')[0], source: source.split('?')[0], type: resourceType, blocked: !!result.should_block, rule: result.filter?.raw_line || null, exception: result.exception?.raw_line || null, redirect: !!result.redirect };
      this.records.push(record);
      if (this.records.length > 10000) this.records.shift();
      if (result.should_block && result.redirect) {
        const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(result.redirect);
        if (match) {
          const bytes = result.redirect.includes(';base64,') ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]));
          await this.cdp.call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: match[1] || 'text/plain' }], body: bytes.toString('base64') }, sessionId);
        } else await this.emptyResponse(requestId, resourceType, sessionId);
      } else if (result.should_block) await this.emptyResponse(requestId, resourceType, sessionId);
      else await this.cdp.call('Fetch.continueRequest', { requestId, ...(result.rewritten_url ? { url: result.rewritten_url } : {}) }, sessionId);
    } catch (error) {
      this.errors.push({ phase: 'request', error: error.message });
      await this.cdp.call('Fetch.continueRequest', { requestId }, sessionId).catch(() => {});
    }
  }
  async emptyResponse(requestId, type, sessionId) {
    // WAM transforma algunos errores de subframes en un error de la app completa.
    // Una respuesta local vacía evita contactar al destino sin disparar ese fallo.
    const mime = { Script: 'application/javascript', Stylesheet: 'text/css', Document: 'text/html', XHR: 'application/json', Fetch: 'application/json', Image: 'image/png' };
    let body = ['XHR', 'Fetch'].includes(type) ? '{}' : type === 'Document' ? '<!doctype html><title>Bloqueado por Luma</title>' : '';
    let bytes = Buffer.from(body);
    if (type === 'Image') bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
    await this.cdp.call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: mime[type] || 'text/plain' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Luma-Blocked', value: '1' }], body: bytes.toString('base64') }, sessionId);
  }
  async setupContext(id, context) {
    const url = await this.cdp.evaluate('location.href', id);
    if (url === home || url === packagedHome) {
      await this.cdp.call('Runtime.addBinding', { name: '__lgLabCommand', executionContextId: id });
      this.uiContexts.add(id);
      await this.status();
    }
    if ((/^https?:/.test(url) && url !== home) || url.includes('/wam/loaderror.html')) {
      await this.applyCosmetics(id, url, true);
      if (context.auxData.frameId === this.mainFrame && this.toolbar) await this.injectToolbar();
    }
  }
  async applyCosmetics(id, url, scriptlets = false) {
    if (!this.enabled) return;
    const resources = this.engine.urlCosmeticResources(url);
    const dynamic = await this.cdp.evaluate(`(() => { const nodes=[...document.querySelectorAll('[class],[id]')].slice(0,5000);return {classes:[...new Set(nodes.flatMap(n=>[...n.classList]))],ids:nodes.map(n=>n.id).filter(Boolean)} })()`, id);
    const selectors = [...resources.hide_selectors];
    if (!resources.generichide) selectors.push(...this.engine.hiddenClassIdSelectors(dynamic.classes, dynamic.ids, resources.exceptions || []));
    if (selectors.length) {
      const css = selectors.map(selector => `${selector}{display:none!important}`).join('\n');
      await this.cdp.evaluate(`(() => {const css=${JSON.stringify(css)};const apply=()=>{if(!document.documentElement)return false;const sheet=window.__lumaFilterSheet||new CSSStyleSheet();sheet.replaceSync(css);if(!document.adoptedStyleSheets.includes(sheet))document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.__lumaFilterSheet=sheet;return true};if(!apply()){const observer=new MutationObserver(()=>{if(apply())observer.disconnect()});observer.observe(document,{childList:true,subtree:true})}})()`, id);
    }
    if (scriptlets && resources.injected_script) await this.cdp.evaluate(resources.injected_script, id);
  }
  async refreshCosmetics() {
    for (const [id, context] of this.contexts) {
      if (!context.auxData?.isDefault) continue;
      try { const url = await this.cdp.evaluate('location.href', id); if (/^https?:/.test(url)) await this.applyCosmetics(id, url); }
      catch { /* A navigation may have replaced this frame. */ }
    }
    await this.status();
  }
  async injectToolbar() {
    const { executionContextId: id } = await this.cdp.call('Page.createIsolatedWorld', { frameId: this.mainFrame, worldName: this.toolbarWorld });
    this.uiContexts.add(id);
    this.toolbarContext = id;
    await this.cdp.evaluate(toolbarSource(this.navigation, [home, packagedHome], this.preferences.searchEngine), id);
    await this.status();
  }
  async status() {
    const blocked = this.records.filter(r => r.blocked).length;
    for (const id of this.uiContexts) {
      await this.cdp.evaluate(`(() => {if(window.__lumaUpdate)window.__lumaUpdate(${blocked},${this.enabled},${JSON.stringify(this.navigation)},${JSON.stringify(this.preferences.searchEngine)});else window.dispatchEvent(new CustomEvent('lg-lab-status',{detail:${JSON.stringify({ connected: true, blocked, navigation: this.navigation, searchEngine: this.preferences.searchEngine, showSettings: this.showSettings, message: this.enabled ? 'Filtros activos · Mac necesario durante esta prueba.' : 'Filtros pausados; recarga para comparar.' })}}))})()`, id).catch(() => {});
    }
  }
  async command({ action, value }) {
    if (action === 'navigate') {
      this.navigation.url = String(value ?? '').trim();
      const url = new URL(resolveNavigation(value, this.preferences.searchEngine));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Solo navegación HTTP(S), sin credenciales en la URL.');
      if (this.earlyScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.earlyScript });
      const resources = this.enabled ? this.engine.urlCosmeticResources(url.href) : { injected_script: '' };
      const script = `if(location.hostname===${JSON.stringify(url.hostname)}){${resources.injected_script || ''}}`;
      this.earlyScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: script })).identifier;
      this.beginNavigation(url.href);
      const navigationId = this.navigationId;
      await this.status();
      const result = await this.cdp.call('Page.navigate', { url: url.href });
      if (result.errorText && this.navigationId === navigationId) await this.navigationFailed(this.readableError(result.errorText));
    } else if (action === 'set-search-engine') {
      this.preferences.setSearchEngine(value);
      await this.status();
    } else if (action === 'close-settings') {
      this.showSettings = false;
      await this.status();
    } else if (action === 'settings') {
      this.showSettings = true;
      const current = await this.cdp.evaluate('location.href');
      if (current !== home && current !== packagedHome) {
        this.beginNavigation(home); await this.status();
        await this.cdp.call('Page.navigate', { url: home });
      } else await this.status();
    } else if (action === 'home') {
      this.showSettings = false;
      this.beginNavigation(home); await this.status();
      await this.cdp.call('Page.navigate', { url: home });
    } else if (action === 'stop') {
      this.navigationId = (this.navigationId || 0) + 1;
      this.mainRequest = null;
      clearTimeout(this.navigationTimer);
      this.navigation = { ...this.navigation, phase: 'idle', progress: 0, error: '' };
      await this.cdp.call('Page.stopLoading');
      await this.cdp.call('Page.navigate', { url: home });
      await this.status();
    } else if (action === 'reload') {
      this.beginNavigation(await this.cdp.evaluate('location.href'));
      await this.status(); await this.cdp.call('Page.reload');
    }
    else if (['back', 'forward'].includes(action)) {
      const history = await this.cdp.call('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)];
      if (entry) { this.beginNavigation(entry.url); await this.status(); await this.cdp.call('Page.navigateToHistoryEntry', { entryId: entry.id }); }
    } else if (action === 'toggle') { this.enabled = !this.enabled; await this.status(); }
  }
  async stop() {
    clearTimeout(this.navigationTimer);
    this.unsubscribe?.();
    await this.cdp.call('Fetch.disable').catch(() => {});
    if (this.toolbarScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.toolbarScript }).catch(() => {});
    if (this.earlyScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.earlyScript }).catch(() => {});
    await this.cdp.call('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
    await this.cdp.call('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
  }
}

if (process.argv[1]?.endsWith('/browser-bridge.mjs')) {
  const cdp = await connectTV(process.argv[2]);
  const bridge = await new BrowserBridge(cdp, { fixtures: true }).start();
  await bridge.command({ action: 'home' });
  console.log('Luma conectado. El filtrado funciona mientras este proceso y ares-inspect permanezcan abiertos.');
  const tick = setInterval(() => bridge.status().catch(() => {}), 1500);
  process.on('SIGTERM', finish); process.on('SIGINT', finish);
  async function finish() { clearInterval(tick); await bridge.stop(); cdp.close(); process.exit(0); }
}
