<script>
  import { ICONS } from './icons.js';
  let { name, size = 26, stroke = 2 } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[name] || ''}</svg>
