<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import NavigationFeedback from './NavigationFeedback.svelte';
  import { SECTIONS, sectionRows, withLayout, episodeRows, kindLabel, clock, remaining, matchTone, getJSON } from './holy.js';

  let apiBase = $state(/^https?:/.test(location.protocol) ? location.origin : '');
  let data = $state({ rows: [], items: [], sources: [], hero: null, updatedAt: 0 });
  let section = $state('inicio');
  let rowIndex = $state(0);
  let columns = $state({});
  let inNav = $state(false);
  let navIndex = $state(0);
  let connected = $state(false);
  let opening = $state(null);
  let notice = $state('');
  let navigationError = $state('');
  let navigationTarget = $state('');
  let loadedVersions = '';
  let lastHeartbeat = 0;
  let previewTimer;
  let openingTimer;
  let rowsEl = $state();
  // Search: every site is asked at once; each row appears as soon as its site answers.
  let query = $state('');
  let searchRows = $state([]);
  let searchStatus = $state([]);
  let inSearch = $state(false);
  let searchInput = $state();
  let searchTimer;
  let searchToken = 0;
  // A show's episodes, opened from search; Back returns to where it was opened.
  let episodesView = $state(null);
  // «Gustos»: titles to rate and the resulting taste profile.
  let tasteRows = $state([]);
  let taste = $state(null);
  let tasteLoading = $state(false);
  let resetArmed = 0;
  // Rating sheet: green key on any title, or «¿Qué te pareció?» after watching a good while.
  const RATINGS = [{ value: -1, label: 'No es para mí', icon: 'minus' }, { value: 1, label: 'Me gusta', icon: 'check' }, { value: 2, label: 'Me encanta', icon: 'star' }];
  let sheet = $state(null);
  const askedShown = new Set();
  const cardWidth = layout => ({ landscape: 400, chip: 240 })[layout] || 230;

  const rows = $derived(episodesView ? episodeRows(episodesView.show, episodesView.seasons) : section === 'buscar' ? searchRows.map(withLayout) : section === 'gustos' ? tasteRows.map(row => ({ ...row, layout: row.id.startsWith('pref-') ? 'chip' : 'poster' })) : sectionRows(data, section));
  const profile = $derived(taste || data.taste || null);
  const row = $derived(rows[Math.min(rowIndex, rows.length - 1)]);
  const column = $derived(row ? Math.min(columns[row.id] || 0, row.items.length - 1) : 0);
  const focused = $derived(row?.items[column] || null);
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
    previewTimer = setTimeout(() => { preview = next; }, 160);
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

  async function load() {
    if (!apiBase) return;
    try {
      const fresh = await getJSON(apiBase + '/holy-api/home');
      if (!Array.isArray(fresh?.rows)) throw Error('formato');
      data = fresh;
      // Ask once what the owner thought of something they watched for a good while.
      const ask = fresh.askRating;
      if (ask?.key && !askedShown.has(ask.key) && !opening && !sheet && section === 'inicio') { askedShown.add(ask.key); openSheet(ask, true); }
      loadedVersions = fresh.catalogVersion + ':' + fresh.libraryVersion;
      notice = '';
      try { localStorage.setItem('holy-home', JSON.stringify(fresh)); localStorage.setItem('holy-api', apiBase); } catch { /* The Mac keeps the real copy. */ }
    } catch { if (!data.rows.length) notice = 'No se pudo leer el catálogo del Mac. Revisa que «npm run holy» siga abierto.'; }
  }
  function command(action, value) {
    if (typeof window.__lgLabCommand !== 'function') return false;
    try { window.__lgLabCommand(JSON.stringify({ action, value })); return true; } catch { return false; }
  }
  function play(item) {
    if (!item) return;
    const payload = $state.snapshot(item);
    for (const key of ['score', 'reason', 'percent', 'resume', 'layout', 'match', 'matchReason', 'vote']) delete payload[key];
    if (!command('play', payload)) { notice = 'Holy necesita el Mac para abrir títulos. Abre «npm run holy» y vuelve a intentar.'; return; }
    opening = item; navigationError = '';
    clearTimeout(openingTimer);
    openingTimer = setTimeout(() => { if (opening === item) { opening = null; notice = 'El sitio no respondió. Intenta de nuevo u otro título.'; } }, 40000);
  }
  function forget(item) {
    if (row?.id !== 'continue' || !item?.key) return;
    command('forget', item.key);
    data.rows = data.rows.map(entry => entry.id === 'continue' ? { ...entry, items: entry.items.filter(other => other.key !== item.key) } : entry);
  }
  function chooseSection(id) {
    section = id; rowIndex = 0; inNav = false; episodesView = null;
    if (id === 'buscar') focusSearch();
    if (id === 'gustos') loadTaste();
  }
  async function loadTaste() {
    if (!apiBase) { notice = 'Conecta el Mac para calibrar tus gustos.'; return; }
    tasteLoading = true;
    try {
      const result = await getJSON(apiBase + '/holy-api/taste');
      tasteRows = Array.isArray(result?.rows) ? result.rows : [];
      taste = result?.taste || null;
    } catch { notice = 'No se pudo leer tus gustos del Mac.'; }
    finally { tasteLoading = false; }
  }
  // OK: «me gusta» (again: quitar). Rojo: «no me gusta». The profile updates at once.
  const post = payload => getJSON(apiBase + '/holy-api/vote', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload), retries: 0 });
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
    sheet = null;
    if (!current || !apiBase || value === undefined) return;
    try {
      if (value === null) { if (current.prompt) await post({ dismiss: plainItem(current.item) }); return; }
      const result = await post({ item: plainItem(current.item), vote: value });
      taste = result.taste;
      markVote(current.item, value);
      notice = value ? `Guardado: «${RATINGS.find(entry => entry.value === value)?.label}». Tus porcentajes se actualizan.` : 'Calificación quitada.';
      load();
    } catch { notice = 'No se guardó tu calificación. Revisa la conexión con el Mac.'; }
  }
  // «Gustos» chips: a genre, producer/studio or country you like (OK) or not (rojo).
  async function togglePref(chip, value) {
    const next = chip.value === value ? 0 : value;
    tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: next } : other)) }));
    try {
      const result = await post({ pref: { type: chip.type, name: chip.name, value: next } });
      taste = result.taste;
      load();
    } catch { notice = 'No se guardó ese gusto. Revisa la conexión con el Mac.'; tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (other.url === chip.url ? { ...other, value: chip.value } : other)) })); }
  }
  async function rate(item, value) {
    if (!item?.url || !apiBase) return;
    if (item.chip) return togglePref(item, value);
    const vote = item.vote === value ? 0 : value;
    markVote(item, vote);
    try {
      const result = await post({ item: plainItem(item), vote });
      taste = result.taste;
      load();
      // Fresh percentages for the cards on screen, without reshuffling the rows under the focus.
      const fresh = await getJSON(apiBase + '/holy-api/taste', { retries: 0 }).catch(() => null);
      const matches = new Map((fresh?.rows || []).flatMap(row => row.items).map(entry => [entry.url, entry.match]));
      if (matches.size) tasteRows = tasteRows.map(row => ({ ...row, items: row.items.map(other => (matches.has(other.url) ? { ...other, match: matches.get(other.url) } : other)) }));
    } catch { notice = 'No se guardó tu voto. Revisa la conexión con el Mac.'; markVote(item, item.vote || 0); }
  }
  async function resetTaste() {
    if (Date.now() - resetArmed > 4000) { resetArmed = Date.now(); notice = 'Pulsa el botón amarillo otra vez para borrar tus gustos calibrados.'; return; }
    resetArmed = 0;
    try {
      await post({ vote: 'reset' });
      notice = 'Gustos calibrados borrados. Lo que ves sigue contando.';
      await loadTaste(); load();
    } catch { notice = 'No se pudieron borrar. Revisa la conexión con el Mac.'; }
  }
  function focusSearch() {
    inNav = false; inSearch = true;
    // Focusing the field opens the TV's on-screen keyboard.
    tick().then(() => searchInput?.focus());
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
    searchRows = []; rowIndex = 0;
    columns = Object.fromEntries(Object.entries(columns).filter(([id]) => !id.startsWith('s-')));
    const sources = [{ id: 'local', name: 'Tu catálogo' }, ...data.sources];
    searchStatus = sources.map(source => ({ id: source.id, name: source.name, state: 'loading' }));
    const started = Date.now();
    for (const source of sources) {
      getJSON(`${apiBase}/holy-api/search?source=${encodeURIComponent(source.id)}&q=${encodeURIComponent(words)}`, { timeout: 20000, retries: 0 })
        .then(result => {
          if (!Array.isArray(result?.items)) throw Error('formato');
          if (token !== searchToken) return;
          const seconds = ((Date.now() - started) / 1000).toFixed(1).replace('.', ',');
          searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: result.error ? 'error' : 'done', count: result.items.length, seconds } : entry);
          if (result.items.length) searchRows = [...searchRows, { id: 's-' + source.id, title: source.id === 'local' ? 'En tu catálogo' : `${source.name} · ${result.items.length}`, items: result.items }];
        })
        .catch(() => { if (token === searchToken) searchStatus = searchStatus.map(entry => entry.id === source.id ? { ...entry, state: 'error' } : entry); });
    }
  }
  function typed() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 700);
  }
  let episodesToken = 0;
  async function openEpisodes(show) {
    // $state stores a proxy, so the pending request is matched by token, not identity.
    const token = ++episodesToken;
    const view = { token, show: $state.snapshot(show), seasons: [], loading: true, error: '', from: { rowIndex } };
    episodesView = view; rowIndex = 0; inSearch = false; searchInput?.blur();
    try {
      const result = await getJSON(`${apiBase}/holy-api/episodes?source=${encodeURIComponent(show.source)}&show=${encodeURIComponent(show.show)}`, { timeout: 30000 });
      if (episodesView?.token !== token) return;
      const seasons = Array.isArray(result?.seasons) ? result.seasons : [];
      episodesView = { ...view, seasons, loading: false, error: result?.error || (seasons.length ? '' : 'No se encontraron episodios.') };
    } catch { if (episodesView?.token === token) episodesView = { ...view, loading: false, error: 'No se pudo leer la lista de episodios.' }; }
  }
  function closeEpisodes() {
    const from = episodesView?.from;
    episodesView = null;
    rowIndex = from?.rowIndex || 0;
  }
  function choose(item) {
    if (!item) return;
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
      const next = Math.max(0, Math.min(row.items.length - 1, column + (direction === 'right' ? 1 : -1)));
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
    const direction = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code];
    // The rating sheet has the remote while open.
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
      else choose(focused);
    } else if (code === 403) { event.preventDefault(); if (section === 'gustos' && !inNav) rate(focused, -1); else forget(focused); }
    else if (code === 404 && !inNav && focused && !focused.chip) { event.preventDefault(); openSheet(focused); }
    else if (code === 405 && section === 'gustos') { event.preventDefault(); resetTaste(); }
    else if (code === 461 || code === 27) {
      if (opening) { event.preventDefault(); opening = null; command('home'); }
      else if (episodesView) { event.preventDefault(); closeEpisodes(); }
      else if (inNav) { event.preventDefault(); inNav = false; }
      else if (rowIndex > 0) { event.preventDefault(); rowIndex = 0; }
      else if (section !== 'inicio') { event.preventDefault(); chooseSection('inicio'); }
    }
  }
  function refresh() {
    notice = 'Buscando estrenos en tus sitios…';
    if (!command('refresh-catalog') && apiBase) fetch(apiBase + '/holy-api/refresh', { method: 'POST', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    setTimeout(load, 4000);
  }
  // Pointer (Magic Remote): hovering focuses, clicking plays.
  function hover(r, c) {
    inNav = false; inSearch = false; rowIndex = r;
    columns = { ...columns, [rows[r].id]: c };
  }

  onMount(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('holy-home') || 'null');
      if (cached?.rows) data = cached;
      if (!apiBase) apiBase = localStorage.getItem('holy-api') || '';
    } catch { /* No cache yet. */ }
    load();
    const update = event => {
      const detail = event.detail || {};
      lastHeartbeat = Date.now();
      connected = !!detail.connected;
      const holy = detail.holy;
      if (holy?.apiBase && !/^https?:/.test(location.protocol) && apiBase !== holy.apiBase) apiBase = holy.apiBase;
      if (holy && loadedVersions !== holy.catalogVersion + ':' + holy.libraryVersion) { loadedVersions = holy.catalogVersion + ':' + holy.libraryVersion; load(); }
      // While the Mac is still trying other servers or sites, a failed page is not the end.
      const retrying = ['resolving', 'opening'].includes(holy?.session?.phase);
      if (detail.navigation?.phase === 'error' && opening && !retrying) { opening = null; navigationError = detail.navigation.error; navigationTarget = detail.navigation.url || ''; }
      // The Mac refused a title whose only players close the app on this TV.
      if (holy?.session?.phase === 'failed' && opening) { opening = null; notice = holy.session.error; }
    };
    const heartbeat = setInterval(() => { if (connected && Date.now() - lastHeartbeat > 6500) connected = false; }, 2000);
    window.addEventListener('lg-lab-status', update);
    window.__lumaReady = true;
    return () => { window.removeEventListener('lg-lab-status', update); clearInterval(heartbeat); clearTimeout(previewTimer); clearTimeout(openingTimer); };
  });
