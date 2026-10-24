# Bloqueo y reproducción · Cuevana · 0.7.2

Fecha: 2026-10-21. Sitio solicitado por el usuario: https://cuevana3c.pro/. TV LG 75UR8750PSA, SDK 10.3.2, firmware original 33.31.75. Pruebas públicas sin iniciar sesión, audio silenciado. La protección continúa dependiendo del Mac.

## Hallazgos comprobados

- Antes del cambio, un cargador publicitario insertó un aviso falso de «no eres un robot» con QR que tapaba la página. Captura `evidence/cuevana/baseline-movie.png`.
- Las listas ya incluían reglas `+js`, pero el motor solo recibía 17 recursos personalizados de Brave y los locales. Faltaban recursos comunes y sus dependencias: varias reglas no producían código ejecutable. El conjunto upstream probado contiene 211 recursos; los 17 previos son nombres ya incluidos y se combinan sin duplicarlos.
- La ventana principal estaba excluida de las decisiones de red. No había una política específica para `window.open` y salidas automáticas de la página.
- El recorrido original de reproducción reconstruye el catálogo en el inicio y coloca el video dentro de marcos. En la TV se observó que la app se reiniciaba/reemplazaba su target al abrirlo. El usuario confirmó una congelación y reinició la TV. **No se estableció la causa interna**; el recorrido ligero evitó el fallo en la muestra final.
- El servidor de video carga `/assets/jquery/ev-player.js`; al dejarlo pasar, el primer clic abría una ventana (bloqueada) y no iniciaba el video. Al bloquear ese cargador concreto, el botón inició las tres películas. JW Player, sus controles, `/dl`, manifiestos y segmentos permanecen permitidos.
- Algunos segmentos llegan como XHR con extensión `.woff2` o listas `.txt`. Bloquear por extensión o todos los dominios externos rompería contenido legítimo.

## Implementación

- `scripts/filter-engine.mjs`: carga recursos comunes, dependencias, alias y permisos desde `research/brave/full/resources.json`, combinados con los personalizados/locales.
- `scripts/browser-bridge.mjs`: entorno de ejecución `scriptletGlobals` para los recursos comunes, scriptlets antes del escaneo DOM; filtrado de documentos principales; abortar navegación publicitaria con `Fetch.failRequest: Aborted`; no intentar Fetch en targets worker que no lo exponen.
- `scripts/navigation-shield.mjs`: rutina al inicio del documento, restringida a Cuevana y sus marcos descendientes. Bloquea `window.open`, conserva enlaces normales en la misma pestaña y contiene una detección conservadora de capas transparentes con manejador de apertura publicitaria. La prueba sintética de esa detección pasa; el contador final de capas retiradas fue 0 porque el cargador ya se bloqueó antes.
- Al pulsar el botón o un servidor, abre en esta pestaña **la URL HTTPS que ya proporciona el sitio** en `tungtungsahur.cuevana3c.pro`, con su opción `pops=false`. Evita reconstruir el catálogo detrás del video. Mantiene origen y cabeceras del reproductor; no extrae archivos ni elimina restricciones de seguridad. Atrás regresa a la ficha. También se admite clic sintetizado por bibliotecas de teclado; no se expone un comando privilegiado nuevo.
- Se bloquean salidas automáticas por script desde el catálogo a otros dominios. No se aplica esa restricción a transferencias del subdominio reproductor, a enlaces normales ni a direcciones introducidas en Luma.
- `scripts/shields.mjs`: reglas observadas para `varkus.js`, latgw.fun, dingerepilobe.com, waughyciliary.com y el cargador `ev-player.js` del servidor probado. No hay una lista de permiso general para video que deje pasar anuncios con tipo Media.

## Resultados finales

En `evidence/cuevana/tv/validation.json`, **tres muestras de reproducción en la TV usando el botón real del reproductor**, sin ejecutar `video.play()` para saltarse sus controles:

| Película | Servidor | Inicio y avance | Salto al minuto 1 |
| --- | --- | --- | --- |
| Omaha | Hyper, primera opción | Correcto | Correcto |
| Bad Apples | Hyper, primera opción | Correcto | Correcto |
| Solomamma | Hyper, primera opción | Correcto | Correcto |

