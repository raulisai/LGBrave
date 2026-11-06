import {connectTV, findLumaTarget} from './cdp.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
import {openInspectorTunnel} from './inspector-tunnel.mjs';

const bounded = async (operation, ms) => {
  let timer;
  try { return await Promise.race([operation, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
};
// The TV's inspector only listens while a developer app is open: with Holy and Luma closed (another
// app or input in front) the forwarded socket is reset. That is a wait, not a lost connection.
const INSPECTOR_CLOSED = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);
export const inspectorClosed = error => error?.name === 'TypeError' && /fetch failed/i.test(error.message) && INSPECTOR_CLOSED.has(error.cause?.code);
// A short, stable reason for the logs: the user-facing message alone («fetch failed») hides it.
export const failureCode = error => String(error?.cause?.code || error?.code || error?.name || '').slice(0, 40);
const stopBridge = bridge => bridge ? bounded(Promise.resolve().then(() => bridge.stop()).catch(() => {}), 1500) : Promise.resolve();

export class LabRuntime {
  constructor({openTunnel = openInspectorTunnel, connect = connectTV,
    makeBridge = (cdp, options) => new BrowserBridge(cdp, options),
    targets = async endpoint => {
      const response = await fetch(`${endpoint}/json`, {signal: AbortSignal.timeout(3000)});
      if (!response.ok) throw Error('No se pudo consultar el inspector de la TV.');
      return response.json();
    }, selectTarget = findLumaTarget, log = console.log, handoffPause = 120000, now = Date.now} = {}) {
    Object.assign(this, {openTunnel, connect, makeBridge, targets, selectTarget, log, handoffPause, now});
    this.stopping = false; this.state = null; this.generation = 0; this.pausedUntil = 0;
  }
  // «Usar esta computadora» here: forget a pause after yielding the TV and try at once.
  wake() { this.pausedUntil = 0; }
  setState(state, message) {
    if (state === this.state) return;
    this.state = state; this.log(message);
  }
  async detach() {
    const bridge = this.bridge, cdp = this.cdp;
    if (bridge?.lastPlaybackIncident) this.lastPlaybackIncident = bridge.lastPlaybackIncident;
    if (bridge?.tabs) {
      this.sessionTabs = bridge.tabs;
      this.sessionTargetId = cdp?.target.id;
    }
    this.bridge = null; this.cdp = null;
    try { await stopBridge(bridge); } finally { cdp?.close(); }
  }
  disconnect() {
    // Invalidate before awaiting cleanup: a late /json, handshake or start must
    // never attach through a tunnel that has already lost its reservation.
    this.generation++;
    const tunnel = this.tunnel; this.tunnel = null;
    const previous = this.disconnecting;
    const cleanup = this.detach().finally(() => tunnel?.close());
    const operation = Promise.all([previous, cleanup]).then(() => {});
    this.disconnecting = operation;
    return operation.finally(() => { if (this.disconnecting === operation) this.disconnecting = null; });
  }
  step() {
    if (this.stopping) return Promise.resolve();
    // Timers and manual requests can overlap; only one attachment is allowed.
    if (this.stepping) return this.stepping;
    const operation = this.advance();
    this.stepping = operation;
    return operation.finally(() => { if (this.stepping === operation) this.stepping = null; });
  }
  async advance() {
    if (this.disconnecting) await this.disconnecting;
    if (this.stopping) return;
    const generation = this.generation;
    const current = () => !this.stopping && generation === this.generation;
    try {
      // After yielding the TV to another computer, give it time to take it.
      if (!this.tunnel && this.now() < this.pausedUntil) return;
      if (!this.tunnel) {
        const tunnel = await this.openTunnel();
        if (!current()) { await tunnel.close(); return; }
        this.tunnel = tunnel;
        tunnel.closed?.then(reason => {
          if (this.tunnel !== tunnel) return;
          if (reason?.type === 'handoff') {
            this.pausedUntil = this.now() + this.handoffPause;
            this.lastCause = 'handoff'; this.lastError = `${reason.by || 'Otra computadora'} pidió la TV: se la cedió esta computadora, que espera ${Math.round(this.handoffPause / 60000)} min antes de volver a intentarlo.`;
            this.setState('standby', this.lastError);
          } else {
            this.lastCause = reason?.type || 'lost'; this.lastError = 'Se perdió la conexión con la TV; se reintentará automáticamente.';
            this.setState('offline', this.lastError);
          }
          this.disconnect().catch(() => {});
        });
      }
      if (!current()) return;
      const tunnel = this.tunnel;
      tunnel.assertActive?.();
      let targets;
      try { targets = await this.targets(tunnel.endpoint); }
      catch (error) {
        if (!current() || !inspectorClosed(error)) throw error;
        // Keep the SSH session and its reservation: rebuilding them every few seconds only
        // churned the TV and let another computer slip in between attempts.
        tunnel.assertActive?.();
        await this.detach();
        if (!current()) return;
        this.lastError = null; this.lastCause = 'inspector-closed';
        this.setState('waiting', 'En espera: la TV responde, pero Holy o Luma no está abierto. No se abrirá automáticamente.');
        return;
      }
      const target = this.selectTarget(targets);
      if (!current()) return;
      tunnel.assertActive?.();
      if (!target) {
        await this.detach();
        if (!current()) return;
        this.sessionTabs = null; this.sessionTargetId = null;
        this.lastError = null; this.lastCause = 'app-not-open';
        this.setState('waiting', 'En espera: abre Holy o Luma con el control de la TV. No se abrirá automáticamente.');
        return;
      }
      if (this.connectionClosed || this.cdp?.target.id !== target.id) {
        await this.detach();
        if (!current()) return;
        const connection = await this.connect(tunnel.endpoint, target.description || (target.url?.includes('/com.lgapp.holy/') ? 'com.lgapp.holy' : 'com.lgapp.lab'), {guard:tunnel.assertActive});
        if (!current()) { connection.close(); return; }
        this.cdp = connection;
        if (connection.target.id !== target.id) { await this.detach(); return; }
        this.connectionClosed = false;
        connection.closed?.then(() => { if (this.cdp === connection) this.connectionClosed = true; });
        const bridge = this.makeBridge(connection, {target, tabs:this.sessionTargetId === target.id ? this.sessionTabs : undefined});
        this.bridge = bridge;
        await bridge.start();
        if (!current()) { await stopBridge(bridge); connection.close(); return; }
        tunnel.assertActive?.();
        if (this.connectionClosed) throw Error('La conexión con la TV se cerró durante el inicio.');
        this.lastError = null; this.holder = ''; this.lastCause = '';
        this.setState('connected', `Conexión pasiva: ${target.description || 'Luma'} · ${tunnel.endpoint}`);
      } else {
        await this.bridge.refreshFilters?.();
        if (!current()) return;
        await this.bridge.status();
      }
    } catch (error) {
      if (!current()) return;
      this.lastError = String(error?.message || error).slice(0, 240);
      this.lastCause = error?.code === 'TV_BUSY' ? 'tv-' + (error.reason || 'busy') : failureCode(error);
      this.holder = error?.holder || '';
      await this.disconnect();
      if (!this.stopping) this.setState(error.code === 'TV_BUSY' ? 'standby' : 'offline', this.lastError);
    }
  }
  async close() { this.stopping = true; await this.disconnect(); }
}
