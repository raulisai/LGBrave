import { BrowserBridge, home, packagedHome } from '../browser-bridge.mjs';
import { origin } from './config.mjs';
import { entryKey } from './library.mjs';
import { PREFERRED } from './catalog.mjs';
import { curtainSource, remoteSource, autoplaySource, theaterSource, seekSource, heartbeatSource, endCardSource, cardFlagSource } from './page-scripts.mjs';

// Luma's engine (filters, guards, navigation) plus Holy's playback: a title is
// opened at the player its site would show, started automatically behind a
// curtain, and its position is remembered for «Continuar viendo».
const START_TIMEOUT = 45000;
// A server that shows nothing playable this long is swapped for the title's next one.
const SERVER_TIMEOUT = 28000;
const SAVE_EVERY = 10000;
// A video that stops advancing this long in the middle (not paused by the owner) is moved to
// another server or site, at the same second; at most MAX_RESCUES times per title.
const MID_STALL = 25000;
const MAX_RESCUES = 3;
// The end card appears this close to the end; the next episode starts after NEXT_DELAY.
const END_MARGIN = 4;
// A stream whose last piece never loads stops just short of the end: stuck this long within
// its last 30 s (and not paused by the owner) counts as finished.
const END_STALL = 6000;
const NEXT_DELAY = 6000;

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
    this.nextDelay = options.nextDelay || NEXT_DELAY;
    this.endStall = options.endStall || END_STALL;
    this.midStall = options.midStall || MID_STALL;
    this.remoteContexts = new Set();
    // Cross-origin player iframes may run as their own targets (sessions).
    this.childSessions = new Map();
    this.session = null;
  }
  async start() {
    await super.start();
    this.remoteScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: remoteSource([home, packagedHome], home, this.toolbarWorld), worldName: this.toolbarWorld })).identifier;
    // The page already open (e.g. a film when the Mac reconnects) gets the Back handler too.
    await this.armCurrentPage().catch(() => {});
    this.watchTimer = setInterval(() => this.watch().catch(error => this.errors.push({ phase: 'watch', error: error.message })), 1000);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 2000);
    this.heartbeatTimer.unref?.();
    this.heartbeat();
    this.watchTimer.unref?.();
    return this;
  }
  async armCurrentPage() {
    const { frameTree } = await this.cdp.call('Page.getFrameTree');
    const frames = [];
    const walk = node => { frames.push(node.frame); for (const child of node.childFrames || []) walk(child); };
    walk(frameTree);
    for (const frame of frames.slice(0, 20)) {
      if (!/^https?:/.test(frame.url) || frame.url.startsWith(home)) continue;
      const world = await this.cdp.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: this.toolbarWorld }).catch(() => null);
      if (!world?.executionContextId) continue;
      this.remoteContexts.add(world.executionContextId);
      await this.cdp.evaluate(remoteSource([home, packagedHome], home, this.toolbarWorld) + ';' + heartbeatSource(this.toolbarWorld), world.executionContextId).catch(() => {});
    }
  }
  // Tells each page's Back handler that this connection is alive.
  heartbeat() {
    for (const id of this.remoteContexts) this.cdp.evaluate(heartbeatSource(this.toolbarWorld), id).catch(() => this.remoteContexts.delete(id));
  }
  async event(message) {
    const { method, params, sessionId } = message;
    if (method === 'Runtime.executionContextCreated' && !sessionId && params.context.name === this.toolbarWorld) {
      this.remoteContexts.add(params.context.id);
      this.cdp.evaluate(heartbeatSource(this.toolbarWorld), params.context.id).catch(() => {});
    }
    // Back on a page may also reach the home on its own: close the playback session there.
    if (method === 'Page.frameNavigated' && !sessionId && !params.frame.parentId && this.session && this.session.phase !== 'resolving' &&
        (params.frame.url.startsWith(home) || params.frame.url.startsWith(packagedHome))) {
      await this.endSession().catch(() => {});
    }
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
      if (command?.action === 'card') await this.cardInput(command).catch(error => this.errors.push({ phase: 'card', error: error.message }));
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
    const session = this.session && { phase: this.session.phase, title: this.session.item.title, error: this.session.error || '', site: this.session.site || '' };
    return { ...super.statusPayload(), holy: { apiBase: this.apiBase, catalogVersion: this.catalog?.version || 0, libraryVersion: this.library?.version || 0, refreshing: !!this.catalog?.refreshing, session } };
  }
  async command(command) {
    const { action, value } = command;
    if (action === 'play') return this.play(value);
    if (action === 'prepare') { this.prepare(value); return; }
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
  // The owner rests on a card: find its player now (JKAnime copy first for anime), so OK
  // opens it at once. Runs in the background, one at a time, never for the same title twice
  // in a minute, and never during playback.
  prepare(value) {
    if (!value || typeof value !== 'object' || value.isShow || !/^https:\/\//.test(String(value.url || '')) || !this.catalog?.resolve) return;
    if (this.session || this.preparing) return;
    this.prepared ||= new Map();
    if (Date.now() - (this.prepared.get(value.url) || 0) < 60000) return;
    this.prepared.set(value.url, Date.now());
    if (this.prepared.size > 50) this.prepared.delete(this.prepared.keys().next().value);
    this.preparing = (async () => {
      const preference = this.catalog.preference ? await this.catalog.preference(value).catch(() => null) : null;
      if (preference?.site && value.source !== preference.site && this.catalog.elsewhere) {
        const copies = await this.catalog.elsewhere(value, new Set([value.source]), { only: preference.site, kind: preference.kind }).catch(() => []);
        if (copies[0] && await this.catalog.resolve(copies[0]).catch(() => null)) return;
      }
      await this.catalog.resolve(value).catch(() => null);
    })().finally(() => { this.preparing = null; });
  }
  // value: a catalogue item, or a «Continuar viendo» entry (same shape).
  async play(value) {
    if (!value || typeof value !== 'object' || !/^https:\/\//.test(String(value.url || ''))) throw Error('Ese título no tiene una dirección válida.');
    // A whole series opens its episode list on the TV; only episodes and films are played.
    if (value.isShow) throw Error('Elige un episodio de la serie.');
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
    session.tried = new Set([item.source]);
    let target = null;
    // Anime: the same episode on JKAnime first (the owner's choice), also anime a site lists as a series;
    // the picked site stays as the next option.
    const preference = this.catalog.preference ? await this.catalog.preference(item).catch(() => null) : PREFERRED[item.kind] ? { site: PREFERRED[item.kind], kind: item.kind } : null;
    const preferred = preference?.site;
    if (this.session !== session) return;
    if (preferred && item.source !== preferred && this.catalog.elsewhere) {
      session.tried = new Set([preferred]);
      session.candidates = [];
      await this.curtain(`window.__holyCurtain&&__holyCurtain.say('Buscando en JKAnime…')`);
      const copies = await this.catalog.elsewhere(item, new Set([item.source]), { only: preferred, kind: preference.kind }).catch(() => []);
      for (const copy of copies.slice(0, 2)) {
        target = await this.catalog.resolve(copy).catch(() => null);
        if (target) { session.item = { ...copy, title: item.title, poster: item.poster || copy.poster, backdrop: item.backdrop || copy.backdrop, genres: item.genres?.length ? item.genres : copy.genres }; session.site = this.catalog.connector?.(preferred)?.name || preferred; break; }
      }
      if (this.session !== session) return;
      // The picked copy is the next choice if JKAnime fails, then the other sites.
      session.candidates = [item];
    }
    if (!target) {
      if (preferred && item.source !== preferred) { session.candidates = []; session.tried.add(item.source); }
      try { target = await this.catalog.resolve(item); } catch (error) { session.resolveError = error; }
    }
    if (this.session !== session) return;
    // No player on its own site: the same title on another of the owner's sites.
    if (!target) target = await this.findElsewhere(session);
    if (this.session !== session) return;
    if (!target && !session.resolveError?.unsafe && this.catalog.pageFallback?.(item)) target = { url: item.url };
    if (!target) {
      // Refuse rather than open a page known to close the app.
      session.phase = 'failed';
      session.error = session.resolveError?.message || 'No se encontró un reproductor para este título en tus sitios.';
      await this.dropCurtainScript();
      await this.status();
      return;
    }
    await this.openTarget(session, target);
  }
  async openTarget(session, target) {
    this.library.start(session.item);
    session.key = entryKey(session.item);
    // After a rescue the second comes from the stalled server, whatever site plays next.
    session.resumeAt = session.forceResume || this.library.resumeAt(session.item);
    session.queue = [...(target.alternatives || [])];
    session.referrer = target.referrer;
    session.servers = (session.servers || 0) + 1;
    await this.openServer(session, target.url);
  }
  // Next site with the same title that resolves to a player; null when none is left.
  async findElsewhere(session) {
    if (!this.catalog.elsewhere) return null;
    const more = async () => {
      session.searched = true;
      await this.curtain(`window.__holyCurtain&&__holyCurtain.say('Buscando este título en tus otros sitios…')`);
      session.candidates = [...(session.candidates || []), ...await this.catalog.elsewhere(session.item, session.tried).catch(() => [])];
    };
    if (!session.candidates?.length && !session.searched) await more();
    while (this.session === session) {
      if (!session.candidates.length) { if (session.searched) break; await more(); continue; }
      const candidate = session.candidates.shift();
      if (session.tried.has(candidate.source)) continue;
      session.tried.add(candidate.source);
      const name = this.catalog.connector?.(candidate.source)?.name || candidate.source;
      await this.curtain(`window.__holyCurtain&&__holyCurtain.say(${JSON.stringify('Probando en ' + name + '…')})`);
      const target = await this.catalog.resolve(candidate).catch(() => null);
      if (target) {
        // Keep the owner's title and artwork; play the other site's copy.
        session.item = { ...candidate, title: session.item.title || candidate.title, poster: session.item.poster || candidate.poster, backdrop: session.item.backdrop || candidate.backdrop, genres: session.item.genres?.length ? session.item.genres : candidate.genres };
        session.site = name;
        return target;
      }
    }
    return null;
  }
  // Every server of this copy failed: another site, else give up.
  async nextSite(session) {
    if (!this.curtainScript) {
      const item = session.item;
      this.curtainScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: curtainSource({ title: item.title, subtitle: item.subtitle || '', backdrop: item.backdrop || item.poster || '', message: 'Buscando en otro sitio…' }), worldName: this.toolbarWorld }).catch(() => ({})))?.identifier || null;
    }
    const target = await this.findElsewhere(session);
    if (!target || this.session !== session) return false;
    await this.openTarget(session, target);
    return true;
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
      if (await this.nextSite(session)) return;
      session.phase = 'failed'; await this.navigationFailed(this.readableError(result.errorText));
    }
  }
  // The title's next server, behind the same curtain.
  async nextServer(session) {
    // That player failed: the next time this title is opened, ask its site again.
    if (session.item?.url) this.catalog.forgetPlayer?.(session.item.url);
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
      if (session.phase === 'opening' && await this.nextSite(session)) return;
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
      if (session.phase === 'playing' && best) {
        const tail = !best.paused && best.d - best.t <= 30;
        if (!tail) session.endStall = null;
        else if (!session.endStall || best.t > session.endStall.t + 0.5) session.endStall = { t: best.t, since: Date.now() };
        const ended = best.ended || best.t >= best.d - END_MARGIN || (tail && Date.now() - session.endStall.since > this.endStall);
        if (ended && !session.card) await this.showEndCard(session);
        // Rewound from the card: back to watching.
        else if (session.card && !ended && best.t < best.d - 15) await this.hideEndCard(session);
      }
      // In the middle of the video, a server that stops advancing (and was not paused) is
      // swapped for the next one or another site, resuming at the same second.
      if (session.phase === 'playing' && best && !session.card && best.t >= 15 && best.d - best.t > 30) {
        const mid = session.midStall;
        if (best.paused || !mid || best.t > mid.t + 0.5) session.midStall = { t: best.t, since: Date.now() };
        else if (Date.now() - mid.since > this.midStall && (session.rescues || 0) < MAX_RESCUES) { await this.rescue(session, best.t); return; }
      }
      if (session.phase === 'opening' && Date.now() - session.opened > (session.queue?.length ? this.serverTimeout : this.startTimeout) && !session.position) {
        if (session.queue?.length) { await this.nextServer(session); return; }
        if (await this.nextSite(session)) return;
        // Leave the page usable: the owner can pick another server with the remote.
        session.phase = 'manual'; session.error = 'No se pudo iniciar solo';
        await this.curtain(`window.__holyCurtain&&(__holyCurtain.say('No arrancó solo. Elige un servidor con el control.'),setTimeout(()=>__holyCurtain.hide(),2500))`);
        await this.dropCurtainScript();
        await this.status();
      }
    } finally { this.watching = false; }
  }
  async rescue(session, at) {
    session.rescues = (session.rescues || 0) + 1;
    session.midStall = null;
    session.forceResume = session.resumeAt = Math.max(0, at - 5);
    this.library.progress(session.key, session.item.url, at, session.position?.d || 0);
    this.errors.push({ phase: 'rescue', error: `atascado en ${Math.round(at)} s` });
    if (session.queue?.length) { await this.nextServer(session); return; }
    if (await this.nextSite(session)) return;
    // Nothing else to try: stay on this page (it may still recover) and do not ask again.
    session.rescues = MAX_RESCUES;
  }
  async started(session) {
    session.phase = 'playing'; session.playingAt = Date.now();
    // The next episode is looked up now, so the end card has it at once.
    if (session.item.kind !== 'movie' && this.catalog.next) session.next = this.catalog.next(session.item).catch(() => null);
    await this.dropCurtainScript();
    if (this.mainContext) await this.cdp.evaluate(theaterSource, this.mainContext).catch(() => false);
    if (session.resumeAt > 20) {
      for (const { id, sessionId } of await this.playerContexts()) if (await this.evaluateWithGesture(seekSource(session.resumeAt), id, sessionId).catch(() => false) === true) break;
    }
    session.forceResume = 0;
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
  // The end of a title: an episode offers the next one and plays it after a countdown
  // unless the owner moves away; a film offers «Volver al inicio» and similar films.
  async showEndCard(session) {
    const card = session.card = { focus: 0, options: [{ action: 'home' }], timer: null };
    const item = session.item;
    let data;
    if (item.kind !== 'movie' && (item.show || item.episode)) {
      const pending = session.next || (this.catalog.next ? this.catalog.next(item) : null);
      const next = pending ? await Promise.resolve(pending).catch(() => null) : null;
      if (this.session !== session || session.card !== card) return;
      if (next?.url) {
        const nextItem = { ...item, url: next.url, episode: next.episode || null, subtitle: next.label, backdrop: next.still || item.backdrop || '', isShow: false };
        card.options = [{ action: 'play', item: nextItem }, { action: 'home' }];
        card.timer = setTimeout(() => this.chooseCard(session, 0).catch(error => this.errors.push({ phase: 'next', error: error.message })), this.nextDelay);
        data = { mode: 'next', title: item.title, next: next.label, image: next.still || item.backdrop || item.poster || '', seconds: Math.round(this.nextDelay / 1000) };
      } else data = { mode: 'last', title: item.title };
    } else {
      const similar = this.catalog.similar?.(item, this.library, 4) || [];
      card.options.push(...similar.map(other => ({ action: 'play', item: other })));
      data = { mode: 'movie', title: item.title, options: similar.map(other => ({ title: other.title, poster: other.poster, match: other.match || 0 })) };
    }
    await this.curtain(endCardSource(data));
    await this.curtain(cardFlagSource(true));
  }
  async hideEndCard(session) {
    clearTimeout(session.card?.timer);
    session.card = null;
    await this.curtain(cardFlagSource(false));
  }
  // OK and the arrows (or a click) on the end card. Moving away from «next» stops its countdown.
  async cardInput(command) {
    const session = this.session;
    const card = session?.card;
    if (!card) return;
    if (Number.isInteger(command.choose)) return this.chooseCard(session, command.choose);
    if (command.key === 13) return this.chooseCard(session, card.focus);
    const step = { 37: -1, 38: -1, 39: 1, 40: 1 }[command.key];
    if (!step) return;
    card.focus = Math.max(0, Math.min(card.options.length - 1, card.focus + step));
    if (card.timer) { clearTimeout(card.timer); card.timer = null; }
    await this.curtain(`window.__holyEnd&&__holyEnd.focus(${card.focus},true)`);
  }
  async chooseCard(session, index) {
    const card = session.card;
    if (!card || this.session !== session) return;
    clearTimeout(card.timer);
    const option = card.options[index];
    if (!option) return;
    session.card = null;
    await this.curtain(cardFlagSource(false));
    if (option.action === 'play') return this.play(option.item);
    return this.command({ action: 'home' });
  }
  // Saves the last position before leaving the player.
  async endSession() {
    const session = this.session;
    this.session = null;
    await this.dropCurtainScript();
    if (!session) return;
    clearTimeout(session.card?.timer);
    if (session.position && session.phase === 'playing') this.library.progress(session.key, session.item.url, session.position.t, session.position.d);
  }
  async stop() {
    clearInterval(this.watchTimer);
    clearInterval(this.heartbeatTimer);
    await this.endSession().catch(() => {});
    if (this.remoteScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.remoteScript }).catch(() => {});
    await super.stop();
  }
}
