let enginePromise;

export function loadNativeEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const started = performance.now();
    const bytes = await (await fetch(new URL('adblock.wasm', document.baseURI))).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const wasm = instance.exports;
    const encode = new TextEncoder();
    const decode = new TextDecoder();
    function call(value) {
      const input = encode.encode(JSON.stringify(value));
      const pointer = wasm.lab_alloc(input.length);
      try {
        new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
        wasm.lab_run(pointer, input.length);
        const output = JSON.parse(decode.decode(new Uint8Array(wasm.memory.buffer, wasm.lab_output_ptr(), wasm.lab_output_len())));
        if (output.error) throw Error(output.error);
        return output;
      } finally { wasm.lab_free(pointer, input.length); }
    }
    const filters = await (await fetch(new URL('native-filters.txt', document.baseURI))).text();
    call({ op: 'init', filters });
    return { call, initializationMs: Math.round(performance.now() - started), binaryBytes: bytes.byteLength, memoryBytes: () => wasm.memory.buffer.byteLength, filterLines: filters.split('\n').length };
  })().catch(error => { enginePromise = undefined; throw error; });
  return enginePromise;
}

export async function runNativeValidation() {
  const engine = await loadNativeEngine();
  const cases = [
    ['Anuncio Google', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://example.org/', 'script', true],
    ['Rastreador Analytics', 'https://www.google-analytics.com/analytics.js', 'https://example.org/', 'script', true],
    ['Imagen editorial', 'https://example.org/photos/cat.png', 'https://example.org/', 'image', false],
    ['Script editorial', 'https://example.org/app.js', 'https://example.org/', 'script', false],
    ['Excepción', 'http://192.168.1.148:43187/ad-fixture/allowed.js', 'http://192.168.1.148:43187/fixture', 'script', false]
  ].map(([name, url, source, kind, expected]) => {
    const result = engine.call({ op: 'check', url, source, kind });
    return { name, expected, blocked: result.blocked, pass: result.blocked === expected };
  });
  if (cases.some(test => !test.pass)) throw Error('Falló una comprobación del motor WASM.');
  const source = 'http://192.168.1.148:43187/fixture?run=native';
  const frame = document.createElement('iframe');
  frame.id = '__native-fixture';
  frame.title = 'Prueba controlada de filtrado local';
  frame.style.cssText = 'position:fixed;left:5vw;top:180px;width:90vw;height:70vh;z-index:100;background:white;border:3px solid #6699aa;border-radius:14px';
  // Solo fixtures propios. No usar este acceso privilegiado con sitios desconocidos.
  frame.src = source;
  document.body.append(frame);
  try {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      try { if (frame.contentWindow.fixtureReady) break; } catch { /* Cargando. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!frame.contentWindow.fixtureReady) throw Error('La página de prueba no terminó de cargar.');
    await new Promise(resolve => setTimeout(resolve, 400));
    const content = frame.contentWindow;
    const doc = content.document;
    const countAds = () => [...doc.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(node => content.getComputedStyle(node).display !== 'none').length;
    const before = { visibleAds: countAds(), adScripts: content.adScriptExecuted || 0 };
    const cosmetic = engine.call({ op: 'cosmetic', url: source });
    const style = doc.createElement('style');
    style.textContent = cosmetic.hide_selectors.map(selector => `${selector}{display:none!important}`).join('\n');
    doc.head.append(style);
    const requests = [];
    const originalFetch = content.fetch.bind(content);
    content.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url, source).href;
      const decision = engine.call({ op: 'check', url, source, kind: 'xmlhttprequest' });
      requests.push({ url, blocked: decision.blocked });
      return decision.blocked ? Promise.resolve(new content.Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : originalFetch(input, options);
    };
    await content.fetch('/ad-fixture/late-fetch?run=native-after');
    await content.fetch('/content-fixture/late-fetch?run=native-after');
    const after = { visibleAds: countAds(), editorialVisible: content.getComputedStyle(doc.querySelector('#good-content')).display !== 'none' };
    return {
      engine: 'brave/adblock-rust 0.13.3 compilado a WASM; ejecutado en la TV',
      initializationMs: engine.initializationMs, binaryBytes: engine.binaryBytes,
      memoryBytes: engine.memoryBytes(), filterLines: engine.filterLines, cases, before, after, requests,
      limitations: ['Las solicitudes iniciales ya se descargaron antes del evento load.', 'El hook solo se aplicó a fetch después de cargar.', 'No es un interceptor global de red.', 'La prueba solo permite la página controlada del laboratorio.']
    };
  } finally { frame.remove(); }
}

export async function runNativePrefilterValidation() {
  const engine = await loadNativeEngine();
  const source = 'http://192.168.1.148:43187/fixture?run=native-prefilter';
  const decisions = [];
  const check = (value, kind) => {
    const url = new URL(value, source).href;
    const result = engine.call({ op: 'check', url, source, kind });
    decisions.push({ url, kind, blocked: result.blocked });
    return result.blocked;
  };
  const text = await (await fetch(source)).text();
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  for (const [selector, attribute, kind] of [['script[src]', 'src', 'script'], ['link[rel="stylesheet"]', 'href', 'stylesheet'], ['img[src]', 'src', 'image'], ['iframe[src]', 'src', 'subdocument']]) {
    for (const node of parsed.querySelectorAll(selector)) {
      if (check(node.getAttribute(attribute), kind)) node.remove();
      else node.setAttribute(attribute, new URL(node.getAttribute(attribute), source).href);
    }
  }
  const base = parsed.createElement('base'); base.href = source; parsed.head.prepend(base);
  const cosmetic = engine.call({ op: 'cosmetic', url: source });
  const style = parsed.createElement('style');
  style.textContent = cosmetic.hide_selectors.map(selector => `${selector}{display:none!important}`).join('\n');
  parsed.head.prepend(style);
  // Disponible solo durante esta prueba con HTML propio, nunca para navegación pública.
  window.__lumaFixtureCheck = check;
  const boot = parsed.createElement('script');
  boot.textContent = `(() => {
    const source=${JSON.stringify(source)};
    const original=window.fetch.bind(window);
    window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,source).href;return parent.__lumaFixtureCheck(url,'xmlhttprequest')?Promise.resolve(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})):original(url,options)};
    const open=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...rest){const absolute=new URL(url,source).href;return open.call(this,method,parent.__lumaFixtureCheck(absolute,'xmlhttprequest')?'data:application/json,{}':absolute,...rest)};
  })();`;
  parsed.head.prepend(boot);
  const frame = document.createElement('iframe');
  frame.id = '__native-prefilter';
  frame.title = 'Prueba local de prefiltrado';
  frame.style.cssText = 'position:fixed;inset:170px 5vw auto;width:90vw;height:70vh;z-index:100;background:white';
  try {
    frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    document.body.append(frame);
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && !frame.contentWindow.fixtureReady) await new Promise(resolve => setTimeout(resolve, 100));
    if (!frame.contentWindow.fixtureReady) throw Error('No terminó la página prefiltrada.');
    await new Promise(resolve => setTimeout(resolve, 400));
    const content = frame.contentWindow;
    return {
      mode: 'HTML propio prefiltrado antes de mostrarlo; WASM en TV, sin interceptor CDP',
      decisions,
      adScripts: content.adScriptExecuted || 0,
      goodScript: content.goodScriptExecuted === true,
      visibleAds: [...content.document.querySelectorAll('.lab-ad,#generic-lab-ad')].filter(node => content.getComputedStyle(node).display !== 'none').length,
      editorialVisible: content.getComputedStyle(content.document.querySelector('#good-content')).display !== 'none',
      limitations: ['Solo HTML controlado del laboratorio.', 'srcdoc cambia el contexto de URL y origen; no demuestra compatibilidad con sitios públicos.', 'No cubre WebSocket, workers, solicitudes CSS anidadas ni APIs de red distintas de las probadas.', 'No usar con páginas ajenas hasta diseñar aislamiento y navegación seguros.']
    };
  } finally { frame.remove(); delete window.__lumaFixtureCheck; }
}
