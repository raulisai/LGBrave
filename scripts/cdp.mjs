import WebSocket from 'ws';

export function findLumaTarget(targets, appId = 'com.lgapp.lab') {
  if (!Array.isArray(targets)) return undefined;
  return targets.find(target => target && (target.description ? target.description === appId :
    target.url?.startsWith(`file:///media/developer/apps/usr/palm/applications/${appId}/`)));
}

export async function connectTV(endpoint, appId = 'com.lgapp.lab', {guard = () => {}} = {}) {
  guard();
  const response = await fetch(`${endpoint}/json`, {signal:AbortSignal.timeout(3000)});
  if (!response.ok) throw Error('No se pudo consultar el inspector de la TV.');
  const target = findLumaTarget(await response.json(), appId);
  if (!target) throw Error(`No se encontró la app ${appId} en el inspector.`);
  guard();
  // Some inspectors advertise localhost:9998. Always keep the WebSocket on the
  // actual tunnel (including its random local port), never the advertised host.
  const advertised = new URL(target.webSocketDebuggerUrl);
  const socketUrl = new URL(endpoint);
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  socketUrl.pathname = advertised.pathname; socketUrl.search = advertised.search; socketUrl.hash = '';
  const socket = new WebSocket(socketUrl, {handshakeTimeout:5000});
  let id = 0, ended = false, resolveClosed;
  const pending = new Map(), listeners = new Set();
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const finish = (error = Error('Se cerró la conexión con la TV.')) => {
    if (ended) return;
    ended = true;
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(error); }
    pending.clear(); listeners.clear(); resolveClosed();
  };
  socket.on('error', error => { finish(error); socket.terminate(); });
  socket.on('close', () => finish());
  try {
    await new Promise((resolve, reject) => {
      const opened = () => { cleanup(); resolve(); };
      const failed = error => { cleanup(); reject(error); };
      const closedEarly = () => failed(Error('La conexión con la TV se cerró antes de responder.'));
      const cleanup = () => { socket.off('open', opened); socket.off('error', failed); socket.off('close', closedEarly); };
      socket.once('open', opened); socket.once('error', failed); socket.once('close', closedEarly);
    });
    guard();
    if (ended) throw Error('La conexión con la TV está cerrada.');
  } catch (error) { finish(error); socket.terminate(); throw error; }
  socket.on('message', bytes => {
    let message;
    try {
      message = JSON.parse(bytes.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error();
    } catch {
      finish(Error('El inspector devolvió un mensaje inválido.')); socket.terminate(); return;
    }
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id);
      pending.delete(message.id); clearTimeout(task.timer);
      message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) Promise.resolve().then(() => listener(message)).catch(error => console.error('CDP event:', error?.message || error));
    }
  });
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      try { guard(); } catch (error) { finish(error); socket.terminate(); reject(error); return; }
      if (ended || socket.readyState !== WebSocket.OPEN) { reject(Error('La conexión con la TV está cerrada.')); return; }
      const requestId = ++id;
      const body = JSON.stringify({id:requestId, method, params, ...(sessionId ? {sessionId} : {})});
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timeout ${method}`)); }, 15000);
      pending.set(requestId, {resolve, reject, timer});
      const failed = error => {
        if (!error || !pending.has(requestId)) return;
        pending.delete(requestId); clearTimeout(timer); reject(error);
      };
      try { socket.send(body, failed); } catch (error) { failed(error); }
    });
  }
  async function evaluate(expression, contextId) {
    const result = await call('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true, ...(contextId ? {contextId} : {})});
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  return {
    call, evaluate, target, closed,
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { finish(Error('Conexión cerrada')); socket.terminate(); }
  };
}

export async function waitFor(fn, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error(`No se cumplió la condición${lastError ? ': ' + lastError.message : ''}`);
}
