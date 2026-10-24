// SVG paths on a 24 × 24 grid, drawn with stroke="currentColor".
// Shared by the home (Svelte) and the page toolbar (injected into the TV).
export const ICONS = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  forward: '<path d="M9 4.5 16.5 12 9 19.5"/>',
  reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.2v4.6h-4.6"/>',
  stop: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  home: '<path d="M3.8 11 12 4l8.2 7"/><path d="M6.2 9.4V20h4.3v-5.6h3V20h4.3V9.4"/>',
  shield: '<path d="M12 3.2 19 6v5.6c0 4.3-2.9 8-7 9.3-4.1-1.3-7-5-7-9.3V6l7-2.8Z"/>',
  shieldCheck: '<path d="M12 3.2 19 6v5.6c0 4.3-2.9 8-7 9.3-4.1-1.3-7-5-7-9.3V6l7-2.8Z"/><path d="m8.8 12.2 2.2 2.2 4.2-4.4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  sparkles: '<path d="M10 3.5 11.6 8 16 9.6 11.6 11.2 10 15.6 8.4 11.2 4 9.6 8.4 8 10 3.5Z"/><path d="m17.5 13.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6Z"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.5 4.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevron: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  minus: '<path d="M6.5 12h11"/>',
  tv: '<rect x="5" y="3.5" width="14" height="17" rx="2.6"/><path d="M10.5 17.8h3"/>',
  pencil: '<path d="m4.5 19.5.9-4L16.6 4.3a1.8 1.8 0 0 1 2.5 0l.6.6a1.8 1.8 0 0 1 0 2.5L8.5 18.6l-4 .9Z"/><path d="m14.5 6.4 3.1 3.1"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  play: '<path d="M9 7.2v9.6c0 .6.6.9 1.1.6l7.4-4.8a.7.7 0 0 0 0-1.2l-7.4-4.8c-.5-.3-1.1 0-1.1.6Z" fill="currentColor" stroke="none"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2h.01"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5v5.3L5.6 17.4A2.1 2.1 0 0 0 7.4 20.5h9.2a2.1 2.1 0 0 0 1.8-3.1l-4.9-8.6V3.5"/><path d="M7.6 14.5h8.8"/>'
};

export function svg(name, size = 24, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
