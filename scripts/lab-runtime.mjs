import {connectTV, findLumaTarget} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
import {openInspectorTunnel} from './inspector-tunnel.mjs';

const bounded = async (operation, ms) => {
  let timer;
  try { return await Promise.race([operation, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
};

export class LabRuntime {
  constructor({openTunnel = openInspectorTunnel, connect = connectTV,
    makeBridge = (cdp, options) => new BrowserBridge(cdp, options),
    targets = async endpoint => {
      const response = await fetch(`${endpoint}/json`, {signal: AbortSignal.timeout(3000)});
      if (!response.ok) throw Error('No se pudo consultar el inspector de la TV.');
      return response.json();
    }, log = console.log} = {}) {
    Object.assign(this, {openTunnel, connect, makeBridge, targets, log});
    this.stopping = false; this.state = null;
  }
  setState(state, message) {
    if (state === this.state) return;
    this.state = state; this.log(message);
  }
  async detach() {
    const bridge = this.bridge, cdp = this.cdp;
    if (bridge?.tabs) {
      this.sessionTabs = bridge.tabs;
      this.sessionTargetId = cdp?.target.id;
    }
    this.bridge = null; this.cdp = null;
    if (bridge) await bounded(bridge.stop().catch(() => {}), 1500);
    cdp?.close();
  }
  async disconnect() {
    await this.detach();
    this.tunnel?.close(); this.tunnel = null;
  }
  async step() {
    if (this.stopping) return;
    try {
      if (!this.tunnel) this.tunnel = await this.openTunnel();
      if (this.stopping) { await this.disconnect(); return; }
      const target = findLumaTarget(await this.targets(this.tunnel.endpoint));
      if (this.stopping) return;
      if (!target) {
        await this.detach();
        this.sessionTabs = null; this.sessionTargetId = null;
        this.setState('waiting', 'En espera: abre Holy con el control de la TV. No se abrirá automáticamente.');
        return;
      }
      if (this.connectionClosed || this.cdp?.target.id !== target.id) {
        await this.detach();
        if (this.stopping) return;
        this.cdp = await this.connect(this.tunnel.endpoint);
        if (this.stopping) { await this.detach(); return; }
        if (this.cdp.target.id !== target.id) { await this.detach(); return; }
        this.connectionClosed = false;
        const connection = this.cdp;
        connection.closed?.then(() => { if (this.cdp === connection) this.connectionClosed = true; });
        this.bridge = this.makeBridge(this.cdp, { tabs: this.sessionTargetId === target.id ? this.sessionTabs : undefined });
        await this.bridge.start();
        if (this.stopping) { await this.detach(); return; }
        this.setState('connected', `Holy conectado de forma pasiva: ${this.tunnel.endpoint}`);
      } else {
        await this.bridge.refreshFilters?.();
        await this.bridge.status();
      }
    } catch {
      await this.disconnect();
      if (!this.stopping) this.setState('offline', 'Sin conexión con la TV. Se esperará sin abrir ninguna aplicación.');
    }
  }
  async close() { this.stopping = true; await this.disconnect(); }
}
