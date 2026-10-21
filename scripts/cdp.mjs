import WebSocket from 'ws';

export async function connectTV(endpoint) {
  const targets = await (await fetch(`${endpoint}/json`)).json();
  const target = targets.find(t => t.description === 'com.lgapp.lab' || t.url?.includes('/com.lgapp.lab/'));
  if (!target) throw Error('No se encontró la app com.lgapp.lab en el inspector.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  const closed = new Promise(resolve => socket.once('close', resolve));
  socket.on('close', () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Se cerró la conexión con la TV.')); }
    pending.clear();
  });
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.id && pending.has(message.id)) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(task.timer);
      message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) Promise.resolve(listener(message)).catch(error => console.error('CDP event:', error.message));
    }
  });
  function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) { reject(Error('La conexión con la TV está cerrada.')); return; }
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timeout ${method}`)); }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function evaluate(expression, contextId) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  return {
    call, evaluate, target, closed,
    onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Conexión cerrada')); } pending.clear(); socket.terminate(); }
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