Cada muestra compara dos lecturas separadas por cinco segundos: tiempo y fotogramas decodificados aumentan, video sin error y sin pausa. También se observó reproducción manual prolongada en una prueba preliminar. Las sesiones previas del mismo reproductor pueden restaurar su posición; el criterio mide avance, no que siempre empiece en cero.

La pasada final registró 13 solicitudes bloqueadas por película. **No equivale a 13 anuncios**. En los puntos muestreados no quedaron las capas QR observadas inicialmente. Capturas y solicitudes bloqueadas acompañan el JSON. La comparación inicial en Chromium del Mac pasó las tres películas, pero no se usa para acreditar compatibilidad de la TV.

Pruebas locales: resolver 24, escudo previo 15, puente 28, motor 15, más pruebas nuevas de ventanas, ámbito, reproducción ligera, capas y ejecución real de dependencias de scriptlets. `npm test`.

Cancelación de navegación: `evidence/cuevana/navigation-abort-tv.json`, página original conservada y diagnóstico responde. **Se descartó HTTP 204**: funcionó en Chromium de escritorio, pero dejó sin responder evaluaciones del inspector de WAM hasta otra navegación. Se conserva el resultado de escritorio como experimento, no como solución entregada.

Regresión de recursos controlados con reglas aisladas, como la línea base original: 7/7 impedidas, 8/8 permitidas, excepción y scriptlet temprano correctos, 0 anuncios visibles; `evidence/cuevana/fixture-regression.json`. El ensayo adicional con listas completas respeta una excepción generichide para IP privada y deja el elemento genérico visible (`fixture-active-lists.json`); no se forzó su ocultación ni se confundió con el resultado de los sitios públicos.

## Repetir sin interferir con el usuario

Detener el lanzador/puente habitual, mantener servidor e inspector. Un solo interceptor por target:

```sh
node scripts/validate-video-site.mjs http://localhost:PUERTO tv
node scripts/validate-navigation-cancel.mjs http://localhost:PUERTO
node scripts/validate-ad-fixture.mjs http://localhost:PUERTO
```

El ensayo de video navega tres fichas, pulsa su botón, silencia el video, observa reproducción y avanza a 60 s. Guarda resultados parciales; se detiene si el target no responde. Los subdirectorios con intentos previos conservan fallos y errores de la automatización; no son el resultado final. Al terminar, restaurar `npm run lab` y la página de inicio.

## Alcance pendiente

No se vieron películas completas, todas las películas ni todos los servidores. No se demuestra cero publicidad, equivalencia con Brave, ausencia universal de falsos positivos, ni protección frente a todos los cambios futuros del sitio. La regla del cargador de video identifica el dominio observado; aliases nuevos necesitan pruebas y mantenimiento. La política de ventanas es deliberadamente estricta dentro de este sitio y puede requerir excepciones para flujos legítimos que abran otra ventana.

La barra sigue siendo una superposición experimental. Persisten límites de aislamiento y de cobertura de workers/OOPIF. DNS, firmware, arranque y particiones no se modificaron.

## Fuentes revisadas

No se auditó todo Brave. Se revisaron la integración existente, biblioteca de recursos, dependencias y componentes pertinentes:

- [Recursos comunes, commit fijado](https://github.com/brave/adblock-rust/blob/1c0740d27d531a2389c808212a8702592bb74138/data/brave/brave-resources.json).
- [Modelo de recursos y dependencias de adblock-rust](https://github.com/brave/adblock-rust/blob/master/src/resources/mod.rs).
- [Proveedor de recursos de Brave](https://github.com/brave/brave-core/blob/master/components/brave_shields/core/browser/ad_block_default_resource_provider.cc).
- [Recursos personalizados de Brave](https://github.com/brave/adblock-resources).

Procedencia, SHA-256 y licencias: `research/brave/full/README.md`, `LICENSE` y `UBLOCK-LICENSE.txt`; ampliación en `research/provenance.json`.
