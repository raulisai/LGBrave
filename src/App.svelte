<script>
  import { onMount, tick, untrack } from 'svelte';
  import { resolveNavigation, SEARCH_ENGINES } from './navigation.js';
  import { moveFocus } from './spatial.js';
  import Icon from './Icon.svelte';
  import NavigationFeedback from './NavigationFeedback.svelte';

  let address = $state('');
  let connected = $state(false);
  let debug = $state(false);
  let tabs = $state([]);
  let activeTabId = $state('');
  let enabled = $state(true);
  let blocked = $state(0);
  let shownBlocked = $state(0);
  let message = $state('');
  let bookmarks = $state([]);
  let categories = $state(['Anime', 'Películas', 'Doramas']);
  let editing = $state(false);
  let riskySites = $state([]);
  let catDialog = $state(null);
  let catError = $state('');
  let dialog = $state(null);
  let dialogError = $state('');
  let loading = $state(false);
  let navigationError = $state('');
  let navigationTarget = $state('');
  let searchEngine = $state('google');
  const wallpapers = [{ id: 'street', name: 'Calle nocturna', file: 'bg-street.jpg' }, { id: 'canyon', name: 'Cañón helado', file: 'bg-canyon.jpg' }];
  let wallpaper = $state('street');
  let dim = $state(35);
  let settingsOpen = $state(false);
  let settingsNotice = $state('');
  let pendingSearchEngine = $state('');
  let navigationTimer;
  let lastHeartbeat = 0;
  let migrated = false;

  let labURL = $state('');
  const palette = ['#0a84ff', '#30b0c7', '#34c759', '#ff9f0a', '#ff375f', '#5e5ce6', '#bf5af2', '#ac8e68'];
  // Simple marks, not the services' logos: known sites get their brand colour, the rest a hashed one.
  const brands = {
    'crunchyroll.com': ['CR', '#f47521'], 'animeflv.net': ['A', '#2f80ed'], 'jkanime.net': ['JK', '#4c7dff'], 'netflix.com': ['N', '#e50914'],
    'disneyplus.com': ['D+', '#1b44c8'], 'primevideo.com': ['prime', '#00a8e1'], 'max.com': ['max', '#2f3bff'], 'youtube.com': ['', '#ff0033', 'play'],
    'tv.apple.com': ['tv', '#2c2c30'], 'pluto.tv': ['pluto', '#fff04d', null, '#111'], 'cinepolis.com': ['C', '#1d4fa3'], 'filminlatino.mx': ['FL', '#e9e9ee', null, '#c4161c'],
    'wikipedia.org': ['W', '#4a4d57'], 'reddit.com': ['r', '#ff4500'], 'github.com': ['GH', '#2b2f3a'], 'stackoverflow.com': ['SO', '#f48024'],
    'notion.so': ['N', '#2b2b2e'], 'drive.google.com': ['D', '#1fa463'], 'mail.google.com': ['M', '#ea4335']
  };
  const engineTints = { google: '#4285f4', bing: '#008373', duckduckgo: '#de5833', brave: '#fb542b' };
  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12 ? 'Buenos días' : hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  const wallpaperFile = $derived((wallpapers.find(item => item.id === wallpaper) || wallpapers[0]).file);
  const engineName = $derived(SEARCH_ENGINES.find(engine => engine.id === searchEngine)?.name || 'Google');
  function tileFor(item) {
    let host = '';
    try { host = new URL(item.url).hostname.replace(/^www\d*\./, ''); } catch { /* Keep the fallback mark. */ }
    const key = Object.keys(brands).find(name => host === name || host.endsWith('.' + name));
    const hash = [...item.url].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
    const [mark, tint, glyph, ink] = key ? brands[key] : [(item.title.match(/[\p{L}\p{N}]/u)?.[0] || '•').toUpperCase(), palette[hash % palette.length]];
    return { ...item, mark, tint, glyph, ink: ink || '#fff', long: (mark || '').length > 2, risky: riskySites.includes(host) || riskySites.includes('www.' + host) };
  }
  const rows = $derived(categories.map(name => ({ name, items: bookmarks.filter(item => item.category === name).map(tileFor) })));

  // Smoothly count up when the bridge reports new blocks.
  let tweenFrame;
  $effect(() => {
    const target = blocked;
    const from = untrack(() => shownBlocked);
    if (from === target) return;
    cancelAnimationFrame(tweenFrame);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - from) > 5000) { shownBlocked = target; return; }
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / 650);
      shownBlocked = Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) tweenFrame = requestAnimationFrame(step);
    };
    tweenFrame = requestAnimationFrame(step);
  });

  function command(action, value) {
    if (typeof window.__lgLabCommand === 'function') {
      try { window.__lgLabCommand(JSON.stringify({ action, value })); return true; }
      catch { loading = false; navigationError = 'Se perdió la conexión. Espera un momento y vuelve a intentar.'; }
    } else if (['navigate', 'home', 'back', 'forward'].includes(action)) {
      loading = false;
      navigationError = 'El navegador está reconectando con la computadora. Espera un momento y vuelve a intentar.';
    }
    return false;
  }
  function navigate(value = address) {
    const input = value.trim();
    if (!input) return;
    try {
      const target = resolveNavigation(input, searchEngine);
      navigationError = ''; navigationTarget = target; loading = true;
      clearTimeout(navigationTimer);
      navigationTimer = setTimeout(() => { loading = false; navigationError = 'No llegó una respuesta. Reintenta o vuelve al inicio.'; }, 30000);
      command('navigate', target);
      document.activeElement?.blur();
    } catch (error) { loading = false; navigationError = error.message; navigationTarget = input; command('navigate', input); }
  }
  function goHome() {
    clearTimeout(navigationTimer); loading = false; navigationError = '';
    command('home');
  }
  function openTile(tile) {
    if (editing) { command('remove-favorite', { url: tile.url, category: tile.category }); return; }
    navigate(tile.url);
  }
  function openDialog(category) {
    editing = false; dialogError = '';
    dialog = { title: '', url: '', category, fresh: '' };
    tick().then(() => document.querySelector('.dialog input')?.focus());
  }
  async function closeDialog(restore = dialog?.category) {
    dialog = null;
    await tick();
    (document.querySelector(`.tile.add[data-category="${CSS.escape(restore || '')}"]`) || document.querySelector('.tile'))?.focus();
  }
  function saveBookmark() {
    if (!dialog) return;
    const input = dialog.url.trim();
    if (!connected) { dialogError = 'Conecta la computadora para guardar marcadores.'; return; }
    let url;
    try { url = resolveNavigation(input, 'google'); } catch (error) { dialogError = error.message; return; }
    if (!/^https?:\/\//i.test(input) && url.startsWith('https://www.google.com/search?q=')) { dialogError = 'Escribe una dirección web, por ejemplo crunchyroll.com.'; return; }
    const category = dialog.fresh.trim() || dialog.category;
    command('add-bookmark', { url, title: dialog.title.trim(), category });
    closeDialog(category);
  }
  function openCategoryDialog(mode, name = '') {
    catError = '';
    catDialog = { mode, from: name, name: mode === 'rename' ? name : '' };
    tick().then(() => document.querySelector('.dialog input, .dialog .actions button')?.focus());
  }
  async function closeCategoryDialog() {
    catDialog = null;
    await tick();
    (document.querySelector('.cat-new') || document.querySelector('.edit-button') || document.querySelector('.tile'))?.focus();
  }
  function saveCategory() {
    if (!catDialog) return;
    if (!connected) { catError = 'Conecta la computadora para cambiar las categorías.'; return; }
    const { mode, from } = catDialog;
    const name = catDialog.name.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (mode === 'delete') { command('remove-category', from); closeCategoryDialog(); return; }
    if (!name) { catError = 'Escribe un nombre para la categoría.'; return; }
    if (categories.some(item => item.toLowerCase() === name.toLowerCase() && item !== from)) { catError = 'Ya existe una categoría con ese nombre.'; return; }
    if (mode === 'new' && categories.length >= 8) { catError = 'Puedes tener hasta 8 categorías.'; return; }
    command(mode === 'new' ? 'add-category' : 'rename-category', mode === 'new' ? name : { from, to: name });
    closeCategoryDialog();
  }
  function toggleProtection() {
    if (!connected) return;
    enabled = !enabled;
    command('set-protection', enabled);
  }
  function chooseWallpaper(id) {
    wallpaper = id;
    try { localStorage.setItem('luma-wallpaper', id); } catch { /* The choice still applies this session. */ }
  }
  function changeDim(step) {
    dim = Math.min(90, Math.max(0, dim + step));
    try { localStorage.setItem('luma-dim', String(dim)); } catch { /* The choice still applies this session. */ }
  }
  async function openSettings() {
    settingsOpen = true; settingsNotice = ''; editing = false;
    command('settings');
    await tick();
    (document.querySelector('.row[aria-checked="true"]') || document.querySelector('.back-settings'))?.focus();
  }
  async function closeSettings() {
    settingsOpen = false;
    command('close-settings');
    await tick();
    document.querySelector('.settings-button')?.focus();
  }
  function selectSearchEngine(value) {
    if (pendingSearchEngine) return;
    if (!connected) { settingsNotice = 'Conecta la computadora para guardar la preferencia.'; return; }
    pendingSearchEngine = value; settingsNotice = 'Guardando…';
    command('set-search-engine', value);
  }
  function migrateLocalFavorites(current) {
    // 0.5.0 kept typed addresses in localStorage; the Mac now stores favorites.
    migrated = true;
    try {
      const saved = JSON.parse(localStorage.getItem('luma-favorites') || '[]');
      for (const item of Array.isArray(saved) ? saved : []) {
        const url = resolveNavigation(String(item?.url || ''), 'google');
        if (/\/search\?q=/.test(url) || current.some(favorite => favorite.url === url)) continue;
        command('favorite', { url, title: String(item?.name || '') });
      }
      localStorage.removeItem('luma-favorites');
    } catch { /* Nothing worth keeping. */ }
  }

  function remote(event) {
    const code = event.keyCode;
    const active = document.activeElement;
    if (code === 461 || code === 27) {
      if (navigationError) { event.preventDefault(); goHome(); }
      else if (active?.tagName === 'INPUT' && !dialog) { event.preventDefault(); active.blur(); moveFocus('down', active); }
      else if (catDialog) { event.preventDefault(); closeCategoryDialog(); }
      else if (dialog) { event.preventDefault(); closeDialog(); }
      else if (editing) { event.preventDefault(); editing = false; }
      else if (settingsOpen) { event.preventDefault(); closeSettings(); }
      return;
    }
    const direction = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code];
    const scope = document.querySelector('.feedback, .dialog') || document;
    if (active?.tagName === 'INPUT') {
      if (direction === 'up' || direction === 'down') { event.preventDefault(); active.blur(); moveFocus(direction, active, scope); }
      return;
    }
    if (direction) { event.preventDefault(); moveFocus(direction, active, scope); }
    else if (code === 13 && active?.tagName === 'BUTTON') { event.preventDefault(); active.click(); }
  }

  onMount(() => {
    try {
      // Show the last known bookmarks while the Mac connects.
      const cached = JSON.parse(localStorage.getItem('luma-bookmarks') || 'null');
      if (Array.isArray(cached?.bookmarks) && Array.isArray(cached?.categories)) { bookmarks = cached.bookmarks; categories = cached.categories; }
    } catch { /* No cache yet. */ }
    try {
      const saved = localStorage.getItem('luma-wallpaper');
      if (wallpapers.some(item => item.id === saved)) wallpaper = saved;
      const level = Number(localStorage.getItem('luma-dim'));
      if (localStorage.getItem('luma-dim') !== null && level >= 0 && level <= 90) dim = Math.round(level / 5) * 5;
    } catch { /* Defaults. */ }
    try { const saved = localStorage.getItem('luma-search-engine'); if (SEARCH_ENGINES.some(engine => engine.id === saved)) searchEngine = saved; } catch { /* Use Google until the saved preference arrives. */ }
    const update = event => {
      const detail = event.detail;
      if (detail.labURL) labURL = detail.labURL;
      lastHeartbeat = Date.now();
      debug = detail.debug === true;
      if (Array.isArray(detail.riskySites)) riskySites = detail.riskySites;
      if (Array.isArray(detail.tabs)) { tabs = detail.tabs; activeTabId = detail.activeTabId; }
      connected = !!detail.connected; blocked = detail.blocked || 0; enabled = detail.enabled !== false;
      if (Array.isArray(detail.favorites)) {
        bookmarks = detail.favorites;
        if (Array.isArray(detail.categories)) categories = detail.categories;
        if (!bookmarks.length && !categories.length) editing = false;
        try { localStorage.setItem('luma-bookmarks', JSON.stringify({ bookmarks, categories })); } catch { /* The Mac keeps the real copy. */ }
        if (!migrated) migrateLocalFavorites(detail.favorites);
      }
      if (SEARCH_ENGINES.some(engine => engine.id === detail.searchEngine)) {
        searchEngine = detail.searchEngine;
        try { localStorage.setItem('luma-search-engine', searchEngine); } catch { /* The bridge also persists this preference. */ }
        if (pendingSearchEngine === searchEngine) { pendingSearchEngine = ''; settingsNotice = 'Guardado. Las próximas búsquedas usarán ' + engineName + '.'; }
      }
      if (detail.showSettings && !settingsOpen) openSettings();
      message = detail.message || message;
      if (detail.navigation) {
        const nav = detail.navigation;
        loading = nav.phase === 'loading'; navigationError = nav.phase === 'error' ? nav.error : '';
        navigationTarget = nav.url || navigationTarget;
        if (!loading) clearTimeout(navigationTimer);
      }
    };
    const heartbeat = setInterval(() => {
      if (connected && Date.now() - lastHeartbeat > 6500) {
        connected = false;
        if (loading) { loading = false; navigationError = 'Se perdió la conexión. Espera un momento y vuelve a intentar.'; }
      }
    }, 2000);
    window.addEventListener('lg-lab-status', update);
    window.__lumaReady = true;
    requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) document.querySelector('.tile')?.focus(); });
    return () => { window.removeEventListener('lg-lab-status', update); clearInterval(heartbeat); clearTimeout(navigationTimer); cancelAnimationFrame(tweenFrame); };
  });
