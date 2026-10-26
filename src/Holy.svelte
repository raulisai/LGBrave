<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import NavigationFeedback from './NavigationFeedback.svelte';
  import { SECTIONS, categoryRows, sectionRows, withLayout, episodeRows, kindLabel, languageTag, clock, remaining, matchTone, getJSON, bestResults, searchScore, unpackHome, latestRequest } from './holy.js';

  let apiBase = $state(/^https?:/.test(location.protocol) ? location.origin : '');
  // The home is always replaced whole, never edited in place: no deep reactivity over ~800 titles.
  let data = $state.raw({ rows: [], items: [], sources: [], hero: null, updatedAt: 0 });
  let cacheTimer;
  let section = $state('inicio');
  let rowIndex = $state(0);
  let columns = $state({});
  let inNav = $state(false);
  let navIndex = $state(0);
  let connected = $state(false);
  // Only whether this screen reaches the Mac (and the Mac the TV). Diagnosis and repairs
  // live in the Mac's menu-bar app, never on the TV.
  let macReachable = $state(true);
  const link = $derived(!apiBase || !macReachable ? 'red' : connected ? 'green' : 'orange');
  const linkText = $derived({ red: 'Sin conexión con la computadora', orange: 'Conectando con la computadora…', green: 'Conectado a la computadora' }[link]);
  async function checkMac() {
    const base = apiBase;
    if (!base) return;
    try { await getJSON(base + '/holy-api/health', { timeout: 6000, retries: 0 }); if (apiBase === base) macReachable = true; }
    catch { if (apiBase === base) macReachable = false; }
  }
  let opening = $state(null);
  let notice = $state('');
  let navigationError = $state('');
  let navigationTarget = $state('');
  let loadedVersions = '';
  let lastHeartbeat = 0;
  let previewTimer;
  let openingTimer;
  let rowsEl = $state();
  // Search: every site is asked at once; each row appears as soon as its site answers,
  // under «Mejores resultados» (what was typed, from any site) and, when that is a whole
  // series, its newest episodes.
  let query = $state('');
  let searchGroups = $state([]);
  let searchedFor = $state('');
  let bestEpisodes = $state(null);
  let bestEpisodesFor = '';
  // The owner's site per kind (the Mac sends it; this covers an older Mac process).
  const PREFERRED = { anime: 'jkanime' };
  const searchRows = $derived.by(() => {
    const best = bestResults(searchGroups, searchedFor, data.preferred || PREFERRED);
    return [
      ...(best.length ? [{ id: 's-best', title: 'Mejores resultados', items: best }] : []),
      ...(bestEpisodes && bestEpisodes.show === best[0]?.url ? [bestEpisodes.row] : []),
      ...searchGroups
    ];
  });
  let searchStatus = $state([]);
  let inSearch = $state(false);
  let searchInput = $state();
  let searchTimer;
  let searchToken = 0;
  // A show's episodes, opened from search; Back returns to where it was opened.
  let episodesView = $state(null);
  let category = $state(null);
  function openCategory(shelf) {
    if (!shelf?.genre) return;
    category = { genre: shelf.genre, title: shelf.title, rowIndex, columns };
    rowIndex = 0; columns = {}; inNav = false; pointing = false; pointer = null;
  }
  function closeCategory() {
    const previous = category; category = null;
    rowIndex = previous?.rowIndex || 0; columns = previous?.columns || {};
  }
  // «Gustos»: titles to rate and the resulting taste profile.
  let tasteRows = $state([]);
  let taste = $state(null);
  let tasteLoading = $state(false);
  const isTV=!!(window.webOSSystem||window.PalmSystem);
  async function importTastes(event){
    const input=event.currentTarget,file=input.files?.[0];if(!file)return;
    try{if(file.size>512*1024)throw Error('tamaño');const payload=JSON.parse(await file.text());
      await getJSON(apiBase+'/holy-api/taste-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),retries:0});
      await loadTaste();await load();notice='Tus gustos se combinaron conservando las valoraciones más recientes.';
    }catch{notice='No se pudo importar el archivo de gustos. Revisa el archivo y la conexión.';}input.value='';
  }
  let resetArmed = 0;
  // Rating sheet: green key on any title, or «¿Qué te pareció?» after watching a good while.
  const RATINGS = [{ value: -1, label: 'No es para mí', icon: 'minus' }, { value: 1, label: 'Me gusta', icon: 'check' }, { value: 2, label: 'Me encanta', icon: 'star' }];
  let sheet = $state(null);
  const askedShown = new Set();
  const cardWidth = layout => ({ landscape: 400, chip: 240 })[layout] || 230;
  // Only a slice of cards around a row's position is drawn (an empty block keeps the place of
  // those before it), and only for the row above (hidden, ready for ↑), this one and two below.
  // Changing row then builds about a dozen cards instead of every title of the row.
  const sliceStart = shelf => Math.max(0, (columns[shelf.id] || 0) - 2);
  // Rows further down are built ahead while the TV is idle (one at a time) and then stay, so
  // ↓ and ↑ only slide rows that already exist instead of building a dozen cards per press.
  let warmUntil = $state(2);
  let warmFor = '';
  const drawn = (shelf, r) => (r >= Math.min(rowIndex - 1, 0) && r <= Math.max(rowIndex + 2, warmUntil) ? shelf.items.slice(sliceStart(shelf), sliceStart(shelf) + 11) : []);
  $effect(() => {
    const key = section + '|' + (category?.genre || '') + '|' + (episodesView?.token || '');
    if (key !== warmFor) { warmFor = key; warmUntil = 2; }
  });
  $effect(() => {
    const limit = rows.length - 1;
    const next = Math.max(warmUntil, rowIndex + 2) + 1;
    if (next > limit) return;
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 150));
    const stop = window.cancelIdleCallback || clearTimeout;
    const handle = idle(() => { warmUntil = next; }, { timeout: 700 });
    return () => stop(handle);
  });

  const rows = $derived(episodesView ? episodeRows(episodesView.show, episodesView.seasons) : section === 'buscar' ? searchRows.map(row => (row.layout ? row : withLayout(row))) : section === 'gustos' ? tasteRows.map(row => ({ ...row, layout: row.id.startsWith('pref-') ? 'chip' : 'poster' })) : category ? categoryRows(data, section, category.genre) : sectionRows(data, section));
  const profile = $derived(taste || data.taste || null);
  const row = $derived(rows[Math.min(rowIndex, rows.length - 1)]);
  const column = $derived(row ? Math.min(columns[row.id] || 0, row.items.length - 1) : 0);
  // Magic Remote pointer: a card lights up when the pointer rests on it, but nothing scrolls
  // under the pointer (scrolling made the next card slide beneath it, again and again).
  // The arrows at a row's edges and the wheel move with the pointer; any key returns to
  // the usual focus, starting from the card the pointer was on.
  let pointing = $state(false);
  let pointer = $state(null);
  let pointerTimer;
  let wheelAt = 0;
  // Only a pointer that really moved counts: when rows slide under a still pointer the
  // browser reports it «entering» other cards, which must not steal the focus from the keys.
  let lastMove = { x: -1, y: -1, at: 0 };
  let keyAt = 0;
  function moved(event) {
    if (Math.abs(event.clientX - lastMove.x) + Math.abs(event.clientY - lastMove.y) < 3) return;
    lastMove = { x: event.clientX, y: event.clientY, at: Date.now() };
  }
  const realPointer = () => Date.now() - lastMove.at < 400 && Date.now() - keyAt > 500;
  const pointed = $derived(pointing && pointer ? rows[pointer.r]?.items[pointer.c] || null : null);
  const focused = $derived(pointed || row?.items[Math.max(0, column)] || null);
  let preview = $state(null);
  const sourceName = id => data.sources.find(source => source.id === id)?.name || '';
  const img = url => !url ? '' : apiBase ? `${apiBase}/holy-api/img?u=${encodeURIComponent(url)}` : url;
  // Messages fade on their own once there is something to look at.
  let noticeTimer;
  $effect(() => {
    if (!notice || !data.rows.length) return;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ''; }, 7000);
  });

  // The big preview follows focus, a moment later so fast scrolling stays smooth.
  $effect(() => {
    const next = focused || episodesView?.show || (section === 'buscar' || section === 'gustos' ? null : data.hero);
    clearTimeout(previewTimer);
    if (!preview) { preview = next; return; }
    previewTimer = setTimeout(() => { preview = next; }, pointing ? 260 : 160);
  });
  // Resting on a card for a moment gets it ready: the Mac finds the player (so OK starts
  // sooner) or, for a series, its episode list. Nothing is opened or shown.
  let prepareTimer;
  $effect(() => {
    const item = focused;
    clearTimeout(prepareTimer);
    if (!item || item.chip || item.discover || inNav || inSearch || !apiBase) return;
    prepareTimer = setTimeout(() => {
      if (!item.isShow && hasVersions(item)) versionsFor(item);
      if (item.isShow) { if (item.show) fetch(`${apiBase}/holy-api/episodes?source=${encodeURIComponent(item.source)}&show=${encodeURIComponent(item.show)}`).catch(() => {}); }
      else command('prepare', plainItem(item));
    }, 1200);
  });
  // Keep the focused row at the top of the shelf area and the focused card at the left.
  $effect(() => {
    const index = rowIndex;
    rows.length;
    tick().then(() => {
      const target = rowsEl?.children[index];
      if (rowsEl) rowsEl.style.transform = `translateY(${-(target?.offsetTop || 0)}px)`;
    });
  });

  // The lit card is marked directly (one class moved from card to card), so a key press costs
  // the same whether the page holds 30 cards or 300.
  let litCard = null;
  const litKey = $derived(pointing ? (pointer ? pointer.r + ':' + pointer.c : '') : !inNav && !inSearch && rows.length ? rowIndex + ':' + column : '');
  $effect(() => {
    const key = litKey;
    rows; warmUntil; columns;
    tick().then(() => {
      const next = key && rowsEl ? rowsEl.querySelector(`[data-rc="${key}"]`) : null;
      if (litCard && litCard !== next) litCard.classList.remove('focus');
      if (next) next.classList.add('focus');
      litCard = next;
    });
  });
  const readHome = latestRequest(base => getJSON(base + '/holy-api/home?v=2'));
  async function load() {
    const base = apiBase;
    if (!base) return;
    try {
      const result = await readHome(base);
      if (!result || apiBase !== base) return;
      const packed = result.value;
      const fresh = unpackHome(packed);
      if (!Array.isArray(fresh?.rows)) throw Error('formato');
      data = fresh;
      // Ask once what the owner thought of something they watched for a good while.
      const ask = fresh.askRating;
      if (ask?.key && !askedShown.has(ask.key) && !opening && !sheet && section === 'inicio') { askedShown.add(ask.key); openSheet(ask, true); }
      loadedVersions = fresh.catalogVersion + ':' + fresh.libraryVersion;
      notice = '';
      // The local copy (for an instant first screen next time) is written when the TV is idle.
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => { if (apiBase !== base) return; try { localStorage.setItem('holy-home', JSON.stringify(packed)); localStorage.setItem('holy-api', base); } catch { /* The computer keeps the real copy. */ } }, 2500);
    } catch { if (apiBase === base && !data.rows.length) notice = 'No se pudo leer el catálogo de la computadora. Revisa la aplicación Holy y Luma.'; }
  }
  function command(action, value) {
    if (typeof window.__lgLabCommand !== 'function') return false;
    try { window.__lgLabCommand(JSON.stringify({ action, value })); return true; } catch { return false; }
  }
  // Languages (audio / subtitles) of a title, from the Mac; kept by address. Only sites that
  // list several (DoramasFlix, Cuevana…) are asked; the rest answer at once with none.
  let versionInfo = $state.raw({});
  const hasVersions = item => !!data.sources.find(source => source.id === item?.source)?.versions;
  async function versionsFor(item) {
    if (!item?.url || !apiBase || !hasVersions(item)) return { versions: [], remembered: null };
    if (versionInfo[item.url]) return versionInfo[item.url];
    try {
      const info = await getJSON(`${apiBase}/holy-api/versions?source=${encodeURIComponent(item.source)}&url=${encodeURIComponent(item.url)}&show=${encodeURIComponent(item.show || '')}`, { timeout: 20000, retries: 0 });
      const value = { versions: Array.isArray(info?.versions) ? info.versions : [], remembered: info?.remembered || null };
      versionInfo = { ...versionInfo, [item.url]: value };
      return value;
    } catch { return { versions: [], remembered: null }; }
  }
  // «¿En qué idioma?»: asked the first time a series with several languages is opened; the
  // choice is remembered for that series (and can be changed from the pause panel).
  let langSheet = $state(null);
  async function chooseLanguage(version) {
    const current = langSheet;
    langSheet = null;
    if (!current) return;
    const item = current.item;
    if (version) { try { await getJSON(apiBase + '/holy-api/language', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ item: { source: item.source, url: item.url, show: item.show || '' }, version }), retries: 0 }); } catch { /* Played anyway; asked again next time. */ } }
    if (version) play(item, version);
  }
  async function play(item, chosen = null) {
    if (!item) return;
    const payload = $state.snapshot(item);
    for (const key of ['score', 'reason', 'percent', 'resume', 'layout', 'match', 'matchReason', 'vote']) delete payload[key];
    if (chosen) { payload.version = chosen.id; payload.versionKind = chosen.kind; }
    else if (!item.isShow && hasVersions(item) && !item.version) {
      opening = item; navigationError = '';
      const info = await versionsFor(item);
      if (opening !== item) return;
      if (info.versions.length > 1) {
        const remembered = info.remembered && (info.versions.find(version => version.id === info.remembered.id) || info.versions.find(version => version.kind === info.remembered.kind));
        if (remembered) { payload.version = remembered.id; payload.versionKind = remembered.kind; }
        else { opening = null; langSheet = { item, versions: info.versions, index: 0 }; return; }
      }
    }
    if (!command('play', payload)) { notice = 'Holy necesita la computadora para abrir títulos. Abre «npm run holy» y vuelve a intentar.'; return; }
    opening = item; navigationError = '';
    clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { if (opening === item) { opening = null; notice = 'El sitio no respondió. Intenta de nuevo u otro título.'; } }, 40000);
  }
  // Removing from «Continuar viendo» needs a second press of the red key, so one stray press loses nothing.
  let forgetArmed = { key: '', at: 0 };
  function forget(item) {
    if (row?.id !== 'continue' || !item?.key) return;
    if (forgetArmed.key !== item.key || Date.now() - forgetArmed.at > 4000) {
      forgetArmed = { key: item.key, at: Date.now() };
      notice = `Pulsa el botón rojo otra vez para quitar «${item.title}» de «Continuar viendo».`;
      return;
    }
    forgetArmed = { key: '', at: 0 };
    notice = `«${item.title}» se quitó de «Continuar viendo».`;
    command('forget', item.key);
    data = { ...data, rows: data.rows.map(entry => entry.id === 'continue' ? { ...entry, items: entry.items.filter(other => other.key !== item.key) } : entry) };
  }
  function chooseSection(id) {
    section = id; rowIndex = 0; inNav = false; episodesView = null; category = null;
    if (id === 'buscar') focusSearch();
    if (id === 'gustos') loadTaste();
  }
  const readTaste = latestRequest(base => getJSON(base + '/holy-api/taste'));
  async function loadTaste() {
    if (!apiBase) { notice = 'Conecta la computadora para calibrar tus gustos.'; return; }
    const base = apiBase;
    tasteLoading = true;
    try {
      const pending = await readTaste(base);
      if (!pending || apiBase !== base) return;
      const result = pending.value;
      tasteRows = Array.isArray(result?.rows) ? result.rows : [];
      taste = result?.taste || null;
    } catch { if (apiBase === base) notice = 'No se pudo leer tus gustos de la computadora.'; }
    finally { if (apiBase === base) tasteLoading = false; }
  }
  // OK: «me gusta» (again: quitar). Rojo: «no me gusta». The profile updates at once.
  const post = (payload, base = apiBase) => getJSON(base + '/holy-api/vote', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), retries: 0 });
  const plainItem = item => { const payload = $state.snapshot(item); for (const key of ['match', 'matchReason', 'vote', 'layout', 'score', 'reason', 'percent', 'resume', 'upNext']) delete payload[key]; return payload; };
  function openSheet(item, prompt = false) {
    if (!item?.url || item.chip) return;
    sheet = { item, prompt, index: Math.max(0, RATINGS.findIndex(entry => entry.value === (item.vote || 1))) };
  }
  // Marks the new rating on every card of that title, here and in «Gustos».
  function markVote(item, vote) {
    const key = item.show || item.url;
    const mark = row => ({ ...row, items: row.items.map(other => ((other.show || other.url) === key ? { ...other, vote } : other)) });
    tasteRows = tasteRows.map(mark);
    data = { ...data, rows: data.rows.map(mark) };
  }
  async function chooseRating(value) {
    const current = sheet;
    const base = apiBase;
    sheet = null;
    if (!current || !apiBase || value === undefined) return;
    try {
      if (value === null) { if (current.prompt) await post({ dismiss: plainItem(current.item) }, base); return; }
      const result = await post({ item: plainItem(current.item), vote: value }, base);
      if (apiBase !== base) return;
      taste = result.taste;
      markVote(current.item, value);
      notice = value ? `Guardado: «${RATINGS.find(entry => entry.value === value)?.label}». Tus porcentajes se actualizan.` : 'Calificación quitada.';
      load();
    } catch { if (apiBase === base) notice = 'No se guardó tu calificación. Revisa la conexión con la computadora.'; }
  }
  // «Gustos» chips: a genre, producer/studio or country you like (OK) or not (rojo).
  async function togglePref(chip, value) {
    const base = apiBase;
    const next = chip.value === value ? 0 : value;
    tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: next } : other)) }));
    try {
      const result = await post({ pref: { type: chip.type, name: chip.name, value: next } }, base);
      if (apiBase !== base) return;
      taste = result.taste;
      load();
    } catch { if (apiBase === base) { notice = 'No se guardó ese gusto. Revisa la conexión con la computadora.'; tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: chip.value } : other)) })); } }
  }
  async function rate(item, value) {
    if (!item?.url || !apiBase) return;
    if (item.chip) return togglePref(item, value);
    const base = apiBase;
    const vote = item.vote === value ? 0 : value;
    markVote(item, vote);
    try {
      const result = await post({ item: plainItem(item), vote }, base);
      if (apiBase !== base) return;
      taste = result.taste;
      load();
      // Fresh percentages for the cards on screen, without reshuffling the rows under the focus.
      const fresh = await getJSON(base + '/holy-api/taste', { retries: 0 }).catch(() => null);
      if (apiBase !== base) return;
      const matches = new Map((fresh?.rows || []).flatMap(row => row.items).map(entry => [entry.url, entry.match]));
      if (matches.size) tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (matches.has(other.url) ? { ...other, match: matches.get(other.url) } : other)) }));
    } catch { if (apiBase === base) { notice = 'No se guardó tu voto. Revisa la conexión con la computadora.'; markVote(item, item.vote || 0); } }
  }
  async function resetTaste() {
    if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); notice = 'Pulsa el botón amarillo otra vez para borrar tus gustos calibrados.'; return; }
    resetArmed = 0;
    const base = apiBase;
    try {
      await post({ vote: 'reset' }, base);
      if (apiBase !== base) return;
      notice = 'Gustos calibrados borrados. Lo que ves sigue contando.';
      await loadTaste(); load();
    } catch { if (apiBase === base) notice = 'No se pudieron borrar. Revisa la conexión con la computadora.'; }
  }
  function focusSearch() {
    inNav = false; inSearch = true;
    // Focusing the field opens the TV's on-screen keyboard.
    tick().then(() => searchInput?.focus());
  }
  // Blue key: straight to «Buscar» and voice, without the on-screen keyboard (it would take the
  // microphone: «already processing another request»). The TV listens and searches what it hears;
  // pressing blue again cancels. The keyboard only opens when OK is pressed on the search bar.
  // Without speech recognition the field opens for the keyboard's own microphone.
  let listening = $state(false);
  let recognizer = null;
  let voiceRetry = 0;
  // Between a cut-off and its automatic retry the microphone stays on screen.
  let voiceRetrying = $state(false);
  let voiceWatchdog;
  function stopListening() {
    clearTimeout(voiceWatchdog);
    const old = recognizer;
    recognizer = null; listening = false;
    if (!old) return;
    old.onresult = old.onerror = old.onend = null;
    try { old.abort(); } catch { /* Already over. */ }
  }
  function voiceSearch(retrying = false) {
    if (sheet || opening) return;
    episodesView = null; category = null; section = 'buscar'; rowIndex = 0; inNav = false; inSearch = true;
    searchInput?.blur();
    // A second press cancels at once: this TV's recogniser may never say it ended, so it is not waited for.
    if (listening && !retrying) { stopListening(); notice = ''; return; }
    // Whatever was left from before is closed first, and the new request waits a moment (the service answers «busy» otherwise).
    const leftover = recognizer;
    if (leftover) { stopListening(); setTimeout(() => voiceSearch(true), 700); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { focusSearch(); notice = 'Di lo que buscas con el micrófono del teclado o el de tu control.'; return; }
    try {
      const heard = new Speech();
      recognizer = heard;
      heard.lang = 'es-MX'; heard.interimResults = false; heard.maxAlternatives = 1;
      let answered = false;
      heard.onresult = event => {
        const text = String(event.results?.[0]?.[0]?.transcript || '').trim();
        if (!text) return;
        answered = true; voiceRetry = 0; query = text; notice = ''; search();
      };
      heard.onerror = event => {
        const kind = String(event?.error || '');
        // This TV's audio service often cuts a request off at once («aborted»): it is tried again by itself
        // (the service needs a moment), and only after that the owner is told.
        if (!answered && !['no-speech', 'not-allowed', 'service-not-allowed'].includes(kind) && voiceRetry < 2) {
          voiceRetry++; answered = true; recognizer = null; listening = false; voiceRetrying = true; clearTimeout(voiceWatchdog);
          setTimeout(() => { voiceRetrying = false; if (!listening && section === 'buscar') voiceSearch(true); }, 1800);
          return;
        }
        recognizer = null; listening = false; clearTimeout(voiceWatchdog);
        notice = kind === 'no-speech' ? 'No te escuché. Pulsa el botón azul para intentarlo otra vez.' : 'El procesador de audio es inestable. Vuelve a intentar.';
      };
      heard.onend = () => { if (recognizer === heard) { recognizer = null; listening = false; clearTimeout(voiceWatchdog); } };
      listening = true; notice = '';
      heard.start();
      // If the service never ends the request, give up after a while so the next press starts clean.
      voiceWatchdog = setTimeout(() => { if (recognizer === heard) { stopListening(); notice = 'El procesador de audio es inestable. Vuelve a intentar.'; } }, 12000);
    } catch { listening = false; recognizer = null; notice = 'El procesador de audio es inestable. Vuelve a intentar.'; }
  }
  function leaveSearch(direction) {
    inSearch = false; searchInput?.blur();
    if (direction === 'up') { inNav = true; navIndex = SECTIONS.findIndex(entry => entry.id === 'buscar'); }
  }
  function search() {
    clearTimeout(searchTimer);
    const words = query.trim();
    if (words.length < 2 || !apiBase) return;
    const token = ++searchToken;
    const base = apiBase;
    searchGroups = []; searchedFor = words; bestEpisodes = null; bestEpisodesFor = ''; rowIndex = 0;
    columns = Object.fromEntries(Object.entries(columns).filter(([id]) => !id.startsWith('s-')));
    const sources = [{ id: 'local', name: 'Tu catálogo' }, ...data.sources];
    searchStatus = sources.map(source => ({ id: source.id, name: source.name, state: 'loading' }));
    const started = Date.now();
    for (const source of sources) {
      getJSON(`${base}/holy-api/search?source=${encodeURIComponent(source.id)}&q=${encodeURIComponent(words)}`, { timeout: 20000, retries: 0 })
        .then(result => {
          if (!Array.isArray(result?.items)) throw Error('formato');
          if (token !== searchToken || apiBase !== base) return;
          const seconds = ((Date.now() - started) / 1000).toFixed(1).replace('.', ',');
          searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: result.error ? 'error' : 'done', count: result.items.length, seconds } : entry);
          if (!result.items.length) return;
          searchGroups = [...searchGroups, { id: 's-' + source.id, title: source.id === 'local' ? 'En tu catálogo' : `${source.name} · ${result.items.length}`, items: result.items }];
          showBestEpisodes(token);
        })
        .catch(() => { if (token === searchToken && apiBase === base) searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: 'error' } : entry); });
    }
  }
  // The best match is a whole series (One Piece): its newest episodes go right under it.
  function showBestEpisodes(token) {
    const base = apiBase;
    const top = $state.snapshot(bestResults(searchGroups, searchedFor, data.preferred || PREFERRED)[0]);
    if (!top?.isShow || !top.show || searchScore(top, searchedFor) < 3 || bestEpisodesFor === top.url) return;
    bestEpisodesFor = top.url;
    getJSON(`${base}/holy-api/episodes?source=${encodeURIComponent(top.source)}&show=${encodeURIComponent(top.show)}`, { timeout: 30000, retries: 0 })
      .then(result => {
        const season = Array.isArray(result?.seasons) ? result.seasons[0] : null;
        if (token !== searchToken || apiBase !== base || bestEpisodesFor !== top.url || !season?.episodes?.length) return;
        const [row] = episodeRows(top, [season]);
        bestEpisodes = { show: top.url, row: { ...row, id: 's-best-episodes', title: `${top.title} · ${season.title}` } };
      })
      .catch(() => {});
  }
  function typed() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 700);
  }
  let episodesToken = 0;
  // at: the episode to focus (coming back from watching it).
  async function openEpisodes(show, at = '') {
    // $state stores a proxy, so the pending request is matched by token, not identity.
    const token = ++episodesToken;
    const base = apiBase;
    const view = { token, show: $state.snapshot(show), seasons: [], loading: true, error: '', from: { rowIndex } };
    episodesView = view; rowIndex = 0; inSearch = false; inNav = false; searchInput?.blur();
    try {
      const result = await getJSON(`${base}/holy-api/episodes?source=${encodeURIComponent(show.source)}&show=${encodeURIComponent(show.show)}`, { timeout: 30000 });
      if (episodesView?.token !== token || apiBase !== base) return;
      const seasons = Array.isArray(result?.seasons) ? result.seasons : [];
      episodesView = { ...view, seasons, loading: false, error: result?.error || (seasons.length ? '' : 'No se encontraron episodios.') };
      // Back from an episode: its block and position, so the next one is a press away.
      const number = Number(show.episode) || 0;
      seasons.some((season, s) => season.episodes.some((entry, e) => {
        if (entry.url !== at && !(number && entry.episode === number)) return false;
        rowIndex = s; columns = { ...columns, ['season-' + s]: e };
        return true;
      }));
    } catch { if (episodesView?.token === token && apiBase === base) episodesView = { ...view, loading: false, error: 'No se pudo leer la lista de episodios.' }; }
  }
  // Coming back from an episode, the address carries its series (#episodes=…): open its list.
  function episodesFromAddress() {
    if (!location.hash.startsWith('#episodes=')) return;
    let show = null;
    try { show = JSON.parse(decodeURIComponent(location.hash.slice('#episodes='.length))); } catch { /* Not ours. */ }
    history.replaceState(null, '', location.pathname + location.search);
    if (!show?.show || !/^https:\/\//.test(show.show) || !show.source) return;
    section = 'inicio';
    openEpisodes(show, show.at || '');
  }
  function closeEpisodes() {
    const from = episodesView?.from;
    episodesView = null;
    rowIndex = from?.rowIndex || 0;
  }
  function choose(item) {
    if (!item) return;
    if(item.discover){chooseSection('buscar');query=item.classicQuery||item.title;inSearch=false;searchInput?.blur();search();notice=`Buscando ${item.title} (${item.classicYear}). Confirma el año de la versión.`;return;}
    if (item.chip) { togglePref(item, 1); return; }
    if (section === 'gustos' && !episodesView) rate(item, 1);
    else if (item.isShow) openEpisodes(item);
    else play(item);
  }
  function move(direction) {
    if (inNav) {
      if (direction === 'left') navIndex = Math.max(0, navIndex - 1);
      else if (direction === 'right') navIndex = Math.min(SECTIONS.length, navIndex + 1);
      else if (direction === 'down' && rows.length) inNav = false;
      return;
    }
    if (inSearch) {
      if (direction === 'up') leaveSearch('up');
      else if (direction === 'down' && rows.length) { leaveSearch('down'); rowIndex = 0; }
      return;
    }
    if (!row) { if (direction === 'up') { if (section === 'buscar' && !episodesView) focusSearch(); else inNav = true; } return; }
    if (direction === 'left' || direction === 'right') {
      const next = Math.max(row.genre ? -1 : 0, Math.min(row.items.length - 1, column + (direction === 'right' ? 1 : -1)));
      columns = { ...columns, [row.id]: next };
    } else if (direction === 'up') {
      if (rowIndex === 0 && section === 'buscar' && !episodesView) focusSearch();
      else if (rowIndex === 0) { inNav = true; navIndex = Math.max(0, SECTIONS.findIndex(entry => entry.id === section)); }
      else rowIndex--;
    } else if (direction === 'down' && rowIndex < rows.length - 1) rowIndex++;
  }
  function remote(event) {
    const code = event.keyCode;
    if (navigationError) return;
    if (code === 406) { event.preventDefault(); voiceRetry = 0; voiceSearch(); return; }
    const direction = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code];
    keyAt = Date.now();
    // First arrow after using the pointer only brings the focus back (on that card).
    if (!sheet && leavePointer() && direction) { event.preventDefault(); return; }
    // The rating sheet has the remote while open.
    if (langSheet) {
      event.preventDefault();
      const last = langSheet.versions.length - 1;
      if (direction === 'left' || direction === 'up') langSheet = { ...langSheet, index: Math.max(0, langSheet.index - 1) };
      else if (direction === 'right' || direction === 'down') langSheet = { ...langSheet, index: Math.min(last, langSheet.index + 1) };
      else if (code === 13) chooseLanguage(langSheet.versions[langSheet.index]);
      else if (code === 461 || code === 27) chooseLanguage(null);
      return;
    }
    if (sheet) {
      event.preventDefault();
      const options = RATINGS.length + 1;
      if (direction === 'left') sheet = { ...sheet, index: Math.max(0, sheet.index - 1) };
      else if (direction === 'right') sheet = { ...sheet, index: Math.min(options - 1, sheet.index + 1) };
      else if (code === 13) chooseRating(sheet.index < RATINGS.length ? RATINGS[sheet.index].value : sheet.prompt ? null : 0);
      else if (code === 461 || code === 27) chooseRating(sheet.prompt ? null : undefined);
      return;
    }
    // While typing, letters and left/right belong to the field; Enter submits it.
    if (inSearch && document.activeElement === searchInput) {
      if (direction === 'up' || direction === 'down') { event.preventDefault(); move(direction); }
      else if (code === 461 || code === 27) { event.preventDefault(); leaveSearch(rows.length ? 'down' : 'up'); }
      return;
    }
    if (direction) { event.preventDefault(); if (!opening) move(direction); return; }
    if (code === 13) {
      event.preventDefault();
      if (opening) return;
      if (inNav) { if (navIndex === SECTIONS.length) refresh(); else chooseSection(SECTIONS[navIndex].id); }
      else if (inSearch) focusSearch();
      else if (column === -1 && row?.genre) openCategory(row);
      else choose(focused);
    } else if (code === 403) { event.preventDefault(); if (section === 'gustos' && !inNav) rate(focused, -1); else forget(focused); }
    else if (code === 404 && !inNav && focused && !focused.chip && !focused.discover) { event.preventDefault(); openSheet(focused); }
    else if (code === 405 && section === 'gustos') { event.preventDefault(); resetTaste(); }
    else if (code === 461 || code === 27) {
      event.preventDefault();
      if (opening) { opening = null; command('home'); }
      else if (episodesView) closeEpisodes();
      else if (category) closeCategory();
      else if (inNav) inNav = false;
      else if (rowIndex > 0) rowIndex = 0;
      else if (section !== 'inicio') chooseSection('inicio');
      else leaveApp();
    }
  }
  // Holy handles Back itself (appinfo disableBackHistoryAPI): at the top of the home, twice exits.
  let exitArmed = 0;
  function leaveApp() {
    if (Date.now() - exitArmed > 3000) { exitArmed = Date.now(); notice = 'Pulsa Atrás otra vez para salir de Holy.'; return; }
    const system = window.webOSSystem || window.PalmSystem;
    try { if (system?.platformBack) { system.platformBack(); return; } } catch { /* Try closing below. */ }
    window.close();
  }
  function refresh() {
    notice = 'Buscando estrenos en tus sitios…';
    if (!command('refresh-catalog') && apiBase) fetch(apiBase + '/holy-api/refresh', { method: 'POST', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    setTimeout(load, 4000);
  }
  // Pointer (Magic Remote): hovering focuses, clicking plays.
  function hover(r, c) {
    if (!realPointer()) return;
    pointing = true;
    clearTimeout(pointerTimer);
    // A short rest before lighting up: passing over cards does not flicker the preview.
    pointerTimer = setTimeout(() => { pointer = { r, c }; inNav = false; }, 110);
  }
  function unhover() { clearTimeout(pointerTimer); }
  function pick(r, c, item) { clearTimeout(pointerTimer); pointing = true; pointer = { r, c }; inNav = false; inSearch = false; choose(item); }
  // Back to the keys: focus starts where the pointer was.
  function leavePointer() {
    if (!pointing) return false;
    clearTimeout(pointerTimer);
    if (pointer && rows[pointer.r]) {
      const id = rows[pointer.r].id;
      rowIndex = pointer.r;
      columns = { ...columns, [id]: pointer.c };
    }
    pointing = false; pointer = null;
    return true;
  }
  // Row edge arrows: a gentle page of five cards.
  function page(shelf, step) {
    const at = columns[shelf.id] || 0;
    columns = { ...columns, [shelf.id]: Math.max(0, Math.min(Math.max(0, shelf.items.length - 5), at + step * 5)) };
    pointer = null;
  }
  // The wheel moves between rows, one per notch.
  function wheel(event) {
    keyAt = 0;
    if (!rows.length || Date.now() - wheelAt < 380 || Math.abs(event.deltaY) < 4) return;
    wheelAt = Date.now();
    event.preventDefault();
    pointing = true; pointer = null; inNav = false; inSearch = false;
    rowIndex = Math.max(0, Math.min(rows.length - 1, rowIndex + (event.deltaY > 0 ? 1 : -1)));
  }

  onMount(() => {
    try {
      const cached = unpackHome(JSON.parse(localStorage.getItem('holy-home') || 'null'));
      if (cached?.rows) data = cached;
      if (!apiBase) apiBase = localStorage.getItem('holy-api') || '';
    } catch { /* No cache yet. */ }
    // webOS says when the Magic Remote pointer hides (after a key): back to the keys' focus.
    const clientError=event=>{
      if(!apiBase)return;
      const reason=event.reason||event.error||event.message;
      fetch(apiBase+'/holy-api/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:event.type,error:String(reason?.stack||reason?.message||reason||'').slice(0,1600)})}).catch(()=>{});
    };
    window.addEventListener('error',clientError);window.addEventListener('unhandledrejection',clientError);
    const cursor = event => { if (event.detail?.visibility === false) leavePointer(); };
    document.addEventListener('cursorStateChange', cursor);
    load(); checkMac();
    episodesFromAddress();
    window.addEventListener('hashchange', episodesFromAddress);
    const macTimer = setInterval(checkMac, 20000);
    const update = event => {
      const detail = event.detail || {};
      lastHeartbeat = Date.now();
      connected = !!detail.connected;
      const holy = detail.holy;
      if (holy?.apiBase && apiBase !== holy.apiBase) {
        apiBase = holy.apiBase; loadedVersions = ''; macReachable = true;
        clearTimeout(cacheTimer);
        searchToken++;
        if (episodesView?.show) openEpisodes(episodesView.show, episodesView.show.at || '');
        else if (section === 'buscar') search();
        else if (section === 'gustos') loadTaste();
      }
      if (holy && loadedVersions !== holy.catalogVersion + ':' + holy.libraryVersion) load();
      // While the Mac is still trying other servers or sites, a failed page is not the end.
      const retrying = ['resolving', 'opening'].includes(holy?.session?.phase);
      if (detail.navigation?.phase === 'error' && opening && !retrying) { opening = null; navigationError = detail.navigation.error; navigationTarget = detail.navigation.url || ''; }
      // The Mac refused a title whose only players close the app on this TV.
      if (holy?.session?.phase === 'failed' && opening) { opening = null; notice = holy.session.error; }
    };
    const heartbeat = setInterval(() => { if (connected && Date.now() - lastHeartbeat > 6500) connected = false; }, 2000);
    window.addEventListener('lg-lab-status', update);
    window.__lumaReady = true;
    return () => { window.removeEventListener('error',clientError);window.removeEventListener('unhandledrejection',clientError);window.removeEventListener('lg-lab-status', update); clearInterval(heartbeat); clearInterval(macTimer); document.removeEventListener('cursorStateChange', cursor); window.removeEventListener('hashchange', episodesFromAddress); clearTimeout(previewTimer); clearTimeout(openingTimer); clearTimeout(cacheTimer); clearTimeout(prepareTimer); clearTimeout(searchTimer); };
  });
</script>

<svelte:window onkeydown={remote} onmousemove={moved} />

<div class="app">
  <div class="backdrop" aria-hidden="true">
    {#key preview?.url}
      {#if preview?.backdrop || preview?.poster}
        <img class:poster-art={!preview.backdrop} src={img(preview.backdrop || preview.poster)} alt="" decoding="async" />
      {/if}
    {/key}
  </div>

  <header class="top">
    <div class="brand" aria-label="Holy">HOLY</div>
    <nav aria-label="Secciones">
      {#each SECTIONS as entry, index}
        <button class:current={section === entry.id} class:focus={inNav && navIndex === index} onclick={() => chooseSection(entry.id)}>{#if entry.id === 'buscar'}<Icon name="search" size={24} stroke={2.4} />{:else if entry.id === 'gustos'}<Icon name="sparkles" size={24} stroke={2.2} />{/if}{entry.name}</button>
      {/each}
      <button class="icon" class:focus={inNav && navIndex === SECTIONS.length} aria-label="Buscar estrenos ahora" onclick={refresh}><Icon name="reload" size={26} stroke={2.4} /></button>
    </nav>
    <span class="status {link}" role="status">{linkText}</span>
  </header>

  {#if section === 'buscar' && !episodesView}
    <form class="searchbar" class:focus={inSearch} onsubmit={event => { event.preventDefault(); search(); }}>
      <Icon name="search" size={34} stroke={2.4} />
      <input bind:this={searchInput} bind:value={query} oninput={typed} onfocus={() => { inSearch = true; inNav = false; }} placeholder={listening ? 'Escuchando… di lo que buscas' : 'Película, anime o dorama…'} autocomplete="off" spellcheck="false" aria-label="Buscar en todos los sitios" />
    </form>
    {#if searchStatus.length}
      <p class="sources-status">
        {#each searchStatus as entry}
          <span class={entry.state}>{entry.name}{entry.state === 'done' ? ` · ${entry.count} · ${entry.seconds} s` : entry.state === 'error' ? ' · sin respuesta' : ' · buscando…'}</span>
        {/each}
      </p>
    {/if}
  {/if}

  {#if section === 'gustos' && !episodesView}
    <aside class="taste" aria-label="Tu perfil de gustos">
      <h2>Tu perfil</h2>
      <p class="taste-sync">{data.profileSync?.state==='synced'?'Gustos compartidos con tus computadoras':'Gustos guardados en esta computadora'} · confianza {profile?.confidence||'inicial'}</p>
      {#if !isTV}<div class="taste-transfer"><a href={apiBase+'/holy-api/taste-profile'} download="holy-gustos.json">Exportar gustos</a><label>Importar gustos<input type="file" accept=".json,application/json" onchange={importTastes} /></label></div>{/if}
      {#if profile && profile.signals >= 2}
        <p class="taste-count">{profile.liked} me gusta ({profile.loved || 0} me encanta) · {profile.disliked} no · {profile.prefs || 0} gustos elegidos · {profile.watched} vistos</p>
        {#each profile.genres.slice(0, 6) as entry}
          <div class="bar"><span class="bar-name">{entry.name}</span><span class="bar-track"><span style:width={entry.value + '%'}></span></span></div>
        {/each}
        {#if profile.avoid.length}<p class="avoid">Evitas: {profile.avoid.map(entry => entry.name).join(', ')}</p>{/if}
        {#if profile.studios?.length}<p class="taste-line">Productoras: {profile.studios.map(entry => entry.name).join(', ')}</p>{/if}
        {#if profile.countries?.length}<p class="taste-line">Países: {profile.countries.map(entry => entry.name).join(', ')}</p>{/if}
      {:else}
        <p class="taste-count">Califica al menos dos títulos para que Holy calcule cuánto te puede gustar cada uno.</p>
      {/if}
      <p class="taste-keys"><span class="key">OK</span>Me gusta <span class="key red-key"></span>No me gusta <span class="key green-key"></span>Me encanta… <span class="key yellow-key"></span>Borrar</p>
    </aside>
  {/if}

  {#if preview && !(section === 'buscar' && !episodesView && (inSearch || !rows.length)) && !(section === 'gustos' && !episodesView && !focused)}
    <section class="preview" class:lower={section === 'buscar' && !episodesView} aria-live="polite">
      {#key preview.url}
        <div class="preview-text">
          {#if preview.reason}<p class="reason">{preview.reason}</p>{/if}
          <h1 class:long={(preview.title || '').length > 28}>{preview.title || ''}</h1>
          <p class="meta">
            {#if preview.match != null}<span class="match {matchTone(preview.match)}">{preview.match} % para ti</span>{/if}
            {#if preview.upNext}<span class="pill red">Siguiente</span>{/if}
            {#if preview.subtitle}<span class="strong">{preview.subtitle}</span>{/if}
            {#if versionInfo[preview.url]?.versions?.length > 1}<span class="pill lang">{versionInfo[preview.url].versions.map(version => version.label).join(' · ')}</span>
            {:else if preview.language}<span class="pill lang">{preview.language}</span>{/if}
            {#if preview.year}<span>{preview.year}</span>{/if}
            {#if Number(preview.rating) > 0}<span>★ {preview.rating}</span>{/if}
            {#if preview.badge && !preview.subtitle?.includes(preview.badge.replace(/\D/g, '') || '§')}<span class="pill">{preview.badge}</span>{/if}
            <span>{kindLabel(preview.kind)}{sourceName(preview.source) ? ' · ' + sourceName(preview.source) : ''}</span>
          </p>
          {#if preview.classicRank}<p class="genres">Top {preview.classicRank} · AniList {preview.classicScore}/100 · versión de {preview.classicYear}</p>{/if}
          {#if preview.genres?.length}<p class="genres">{preview.genres.slice(0, 4).join(' · ')}</p>{/if}
          {#if preview.overview}<p class="overview">{preview.overview}</p>{/if}
          <p class="hint">
            {#if section === 'gustos' && !episodesView}
              <span class="key">OK</span>{preview.vote === 1 ? 'Quitar «me gusta»' : 'Me gusta'}<span class="key red-key"></span>{preview.vote === -1 ? 'Quitar «no me gusta»' : 'No me gusta'}
            {:else}
            <span class="key">OK</span>{preview.discover ? 'Buscar en tus sitios' : preview.isShow ? 'Ver episodios' : preview.resume ? 'Continuar desde ' + clock(preview.t) : preview.upNext ? 'Ver ' + (preview.subtitle || 'siguiente') : 'Reproducir'}
            {#if preview.resume && preview.duration}<span class="left">{remaining(preview.t, preview.duration)}</span>{/if}
            {#if row?.id === 'continue' && !inNav}<span class="key red-key"></span>Quitar de la fila (2 veces){/if}
            {/if}
            {#if !preview.chip && !preview.discover && !inNav}<span class="key green-key"></span>{preview.vote === 2 ? 'Te encanta' : preview.vote === 1 ? 'Te gusta' : preview.vote === -1 ? 'No es para ti' : 'Calificar'}{/if}
            <span class="key blue-key"></span>Buscar con la voz
          </p>
          {#if preview.matchReason && preview.match != null}<p class="match-reason">{preview.matchReason}</p>{/if}
        </div>
      {/key}
    </section>
  {/if}

    {#if category && !episodesView}<div class="category-heading"><button onclick={closeCategory}>‹ Volver</button><strong>{category.title}</strong><span>Catálogo disponible · ← al inicio de una fila abre el género</span></div>{/if}
  <main class="shelves" class:nav-focus={inNav} class:pointing onwheel={wheel}>
    {#if !rows.length}
      <div class="empty">
        {#if episodesView}
          <h2>{episodesView.loading ? 'Cargando episodios de ' + episodesView.show.title + '…' : episodesView.error}</h2>
          <p>Atrás vuelve a los resultados.</p>
        {:else if section === 'gustos'}
          <h2>{tasteLoading ? 'Preparando títulos para calificar…' : 'No hay títulos para calificar todavía.'}</h2>
          <p>Holy usa el catálogo de tus sitios. Vuelve cuando termine de leerlos.</p>
        {:else if section === 'buscar'}
          <h2>{searchStatus.length && searchStatus.every(entry => entry.state !== 'loading') ? 'Sin resultados para «' + query.trim() + '»' : searchStatus.length ? 'Buscando en todos tus sitios…' : 'Busca en todos tus sitios a la vez'}</h2>
          <p>{data.sources.filter(source => source.search).map(source => source.name).join(', ') || 'Todos tus sitios'}. Los que respondan primero aparecen primero. Botón azul del control: buscar con la voz.</p>
        {:else if notice || !apiBase}
          <h2>{notice || 'Conectando con la computadora…'}</h2>
          <p>Holy toma los estrenos de tus sitios favoritos y los ordena según lo que ves.</p>
        {/if}
        {#if (episodesView?.loading || (section === 'gustos' && tasteLoading) || (!episodesView && section !== 'buscar' && section !== 'gustos' && !notice && apiBase))}
          <!-- Waiting looks like the rows that are coming. -->
          <div class="skeleton" aria-hidden="true">
            {#each [0, 1] as line}<div class="skeleton-row"><span class="skeleton-title"></span><div>{#each Array(8) as _, index}<span class="skeleton-card" class:wide={episodesView} style:animation-delay={`${(line * 8 + index) * 60}ms`}></span>{/each}</div></div>{/each}
          </div>
        {/if}
      </div>
    {/if}
    <div class="rows" bind:this={rowsEl}>
      {#each rows as shelf, r (section + shelf.id)}
        <section class="row" class:landscape-row={shelf.layout === 'landscape'} class:chip-row={shelf.layout === 'chip'} class:active={!inNav && !inSearch && r === rowIndex} class:past={r < rowIndex} aria-label={shelf.title}>
          <h2>{#if shelf.genre}<button class="genre-link" class:genre-focus={!inNav && !pointing && r === rowIndex && column === -1} onclick={() => openCategory(shelf)}>{shelf.title} <span>Ver todas ›</span></button>{:else}{shelf.title}{/if}</h2>
          {#if shelf.note}<p class="shelf-note">{shelf.note}</p>{/if}
          <div class="track-clip">
            {#if pointing && Math.abs(r - rowIndex) <= 2}
              {#if (columns[shelf.id] || 0) > 0}<button class="page-arrow left" aria-label="Anteriores" onclick={() => page(shelf, -1)}>‹</button>{/if}
              {#if (columns[shelf.id] || 0) < shelf.items.length - 5}<button class="page-arrow right" aria-label="Siguientes" onclick={() => page(shelf, 1)}>›</button>{/if}
            {/if}
            <div class="track" style:transform={`translateX(${-(columns[shelf.id] || 0) * (cardWidth(shelf.layout) + 20)}px)`}>
              {#if sliceStart(shelf) > 0 && drawn(shelf, r).length}<span class="spacer" style:width={`${sliceStart(shelf) * (cardWidth(shelf.layout) + 20) - 20}px`}></span>{/if}
              {#each drawn(shelf, r) as item, i (item.url + '|' + (sliceStart(shelf) + i))}
                {@const c = sliceStart(shelf) + i}
                {#if item.chip}
                <button class="card chip" data-rc={r + ':' + c} class:liked={item.value === 1} class:disliked={item.value === -1} aria-label={item.title + (item.value === 1 ? ', te gusta' : item.value === -1 ? ', no te gusta' : '')}
                  onmouseenter={() => hover(r, c)} onmouseleave={unhover} onclick={() => pick(r, c, item)}>
                  <span class="chip-art"><strong>{item.title}</strong><small>{item.count} títulos</small>
                    {#if item.value === 1}<span class="vote like"><Icon name="check" size={22} stroke={3} /></span>{:else if item.value === -1}<span class="vote dislike"><Icon name="minus" size={22} stroke={3} /></span>{/if}
                  </span>
                </button>
                {:else}
                <button class="card" data-rc={r + ':' + c} class:landscape={shelf.layout === 'landscape'} aria-label={(item.title || '') + (item.subtitle ? ', ' + item.subtitle : '')}
                  onmouseenter={() => hover(r, c)} onmouseleave={unhover} onclick={() => pick(r, c, item)}>
                  <span class="art">
                    <span class="fallback">{item.title || ''}</span>
                    {#if shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop}
                      <img src={img(shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop)} alt="" loading={c < 8 ? 'eager' : 'lazy'} decoding="async" onload={event => event.currentTarget.classList.add('ready')} onerror={event => event.currentTarget.remove()} />
                    {/if}
                    {#if item.badge && shelf.layout !== 'landscape'}<span class="badge">{item.badge}</span>{/if}
                    {#if languageTag(item.language)}<span class="lang-tag">{languageTag(item.language)}</span>{/if}
                    {#if shelf.layout === 'landscape'}
                      <span class="caption"><strong>{item.title}</strong>{#if item.subtitle}<small>{item.subtitle}</small>{/if}</span>
                    {/if}
                    {#if item.percent}<span class="progress"><span style:width={item.percent + '%'}></span></span>{/if}
                    {#if item.upNext}<span class="next">Siguiente</span>{/if}
                    {#if item.match != null && !item.percent}<span class="match-badge {matchTone(item.match)}">{item.match} %</span>{/if}
                    {#if item.vote === 2}<span class="vote love"><Icon name="star" size={22} stroke={2.6} /></span>{:else if item.vote === 1}<span class="vote like"><Icon name="check" size={24} stroke={3} /></span>{:else if item.vote === -1}<span class="vote dislike"><Icon name="minus" size={24} stroke={3} /></span>{/if}
                  </span>
                </button>
                {/if}
              {/each}
            </div>
          </div>
        </section>
      {/each}
    </div>
  </main>

  {#if notice && (rows.length || section === 'buscar')}<div class="toast" role="status">{notice}</div>{/if}
</div>

{#if opening}
  <div class="opening" role="status">
    {#if opening.backdrop || opening.poster}<img src={img(opening.backdrop || opening.poster)} alt="" />{/if}
    <div class="opening-text">
      <div class="brand small">HOLY</div>
      <h1>{opening.title}</h1>
      {#if opening.subtitle}<p>{opening.subtitle}</p>{/if}
      <div class="spin"><span class="ring"></span>{opening.resume ? 'Volviendo a donde te quedaste…' : 'Abriendo…'}</div>
    </div>
  </div>
{/if}

{#if listening || voiceRetrying}
  <div class="listening" role="status" aria-live="assertive">
    <div class="mic"><span class="wave"></span><span class="wave late"></span><span class="mic-icon"><Icon name="mic" size={84} stroke={2} /></span></div>
    <h2>Escuchando…</h2>
    <p>Di el nombre de lo que buscas</p>
    <p class="listening-key"><span class="key blue-key"></span>Pulsa otra vez para cancelar</p>
  </div>
{/if}

{#if sheet}
  <div class="sheet-scrim" role="dialog" aria-label={'Calificar ' + (sheet.item.title || '')}>
    <div class="sheet">
      <p class="sheet-kicker">{sheet.prompt ? '¿Qué te pareció?' : 'Calificar'}</p>
      <h2>{sheet.item.title}</h2>
      {#if sheet.item.subtitle}<p class="sheet-sub">{sheet.item.subtitle}</p>{/if}
      <div class="sheet-options">
        {#each RATINGS as option, index}
          <button class="sheet-option" class:focus={sheet.index === index} class:current={sheet.item.vote === option.value} onclick={() => chooseRating(option.value)}>
            <span class="sheet-icon {option.value === 2 ? 'love' : option.value === 1 ? 'like' : 'dislike'}"><Icon name={option.icon} size={34} stroke={2.6} /></span>{option.label}
          </button>
        {/each}
        <button class="sheet-option plain" class:focus={sheet.index === RATINGS.length} onclick={() => chooseRating(sheet.prompt ? null : 0)}>{sheet.prompt ? 'Ahora no' : 'Quitar'}</button>
      </div>
      <p class="sheet-note">Tu calificación ajusta el % de coincidencia de todo el catálogo.</p>
    </div>
  </div>
{/if}

{#if langSheet}
  <div class="sheet-scrim" role="dialog" aria-label={'Idioma de ' + (langSheet.item.title || '')}>
    <div class="sheet">
      <p class="sheet-kicker">¿En qué idioma?</p>
      <h2>{langSheet.item.title}</h2>
      {#if langSheet.item.subtitle}<p class="sheet-sub">{langSheet.item.subtitle}</p>{/if}
      <div class="sheet-options lang-options">
        {#each langSheet.versions as version, index}
          <button class="sheet-option" class:focus={langSheet.index === index} onclick={() => chooseLanguage(version)}>
            <span class="lang-kind {version.kind}">{{ dub: 'ES', sub: 'SUB', orig: 'ORIG' }[version.kind]}</span>{version.label}
          </button>
        {/each}
      </div>
      <p class="sheet-note">Se recuerda para esta serie. Cámbialo en pausa con «Idioma».</p>
    </div>
  </div>
{/if}

<NavigationFeedback error={navigationError} target={navigationTarget} onretry={() => { navigationError = ''; play(focused); }} onhome={() => { navigationError = ''; command('home'); }} />

<style>
  .shelf-note{margin:0 96px;font-size:18px;color:#b6bdc8}
  .lang-options{flex-direction:column;align-items:stretch}
  .lang-kind{min-width:76px;padding:4px 12px;border-radius:8px;font-size:19px;font-weight:800;letter-spacing:.5px;text-align:center;background:#2e9e4f;color:#fff}
  .lang-kind.sub{background:#1f78e3}.lang-kind.orig{background:#6b6b6b}
  .taste-sync{font-size:17px;color:#b6c8e0;margin:8px 0}
  .taste-transfer{display:flex;gap:16px;font-size:17px;margin:8px 0}
  .taste-transfer a,.taste-transfer label{color:#c9ddff;cursor:pointer;text-decoration:underline}
  .taste-transfer input{display:none}

  .genre-link { background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 4px 12px; border-radius: 12px; }
  .genre-link span { font-size: 18px; opacity: .65; margin-left: 16px; }
  .genre-link:hover, .genre-link:focus-visible, .genre-focus { outline: 3px solid #a8d9ff; background: #ffffff18; }
  .category-heading { position: absolute; top: 550px; left: 80px; display: flex; gap: 22px; align-items: center; z-index: 3; }
  .category-heading button { background: #222b3c; color: white; border: 1px solid #ffffff50; border-radius: 12px; padding: 10px 20px; font-size: 20px; cursor: pointer; }
  .category-heading strong { font-size: 28px; }
  .category-heading span { font-size: 17px; opacity: .7; }

  :global(:root){
    --bg:#000;--text:#fff;--secondary:#c8c8c8;--tertiary:#8c8c8c;--red:#e50914;--surface:#181818;--fill:rgba(255,255,255,.14);--blue:#e50914;--orange:#ffb020;
    --shadow:0 20px 50px rgba(0,0,0,.5);--ease:cubic-bezier(.2,.8,.2,1);--spring:cubic-bezier(.34,1.4,.64,1);color-scheme:dark;
  }
  :global(*){box-sizing:border-box}
  :global(html),:global(body){margin:0;height:100%;overflow:hidden;background:var(--bg)}
  :global(body){font-family:"LG Smart UI","Helvetica Neue",Helvetica,Arial,system-ui,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased}
  :global(button){font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
  @media (prefers-reduced-motion:reduce){:global(*){animation:none!important;transition:none!important}}

  .app{position:relative;width:1920px;height:1080px;overflow:hidden;background:#000}
  .backdrop{position:absolute;top:0;right:0;width:1380px;height:776px}
  .backdrop img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:fade .7s var(--ease)}
  .backdrop img.poster-art{object-fit:cover;filter:blur(2px) brightness(.8);transform:scale(1.04)}
  .backdrop::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#000 0%,rgba(0,0,0,.86) 22%,rgba(0,0,0,.35) 55%,rgba(0,0,0,.1) 100%),linear-gradient(0deg,#000 0%,rgba(0,0,0,.75) 22%,transparent 55%)}

  .top{position:absolute;top:0;left:0;right:0;z-index:5;display:flex;align-items:center;gap:56px;height:118px;padding:0 96px;background:linear-gradient(180deg,rgba(0,0,0,.8),transparent)}
  .brand{font-size:46px;font-weight:900;letter-spacing:8px;color:var(--red);text-shadow:0 3px 16px rgba(229,9,20,.35)}
  .brand.small{font-size:26px;letter-spacing:6px;margin-bottom:20px}
  nav{display:flex;align-items:center;gap:10px}
  nav button{height:54px;padding:0 22px;border:0;border-radius:27px;background:transparent;font-size:25px;font-weight:500;color:#d0d0d0;transition:background .2s,color .2s,transform .3s var(--spring)}
  nav button.current{color:#fff;font-weight:700}
  nav button.icon{width:54px;padding:0;display:grid;place-items:center}
  nav button.focus,nav button:hover{background:#fff;color:#000;transform:scale(1.08)}
  .status{margin-left:auto;font-size:20px;color:#9fe3a8;display:flex;align-items:center;gap:10px}
  .status::before{content:'';width:12px;height:12px;border-radius:50%;background:currentColor}
  .status.orange{color:#ffb020}
  .status.red{color:#ff5a52}

  .preview{position:absolute;left:96px;top:150px;width:900px;z-index:2}
  .preview-text{animation:rise .45s var(--ease)}
  .reason{margin:0 0 12px;font-size:22px;font-weight:700;letter-spacing:1px;color:#ff5a5f;text-transform:uppercase}
  .preview h1{margin:0 0 18px;font-size:76px;line-height:1.02;font-weight:800;letter-spacing:-1.5px;text-shadow:0 4px 30px rgba(0,0,0,.6);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .preview h1.long{font-size:60px}
  .meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;margin:0 0 10px;font-size:25px;color:#e6e6e6}
  .meta .strong{font-weight:700;color:#fff}
  .pill{padding:2px 10px;border:2px solid rgba(255,255,255,.55);border-radius:6px;font-size:19px;font-weight:700;letter-spacing:.5px}
  .pill.red{background:var(--red);border-color:var(--red)}
  .genres{margin:0 0 16px;font-size:22px;color:var(--secondary)}
  .overview{margin:0;font-size:24px;line-height:1.42;color:#d9d9d9;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 12px rgba(0,0,0,.8)}
  .hint{display:flex;align-items:center;gap:14px;margin:24px 0 0;font-size:22px;color:#fff}
  .key{display:inline-grid;place-items:center;min-width:52px;height:34px;padding:0 10px;border-radius:8px;background:#fff;color:#000;font-size:17px;font-weight:800}
  .red-key{min-width:34px;width:34px;border-radius:50%;background:#e31f26;margin-left:18px}
  .left{color:var(--secondary);margin-left:6px}

  .shelves{position:absolute;left:0;right:0;top:612px;bottom:0;overflow:hidden;z-index:3;transition:opacity .3s}
  .shelves.nav-focus{opacity:.55}
  .rows{transition:transform .45s var(--ease);will-change:transform}
  /* Rows off screen are not painted (built rows stay in the page, ready to slide in). */
  .row{padding:0 0 26px;transition:opacity .35s;animation:fade .3s ease-out;content-visibility:auto;contain-intrinsic-size:auto 420px}
  .row.past{opacity:0}
  .row h2{margin:0 0 4px 96px;font-size:30px;font-weight:700;color:#e5e5e5;letter-spacing:-.2px}
  .row.active h2{color:#fff}
  .track-clip{position:relative;overflow:hidden;padding:18px 0 24px 96px}
  .page-arrow{position:absolute;top:18px;bottom:24px;z-index:4;width:84px;border:0;padding:0;font-size:84px;line-height:1;color:#fff;opacity:.55;transition:opacity .25s,background .25s}
  .page-arrow.left{left:0;background:linear-gradient(90deg,rgba(0,0,0,.85),transparent)}
  .page-arrow.right{right:0;background:linear-gradient(270deg,rgba(0,0,0,.85),transparent)}
  .page-arrow:hover{opacity:1;background-color:rgba(0,0,0,.35)}
  .shelves.pointing .track{transition:transform .7s cubic-bezier(.22,.61,.36,1)}
  .shelves.pointing .card{transition:transform .35s cubic-bezier(.22,.61,.36,1)}
  .track{display:flex;gap:20px;min-height:345px;transition:transform .4s var(--ease);will-change:transform}
  .landscape-row .track{min-height:225px}
  .chip-row .track{min-height:120px}
  .card{flex:none;width:230px;padding:0;border:0;background:none;border-radius:10px;transition:transform .3s var(--ease)}
  .card.landscape{width:400px}
  .art{position:relative;display:block;width:100%;aspect-ratio:2/3;border-radius:10px;overflow:hidden;background:#1f1f1f;box-shadow:0 8px 20px rgba(0,0,0,.5)}
  .landscape .art{aspect-ratio:16/9}
  .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s ease-out}
  .art img:global(.ready){opacity:1}
  .spacer{flex:none;height:1px}
  .fallback{position:absolute;inset:0;display:flex;align-items:flex-end;padding:16px;font-size:22px;font-weight:700;text-align:left;color:#bbb;background:linear-gradient(160deg,#2a2a2a,#121212)}
  .badge{position:absolute;top:10px;left:10px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.72);font-size:16px;font-weight:700;letter-spacing:.4px}
  .caption{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:2px;padding:44px 16px 14px;text-align:left;background:linear-gradient(transparent,rgba(0,0,0,.92))}
  .caption strong{font-size:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .caption small{font-size:18px;color:#cfcfcf}
  .progress{position:absolute;left:14px;right:14px;bottom:8px;height:6px;border-radius:3px;background:rgba(255,255,255,.3)}
  .progress span{display:block;height:100%;border-radius:3px;background:var(--red)}
  .landscape .progress{bottom:6px}
  .next{position:absolute;top:10px;right:10px;padding:3px 10px;border-radius:6px;background:var(--red);font-size:16px;font-weight:800}
  .card:global(.focus){transform:scale(1.1);z-index:2}
  .card:global(.focus) .art{box-shadow:0 0 0 4px #fff,0 18px 40px rgba(0,0,0,.7)}
  .card:focus{outline:none}

  .empty{position:absolute;left:96px;top:40px;max-width:1100px}
  .match{font-weight:800}
  .match.high{color:#46d369}.match.mid{color:#f5c518}.match.low{color:#a3a3a3}
  .match-reason{margin:10px 0 0;font-size:20px;color:#b9e8c4}
  .match-badge{position:absolute;left:10px;bottom:12px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.78);font-size:17px;font-weight:800}
  .listening{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.78);animation:rise .3s var(--ease);pointer-events:none}
  .listening h2{margin:28px 0 0;font-size:54px;font-weight:800}
  .listening p{margin:0;font-size:28px;color:#cfcfcf}
  .listening-key{margin-top:26px!important;display:flex;align-items:center;font-size:22px!important}
  .listening-key .blue-key{margin:0 12px 0 0}
  .mic{position:relative;width:200px;height:200px;display:grid;place-items:center}
  .mic-icon{position:relative;z-index:1;width:160px;height:160px;border-radius:50%;background:#1f78e3;display:grid;place-items:center;color:#fff;box-shadow:0 10px 40px rgba(31,120,227,.55)}
  .wave{position:absolute;inset:0;border-radius:50%;border:4px solid #1f78e3;opacity:0;animation:pulse 1.8s ease-out infinite}
  .wave.late{animation-delay:.9s}
  @keyframes pulse{0%{transform:scale(.8);opacity:.9}100%{transform:scale(1.9);opacity:0}}
  .lang-tag{position:absolute;right:10px;bottom:12px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.78);font-size:16px;font-weight:800;letter-spacing:.5px;color:#fff}
  .landscape .lang-tag{bottom:auto;top:46px}
  .pill.lang{background:rgba(255,255,255,.16);color:#fff}
  .match-badge.high{color:#46d369}.match-badge.mid{color:#f5c518}.match-badge.low{color:#bdbdbd}
  .landscape .match-badge{left:auto;right:10px;bottom:auto;top:10px}
  .vote{position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.5)}
  .vote.like{background:#2e9e4f}.vote.dislike{background:#e31f26}
  .taste{position:absolute;right:96px;top:140px;z-index:4;width:600px;padding:28px 32px;border-radius:18px;background:rgba(20,20,20,.9);border:1px solid rgba(255,255,255,.12)}
  .taste h2{margin:0 0 6px;font-size:32px}
  .taste-count{margin:0 0 18px;font-size:20px;color:var(--secondary)}
  .bar{display:flex;align-items:center;gap:16px;margin:10px 0}
  .bar-name{width:190px;font-size:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar-track{flex:1;height:12px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden}
  .bar-track span{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#2e9e4f,#46d369)}
  .avoid{margin:16px 0 0;font-size:20px;color:#ffb3b6}
  .taste-keys{display:flex;align-items:center;gap:10px;margin:22px 0 0;font-size:18px;color:#ddd}
  .taste-keys .key{min-width:44px;height:30px;font-size:15px}
  .taste-keys .red-key,.taste-keys .yellow-key{min-width:28px;width:28px;margin-left:12px}
  .yellow-key{border-radius:50%;background:#f5c518}
  .blue-key{min-width:34px;width:34px;border-radius:50%;background:#1f78e3;margin-left:18px}
  .green-key{min-width:34px;width:34px;border-radius:50%;background:#2e9e4f;margin-left:18px}
  .taste-keys .green-key{min-width:28px;width:28px;margin-left:12px}
  .taste-line{margin:8px 0 0;font-size:19px;color:#cfcfcf}
  .vote.love{background:#f5c518;color:#111}
  .card.chip{width:240px}
  .chip-art{position:relative;display:flex;flex-direction:column;justify-content:center;gap:6px;height:120px;padding:0 20px;border-radius:12px;background:#262626;border:2px solid rgba(255,255,255,.12);text-align:left}
  .chip-art strong{font-size:23px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chip-art small{font-size:17px;color:#a8a8a8}
  .chip.liked .chip-art{background:#173d22;border-color:#2e9e4f}
  .chip.disliked .chip-art{background:#3d1717;border-color:#e31f26}
  .card.chip:global(.focus) .chip-art{box-shadow:0 0 0 4px #fff}
  .sheet-scrim{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(0,0,0,.72);animation:fade .2s ease-out}
  .sheet{width:1180px;padding:44px 56px;border-radius:24px;background:#181818;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 80px rgba(0,0,0,.6);animation:rise .3s var(--ease)}
  .sheet-kicker{margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#e50914}
  .sheet h2{margin:0;font-size:46px;line-height:1.1}
  .sheet-sub{margin:8px 0 0;font-size:24px;color:var(--secondary)}
  .sheet-options{display:flex;gap:18px;margin-top:34px}
  .sheet-option{display:flex;align-items:center;gap:14px;height:82px;padding:0 28px;border:0;border-radius:16px;background:#2a2a2a;font-size:25px;font-weight:600;transition:transform .25s var(--spring),background .2s}
  .sheet-option.current{background:#333;outline:2px solid rgba(255,255,255,.35)}
  .sheet-option.focus{background:#fff;color:#000;transform:scale(1.06)}
  .sheet-option.plain{margin-left:auto}
  .sheet-icon{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;color:#fff}
  .sheet-icon.love{background:#f5c518;color:#111}.sheet-icon.like{background:#2e9e4f}.sheet-icon.dislike{background:#e31f26}
  .sheet-note{margin:26px 0 0;font-size:20px;color:#9a9a9a}
  .searchbar{position:absolute;left:96px;top:140px;z-index:4;width:1100px;height:88px;display:flex;align-items:center;gap:20px;padding:0 32px;border-radius:14px;background:rgba(40,40,40,.92);border:3px solid transparent;color:#bbb;transition:border-color .2s,background .2s}
  .searchbar.focus{border-color:#fff;background:rgba(60,60,60,.95);color:#fff}
  .searchbar input{flex:1;min-width:0;height:100%;border:0;outline:none;background:transparent;font-size:34px;color:#fff;font-family:inherit}
  .searchbar input::placeholder{color:#8c8c8c}
  .sources-status{position:absolute;left:96px;top:244px;z-index:4;display:flex;flex-wrap:wrap;gap:12px;margin:0;font-size:19px}
  .sources-status span{padding:6px 14px;border-radius:20px;background:rgba(255,255,255,.1);color:#cfcfcf}
  .sources-status .done{background:rgba(70,180,90,.22);color:#c9f5d0}
  .sources-status .error{background:rgba(229,9,20,.22);color:#ffc2c5}
  .preview.lower{top:300px}
  .preview.lower h1{font-size:56px}
  .preview.lower .overview{-webkit-line-clamp:2}
  nav button :global(svg){margin-right:8px;vertical-align:-4px}
  .empty h2{font-size:38px;margin:0 0 10px}
  .skeleton{margin-top:6px;display:grid;gap:34px}
  .skeleton-row>div{display:flex;gap:20px}
  .skeleton-title{display:block;width:280px;height:28px;margin-bottom:16px;border-radius:8px;background:#1d1d1d}
  .skeleton-card{flex:none;width:230px;height:345px;border-radius:10px;background:linear-gradient(100deg,#1a1a1a 30%,#2a2a2a 50%,#1a1a1a 70%);background-size:300% 100%;animation:shimmer 1.4s ease-in-out infinite}
  .skeleton-card.wide{width:400px;height:225px}
  @keyframes shimmer{from{background-position:100% 0}to{background-position:0 0}}
  .empty p{font-size:24px;color:var(--secondary);margin:0}
  .toast{position:absolute;right:96px;top:130px;z-index:6;max-width:640px;padding:16px 24px;border-radius:12px;background:rgba(30,30,30,.92);font-size:21px;animation:rise .35s var(--ease)}

  .opening{position:fixed;inset:0;z-index:40;background:#000;animation:fade .3s ease-out}
  .opening img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}
  .opening::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.92),rgba(0,0,0,.4)),linear-gradient(0deg,#000,transparent 50%)}
  .opening-text{position:absolute;left:120px;bottom:170px;z-index:1;max-width:1100px}
  .opening h1{font-size:76px;line-height:1.02;margin:0 0 14px;font-weight:800;letter-spacing:-1px}
  .opening p{font-size:30px;margin:0;color:#d6d6d6}
  .spin{display:flex;align-items:center;gap:22px;margin-top:44px;font-size:28px}
  .ring{width:46px;height:46px;border-radius:50%;border:5px solid rgba(255,255,255,.25);border-top-color:var(--red);animation:spin .9s linear infinite}

  @keyframes fade{from{opacity:0}}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
