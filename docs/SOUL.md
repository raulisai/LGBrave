# SOUL · Luma Browser Lab

**Lee solo este archivo al empezar.** Es el resumen vivo del proyecto: qué es, qué hay hecho, qué falta, reglas y dónde mirar. El detalle histórico está en `docs/SEMILLA.md`; abrirlo únicamente si este archivo no basta.

**Cómo mantenerlo (obligatorio):** al terminar cualquier ajuste, actualizar aquí (1) la tabla de estado si cambió una característica, (2) «Pendiente», (3) versión/fecha, (4) una línea en «Últimos cambios» (máx. 8; borrar las más viejas). Detalles largos van a `docs/SEMILLA.md` o a un informe en `docs/`. Sin secretos, sin llaves, sin passphrases. Separar siempre lo probado en TV, lo probado solo en Mac/escritorio y lo no probado.

Actualizado: 2026-10-23 (05:10) · Código: **0.8.0** (`package.json`, IPK aligerada) · Instalado en TV: **0.8.0 aligerada de 03:31** (sin categorías editables; IPK de 03:37 con categorías editables instalado y abierto, laboratorio reiniciado, migración real hecha (4/4/5); el puente pasivo reconectó, el aspecto en pantalla lo confirma el usuario).

## Qué es

Navegador para una LG 75UR8750PSA (webOS 25, Chromium 120, interfaz 1920×1080) hecho con Svelte 5 + Vite 8, empaquetado como IPK `com.lgapp.lab`. Interfaz estilo Safari/vidrio oscuro; bloqueo de anuncios con el motor de Brave (`adblock-rs`) que corre **en el Mac** y controla la TV por CDP (modo «asistido por Mac»). Sin el Mac conectado la app navega pero sin filtrado. Español y lenguaje sencillo con el usuario.

## Características actuales

| Área | Estado | Notas clave |
| --- | --- | --- |
| Inicio | Hecho (0.7.x) | Saludo, buscador en píldora, filas por categoría con mosaicos de cristal y «Agregar»; fondo elegible (calle / cañón) y oscurecer 0-90 % (def. 35 %) en Configuración, guardado en localStorage de la TV (`luma-wallpaper`, `luma-dim`) |
| Marcadores | Hecho | Categorías del dueño por defecto **Anime / Películas / Doramas** (14 páginas semilla, `bookmarksVersion` 2), editables: añadir, renombrar y eliminar cualquiera (máx. 8; las vacías se conservan; eliminar quita sus marcadores), guardados en el Mac `.local/browser-settings.json`; una URL puede estar en varias categorías; estrella de la barra abre menú de categorías; Editar (lápiz) quita; diálogo «Nuevo marcador» |
| Limpiar anuncios (✦) | Hecho en código, **probado en Mac/escritorio, no en TV** | Botón ✦ junto a la estrella. El Mac escanea todos los marcos en mundos aislados, consulta el motor de Brave (iframes/enlaces/imágenes) y pistas (nombres `ad-slot`/`adsbygoogle`, etiquetas «Publicidad/Patrocinado», tamaños IAB, muros «desactiva tu bloqueador»). Solo oculta (reversible con Deshacer), nunca `main`/h1/menús/formularios/vídeos no confirmados ni bloques grandes. Recuerda selectores seguros por sitio en `.local/cleaner-rules.json` (CSS al inicio del documento). `scripts/ad-cleaner.mjs`, `test-ad-cleaner.mjs` |
| Barra de páginas | Hecho | Vidrio oscuro flotante, se oculta sola, vuelve con puntero/franja de 40 px arriba, Arriba o teclas de color; no tapa la carga |
| Pestañas (0.8.0) | Hecho en código, **no validado en TV** | Hasta 12, suspendidas (una activa, recarga al cambiar), historial por pestaña en memoria; ver `docs/TABS.md`. **Reanudar vídeo** (código del Mac, sin instalar IPK, pendiente de reiniciar `npm run lab` y probar en TV): guarda el segundo del vídeo (también en iframes) y lo repone al volver. **Pestañas paralelas reales imposibles en esta TV** (prueba 2026-10-23) |
| Buscador | Hecho | Google (def.), Bing, DuckDuckGo, Brave; persistente en el Mac; resolver único `src/navigation.js` |
| Bloqueo | Hecho, límites | EasyList/Privacy + 5 listas más (`research/lists/`), reglas propias (`scripts/shields.mjs`), escudo YouTube, escudo de ventanas/QR Cuevana y JKAnime (`scripts/navigation-shield.mjs`). No equivale a Brave completo ni garantiza «cero anuncios» |
| Verificación Cloudflare | Hecho en código, **probado en TV** (carga sin cierre; falta que el usuario marque casillas y reproduzca) | Nunca se filtra ni se responde. Página de verificación (403 + `cf-mitigated: challenge`) se muestra, no es error. Widgets Turnstile en formularios ocultos se aplazan hasta mostrarse (`scripts/turnstile-defer.mjs`, siempre activo). Ver `docs/TURNSTILE-FIX.md` |
| Conexión | Hecho | Runtime **pasivo** (`start-lab`, `inspector-tunnel`, `lab-runtime`): nunca lanza Luma ni usa `ares-inspect` |
| Chip de diagnóstico | Oculto | Solo con `LUMA_DEBUG=1 npm run lab` |
| Control remoto | Hecho | Navegación espacial 2D (`src/spatial.js`), Back/Esc, teclas de color |

