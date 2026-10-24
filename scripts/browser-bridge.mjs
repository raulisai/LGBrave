import { connectTV } from './cdp.mjs';
import { createEngine, checkRequest, filterConfiguration } from './filter-engine.mjs';
import { resolveNavigation } from '../src/navigation.js';
import { toolbarSource } from './toolbar.mjs';
import { Preferences } from './preferences.mjs';
import { navigationShieldSource } from './navigation-shield.mjs';
import { turnstileDeferSource } from './turnstile-defer.mjs';
import { devtoolsQuietSource } from './devtools-quiet.mjs';
import { CrashMemory } from './crash-memory.mjs';
import { BrowserTabs } from './browser-tabs.mjs';
import { FlightRecorder } from './flight-recorder.mjs';
import { cleanerSource, decideCleaning, CleanerRules } from './ad-cleaner.mjs';
import { dirname, join } from 'node:path';

export const packagedHome = 'file:///media/developer/apps/usr/palm/applications/com.lgapp.lab/index.html';
export const home = (process.env.LAB_ORIGIN || 'http://192.168.1.148:43187') + '/luma-home/';
// Hosts whose filters are registered once at start, so links into them are covered too.
const PRESETS = [{ key: 'youtube', pattern: '(^|\\.)youtube(-nocookie)?\\.com$', sample: 'https://www.youtube.com/' }];
// «No soy un robot» is a real check the user must solve, not advertising: never filter or touch it.
export const isHumanVerification = url => { try { return new URL(url).hostname === 'challenges.cloudflare.com'; } catch { return false; } };
// Cloudflare serves its "verify you are human" page with 403/503 and this header: it is the page to show, not a failure.
export const isChallengeResponse = response => Object.entries(response?.headers || {}).some(([name, value]) => name.toLowerCase() === 'cf-mitigated' && String(value).toLowerCase() === 'challenge');
export const scriptletSource = script => `(()=>{const scriptletGlobals={};${script}\n})()`;

