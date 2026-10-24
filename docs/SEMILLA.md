# SEMILLA · Luma Browser Lab

> Resumen corto y siempre al día: **`docs/SOUL.md`** (leer primero). Este archivo es el detalle histórico; al cambiar algo, actualizar también SOUL.

Actualizada: 2026-10-23. Proyecto: `/Users/djoker/code/lgApp`. Versión instalada: **0.7.2**, app `com.lgapp.lab`. Incluye la UI 0.7.1 y el escudo/reproducción ligera de Cuevana. Esta es la memoria compacta para continuar; comprobar el código cuando contradiga el documento.

## Objetivo y decisiones del usuario

- Navegador para LG con interfaz inspirada en Safari y bloqueo basado en Brave. Validar capacidades reales antes de ampliar funciones.
- Google por defecto; Configuración permite Google, Bing, DuckDuckGo y Brave Search. No cambiar de proveedor automáticamente ante errores.
- Conservar el firmware original. No se autorizaron cambios de arranque, particiones ni flasheo. DNS queda para el final.
- Objetivo lejano: investigar viabilidad de webOS OSE personalizado; **no existe todavía una ruta de instalación o recuperación validada para esta TV**.
- Comunicación en español y sencilla. No prometer cero publicidad ni un porcentaje de Brave replicado.

## Equipo y entorno

- LG 75UR8750PSA, α5 AI 4K Gen6 comercial, panel 3840 × 2160; interfaz observada 1920 × 1080, Chromium 120.
- webOS 25; SDK/sistema mostrado 10.3.2-33; firmware inventariado 33.31.75. Consultar `docs/INITIAL-INVENTORY.md` antes de extrapolar hardware.
- TV observada `192.168.1.134`; Mac `192.168.1.148`. Son datos cambiantes. Usuario confirmó Developer Mode activo y contador 999h:47m en una fase anterior; no es una lectura actual.
- Perfil CLI `lg-lab`; llave fuera del proyecto `~/.ssh/lg-lab_webos`. Nunca copiar llaves ni passphrases a documentos/evidencias.
- Node 22.22.3, npm 10.9.8, macOS arm64. CLI LG local 3.2.6; Svelte 5.57.2, Vite 8.3.5. Versiones fijadas en lock.
- Último almacenamiento libre informado: ~0.66 GB; pendiente medir de nuevo. Inventario no equivale a respaldo recuperable del firmware.
- Git: commit base del usuario `003dcae` (0.5.0). Los cambios 0.5.1 (logo, otro agente) y 0.6.0 están **sin commit**. Copia del código 0.5.0 en `.local/backups/`; IPK 0.5.0, 0.5.1 y 0.6.0 en `artifacts/` para volver atrás.
- Puede haber otro agente trabajando en la carpeta: revisar `git status` antes de editar.

## Qué construimos y cómo funciona

