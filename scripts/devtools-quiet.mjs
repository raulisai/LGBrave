// Document-start helper for pages that detect an attached debugger.
// Luma controls the TV through the same inspector channel as developer tools. Libraries such as
// «disable-devtool» (used by framextv and many streaming sites) notice that channel when the
// browser serializes their console.log/table/dir arguments (Date.toString called twice, element
// id getters, huge-array timing) and then throw the page to about:blank in a loop (seen on the TV
// 2026-10-23). Nobody reads the console on a TV, so the console methods do nothing in web pages:
// the bait never fires. Errors and exceptions still reach the bridge's black box through
// Runtime.exceptionThrown; Cloudflare's own check frames are never touched.
export function devtoolsQuiet() {
  if (window.__lumaConsoleQuiet || location.hostname === 'challenges.cloudflare.com') return;
  try { Object.defineProperty(window, '__lumaConsoleQuiet', { value: true }); } catch { return; }
  const quiet = () => undefined;
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir', 'dirxml', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'clear', 'count', 'countReset', 'time', 'timeLog', 'timeEnd', 'assert', 'profile', 'profileEnd']) {
    try { Object.defineProperty(console, name, { value: quiet, writable: true, configurable: true }); } catch { /* A frozen console is already quiet enough. */ }
  }
}

export const devtoolsQuietSource = `(${devtoolsQuiet.toString()})();`;
