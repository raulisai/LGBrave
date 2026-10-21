<script>
  import { onMount } from 'svelte';
  import { runNativeValidation, runNativePrefilterValidation } from './native-engine.js';
  import { resolveNavigation, SEARCH_ENGINES } from './navigation.js';
  import NavigationFeedback from './NavigationFeedback.svelte';
  let address = $state('');
  let connected = $state(false);
  let blocked = $state(0);
  let message = $state('Conecta el laboratorio del Mac para navegar con filtros.');
  let favorites = $state([]);
  let nativeBusy = $state(false);
  let loading = $state(false);
  let navigationError = $state('');
  let navigationTarget = $state('');
  let navigationTimer;
  let lastHeartbeat = 0;
  let searchEngine = $state('google');
  let settingsOpen = $state(false);
  let settingsNotice = $state('');
  let pendingSearchEngine = $state('');
  const engineName = $derived(SEARCH_ENGINES.find(engine => engine.id === searchEngine)?.name || 'Google');
  function openSettings() {
    settingsOpen = true; settingsNotice = '';
    if (typeof window.__lgLabCommand === 'function') command('settings');
  }
  function closeSettings() {
    settingsOpen = false;
    if (typeof window.__lgLabCommand === 'function') command('close-settings');
  }
  function selectSearchEngine(value) {
    if (!connected) { settingsNotice = 'Conecta el navegador para guardar la preferencia.'; return; }
    pendingSearchEngine = value; settingsNotice = 'Guardando…';
    command('set-search-engine', value);
  }
  async function validateNative() {
    nativeBusy = true;
    message = 'Validando el motor local en esta pantalla…';
    try {
      const report = await runNativeValidation();
      window.__lumaNativeReport = report;
      message = `Motor local: ${report.cases.filter(item => item.pass).length}/${report.cases.length} reglas correctas. Prueba de red inicial parcial.`;
    } catch (error) { message = 'Validación local: ' + error.message; }
    finally { nativeBusy = false; }
  }
  const sites = [
    { name: 'Wikipedia', letter: 'W', color: '#54677d', url: 'https://es.wikipedia.org' },
    { name: 'MDN Web Docs', letter: 'M', color: '#526de0', url: 'https://developer.mozilla.org' },
    { name: 'BBC', letter: 'B', color: '#b65357', url: 'https://www.bbc.com' },
    { name: 'Laboratorio', letter: 'L', color: '#3c9689', url: 'http://192.168.1.148:43187/fixture?run=manual' }
  ];
  function command(action, value) {
    if (typeof window.__lgLabCommand === 'function') {
      try { window.__lgLabCommand(JSON.stringify({ action, value })); }
      catch { loading = false; navigationError = 'Se perdió la conexión. Espera un momento y vuelve a intentar.'; }
    } else {
      loading = false;
      navigationError = 'El navegador está reconectando. Espera un momento y vuelve a intentar.';
      message = navigationError;
    }
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
  function saveFavorite() {
    if (!address.trim()) return;
    favorites = [...favorites, { name: address, url: address }].slice(-6);
    localStorage.setItem('luma-favorites', JSON.stringify(favorites));
  }
  function remote(event) {
    if (event.keyCode === 461 && settingsOpen) { event.preventDefault(); closeSettings(); return; }
    const active = document.activeElement;
    if (active?.tagName === 'INPUT') return;
    if ([37, 38, 39, 40].includes(event.keyCode)) {
      event.preventDefault();
      const controls = [...document.querySelectorAll(loading || navigationError ? '.feedback button' : 'button,input')].filter(el => !el.disabled);
      const current = controls.indexOf(active);
      const direction = event.keyCode === 37 || event.keyCode === 38 ? -1 : 1;
      controls[(current + direction + controls.length) % controls.length]?.focus();
    }
    if (event.keyCode === 13 && active?.tagName === 'BUTTON') { event.preventDefault(); active.click(); }
  }
  onMount(() => {
    try { const saved = localStorage.getItem('luma-search-engine'); if (SEARCH_ENGINES.some(engine => engine.id === saved)) searchEngine = saved; } catch { /* Use Google until the saved preference arrives. */ }
    try { favorites = JSON.parse(localStorage.getItem('luma-favorites') || '[]').filter(item => typeof item.url === 'string'); } catch { favorites = []; }
    const update = event => {
      lastHeartbeat = Date.now();
      connected = !!event.detail.connected; blocked = event.detail.blocked || 0;
      if (SEARCH_ENGINES.some(engine => engine.id === event.detail.searchEngine)) {
        searchEngine = event.detail.searchEngine;
        try { localStorage.setItem('luma-search-engine', searchEngine); } catch { /* The bridge also persists this preference. */ }
        if (pendingSearchEngine === searchEngine) { pendingSearchEngine = ''; settingsNotice = 'Preferencia guardada. Las próximas búsquedas usarán ' + engineName + '.'; }
      }
      if (event.detail.showSettings) settingsOpen = true;
      if (!nativeBusy) message = event.detail.message || message;
      if (event.detail.navigation) {
        const nav = event.detail.navigation;
        loading = nav.phase === 'loading'; navigationError = nav.phase === 'error' ? nav.error : '';
        navigationTarget = nav.url || navigationTarget;
        if (!loading) clearTimeout(navigationTimer);
      }
    };
    const heartbeat = setInterval(() => {
      if (connected && Date.now() - lastHeartbeat > 6500) {
        connected = false; message = 'Reconectando con el navegador…';
        if (loading) { loading = false; navigationError = 'Se perdió la conexión. Espera un momento y vuelve a intentar.'; }
      }
    }, 2000);
    window.addEventListener('lg-lab-status', update);
    window.__lumaReady = true;
    window.__lumaRunNative = runNativeValidation;
    window.__lumaRunPrefilter = runNativePrefilterValidation;
    return () => { window.removeEventListener('lg-lab-status', update); clearInterval(heartbeat); clearTimeout(navigationTimer); };
  });
</script>
<svelte:window onkeydown={remote} />
<div class="browser">
  <header class="chrome">
    <div class="toolbar">
      <div class="navigation"><button aria-label="Inicio" onclick={() => command('home')}>⌂</button><button aria-label="Atrás" onclick={() => command('back')}>‹</button><button aria-label="Adelante" onclick={() => command('forward')}>›</button></div>
      <form onsubmit={event => { event.preventDefault(); navigate(); }} aria-busy={loading}><span class="secure">◈</span><input aria-label="Buscar o introducir dirección" bind:value={address} placeholder={'Buscar con ' + engineName + ' o introducir dirección'} /><button aria-label="Navegar" type="submit" class="go">Ir</button></form>
      <div class="navigation"><button aria-label="Guardar favorito" onclick={saveFavorite}>☆</button><button class="shield" onclick={() => command('toggle')}>Protección</button><button class="settings-button" onclick={openSettings}>Configuración</button></div>
    </div>
    <div class="tabstrip"><div class="tab"><span class="tab-dot"></span>{settingsOpen ? 'Configuración' : 'Página de inicio'}<span class="tab-close">×</span></div><span class="tab-note">Luma · Browser Lab</span></div>
  </header>
  <main>
    {#if settingsOpen}
      <section class="settings" aria-label="Configuración">
        <button class="back-settings" onclick={closeSettings}>‹ Volver al inicio</button>
        <div class="eyebrow">A TU MANERA</div>
        <h1>Configuración</h1>
        <h2>Buscador predeterminado</h2>
        <p class="subtitle">Elige dónde buscar al escribir en la barra de direcciones.</p>
        <div class="engine-grid" role="radiogroup" aria-label="Buscador predeterminado">
          {#each SEARCH_ENGINES as engine}
            <button class="engine-card" class:selected={searchEngine === engine.id} role="radio" aria-checked={searchEngine === engine.id} data-engine={engine.id} disabled={!connected || !!pendingSearchEngine} onclick={() => selectSearchEngine(engine.id)}>
              <span class="engine-initial" class:google={engine.id === 'google'}>{engine.name.slice(0, 1)}</span>
              <span class="engine-label"><strong>{engine.name}</strong><span>{engine.id === 'google' ? 'Predeterminado de Luma' : 'Disponible para tus búsquedas'}</span></span>
              <span class="radio-dot" aria-hidden="true"></span>
            </button>
          {/each}
        </div>
        <p class="settings-notice" role="status" aria-live="polite">{settingsNotice || (connected ? 'Tu elección se guarda y se aplica a las dos barras de búsqueda.' : 'Conecta el navegador para cambiar y guardar tu elección.')}</p>
        <p class="settings-note">El buscador elegido no cambia tu configuración de bloqueo de anuncios y rastreadores.</p>
      </section>
    {:else}
    <div class="eyebrow">TU ESPACIO EN LA WEB</div>
    <h1>Más web.<br /><span>Menos ruido.</span></h1>
    <p class="subtitle">Un navegador pensado para tu pantalla.</p>
    <section class="favorites"><h2>Favoritos</h2><div class="site-grid">{#each sites as site}<button class="site" onclick={() => navigate(site.url)}><span class="site-tile" style:background={site.color}>{site.letter}</span><span>{site.name}</span></button>{/each}<button class="site" disabled={nativeBusy} onclick={validateNative}><span class="site-tile" style:background={'#6d648c'}>✓</span><span>{nativeBusy ? 'Validando…' : 'Motor local'}</span></button></div>
      {#if favorites.length}<div class="saved">{#each favorites as item}<button onclick={() => navigate(item.url)}>{item.name}</button>{/each}</div>{/if}
    </section>
    <section class="privacy"><div class="privacy-mark">◈</div><div><h2>Privacidad, a la vista.</h2><p>{connected ? 'Motor de Brave conectado desde tu Mac.' : 'Laboratorio de protección listo para conectar.'}</p><span>{message}</span></div><div class="counter"><strong>{blocked}</strong><span>solicitudes bloqueadas</span></div></section>
    <footer><span class:online={connected} class="connection"></span>{connected ? 'Conectado al laboratorio' : 'Sin conexión al motor'}<span class="footer-right">Prototipo experimental · No introduzcas contraseñas todavía</span></footer>
    {/if}
  </main>
</div>
<NavigationFeedback {loading} error={navigationError} target={navigationTarget} onretry={() => navigate(navigationTarget || address)} onhome={goHome} />
<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#263441;background:#e8eef5} :global(button),:global(input){font:inherit} :global(button){cursor:pointer} :global(button:focus-visible),:global(input:focus-visible){outline:4px solid #367fdb;outline-offset:4px} .browser{min-height:100vh;background:radial-gradient(ellipse at 80% 90%,#afc7dc88,transparent 60%),radial-gradient(ellipse at 10% 20%,#f5efe5,transparent 55%),#e8eef5}.chrome{background:#e6e7eadd;border-bottom:1px solid #c2c9d0;box-shadow:0 4px 18px #3b4b5c12}.toolbar{display:flex;align-items:center;justify-content:space-between;padding:22px 32px;gap:28px}.navigation{display:flex;align-items:center;gap:20px}.navigation button,form button{border:0;background:transparent;color:#52606c;font-size:32px;min-width:42px;height:42px;border-radius:8px}.navigation .shield{font-size:19px;background:#d8e5df;color:#3e675c;padding:0 20px}form{display:flex;align-items:center;width:860px;height:50px;border-radius:12px;background:#fbfcfdcc;box-shadow:0 1px 4px #0001;padding:0 15px;gap:12px}input{border:0;background:transparent;flex:1;min-width:0;color:#354452;font-size:21px;text-align:center;outline:none}.secure{color:#6c8179;font-size:22px}.tabstrip{display:flex;align-items:center;height:48px;padding:0 36px;gap:25px}.tab{height:48px;background:#f8fafcaa;border-radius:10px 10px 0 0;display:flex;align-items:center;padding:0 20px;gap:14px;width:390px;font-size:18px}.tab-dot{width:10px;height:10px;background:#72a599;border-radius:50%}.tab-close{margin-left:auto;color:#96a0a9}.tab-note{margin-left:auto;font-size:17px;color:#7b8791}main{max-width:1450px;margin:auto;padding:68px 45px 26px}.eyebrow{font-size:16px;letter-spacing:4px;color:#798b99}h1{font-size:82px;line-height:1.06;letter-spacing:-4px;margin:22px 0 18px;font-weight:600}h1 span{color:#5a7f99}.subtitle{font-size:24px;color:#6c7f8e;margin:0}h2{font-size:24px;font-weight:600;margin:0 0 20px}.favorites{margin-top:45px}.site-grid{display:flex;gap:45px}.site{border:0;background:transparent;display:flex;flex-direction:column;align-items:center;gap:15px;color:#4b5c69;font-size:19px;min-width:125px}.site-tile{display:grid;place-items:center;width:85px;height:85px;border-radius:22px;color:#fff;font-size:40px;font-weight:600;box-shadow:0 8px 18px #51677a20}.privacy{margin-top:45px;padding:28px 34px;background:#f9fbfd99;border:1px solid #fff9;border-radius:20px;display:flex;align-items:center;gap:25px}.privacy-mark{font-size:48px;color:#5c887b}.privacy h2{margin:0 0 8px;font-size:23px}.privacy p{margin:0 0 8px;font-size:19px;color:#637889}.privacy div>span{font-size:16px;color:#7a8995}.counter{margin-left:auto;display:flex;flex-direction:column;align-items:center;min-width:220px}.counter strong{font-size:48px;color:#4e796d}.saved{display:flex;gap:10px;margin-top:16px}.saved button{border:0;border-radius:8px;background:#fff9;padding:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis}footer{display:flex;align-items:center;margin-top:30px;gap:9px;font-size:16px;color:#7d8b96}.connection{width:8px;height:8px;border-radius:50%;background:#b49b75}.connection.online{background:#629b83}.footer-right{margin-left:auto}
  main{animation:home-enter .32s ease-out}.site-tile{transition:transform .18s ease,box-shadow .18s ease}.site:hover .site-tile,.site:focus-visible .site-tile{transform:translateY(-4px);box-shadow:0 12px 26px #51677a30}.site:active .site-tile{transform:scale(.97)}.navigation button,form button,.saved button{transition:background .15s ease,transform .15s ease}.navigation button:hover,form button:hover{background:#d8e2eb}.navigation button:active,form button:active,.saved button:active{transform:scale(.96)}form:focus-within{box-shadow:0 0 0 3px #8fb0ce55}.go{font-size:20px!important} .connection{transition:background .3s}@keyframes home-enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){main{animation:none}.site-tile,.navigation button,form button,.saved button,.connection{transition:none}}
  .navigation .settings-button{font-size:18px;padding:0 14px;background:#f7fafc99}.settings{animation:home-enter .25s ease-out}.settings h1{font-size:54px;letter-spacing:-2px;margin:25px 0 38px}.settings h2{margin-bottom:12px}.settings .subtitle{font-size:22px}.back-settings{border:0;border-radius:10px;background:#fff9;padding:12px 18px;font-size:19px;color:#526d86;margin-bottom:32px}.engine-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:35px;max-width:1150px}.engine-card{display:flex;align-items:center;gap:22px;text-align:left;padding:28px;border:2px solid #d9e2eb;border-radius:18px;background:#ffffffa8;min-height:125px;transition:border-color .18s,background .18s,transform .18s}.engine-card.selected{border-color:#6e98bc;background:#f6fbff}.engine-card:hover{transform:translateY(-2px);background:#fff}.engine-card:disabled{opacity:.7;cursor:wait}.engine-initial{display:grid;place-items:center;width:58px;height:58px;border-radius:15px;background:#dce6f1;color:#526d9b;font-size:32px;font-weight:600}.engine-initial.google{background:#e7eefc;color:#4285f4}.engine-label{display:flex;flex-direction:column;gap:9px}.engine-label strong{font-size:24px;font-weight:500;color:#334d65}.engine-label>span{font-size:17px;color:#7a8b9d}.radio-dot{margin-left:auto;width:23px;height:23px;border:2px solid #b9c9d8;border-radius:50%}.selected .radio-dot{border:6px solid #6b98bd;background:#fff}.settings-notice{font-size:21px;color:#496e83;min-height:28px;margin-top:32px}.settings-note{font-size:17px;color:#81909e}@media(prefers-reduced-motion:reduce){.settings{animation:none}.engine-card{transition:none}}
</style>
