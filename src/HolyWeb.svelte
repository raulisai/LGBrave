<script>
  // Holy's catalogue as a plain, responsive page: any phone, tablet or laptop on the same
  // WiFi can open it (http://<computadora>:43190/) and browse, search, rate and play, with
  // no TV and no CDP involved. It reuses the TV's own data and helpers (holy.js) and the
  // same JSON API already served by the Mac/Windows computer; the one new step is playing:
  // there is no curtain or autoplay automation here, so «Reproducir» asks the computer to
  // resolve the real player address (/holy-api/resolve) and opens it in a new tab, exactly
  // as tapping that site's own link would. That tab can show the site's own ads; only the
  // TV's CDP-driven session cleans them.
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { SECTIONS, categoryRows, sectionRows, withLayout, episodeRows, kindLabel, languageTag, clock, matchTone, getJSON, bestResults, searchScore, unpackHome, latestRequest } from './holy.js';

  const apiBase = location.origin;
  const PREFERRED = { anime: 'jkanime' };
  const TABS = SECTIONS.filter(entry => entry.id !== 'buscar');

  let data = $state.raw({ rows: [], items: [], sources: [], hero: null, preferred: null });
  let section = $state('inicio');
  let category = $state(null);
  let episodesView = $state(null);
  let sheet = $state(null);
  let langChoice = $state(null);
  let opening = $state(null);
  let notice = $state('');
  let connected = $state(false);
  let noticeTimer;

  const img = url => (url ? `${apiBase}/holy-api/img?u=${encodeURIComponent(url)}` : '');
  const sourceName = id => data.sources.find(source => source.id === id)?.name || '';
  const hasVersions = item => !!data.sources.find(source => source.id === item?.source)?.versions;
  const plainItem = item => { const payload = { ...item }; for (const key of ['score', 'reason', 'percent', 'resume', 'layout', 'match', 'matchReason', 'vote']) delete payload[key]; return payload; };
  const profile = $derived(taste || data.taste || null);

  $effect(() => {
    if (!notice) return;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ''; }, 6000);
  });

  // The home: same packed JSON the TV reads, cached locally for an instant first paint.
  let loadedVersions = '';
  let cacheTimer;
  const readHome = latestRequest(base => getJSON(base + '/holy-api/home?v=2'));
  async function load() {
    try {
      const result = await readHome(apiBase);
      if (!result) return;
      const fresh = unpackHome(result.value);
      if (!Array.isArray(fresh?.rows)) throw Error('formato');
      data = fresh;
      loadedVersions = fresh.catalogVersion + ':' + fresh.libraryVersion;
      notice = '';
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => { try { localStorage.setItem('holy-web-home', JSON.stringify(result.value)); } catch { /* Lost on this device only. */ } }, 2500);
    } catch { if (!data.rows.length) notice = 'No se pudo leer el catálogo de la computadora. Revisa la aplicación Holy y Luma.'; }
  }
  async function checkHealth() {
    try { await getJSON(apiBase + '/holy-api/health', { timeout: 6000, retries: 0 }); connected = true; }
    catch { connected = false; }
  }

  function chooseSection(id) {
    section = id; category = null; episodesView = null; searchOpen = false;
    if (id === 'gustos') loadTaste();
  }
  function openCategory(shelf) {
    if (!shelf?.genre) return;
    category = { genre: shelf.genre, title: shelf.title };
  }
  function closeCategory() { category = null; }
  function openCard(item) {
    if (!item) return;
    if (item.discover) { query = item.classicQuery || item.title; openSearch(); search(); notice = `Buscando ${item.title}${item.classicYear ? ' (' + item.classicYear + ')' : ''}. Confirma el año de la versión.`; return; }
    sheet = { item };
  }

  // Search: every site answers in parallel, under «Mejores resultados» (what was typed,
  // from any site), with a show's newest episodes right under it, same as the TV.
  let searchOpen = $state(false);
  let query = $state('');
  let searchInputEl = $state();
  let searchGroups = $state([]);
  let searchedFor = $state('');
  let searchStatus = $state([]);
  let bestEpisodes = $state(null);
  let bestEpisodesFor = '';
  let searchToken = 0;
  let searchTimer;
  const searchRows = $derived.by(() => {
    const best = bestResults(searchGroups, searchedFor, data.preferred || PREFERRED);
    return [
      ...(best.length ? [{ id: 's-best', title: 'Mejores resultados', items: best }] : []),
      ...(bestEpisodes && bestEpisodes.show === best[0]?.url ? [bestEpisodes.row] : []),
      ...searchGroups
    ].map(row => (row.layout ? row : withLayout(row)));
  });
  function openSearch() {
    searchOpen = true; category = null; episodesView = null;
    tick().then(() => searchInputEl?.focus());
  }
  function closeSearch() { searchOpen = false; stopListening(); }
  function typed() { clearTimeout(searchTimer); searchTimer = setTimeout(search, 700); }
  function search() {
    clearTimeout(searchTimer);
    const words = query.trim();
    if (words.length < 2) return;
    const token = ++searchToken;
    searchGroups = []; searchedFor = words; bestEpisodes = null; bestEpisodesFor = '';
    const sources = [{ id: 'local', name: 'Tu catálogo' }, ...data.sources];
    searchStatus = sources.map(source => ({ id: source.id, name: source.name, state: 'loading' }));
    for (const source of sources) {
      getJSON(`${apiBase}/holy-api/search?source=${encodeURIComponent(source.id)}&q=${encodeURIComponent(words)}`, { timeout: 20000, retries: 0 })
        .then(result => {
          if (!Array.isArray(result?.items)) throw Error('formato');
          if (token !== searchToken) return;
          searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: result.error ? 'error' : 'done', count: result.items.length } : entry);
          if (!result.items.length) return;
          searchGroups = [...searchGroups, { id: 's-' + source.id, title: source.id === 'local' ? 'En tu catálogo' : `${source.name} · ${result.items.length}`, items: result.items }];
          showBestEpisodes(token);
        })
        .catch(() => { if (token === searchToken) searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: 'error' } : entry); });
    }
  }
  function showBestEpisodes(token) {
    const top = bestResults(searchGroups, searchedFor, data.preferred || PREFERRED)[0];
    if (!top?.isShow || !top.show || searchScore(top, searchedFor) < 3 || bestEpisodesFor === top.url) return;
    bestEpisodesFor = top.url;
    getJSON(`${apiBase}/holy-api/episodes?source=${encodeURIComponent(top.source)}&show=${encodeURIComponent(top.show)}`, { timeout: 30000, retries: 0 })
      .then(result => {
        const seasonOne = Array.isArray(result?.seasons) ? result.seasons[0] : null;
        if (token !== searchToken || bestEpisodesFor !== top.url || !seasonOne?.episodes?.length) return;
        const [row] = episodeRows(top, [seasonOne]);
        bestEpisodes = { show: top.url, row: { ...row, id: 's-best-episodes', title: `${top.title} · ${seasonOne.title}` } };
      }).catch(() => {});
  }
  // Voice search: plain, no retry dance (that one is a quirk of this TV's own audio service).
  let listening = $state(false);
  let recognizer = null;
  function stopListening() {
    const old = recognizer;
    recognizer = null; listening = false;
    if (!old) return;
    old.onresult = old.onerror = old.onend = null;
    try { old.abort(); } catch { /* Already over. */ }
  }
  function voiceSearch() {
    if (listening) { stopListening(); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { notice = 'Este navegador no ofrece búsqueda por voz; escribe lo que buscas.'; return; }
    try {
      const heard = new Speech();
      recognizer = heard;
      heard.lang = 'es-MX'; heard.interimResults = false; heard.maxAlternatives = 1;
      heard.onresult = event => { const text = String(event.results?.[0]?.[0]?.transcript || '').trim(); if (text) { query = text; notice = ''; search(); } };
      heard.onerror = () => { recognizer = null; listening = false; notice = 'No se entendió. Escribe lo que buscas.'; };
      heard.onend = () => { if (recognizer === heard) { recognizer = null; listening = false; } };
      listening = true; heard.start();
    } catch { listening = false; recognizer = null; notice = 'No se pudo usar el micrófono.'; }
  }

  // A show's episodes, in place of the usual rows, with a way back.
  let episodesToken = 0;
  async function openEpisodes(show) {
    const token = ++episodesToken;
    sheet = null;
    episodesView = { token, show, seasons: [], loading: true, error: '' };
    try {
      const result = await getJSON(`${apiBase}/holy-api/episodes?source=${encodeURIComponent(show.source)}&show=${encodeURIComponent(show.show)}`, { timeout: 30000 });
      if (episodesView?.token !== token) return;
      const seasons = Array.isArray(result?.seasons) ? result.seasons : [];
      episodesView = { token, show, seasons, loading: false, error: result?.error || (seasons.length ? '' : 'No se encontraron episodios.') };
    } catch { if (episodesView?.token === token) episodesView = { token, show, seasons: [], loading: false, error: 'No se pudo leer la lista de episodios.' }; }
  }
  function closeEpisodes() { episodesView = null; }

  // «Gustos»: titles and chips (genre/producer/country) to rate; the taste profile that results.
  let taste = $state(null);
  let tasteRows = $state([]);
  let tasteLoading = $state(false);
  const readTaste = latestRequest(base => getJSON(base + '/holy-api/taste'));
  async function loadTaste() {
    tasteLoading = true;
    try {
      const pending = await readTaste(apiBase);
      if (!pending) return;
      const result = pending.value;
      tasteRows = Array.isArray(result?.rows) ? result.rows : [];
      taste = result?.taste || null;
    } catch { notice = 'No se pudo leer tus gustos de la computadora.'; }
    finally { tasteLoading = false; }
  }
  const post = payload => getJSON(apiBase + '/holy-api/vote', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), retries: 0 });
  function markVote(item, vote) {
    const key = item.show || item.url;
    const mark = row => ({ ...row, items: row.items.map(other => ((other.show || other.url) === key ? { ...other, vote } : other)) });
    tasteRows = tasteRows.map(mark);
    data = { ...data, rows: data.rows.map(mark) };
    if (sheet?.item && (sheet.item.show || sheet.item.url) === key) sheet = { ...sheet, item: { ...sheet.item, vote } };
  }
  async function togglePref(chip, value) {
    const next = chip.value === value ? 0 : value;
    tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: next } : other)) }));
    try { const result = await post({ pref: { type: chip.type, name: chip.name, value: next } }); taste = result.taste; load(); }
    catch { notice = 'No se guardó ese gusto. Revisa la conexión con la computadora.'; tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: chip.value } : other)) })); }
  }
  async function rate(item, value) {
    if (!item?.url) return;
    const vote = item.vote === value ? 0 : value;
    markVote(item, vote);
    try {
      const result = await post({ item: plainItem(item), vote });
      taste = result.taste; load();
      const fresh = await getJSON(apiBase + '/holy-api/taste', { retries: 0 }).catch(() => null);
      const matches = new Map((fresh?.rows || []).flatMap(row => row.items).map(entry => [entry.url, entry.match]));
      if (matches.size) tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (matches.has(other.url) ? { ...other, match: matches.get(other.url) } : other)) }));
    } catch { notice = 'No se guardó tu voto. Revisa la conexión con la computadora.'; markVote(item, item.vote || 0); }
  }
  async function resetTaste() {
    if (!confirm('¿Borrar los gustos calibrados? Lo que ves sigue contando igual.')) return;
    try { await post({ vote: 'reset' }); notice = 'Gustos calibrados borrados.'; await loadTaste(); load(); }
    catch { notice = 'No se pudieron borrar. Revisa la conexión con la computadora.'; }
  }
  async function importTastes(event) {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 512 * 1024) throw Error('tamaño');
      const payload = JSON.parse(await file.text());
      await getJSON(apiBase + '/holy-api/taste-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), retries: 0 });
      await loadTaste(); await load();
      notice = 'Tus gustos se combinaron conservando las valoraciones más recientes.';
    } catch { notice = 'No se pudo importar el archivo de gustos. Revisa el archivo y la conexión.'; }
    input.value = '';
  }
  function forgetItem(item) {
    if (!item?.key) return;
    if (!confirm(`¿Quitar «${item.title}» de Continuar viendo?`)) return;
    fetch(apiBase + '/holy-api/forget', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key: item.key }) }).catch(() => {});
    data = { ...data, rows: data.rows.map(row => (row.id === 'continue' ? { ...row, items: row.items.filter(other => other.key !== item.key) } : row)) };
    sheet = null;
  }

  // Languages (audio/subtitles): asked once per series, remembered after that.
  let versionInfo = $state.raw({});
  async function versionsFor(item) {
    if (!item?.url || !hasVersions(item)) return { versions: [], remembered: null };
    if (versionInfo[item.url]) return versionInfo[item.url];
    try {
      const info = await getJSON(`${apiBase}/holy-api/versions?source=${encodeURIComponent(item.source)}&url=${encodeURIComponent(item.url)}&show=${encodeURIComponent(item.show || '')}`, { timeout: 20000, retries: 0 });
      const value = { versions: Array.isArray(info?.versions) ? info.versions : [], remembered: info?.remembered || null };
      if (value.versions.length) versionInfo = { ...versionInfo, [item.url]: value };
      return value;
    } catch { return { versions: [], remembered: null }; }
  }
  function pickLanguage(version) {
    const current = langChoice;
    langChoice = null;
    if (current && version) play(current.item, version);
  }

  // Reproducir: this page has no curtain or autoplay helper, so the real player address is
  // resolved on the computer and opened in a new tab — the same place that site's own link
  // would open. The tab is opened before the (slower) resolve so a popup blocker still sees
  // it as a direct result of the tap.
  async function play(item, chosen = null) {
    if (!item || opening) return;
    const payload = plainItem(item);
    if (chosen) { payload.version = chosen.id; payload.versionKind = chosen.kind; }
    else if (!item.isShow && hasVersions(item) && !item.version) {
      opening = item;
      const info = await versionsFor(item);
      if (opening !== item) return;
      if (info.versions.length > 1) {
        const remembered = info.remembered && (info.versions.find(version => version.id === info.remembered.id) || info.versions.find(version => version.kind === info.remembered.kind));
        if (remembered) { payload.version = remembered.id; payload.versionKind = remembered.kind; }
        else { opening = null; langChoice = { item, versions: info.versions }; return; }
      }
    }
    await openResolved(item, payload);
  }
  async function openResolved(item, payload) {
    opening = item;
    let win = null;
    try {
      win = window.open('', '_blank');
      if (win) { win.document.title = 'Holy'; win.document.body.textContent = 'Abriendo tu título…'; win.document.body.style.cssText = 'background:#0b0b10;color:#fff;font:16px -apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'; }
    } catch { /* The popup blocker decides; a full navigation below still works. */ }
    try {
      const result = await getJSON(apiBase + '/holy-api/resolve', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ item: payload, version: payload.version, kind: payload.versionKind }), timeout: 35000, retries: 0 });
      if (opening !== item) { try { win?.close(); } catch { /* Already closed. */ } return; }
      opening = null;
      if (!result.ok) { try { win?.close(); } catch { /* Already closed. */ } notice = result.error || 'No se encontró un reproductor para este título en tus sitios.'; return; }
      try { if (win && !win.closed) win.location.href = result.url; else location.href = result.url; } catch { location.href = result.url; }
      notice = `Se abrió en ${result.site || 'el sitio'}, en una pestaña nueva. Ahí puede haber anuncios: en la TV se ve sin ellos.`;
      sheet = null;
    } catch {
      if (opening === item) { opening = null; try { win?.close(); } catch { /* Already closed. */ } notice = 'No se pudo abrir. Revisa la conexión con la computadora.'; }
    }
  }

  // Rows: same shape and helpers the TV uses, so categories, genres and award rows match it.
  const rows = $derived(
    episodesView ? episodeRows(episodesView.show, episodesView.seasons)
    : searchOpen ? searchRows
    : section === 'gustos' ? tasteRows.map(row => ({ ...row, layout: row.id.startsWith('pref-') ? 'chip' : 'poster' }))
    : category ? categoryRows(data, section, category.genre)
    : sectionRows(data, section)
  );
  const emptyMessage = $derived(
    episodesView ? (episodesView.loading ? 'Cargando episodios de ' + episodesView.show.title + '…' : episodesView.error)
    : searchOpen ? (searchStatus.length && searchStatus.every(entry => entry.state !== 'loading') ? `Sin resultados para «${query.trim()}»` : searchStatus.length ? 'Buscando en todos tus sitios…' : 'Escribe el nombre de una película, anime o dorama.')
    : section === 'gustos' ? (tasteLoading ? 'Preparando títulos para calificar…' : 'No hay títulos para calificar todavía.')
    : (notice || !data.rows.length) ? (notice || 'Conectando con la computadora…')
    : ''
  );

  onMount(() => {
    try { const cached = unpackHome(JSON.parse(localStorage.getItem('holy-web-home') || 'null')); if (cached?.rows) data = cached; } catch { /* No cache yet. */ }
    load(); checkHealth();
    const homeTimer = setInterval(load, 20000);
    const healthTimer = setInterval(checkHealth, 20000);
    return () => { clearInterval(homeTimer); clearInterval(healthTimer); clearTimeout(cacheTimer); clearTimeout(noticeTimer); clearTimeout(searchTimer); stopListening(); };
  });