1. Entorno CLI, conexión de desarrollo SSH, inventario y despliegue de app Svelte empaquetada como IPK.
2. Inicio, favoritos, barra de navegación y controles de TV. Bundle clásico IIFE: corrigió problemas de recursos al regresar desde páginas remotas.
3. Motor real Brave: Node `adblock-rs` 0.13.3 en Mac; crate Rust del mismo motor adaptado a WASM para TV. EasyList/EasyPrivacy y avisos de licencia incluidos. No se revisó todo Brave/Chromium.
4. **Modo público actual: asistido por Mac.** CDP intercepta solicitudes de la TV, motor Node decide y la TV renderiza. Recursos bloqueados reciben respuesta local vacía: fallarlos directamente provocó errores de WAM. CSS cosmético y scriptlets complementan el bloqueo.
5. Barra de páginas en un mundo JS aislado y Shadow DOM cerrado; CSSOM permite estilo con CSP restrictiva. DOM compartido con el sitio: no equivale a una barra nativa segura.
6. Motor WASM autónomo validado en HTML propio. Hook tardío no bloquea cargas iniciales; prefiltrado previo solo sirve para fixtures conocidos y altera origen/contexto. No se habilitó como navegador universal.
7. Resolver compartido para búsquedas/URLs; rechazo de protocolos no HTTP(S) y URLs con credenciales. Movimiento reducido, errores HTTP/vacío/timeout, Reintentar e Inicio.
8. Lanzador reconecta al perder SSH o cambiar la instancia de app. Conserva página cuando puede; no garantiza recuperar sesión tras cualquier cierre.
9. Configuración de buscador persistente: autoridad en `.local/browser-settings.json` del Mac (escritura atómica, modo 0600); espejo en localStorage. Se aplica a ambas barras y sobrevive recarga/reinicio del puente.
10. **0.6.0 UI estilo Safari, minimalista.** Inicio: saludo, buscador central, favoritos en fila con desplazamiento, informe de privacidad con logo del león y contador animado. Configuración tipo iOS (buscador, interruptor de protección, laboratorio). Navegación espacial 2D con el control (`src/spatial.js`), foco con elevación y animaciones solo de `transform`/`opacity`.
11. Barra de páginas compacta (72 px): dominio con candado, progreso dentro de la dirección, recargar/detener, favorito, escudo con contador, inicio y ajustes. Se oculta 4 s después de cargar o al bajar; vuelve al subir, con Arriba en la parte superior, puntero arriba o teclas de color. Ya **no tapa la página mientras carga**; el velo solo aparece en errores. Atrás/Arriba se ceden a webs que los gestionan (p. ej., YouTube TV).
12. Rendimiento: caché HTTP activa (antes se desactivaba), DevTools sin búfer de cuerpos, contador sin recorrer registros, actualizaciones de la barra sin reescribir DOM igual, caché del inicio servido (`immutable` para assets).
13. Bloqueo: reglas propias `scripts/shields.mjs` (red, cosmética y scriptlet `luma-youtube` que limpia `adPlacements/playerAds/adSlots` en HTML, `JSON.parse`, `fetch` y XHR, más salto de anuncios residuales). CSS y scriptlets al inicio del documento: YouTube registrado al arrancar; direcciones escritas, favoritos, atrás/recargar antes de navegar; cada dominio al cargar para sus siguientes enlaces. Cosmética genérica incremental: la barra aislada envía clases/ids nuevos y el Mac responde con selectores.
14. Favoritos desde cualquier página (estrella) guardados en el Mac; Editar en inicio para quitarlos. **Desde 0.7.0 son marcadores con categoría** (punto 16).
15. `scripts/update-lists.mjs` (EasyList Español, cookies, uBlock) con validación y vuelta atrás: **ejecutado el 2026-10-21**, siete listas activas. `filter-engine` usa `research/lists/lists.json` si existe. No hay actualización automática periódica.
16. **0.7.0 (instalada; visto en TV: marcadores abiertos, estrella guardada y barra de cristal; fondo, filas y diálogo Agregar sin captura): inicio rediseñado y marcadores por categoría.** Inicio oscuro de cristal sobre foto (`public/bg-street.jpg` y `bg-canyon.jpg`, enviadas por el usuario; elegibles en Configuración > Fondo del inicio con control de oscurecer 0-90 %, por defecto 35 %, guardado en localStorage de la TV (`luma-wallpaper`, `luma-dim`)) con saludo, buscador en píldora y una fila por categoría (Anime, Películas, Otros + las que el usuario cree) con mosaicos y «Agregar». Arriba a la derecha: chip del escudo (contador o «Sin Mac»; desde el cambio 2026-10-23, solo en depuración, pendiente instalar), lápiz para editar/quitar y ajustes; desaparecieron la franja Atrás/Adelante, el informe de privacidad y el pie. Marcadores en el Mac (`.local/browser-settings.json`: `categories`, `favorites[{url,title,category}]`, `bookmarksVersion:1`); primer arranque siembra los ejemplos del diseño (editables, una sola vez); los favoritos antiguos pasan a «Otros». Una misma dirección puede estar en varias categorías (identidad = categoría + URL). Las categorías propias desaparecen con su último marcador; las tres base siempre existen. Espejo en localStorage (`luma-bookmarks`) para mostrar algo antes de conectar. Diálogo «Nuevo marcador» (nombre, dirección, categoría o categoría nueva); comandos del puente `add-bookmark`, `favorite` (conmuta por categoría) y `remove-favorite` ({url,category} o URL). Iconos de mosaico: monogramas con color de marca, no logos reales.
17. Barra de páginas (0.7.0): cristal oscuro flotante con desenfoque; la estrella abre un menú de categorías (✓ = guardado ahí; pulsar quita o añade); oculta, deja una franja transparente de 40 px en el borde superior que la muestra al pulsar, además del puntero, Arriba y teclas de color.