export class BrowserBridge {
  constructor(cdp, options = {}) {
    this.cdp = cdp;
    this.debug = options.debug ?? (process.env.LUMA_DEBUG === '1');
    this.tabs = options.tabs || new BrowserTabs(home);
    this.recorder = options.recorder === false || options.preferencesFile ? null : new FlightRecorder();
    this.tabQueue = Promise.resolve();
    this.preferences = new Preferences(options.preferencesFile);
    // Learned «Limpiar anuncios» selectors live next to the preferences.
    this.cleanerRules = new CleanerRules(options.cleanerRulesFile || join(dirname(options.preferencesFile || '.local/browser-settings.json'), 'cleaner-rules.json'));
    this.cleanerWorld = 'luma-cleaner-' + Math.random().toString(36).slice(2, 10);
    this.cleaning = null;
    this.lastCleaning = null;
    this.crashMemory = new CrashMemory(options.crashFile || join(dirname(options.preferencesFile || '.local/browser-settings.json'), 'crash-sites.json'));
    this.showSettings = false;
    this.engine = createEngine(options);
    this.engineOptions = options;
    this.filterRevision = filterConfiguration().manifest.revision || 'legacy';
    this.enabled = true;
    this.records = [];
    this.blocked = 0;
    // Host → document-start script with that host's cosmetic CSS and scriptlets.
    this.documentScripts = new Map();
    this.presetScripts = new Map();
    this.cosmeticCache = new Map();
    this.genericSelectors = new Set();
    this.cacheDisabled = options.cacheDisabled === true;
    this.contexts = new Map();
    this.frames = new Map();
    this.uiContexts = new Set();
    this.errors = [];
    this.subframesAttached = 0;
    this.blockedNavigations = 0;
    this.toolbar = options.toolbar !== false;
    this.navigation = { phase: 'idle', progress: 0, url: '', error: '' };
    this.navigationTimeout = options.navigationTimeout || 25000;
    this.toolbarWorld = 'luma-toolbar-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }
  async refreshFilters() {
    if(this.navigation.phase==='loading')return false;
    const revision=filterConfiguration().manifest.revision || 'legacy';
    if(revision===this.filterRevision)return false;
    const engine=createEngine(this.engineOptions);
    // Swap only the decision engine. Never reload the page or touch media.
    this.engine=engine;this.filterRevision=revision;
    this.cosmeticCache.clear();this.genericSelectors.clear();
    await this.clearDocumentScripts();
    await this.registerPresets();
    // New cosmetic/scriptlet resources take effect on the next navigation.
    return true;
  }
  async start() {
    this.unsubscribe = this.cdp.onEvent(event => this.event(event));
    await this.cdp.call('Page.enable');
    await this.cdp.call('Runtime.enable');
    // The app dropping the connection while a site was still opening is remembered (crash-memory.mjs).
    this.cdp.closed?.then(() => {
      if (this.stopped) return;
      const host = this.crashMemory.closed();
      if (host) this.recorder?.write('CIERRE', host + ' cerró la app al abrirse');
    });
    if (this.recorder) {
      for (const domain of ['Inspector', 'Log']) await this.cdp.call(domain + '.enable').catch(() => {});
      this.recorder.write('START', 'puente conectado');
      this.heapTimer = setInterval(() => this.recorder.heap(this.cdp), 3000);
      this.heapTimer.unref?.();
    }
    // Bodies are never read: keep the TV from buffering them for DevTools.
    await this.cdp.call('Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0, maxPostDataSize: 0 })
      .catch(() => this.cdp.call('Network.enable'));
    // The HTTP cache stays on: blocked responses carry no-store, so it never keeps an ad.
    if (this.cacheDisabled) await this.cdp.call('Network.setCacheDisabled', { cacheDisabled: true });
    await this.cdp.call('Network.setBypassServiceWorker', { bypass: true });
    const { frameTree } = await this.cdp.call('Page.getFrameTree');
    this.mainFrame = frameTree.frame.id;
    this.frames.set(this.mainFrame, frameTree.frame.url);
    this.navigationGuardScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: navigationShieldSource })).identifier;
    // Not ad blocking: keeps hidden Turnstile widgets from closing the app, so it stays on while paused.
    this.turnstileScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: turnstileDeferSource })).identifier;
    // Pages that eject themselves when they notice the inspector (disable-devtool): keep console bait inert.
    this.quietScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: devtoolsQuietSource })).identifier;
    await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.cdp.call('Runtime.addBinding', { name: '__lgLabCommand', executionContextName: this.toolbarWorld });
    if (this.toolbar) this.toolbarScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', {
      source: toolbarSource({ phase: 'loading', progress: 18, debug: this.debug }, [home, packagedHome], this.preferences.searchEngine), worldName: this.toolbarWorld
    })).identifier;
    try { await this.cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }); }
    catch (error) { this.errors.push({ phase: 'autoAttach', error: error.message }); }
    for (const [id, context] of this.contexts) if (context.auxData?.isDefault) await this.setupContext(id, context);
    await this.registerPresets();
    const initialURL = await this.cdp.evaluate('location.href');
    if (!this.tabs.active) this.tabs.create(initialURL);
    else this.tabs.commit(initialURL, '', true);
    this.navigation = { phase: 'complete', progress: 100, url: initialURL, error: '' };
    await this.status();
    return this;
  }
  async event({ method, params, sessionId }) {
    try {
      this.recorder?.note(method, params, sessionId);
      if (method === 'Target.attachedToTarget') {
        // Worker targets do not expose Fetch. Do not mistake that for a frame.
        if (['iframe', 'page'].includes(params.targetInfo?.type) && !isHumanVerification(params.targetInfo?.url)) {
          this.subframesAttached++;
          await this.cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, params.sessionId);
        }
      }
      if (method === 'Fetch.requestPaused') return await this.request(params, sessionId);
      if (method === 'Page.frameRequestedNavigation' && params.frameId === this.mainFrame && !sessionId) {
        this.requestedNavigation = { url: params.url, reason: params.reason };
      }
      if (method === 'Page.frameNavigated') {
        this.frames.set(params.frame.id, params.frame.url);
        if (!params.frame.parentId) {
          this.mainFrame = params.frame.id;
          this.genericSelectors = new Set();
          if (params.frame.url.includes('/wam/loaderror.html')) await this.navigationFailed('La página no pudo cargarse en la pantalla. Reintenta o prueba otra dirección.');
          else if (this.navigation.phase === 'loading') { this.navigation.url = params.frame.url; this.navigation.progress = 40; this.committedNavigation = this.navigationId; }
        }
      }
      if (method === 'Page.navigatedWithinDocument' && params.frameId === this.mainFrame) {
        this.frames.set(this.mainFrame, params.url);
        this.navigation.url = params.url; this.committedNavigation = this.navigationId;
        this.tabs.commit(params.url, '', this.restoringTab);
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
        if (params.response.status >= 400 && !isChallengeResponse(params.response)) await this.navigationFailed(`El sitio respondió con un error (${params.response.status}). Puedes reintentar o volver al inicio.`);
        else { this.navigation.progress = 60; await this.status(); }
      }
      if (method === 'Network.loadingFailed' && params.requestId === this.mainRequest && !params.canceled && !sessionId) {
        await this.navigationFailed(this.readableError(params.errorText));
      }
      if (method === 'Runtime.executionContextsCleared') { this.contexts.clear(); this.uiContexts.clear(); this.toolbarContext = null; this.mainContext = null; }
      if (method === 'Runtime.executionContextDestroyed') {
        this.contexts.delete(params.executionContextId); this.uiContexts.delete(params.executionContextId);
        if (this.mainContext === params.executionContextId) this.mainContext = null;
      }
      if (method === 'Runtime.executionContextCreated' && !sessionId) {
        const context = params.context;
        this.contexts.set(context.id, context);
        if (context.auxData?.isDefault && this.mainFrame) await this.setupContext(context.id, context);
      }
      if (method === 'Page.domContentEventFired') {
        // A slow ad iframe must not hold the page in "loading".
        await this.navigationFinished();
        if (this.enabled) this.refreshCosmetics().catch(() => {});
        // Next links within this site get CSS and scriptlets at document start.
        const current = this.frames.get(this.mainFrame);
        if (/^https?:/.test(current || '')) this.prepareDocument(current).catch(() => {});
      }
      if (method === 'Page.loadEventFired') await this.navigationFinished(true);
      if (method === 'Runtime.bindingCalled' && params.name === '__lgLabCommand' && this.uiContexts.has(params.executionContextId)) {
        const command = JSON.parse(params.payload);
        try { await this.command(command); }
        catch (error) {
          if (['navigate', 'home', 'reload', 'back', 'forward', 'settings'].includes(command.action)) await this.navigationFailed(error.message);
          else this.errors.push({ phase: command.action, error: error.message });
        }
      }
    } catch (error) {
      if (!/Cannot find context|Execution context was destroyed|Inspected target navigated|No frame with given id/.test(error.message)) {
        this.errors.push({ phase: method, error: error.message });
      }
    }
  }
  beginNavigation(url) {
    this.restoringTab = false;
    this.recovering = false;
    this.navigationId = (this.navigationId || 0) + 1;
    const id = this.navigationId;
    clearTimeout(this.navigationTimer);
    this.navigation = { phase: 'loading', progress: 12, url, error: '' };
    this.crashMemory.begin(url, target => target.startsWith(home) || target.startsWith(packagedHome));
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
    const finishingId = this.navigationId;
    const finishingTab = this.tabs.activeId;
    const content = await this.cdp.evaluate(`({url:location.href,ready:document.readyState,hasContent:!!document.body && (document.body.innerText.trim().length>1 || !!document.body.querySelector('img,video,canvas,svg,iframe'))})`).catch(() => null);
    if (!content || content.url === 'about:blank') return;
    // Events from the previous document may arrive while Page.navigate is pending.
    if (content.url !== this.navigation.url) return;
    if (this.committedNavigation !== this.navigationId) return;
    if (content.hasContent || content.url === home || content.url === packagedHome) {
      this.explicitNavigationURL = null;
      clearTimeout(this.navigationTimer);
      this.navigation = { phase: 'complete', progress: 100, url: content.url, error: '' };
      const title = await this.cdp.evaluate('document.title').catch(() => '');
      if (this.navigationId !== finishingId || this.tabs.activeId !== finishingTab) return;
      this.tabs.commit(content.url, typeof title === 'string' ? title : '', this.restoringTab);
      if (this.restoringTab) {
        const scroll = this.tabs.current.scroll;
        await this.cdp.evaluate(`window.scrollTo(0,${JSON.stringify(scroll)})`).catch(() => {});
        this.restoringTab = false;
        if (this.tabs.current.media) this.resumePlayback(this.tabs.current.media).catch(() => {});
      }
      await this.status();
    } else if (final) await this.navigationFailed('El sitio no mostró contenido. Reintenta o abre otra página.');
  }
  async request(params, sessionId) {
    const { requestId, request, resourceType, frameId } = params;
    const source = this.frames.get(frameId) || this.frames.get(this.mainFrame) || request.url;
    let result = { should_block: false };
    try {
      const web = /^https?:/.test(request.url) && !isHumanVerification(request.url);
      const mainDocument = resourceType === 'Document' && frameId === this.mainFrame && !sessionId;
      if (this.enabled && web) {
        result = checkRequest(this.engine, request.url, source, mainDocument ? 'document' : resourceType, request.method);
        // For an observed ad domain replacing the top page, use its regular
        // subdocument rules too, but only inside the scoped test site. Do not
        // apply script-type filters to arbitrary video hosts or typed addresses.
        if (mainDocument && /(^|\.)cuevana3c\.pro$/.test(new URL(source).hostname) && request.url !== this.explicitNavigationURL && !result.should_block) {
          result = checkRequest(this.engine, request.url, source, 'Document', request.method);
          // A click-to-play may ask a script to replace the movie's top page
          // with an unrelated advertiser. Do not block embedded Documents or
          // Media/XHR. Ordinary links and addresses from Luma remain usable.
          if (!result.should_block && /^(www\.)?cuevana3c\.pro$/.test(new URL(source).hostname) && !/(^|\.)cuevana3c\.pro$/.test(new URL(request.url).hostname) &&
              this.requestedNavigation?.url === request.url && this.requestedNavigation.reason === 'scriptInitiated') {
            result = { should_block: true, filter: { raw_line: 'Luma: salida automática de la página de reproducción' } };
          }
        }
      }
      const record = { url: request.url.split('?')[0], source: source.split('?')[0], type: resourceType, blocked: !!result.should_block, rule: result.filter?.raw_line || null, exception: result.exception?.raw_line || null, redirect: !!result.redirect };
      this.records.push(record);
      if (record.blocked) this.blocked++;
      if (this.records.length > 12000) this.records.splice(0, 2000);
      if (result.should_block && mainDocument) {
        // Abort a top navigation as a user cancellation. A synthetic 204 keeps
        // the page in Chromium but leaves this WAM's inspector stuck.
        this.blockedNavigations++;
        await this.cdp.call('Fetch.failRequest', { requestId, errorReason: 'Aborted' }, sessionId);
        clearTimeout(this.navigationTimer);
        this.navigation = { phase: 'complete', progress: 100, url: this.frames.get(this.mainFrame), error: '' };
        await this.status();
      } else if (result.should_block && result.redirect) {
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
  cosmeticResources(url) {
    const hostname = new URL(url).hostname;
    let resources = this.cosmeticCache.get(hostname);
    if (!resources) {
      resources = this.engine.urlCosmeticResources(url);
      this.cosmeticCache.set(hostname, resources);
      if (this.cosmeticCache.size > 64) this.cosmeticCache.delete(this.cosmeticCache.keys().next().value);
    }
    return resources;
  }
  documentSource(url, condition) {
    const resources = this.cosmeticResources(url);
    const learned = this.cleanerRules.selectorsFor(new URL(url).hostname);
    const css = [...resources.hide_selectors, ...learned].map(selector => `${selector}{display:none!important}`).join('\n');
    const parts = [];
    if (css) parts.push(`try{const sheet=new CSSStyleSheet();sheet.replaceSync(${JSON.stringify(css)});Object.defineProperty(window,'__lumaFilterSheet',{value:sheet,writable:true,configurable:true});document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet]}catch(e){}`);
    if (resources.injected_script) parts.push(`if(!window.__lumaScriptlets){Object.defineProperty(window,'__lumaScriptlets',{value:true});${scriptletSource(resources.injected_script)}\n}`);
    // The home shares its host with the lab fixtures; it never gets filters.
    return parts.length ? `if(${condition}&&location.href.indexOf(${JSON.stringify(home)})!==0){${parts.join('\n')}}` : null;
  }
  async registerPresets() {
    if (!this.enabled) return;
    for (const preset of PRESETS) {
      if (this.presetScripts.has(preset.key)) continue;
      const source = this.documentSource(preset.sample, `/${preset.pattern}/.test(location.hostname)`);
      if (source) this.presetScripts.set(preset.key, (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source })).identifier);
    }
  }
  // Must not run while a document request is paused: this WAM holds renderer
  // commands until the navigation commits, which would deadlock it.
  async prepareDocument(url) {
    let hostname;
    try { hostname = new URL(url).hostname; } catch { return; }
    if (!this.enabled || !/^https?:/.test(url) || url.startsWith(home) || PRESETS.some(preset => new RegExp(preset.pattern).test(hostname))) return;
    if (this.documentScripts.has(hostname)) {
      const entry = this.documentScripts.get(hostname);
      this.documentScripts.delete(hostname); this.documentScripts.set(hostname, entry);
      return;
    }
    this.documentScripts.set(hostname, null);
    const source = this.documentSource(url, `location.hostname===${JSON.stringify(hostname)}`);
    if (source) this.documentScripts.set(hostname, (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source })).identifier);
    while (this.documentScripts.size > 48) {
      const [oldest, old] = this.documentScripts.entries().next().value;
      this.documentScripts.delete(oldest);
      if (old) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: old }).catch(() => {});
    }
  }
  async clearDocumentScripts() {
    const identifiers = [...this.documentScripts.values(), ...this.presetScripts.values()].filter(Boolean);
    this.documentScripts.clear(); this.presetScripts.clear();
    await Promise.all(identifiers.map(identifier => this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {})));
  }
  async addGenericCosmetics({ classes = [], ids = [] } = {}) {
    const url = this.frames.get(this.mainFrame);
    if (!this.enabled || !this.mainContext || !/^https?:/.test(url || '') || url === home) return;
    const resources = this.cosmeticResources(url);
    if (resources.generichide) return;
    const selectors = this.engine.hiddenClassIdSelectors(classes.slice(0, 4000).map(String), ids.slice(0, 4000).map(String), resources.exceptions || [])
      .filter(selector => !this.genericSelectors.has(selector));
    if (!selectors.length) return;
    for (const selector of selectors) this.genericSelectors.add(selector);
    const rules = selectors.map(selector => `${selector}{display:none!important}`);
    await this.cdp.evaluate(`(()=>{const rules=${JSON.stringify(rules)};let sheet=window.__lumaFilterSheet;if(!sheet){sheet=new CSSStyleSheet();window.__lumaFilterSheet=sheet}if(!document.adoptedStyleSheets.includes(sheet))document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];for(const rule of rules){try{sheet.insertRule(rule,sheet.cssRules.length)}catch(e){}}})()`, this.mainContext);
  }
  // «Limpiar anuncios»: rescan every frame, ask the engine, hide what is clearly an ad.
  async cleanerFrames() {
    const { frameTree } = await this.cdp.call('Page.getFrameTree');
    const frames = [];
    const walk = node => { frames.push(node.frame); for (const child of node.childFrames || []) walk(child); };
    walk(frameTree);
    const limit = (promise, ms = 8000) => Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(Error('Tiempo agotado')), ms))]);
    const worlds = await Promise.allSettled(frames.filter(frame => /^https?:/.test(frame.url) && !frame.url.startsWith(home)).slice(0, 40).map(async frame => {
      const { executionContextId } = await limit(this.cdp.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: this.cleanerWorld }));
      return { frame, context: executionContextId, limit };
    }));
    return worlds.filter(world => world.status === 'fulfilled').map(world => world.value);
  }
  cleanAds() {
    this.cleaning ||= this.runCleaning().finally(() => { this.cleaning = null; });
    return this.cleaning;
  }
  async runCleaning() {
    const pageURL = this.frames.get(this.mainFrame) || '';
    let result;
    try {
      if (!/^https?:/.test(pageURL) || pageURL.startsWith(home)) throw Error('Abre una página web para limpiarla.');
      if (this.enabled) await this.refreshCosmetics().catch(() => {});
      const host = new URL(pageURL).hostname;
      const totals = { hidden: 0, overlays: 0, confirmed: 0, frames: 0 };
      const learned = [];
      await Promise.all((await this.cleanerFrames()).map(async ({ frame, context, limit }, index) => {
        const scan = await limit(this.cdp.evaluate(cleanerSource('scan', 'f' + index), context)).catch(() => null);
        if (!scan) return;
        totals.frames++;
        const decisions = decideCleaning(scan.candidates, (url, type) => checkRequest(this.engine, url, scan.url || frame.url, type).should_block);
        totals.confirmed += decisions.filter(decision => decision.confirmed).length;
        if (!decisions.length) return;
        const applied = await limit(this.cdp.evaluate(cleanerSource('apply', '', decisions), context)).catch(() => null);
        if (!applied) return;
        totals.hidden += applied.hidden; totals.overlays += applied.overlays;
        if (frame.id === this.mainFrame) learned.push(...applied.learned);
      }));
      const added = this.cleanerRules.add(host, learned);
      if (added.length) await this.applyCleanerRules(host, pageURL);
      this.lastCleaning = { host, url: pageURL };
      result = { ok: true, ...totals, learned: added.length, remembered: this.cleanerRules.selectorsFor(host).length };
    } catch (error) { result = { ok: false, error: error.message }; }
    await this.reportCleaning(result);
    return result;
  }
  // "Deshacer" restores the page and forgets what was learned for this site.
  async undoCleaning() {
    const pageURL = this.frames.get(this.mainFrame) || '';
    let restored = 0;
    for (const { context, limit } of await this.cleanerFrames()) {
      const result = await limit(this.cdp.evaluate(cleanerSource('undo', ''), context)).catch(() => null);
      restored += result?.restored || 0;
    }
    if (/^https?:/.test(pageURL)) {
      const host = new URL(pageURL).hostname;
      const learned = this.cleanerRules.selectorsFor(host);
      if (learned.length) { this.cleanerRules.remove(host, learned); await this.applyCleanerRules(host, pageURL); }
    }
    this.lastCleaning = null;
    await this.reportCleaning({ ok: true, undone: true, restored });
  }
  async applyCleanerRules(host, pageURL) {
    const css = this.cleanerRules.selectorsFor(host).map(selector => `${selector}{display:none!important}`).join('\n');
    if (this.mainContext) await this.cdp.evaluate(`(()=>{let sheet=window.__lumaCleanerSheet;if(!sheet){sheet=new CSSStyleSheet();window.__lumaCleanerSheet=sheet}sheet.replaceSync(${JSON.stringify(css)});if(!document.adoptedStyleSheets.includes(sheet))document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet]})()`, this.mainContext).catch(() => {});
    // Re-register this host's document-start CSS so the next visit arrives clean.
    const identifier = this.documentScripts.get(host);
    this.documentScripts.delete(host);
    if (identifier) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
    for (const preset of PRESETS) {
      if (!new RegExp(preset.pattern).test(host) || !this.presetScripts.has(preset.key)) continue;
      await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.presetScripts.get(preset.key) }).catch(() => {});
      this.presetScripts.delete(preset.key);
      await this.registerPresets();
    }
    await this.prepareDocument(pageURL).catch(() => {});
  }
  async reportCleaning(result) {
    if (this.toolbarContext) await this.cdp.evaluate(`window.__lumaCleanResult&&window.__lumaCleanResult(${JSON.stringify(result)})`, this.toolbarContext).catch(() => {});
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
      await this.cdp.evaluate(turnstileDeferSource, id).catch(() => {});
      await this.cdp.evaluate(devtoolsQuietSource, id).catch(() => {});
      if (this.enabled) await this.cdp.evaluate(navigationShieldSource, id);
      if (context.auxData.frameId === this.mainFrame) this.mainContext = id;
      await this.applyCosmetics(id, url, true);
      if (context.auxData.frameId === this.mainFrame && this.toolbar) await this.injectToolbar();
    }
  }
  async applyCosmetics(id, url, scriptlets = false) {
    if (!this.enabled) return;
    if (!/^https?:/.test(url)) return;
    const resources = this.cosmeticResources(url);
    // Apply scriptlets before a DOM scan; their timing matters for popunders.
    if (scriptlets && resources.injected_script) await this.cdp.evaluate(`if(!window.__lumaScriptlets){Object.defineProperty(window,'__lumaScriptlets',{value:true});${scriptletSource(resources.injected_script)}\n}`, id);
    const dynamic = await this.cdp.evaluate(`(() => { const nodes=[...document.querySelectorAll('[class],[id]')].slice(0,5000);return {classes:[...new Set(nodes.flatMap(n=>[...n.classList]))],ids:nodes.map(n=>n.id).filter(Boolean)} })()`, id);
    const selectors = [...resources.hide_selectors];
    if (!resources.generichide) {
      const generic = this.engine.hiddenClassIdSelectors(dynamic.classes, dynamic.ids, resources.exceptions || []);
      if (id === this.mainContext) { for (const selector of generic) this.genericSelectors.add(selector); selectors.push(...this.genericSelectors); }
      else selectors.push(...generic);
    }
    if (selectors.length) {
      const css = selectors.map(selector => `${selector}{display:none!important}`).join('\n');
      await this.cdp.evaluate(`(() => {const css=${JSON.stringify(css)};const apply=()=>{if(!document.documentElement)return false;const sheet=window.__lumaFilterSheet||new CSSStyleSheet();sheet.replaceSync(css);if(!document.adoptedStyleSheets.includes(sheet))document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.__lumaFilterSheet=sheet;return true};if(!apply()){const observer=new MutationObserver(()=>{if(apply())observer.disconnect()});observer.observe(document,{childList:true,subtree:true})}})()`, id);
    }
  }
  async refreshCosmetics() {
    await Promise.all([...this.contexts].filter(([, context]) => context.auxData?.isDefault).map(async ([id]) => {
      try { const url = await this.cdp.evaluate('location.href', id); if (/^https?:/.test(url)) await this.applyCosmetics(id, url); }
      catch { /* A navigation may have replaced this frame. */ }
    }));
    await this.status();
  }
  async injectToolbar() {
    const { executionContextId: id } = await this.cdp.call('Page.createIsolatedWorld', { frameId: this.mainFrame, worldName: this.toolbarWorld });
    this.uiContexts.add(id);
    this.toolbarContext = id;
    await this.cdp.evaluate(toolbarSource({ ...this.navigation, debug: this.debug }, [home, packagedHome], this.preferences.searchEngine), id);
    await this.status();
  }
  statusPayload() {
    const current = this.frames.get(this.mainFrame) || this.navigation.url;
    return {
      connected: true, debug: this.debug, blocked: this.blocked, enabled: this.enabled, navigation: this.navigation,
      ...this.tabs.snapshot(),
      searchEngine: this.preferences.searchEngine, showSettings: this.showSettings,
      favorites: this.preferences.favorites, categories: this.preferences.categories, riskySites: this.crashMemory.riskyHosts(),
      favorite: this.preferences.isFavorite(current), favoriteCategories: this.preferences.categoriesOf(current),
      message: this.enabled ? 'Motor de Brave activo desde tu Mac.' : 'Protección en pausa. Recarga la página para comparar.'
    };
  }
  async status() {
    if (!this.uiContexts.size) return;
    const payload = JSON.stringify(this.statusPayload());
    await Promise.all([...this.uiContexts].map(id => this.cdp.evaluate(`(() => {const status=${payload};if(window.__lumaUpdate)window.__lumaUpdate(status);else window.dispatchEvent(new CustomEvent('lg-lab-status',{detail:status}))})()`, id).catch(() => {})));
  }
  async setProtection(enabled) {
    this.enabled = enabled;
    if (this.navigationGuardScript) { await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.navigationGuardScript }); this.navigationGuardScript = null; }
    if (enabled) this.navigationGuardScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: navigationShieldSource })).identifier;
    // Pages opened while paused must not receive CSS or scriptlets at document start.
    if (!enabled) await this.clearDocumentScripts();
    else await this.registerPresets();
    await this.status();
  }
  async command({ action, value }) {
    if (['new-tab', 'select-tab', 'close-tab'].includes(action)) {
      const operation = this.tabQueue.catch(() => {}).then(() => this.tabCommand(action, String(value ?? '')));
      this.tabQueue = operation;
      return operation;
    }
    if (action === 'navigate') {
      this.navigation.url = String(value ?? '').trim();
      const url = new URL(resolveNavigation(value, this.preferences.searchEngine));
      this.explicitNavigationURL = url.href;
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Solo navegación HTTP(S), sin credenciales en la URL.');
      await this.prepareDocument(url.href);
      this.beginNavigation(url.href);
      const navigationId = this.navigationId;
      await this.status();
      const result = await this.cdp.call('Page.navigate', { url: url.href });
      if (result.errorText && this.navigationId === navigationId) await this.navigationFailed(this.readableError(result.errorText));
    } else if (action === 'cosmetic') {
      await this.addGenericCosmetics(value);
    } else if (action === 'clean-ads') {
      await this.cleanAds();
    } else if (action === 'clean-undo') {
      await this.undoCleaning();
    } else if (action === 'set-search-engine') {
      this.preferences.setSearchEngine(value);
      await this.status();
    } else if (action === 'favorite') {
      this.preferences.toggleFavorite(value?.url, value?.title, value?.category);
      await this.status();
    } else if (action === 'add-bookmark') {
      this.preferences.addBookmark(value?.url, value?.title, value?.category);
      await this.status();
    } else if (action === 'remove-favorite') {
      // A string removes the address everywhere; an object only from one category.
      if (value && typeof value === 'object') this.preferences.removeFavorite(value.url, value.category);
      else this.preferences.removeFavorite(value);
      await this.status();
    } else if (action === 'add-category') {
      this.preferences.addCategory(value);
      await this.status();
    } else if (action === 'rename-category') {
      this.preferences.renameCategory(value?.from, value?.to);
      await this.status();
    } else if (action === 'remove-category') {
      this.preferences.removeCategory(value);
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
      // Like Safari: stop loading and keep whatever already arrived.
      this.navigationId = (this.navigationId || 0) + 1;
      this.mainRequest = null;
      clearTimeout(this.navigationTimer);
      await this.cdp.call('Page.stopLoading');
      this.navigation = { ...this.navigation, phase: 'complete', progress: 100, error: '' };
      await this.status();
    } else if (action === 'reload') {
      const current = await this.cdp.evaluate('location.href');
      await this.prepareDocument(current);
      this.beginNavigation(current);
      await this.status(); await this.cdp.call('Page.reload');
    }
    else if (['back', 'forward'].includes(action)) {
      if (this.tabs.managed || this.tabs.items.length > 1 || this.tabs.active?.entries.length > 1) {
        await this.rememberTab();
        const entry = this.tabs.move(action === 'back' ? -1 : 1);
        if (entry) await this.restoreTab();
        else if (action === 'back' && ![home, packagedHome].includes(this.tabs.current.url)) await this.command({ action: 'home' });
        return;
      }
      const history = await this.cdp.call('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex + (action === 'back' ? -1 : 1)];
      if (entry) { await this.prepareDocument(entry.url); this.beginNavigation(entry.url); await this.status(); await this.cdp.call('Page.navigateToHistoryEntry', { entryId: entry.id }); }
      else if (action === 'back' && ![home, packagedHome].includes(history.entries[history.currentIndex]?.url)) await this.command({ action: 'home' });
    } else if (action === 'toggle') await this.setProtection(!this.enabled);
    else if (action === 'set-protection') await this.setProtection(value !== false);
  }
  // Documents and iframes of the page (players usually live in a cross-origin iframe).
  pageContexts() {
    return [...this.contexts].filter(([id, context]) => context.auxData?.isDefault && !this.uiContexts.has(id)).map(([id]) => id);
  }
  async playbackState() {
    const expression = `(()=>{let best=null;for(const v of document.querySelectorAll('video')){if(!(v.currentTime>3)||!isFinite(v.duration)||v.duration<=v.currentTime+1)continue;if(!best||v.duration>best.duration)best=v}return best?{t:best.currentTime,playing:!best.paused&&!best.ended}:null})()`;
    const states = await Promise.all(this.pageContexts().map(id => this.cdp.evaluate(expression, id).catch(() => null)));
    return states.find(state => state && typeof state === 'object' && Number.isFinite(state.t)) || null;
  }
  // After a tab reloads, put its video back at the saved second. Players start late
  // and some wait for a click, so keep trying while the user stays on this tab.
  async resumePlayback(media) {
    const token = this.resumeToken = (this.resumeToken || 0) + 1;
    const tab = this.tabs.activeId;
    const entry = this.tabs.current;
    const expression = `(()=>{for(const v of document.querySelectorAll('video')){if(v.readyState>0&&isFinite(v.duration)&&v.duration>${media.t}+1){if(v.currentTime<${media.t}-5){v.currentTime=${media.t};${media.playing ? 'v.play().catch(()=>{});' : ''}}return true}}return false})()`;
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.resumeToken !== token || this.tabs.activeId !== tab || this.tabs.current !== entry) return;
      for (const id of this.pageContexts()) if (await this.cdp.evaluate(expression, id).catch(() => false) === true) return;
    }
  }
  async rememberTab() {
    const view = await this.cdp.evaluate('({url:location.href,title:document.title,scroll:window.scrollY})').catch(() => null);
    if (view && typeof view.url === 'string') {
      // A rapid second tab click can arrive before the first destination loads.
      if ((this.restoringTab || this.navigation.phase === 'loading') && view.url !== this.navigation.url) return;
      this.tabs.commit(view.url, view.title, this.restoringTab);
      this.tabs.remember(view.scroll, view.title, /^https?:/.test(view.url) ? await this.playbackState() : null);
    }
  }
  async restoreTab() {
    const savedURL = this.tabs.current.url;
    // WAM refuses file:// after a remote page. A suspended packaged Inicio
    // must return through the served home, just like the Home button.
    const url = /^https?:/.test(savedURL) ? savedURL : home;
    this.explicitNavigationURL = url;
    this.showSettings = false;
    await this.cdp.call('Page.stopLoading').catch(() => {});
    if (/^https?:/.test(url)) await this.prepareDocument(url);
    this.beginNavigation(url);
    this.restoringTab = true;
    await this.status();
    const result = await this.cdp.call('Page.navigate', { url });
    if (result.errorText) await this.navigationFailed(this.readableError(result.errorText));
  }
  async tabCommand(action, id) {
    if (action === 'select-tab' && this.tabs.activeId === id) return;
    if (action === 'close-tab' && !this.tabs.items.some(tab => tab.id === id)) return;
    if (action === 'new-tab' && this.tabs.items.length >= this.tabs.limit) return;
    this.tabs.managed = true;
    if (this.navigation.phase === 'loading' && !this.restoringTab && /^https?:/.test(this.navigation.url)) {
      this.tabs.commit(this.navigation.url);
    }
    await this.rememberTab();
    if (action === 'new-tab') this.tabs.create();
    else if (action === 'select-tab') this.tabs.select(id);
    else if (!this.tabs.close(id)) { await this.status(); return; }
    await this.restoreTab();
  }
  async stop() {
    clearInterval(this.heapTimer);
    clearTimeout(this.navigationTimer);
    this.stopped = true; this.crashMemory.stop();
    this.unsubscribe?.();
    await this.cdp.call('Fetch.disable').catch(() => {});
    if (this.toolbarScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.toolbarScript }).catch(() => {});
    if (this.navigationGuardScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.navigationGuardScript }).catch(() => {});
    if (this.turnstileScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.turnstileScript }).catch(() => {});
    if (this.quietScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.quietScript }).catch(() => {});
    await this.clearDocumentScripts();
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
