import { PlaybackLog } from './playback-log.mjs';
import { dirname, join } from 'node:path';
import { BrowserBridge } from '../browser-bridge.mjs';
import { origin, packagedPrefix, HOME_PATH } from './config.mjs';
import { entryKey } from './library.mjs';
import { PREFERRED } from './catalog.mjs';
import { curtainSource, remoteSource, autoplaySource, theaterSource, seekSource, heartbeatSource, endCardSource, cardFlagSource } from './page-scripts.mjs';
import {playbackDescriptor,validDescriptor,readDescriptorSource,writeDescriptorSource,clearDescriptorSource} from './handoff.mjs';

// Luma's engine (filters, guards, navigation) plus Holy's playback: a title is
// opened at the player its site would show, started automatically behind a
// curtain, and its position is remembered for «Continuar viendo».
const START_TIMEOUT = 45000;
// A server that shows nothing playable this long is swapped for the title's next one.
const SERVER_TIMEOUT = 28000;
const SAVE_EVERY = 10000;
// An episode paused this long shows the pause panel.
const PAUSE_DELAY = 1200;
const episodic = item => !!item && item.kind !== 'movie' && !!item.show;
// A server that does not even show a video player is given up sooner than one that is loading.
const EMPTY_TIMEOUT = 15000;
// After this many failed servers of one site, the same title on another site comes first.
const SITE_TRIES = 2;
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
    super(cdp, { ...options, toolbar: false, home: origin() + HOME_PATH, packagedHome: packagedPrefix + 'index.html' });
    this.playbackLog = options.playbackLog || new PlaybackLog(join(dirname(options.preferencesFile || '.local/browser-settings.json'), 'logs', 'holy-playback.jsonl'));
    this.playbackLog.runId = this.diagnostics.runId;
    const errors = this.errors;
    const pushError = errors.push.bind(errors);
    errors.push = (...entries) => {
      for (const entry of entries) this.playbackLog.write('runtime-error', this.session, { phase: entry.phase, reason: entry.error });
      const length = pushError(...entries);
      if (length > 100) errors.splice(0, length - 100);
      return errors.length;
    };
    this.catalog = options.catalog;
    this.library = options.library;
    this.apiBase = options.apiBase || origin();
    this.homeAliases = new Set();
    this.rememberHomeAlias(cdp.target?.url);
    this.mute = options.mute === true;
    this.serverTimeout = options.serverTimeout || SERVER_TIMEOUT;
    this.emptyTimeout = options.emptyTimeout || EMPTY_TIMEOUT;
    this.startTimeout = options.startTimeout || START_TIMEOUT;
    this.stallTimeout = options.stallTimeout || 20000;
    this.nextDelay = options.nextDelay || NEXT_DELAY;
    this.pauseDelay = options.pauseDelay || PAUSE_DELAY;
    this.endStall = options.endStall || END_STALL;
    this.midStall = options.midStall || MID_STALL;
    this.remoteContexts = new Set();
    // Cross-origin player iframes may run as their own targets (sessions).
    this.childSessions = new Map();
    this.session = null;
  }
  recordPlayback(event, session, detail = {}) {
    this.playbackLog?.write(event, session, detail);
    this.diagnostics?.event('playback', event, { ...detail, title: session?.item?.title, position: session?.position?.t, recent: session?.samples || [] }, /error|failed|stalled|exhausted|missing|timeout|disconnected/.test(event) ? 'error' : 'info');
  }
  async start() {
    await super.start();
    this.remoteScript = (await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: remoteSource([this.home, this.packagedHome], this.home, this.toolbarWorld), worldName: this.toolbarWorld })).identifier;
    // The page already open (e.g. a film when the Mac reconnects) gets the Back handler too.
    await this.armCurrentPage().catch(() => {});
    await this.adoptPlayback().catch(() => {});
    // Older installed homes mark a failed load as complete. A one-shot version
    // change requests fresh data after the old-origin request bridge is ready.
    this.homeRefresh=true;
    await this.status();
    this.homeRefresh=false;
    this.watchTimer = setInterval(() => this.watch().catch(error => this.errors.push({ phase: 'watch', error: error.message })), 1000);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 2000);
    this.heartbeatTimer.unref?.();
    this.heartbeat();
    this.watchTimer.unref?.();
    return this;
  }
  async armCurrentPage() {
    const { frameTree } = await this.cdp.call('Page.getFrameTree');
    // The target belongs to the Holy app. Remember only its own top-level home,
    // so an already installed home can still use its old computer's API URLs.
    this.rememberHomeAlias(frameTree.frame.url);
    const frames = [];
    const walk = node => { frames.push(node.frame); for (const child of node.childFrames || []) walk(child); };
    walk(frameTree);
    for (const frame of frames.slice(0, 20)) {
      if (!/^https?:/.test(frame.url) || this.isHome(frame.url)) continue;
      const world = await this.cdp.call('Page.createIsolatedWorld', { frameId: frame.id, worldName: this.toolbarWorld }).catch(() => null);
      if (!world?.executionContextId) continue;
      this.remoteContexts.add(world.executionContextId);
      await this.cdp.evaluate(remoteSource([this.home, this.packagedHome], this.home, this.toolbarWorld) + ';' + heartbeatSource(this.toolbarWorld), world.executionContextId).catch(() => {});
    }
  }
  // Tells each page's Back handler that this connection is alive.
  heartbeat() {
    for (const id of this.remoteContexts) this.cdp.evaluate(heartbeatSource(this.toolbarWorld), id).catch(() => this.remoteContexts.delete(id));
    this.publishPlayback().catch(() => {});
  }
  async publishPlayback() {
    if(!this.session||this.stopped||!['playing','opening','manual'].includes(this.session.phase))return;
    const descriptor=playbackDescriptor(this.session,this.toolbarWorld);
    if(descriptor)await this.cdp.evaluate(writeDescriptorSource(descriptor)).catch(()=>{});
  }
  async adoptPlayback() {
    const current=this.frames.get(this.mainFrame)||'';
    if(this.session||this.isHome(current)||!/^https?:/.test(current))return false;
    const descriptor=validDescriptor(await this.cdp.evaluate(readDescriptorSource));
    if(!descriptor||this.session||this.stopped)return false;
    const {item,position}=descriptor;
    if(!this.library.get(entryKey(item)))this.library.start(item);
    const token=this.sessionToken=(this.sessionToken||0)+1;
    this.session={token,item,key:entryKey(item),phase:'playing',started:Date.now(),playingAt:Date.now(),resumeAt:0,
      lastSave:0,position,queue:[],tried:new Set([item.source]),candidates:[],target:current,adopted:true};
    if(item.kind!=='movie'&&this.catalog.next)this.session.next=this.catalog.next(item).catch(()=>null);
    await this.publishPlayback();
    return true;
  }
  async event(message) {
    const { method, params, sessionId } = message;
    if (this.session && (this.session.networkErrors || 0) < 10) {
      if (method === 'Network.loadingFailed' && params.type === 'Media' && !params.canceled) {
        this.session.networkErrors = (this.session.networkErrors || 0) + 1;
        this.recordPlayback('media-network-error', this.session, { reason: /^net::[A-Z0-9_]+$/.test(params.errorText || '') ? params.errorText : 'media request failed' });
      }
      if (method === 'Network.responseReceived' && params.type === 'Media' && params.response?.status >= 400) {
        this.session.networkErrors = (this.session.networkErrors || 0) + 1;
        this.recordPlayback('media-http-error', this.session, { reason: 'HTTP ' + params.response.status });
      }
    }
    if (this.session && ['Inspector.targetCrashed', 'Target.targetCrashed', 'Inspector.detached'].includes(method)) this.recordPlayback('player-disconnected', this.session, { reason: method });
    if (method === 'Runtime.executionContextCreated' && !sessionId && params.context.name === this.toolbarWorld) {
      this.remoteContexts.add(params.context.id);
      this.cdp.evaluate(heartbeatSource(this.toolbarWorld), params.context.id).catch(() => {});
    }
    // Back on a page may also reach the home on its own: close the playback session there.
    if (method === 'Page.frameNavigated' && !sessionId && !params.frame.parentId && this.session && this.session.phase !== 'resolving' &&
        this.isHome(params.frame.url)) {
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
  rememberHomeAlias(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && this.isHome(url.href)) this.homeAliases.add(url.origin);
    } catch { /* A packaged home has no HTTP origin to translate. */ }
  }
  async request(params, sessionId) {
    try {
      const url = new URL(params.request.url);
      // Do not redirect arbitrary LAN requests or website/player resources.
      // Only the origin observed on Holy's own home may retain an old address.
      if (this.homeAliases.has(url.origin) && url.origin !== new URL(this.apiBase).origin &&
          (url.pathname.startsWith('/holy-api/') || url.pathname.startsWith(HOME_PATH))) {
        const destination = new URL(url.pathname + url.search, this.apiBase);
        await this.cdp.call('Fetch.continueRequest', { requestId: params.requestId, url: destination.href }, sessionId).catch(() => {});
        return;
      }
    } catch { /* Non-HTTP URLs follow the normal request path. */ }
    if (params.resourceType === 'Document' && this.isHome(params.request.url)) {
      await this.cdp.call('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {});
      return;
    }
    return super.request(params, sessionId);
  }
  statusPayload() {
    const session = this.session && { phase: this.session.phase, title: this.session.item.title, error: this.session.error || '', site: this.session.site || '' };
    return { ...super.statusPayload(), holy: { apiBase: this.apiBase, catalogVersion: this.homeRefresh?'connection:'+this.toolbarWorld:this.catalog?.version || 0, libraryVersion: this.library?.version || 0, refreshing: !!this.catalog?.refreshing, session } };
  }
  async command(command) {
    const { action, value } = command;
    if (action === 'play') return this.play(value);
    if (action === 'prepare') { this.prepare(value); return; }
    if (action === 'refresh-catalog') { this.catalog.refresh().then(() => this.status()).catch(() => {}); return this.status(); }
    if (action === 'forget') { this.library.remove(String(value ?? '')); return this.status(); }
    // Holy has no tabs or page history: Back from an episode goes to its series' episode list,
    // from anything else home; on the home it does nothing.
    if (action === 'back' || action === 'forward') {
      const current = this.frames.get(this.mainFrame) || '';
      const onHome = this.isHome(current);
      if (action === 'forward' || (onHome && !this.session)) return;
      if (this.session?.card?.kind === 'versions') { const open = this.session; await this.hideEndCard(open); await this.showPauseCard(open); return; }
      if (this.session && episodic(this.session.item)) return this.toEpisodes(this.session.item);
      command = { action: 'home' };
    }
    if (command.action === 'home') {
      await this.endSession();
      return super.command({ action: 'home' });
    }
    return super.command(command);
  }
  // Home, opening the series' episode list on that episode (the home reads it from the address).
  async toEpisodes(item) {
    await this.endSession();
    const show = { source: item.source, kind: item.kind, title: item.title, show: item.show, url: item.show, isShow: true,
      poster: item.poster || '', backdrop: item.backdrop || '', genres: (item.genres || []).slice(0, 4), episode: item.episode || null, at: item.url };
    const url = this.home + '#episodes=' + encodeURIComponent(JSON.stringify(show));
    this.showSettings = false;
    this.beginNavigation(url); await this.status();
    await this.cdp.call('Page.navigate', { url });
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
    const token = this.sessionToken = (this.sessionToken || 0) + 1;
    await this.endSession(false);
    if (this.sessionToken !== token || this.stopped) return;
    const known = this.catalog?.find(value.url);
    const previous = this.library.get(entryKey(value));
    const { version: askedVersion, versionKind: askedKind, ...clean } = value;
    const item = { ...(previous || {}), ...(known || {}), ...clean, genres: known?.genres?.length ? known.genres : value.genres || previous?.genres || [] };
    // The language: the one just picked, else the one remembered for this series.
    const remembered = this.library.languageOf?.(item);
    const choice = askedVersion || askedKind ? { version: askedVersion, kind: askedKind } : remembered ? { version: remembered.id, kind: remembered.kind } : {};
    const session = this.session = { token, item, choice, key: entryKey(item), phase: 'resolving', started: Date.now(), resumeAt: this.library.resumeAt(item), lastSave: 0 };
    // The curtain is registered before navigating so it covers the site's first paint.
    if (!await this.installCurtain(session, curtainSource({ title: item.title, subtitle: item.subtitle || (item.year ? String(item.year) : ''), backdrop: item.backdrop || item.poster || '', message: session.resumeAt ? 'Volviendo a donde te quedaste…' : 'Preparando el vídeo…' }))) return;
    await this.status();
    if (this.session !== session) return;
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
      if (this.session !== session) return;
      const copies = await this.catalog.elsewhere(item, new Set([item.source]), { only: preferred, kind: preference.kind }).catch(() => []);
      for (const copy of copies.slice(0, 2)) {
        if (this.session !== session) return;
        target = await this.catalog.resolve(copy, session.choice).catch(() => null);
        if (target) { session.item = { ...copy, title: item.title, poster: item.poster || copy.poster, backdrop: item.backdrop || copy.backdrop, genres: item.genres?.length ? item.genres : copy.genres }; session.site = this.catalog.connector?.(preferred)?.name || preferred; break; }
      }
      if (this.session !== session) return;
      // The picked copy is the next choice if JKAnime fails, then the other sites.
      session.candidates = [item];
    }
    if (!target) {
      if (preferred && item.source !== preferred) { session.candidates = []; session.tried.add(item.source); }
      try { target = await this.catalog.resolve(item, session.choice); } catch (error) { session.resolveError = error; }
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
    if (this.session !== session || this.stopped) return;
    this.library.start(session.item);
    session.key = entryKey(session.item);
    // After a rescue the second comes from the stalled server, whatever site plays next.
    session.resumeAt = session.forceResume || this.library.resumeAt(session.item);
    session.queue = [...(target.alternatives || [])];
    session.referrer = target.referrer;
    // Languages of this episode (when the site offers several) and the one being played.
    session.versions = Array.isArray(target.versions) ? target.versions : [];
    session.version = target.version || '';
    session.servers = (session.servers || 0) + 1;
    session.siteServers = 1; session.sawVideo = false;
    await this.openServer(session, target.url);
  }
  // Next site with the same title that resolves to a player; null when none is left.
  async findElsewhere(session) {
    if (!this.catalog.elsewhere) return null;
    const more = async () => {
      session.searched = true;
      await this.curtain(`window.__holyCurtain&&__holyCurtain.say('Buscando este título en tus otros sitios…')`);
      if (this.session !== session) return;
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
      if (this.session !== session) return null;
      const target = await this.catalog.resolve(candidate, session.choice).catch(() => null);
      if (this.session !== session) return null;
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
    if (this.session !== session || this.stopped) return false;
    if (!this.curtainScript) {
      const item = session.item;
      if (!await this.installCurtain(session, curtainSource({ title: item.title, subtitle: item.subtitle || '', backdrop: item.backdrop || item.poster || '', message: 'Buscando en otro sitio…' }))) return false;
    }
    const target = await this.findElsewhere(session);
    if (!target || this.session !== session) return false;
    await this.openTarget(session, target);
    return true;
  }
  async openServer(session, url) {
    if (this.session !== session || this.stopped) return;
    session.phase = 'opening'; session.opened = Date.now(); session.target = url; session.position = null;
    session.midStall = null; session.stall = null; session.missingSince = 0; session.lastPaused = false;
    this.recordPlayback('server-opening', session);
    await this.prepareDocument(url);
    if (this.session !== session || this.stopped) return;
    this.explicitNavigationURL = url;
    this.beginNavigation(url);
    await this.status();
    if (this.session !== session || this.stopped) return;
    const result = await this.cdp.call('Page.navigate', { url, ...(session.referrer ? { referrer: session.referrer } : {}) }).catch(error => ({ errorText: error.message }));
    if (result.errorText && this.session === session) {
      if (await this.serverFailed(session)) return;
      session.phase = 'failed'; await this.navigationFailed(this.readableError(result.errorText));
    }
  }
  // The title's next server, behind the same curtain.
  async nextServer(session) {
    if (this.session !== session || this.stopped) return;
    // That player failed: the next time this title is opened, ask its site again.
    if (session.item?.url) this.catalog.forgetPlayer?.(session.item.url);
    const url = session.queue.shift();
    session.servers++;
    session.siteServers = (session.siteServers || 0) + 1; session.sawVideo = false;
    // After a start the curtain script was dropped: cover the next server's page again.
    if (!this.curtainScript) {
      const item = session.item;
      if (!await this.installCurtain(session, curtainSource({ title: item.title, subtitle: item.subtitle || '', backdrop: item.backdrop || item.poster || '', message: 'Probando otro servidor…' }))) return;
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
    this.watching = true;
    try {
    if (this.navigation.phase === 'error') {
      if (session.phase === 'opening' && await this.serverFailed(session)) return;
      if (this.session !== session) return;
      await this.endSession(); await this.status(); return;
    }
    if (session.phase === 'opening' && session.queue?.length && Date.now() - session.opened > this.serverTimeout && !session.position) { await this.serverFailed(session); return; }
    if (this.navigation.phase === 'loading' && session.phase === 'opening' && Date.now() - session.opened < 4000) return;
    const page = this.frames.get(this.mainFrame) || '';
    if (!/^https?:/.test(page) || this.isHome(page)) return;
      const passive = session.phase !== 'opening';
      const results = (await Promise.all((await this.playerContexts()).map(({ id, sessionId }) => Promise.race([
        this.evaluateWithGesture(autoplaySource({ passive, mute: this.mute }), id, sessionId).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 2500, null))
      ])))).filter(Boolean);
      if (this.session !== session) return;
      if (results.some(frame => frame.videos.length)) session.sawVideo = true;
      session.frames = results.map(frame => ({ url: frame.url.split('?')[0], top: frame.top, videos: frame.videos.length, action: frame.action })).slice(0, 12);
      const videos = results.flatMap(frame => frame.videos).filter(video => video.d > 60);
      const playing = videos.filter(video => !video.paused && video.t > 0).sort((a, b) => b.d - a.d)[0];
      if (playing && session.phase !== 'playing') await this.started(session);
      if (this.session !== session) return;
      // A server that starts but never gets past its first seconds (still «playing») is
      // stalled: swap it for the next one. A paused video is the owner's choice and stays.
      if (playing && playing.t < 15 && (session.rescues || 0) < MAX_RESCUES) {
        const stall = session.stall;
        if (!stall || playing.t > stall.t + 0.5) session.stall = { t: playing.t, since: Date.now() };
        else if (Date.now() - stall.since > this.stallTimeout) { session.stall = null; this.recordPlayback('start-stalled', session, playing); await this.rescue(session, playing.t); return; }
      }
      const best = playing || (session.phase === 'playing' ? videos.sort((a, b) => b.d - a.d)[0] : null);
      if (best && Date.now() - (session.sampledAt || 0) >= 10000) {
        session.sampledAt = Date.now();
        const sample = { seconds: Math.round(best.t), duration: best.d, ready: best.ready, network: best.network, mediaError: best.mediaError, bufferAhead: Math.round(best.bufferAhead || 0), paused: best.paused, frameCount: results.length };
        session.samples = [...(session.samples || []), sample].slice(-12);
        this.diagnostics?.event('playback', 'sample', sample);
      }
      if (session.resumePending && best) {
        if (Date.now() > session.resumePending.until || best.paused) {
          this.recordPlayback('resume-unconfirmed', session); session.resumePending = null;
        } else {
          for (const { id, sessionId } of await this.playerContexts()) {
            if (this.session !== session || this.stopped) return;
            if (await this.evaluateWithGesture(seekSource(session.resumePending.at), id, sessionId).catch(() => false) === true) {
              session.resumePending = null; return;
            }
          }
          return;
        }
      }
      if (session.recoveryCheck && best && !best.paused && best.t > session.recoveryCheck.t + 0.5) {
        this.recordPlayback('recovery-advancing', session, { seconds: best.t }); session.recoveryCheck = null;
      }
      if (best) { session.lastPaused = best.paused; session.missingSince = 0; }
      else if (session.phase === 'playing' && !session.card && !session.lastPaused) {
        session.missingSince ||= Date.now();
        if (Date.now() - session.missingSince > this.midStall && (session.rescues || 0) < MAX_RESCUES) {
          this.recordPlayback('video-missing', session);
          await this.rescue(session, session.position?.t || 0); return;
        }
      }
      if (best?.mediaError && !session.mediaErrorLogged) {
        session.mediaErrorLogged = true; this.recordPlayback('media-error', session, best);
      } else if (best && !best.mediaError) session.mediaErrorLogged = false;
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
        if (ended && session.card?.kind !== 'end') await this.showEndCard(session);
        // Rewound from the card: back to watching.
        else if (session.card?.kind === 'end' && !ended && best.t < best.d - 15) await this.hideEndCard(session);
        // An episode paused for a moment (not at its end): the pause panel; playing again hides it.
        if (!ended && (episodic(session.item) || (session.versions || []).length > 1)) {
          if (best.paused && !best.mediaError && best.t > 1) {
            session.pausedSince ||= Date.now();
            if (!session.card && Date.now() - session.pausedSince > this.pauseDelay) await this.showPauseCard(session);
          } else {
            session.pausedSince = 0;
            if (['pause', 'versions'].includes(session.card?.kind)) await this.hideEndCard(session);
          }
        }
      }
      // In the middle of the video, a server that stops advancing (and was not paused) is
      // swapped for the next one or another site, resuming at the same second.
      if (session.phase === 'playing' && best && !session.card && best.t >= 15 && best.d - best.t > 30) {
        const mid = session.midStall;
        if ((best.paused && !best.mediaError) || !mid || Math.abs(best.t - mid.t) > 0.5) session.midStall = { t: best.t, since: Date.now() };
        else if (Date.now() - mid.since > this.midStall && (session.rescues || 0) < MAX_RESCUES) { this.recordPlayback('video-stalled', session, best); await this.rescue(session, best.t); return; }
      }
      const limit = session.queue?.length || session.leftover?.queue?.length ? (session.sawVideo ? this.serverTimeout : this.emptyTimeout) : this.startTimeout;
      if (session.phase === 'opening' && Date.now() - session.opened > limit && !session.position) {
        if (await this.serverFailed(session)) return;
        // Leave the page usable: the owner can pick another server with the remote.
        session.phase = 'manual'; session.error = 'No se pudo iniciar solo';
        this.recordPlayback('start-timeout', session);
        await this.curtain(`window.__holyCurtain&&(__holyCurtain.say('No arrancó solo. Elige un servidor con el control.'),setTimeout(()=>__holyCurtain.hide(),2500))`);
        await this.dropCurtainScript();
        await this.status();
      }
    } finally { this.watching = false; }
  }
  // This server did not start. Order: two servers of a site, then the same title on another
  // site, then the first site's remaining servers. False when nothing is left.
  async serverFailed(session) {
    if (this.session !== session || this.stopped) return true;
    this.recordPlayback('server-failed', session);
    if (session.queue?.length && session.siteServers >= SITE_TRIES && !session.leftover && this.catalog.elsewhere) {
      const leftover = { queue: session.queue, referrer: session.referrer, item: session.item, site: session.site, key: session.key };
      session.queue = [];
      if (await this.nextSite(session)) { session.leftover = leftover; return true; }
      if (this.session !== session) return true;
      session.queue = leftover.queue;
    }
    if (session.queue?.length) { await this.nextServer(session); return true; }
    if (await this.nextSite(session)) return true;
    if (this.session !== session) return true;
    if (session.leftover?.queue?.length) {
      const back = session.leftover;
      session.leftover = { queue: [] };
      Object.assign(session, { queue: back.queue, referrer: back.referrer, item: back.item, site: back.site, key: back.key });
      await this.nextServer(session);
      return true;
    }
    return false;
  }
  async rescue(session, at) {
    if (this.session !== session || this.stopped || (session.rescues || 0) >= MAX_RESCUES) return;
    session.rescues = (session.rescues || 0) + 1;
    this.recordPlayback('recovery-attempt', session, { seconds: at });
    session.midStall = null;
    session.recoveryCheck = { t: at };
    session.forceResume = session.resumeAt = Math.max(0, at - 5);
    this.library.progress(session.key, session.item.url, at, session.position?.d || 0);
    this.errors.push({ phase: 'rescue', error: `atascado en ${Math.round(at)} s` });
    if (session.queue?.length) { await this.nextServer(session); return; }
    if (await this.nextSite(session)) return;
    if (this.session !== session || this.stopped) return;
    // One reload of this server when no alternative exists, preserving the episode position.
    if (!session.reloaded && /^https?:/.test(session.target || '')) {
      session.reloaded = true;
      this.recordPlayback('recovery-reload', session);
      await this.openServer(session, session.target); return;
    }
    session.rescues = MAX_RESCUES;
    this.recordPlayback('recovery-exhausted', session);
  }
  async started(session) {
    if (this.session !== session || this.stopped) return;
    session.phase = 'playing'; session.playingAt = Date.now(); session.lastSave = Date.now();
    this.recordPlayback(session.rescues ? 'recovery-started' : 'playback-started', session);
    // The next episode is looked up now, so the end card has it at once.
    if (session.item.kind !== 'movie' && this.catalog.next) session.next = this.catalog.next(session.item).catch(() => null);
    await this.dropCurtainScript();
    if (this.session !== session || this.stopped) return;
    if (this.mainContext) await this.cdp.evaluate(theaterSource, this.mainContext).catch(() => false);
    if (this.session !== session || this.stopped) return;
    if (session.resumeAt > 0) {
      session.resumePending = { at: session.resumeAt, until: Date.now() + 15000 };
      for (const { id, sessionId } of await this.playerContexts()) {
        if (this.session !== session || this.stopped) return;
        if (await this.evaluateWithGesture(seekSource(session.resumeAt), id, sessionId).catch(() => false) === true) { session.resumePending = null; break; }
      }
    }
    if (this.session !== session || this.stopped) return;
    session.forceResume = 0;
    await this.curtain('window.__holyCurtain&&__holyCurtain.hide()');
    await this.status();
  }
  async curtain(expression) {
    await Promise.all([...this.remoteContexts].map(id => this.cdp.evaluate(expression, id).catch(() => {})));
  }
  async installCurtain(session, source) {
    if (this.session !== session || this.stopped) return false;
    const { identifier } = await this.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source, worldName: this.toolbarWorld });
    if (this.session !== session || this.stopped) {
      if (identifier) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
      return false;
    }
    this.curtainScript = identifier;
    return true;
  }
  async dropCurtainScript() {
    const identifier = this.curtainScript;
    this.curtainScript = null;
    if (identifier) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
  // The end of a title: an episode offers the next one and plays it after a countdown
  // unless the owner moves away; a film offers «Volver al inicio» and similar films.
  async showEndCard(session) {
    const card = session.card = { kind: 'end', focus: 0, options: [{ action: 'home' }], timer: null };
    const item = session.item;
    let data;
    if (item.kind !== 'movie' && (item.show || item.episode)) {
      const pending = session.next || (this.catalog.next ? this.catalog.next(item) : null);
      const next = pending ? await Promise.resolve(pending).catch(() => null) : null;
      if (this.session !== session || session.card !== card) return;
      if (next?.url) {
        const nextItem = { ...item, url: next.url, episode: next.episode || null, subtitle: next.label, backdrop: next.still || item.backdrop || '', isShow: false };
        card.options = [{ action: 'play', item: nextItem }, { action: 'episodes' }];
        card.timer = setTimeout(() => this.chooseCard(session, 0).catch(error => this.errors.push({ phase: 'next', error: error.message })), this.nextDelay);
        data = { mode: 'next', title: item.title, next: next.label, image: next.still || item.backdrop || item.poster || '', seconds: Math.round(this.nextDelay / 1000) };
      } else { card.options = [{ action: 'episodes' }]; data = { mode: 'last', title: item.title }; }
    } else {
      const similar = this.catalog.similar?.(item, this.library, 4) || [];
      card.options.push(...similar.map(other => ({ action: 'play', item: other })));
      data = { mode: 'movie', title: item.title, options: similar.map(other => ({ title: other.title, poster: other.poster, match: other.match || 0 })) };
    }
    await this.curtain(endCardSource(data));
    await this.curtain(cardFlagSource(true));
  }
  // Paused episode: a panel at the top with «Seguir viendo», the previous and next episodes
  // and the episode list. It goes away when the video plays again.
  async showPauseCard(session) {
    const card = session.card = { kind: 'pause', focus: -1, options: [{ action: 'resume' }], timer: null };
    const item = session.item;
    const series = episodic(item);
    const [previous, next] = series ? await Promise.all([
      this.catalog.previous ? this.catalog.previous(item).catch(() => null) : null,
      Promise.resolve(session.next || (this.catalog.next ? this.catalog.next(item) : null)).catch(() => null)
    ]) : [null, null];
    if (this.session !== session || session.card !== card) return;
    // The next episode keeps the language being watched (by id, else by kind).
    const current = (session.versions || []).find(version => version.id === session.version);
    const episode = (other, entry) => ({ ...item, url: entry.url, episode: entry.episode || null, subtitle: entry.label, backdrop: entry.still || item.backdrop || '', isShow: false, ...(current ? { version: current.id, versionKind: current.kind } : {}) });
    const buttons = [{ label: 'Seguir viendo', icon: 'play' }];
    if (previous?.url) { card.options.push({ action: 'play', item: episode(item, previous) }); buttons.push({ label: 'Anterior', detail: previous.label, icon: 'previous' }); }
    if (next?.url) { card.options.push({ action: 'play', item: episode(item, next) }); buttons.push({ label: 'Siguiente', detail: next.label, icon: 'next' }); }
    if ((session.versions || []).length > 1) { card.options.push({ action: 'versions' }); buttons.push({ label: 'Idioma', detail: current?.label || '', icon: 'language' }); }
    if (series) { card.options.push({ action: 'episodes' }); buttons.push({ label: 'Capítulos', icon: 'list' }); }
    await this.curtain(endCardSource({ mode: 'pause', title: item.title, next: item.subtitle || (item.episode ? 'Episodio ' + item.episode : ''), buttons }));
    await this.curtain(cardFlagSource('menu'));
  }
  // The languages this episode has: pick one and it restarts here, at the same second.
  async showVersionsCard(session) {
    const versions = session.versions || [];
    if (versions.length < 2) return;
    const start = Math.max(0, versions.findIndex(version => version.id === session.version));
    const card = session.card = { kind: 'versions', focus: start, options: versions.map(version => ({ action: 'version', version })), timer: null };
    await this.curtain(endCardSource({ mode: 'pause', kicker: 'IDIOMA', hint: '← → para elegir · OK para cambiar · Atrás para volver', start,
      title: session.item.title, next: session.item.subtitle || (session.item.episode ? 'Episodio ' + session.item.episode : ''),
      buttons: versions.map(version => ({ label: version.label, detail: version.id === session.version ? 'Ahora' : '', icon: 'language' })) }));
    await this.curtain(cardFlagSource(true));
  }
  async switchVersion(session, version) {
    this.library.setLanguage?.(session.item, version);
    if (version.id === session.version) return this.resumeVideo(session);
    const at = session.position?.t || 0;
    if (at > 1) this.library.progress(session.key, session.item.url, at, session.position?.d || 0);
    await this.play({ ...session.item, version: version.id, versionKind: version.kind });
  }
  async resumeVideo(session) {
    await this.hideEndCard(session);
    const play = `(()=>{const deep=(r,o=[])=>{o.push(...r.querySelectorAll('video'));for(const n of r.querySelectorAll('*'))if(n.shadowRoot)deep(n.shadowRoot,o);return o};const v=deep(document).filter(v=>Number.isFinite(v.duration)&&v.duration>60).sort((a,b)=>b.duration-a.duration)[0];if(!v)return false;const p=v.play();if(p&&p.catch)p.catch(()=>{});return true})()`;
    for (const { id, sessionId } of await this.playerContexts()) if (await this.evaluateWithGesture(play, id, sessionId).catch(() => false) === true) break;
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
    // The pause panel starts unfocused (OK and the arrows stay with the player): ↑ enters it,
    // ↓ leaves it; inside, ← → move and OK chooses.
    if (card.kind === 'pause') {
      if (card.focus < 0) { if (command.key === 38) { card.focus = 0; await this.curtain(cardFlagSource(true)); await this.curtain('window.__holyEnd&&__holyEnd.focus(0,true)'); } return; }
      if (command.key === 40) { card.focus = -1; await this.curtain(cardFlagSource('menu')); await this.curtain('window.__holyEnd&&__holyEnd.focus(-1,true)'); return; }
      if (command.key === 38) return;
    }
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
    if (option.action === 'resume') return this.resumeVideo(session);
    if (option.action === 'versions') { session.card = null; return this.showVersionsCard(session); }
    if (option.action === 'version') return this.switchVersion(session, option.version);
    if (option.action === 'episodes' && session.item?.show) return this.toEpisodes(session.item);
    return this.command({ action: 'home' });
  }
  // Saves the last position before leaving the player.
  async endSession(cancelPending = true) {
    if (cancelPending) this.sessionToken = (this.sessionToken || 0) + 1;
    const session = this.session;
    this.session = null;
    if(session&&!this.preservePlayback)await this.cdp.evaluate(clearDescriptorSource(this.toolbarWorld)).catch(()=>{});
    await this.dropCurtainScript();
    if (!session) return;
    clearTimeout(session.card?.timer);
    if (session.position && session.phase === 'playing') this.library.progress(session.key, session.item.url, session.position.t, session.position.d);
  }
  async stop() {
    await this.publishPlayback();
    this.preservePlayback=true;
    this.stopped = true;
    clearInterval(this.watchTimer);
    clearInterval(this.heartbeatTimer);
    await this.endSession().catch(() => {});
    if (this.remoteScript) await this.cdp.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.remoteScript }).catch(() => {});
    await super.stop();
  }
}