</script>

<div class="page">
  <header class="top">
    <span class="brand">HOLY</span>
    {#if !searchOpen && !episodesView}
      <nav class="tabs" aria-label="Secciones">
        {#each TABS as entry}
          <button class:current={section === entry.id} onclick={() => chooseSection(entry.id)}>{entry.name}</button>
        {/each}
      </nav>
    {/if}
    <div class="top-actions">
      <span class="dot" class:on={connected} title={connected ? 'Conectado a la computadora' : 'Sin conexión con la computadora'} aria-hidden="true"></span>
      {#if !searchOpen}<button class="icon-btn" aria-label="Buscar" onclick={openSearch}><Icon name="search" size={22} stroke={2.4} /></button>{/if}
    </div>
  </header>

  {#if notice}<div class="toast" role="status">{notice}</div>{/if}

  {#if searchOpen}
    <div class="search-panel">
      <button class="back" onclick={closeSearch}>‹ Volver</button>
      <form class="searchbar" onsubmit={event => { event.preventDefault(); search(); }}>
        <Icon name="search" size={20} stroke={2.4} />
        <input bind:this={searchInputEl} bind:value={query} oninput={typed} placeholder="Película, anime o dorama…" autocomplete="off" spellcheck="false" aria-label="Buscar en todos los sitios" />
        <button type="button" class="mic" class:on={listening} aria-label="Buscar con la voz" onclick={voiceSearch}><Icon name="mic" size={20} stroke={2.2} /></button>
      </form>
      {#if searchStatus.length}
        <p class="sources-status">
          {#each searchStatus as entry}<span class={entry.state}>{entry.name}{entry.state === 'done' ? ` · ${entry.count}` : entry.state === 'error' ? ' · sin respuesta' : ' · buscando…'}</span>{/each}
        </p>
      {/if}
    </div>
  {:else if episodesView}
    <div class="category-heading"><button onclick={closeEpisodes}>‹ Volver</button><strong>{episodesView.show.title}</strong></div>
  {:else if category}
    <div class="category-heading"><button onclick={closeCategory}>‹ Volver</button><strong>{category.title}</strong></div>
  {/if}

  {#if section === 'inicio' && !searchOpen && !episodesView && !category && data.hero}
    <button class="hero" onclick={() => openCard(data.hero)}>
      <span class="hero-art">{#if data.hero.backdrop || data.hero.poster}<img src={img(data.hero.backdrop || data.hero.poster)} alt="" />{/if}</span>
      <span class="hero-text">
        {#if data.hero.reason}<span class="reason">{data.hero.reason}</span>{/if}
        <span class="hero-title">{data.hero.title}</span>
        <span class="meta">
          {#if data.hero.year}<span>{data.hero.year}</span>{/if}
          {#if Number(data.hero.rating) > 0}<span>★ {data.hero.rating}</span>{/if}
          <span>{kindLabel(data.hero.kind)}</span>
        </span>
        {#if data.hero.overview}<span class="overview">{data.hero.overview}</span>{/if}
        <span class="primary">Ver detalles</span>
      </span>
    </button>
  {/if}

  {#if section === 'gustos' && !episodesView && !searchOpen}
    <section class="taste-summary">
      <h2>Tu perfil</h2>
      {#if profile && profile.signals >= 2}
        <p class="taste-count">{profile.liked} me gusta ({profile.loved || 0} me encanta) · {profile.disliked} no · {profile.prefs || 0} gustos elegidos · {profile.watched} vistos</p>
        {#each profile.genres.slice(0, 6) as entry}<div class="bar"><span class="bar-name">{entry.name}</span><span class="bar-track"><span style:width={entry.value + '%'}></span></span></div>{/each}
        {#if profile.avoid.length}<p class="avoid">Evitas: {profile.avoid.map(entry => entry.name).join(', ')}</p>{/if}
      {:else}
        <p class="taste-count">Califica al menos dos títulos para que Holy calcule cuánto te puede gustar cada uno.</p>
      {/if}
      <div class="taste-transfer">
        <a href={apiBase + '/holy-api/taste-profile'} download="holy-gustos.json">Exportar gustos</a>
        <label>Importar gustos<input type="file" accept=".json,application/json" onchange={importTastes} /></label>
        <button type="button" class="link-btn" onclick={resetTaste}>Borrar gustos calibrados</button>
      </div>
    </section>
  {/if}

  <main class="rows">
    {#if !rows.length}<p class="empty">{emptyMessage}</p>{/if}
    {#each rows as shelf (section + '|' + shelf.id)}
      <section class="row" class:landscape-row={shelf.layout === 'landscape'}>
        <h2>{#if shelf.genre}<button class="genre-link" onclick={() => openCategory(shelf)}>{shelf.title} <span>Ver todas ›</span></button>{:else}{shelf.title}{/if}</h2>
        <div class="track">
          {#each shelf.items as item (item.url || item.id)}
            {#if item.chip}
              <div class="card chip" class:liked={item.value === 1} class:disliked={item.value === -1}>
                <strong>{item.title}</strong><small>{item.count} títulos</small>
                <div class="chip-actions">
                  <button type="button" aria-label="Me gusta" onclick={() => togglePref(item, 1)}><Icon name="check" size={16} stroke={3} /></button>
                  <button type="button" aria-label="No me gusta" onclick={() => togglePref(item, -1)}><Icon name="minus" size={16} stroke={3} /></button>
                </div>
              </div>
            {:else}
              <button class="card" class:landscape={shelf.layout === 'landscape'} onclick={() => openCard(item)} aria-label={(item.title || '') + (item.subtitle ? ', ' + item.subtitle : '')}>
                <span class="art">
                  {#if (shelf.layout === 'landscape' ? (item.backdrop || item.poster) : (item.poster || item.backdrop))}
                    <img src={img(shelf.layout === 'landscape' ? (item.backdrop || item.poster) : (item.poster || item.backdrop))} alt="" loading="lazy" decoding="async" />
                  {:else}<span class="fallback">{item.title || ''}</span>{/if}
                  {#if item.badge && shelf.layout !== 'landscape'}<span class="badge">{item.badge}</span>{/if}
                  {#if languageTag(item.language)}<span class="lang-tag">{languageTag(item.language)}</span>{/if}
                  {#if shelf.layout === 'landscape'}<span class="caption"><strong>{item.title}</strong>{#if item.subtitle}<small>{item.subtitle}</small>{/if}</span>{/if}
                  {#if item.percent}<span class="progress"><span style:width={item.percent + '%'}></span></span>{/if}
                  {#if item.match != null && !item.percent}<span class="match-badge {matchTone(item.match)}">{item.match}%</span>{/if}
                  {#if item.vote === 2}<span class="vote love"><Icon name="star" size={14} stroke={2.6} /></span>{:else if item.vote === 1}<span class="vote like"><Icon name="check" size={14} stroke={3} /></span>{:else if item.vote === -1}<span class="vote dislike"><Icon name="minus" size={14} stroke={3} /></span>{/if}
                </span>
                {#if shelf.layout !== 'landscape'}<span class="title-line">{item.title}</span>{/if}
              </button>
            {/if}
          {/each}
        </div>
      </section>
    {/each}
  </main>
</div>

{#if sheet}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="scrim" role="dialog" aria-label={sheet.item.title} tabindex="-1" onclick={() => sheet = null} onkeydown={event => { if (event.key === 'Escape') sheet = null; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="sheet" role="document" onclick={event => event.stopPropagation()}>
      <button type="button" class="close" aria-label="Cerrar" onclick={() => sheet = null}>✕</button>
      {#if sheet.item.backdrop || sheet.item.poster}<div class="sheet-art"><img src={img(sheet.item.backdrop || sheet.item.poster)} alt="" /></div>{/if}
      <div class="sheet-body">
        <h2>{sheet.item.title}</h2>
        {#if sheet.item.subtitle}<p class="sheet-sub">{sheet.item.subtitle}</p>{/if}
        <p class="meta">
          {#if sheet.item.match != null}<span class="match {matchTone(sheet.item.match)}">{sheet.item.match}% para ti</span>{/if}
          {#if sheet.item.year}<span>{sheet.item.year}</span>{/if}
          {#if Number(sheet.item.rating) > 0}<span>★ {sheet.item.rating}</span>{/if}
          <span>{kindLabel(sheet.item.kind)}{sourceName(sheet.item.source) ? ' · ' + sourceName(sheet.item.source) : ''}</span>
        </p>
        {#if sheet.item.genres?.length}<p class="genres">{sheet.item.genres.slice(0, 4).join(' · ')}</p>{/if}
        {#if sheet.item.overview}<p class="overview">{sheet.item.overview}</p>{/if}
        {#if sheet.item.matchReason && sheet.item.match != null}<p class="match-reason">{sheet.item.matchReason}</p>{/if}
        <div class="sheet-actions">
          <button type="button" class="primary" disabled={opening === sheet.item} onclick={() => (sheet.item.isShow ? openEpisodes(sheet.item) : play(sheet.item))}>
            {opening === sheet.item ? 'Abriendo…' : sheet.item.isShow ? 'Ver episodios' : sheet.item.resume ? 'Continuar desde ' + clock(sheet.item.t) : 'Reproducir'}
          </button>
          {#if !sheet.item.isShow}
            <div class="rate">
              <button type="button" class:on={sheet.item.vote === 2} aria-label="Me encanta" onclick={() => rate(sheet.item, 2)}><Icon name="star" size={18} stroke={2.6} /></button>
              <button type="button" class:on={sheet.item.vote === 1} aria-label="Me gusta" onclick={() => rate(sheet.item, 1)}><Icon name="check" size={18} stroke={3} /></button>
              <button type="button" class:on={sheet.item.vote === -1} aria-label="No me gusta" onclick={() => rate(sheet.item, -1)}><Icon name="minus" size={18} stroke={3} /></button>
            </div>
          {/if}
        </div>
        {#if sheet.item.key}<button type="button" class="link-btn" onclick={() => forgetItem(sheet.item)}>Quitar de «Continuar viendo»</button>{/if}
        <p class="web-caveat">Se abre en una pestaña nueva, tal cual la página del sitio: ahí puede haber anuncios. En la TV, Holy la limpia.</p>
      </div>
    </div>
  </div>
{/if}

{#if langChoice}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="scrim" role="dialog" aria-label="Elegir idioma" tabindex="-1" onclick={() => langChoice = null} onkeydown={event => { if (event.key === 'Escape') langChoice = null; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="sheet small" role="document" onclick={event => event.stopPropagation()}>
      <button type="button" class="close" aria-label="Cerrar" onclick={() => langChoice = null}>✕</button>
      <h2>¿En qué idioma?</h2>
      <div class="lang-options">
        {#each langChoice.versions as version}<button type="button" class="lang-option" onclick={() => pickLanguage(version)}>{version.label}</button>{/each}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root){ --bg:#07070a;--surface:#15151b;--text:#fff;--secondary:#c8c8c8;--tertiary:#8c8c8c;--red:#e50914;--fill:rgba(255,255,255,.1);--shadow:0 20px 50px rgba(0,0,0,.5);color-scheme:dark; }
  :global(*){box-sizing:border-box}
  :global(html,body){margin:0;background:var(--bg);color:var(--text)}
  :global(body){font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  :global(button){font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
  :global(img){max-width:100%}
  @media (prefers-reduced-motion:reduce){:global(*){animation:none!important;transition:none!important}}

  .page{min-height:100vh;padding-bottom:40px}
  .top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;padding:12px 16px;background:linear-gradient(180deg,rgba(7,7,10,.96),rgba(7,7,10,.85));backdrop-filter:blur(10px)}
  .brand{font-size:22px;font-weight:900;letter-spacing:4px;color:var(--red);flex-shrink:0}
  .tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
  .tabs::-webkit-scrollbar{display:none}
  .tabs button{flex-shrink:0;padding:8px 14px;border-radius:16px;font-size:14px;font-weight:600;color:var(--secondary);white-space:nowrap}
  .tabs button.current{background:#fff;color:#000}
  .top-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .icon-btn{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--fill)}
  .dot{width:9px;height:9px;border-radius:50%;background:#ff5a52}
  .dot.on{background:#46d369}

  .toast{margin:0 16px 10px;padding:10px 14px;border-radius:10px;background:#1e1e26;font-size:14px;color:#e8e8e8;box-shadow:var(--shadow)}

  .search-panel{padding:4px 16px 10px;display:flex;flex-direction:column;gap:10px}
  .search-panel .back{align-self:flex-start;font-size:14px;color:var(--secondary);padding:4px 0}
  .searchbar{display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:14px;padding:10px 14px}
  .searchbar input{flex:1;min-width:0;background:transparent;border:0;outline:none;font-size:16px;color:#fff}
  .searchbar .mic{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}
  .searchbar .mic.on{background:var(--red);color:#fff}
  .sources-status{display:flex;flex-wrap:wrap;gap:8px;margin:0;font-size:12px;color:var(--tertiary)}
  .sources-status .done{color:#8fd99c}.sources-status .error{color:#ff8a82}

  .category-heading{display:flex;align-items:center;gap:14px;padding:10px 16px}
  .category-heading button{padding:6px 14px;border-radius:10px;background:var(--surface);font-size:13px}
  .category-heading strong{font-size:17px}

  .hero{display:block;width:100%;text-align:left;position:relative;padding:0;margin:0 0 18px;overflow:hidden}
  .hero-art{display:block;position:relative;width:100%;aspect-ratio:16/9;background:#101016}
  .hero-art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .hero-text{position:relative;display:flex;flex-direction:column;gap:6px;padding:16px;margin-top:-70px;background:linear-gradient(180deg,transparent,rgba(7,7,10,.85) 40%,var(--bg) 92%)}
  .hero-text .reason{font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#ff8a82}
  .hero-title{font-size:24px;font-weight:800}
  .hero-text .meta{display:flex;gap:10px;font-size:13px;color:var(--secondary)}
  .hero-text .overview{font-size:13px;color:#d9d9d9;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .hero-text .primary{align-self:flex-start;margin-top:4px;padding:9px 18px;border-radius:20px;background:#fff;color:#000;font-size:14px;font-weight:700}

  .taste-summary{padding:4px 16px 18px}
  .taste-summary h2{font-size:17px;margin:0 0 8px}
  .taste-count{font-size:13px;color:var(--secondary);margin:0 0 10px}
  .bar{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:12px}
  .bar-name{width:90px;flex-shrink:0;color:var(--secondary)}
  .bar-track{flex:1;height:6px;border-radius:4px;background:var(--fill);overflow:hidden}
  .bar-track span{display:block;height:100%;background:var(--red)}
  .avoid{font-size:12px;color:#ff9a90;margin:8px 0 0}
  .taste-transfer{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font-size:13px}
  .taste-transfer a,.taste-transfer label,.link-btn{color:#9cc4ff;text-decoration:underline;cursor:pointer}
  .taste-transfer input{display:none}

  .rows{display:flex;flex-direction:column;gap:22px;padding-top:4px}
  .empty{margin:30px 16px;font-size:15px;color:var(--secondary)}
  .row h2{margin:0 0 8px 16px;font-size:17px;font-weight:700;color:#e8e8e8}
  .genre-link{display:inline-flex;align-items:baseline;gap:8px;color:inherit;font:inherit;padding:0}
  .genre-link span{font-size:12px;opacity:.6}
  .track{display:flex;gap:10px;overflow-x:auto;padding:2px 16px 8px;scroll-snap-type:x proximity;scrollbar-width:none}
  .track::-webkit-scrollbar{display:none}
  .card{flex-shrink:0;scroll-snap-align:start;width:118px;text-align:left;padding:0;display:flex;flex-direction:column;gap:6px}
  .card.landscape{width:200px}
  .art{position:relative;display:block;width:100%;aspect-ratio:2/3;border-radius:8px;overflow:hidden;background:linear-gradient(160deg,#2a2a2a,#121212)}
  .card.landscape .art{aspect-ratio:16/9}
  .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .fallback{position:absolute;inset:0;display:flex;align-items:flex-end;padding:8px;font-size:12px;font-weight:700;color:#bbb}
  .title-line{font-size:12px;color:#d6d6d6;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .badge{position:absolute;top:6px;left:6px;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.72);font-size:10px;font-weight:700;color:#ffd666}
  .lang-tag{position:absolute;top:6px;right:6px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.72);font-size:9px;font-weight:700;color:#9cc4ff}
  .caption{position:absolute;left:0;right:0;bottom:0;padding:16px 8px 6px;background:linear-gradient(0deg,rgba(0,0,0,.85),transparent);display:flex;flex-direction:column;gap:1px}
  .caption strong{font-size:12px;color:#fff}
  .caption small{font-size:10px;color:#cfcfcf}
  .progress{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.25)}
  .progress span{display:block;height:100%;background:var(--red)}
  .match-badge{position:absolute;top:6px;left:6px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.72);font-size:10px;font-weight:800}
  .match-badge.high{color:#46d369}.match-badge.mid{color:#f5c518}.match-badge.low{color:#a3a3a3}
  .vote{position:absolute;bottom:6px;right:6px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:rgba(0,0,0,.72)}
  .vote.love{color:#f5c518}.vote.like{color:#46d369}.vote.dislike{color:#ff5a52}

  .card.chip{width:150px;padding:14px;border-radius:12px;background:var(--surface);gap:2px;position:relative}
  .card.chip.liked{outline:2px solid #46d369}.card.chip.disliked{outline:2px solid #ff5a52}
  .card.chip strong{font-size:14px}
  .card.chip small{font-size:11px;color:var(--tertiary)}
  .chip-actions{display:flex;gap:8px;margin-top:8px}
  .chip-actions button{width:28px;height:28px;border-radius:50%;background:var(--fill);display:grid;place-items:center}

  .scrim{position:fixed;inset:0;z-index:20;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center}
  .sheet{position:relative;width:100%;max-height:88vh;overflow-y:auto;background:var(--surface);border-radius:20px 20px 0 0;box-shadow:var(--shadow)}
  .sheet.small{padding:24px;max-width:420px}
  .close{position:absolute;top:12px;right:12px;z-index:2;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.55);display:grid;place-items:center;font-size:16px}
  .sheet-art{width:100%;aspect-ratio:16/9;background:#101016;overflow:hidden}
  .sheet-art img{width:100%;height:100%;object-fit:cover}
  .sheet-body{padding:18px 20px 28px}
  .sheet-body h2{margin:0 0 4px;font-size:21px}
  .sheet-sub{margin:0 0 8px;font-size:14px;color:#ff8a82;font-weight:600}
  .sheet-body .meta{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px;font-size:13px;color:var(--secondary)}
  .sheet-body .match{font-weight:700}
  .match.high{color:#46d369}.match.mid{color:#f5c518}.match.low{color:#a3a3a3}
  .genres{margin:0 0 8px;font-size:13px;color:var(--tertiary)}
  .overview{margin:0 0 6px;font-size:14px;line-height:1.5;color:#d9d9d9}
  .match-reason{margin:0 0 10px;font-size:12px;color:#9ad9a5}
  .sheet-actions{display:flex;align-items:center;gap:14px;margin-top:14px}
  .primary{padding:12px 24px;border-radius:24px;background:#fff;color:#000;font-size:15px;font-weight:700}
  .primary:disabled{opacity:.6}
  .rate{display:flex;gap:8px}
  .rate button{width:38px;height:38px;border-radius:50%;background:var(--fill);display:grid;place-items:center}
  .rate button.on{background:var(--red);color:#fff}
  .link-btn{display:block;margin-top:14px;font-size:13px;background:none}
  .web-caveat{margin:18px 0 0;font-size:11px;color:var(--tertiary);line-height:1.4}

  .lang-options{display:flex;flex-direction:column;gap:8px;margin-top:14px}
  .lang-option{padding:12px 16px;border-radius:12px;background:var(--fill);font-size:14px;text-align:left}

  @media (min-width:720px){
    .page{max-width:1100px;margin:0 auto}
    .brand{font-size:26px}
    .card{width:150px}
    .card.landscape{width:260px}
    .scrim{align-items:center}
    .sheet{width:560px;max-width:92vw;border-radius:20px;max-height:84vh}
    .sheet-art{aspect-ratio:16/8}
  }
</style>