</script>

<svelte:window onkeydown={remote} />

<div class="app">
  <div class="backdrop" aria-hidden="true">
    {#key preview?.url}
      {#if preview?.backdrop || preview?.poster}
        <img class:poster-art={!preview.backdrop} src={img(preview.backdrop || preview.poster)} alt="" />
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
    <span class="status" class:offline={!connected}>{connected ? 'Conectado al Mac' : 'Sin Mac'}</span>
  </header>

  {#if section === 'buscar' && !episodesView}
    <form class="searchbar" class:focus={inSearch} onsubmit={event => { event.preventDefault(); search(); }}>
      <Icon name="search" size={34} stroke={2.4} />
      <input bind:this={searchInput} bind:value={query} oninput={typed} onfocus={() => { inSearch = true; inNav = false; }} placeholder="Película, anime o dorama…" autocomplete="off" spellcheck="false" aria-label="Buscar en todos los sitios" />
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
            {#if preview.year}<span>{preview.year}</span>{/if}
            {#if Number(preview.rating) > 0}<span>★ {preview.rating}</span>{/if}
            {#if preview.badge && !preview.subtitle?.includes(preview.badge.replace(/\D/g, '') || '§')}<span class="pill">{preview.badge}</span>{/if}
            <span>{kindLabel(preview.kind)}{sourceName(preview.source) ? ' · ' + sourceName(preview.source) : ''}</span>
          </p>
          {#if preview.genres?.length}<p class="genres">{preview.genres.slice(0, 4).join(' · ')}</p>{/if}
          {#if preview.overview}<p class="overview">{preview.overview}</p>{/if}
          <p class="hint">
            {#if section === 'gustos' && !episodesView}
              <span class="key">OK</span>{preview.vote === 1 ? 'Quitar «me gusta»' : 'Me gusta'}<span class="key red-key"></span>{preview.vote === -1 ? 'Quitar «no me gusta»' : 'No me gusta'}
            {:else}
            <span class="key">OK</span>{preview.isShow ? 'Ver episodios' : preview.resume ? 'Continuar desde ' + clock(preview.t) : preview.upNext ? 'Ver ' + (preview.subtitle || 'siguiente') : 'Reproducir'}
            {#if preview.resume && preview.duration}<span class="left">{remaining(preview.t, preview.duration)}</span>{/if}
            {#if row?.id === 'continue' && !inNav}<span class="key red-key"></span>Quitar de la fila{/if}
            {/if}
            {#if !preview.chip && !inNav}<span class="key green-key"></span>{preview.vote === 2 ? 'Te encanta' : preview.vote === 1 ? 'Te gusta' : preview.vote === -1 ? 'No es para ti' : 'Calificar'}{/if}
          </p>
          {#if preview.matchReason && preview.match != null}<p class="match-reason">{preview.matchReason}</p>{/if}
        </div>
      {/key}
    </section>
  {/if}

  <main class="shelves" class:nav-focus={inNav}>
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
          <p>{data.sources.filter(source => source.search).map(source => source.name).join(', ') || 'Todos tus sitios'}. Los que respondan primero aparecen primero.</p>
        {:else}
          <h2>{notice || (apiBase ? 'Preparando tu catálogo…' : 'Conectando con el Mac…')}</h2>
          <p>Holy toma los estrenos de tus sitios favoritos y los ordena según lo que ves.</p>
        {/if}
      </div>
    {/if}
    <div class="rows" bind:this={rowsEl}>
      {#each rows as shelf, r (section + shelf.id)}
        <section class="row" class:landscape-row={shelf.layout === 'landscape'} class:chip-row={shelf.layout === 'chip'} class:active={!inNav && !inSearch && r === rowIndex} class:past={r < rowIndex} aria-label={shelf.title}>
          <h2>{shelf.title}</h2>
          <div class="track-clip">
            <div class="track" style:transform={`translateX(${-(columns[shelf.id] || 0) * (cardWidth(shelf.layout) + 20)}px)`}>
              <!-- Only rows near the focus get cards: long episode lists stay light on the TV. -->
              {#each Math.abs(r - rowIndex) <= 2 ? shelf.items : [] as item, c (item.url + c)}
                {@const active = !inNav && !inSearch && r === rowIndex && c === column}
                {#if item.chip}
                <button class="card chip" class:focus={active} class:liked={item.value === 1} class:disliked={item.value === -1} aria-label={item.title + (item.value === 1 ? ', te gusta' : item.value === -1 ? ', no te gusta' : '')}
                  onmouseenter={() => hover(r, c)} onclick={() => { hover(r, c); choose(item); }}>
                  <span class="chip-art"><strong>{item.title}</strong><small>{item.count} títulos</small>
                    {#if item.value === 1}<span class="vote like"><Icon name="check" size={22} stroke={3} /></span>{:else if item.value === -1}<span class="vote dislike"><Icon name="minus" size={22} stroke={3} /></span>{/if}
                  </span>
                </button>
                {:else}
                <button class="card" class:landscape={shelf.layout === 'landscape'} class:focus={active} aria-label={(item.title || '') + (item.subtitle ? ', ' + item.subtitle : '')}
                  onmouseenter={() => hover(r, c)} onclick={() => { hover(r, c); choose(item); }}>
                  <span class="art">
                    <span class="fallback">{item.title || ''}</span>
                    {#if shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop}
                      <img src={img(shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop)} alt="" loading={c < 8 ? 'eager' : 'lazy'} onerror={event => event.currentTarget.remove()} />
                    {/if}
                    {#if item.badge && shelf.layout !== 'landscape'}<span class="badge">{item.badge}</span>{/if}
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

  {#if notice && rows.length}<div class="toast" role="status">{notice}</div>{/if}
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

<NavigationFeedback error={navigationError} target={navigationTarget} onretry={() => { navigationError = ''; play(focused); }} onhome={() => { navigationError = ''; command('home'); }} />

<style>
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
  .status.offline{color:#ffb020}

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
  .row{padding:0 0 26px;transition:opacity .35s}
  .row.past{opacity:0}
  .row h2{margin:0 0 4px 96px;font-size:30px;font-weight:700;color:#e5e5e5;letter-spacing:-.2px}
  .row.active h2{color:#fff}
  .track-clip{overflow:hidden;padding:18px 0 24px 96px}
  .track{display:flex;gap:20px;min-height:345px;transition:transform .4s var(--ease);will-change:transform}
  .landscape-row .track{min-height:225px}
  .chip-row .track{min-height:120px}
  .card{flex:none;width:230px;padding:0;border:0;background:none;border-radius:10px;transition:transform .3s var(--ease)}
  .card.landscape{width:400px}
  .art{position:relative;display:block;width:100%;aspect-ratio:2/3;border-radius:10px;overflow:hidden;background:#1f1f1f;box-shadow:0 8px 20px rgba(0,0,0,.5)}
  .landscape .art{aspect-ratio:16/9}
  .art img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .fallback{position:absolute;inset:0;display:flex;align-items:flex-end;padding:16px;font-size:22px;font-weight:700;text-align:left;color:#bbb;background:linear-gradient(160deg,#2a2a2a,#121212)}
  .badge{position:absolute;top:10px;left:10px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.72);font-size:16px;font-weight:700;letter-spacing:.4px}
  .caption{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;gap:2px;padding:44px 16px 14px;text-align:left;background:linear-gradient(transparent,rgba(0,0,0,.92))}
  .caption strong{font-size:21px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .caption small{font-size:18px;color:#cfcfcf}
  .progress{position:absolute;left:14px;right:14px;bottom:8px;height:6px;border-radius:3px;background:rgba(255,255,255,.3)}
  .progress span{display:block;height:100%;border-radius:3px;background:var(--red)}
  .landscape .progress{bottom:6px}
  .next{position:absolute;top:10px;right:10px;padding:3px 10px;border-radius:6px;background:var(--red);font-size:16px;font-weight:800}
  .card.focus{transform:scale(1.1);z-index:2}
  .card.focus .art{box-shadow:0 0 0 4px #fff,0 18px 40px rgba(0,0,0,.7)}
  .card:focus{outline:none}

  .empty{position:absolute;left:96px;top:40px;max-width:1100px}
  .match{font-weight:800}
  .match.high{color:#46d369}.match.mid{color:#f5c518}.match.low{color:#a3a3a3}
  .match-reason{margin:10px 0 0;font-size:20px;color:#b9e8c4}
  .match-badge{position:absolute;left:10px;bottom:12px;padding:3px 9px;border-radius:6px;background:rgba(0,0,0,.78);font-size:17px;font-weight:800}
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
  .card.chip.focus .chip-art{box-shadow:0 0 0 4px #fff}
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
