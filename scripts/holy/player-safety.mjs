// Main-world protection for third-party pages inside Holy. No media, navigation,
// timer, cookie or user input is changed; Back and the TV's native exit still work.
export function holyPlayerSafety(homes = []) {
  if (!/^https?:$/.test(location.protocol) || location.hostname === 'challenges.cloudflare.com' ||
      homes.some(home => {
        if (location.href.startsWith(home)) return true;
        try { const own = new URL(home); return own.port === location.port && own.pathname === location.pathname &&
          /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname); } catch { return false; }
      }) || window.__holyPlayerSafety) return;
  const state = { blockedCloses: 0, blockedPopups: 0 };
  Object.defineProperty(window, '__holyPlayerSafety', { value: state });
  const install = (name, counter) => {
    const blocked = () => {
      state[counter]++;
      if (counter === 'blockedCloses' && document.documentElement) document.documentElement.dataset.holyBlockedCloses = String(state[counter]);
      return null;
    };
    try { Object.defineProperty(window, name, { get: () => blocked, set() {}, configurable: false }); }
    catch { /* Another immutable guard may already own this operation. */ }
  };
  // On webOS a third-party window.close() can terminate the entire app.
  install('close', 'blockedCloses');
  install('open', 'blockedPopups');
}
export const playerSafetySource = homes => '(' + holyPlayerSafety.toString() + ')(' + JSON.stringify(homes) + ');';