## Mapa para continuar sin releer todo

| Ruta | Responsabilidad |
| --- | --- |
| `src/App.svelte` | Inicio, configuración, carga, errores, control remoto |
| `src/navigation.js` | Resolver único y proveedores de búsqueda |
| `scripts/browser-bridge.mjs` | Intercepción CDP, navegación, estado y comandos |
| `scripts/toolbar.mjs` | Barra aislada superpuesta a páginas |
| `scripts/filter-engine.mjs` | Adaptación Node del motor y filtros |
| `scripts/preferences.mjs` | Preferencias persistentes del Mac: buscador, categorías y marcadores |
| `scripts/start-lab.mjs`, `lab-runtime.mjs` | Conexión pasiva y ciclo del puente; nunca lanzar Luma |
| `scripts/inspector-tunnel.mjs`, `passive-inspect.mjs` | SSH local hacia inspector ya existente, sin comandos de aplicaciones |
| `scripts/navigation-shield.mjs` | Ventanas/capas Cuevana y JKAnime; QR tardío observado |
| `scripts/cdp.mjs` | Cliente CDP / conexión al target |
| `scripts/fixture-server.mjs` | Inicio servido y pruebas controladas, puertos 43187/43188 |
| `wasm-engine/`, `public/adblock.wasm` | Adaptador Rust y motor TV compilado |
| `research/BRAVE-ANALYSIS.md`, `research/provenance.json` | Componentes estudiados, fuentes y huellas |
| `docs/BROWSER-VALIDATION.md`, `docs/NAVIGATION-FIX.md` | Resultados detallados y problemas resueltos |
| `docs/PLAN-MEJORAS.md` | Prioridades propuestas para rapidez y seguridad |
| `src/spatial.js`, `src/icons.js`, `src/Icon.svelte` | Navegación espacial e iconos compartidos inicio/barra |
| `scripts/shields.mjs` | Reglas y scriptlet propios (YouTube) |
| `scripts/test-*.mjs` | Pruebas locales sin TV (`npm test`) |
| `scripts/benchmark.mjs`, `scripts/validate-youtube.mjs` | Medición de cargas y escudo de YouTube en TV |
| `scripts/update-lists.mjs` | Actualización verificable de listas |

## Evidencia y límites de los resultados

