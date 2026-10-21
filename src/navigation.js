// Shared by the packaged app, the isolated toolbar and the Mac bridge.
// Keep this function self-contained: it is also injected into the TV.
export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google' },
  { id: 'bing', name: 'Bing' },
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'brave', name: 'Brave Search' }
];

export function resolveNavigation(value, searchEngine = 'google') {
  const input = String(value ?? '').trim();
  if (!input) throw new Error('Escribe una dirección o algo que quieras buscar.');
  const explicit = /^https?:\/\//i.test(input);
  const host = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[^\s/:?#]+\.[^\s/:?#]+)(?::\d+)?(?:[/?#][^\s]*)?$/u.test(input);
  if (!explicit && !host) {
    if (/^[a-z][a-z\d+.-]*:/i.test(input)) throw new Error('Usa una dirección http o https.');
    const providers = {
      google: 'https://www.google.com/search?q=',
      bing: 'https://www.bing.com/search?q=',
      duckduckgo: 'https://html.duckduckgo.com/html/?q=',
      brave: 'https://search.brave.com/search?q='
    };
    return (providers[searchEngine] || providers.google) + encodeURIComponent(input);
  }
  let url;
  try { url = new URL(explicit ? input : 'https://' + input); }
  catch { throw new Error('La dirección no es válida. Revisa cómo está escrita.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Usa una dirección http o https sin contraseñas en la URL.');
  }
  return url.href;
}
