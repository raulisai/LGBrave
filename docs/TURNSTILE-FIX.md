# Cierres con Cloudflare Turnstile (2026-10-23)

Probado **en la TV** (LG 75UR8750PSA, webOS 25, recién reiniciada, sin otra sesión usándola). Arnés de diagnóstico propio fuera del repositorio: relanza Luma entre pruebas, muestrea `/proc` de la TV cada ~0,5 s por `ares-novacom --run` (jaula de desarrollador, solo lectura) y escucha CDP.

## Qué cerraba la app

- En el momento del cierre desaparece **todo WebAppMgr**: su proceso principal (con `--in-process-gpu` y red en proceso) y todos sus renderizadores. webOS lo vuelve a arrancar ~12 s después. No es un fallo de JS (montón ~6–8 MB) ni de WebGL por sí solo (página propia con WebGL/WebGL2 en PowerVR BXE-4-32: viva).
- **AnimeYT**: el documento del iframe de Turnstile se pide y 0,4 s después muere WebAppMgr. El renderizador de la página llegaba a ~200 MB con MemAvailable ~145 MB y swap en uso. La página trae **6 widgets Turnstile** (`.cf-turnstile`, render implícito) dentro de los diálogos cerrados de entrar/recuperar/registrarse; todos arrancan un desafío al cargar aunque no se use la cuenta.
- **AsiaLiveAction**: mismo patrón con **4 widgets** en formularios de acceso ocultos.
- **AnimeOnline Ninja**: es la página de verificación completa de Cloudflare (403 con `cf-mitigated: challenge`). Sin puente funciona (muestra «Verifique que es un ser humano»). Con el puente, `browser-bridge.mjs` trataba cualquier documento ≥ 400 como error y **tapaba la verificación** con «No se puede abrir la página (403)».

Mitigaciones probadas que **no** bastaron (con Turnstile cargando): bloquear imágenes/fuentes/vídeo/anuncios y caché; forzar GC/presión de memoria cada 1,5 s; viewport 960×540.

## Arreglos (código del Mac, sin reinstalar IPK)

1. `isChallengeResponse` en `browser-bridge.mjs`: un documento con `cf-mitigated: challenge` no es error; se muestra la verificación. Un 403 normal sigue siendo error.
2. `scripts/turnstile-defer.mjs` (siempre activo, también con la protección en pausa): los widgets `.cf-turnstile` se retienen mientras se analiza el documento; los visibles se liberan al terminar el documento y los que están en un contenedor no mostrado esperan a que se muestre (p. ej. abrir «Cuenta») y entonces se renderizan con los mismos `data-*` del sitio (incluidos callbacks). No se toca `challenges.cloudflare.com` ni las páginas de verificación de Cloudflare; nada se bloquea, responde ni modifica.

## Resultado en la TV (puente nuevo)

| Página | Antes | Ahora |
| --- | --- | --- |
| AnimeYT inicio | cierre a ~8 s | viva 60 s; 3 widgets aplazados, 0 desafíos cargados |
| AnimeYT episodio + clic en play | — | viva 50 s; el reproductor (servidor «Byse», mytsumi) pide su propio clic «verifica que eres humano»: lo hace el usuario |
| AsiaLiveAction inicio / episodio | cierre | viva 50 s / 40 s; 2 widgets aplazados |
| AnimeOnline Ninja | bucle/cierre, error 403 de Luma | viva 40 s mostrando la casilla de Cloudflare; la marca el usuario con el puntero |

Pendiente: que el usuario marque la casilla de AnimeOnline Ninja y confirme que entra y reproduce; reproducir en AnimeYT/AsiaLiveAction. Abrir «Cuenta» en esos sitios sí carga un desafío (uno solo); no probado si la TV lo aguanta.

## Segunda pasada: todas las páginas de los marcadores (2026-10-23, tarde)

Medición en TV de las 13 páginas con el puente real (28 s cada una, la app se relanza entre pruebas). Antes de esta pasada 12/13 abrían; fallaba **framextv.xyz**.

- **FrameXTV** (`framextv.xyz` → redirige a `framextv.cc`): la página usa `disable-devtool` (detectores 1,3,4,5,6,7, `url: about:blank`). Al notar el canal del inspector se expulsaba a `about:blank` en bucle (el puente usa el mismo canal que las herramientas de desarrollo). Arreglo general: `scripts/devtools-quiet.mjs` deja `console.*` inerte en las páginas web (el señuelo ya no se dispara); las excepciones siguen llegando a la caja negra por `Runtime.exceptionThrown`. Cloudflare intacto.
- **Escudo de ventanas** (`navigation-shield.mjs`): ahora cubre los 13 sitios y sus incrustaciones (antes 4). En esta TV `window.open` reemplaza la única página; el resto del escudo (capas fantasma y QR) sigue siendo de coincidencia exacta.
- **Memoria de cierres** (`scripts/crash-memory.mjs`, `.local/crash-sites.json`, solo hostnames): si la conexión con la app cae dentro de 20 s de empezar a abrir un sitio se anota; dos seguidos lo marcan (`riskySites` en el estado, aviso naranja en el mosaico del Inicio, línea `CIERRE` en `flight.log`). Sobrevivir 20 s lo limpia. Límite: el usuario que sale de Luma a los 20 s de abrir una página suma un falso cierre; hacen falta dos seguidos.
- AnimeOnline Ninja mantiene la casilla de Cloudflare: es la verificación real y la marca el usuario.
