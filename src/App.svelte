<script>
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import NavigationFeedback from './NavigationFeedback.svelte';
  import { SECTIONS, sectionRows, kindLabel, clock, remaining } from './holy.js';

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

  const rows = $derived(sectionRows(data, section));
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
    const next = focused || data.hero;
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
      const response = await fetch(apiBase + '/holy-api/home', { cache: 'no-store' });
      if (!response.ok) throw Error(response.status);
      const fresh = await response.json();
      data = fresh;
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
    for (const key of ['score', 'reason', 'percent', 'resume', 'layout']) delete payload[key];
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
    section = id; rowIndex = 0; inNav = false;
  }
  function move(direction) {
    if (inNav) {
      if (direction === 'left') navIndex = Math.max(0, navIndex - 1);
      else if (direction === 'right') navIndex = Math.min(SECTIONS.length, navIndex + 1);
      else if (direction === 'down' && rows.length) inNav = false;
      return;
    }
    if (!row) { if (direction === 'up') inNav = true; return; }
    if (direction === 'left' || direction === 'right') {
      const next = Math.max(0, Math.min(row.items.length - 1, column + (direction === 'right' ? 1 : -1)));
      columns = { ...columns, [row.id]: next };
    } else if (direction === 'up') {
      if (rowIndex === 0) { inNav = true; navIndex = Math.max(0, SECTIONS.findIndex(entry => entry.id === section)); }
      else rowIndex--;
    } else if (direction === 'down' && rowIndex < rows.length - 1) rowIndex++;
  }
  function remote(event) {
    const code = event.keyCode;
    if (navigationError) return;
    const direction = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code];
    if (direction) { event.preventDefault(); if (!opening) move(direction); return; }
    if (code === 13) {
      event.preventDefault();
      if (opening) return;
      if (inNav) { if (navIndex === SECTIONS.length) refresh(); else chooseSection(SECTIONS[navIndex].id); }
      else play(focused);
    } else if (code === 403) { event.preventDefault(); forget(focused); }
    else if (code === 461 || code === 27) {
      if (opening) { event.preventDefault(); opening = null; command('home'); }
      else if (inNav) { event.preventDefault(); inNav = false; }
      else if (rowIndex > 0) { event.preventDefault(); rowIndex = 0; }
      else if (section !== 'inicio') { event.preventDefault(); chooseSection('inicio'); }
    }
  }
  function refresh() {
    notice = 'Buscando estrenos en tus sitios…';
    if (!command('refresh-catalog') && apiBase) fetch(apiBase + '/holy-api/refresh', { method: 'POST' }).catch(() => {});
    setTimeout(load, 4000);
  }
  // Pointer (Magic Remote): hovering focuses, clicking plays.
  function hover(r, c) {
    inNav = false; rowIndex = r;
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
      if (detail.navigation?.phase === 'error' && opening) { opening = null; navigationError = detail.navigation.error; navigationTarget = detail.navigation.url || ''; }
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
        <button class:current={section === entry.id} class:focus={inNav && navIndex === index} onclick={() => chooseSection(entry.id)}>{entry.name}</button>
      {/each}
      <button class="icon" class:focus={inNav && navIndex === SECTIONS.length} aria-label="Buscar estrenos ahora" onclick={refresh}><Icon name="reload" size={26} stroke={2.4} /></button>
    </nav>
    <span class="status" class:offline={!connected}>{connected ? 'Conectado al Mac' : 'Sin Mac'}</span>
  </header>

  {#if preview}
    <section class="preview" aria-live="polite">
      {#key preview.url}
        <div class="preview-text">
          {#if preview.reason}<p class="reason">{preview.reason}</p>{/if}
          <h1 class:long={preview.title.length > 28}>{preview.title}</h1>
          <p class="meta">
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
            <span class="key">OK</span>{preview.resume ? 'Continuar desde ' + clock(preview.t) : preview.upNext ? 'Ver ' + (preview.subtitle || 'siguiente') : 'Reproducir'}
            {#if preview.resume && preview.duration}<span class="left">{remaining(preview.t, preview.duration)}</span>{/if}
            {#if row?.id === 'continue' && !inNav}<span class="key red-key"></span>Quitar de la fila{/if}
          </p>
        </div>
      {/key}
    </section>
  {/if}

  <main class="shelves" class:nav-focus={inNav}>
    {#if !rows.length}
      <div class="empty">
        <h2>{notice || (apiBase ? 'Preparando tu catálogo…' : 'Conectando con el Mac…')}</h2>
        <p>Holy toma los estrenos de tus sitios favoritos y los ordena según lo que ves.</p>
      </div>
    {/if}
    <div class="rows" bind:this={rowsEl}>
      {#each rows as shelf, r (section + shelf.id)}
        <section class="row" class:active={!inNav && r === rowIndex} class:past={r < rowIndex} aria-label={shelf.title}>
          <h2>{shelf.title}</h2>
          <div class="track-clip">
            <div class="track" style:transform={`translateX(${-(columns[shelf.id] || 0) * ((shelf.layout === 'landscape' ? 400 : 230) + 20)}px)`}>
              {#each shelf.items as item, c (item.url + c)}
                {@const active = !inNav && r === rowIndex && c === column}
                <button class="card" class:landscape={shelf.layout === 'landscape'} class:focus={active} aria-label={item.title + (item.subtitle ? ', ' + item.subtitle : '')}
                  onmouseenter={() => hover(r, c)} onclick={() => { hover(r, c); play(item); }}>
                  <span class="art">
                    <span class="fallback">{item.title}</span>
                    {#if shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop}
                      <img src={img(shelf.layout === 'landscape' ? item.backdrop || item.poster : item.poster || item.backdrop)} alt="" loading={c < 8 ? 'eager' : 'lazy'} onerror={event => event.currentTarget.remove()} />
                    {/if}
                    {#if item.badge && shelf.layout !== 'landscape'}<span class="badge">{item.badge}</span>{/if}
                    {#if shelf.layout === 'landscape'}
                      <span class="caption"><strong>{item.title}</strong>{#if item.subtitle}<small>{item.subtitle}</small>{/if}</span>
                    {/if}
                    {#if item.percent}<span class="progress"><span style:width={item.percent + '%'}></span></span>{/if}
                    {#if item.upNext}<span class="next">Siguiente</span>{/if}
                  </span>
                </button>
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
  .track{display:flex;gap:20px;transition:transform .4s var(--ease);will-change:transform}
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