- Motor Node: **15/15** comprobaciones. Motor WASM en TV: **5/5**, arranque ~2.7 s, memoria lineal ~46.4 MiB; una medición, no toda la RAM de la app.
- CDP y prefiltrado local: **7/7** solicitudes publicitarias controladas impedidas y **8/8** legítimas preservadas; CSS 3 elementos → 0. Hook tardío: **0/7** iniciales impedidas.
- Sitios públicos: Example Domain y MDN cargaron. BBC cargó en una pasada (30 bloqueos de 153 solicitudes) y agotó espera en una regresión posterior. No presentarlo como estable.
- Corrección 0.4.0: ocho pruebas de búsqueda, carga, errores y recuperación pasaron en TV. Evidencias `evidence/navigation-fix/`.
- Versión 0.5.0: resolver **24 casos**; configuración **6 comprobaciones** en TV, persistencia tras recargar y reiniciar puente, cuatro proveedores, sin desbordamiento a 1920 × 1080. `evidence/search-settings/validation.json` y `settings-google.png`. Se restauró Google.
- Build, paquete 0.5.0 e instalación completados. Artefacto: `artifacts/com.lgapp.lab_0.5.0_all.ipk`.
- **0.6.0 en TV**: `npm test` local (24 + 15 + 17 + 15); configuración 6/6, navegación 8/8, fixtures 7/7 y 8/8, CSS 3→0, scriptlet temprano correcto; BBC 34 de 166 bloqueadas. Evidencias en `evidence/ui-0.6.0/`, `search-settings/`, `navigation-fix/`, `browser-lab/`.
- Velocidad (`evidence/performance/benchmark.json`, 3 sitios, 1 pasada): visita repetida mediana 2192 → 1329 ms y 403 → 86 KB de red con caché. Orientativo.
- YouTube (`evidence/youtube/`): mismo vídeo silenciado; con protección empieza en 0 s sin anuncios, sin protección dos anuncios (~12 s). Inicio de YouTube: 0 anuncios visibles. Una cuenta sin sesión, región MX; YouTube cambia y no se garantiza cero anuncios.
- Las cifras controladas no miden todos los anuncios de Internet. Sin equivalencia demostrada con Shields completo: fingerprinting, CNAME, cookies, antiphishing, popups, workers, DRM, login, descargas y pagos pendientes.
- Hallazgos de WAM: `Page.addScriptToEvaluateOnNewDocument` **se bloquea** si se llama con la solicitud del documento en pausa (no registrar dentro de `Fetch.requestPaused`). Tras visitar webs remotas, WAM bloquea `file://` de la app: `validate:browser` y `validate:native` requieren relanzar la app.
- Sin cambios de DNS, firmware, particiones, bootloader ni root. No se retiraron cabeceras de seguridad de sitios públicos.

## Operación y pruebas

Desde la raíz del proyecto:

```sh
npm ci
npm test
npm run package
```

Uso asistido (dos terminales; comprobar IPs antes):

```sh
npm run lab:server
# En otra terminal:
npm run lab
```

Instalación cuando cambie el bundle empaquetado:

```sh
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_0.7.2_all.ipk
npm run tv:launch
```

Pruebas TV: detener el lanzador/puente activo, mantener servidor, abrir Luma manualmente, ejecutar `node scripts/passive-inspect.mjs` y usar el endpoint impreso. Este túnel no lanza aplicaciones. **Un solo interceptor y una sola prueba que navegue a la vez.** Cerrar el túnel de pruebas antes de restaurar `npm run lab`.

```sh
node scripts/validate-settings.mjs http://127.0.0.1:PUERTO
node scripts/validate-navigation.mjs http://127.0.0.1:PUERTO
node scripts/validate-youtube.mjs http://127.0.0.1:PUERTO
node scripts/validate-jkanime.mjs http://127.0.0.1:PUERTO
node scripts/benchmark.mjs http://127.0.0.1:PUERTO
npm run validate:browser -- http://127.0.0.1:PUERTO
npm run validate:native -- http://127.0.0.1:PUERTO
```

WASM nativo requiere inicio empaquetado y condiciones específicas descritas en README. Reiniciar `npm run lab` al terminar; dejar Google seleccionado. Puerto del inspector y procesos **no son persistentes**; `evidence/browser-lab/session-state.json` es una captura, no descubrimiento vivo.

## Pendiente y siguiente paso recomendado

