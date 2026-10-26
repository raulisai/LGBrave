import { redact } from './diagnostics.mjs';
// Black box for «the app closed on its own»: the last events before the TV drops the
// connection. Hosts and paths only (never query strings: player URLs carry tokens).
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const where = value => {
  try { const url = new URL(String(value)); return url.protocol === 'about:' ? String(value) : url.origin + url.pathname.slice(0, 60); } catch { return String(value ?? '').slice(0, 80); }
};

export class FlightRecorder {
  constructor(file = '.local/logs/flight.log') { this.file = file; this.lastHeap = 0; }
  write(kind, detail = '') {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      try { if (statSync(this.file).size > 1e6) renameSync(this.file, this.file + '.1'); } catch { /* First write. */ }
      appendFileSync(this.file, `${new Date().toISOString().slice(11, 23)} ${kind} ${redact(detail)}\n`);
    } catch { /* Diagnostics must never break browsing. */ }
  }
  note(method, params = {}, sessionId) {
    const frame = sessionId ? 'sub ' : '';
    if (method === 'Inspector.targetCrashed' || method === 'Target.targetCrashed') this.write('CRASH', method);
    else if (method === 'Inspector.detached') this.write('DETACHED', params.reason);
    else if (method === 'Page.windowOpen') this.write('windowOpen', where(params.url));
    else if (method === 'Page.frameRequestedNavigation') this.write(frame + 'navRequest', `${params.reason} ${where(params.url)}`);
    else if (method === 'Page.frameNavigated') this.write(frame + 'navigated', where(params.frame?.url));
    else if (method === 'Page.javascriptDialogOpening') this.write('dialog', params.type);
    else if (method === 'Page.fileChooserOpened') this.write('fileChooser');
    else if (method === 'Target.attachedToTarget') this.write('frameAttached', `${params.targetInfo?.type} ${where(params.targetInfo?.url)}`);
    else if (method === 'Target.detachedFromTarget') this.write('frameDetached');
    else if (method === 'Network.requestWillBeSent' && ['Document', 'Media'].includes(params.type)) this.write(frame + 'request ' + params.type, where(params.request?.url));
    else if (method === 'Network.loadingFailed' && ['Document', 'Media'].includes(params.type)) this.write('loadFailed ' + params.type, params.errorText);
    else if (method === 'Runtime.exceptionThrown') this.write('exception', String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text).slice(0, 120));
    else if (method === 'Log.entryAdded' && params.entry?.level === 'error') this.write('logError', `${String(params.entry.text).slice(0, 100)} ${where(params.entry.url)}`);
  }
  async heap(cdp) {
    try {
      const usage = await cdp.call('Runtime.getHeapUsage');
      const used = Math.round(usage.usedSize / 1048576);
      if (Math.abs(used - this.lastHeap) >= 20) { this.lastHeap = used; this.write('heap', `${used} MB de ${Math.round(usage.totalSize / 1048576)}`); }
    } catch { /* Not supported on this target. */ }
  }
}
