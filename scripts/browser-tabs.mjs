// Session-only tabs: one live webOS page, independent histories for suspended tabs.
// No URLs are written to disk (player URLs can contain private tokens).
export class BrowserTabs {
  constructor(home, limit = 12) {
    this.home = home;
    this.limit = limit;
    this.serial = 0;
    this.items = [];
  }
  get active() { return this.items.find(tab => tab.id === this.activeId); }
  label(url) {
    if (url === this.home || url.startsWith('file:///media/developer/apps/usr/palm/applications/com.lgapp.lab/')) return 'Inicio';
    try { return new URL(url).hostname.replace(/^www\./, '') || 'Página'; } catch { return 'Página'; }
  }
  create(url = this.home) {
    if (this.items.length >= this.limit) throw Error(`Puedes abrir hasta ${this.limit} pestañas.`);
    const tab = { id: String(++this.serial), title: this.label(url), entries: [{ url, scroll: 0 }], index: 0 };
    this.items.push(tab);
    this.activeId = tab.id;
    return tab;
  }
  select(id) {
    const tab = this.items.find(item => item.id === id);
    if (!tab) throw Error('Esta pestaña ya está cerrada.');
    this.activeId = tab.id;
    return tab;
  }
  close(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index < 0) return false;
    const wasActive = this.activeId === id;
    this.items.splice(index, 1);
    if (!this.items.length) this.create();
    else if (wasActive) this.activeId = this.items[Math.min(index, this.items.length - 1)].id;
    return wasActive;
  }
  commit(url, title, replace = false) {
    const tab = this.active || this.create(url);
    const entry = tab.entries[tab.index];
    if (entry.url !== url) {
      if (replace) tab.entries[tab.index] = { url, scroll: entry.scroll };
      else {
        tab.entries.splice(tab.index + 1);
        tab.entries.push({ url, scroll: 0 });
        if (tab.entries.length > 100) tab.entries.shift();
        tab.index = tab.entries.length - 1;
      }
    }
    tab.title = this.label(url) === 'Inicio' ? 'Inicio' : (title?.trim().slice(0, 100) || this.label(url));
  }
  remember(scroll, title, media) {
    if (!this.active) return;
    this.active.entries[this.active.index].scroll = Math.max(0, Number(scroll) || 0);
    // Playback position (seconds) lets a suspended tab resume where the video was.
    const entry = this.active.entries[this.active.index];
    if (media && Number.isFinite(media.t) && media.t > 3) entry.media = { t: Math.floor(media.t), playing: !!media.playing };
    else delete entry.media;
    if (title?.trim()) this.active.title = this.label(this.current.url) === 'Inicio' ? 'Inicio' : title.trim().slice(0, 100);
  }
  get current() { return this.active?.entries[this.active.index]; }
  move(step) {
    const tab = this.active;
    const next = tab.index + step;
    if (next < 0 || next >= tab.entries.length) return null;
    tab.index = next;
    tab.title = this.label(this.current.url);
    return this.current;
  }
  snapshot() {
    return { activeTabId: this.activeId, tabs: this.items.map(tab => ({ id: tab.id, title: tab.title, url: tab.entries[tab.index].url })) };
  }
}