0. La 0.7.2 ya está instalada; queda validar manualmente con el usuario los detalles de la UI nueva: fondo, filas, Agregar con teclado de la TV, Editar, estrella con categorías y barra de cristal (franja superior con el puntero). Verificado solo en navegador de escritorio con datos simulados y con `npm test` (23 del puente).
1. Hacer commit de 0.5.1 + 0.6.0 + 0.7.0 sobre la base `003dcae` (aún sin commit). Rollback probado: reinstalar el IPK anterior de `artifacts/`.
2. Las siete listas se activaron el 2026-10-21. Al volver a actualizarlas, reiniciar `npm run lab` y repetir las regresiones pertinentes. No depender solo de listas para ventanas o publicidad insertada en el DOM.
3. Unificar configuración de IPs y añadir diagnóstico de conexión, servidor, versiones, espacio y sesión de desarrollo disponible; no inventar lecturas inaccesibles.
4. Control de instancia única para impedir interceptores concurrentes y pruebas que interfieran con la sesión del usuario.
5. Separar servidor de uso habitual de fixtures y registro de pruebas; revisar aislamiento/autorización de comandos y acceso al servicio local antes de usar sesiones sensibles.
6. Medir estabilidad prolongada y más sitios con `benchmark.mjs`; el primer enlace hacia un dominio nuevo aún recibe la cosmética tarde (después mejora).
7. Evaluar autonomía sin Mac como investigación separada con criterios de viabilidad. OSE y DNS siguen posteriores; no hacer flasheo como experimento inicial.

## Entrega de esta sesión

2026-10-21: se creó esta semilla y el plan de mejoras a partir del código y evidencias locales. Se añadió índice de entrada para futuras sesiones. Solo documentación; no se modificó la app ni se repitieron pruebas que naveguen la TV. Usuario confirma buen funcionamiento. Mejoras de la lista siguen propuestas, no implementadas.

2026-10-21: versión 0.5.1 cambia el logo a un león dorado envolviendo LG, generado con imagegen. Original y prompt en `assets/branding/`; iconos webOS 80/130 px y logo UI 256 px en `public/`. Se integra en cabecera e inicio; se conserva icono anterior. Build e instalación correctos; no cambia navegación ni filtros.

2026-10-21: versión 0.6.0 (Claude). UI minimalista estilo Safari en inicio, configuración y barra; rendimiento (caché, sin búfer de DevTools); escudo de YouTube, inyección temprana y cosmética incremental; favoritos persistentes; pruebas locales y en TV indicadas arriba. Se reintegró el logo 0.5.1 y se reconstruyó su IPK desde el punto de control del otro agente. Laboratorio restaurado en segundo plano (`.local/logs/lab.log`, `fixture-server.log`) con Google seleccionado.

2026-10-21: versión 0.7.0 (Claude). Fondo de usuario, inicio estilo cristal, marcadores con categorías persistentes, barra glass con menú de categorías y franja superior. `npm test` correcto (puente ampliado a 23 comprobaciones). No se instaló en la TV ni se tocó la sesión del usuario; `ares-inspect` y el servidor de fixtures seguían activos de antes.

2026-10-21: listas ampliadas (Claude, a petición del usuario). `npm run lists:update` activó EasyList, EasyPrivacy, EasyList Español, Fanboy Cookiemonster (`secure.fanboy.co.nz`; la URL de EasyList Cookie daba 404) y uBlock filters/privacy/unbreak; manifiesto en `research/lists/lists.json`, copia anterior en `research/lists/previous/`. En TV: fixtures 7/7 y 8/8, CSS 3→0, motor 5/5; BBC bloquea el gestor de consentimiento y la cadena publicitaria ya no arranca (terceros permitidos 10 → 2). YouTube con el mismo vídeo: con protección empieza en 0 s sin anuncios; sin protección, anuncios durante toda la muestra (`evidence/youtube/playback-comparison.json`). Correcciones: la barra se monta sin `innerHTML` (YouTube exige Trusted Types y antes no aparecía la barra ni funcionaba Atrás) y la carga se da por terminada antes de refrescar la cosmética de iframes lentos. **Pendiente:** tras el error por tiempo de espera, el inicio no muestra el mensaje de «tardando» (paso final de `validate-navigation`, reproducido; el inicio no respondió a una evaluación). Se dejó de investigar por indicación del usuario. Hubo dos laboratorios conectados a la vez durante unos segundos; se cerró el de esta sesión y quedó el de la sesión 0.7.0.


