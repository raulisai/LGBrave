// WAM may expose packaged pages as file://com.lgapp.holy-webos/… instead of file:///….
export function homeAddressMatches(href, home) {
  try {
    const page = new URL(href), own = new URL(home);
    if (page.protocol === 'file:' && own.protocol === 'file:') return page.pathname === own.pathname;
    return page.protocol === own.protocol && page.origin === own.origin && page.pathname === own.pathname;
  } catch { return false; }
}
