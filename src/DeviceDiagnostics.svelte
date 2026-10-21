<script>
  import { onMount } from 'svelte';

  let selected = $state(0);
  let presses = $state(0);
  let lastKey = $state('Esperando el control remoto');
  let details = $state({});
  let showPattern = $state(false);
  const actions = ['Probar OK', 'Patrón de color', 'Actualizar datos'];

  function refresh() {
    let canvas = document.createElement('canvas');
    let gl = canvas.getContext('webgl');
    details = {
      'Área de la app': `${window.innerWidth} × ${window.innerHeight}`,
      'Pantalla reportada': `${screen.width} × ${screen.height}`,
      'Escala de píxel': String(window.devicePixelRatio),
      'Idioma': navigator.language,
      'WebGL': gl ? 'Disponible' : 'No disponible',
      'Motor web': navigator.userAgent
    };
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  function activate(index) {
    if (index === 0) presses += 1;
    if (index === 1) showPattern = !showPattern;
    if (index === 2) refresh();
  }

  function handleKey(event) {
    lastKey = `${event.key || 'Tecla'} · código ${event.keyCode}`;
    if (showPattern && event.keyCode === 13) {
      event.preventDefault();
      showPattern = false;
      return;
    }
    if ([37, 38, 39, 40, 13].includes(event.keyCode)) {
      event.preventDefault();
      if (event.keyCode === 37 || event.keyCode === 38) selected = (selected + 2) % 3;
      if (event.keyCode === 39 || event.keyCode === 40) selected = (selected + 1) % 3;
      if (event.keyCode === 13) activate(selected);
    }
    if (event.keyCode === 461 && showPattern) {
      event.preventDefault();
      showPattern = false;
    }
  }

  onMount(refresh);
</script>

<svelte:window onkeydown={handleKey} />

<main>
  <header><span class="badge">LG LAB / 001</span><span>Svelte · webOS TV</span></header>
  <h1>Tu pantalla.<br /><span>Un nuevo comienzo.</span></h1>
  <p class="intro">Prueba de aplicaciones con Developer Mode</p>
  <section class="layout">
    <div>
      <h2>Explora con tu control</h2>
      <p>Usa las flechas y OK. Atrás cierra el patrón de color.</p>
      <div class="actions">
        {#each actions as action, index}
          <button class:chosen={selected === index} onfocus={() => selected = index} onclick={() => activate(index)}>{action}</button>
        {/each}
      </div>
      <div class="readout"><strong>{presses}</strong><span>pulsaciones de OK</span></div>
      <p class="key">{lastKey}</p>
    </div>
    <aside>
      <h2>Datos de esta ejecución</h2>
      {#each Object.entries(details) as [label, value]}
        <div class="datum"><span>{label}</span><b>{value}</b></div>
      {/each}
    </aside>
  </section>
  <footer>LG Lab 0.1.0 · Interfaz de prueba a 1920 × 1080</footer>
</main>
{#if showPattern}
  <div class="pattern"><div class="colors"></div><p>Patrón de color · OK o Atrás para volver</p></div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #101a22; color: #edf6f4; font-family: Arial, sans-serif; }
  main { padding: 4vh 5vw; min-height: 100vh; }
  header { display: flex; justify-content: space-between; align-items: center; color: #9eb3bb; font-size: 1.3vw; }
  .badge { border: 1px solid #47726c; color: #a8f0d0; padding: .7vw 1vw; letter-spacing: .2em; }
  h1 { margin: 3vh 0 1vh; font-size: 4.5vw; line-height: 1.04; letter-spacing: -.04em; }
  h1 span { color: #a8f0d0; }
  .intro { font-size: 1.4vw; color: #a4b9c1; }
  .layout { display: grid; grid-template-columns: 1.1fr 1fr; gap: 4vw; margin-top: 3vh; }
  h2 { font-size: 1.6vw; margin: 0 0 1.5vh; }
  p { font-size: 1.2vw; color: #b0c2c8; }
  .actions { display: flex; gap: 1vw; margin-top: 3vh; }
  button { border: 3px solid #41616b; background: #203540; color: #edf6f4; padding: 1.1vw; font-size: 1.1vw; border-radius: 8px; }
  button.chosen, button:focus-visible { outline: none; border-color: #a8f0d0; background: #a8f0d0; color: #102820; }
  .readout { display: flex; align-items: baseline; gap: 1vw; margin-top: 2vh; }
  .readout strong { font-size: 5vw; color: #a8f0d0; }
  .readout span { font-size: 1.1vw; }
  aside { background: #1c2c36; border-radius: 12px; padding: 1.8vw; }
  .datum { display: grid; grid-template-columns: 1fr 1.6fr; gap: 1vw; padding: .65vw 0; border-bottom: 1px solid #344750; font-size: 1.05vw; }
  .datum span { color: #a4b9c1; }
  .datum b { font-weight: 400; overflow-wrap: anywhere; }
  footer { margin-top: 3vh; font-size: 1vw; color: #8fa7af; }
  .pattern { position: fixed; inset: 0; background: #111; display: flex; flex-direction: column; }
  .colors { flex: 1; background: linear-gradient(to right, #fff 0% 14.28%, #ff0 14.28% 28.56%, #0ff 28.56% 42.84%, #0f0 42.84% 57.12%, #f0f 57.12% 71.4%, #f00 71.4% 85.68%, #00f 85.68%); }
  .pattern p { text-align: center; padding: 1vh; color: white; }
</style>