## Pendiente (prioridad)

0. Usuario: en AnimeOnline Ninja marcar «Verifique que es un ser humano» y confirmar que entra y reproduce; reproducir en AnimeYT (clic «verifica que eres humano» del reproductor) y AsiaLiveAction. Abrir «Cuenta» en AnimeYT carga un desafío: no probado si aguanta.
0. Tras reiniciar la TV: medir memoria con `npx --no-install ares-device -r --device lg-lab` antes y después de usar Luma/vídeo para confirmar si la app o la TV acumula memoria.
0. Reiniciar `npm run lab` (cuando ninguna otra sesión use la TV) para cargar el botón ✦ y probarlo en la TV con una página con anuncios; no necesita reinstalar el IPK.
1. Instalar y validar 0.8.0 en TV **sin concurrencia** (otro chat «Arquitect Main» tenía pruebas activas; confirmar con el usuario). Revisar en pantalla: pestañas, fondo/oscurecer, Agregar con teclado de la TV, Editar, estrella con categorías.
2. Prueba física pospuesta por el usuario: abrir Luma→otra app (Pluto) y apagar/encender con el runtime pasivo corregido. No afirmar que está hecha.
3. Commit: todo desde la base `003dcae` (0.5.0) está **sin commit** (0.5.1…0.8.0).
4. Bug abierto: tras error por tiempo de espera, el inicio no muestra el mensaje «tardando» (paso final de `validate-navigation`).
5. Mejoras propuestas (`docs/PLAN-MEJORAS.md`): diagnóstico de conexión/espacio, una sola instancia de pruebas, separar servidor de fixtures, medir más sitios, actualización periódica de listas.
6. Investigación lejana (no empezar sin pedirlo): autonomía sin Mac, webOS OSE, DNS. Sin ruta validada; **no** flasheo.

## Reglas que no se rompen

- No tocar firmware, arranque, particiones ni DNS. Sin root.
- Un solo interceptor/prueba que navegue la TV a la vez; antes de probar revisar `ps`, IP del Mac/TV y `git status` (puede haber otro agente). Los puertos guardados no son estado vivo.
- No navegar al Inicio ni cerrar la página si el usuario está usando la TV. Al terminar pruebas: restaurar sesión, buscador **Google** y dejar un solo runtime pasivo (`npm run lab`).
- Cambios de filtrado/guardia/preferencias corren en el Mac: reiniciar `npm run lab`. Cambios de UI requieren `npm run package` + instalar IPK + `npm run tv:launch`.
- WAM: no registrar scripts con `Page.addScriptToEvaluateOnNewDocument` dentro de `Fetch.requestPaused`; bloquear subrecursos con respuesta vacía 200 (no 204 ni fallo directo, salvo cancelar navegación con `Aborted`). La barra no usa `innerHTML` (Trusted Types).
- Honestidad: no prometer cero publicidad ni equivalencia con Brave; cifras controladas ≠ Internet.

## Mapa mínimo

| Qué | Dónde |
| --- | --- |
| UI inicio/Configuración/diálogos | `src/App.svelte` (+ `Icon.svelte`, `icons.js`, `spatial.js`, `NavigationFeedback.svelte`) |
| Barra y menú de estrella en páginas | `scripts/toolbar.mjs` |
| Limpiador de anuncios (✦) | `scripts/ad-cleaner.mjs` (página + reglas aprendidas), comandos `clean-ads`/`clean-undo` en `browser-bridge.mjs` |
| Puente CDP, comandos, estado | `scripts/browser-bridge.mjs`, `browser-tabs.mjs`, `cdp.mjs` |
| Preferencias y marcadores | `scripts/preferences.mjs` |
| Filtros y reglas | `scripts/filter-engine.mjs`, `shields.mjs`, `navigation-shield.mjs`, `player-assist.mjs`, `turnstile-defer.mjs`, `research/lists/` |
| Conexión/ciclo | `scripts/start-lab.mjs`, `lab-runtime.mjs`, `inspector-tunnel.mjs`, `runtime-lock.mjs` |
| Servidor del inicio y fixtures | `scripts/fixture-server.mjs` (43187/43188) |
| Pruebas | `npm test` (locales, sin TV); `scripts/validate-*.mjs` (con TV, ver SEMILLA «Operación y pruebas») |
| Informes | `docs/` (`TABS`, `TURNSTILE-FIX`, `CUEVANA-`, `JKANIME-VALIDATION`, `PASSIVE-CONNECTION-FIX`, `NAVIGATION-FIX`, `BROWSER-VALIDATION`) |
| Fondos | `public/bg-street.jpg`, `public/bg-canyon.jpg` |
| Volver atrás | IPKs anteriores en `artifacts/` (`ares-install --device lg-lab artifacts/…ipk`) |