2026-10-21 (después): 0.7.0 instalada y lanzada en la TV; lab reiniciado. Capturas en `evidence/ui-0.7.0/`: la barra de cristal y la estrella con marcador sobre jkanime.net (el usuario ya navegaba desde sus marcadores, así que no se volvió a Inicio ni se tocó su sesión). El inicio nuevo no se capturó en TV.


2026-10-21: **0.7.2, Cuevana**. Informe completo `docs/CUEVANA-VALIDATION.md`. Se incorporaron 211 recursos comunes de Brave (deduplicados con los 17 existentes), dependencias y entorno `scriptletGlobals`; reglas específicas para cargadores publicitarios observados; guardia de ventanas y salidas automáticas, con reproducción ligera abriendo el reproductor HTTPS que proporciona el sitio (`pops=false`) sin reconstruir el catálogo. Código nuevo `scripts/navigation-shield.mjs`. Se observaron reinicios de la app con el recorrido original; el usuario reinició la TV una vez. Causa interna no establecida. Ruta ligera: **Omaha, Bad Apples y Solomamma, servidor Hyper, inicio con botón real, avance de tiempo/fotogramas y salto a 60 s correctos** (`evidence/cuevana/tv/validation.json`), 13 solicitudes bloqueadas por muestra, sin anuncios/ventanas observadas en esos puntos. No se vieron películas completas ni todos los servidores. El cargador `ev-player.js` del host de video consumía el primer clic: su bloqueo permitió iniciar con uno. No prometer equivalencia con Brave o cero publicidad universal.

Pruebas 0.7.2: `npm test` (24 resolver + 15 escudo previo + 28 puente + 15 motor, más escudo de navegación nuevo con dependencias ejecutadas y falsos positivos de capas); build/paquete/instalación correctos. Cancelación de navegación comprobada en TV con `Fetch.failRequest: Aborted`; se descartó 204 porque deja evaluaciones de WAM detenidas. Se mantiene respuesta vacía 200 para subrecursos bloqueados. Validadores nuevos: `validate-video-site.mjs`, `validate-navigation-cancel.mjs`, `validate-ad-fixture.mjs`; detener el puente habitual antes de usarlos. Recursos, SHA y licencias en `research/brave/full/` y `research/provenance.json`. Los cambios de filtrado/guardia se ejecutan en el Mac y requieren reiniciar el puente; DNS y firmware intactos.

Cierre 0.7.2: regresión controlada aislada 7/7 impedidas, 8/8 permitidas, excepción preservada, scriptlet temprano y cosmética 3→0 correctos. Con listas activas la IP privada tiene generichide: ese ensayo mantiene 1 elemento genérico por la excepción y no se utiliza como fallo de la protección pública. Laboratorio habitual restaurado y página de inicio conectada; puerto en `evidence/browser-lab/session-state.json` es solo la última captura.

Verificación de cierre: inicio 0.7.2 respondió listo y conectado. Después se observó navegación activa a jkanime.net; se conservó esa página. El inspector tuvo un corte de conexión y el lanzador reconectó automáticamente. No forzar Inicio al retomar si el usuario ya está navegando.


2026-10-23: **incidente de apertura involuntaria resuelto en el Mac**. El antiguo `start-lab.mjs` repetía `ares-inspect`, cuyo `_runApp()` de la CLI 3.2.6 lanza la app si no aparece en la lista de ejecución. Esto reabría Luma al cambiar de aplicación o encender la TV. Se detuvo el proceso 69837 y su inspector y se cerró Luma una vez; el usuario confirmó que volvió a poder abrir otras aplicaciones. Sustitución: `inspector-tunnel.mjs` (SSH hacia 9998, escucha solo 127.0.0.1, sin comandos de lanzamiento), `lab-runtime.mjs` (descubre únicamente el target Luma, conecta a una app ya abierta, espera al cerrar/apagar), `runtime-lock.mjs` (una instancia). `start-lab` no navega al inicio ni usa ares-inspect. `cdp.mjs` identifica el appId exacto o el directorio empaquetado, no una coincidencia en cualquier URL. 13 pruebas locales nuevas pasan; `npm test` incluye la regresión. No se cambió el IPK 0.7.2 ni firmware ni ajustes de arranque. No se encontraron LaunchAgents referidos al proyecto. Informe `docs/PASSIVE-CONNECTION-FIX.md`. **El usuario pospuso explícitamente el 2026-10-23 la verificación física de abrir Luma→Pluto y apagar/encender con el runtime corregido; no se afirma que esa prueba esté hecha.**