</script>

<svelte:window onkeydown={remote} />

<div class="app" style:background-image={`url(./${wallpaperFile})`} style:--dim={dim / 100}>
  <nav class="tabs" aria-label="Pestañas">
    <div class="tab-list">
      {#each tabs as tab (tab.id)}
        <div class="tab" class:selected={tab.id === activeTabId}>
          <button class="tab-select" aria-current={tab.id === activeTabId ? 'page' : undefined} title={tab.url} onclick={() => command('select-tab', tab.id)}>{tab.title}</button>
          <button class="tab-close" aria-label={'Cerrar ' + tab.title} onclick={() => command('close-tab', tab.id)}><Icon name="stop" size={18} /></button>
        </div>
      {/each}
    </div>
    <button class="new-tab" aria-label="Nueva pestaña" disabled={!connected || tabs.length >= 12} onclick={() => command('new-tab')}><Icon name="plus" size={24} /></button>
  </nav>
  {#if !settingsOpen}
    <header class="topbar">
      {#if debug}
      <button class="glass-button shield" class:paused={!enabled} class:offline={!connected} aria-label={connected ? (enabled ? 'Protección activa, ' + shownBlocked + ' bloqueados' : 'Protección en pausa') : 'Sin conexión con la computadora'} onclick={toggleProtection}>
        {#if connected}<Icon name={enabled ? 'shieldCheck' : 'shield'} size={26} />{:else}<Icon name="tv" size={26} />{/if}
        <span>{!connected ? 'Sin conexión' : enabled ? shownBlocked.toLocaleString('es') : 'En pausa'}</span>
      </button>
      {/if}
      {#if bookmarks.length || categories.length}<button class="glass-button edit-button" class:active={editing} aria-label={editing ? 'Terminar edición' : 'Editar marcadores y categorías'} onclick={() => (editing = !editing)}><Icon name={editing ? 'check' : 'pencil'} size={26} stroke={2.2} /></button>{/if}
      <button class="glass-button round settings-button" aria-label="Configuración" onclick={openSettings}><Icon name="gear" size={28} /></button>
    </header>
  {/if}

  {#if settingsOpen}
    <main class="view settings" aria-label="Configuración">
      <button class="back-settings" onclick={closeSettings}><Icon name="back" size={24} stroke={2.4} />Inicio</button>
      <h1>Configuración</h1>
      <div class="columns">
        <section>
          <h2 class="group-title">Buscador</h2>
          <div class="group" class:offline={!connected} role="radiogroup" aria-label="Buscador predeterminado">
            {#each SEARCH_ENGINES as engine}
              <button class="row" role="radio" aria-checked={searchEngine === engine.id} data-engine={engine.id} disabled={!connected} onclick={() => selectSearchEngine(engine.id)}>
                <span class="row-icon" style:--tint={engineTints[engine.id]}>{engine.name.slice(0, 1)}</span>
                <span class="row-label">{engine.name}{#if engine.id === 'google'}<small>Predeterminado</small>{/if}</span>
                <span class="check"><Icon name="check" size={28} stroke={2.6} /></span>
              </button>
            {/each}
          </div>
          <p class="group-note" role="status" aria-live="polite">{settingsNotice || (connected ? 'Se usa al escribir en cualquiera de las barras.' : 'Conecta la computadora para cambiar y guardar tu elección.')}</p>
          <h2 class="group-title">Fondo del inicio</h2>
          <div class="group appearance">
            <div class="wallpapers" role="radiogroup" aria-label="Fondo del inicio">
              {#each wallpapers as item}
                <button class="wallpaper" role="radio" aria-checked={wallpaper === item.id} data-wallpaper={item.id} onclick={() => chooseWallpaper(item.id)}>
                  <img src={'./' + item.file} alt="" />
                  <span>{item.name}</span>
                  <span class="check"><Icon name="check" size={26} stroke={2.8} /></span>
                </button>
              {/each}
            </div>
            <div class="dim-row">
              <span class="row-label">Oscurecer fondo<small>0 % lo muestra completo</small></span>
              <button class="step" aria-label="Menos oscuro" disabled={dim <= 0} onclick={() => changeDim(-5)}><Icon name="minus" size={26} stroke={2.8} /></button>
              <span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="90" aria-valuenow={dim}><span style:width={dim / 90 * 100 + '%'}></span></span>
              <strong class="dim-value">{dim} %</strong>
              <button class="step" aria-label="Más oscuro" disabled={dim >= 90} onclick={() => changeDim(5)}><Icon name="plus" size={26} stroke={2.8} /></button>
            </div>
          </div>
        </section>
        <section>
          <h2 class="group-title">Privacidad</h2>
          <div class="group" class:offline={!connected}>
            <button class="row" role="switch" aria-checked={enabled} disabled={!connected} onclick={toggleProtection}>
              <span class="row-icon" style:--tint="#34c759"><Icon name="shieldCheck" size={26} /></span>
              <span class="row-label">Bloquear anuncios y rastreadores<small>Motor de Brave · EasyList y EasyPrivacy</small></span>
              <span class="switch" class:on={enabled}><span></span></span>
            </button>
            <div class="row static">
              <span class="row-icon" style:--tint="#ff0033"><Icon name="play" size={26} /></span>
              <span class="row-label">YouTube sin anuncios<small>Incluido mientras la protección está activa</small></span>
            </div>
          </div>
          <h2 class="group-title">Laboratorio</h2>
          <div class="group">
            <button class="row" disabled={!labURL} onclick={() => navigate(labURL)}>
              <span class="row-icon" style:--tint="#5e5ce6"><Icon name="flask" size={24} /></span>
              <span class="row-label">Página de prueba<small>Anuncios controlados del laboratorio</small></span>
              <span class="chevron"><Icon name="chevron" size={24} /></span>
            </button>
          </div>
          <p class="group-note">Prototipo experimental · No introduzcas contraseñas.</p>
        </section>
      </div>
    </main>
  {:else}
    <main class="view home" class:dimmed={loading}>
      <div class="home-inner">
        <h1 class="rise" style:--i={0}>{greeting}</h1>
        <form class="search rise" style:--i={1} class:busy={loading} aria-busy={loading} onsubmit={event => { event.preventDefault(); navigate(); }}>
          <Icon name="search" size={34} stroke={2.2} />
          <input aria-label="Buscar o escribir dirección" bind:value={address} placeholder={'Buscar en ' + engineName + ' o escribir dirección'} autocomplete="off" spellcheck="false" />
          <span class="search-progress" aria-hidden="true"><span></span></span>
        </form>

        {#each rows as row, rowIndex (row.name)}
          <section class="category rise" style:--i={2 + rowIndex} aria-label={row.name}>
            <h2>{row.name}{#if editing}
              <button class="cat-action" aria-label={'Renombrar ' + row.name} onclick={() => openCategoryDialog('rename', row.name)}><Icon name="pencil" size={22} stroke={2.2} /></button>
              <button class="cat-action danger" aria-label={'Eliminar ' + row.name} onclick={() => openCategoryDialog('delete', row.name)}><Icon name="minus" size={22} stroke={3} /></button>
            {:else}<Icon name="chevron" size={22} stroke={2.6} />{/if}</h2>
            <div class="tiles" class:editing>
              {#each row.items as tile, index (tile.category + '\n' + tile.url)}
                <button class="tile" style:--tint={tile.tint} style:--ink={tile.ink} style:--i={index} aria-label={editing ? 'Quitar ' + tile.title + ' de ' + row.name : tile.risky ? tile.title + ', cerró la app las últimas veces' : tile.title} onclick={() => openTile(tile)}>
                  <span class="tile-icon" class:solid={tile.mark || tile.glyph}>
                    {#if tile.glyph}<Icon name={tile.glyph} size={58} />{:else}<span class="mark" class:long={tile.long}>{tile.mark}</span>{/if}
                    {#if editing}<span class="remove"><Icon name="minus" size={20} stroke={3} /></span>{:else if tile.risky}<span class="risky" title="Cerró la app las últimas veces"><Icon name="alert" size={20} stroke={2.6} /></span>{/if}
                  </span>
                  <span class="tile-name">{tile.title}</span>
                </button>
              {/each}
              <button class="tile add" data-category={row.name} style:--i={row.items.length} aria-label={'Agregar marcador a ' + row.name} onclick={() => openDialog(row.name)}>
                <span class="tile-icon plain"><Icon name="plus" size={42} stroke={2} /></span>
                <span class="tile-name">Agregar</span>
              </button>
            </div>
          </section>
        {/each}
        {#if editing || !rows.length}
          <button class="cat-new" onclick={() => openCategoryDialog('new')}><Icon name="plus" size={26} stroke={2.4} />Nueva categoría</button>
        {/if}
      </div>
    </main>
  {/if}

</div>

{#if dialog}
  <div class="scrim">
    <form class="dialog" aria-label="Nuevo marcador" onsubmit={event => { event.preventDefault(); saveBookmark(); }}>
      <h2>Nuevo marcador</h2>
      <label>Nombre<input bind:value={dialog.title} placeholder="Crunchyroll" autocomplete="off" spellcheck="false" /></label>
      <label>Dirección<input bind:value={dialog.url} placeholder="crunchyroll.com" autocomplete="off" spellcheck="false" /></label>
      <div class="field">
        <span class="label">Categoría</span>
        <div class="choices" role="radiogroup" aria-label="Categoría">
          {#each categories as name}
            <button type="button" class="choice" role="radio" aria-checked={!dialog.fresh.trim() && dialog.category === name} onclick={() => { dialog.category = name; dialog.fresh = ''; }}>{name}</button>
          {/each}
        </div>
        <input class="fresh" bind:value={dialog.fresh} placeholder="…o escribe una categoría nueva" maxlength="24" autocomplete="off" spellcheck="false" aria-label="Categoría nueva" />
      </div>
      <p class="error" role="alert">{dialogError}</p>
      <div class="actions">
        <button type="button" onclick={() => closeDialog()}>Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  </div>
{/if}

{#if catDialog}
  <div class="scrim">
    <form class="dialog" aria-label={catDialog.mode === 'new' ? 'Nueva categoría' : catDialog.mode === 'rename' ? 'Renombrar categoría' : 'Eliminar categoría'} onsubmit={event => { event.preventDefault(); saveCategory(); }}>
      {#if catDialog.mode === 'delete'}
        <h2>Eliminar «{catDialog.from}»</h2>
        {@const n = bookmarks.filter(item => item.category === catDialog.from).length}
        <p class="cat-note">{n ? 'Se quitarán también ' + (n === 1 ? 'su marcador' : 'sus ' + n + ' marcadores') + '.' : 'La categoría está vacía.'}</p>
      {:else}
        <h2>{catDialog.mode === 'new' ? 'Nueva categoría' : 'Renombrar categoría'}</h2>
        <label>Nombre<input bind:value={catDialog.name} placeholder="Series" maxlength="24" autocomplete="off" spellcheck="false" /></label>
      {/if}
      <p class="error" role="alert">{catError}</p>
      <div class="actions">
        <button type="button" onclick={closeCategoryDialog}>Cancelar</button>
        <button type="submit" class="primary" class:destructive={catDialog.mode === 'delete'}>{catDialog.mode === 'delete' ? 'Eliminar' : 'Guardar'}</button>
      </div>
    </form>
  </div>
{/if}

<NavigationFeedback error={navigationError} target={navigationTarget} onretry={() => navigate(navigationTarget || address)} onhome={goHome} />

<style>
  :global(:root){
    /* Dark glass over the photo, always: it is a TV living-room UI. */
    --bg:#05070d;--surface:rgba(26,29,40,.72);--text:#f5f5f7;--secondary:#c9ccd6;--tertiary:#9ca0ad;--fill:rgba(255,255,255,.12);--separator:rgba(255,255,255,.14);
    --glass:rgba(255,255,255,.09);--glass-edge:rgba(255,255,255,.16);
    --blue:#0a84ff;--green:#34c759;--orange:#ff9f0a;
    --shadow:0 20px 50px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.08);
    --ease:cubic-bezier(.2,.8,.2,1);--spring:cubic-bezier(.34,1.56,.64,1);
    color-scheme:dark;
  }
  :global(*){box-sizing:border-box}
  :global(html),:global(body){margin:0;height:100%;overflow:hidden}
  :global(body){font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,"LG Smart UI","Helvetica Neue",Arial,sans-serif;color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased}
  :global(button),:global(input){font:inherit;color:inherit}
  :global(button){cursor:pointer;-webkit-tap-highlight-color:transparent}
  @media (prefers-reduced-motion:reduce){:global(*),:global(*::before),:global(*::after){animation:none!important;transition:none!important}}

  /* The photo is dimmed twice: a flat veil for legibility and a vignette that quiets the edges. */
  .app{position:relative;height:100vh;display:flex;flex-direction:column;overflow:hidden;background-color:var(--bg);background-size:cover;background-position:center}
  .app::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 40%,rgba(4,6,12,calc(var(--dim,.35) * .75)),rgba(4,6,12,calc(var(--dim,.35) * 1.2)) 100%)}
  .app > :global(*){position:relative}
  .tabs{position:absolute!important;top:16px;left:56px;right:56px;z-index:6;display:flex;align-items:center;gap:12px;height:52px}
  .tab-list{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;min-width:0}
  .tab{display:flex;flex-shrink:0;align-items:center;background:rgba(24,24,28,.82);border:1px solid rgba(255,255,255,.12);border-radius:14px;color:#c7c7cc}
  .tab.selected{background:rgba(255,255,255,.23);border-color:rgba(255,255,255,.4);color:#fff}
  .tab-select{border:0;background:transparent;max-width:250px;min-width:100px;padding:12px 16px;color:inherit;font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:12px}
  .tab-close,.new-tab{border:0;background:transparent;display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;color:inherit;border-radius:12px}
  .new-tab{color:#fff;background:rgba(24,24,28,.55)}
  .tabs button:focus{outline:3px solid #fff;outline-offset:-3px;background:rgba(255,255,255,.22)}
  .topbar{position:absolute!important;top:68px;right:0;z-index:5;padding:24px 56px;display:flex;align-items:center;gap:16px}
  .glass-button{height:64px;padding:0 26px;border:1px solid var(--glass-edge);border-radius:20px;background:rgba(40,44,58,.82);display:flex;align-items:center;justify-content:center;gap:12px;color:#f2f2f7;font-size:22px;font-weight:500;font-variant-numeric:tabular-nums;box-shadow:0 10px 30px rgba(0,0,0,.28);transition:background .2s,transform .45s var(--spring),box-shadow .25s}
  .glass-button.round,.edit-button{width:64px;padding:0}
  .glass-button.shield{color:#30d158}.glass-button.paused{color:var(--secondary)}.glass-button.offline{color:#ffd9a0}
  .glass-button.active{background:rgba(10,132,255,.7)}
  .glass-button:hover{background:rgba(70,76,98,.7)}
  .glass-button:focus{outline:none;background:rgba(255,255,255,.26);color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.9),0 16px 36px rgba(0,0,0,.4);transform:scale(1.08)}
  .glass-button:active{transform:scale(.94)}

  .view{flex:1;min-height:0;width:1320px;margin:0 auto}
  /* margin:auto centres short content and still lets tall content scroll. */
  .home{display:flex;overflow-y:auto;scrollbar-width:none;transition:opacity .35s var(--ease)}
  .home::-webkit-scrollbar{display:none}
  .home-inner{margin:auto;width:100%;padding:56px 0 24px;display:flex;flex-direction:column;gap:26px}
  .home.dimmed{opacity:.55}
    h1{font-size:62px;font-weight:700;letter-spacing:-1.4px;margin:0;line-height:1.05;text-align:center;text-shadow:0 4px 24px rgba(0,0,0,.45)}

  .search{position:relative;align-self:center;width:1020px;display:flex;align-items:center;gap:20px;height:84px;margin-bottom:10px;padding:0 34px;border-radius:42px;border:1px solid var(--glass-edge);background:rgba(36,40,54,.82);box-shadow:0 18px 44px rgba(0,0,0,.3);color:#e5e6ec;transition:box-shadow .3s var(--ease),transform .45s var(--spring),background .2s}
  .search:focus-within{background:rgba(70,76,98,.62);box-shadow:0 0 0 3px rgba(255,255,255,.9),0 22px 50px rgba(0,0,0,.4);transform:scale(1.015)}
  .search input{flex:1;min-width:0;height:100%;border:0;outline:none;background:transparent;font-size:27px;color:#fff}
  .search input::placeholder{color:#b4b7c3}
  .search-progress{position:absolute;left:34px;right:34px;bottom:0;height:3px;overflow:hidden;border-radius:3px;opacity:0;transition:opacity .2s}
  .search.busy .search-progress{opacity:1}
  .search-progress span{display:block;width:34%;height:100%;border-radius:3px;background:#fff;animation:travel 1.15s var(--ease) infinite}

  .category h2{display:flex;align-items:center;gap:8px;font-size:26px;font-weight:600;letter-spacing:-.2px;margin:0;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.5)}
  .category h2 :global(svg){opacity:.8;margin-top:3px}
  /* Generous padding so the focus glow is not clipped by the scroller. */
  .tiles{display:flex;gap:22px;overflow-x:auto;padding:22px 40px 42px;margin:-8px -40px -34px;scroll-behavior:smooth;scroll-padding:0 40px;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)}
  .tiles::-webkit-scrollbar{display:none}
  .tile{flex:none;width:118px;padding:0;border:0;background:none;display:flex;flex-direction:column;align-items:center;gap:12px;color:#e3e5ec}
  .tile:focus{outline:none}
  .tile-icon{position:relative;width:104px;height:84px;border-radius:22px;display:grid;place-items:center;color:var(--tint);overflow:visible;background:linear-gradient(160deg,rgba(255,255,255,.13),rgba(255,255,255,.05));border:1px solid var(--glass-edge);box-shadow:0 10px 24px rgba(0,0,0,.3);transition:transform .5s var(--spring),box-shadow .3s var(--ease),background .3s}
  .tile-icon.solid{background:linear-gradient(160deg,color-mix(in srgb,var(--tint) 70%,#fff),var(--tint));color:var(--ink);border-color:rgba(255,255,255,.25)}
  .tile-icon.plain{color:#fff}
  .mark{font-size:36px;font-weight:700;letter-spacing:-.5px;line-height:1}
  .mark.long{font-size:22px;letter-spacing:-.3px;text-transform:lowercase}
  .tile:focus .tile-icon,.tile:hover .tile-icon{transform:translateY(-6px) scale(1.1);box-shadow:0 0 0 3px rgba(255,255,255,.92),0 20px 40px rgba(0,0,0,.45)}
  .tile:active .tile-icon{transform:scale(.95)}
  .tile-name{max-width:100%;font-size:19px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 8px rgba(0,0,0,.6);transition:color .2s,transform .5s var(--spring)}
  .tile:focus .tile-name{color:#fff;transform:translateY(4px)}
  .risky{position:absolute;top:-8px;right:-8px;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:#ff9f0a;color:#1c1c1e;box-shadow:0 4px 10px rgba(0,0,0,.35)}
  .remove{position:absolute;top:-10px;left:-10px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#ff3b30;color:#fff;box-shadow:0 4px 10px rgba(0,0,0,.3);animation:pop .4s var(--spring)}
  .editing .tile:not(.add) .tile-icon{animation:jiggle .32s ease-in-out infinite alternate}

  /* Add-bookmark sheet */
  .scrim{position:fixed;inset:0;z-index:40;display:grid;place-items:center;background:rgba(3,5,10,.62);animation:fade .25s ease-out}
  .dialog{width:820px;padding:40px 44px 36px;border-radius:32px;background:rgba(30,33,46,.9);-webkit-backdrop-filter:blur(30px) saturate(1.5);backdrop-filter:blur(30px) saturate(1.5);border:1px solid var(--glass-edge);box-shadow:0 30px 80px rgba(0,0,0,.6);animation:rise .45s var(--ease)}
  .dialog h2{font-size:36px;letter-spacing:-.5px;margin-bottom:26px}
  .dialog label,.dialog .field{display:block;margin-bottom:20px}
  .dialog label,.dialog .label{display:block;font-size:17px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:var(--tertiary)}
  .dialog input{display:block;width:100%;height:66px;margin-top:10px;padding:0 24px;border:0;border-radius:18px;background:rgba(255,255,255,.1);outline:none;font-size:25px;color:#fff;text-transform:none;letter-spacing:0;font-weight:400;transition:box-shadow .25s,background .2s}
  .dialog input::placeholder{color:#8f93a1}
  .dialog input:focus{background:rgba(255,255,255,.18);box-shadow:0 0 0 3px rgba(255,255,255,.9)}
  .choices{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}
  .choice{height:56px;padding:0 26px;border:0;border-radius:28px;background:rgba(255,255,255,.1);font-size:22px;font-weight:500;transition:background .2s,transform .4s var(--spring),box-shadow .25s}
  .choice[aria-checked="true"]{background:var(--blue);color:#fff}
  .choice:focus,.choice:hover{outline:none;box-shadow:0 0 0 3px rgba(255,255,255,.9);transform:scale(1.06)}
  .dialog .fresh{height:56px;font-size:22px;margin-top:14px}
  .error{min-height:28px;margin:0 0 6px;font-size:20px;color:#ff9f8a}
  .dialog .actions{display:flex;justify-content:flex-end;gap:16px}
  .dialog .actions button{height:60px;padding:0 34px;border:0;border-radius:18px;background:rgba(255,255,255,.12);font-size:22px;font-weight:600;transition:transform .4s var(--spring),box-shadow .25s,background .2s}
  .dialog .actions .primary{background:var(--blue);color:#fff}
  .dialog .actions button:focus,.dialog .actions button:hover{outline:none;transform:scale(1.07);box-shadow:0 0 0 3px rgba(255,255,255,.9)}

  .appearance{padding:18px}
  .wallpapers{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .wallpaper{position:relative;padding:0;border:0;border-radius:18px;overflow:hidden;background:#000;aspect-ratio:16/9;transition:transform .4s var(--spring),box-shadow .25s}
  .wallpaper img{display:block;width:100%;height:100%;object-fit:cover}
  .wallpaper > span:not(.check){position:absolute;left:0;right:0;bottom:0;padding:26px 14px 10px;font-size:19px;font-weight:600;text-align:left;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.7))}
  .wallpaper .check{position:absolute;top:10px;right:10px;margin:0;width:38px;height:38px;border-radius:50%;align-items:center;justify-content:center;background:var(--blue);color:#fff}
  .wallpaper[aria-checked="true"] .check{opacity:1;transform:none}
  .wallpaper[aria-checked="true"]{box-shadow:0 0 0 3px var(--blue)}
  .wallpaper:focus,.wallpaper:hover{outline:none;transform:scale(1.04);box-shadow:0 0 0 3px #fff,0 14px 30px rgba(0,0,0,.45)}
  .dim-row{display:flex;align-items:center;gap:14px;margin-top:18px;padding:0 4px;font-size:23px}
  .dim-row .row-label{flex:1}
  .step{flex:none;width:56px;height:56px;border:0;border-radius:16px;background:rgba(255,255,255,.12);display:grid;place-items:center;transition:background .2s,transform .4s var(--spring),box-shadow .25s}
  .step:focus,.step:hover{outline:none;background:rgba(255,255,255,.24);box-shadow:0 0 0 3px #fff;transform:scale(1.08)}
  .step:disabled{opacity:.35}
  .meter{flex:none;width:150px;height:8px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden}
  .meter span{display:block;height:100%;border-radius:4px;background:#fff}
  .dim-value{flex:none;width:72px;text-align:right;font-size:24px;font-variant-numeric:tabular-nums}
  .settings{padding-top:88px;overflow-y:auto;scrollbar-width:none}
  .back-settings{display:inline-flex;align-items:center;gap:6px;height:52px;padding:0 18px 0 10px;border:0;border-radius:14px;background:transparent;color:var(--blue);font-size:22px;font-weight:500;transition:background .2s,transform .4s var(--spring),box-shadow .25s}
  .back-settings:focus,.back-settings:hover{outline:none;background:var(--surface);box-shadow:0 0 0 3px var(--blue);transform:scale(1.05)}
  .settings h1{font-size:56px;letter-spacing:-1.2px;margin:16px 0 34px}
  .columns{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
  .group-title{font-size:17px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--tertiary);margin:0 0 12px 26px}
  .group-title:not(:first-child){margin-top:34px}
  .group{background:var(--surface);border:1px solid var(--glass-edge);border-radius:24px;box-shadow:var(--shadow);overflow:hidden}
  .row{position:relative;width:100%;min-height:84px;padding:0 28px 0 22px;border:0;background:transparent;display:flex;align-items:center;gap:20px;text-align:left;font-size:23px;color:var(--text);transition:background .22s var(--ease),color .22s}
  .row + .row::before{content:'';position:absolute;top:0;left:86px;right:0;height:1px;background:var(--separator)}
  .row:focus,.row:not(.static):hover{outline:none;background:var(--blue);color:#fff}
  .row:focus::before,.row:focus + .row::before{opacity:0}
  .row:disabled{cursor:default}
  .offline .row:disabled{opacity:.5}
  .row-icon{flex:none;width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:var(--tint);color:#fff;font-size:23px;font-weight:700}
  .row-label{display:flex;flex-direction:column;gap:4px;min-width:0}
  .row-label small{font-size:17px;color:var(--secondary);transition:color .22s}
  .row:focus small,.row:not(.static):hover small{color:rgba(255,255,255,.82)}
  .check{margin-left:auto;display:flex;color:var(--blue);opacity:0;transform:scale(.5);transition:opacity .2s,transform .4s var(--spring)}
  .row[aria-checked="true"] .check{opacity:1;transform:none}
  .row:focus .check{color:#fff}
  .chevron{margin-left:auto;display:flex;color:var(--tertiary)}
  .row:focus .chevron{color:#fff}
  .switch{flex:none;margin-left:auto;position:relative;width:66px;height:40px;border-radius:20px;background:rgba(120,120,128,.32);transition:background .3s var(--ease)}
  .switch span{position:absolute;top:4px;left:4px;width:32px;height:32px;border-radius:50%;background:#fff;box-shadow:0 3px 8px rgba(0,0,0,.18);transition:transform .4s var(--spring)}
  .switch.on{background:var(--green)}
  .switch.on span{transform:translateX(26px)}
  .row:focus .switch{box-shadow:0 0 0 2px rgba(255,255,255,.7)}
  .cat-action{display:inline-grid;place-items:center;width:44px;height:44px;margin-left:6px;border:0;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;transition:transform .4s var(--spring),box-shadow .25s}
  .cat-action.danger{background:#ff3b30}
  .cat-action:focus,.cat-action:hover{outline:none;transform:scale(1.15);box-shadow:0 0 0 3px #fff}
  .cat-new{align-self:center;display:flex;align-items:center;gap:12px;height:64px;padding:0 30px;border:1px solid var(--glass-edge);border-radius:32px;background:rgba(40,44,58,.82);font-size:22px;font-weight:500;color:#f2f2f7;transition:transform .4s var(--spring),box-shadow .25s}
  .cat-new:focus,.cat-new:hover{outline:none;transform:scale(1.07);box-shadow:0 0 0 3px #fff}
  .cat-note{font-size:23px;line-height:1.4;color:var(--secondary);margin:0 0 20px}
  .dialog .actions .destructive{background:#ff3b30}
  .group-note{font-size:18px;line-height:1.4;color:var(--secondary);margin:14px 26px 0;min-height:26px}

  @keyframes fade{from{opacity:0}}
  @keyframes view-in{from{opacity:0;transform:translateY(14px)}}
  @keyframes rise{from{opacity:0;transform:translateY(26px)}}
  @keyframes travel{from{transform:translateX(-110%)}to{transform:translateX(310%)}}
  @keyframes pop{from{transform:scale(0)}}
  @keyframes jiggle{from{transform:rotate(-1.6deg)}to{transform:rotate(1.6deg)}}
</style>