## Comandos esenciales

```sh
npm test                 # pruebas locales
npm run package          # build + IPK en artifacts/
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_<versión>_all.ipk
npm run tv:launch        # solo si el usuario lo autoriza
npm run lab:server       # servidor del inicio (otra terminal)
npm run lab              # puente pasivo (LUMA_DEBUG=1 para ver el chip)
```

Entorno: TV `192.168.1.134`, Mac `192.168.1.148` (cambian; comprobar), perfil CLI `lg-lab`, llave fuera del proyecto. Node 22, macOS arm64.

## Últimos cambios

- 2026-10-23 05:10 — **Turnstile resuelto en TV (carga sin cierres).** Medido en TV: al cargar el iframe de Turnstile muere **todo WebAppMgr** (proceso principal con GPU en proceso + renderizadores) y webOS lo reinicia; no es JS ni WebGL solo. Causa: AnimeYT (6) y AsiaLiveAction (4) arrancan widgets Turnstile de sus formularios de cuenta **ocultos** al cargar; AnimeOnline Ninja es la página de verificación (403 + `cf-mitigated`) que Luma tapaba con su error 403. Arreglos: `isChallengeResponse` en el puente y `scripts/turnstile-defer.mjs` (aplaza widgets ocultos hasta que se muestran; nada se bloquea ni responde). TV con puente nuevo: AnimeYT inicio/episodio, AsiaLiveAction inicio/episodio y AnimeOnline Ninja (casilla visible) vivos 40–60 s. `npm test` (+`test-turnstile-defer`, 34 del puente). Lab reiniciado con el código nuevo, Luma en Inicio, buscador Google. Detalle: `docs/TURNSTILE-FIX.md`.
- 2026-10-23 04:25 — **Mitigaciones de Turnstile probadas en TV (AnimeYT), todas fallan.** Con Turnstile cargando (confirmado por la petición): bloquear imágenes/fuentes/vídeo/anuncios + caché desactivada → cierre ~15 s después; + GC/`Memory.simulatePressureNotification` cada 1,5 s → cierre ~14 s; + viewport 960×540 → cierre ~3 s. Solo sobrevive bloqueando `challenges.cloudflare.com` (no aceptable). Sin cambios de código; Luma y laboratorio restaurados (estable). Pendiente: aviso previo o descartar esos sitios en esta TV.
- 2026-10-23 04:05 — **Prueba en TV (recién reiniciada, sin concurrencia): Turnstile cierra la app, no el puente.** Arnés en scratchpad (relanza Luma entre pruebas). AnimeYT: sin puente ni Fetch (`Page.navigate` crudo) → app cerrada a ~23 s; con puente → cerrada a ~8 s; sin puente pero con `challenges.cloudflare.com` bloqueado (solo diagnóstico) → **viva 60 s** (memoria libre 39 MB, disponible 140 MB con la página abierta). Conclusión: el iframe/recursos de Cloudflare Turnstile agotan la memoria de la app/WAM y webOS la termina; no es filtrado ni fuga de JS. No se filtra Turnstile (regla del usuario). Mitigaciones no probadas: aviso previo, o abrir esos sitios solo con TV recién reiniciada. Lab restaurado.
- 2026-10-23 03:45 — **Cierres en AnimeYT / AnimeOnline Ninja (solo diagnóstico, sin cambios de código).** `flight.log`: ambos sitios (y repelishd antes) cargan **Cloudflare Turnstile** y la app muere; AnimeYT termina en la petición a `challenges.cloudflare.com` sin CRASH/DETACHED (app terminada por webOS); AnimeOnline entra en bucle 403 → Turnstile → recarga → 403 (el desafío no se supera) hasta volver al Inicio. JKAnime (sin Turnstile en la entrada) carga. Sin muestras de memoria JS (no crece ≥20 MB) → apunta a memoria nativa de la TV: libre 67–104 MB, disponible ~170–220 MB, swap 384–510 MB, CPU 85 % durante la carga. **Causa no confirmada.** Pendiente: reiniciar la TV y probar AnimeYT sin concurrencia; si sigue, probar con el puente sin interceptar (Fetch) en el dominio.
- 2026-10-23 03:36 — **Marcadores del dueño y categorías editables.** Semilla: Anime (animeyt, animeonline.ninja, jkanime, asialiveaction), Películas (cuevana3c, repelishd, framextv, onlyflix), Doramas (doramasflix .io/.beer/.in, doramasia, doramasmp4). `preferences.mjs`: categorías explícitas + `addCategory/renameCategory/removeCategory`; comandos del puente `add-category`/`rename-category`/`remove-category`; migración v1→v2 (probada en copia de `.local/browser-settings.json`: sustituye los ejemplos viejos por las 14 páginas). UI en modo editar: lápiz/menos junto a cada categoría y «Nueva categoría». `npm test` (31 del puente) y simulación en navegador de escritorio OK; **sin instalar ni probar en TV; la migración real ocurre al reiniciar `npm run lab`**.
- 2026-10-23 03:30 — **Aligerar TV/inicio.** Revisión con la TV (`ares-launch -r`, `ares-install -l`, `ares-device -r -l`): lo único nuestro es `com.lgapp.lab`, sin servicios propios en segundo plano; las apps del sistema LG no se tocan (sin root). TV con ~190 MB libres de 1,25 GB y swap ~480 MB. Cambios (instalado en TV 03:31 y puente reconectado; falta que el usuario confirme visualmente; memoria libre justo tras abrir ~33 MB, disponible ~166 MB): fuera `native-engine.js`, `adblock.wasm`, `native-filters.txt` y licencias de `public/` (copias en `.local/removed-from-ipk/`; `npm run build:native` las regenera; `validate:native` ya no sirve) y quitado el botón «Validar motor local»; sin `backdrop-filter` en pestañas/botones/buscador (fondos más opacos; queda solo en diálogos) y sin animaciones de entrada escalonadas. IPK 3,1→1,2 MB. `npm test` pasa.
- 2026-10-23 — **Repelishd resuelto en TV.** Diagnóstico con arnés propio (relanzando la app entre pruebas): el cierre ocurre con el servidor 1 de PlayLatinSrc (Dropload/dr0pstream → verificación Cloudflare Turnstile) y con UnlimPlay; **también sin el puente** (navegación CDP cruda), así que no es filtrado de Luma ni `window.open`. Es un cierre de la app web en WAM (webOS 25, 1.25 GB RAM, ~180 MB disponibles), no determinista con la demo de Turnstile y constante con la cadena real; el navegador nativo de LG sí abre la demo. Causa interna no establecida (se descartaron encabezados COEP/COOP/OAC/Document-Policy/Critical-CH/Permissions-Policy aislados). Servidor 3 (**Mixdrop**) reproduce: vídeo real 9052 s, `readyState 4`, avanzando (t=26 s), sin cierre; Doodstream intenta navegar la página superior (bloqueado); el clic no inicia Mixdrop pero `video.play()` sí. Solución: `scripts/player-assist.mjs` (inyectado junto a `navigation-shield.mjs`): en `playlatinsrc.co` reordena servidores (Mixdrop primero, riesgosos Dropload/dr0pstream/UnlimPlay al final marcados «· puede cerrar la app», no ocultos ni bloqueados) y en iframes de Mixdrop un clic/OK/Espacio llama a `play()`. Prueba de extremo a extremo en TV: Play → Mixdrop automático → segundo clic → vídeo avanzando. `npm test` incluye `test-player-assist.mjs`. Lab restaurado (`npm run lab`). Limitaciones: depende de que Mixdrop siga activo para cada título; otros sitios con Turnstile pueden cerrar la app igual (la verificación Cloudflare **no** se filtra, por indicación del usuario). La «caja negra» `flight.log` sigue activa.
- 2026-10-23 — La prueba «sin puente» era inviable: sin el Mac, Inicio no puede navegar (error «reconectando con el Mac», comportamiento esperado). Lab reiniciado. Regla nueva por indicación del usuario: **la verificación «no soy un robot» (`challenges.cloudflare.com`) no es publicidad y no se filtra ni se toca**: `isHumanVerification` en `browser-bridge.mjs` (sin Fetch.enable en su iframe, sin motor) y el guardia no actúa allí. Hipótesis a probar en TV: la intercepción del iframe anidado de Turnstile provocaba el cierre. Con el puente conectado, el usuario debe ver el puzle y resolverlo. Sin probar en TV.
