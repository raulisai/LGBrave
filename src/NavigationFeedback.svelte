<script>
  import Icon from './Icon.svelte';
  let { error = '', target = '', onretry, onhome } = $props();
  const autofocus = node => { requestAnimationFrame(() => node.focus()); };
</script>

{#if error}
  <div class="feedback" role="alert">
    <div class="sheet">
      <div class="mark"><Icon name="alert" size={46} /></div>
      <h2>No se puede abrir la página</h2>
      <p>{error}</p>
      {#if target}<div class="target">{target}</div>{/if}
      <div class="actions">
        <button class="primary" use:autofocus onclick={onretry}>Reintentar</button>
        <button onclick={onhome}>Ir a Inicio</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .feedback{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:color-mix(in srgb,var(--bg) 97%,transparent);animation:fade .25s ease-out}
  .sheet{max-width:900px;padding:0 48px;text-align:center;animation:rise .5s var(--ease)}
  .mark{width:92px;height:92px;margin:0 auto 30px;border-radius:26px;display:grid;place-items:center;background:var(--surface);color:var(--orange);box-shadow:var(--shadow)}
  h2{font-size:42px;font-weight:600;letter-spacing:-.6px;margin:0 0 14px}
  p{font-size:23px;line-height:1.45;color:var(--secondary);margin:0}
  .target{margin:18px auto 0;max-width:760px;font-size:18px;color:var(--tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .actions{display:flex;justify-content:center;gap:18px;margin-top:40px}
  .actions button{height:60px;padding:0 32px;border:0;border-radius:16px;background:var(--fill);color:var(--text);font-size:21px;font-weight:600;transition:transform .4s var(--spring),box-shadow .25s,background .2s}
  .actions .primary{background:var(--blue);color:#fff}
  .actions button:focus,.actions button:hover{outline:none;transform:scale(1.07);box-shadow:0 0 0 3px var(--bg),0 0 0 6px var(--blue),0 12px 26px rgba(0,0,0,.16)}
  .actions button:active{transform:scale(.95)}
  @keyframes fade{from{opacity:0}}
  @keyframes rise{from{opacity:0;transform:translateY(18px) scale(.98)}}
</style>
