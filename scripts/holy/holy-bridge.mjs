import { BrowserBridge, home, packagedHome } from '../browser-bridge.mjs';
import { origin } from './config.mjs';
import { entryKey } from './library.mjs';
import { curtainSource, remoteSource, autoplaySource, theaterSource, seekSource } from './page-scripts.mjs';

// Luma's engine (filters, guards, navigation) plus Holy's playback: a title is
// opened at the player its site would show, started automatically behind a
// curtain, and its position is remembered for «Continuar viendo».
const START_TIMEOUT = 45000;
// A server that shows nothing playable this long is swapped for the title's next one.
const SERVER_TIMEOUT = 28000;
const SAVE_EVERY = 10000;

export class HolyBridge extends BrowserBridge {
  constructor(cdp, options = {}) {
    super(cdp, { ...options, toolbar: false });
    this.catalog = options.catalog;
    this.library = options.library;
    this.apiBase = options.apiBase || origin();
    this.mute = options.mute === true;
    this.serverTimeout = options.serverTimeout || SERVER_TIMEOUT;
    this.startTimeout = options.startTimeout || START_TIMEOUT;
    this.stallTimeout = options.stallTimeout || 20000;
    this.remoteContexts = new Set();
    // Cross-origin player iframes may run as their own targets (sessions).
    this.childSessions = new Map();
    this.session = null;
  }
  async start() {
    await super.start();
    this.remoteScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: remoteSource([home, packagedHome]), worldName: this.toolbarWorld })).identifier;
    this.watchTimer = setInterval(() => this.watch().catch(error => this.errors.push({ phase: 'watch', error: error.message })), 1000);
    this.watchTimer.unref?.();
    return this;
  }
  async event(message) {
    const { method, params, sessionId } = message;
    if (method === 'Runtime.executionContextCreated' && !sessionId && params.context.name === this.toolbarWorld) this.remoteContexts.add(params.context.id);
    if (method === 'Runtime.executionContextDestroyed') this.remoteContexts.delete(params.executionContextId);
    if (method === 'Runtime.executionContextsCleared' && !sessionId) this.remoteContexts.clear();
    if (method === 'Target.attachedToTarget' && ['iframe', 'page'].includes(params.targetInfo?.type)) this.childSessions.set(params.sessionId, { enabled: false, contexts: new Set() });
    if (method === 'Target.detachedFromTarget') this.childSessions.delete(params.sessionId);
    const child = sessionId && this.childSessions.get(sessionId);
    if (child) {
      if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) child.contexts.add(params.context.id);
      if (method === 'Runtime.executionContextDestroyed') child.contexts.delete(params.executionContextId);
      if (method === 'Runtime.executionContextsCleared') child.contexts.clear();
    }
    // Child-session context ids are their own numbering: never let them clear the main page's.
    if (sessionId && method.startsWith('Runtime.')) return;
    // Player pages may only ask to go back; everything else needs Holy's own home.
    if (method === 'Runtime.bindingCalled' && params.name === '__lgLabCommand' && !this.uiContexts.has(params.executionContextId)) {
      if (!this.remoteContexts.has(params.executionContextId)) return;
      let command = null;
      try { command = JSON.parse(params.payload); } catch { return; }
      if (command?.action === 'back') await this.command({ action: 'back' }).catch(error => this.errors.push({ phase: 'back', error: error.message }));
      return;
    }
    return super.event(message);
  }
  // Holy's own home (served by this Mac) is never filtered: uBlock's LAN rules
  // would otherwise stop a player page from returning to a local address.
  async request(params, sessionId) {
    if (params.resourceType === 'Document' && params.request.url.startsWith(home)) {
      await this.cdp.call('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {});
      return;
    }
    return super.request(params, sessionId);
  }
  statusPayload() {
    const session = this.session && { phase: this.session.phase, title: this.session.item.title, error: this.session.error || '' };
    return { ...super.statusPayload(), holy: { apiBase: this.apiBase, catalogVersion: this.catalog?.version || 0, libraryVersion: this.library?.version || 0, refreshing: !!this.catalog?.refreshing, session } };
  }
  async command(command) {
    const { action, value } = command;
    if (action === 'play') return this.play(value);
    if (action === 'refresh-catalog') { this.catalog.refresh().then(() => this.status()).catch(() => {}); return this.status(); }
    if (action === 'forget') { this.library.remove(String(value ?? '')); return this.status(); }
    // Holy has no tabs or page history: Back from any player goes home, and on the home it does nothing.
    if (action === 'back' || action === 'forward') {
      const current = this.frames.get(this.mainFrame) || '';
      const onHome = current.startsWith(home) || current === packagedHome;
      if (action === 'forward' || (onHome && !this.session)) return;
      command = { action: 'home' };
    }
    if (command.action === 'home') {
      await this.endSession();
      return super.command({ action: 'home' });
    }
    return super.command(command);
  }
  // value: a catalogue item, or a «Continuar viendo» entry (same shape).
  async play(value) {
    if (!value || typeof value !== 'object' || !/^https:\/\//.test(String(value.url || ''))) throw Error('Ese título no tiene una dirección válida.');
    await this.endSession();
    const known = this.catalog?.find(value.url);
    const previous = this.library.get(entryKey(value));
    const item = { ...(previous || {}), ...(known || {}), ...value, genres: known?.genres?.length ? known.genres : value.genres || previous?.genres || [] };
    const token = (this.sessionToken || 0) + 1;
    this.sessionToken = token;
    const session = this.session = { token, item, key: entryKey(item), phase: 'resolving', started: Date.now(), resumeAt: this.library.resumeAt(item), lastSave: 0 };
    // The curtain is registered before navigating so it covers the site's first paint.
    this.curtainScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', {
      source: curtainSource({ title: item.title, subtitle: item.subtitle || (item.year ? String(item.year) : ''), backdrop: item.backdrop || item.poster || '', message: session.resumeAt ? 'Volviendo a donde te quedaste…' : 'Preparando el vídeo…' }),
      worldName: this.toolbarWorld
    })).identifier;
    await this.status();
    let target = null;
    try { target = await this.catalog.resolve(item); } catch (error) { session.resolveError = error; }
    if (this.session !== session) return;
    if (!target && (session.resolveError?.unsafe || this.catalog.pageFallback?.(item) === false)) {
      // Refuse rather than open a page known to close the app.
      session.phase = 'failed';
      session.error = session.resolveError?.message || 'No se encontró un reproductor seguro para este título.';
      await this.dropCurtainScript();
      await this.status();
      return;
    }
    // Without a resolved player, open the title's page: the autoplay step finds the player there.
    target ||= { url: item.url };
    this.library.start(item);
    session.queue = [...(target.alternatives || [])];
    session.referrer = target.referrer;
    session.servers = 1;
    await this.openServer(session, target.url);
  }
  async openServer(session, url) {
    session.phase = 'opening'; session.opened = Date.now(); session.target = url; session.position = null;
    await this.prepareDocument(url);
    this.explicitNavigationURL = url;
    this.beginNavigation(url);
    await this.status();
    const result = await this.cdp.call('Page.navigate', { url, ...(session.referrer ? { referrer: session.referrer } : {}) }).catch(error => ({ errorText: error.message }));
    if (result.errorText && this.session === session) {
      if (session.queue?.length) return this.nextServer(session);
      session.phase = 'failed'; await this.navigationFailed(this.readableError(result.errorText));
    }
  }
  // The title's next server, behind the same curtain.
  async nextServer(session) {
    const url = session.queue.shift();
    session.servers++;
    // After a start the curtain script was dropped: cover the next server's page again.
    if (!this.curtainScript) {
      const item = session.item;
      this.curtainScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: curtainSource({ title: item.title, subtitle: item.subtitle || '', backdrop: item.backdrop || item.poster || '', message: 'Probando otro servidor…' }), worldName: this.toolbarWorld }).catch(() => ({})))?.identifier || null;
    }
    await this.curtain(`window.__holyCurtain&&__holyCurtain.say(${JSON.stringify('Probando otro servidor (' + session.servers + ')…')})`);
    await this.openServer(session, url);
  }
  async evaluateWithGesture(expression, contextId, sessionId) {
    const result = await this.cdp.call('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text || 'evaluate');
    return result.result?.value;
  }
  // Every frame of the page: main-target contexts plus player iframes in their own sessions.
  // Child sessions are only inspected during playback, and enabled lazily.
  async playerContexts() {
    for (const [sessionId, child] of this.childSessions) {
      if (child.enabled) continue;
      child.enabled = true;
      await this.cdp.call('Runtime.enable', {}, sessionId).catch(() => this.childSessions.delete(sessionId));
      await this.cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    }
    return [...this.pageContexts().map(id => ({ id })), ...[...this.childSessions].flatMap(([sessionId, entry]) => [...entry.contexts].map(id => ({ id, sessionId })))];
  }
  // Every second during a session: start the player, then save the position.
  async watch() {
    const session = this.session;
    if (!session || this.watching || !['opening', 'playing', 'manual'].includes(session.phase)) return;
    if (this.navigation.phase === 'error') {
      if (session.phase === 'opening' && session.queue?.length) { await this.nextServer(session); return; }
      await this.endSession(); await this.status(); return;
    }
    if (session.phase === 'opening' && session.queue?.length && Date.now() - session.opened > this.serverTimeout && !session.position) { await this.nextServer(session); return; }
    if (this.navigation.phase === 'loading' && session.phase === 'opening' && Date.now() - session.opened < 4000) return;
    const page = this.frames.get(this.mainFrame) || '';
    if (!/^https?:/.test(page) || page.startsWith(home)) return;
    this.watching = true;
    try {
      const passive = session.phase !== 'opening';
      const results = (await Promise.all((await this.playerContexts()).map(({ id, sessionId }) => Promise.race([
        this.evaluateWithGesture(autoplaySource({ passive, mute: this.mute }), id, sessionId).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 2500, null))
      ])))).filter(Boolean);
      if (this.session !== session) return;
      session.frames = results.map(frame => ({ url: frame.url.split('?')[0], top: frame.top, videos: frame.videos.length, action: frame.action })).slice(0, 12);
      const videos = results.flatMap(frame => frame.videos).filter(video => video.d > 60);
      const playing = videos.filter(video => !video.paused && video.t > 0).sort((a, b) => b.d - a.d)[0];
      if (playing && session.phase !== 'playing') await this.started(session);
      // A server that starts but never gets past its first seconds (still «playing») is
      // stalled: swap it for the next one. A paused video is the owner's choice and stays.
      if (playing && session.queue?.length && playing.t < 15) {
        const stall = session.stall;
        if (!stall || playing.t > stall.t + 0.5) session.stall = { t: playing.t, since: Date.now() };
        else if (Date.now() - stall.since > this.stallTimeout) { session.stall = null; await this.nextServer(session); return; }
      }
      const best = playing || (session.phase === 'playing' ? videos.sort((a, b) => b.d - a.d)[0] : null);
      if (best && Date.now() - session.lastSave > SAVE_EVERY) {
        session.lastSave = Date.now();
        this.library.progress(session.key, session.item.url, best.t, best.d);
      }
      session.position = best ? { t: best.t, d: best.d } : session.position;
      if (session.phase === 'opening' && Date.now() - session.opened > this.startTimeout) {
        // Leave the page usable: the owner can pick another server with the remote.
        session.phase = 'manual'; session.error = 'No se pudo iniciar solo';
        await this.curtain(`window.__holyCurtain&&(__holyCurtain.say('No arrancó solo. Elige un servidor con el control.'),setTimeout(()=>__holyCurtain.hide(),2500))`);
        await this.dropCurtainScript();
        await this.status();
      }
    } finally { this.watching = false; }
  }
  async started(session) {
    session.phase = 'playing'; session.playingAt = Date.now();
    await this.dropCurtainScript();
    if (this.mainContext) await this.cdp.evaluate(theaterSource, this.mainContext).catch(() => false);
    if (session.resumeAt > 20) {
      for (const { id, sessionId } of await this.playerContexts()) if (await this.evaluateWithGesture(seekSource(session.resumeAt), id, sessionId).catch(() => false) === true) break;
    }
    await this.curtain('window.__holyCurtain&&__holyCurtain.hide()');
    await this.status();
  }
  async curtain(expression) {
    await Promise.all([...this.remoteContexts].map(id => this.cdp.evaluate(expression, id).catch(() => {})));
  }
  async dropCurtainScript() {
    const identifier = this.curtainScript;
    this.curtainScript = null;
    if (identifier) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
  // Saves the last position before leaving the player.
  async endSession() {
    const session = this.session;
    this.session = null;
    await this.dropCurtainScript();
    if (!session) return;
    if (session.position && session.phase === 'playing') this.library.progress(session.key, session.item.url, session.position.t, session.position.d);
  }
  async stop() {
    clearInterval(this.watchTimer);
    await this.endSession().catch(() => {});
    if (this.remoteScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.remoteScript }).catch(() => {});
    await super.stop();
  }
}