2026-10-23: **QR dinámico de JKAnime reproducido y corregido**. Informe `docs/JKANIME-VALIDATION.md`; evidencia `evidence/jkanime/`. Con listas y puente activos, el script `db.unboltsecole.com/r5K9akItvISYz1J/128512` pasaba por el motor y creaba después de cargar un iframe vacío fijo, pantalla completa, z-index 2147483646, con las frases del QR. Pila de creación guardada; el selector de EasyList Español esperaba 2147483647 y `no-window-open-if` no impide anuncios dentro del documento. Regla nueva de red `||unboltsecole.com^$script,domain=jkanime.net`. Guardia propia extendida a JKAnime/embeds; fallback estrecho de QR exige iframe vacío accesible sin srcdoc, geometría, z-index alto, ambas frases exactas e imagen/canvas/SVG; observa contenido tardío. No bloquea todos los QR ni todos los iframes. **TV: One Piece 1180, 1179 e Hyouken II 3, servidor Desu: 3/3 sin QR en las ventanas observadas, reproducción con tiempo/fotogramas crecientes y salto a 60 s correctos**. Cada muestra: 6 solicitudes bloqueadas, incluido el cargador; no equivalen a 6 anuncios. Fixture adicional de QR tardío retirado, QR de login preservado. `npm test` pasa con nuevas regresiones; informe sin errores del puente. Sesión restaurada al inicio servido y Google. No se demostró rotación de dominios/campañas ni cobertura de episodios completos/todos los servidores. Cambios del Mac; IPK sigue 0.7.2, DNS/firmware/arranque intactos. Al cerrar pruebas restaurar solo el runtime pasivo y mantener pospuesta la prueba física Luma→Pluto→apagado.

Cierre JKAnime: túnel de diagnóstico e interceptores de prueba cerrados; servidor y un solo runtime pasivo activos. Lectura final del inicio: documento completo, sin aviso «Sin Mac», Google conservado (`evidence/jkanime/restored-session.json`). No hay proceso `ares-inspect` activo. Los puertos de las capturas no son estado vivo para la próxima sesión.

2026-10-23: a petición del usuario, el chip superior de diagnóstico (contador/«Sin Mac»/pausa) queda oculto por defecto en inicio y barra de páginas. Se muestra únicamente al iniciar el puente con `LUMA_DEBUG=1 npm run lab` (o `options.debug: true` para uso programático); estar conectado no activa depuración. El estado `debug` viaja con los latidos y la barra nace oculta para evitar destellos. Se conserva el control de protección en Configuración. Build y `npm test` correctos; paquete preparado en `artifacts/debug-ui/com.lgapp.lab_0.7.2_all.ipk`. **Pendiente instalar y reiniciar el puente**; no se tocó la TV ni su sesión, ni se verificó visualmente en TV. El paquete anterior sigue conservado en `artifacts/`.

