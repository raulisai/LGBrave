<script>
  let { loading = false, error = '', target = '', onretry, onhome } = $props();
</script>

{#if loading || error}
  <div class="feedback" class:failed={!!error} role="status" aria-live="polite" aria-busy={loading}>
    <div class="sheet">
      {#if loading}<span class="spinner" aria-hidden="true"></span>{:else}<span class="error-mark" aria-hidden="true">!</span>{/if}
      <h2>{error ? 'No pudimos abrir esta página' : 'Abriendo tu página'}</h2>
      <p>{error || 'Estamos preparando el contenido para ti.'}</p>
      {#if target}<div class="target">{target}</div>{/if}
      {#if loading}<div class="track"><span></span></div>{/if}
      <div class="actions">
        {#if error}<button onclick={onretry}>Reintentar</button><button onclick={onhome}>Volver al inicio</button>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .feedback{position:fixed;inset:143px 0 0;z-index:1000;display:grid;place-items:center;background:#edf2f8f7;animation:appear .2s ease-out}.sheet{text-align:center;max-width:900px;padding:55px 65px;border-radius:28px;background:#ffffffc9;box-shadow:0 15px 60px #536b8112}.sheet h2{font-size:32px;font-weight:500;margin:28px 0 14px;color:#334b60}.sheet p{font-size:22px;color:#6a7d8e}.target{font-size:17px;color:#77899b;max-width:730px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:20px auto}.spinner{display:inline-block;width:44px;height:44px;border:3px solid #dbe5ef;border-top-color:#678fb0;border-radius:50%;animation:spin .85s linear infinite}.error-mark{display:inline-grid;place-items:center;width:50px;height:50px;border:2px solid #c58b72;color:#a56850;border-radius:50%;font:32px Arial}.track{height:3px;max-width:420px;margin:30px auto;overflow:hidden;background:#e3eaf2;border-radius:3px}.track span{display:block;width:40%;height:100%;background:#7199ba;animation:travel 1.4s ease-in-out infinite}.actions{display:flex;justify-content:center;gap:16px;margin-top:28px}.actions button{padding:13px 22px;border:1px solid #c7d5e2;border-radius:12px;background:#f8fbff;color:#486581;font-size:20px;transition:background .15s,transform .15s}.actions button:active{transform:scale(.97)}@keyframes appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes travel{from{transform:translateX(-120%)}to{transform:translateX(370%)}}@media(prefers-reduced-motion:reduce){.feedback,.spinner,.track span{animation:none}.actions button{transition:none}}
</style>