2026-10-23: **0.8.0 preparada, pestañas superiores e integración de diagnóstico**. Documento `docs/TABS.md`; paquete `artifacts/com.lgapp.lab_0.8.0_all.ipk`. «+», selección y × en Inicio y barra de páginas; máximo doce. `scripts/browser-tabs.mjs` conserva historial independiente (hasta cien entradas) y desplazamiento por pestaña, solo en memoria. Son pestañas suspendidas: una sola página activa, se recarga al cambiar; no conservan formularios, DOM ni reproducción. No usar iframes para eludir cabeceras. Comandos del puente serializados; evita sobrescribir la pestaña nueva con la página anterior al cambiar antes de terminar la carga. Runtime conserva el modelo al reconectar al mismo target; lo descarta si observa cierre o una instancia distinta. El cierre de la última deja Inicio. Control remoto: Arriba desde dirección a pestañas, Abajo vuelve; fila y barra se ocultan juntas. Chip de diagnóstico oculto por defecto en ambas superficies, explícito con `LUMA_DEBUG=1`. `npm test` pasa con ocho comprobaciones nuevas y regresión de sesión del runtime; Chrome escritorio 1920×1080 pasa siete recorridos, capturas revisadas y resultado en `evidence/tabs-0.8.0/desktop/`. **No validado ni instalado aún en TV**: el chat «Arquitect Main» tiene pruebas activas allí; se pidió al usuario confirmar disponibilidad para instalar sin concurrencia. No se tocaron sus procesos ni su página, ni DNS/firmware/arranque. La versión instalada registrada continúa siendo 0.7.2; el servidor local ya sirve el build nuevo cuando se vuelve a Inicio.

2026-10-23: revisión de cómo Brave actualiza su bloqueo (`docs/BRAVE-ACTUALIZACIONES.md`). Brave elige listas con `adblock-resources/filter_lists/list_catalog.json`, las copia cada 30 min a `brave/adblock-lists-mirror` (rama `lists`, archivos `md5(url).txt`), las preprocesa y prueba en `brave-core-crx-packager` y las publica como componentes firmados; el navegador comprueba al arrancar y cada 5 h. `go-updater.brave.com` exige la clave de Brave: **no usarla**. Hallazgos para Luma: el motor aplica ambos lados de `!#if` (351 bloques; Brave los filtra), faltan 15 fuentes por defecto de Brave (brave-specific, first-party, cookies uBO/Brave, badware, URLhaus…) y los scriptlets vienen de una instantánea de adblock-rust en vez del commit de `brave/uBlock` que fija Brave. Propuesta (no implementada): seguir catálogo + espejo con `git ls-remote` cada 30 min y procesar como el empaquetador.

2026-10-23: **seguimiento automático de Brave implementado** (detalle en `docs/BRAVE-ACTUALIZACIONES.md`). `update-lists.mjs` ya no usa una lista fija: lee el catálogo de Brave, descarga desde `brave/adblock-lists-mirror` en el commit exacto, procesa como el empaquetador (`brave-sync.mjs`) y genera los scriptlets desde el commit de `brave/uBlock` fijado por Brave, en un proceso aislado con `--permission` (`ublock-scriptlets.mjs`). Las listas se cargan con sus permisos (`filter-engine.mjs`) y se comprueba cada 30 min con `git ls-remote` (`filter-updates.mjs`, estado en `research/lists/sync-state.json`). Generación activa `36c66427…`: 6 componentes, 250 546 líneas, 0 `!#if`. `npm test` correcto, con 11 comprobaciones nuevas; la prueba de YouTube necesitaba `self` en su caja de arena. **Pendiente:** reiniciar `npm run lab`. El laboratorio que estaba en marcha (pid 4487, de otra sesión) ya recarga estas listas, pero sin permisos por lista ni la comprobación cada 30 min. No se probó en la TV.

2026-10-23 (cont.): laboratorio reiniciado con el código del seguimiento de Brave tras comprobar que no había pruebas ni otros inspectores en la TV (solo el laboratorio pid 4487 y el servidor). Nuevo proceso desacoplado `start-lab.mjs` pid 7203, conectado de forma pasiva; registro en `.local/logs/lab.log`; Google conservado. En ese momento Luma figuraba abierta pero con la página `about:blank` (posiblemente en segundo plano). No se navegó ni relanzó para no desplazar otra app.

