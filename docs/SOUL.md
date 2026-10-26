# SOUL · Luma Browser Lab

**Lee solo este archivo al empezar.** Es el resumen vivo del proyecto: qué es, qué hay hecho, qué falta, reglas y dónde mirar. El detalle histórico está en `docs/SEMILLA.md`; abrirlo únicamente si este archivo no basta.

**Cómo mantenerlo (obligatorio):** al terminar cualquier ajuste, actualizar aquí (1) la tabla de estado si cambió una característica, (2) «Pendiente», (3) versión/fecha, (4) una línea en «Últimos cambios» (máx. 8; borrar las más viejas). Detalles largos van a `docs/SEMILLA.md` o a un informe en `docs/`. Sin secretos, sin llaves, sin passphrases. Separar siempre lo probado en TV, lo probado solo en Mac/escritorio y lo no probado.

Actualizado: 2026-10-25 · Código: **0.9.3 paquete/Holy, 0.9.2 Luma TV y fuente EXE**, Windows + macOS, Holy + Luma. TV instalada: **0.8.0** según último registro; no se instalaron los IPK nuevos en esta revisión. Guías: `docs/WINDOWS.md`, `docs/VALIDACION-DOS-EQUIPOS.md`.

## Qué es

Navegador para una LG 75UR8750PSA (webOS 25, Chromium 120, interfaz 1920×1080) hecho con Svelte 5 + Vite 8, empaquetado como IPK `com.lgapp.lab`. Interfaz estilo Safari/vidrio oscuro; bloqueo con el motor de Brave (`adblock-rs`) que corre **en Windows o Mac** y controla la TV por CDP. Sin computadora conectada Luma navega sin filtrado. Holy (`com.lgapp.holy`, interfaz de catálogo) se incorporó desde `origin/holy` sin sustituir Luma; requiere la computadora para catálogo y reproducción asistida. Español y lenguaje sencillo con el usuario.

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
| Páginas protegidas | **13/13 marcadores abren en TV** (medido 06:00, 28 s cada uno, sin cierres) | `devtools-quiet.mjs` (consola inerte: evita expulsión por `disable-devtool`, caso FrameXTV), escudo de ventanas en los 13 sitios, `crash-memory.mjs` (`.local/crash-sites.json`: cierres durante la carga; 2 seguidos → `riskySites` y ⚠ en el mosaico, línea `CIERRE` en flight.log). **Medido solo carga de portada**, no reproducción de cada sitio |
| Verificación Cloudflare | Hecho en código, **probado en TV** (carga sin cierre; falta que el usuario marque casillas y reproduzca) | Nunca se filtra ni se responde. Página de verificación (403 + `cf-mitigated: challenge`) se muestra, no es error. Widgets Turnstile en formularios ocultos se aplazan hasta mostrarse (`scripts/turnstile-defer.mjs`, siempre activo). Ver `docs/TURNSTILE-FIX.md` |
| Conexión | Catálogo desde Windows confirmado por el usuario con Mac apagada; relevo físico de ida y vuelta pendiente | Servicio común pasivo, Holy primero/Luma alternativa. Reserva SSH, keepalive, reloj monotónico y vigilante; cancelación de conexiones tardías y candado local atómico. Después reaparecieron dos conexiones heredadas del inspector desde .102: Windows espera sin terminar sesiones ajenas. Actualizar ambos equipos. |
| Panel Windows / Holy | EXE 0.9.1 instalado y vivo; código 0.9.2 compilado, actualización bloqueada por Device Guard | Bandeja, estado vivo y arranque al iniciar sesión activado. El instalador comprueba el binario antes de reemplazar el anterior. Correcciones de instancia única/errores/cierre en código; no se eludió la política. Reinicio físico pendiente. |
| Holy · categorías | Código 0.9.2, probado localmente en Windows; TV pendiente | Géneros enlazables en Inicio/Películas/Anime/Doramas/Series tras recomendaciones; categoría con novedades, gustos, vistas locales, valoraciones del sitio, clásicas, todo y selecciones AFI/BFI verificadas. Solo filas con datos; sin audiencia global inventada. Flecha izquierda desde primera tarjeta + OK o clic en título; Atrás conserva posición. `docs/HOLY-PLAYBACK-CATEGORIES.md` |
| Holy · fallos de vídeo | Código 0.9.2, pruebas controladas en Windows; TV pendiente | `.local/logs/holy-playback.jsonl`, rotación 1 MiB + respaldo, fechas/título/segundo/estado de vídeo y recuperación, sin tokens de URL. `npm run holy:errors`. Detecta atasco, desaparición y MediaError; rescate existente ampliado con una recarga por sesión y reintento de reanudación aplazada. No reconstruye el fallo de ayer. |
| Perfil entre equipos | Código y 11 pruebas simuladas; SFTP real disponible; relevo físico pendiente | Caché temporal autenticada en TV, preferencias y biblioteca con mezcla por fecha/borrados, respaldo `.before-sync`, validación y reintento tras fallo temporal. Copias locales persistentes; `/tmp` se pierde al reiniciar TV. Metadatos públicos del vídeo para adoptar seguimiento sin navegar. |
| Chip de diagnóstico | Oculto | Solo con `LUMA_DEBUG=1 npm run lab` |
| Control remoto | Hecho | Navegación espacial 2D (`src/spatial.js`), Back/Esc, teclas de color |

## Pendiente (prioridad)

0. Revisión del otro chat integrada en código: diagnóstico por sesión, gustos combinados y Top 100 AniList hasta 2006. `test-holy-next`, `npm test` y ambos builds pasan en Windows; la interfaz de TV y reproducción prolongada siguen pendientes. No se instaló IPK.

0. Holy 0.9.3: instalar IPK y validar géneros, vídeo prolongado y logs reales sin otra prueba concurrente. El estado setup del otro chat era anterior: perfil Windows vinculado, SSH/SFTP comprobados, catálogo confirmado por usuario; al cierre Windows espera conexiones heredadas del inspector. Faltan rankings completos/globales; las selecciones AFI/BFI son subconjuntos fechados.

0. Windows: permitir una distribución firmada/autorizada del EXE 0.9.2 bajo la política Device Guard, sin desactivar la protección. Se conserva 0.9.1 e inicio automático. Verificar reinicio físico de Windows; actualizar/compilar el Mac y probar relevo físico Mac→Windows→Mac y vídeo. Las sesiones antiguas no respetan reservas/keepalive nuevos.
0. Reproducir un episodio en cada sitio nuevo (framextv, onlyflix, doramas*) y anotar fallos.
0. Usuario: en AnimeOnline Ninja marcar «Verifique que es un ser humano» y confirmar que entra y reproduce; reproducir en AnimeYT (clic «verifica que eres humano» del reproductor) y AsiaLiveAction. Abrir «Cuenta» en AnimeYT carga un desafío: no probado si aguanta.
0. Tras reiniciar la TV: medir memoria con `npx --no-install ares-device -r --device lg-lab` antes y después de usar Luma/vídeo para confirmar si la app o la TV acumula memoria.
0. Probar ✦ en TV con anuncios cuando el usuario no esté navegando; usar el servicio común actual. No ejecutar `npm run lab` simultáneamente.
1. Instalar y validar el IPK actual en TV sin concurrencia: pestañas, fondo, Agregar con teclado, Editar y categorías. No cambiar la sesión del usuario durante la revisión.
2. Prueba física pospuesta por el usuario: abrir Luma→otra app (Pluto) y apagar/encender con el runtime pasivo corregido. No afirmar que está hecha.
3. Publicación autorizada por el usuario: todos los cambios de código y documentación van al repositorio GitHub; `.local`, credenciales y dependencias quedan excluidos. Consultar Git para el commit y su sincronización.
4. Bug abierto: tras error por tiempo de espera, el inicio no muestra el mensaje «tardando» (paso final de `validate-navigation`).
5. Mejoras propuestas (`docs/PLAN-MEJORAS.md`): diagnóstico de conexión/espacio, una sola instancia de pruebas, separar servidor de fixtures, medir más sitios, actualización periódica de listas.
6. Investigación lejana (no empezar sin pedirlo): autonomía sin computadora, webOS OSE, DNS. Sin ruta validada; **no** flasheo.

## Reglas que no se rompen

- No tocar firmware, arranque, particiones ni DNS. Sin root.
- Un solo interceptor/prueba que navegue la TV a la vez; antes de probar revisar `ps`, IP del Mac/TV y `git status` (puede haber otro agente). Los puertos guardados no son estado vivo.
- No navegar al Inicio ni cerrar la página si el usuario está usando la TV. Al terminar pruebas: restaurar sesión, buscador **Google** y dejar un solo runtime pasivo (servicio común `npm run desktop:start`; ruta anterior `npm run lab` excluyente).
- Cambios de filtrado/guardia/preferencias corren en la computadora activa: `npm run desktop:restart` (o reiniciar `npm run lab` si se usa la ruta anterior). Cambios de UI requieren `npm run package` + instalar IPK + `npm run tv:launch`.
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
| Filtros y reglas | `scripts/filter-engine.mjs`, `shields.mjs`, `navigation-shield.mjs`, `player-assist.mjs`, `turnstile-defer.mjs`, `devtools-quiet.mjs`, `crash-memory.mjs`, `research/lists/` |
| Conexión/ciclo Windows y Mac | `desktop/shared/desktop-{config,control,supervisor,host}.mjs`; entradas compatibles `scripts/desktop-*.mjs`; `scripts/tv-lease.mjs`, `lab-runtime.mjs`, `inspector-tunnel.mjs`, `runtime-lock.mjs`. Mapa: `desktop/README.md` |
| Diagnóstico de vídeo / categorías Holy | `scripts/holy/playback-log.mjs`, `playback-report.mjs`, `holy-bridge.mjs`, `page-scripts.mjs`; `src/holy.js`, `holy-curation.js`, `Holy.svelte`; `scripts/test-holy-discovery.mjs`; `docs/HOLY-PLAYBACK-CATEGORIES.md` |
| Reparación de escritorio | `desktop/shared/desktop-repair.mjs`, `profile-recovery.mjs`, `scripts/test-desktop-repair.mjs`; `npm run desktop:repair`; botón Doctor · Reparar en código del EXE nuevo, ejecución bloqueada por Device Guard |
| Perfil compartido | `desktop/shared/profile-state.mjs`, `tv-profile-store.mjs`, `scripts/holy/handoff.mjs`, `taste-state.mjs`; pruebas `test-profile-handoff.mjs`, `test-tv-profile-store.mjs` |
| Holy integrado | `src/Holy.svelte`, `src/holy.js`, `scripts/holy/` (catálogo, conectores, biblioteca, puente, servidor, doctor) |
| Control de Windows y guía | `windows/HolyLuma.cs`, `scripts/install-windows-app.mjs`, `scripts/windows-tray.mjs`; `Link-TV.ps1`, `Autostart.ps1`, `Preparar.ps1`; `docs/WINDOWS.md` |
| Servidor del inicio y fixtures | `scripts/fixture-server.mjs` (43187/43188) |
| Pruebas | `npm test` (locales, sin TV); `scripts/validate-*.mjs` (con TV, ver SEMILLA «Operación y pruebas») |
| Informes | `docs/` (`TABS`, `TURNSTILE-FIX`, `CUEVANA-`, `JKANIME-VALIDATION`, `PASSIVE-CONNECTION-FIX`, `NAVIGATION-FIX`, `BROWSER-VALIDATION`) |
| Fondos | `public/bg-street.jpg`, `public/bg-canyon.jpg` |
| Volver atrás | IPKs anteriores en `artifacts/` (`ares-install --device lg-lab artifacts/…ipk`) |

## Comandos esenciales

```sh
npm test                 # pruebas locales
npm run desktop:start    # Windows/Mac: ambos navegadores, segundo plano
npm run desktop:status   # estado vivo
npm run desktop:doctor   # diagnóstico
npm run desktop:stop     # detener el servicio común
npm run build:all        # inicios Luma + Holy
npm run package:holy     # IPK Holy
npm run package          # build + IPK en artifacts/
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_<versión>_all.ipk
npm run tv:launch        # solo si el usuario lo autoriza
npm run lab:server       # servidor del inicio (otra terminal)
npm run lab              # puente pasivo con supervisor (LUMA_DEBUG=1 para ver el chip)
```

Entorno comprobado 2026-10-25: Windows Wi-Fi `192.168.1.65`, TV `192.168.1.134`, perfil `lg-lab` autenticado; SFTP disponible. Usuario confirmó catálogo desde Windows con Mac apagada. Después: dos conexiones del inspector por SSH desde .102 (host sin respuesta TCP 22/43190); servicio Windows espera sin segunda intercepción. EXE instalado 0.9.1 vivo; actualización 0.9.2 bloqueada por Device Guard. Mac .148 histórico, no válido como estado vivo. Node 24.21 en Windows; Mac sin probar hoy. Llaves fuera del proyecto.

## Últimos cambios

- 2026-10-25 — **Revisión Windows/Mac y Holy 0.9.3: relevo y organización.** `desktop/shared/` común, nativos separados, candados/reserva/keepalive y cancelación robustos; corrección del inicio antiguo de Holy atado a IP Mac, catálogo recuperado y confirmado por usuario desde Windows. Perfil por SFTP, gustos/historial por fecha y borrados, respaldo/reintento; adopción pasiva de vídeo. Pruebas locales, procesos, host HTTP y builds correctos; SFTP TV disponible. Al cierre espera por dos sesiones heredadas; no se navega TV. EXE nuevo compilado pero Device Guard bloquea ejecución: se conserva app 0.9.1. Relevo físico completo/Mac/reinicio Windows/IPK pendientes. Detalle `docs/VALIDACION-DOS-EQUIPOS.md`; publicación GitHub solicitada.

- 2026-10-25 — **Holy 0.9.2: registro persistente de fallos de vídeo, recuperación ampliada y categorías navegables.** Logs JSONL rotados, red/MediaError/atascos/desaparición y resultado de rescates, sin URLs con tokens; `holy:errors`. Recarga única si no hay alternativa, reanudación aplazada y pausas respetadas. Géneros tras recomendaciones en todas las secciones y vista filtrada con novedades, vistas locales, valoraciones, clásicas y selecciones AFI/BFI con año. `npm test` y build/IPK correctos en Windows, **sin prueba ni instalación en TV**. Servicio reporta falta de vinculación local; sesión/buscador intactos. Detalle: `docs/HOLY-PLAYBACK-CATEGORIES.md`.

- 2026-10-25 — **Escritorio 0.9.1: aplicación nativa de Windows instalada.** `windows/HolyLuma.cs` → `%LOCALAPPDATA%/Programs/HolyLuma/HolyLuma.exe`, icono LG y semáforo de conexión, estado cada 4 s, panel/menú, controles y configuración sin consola. Accesos en menú Inicio e Inicio de sesión; **arranque automático activado** por petición del usuario. Instalador `npm run windows:install` con autoprueba WinForms y lectura de estado real; proceso nativo vivo, actualizaciones periódicas y segunda apertura sin duplicados comprobados. Reinicio real y confirmación visual del usuario pendientes. Servicio conserva la sesión y espera si otro inspector ocupa la TV; sin navegación de TV en este ajuste.

- 2026-10-25 — **0.9.0 Windows + Mac, Holy y Luma**: servicio común, bandeja WinForms, configuración/vinculación oficial, control por IPC, selección Holy/Luma, reserva SSH entre equipos y espera ante inspector ocupado. Holy importado de `origin/holy` junto a Luma, builds/IPK separados; rutas de archivos y CLI compatibles con Windows, filtros incluidos como respaldo de generaciones ausentes. `npm test`, procesos con hijo simulado, host real sin TV, panel WinForms y ambos IPK generados. Windows vinculado: modelo leído por SSH; otro inspector detectado, sin segunda intercepción. Relevo físico, interacción visual y reproducción desde Windows pendientes. Guía y límites: `docs/WINDOWS.md`.

- 2026-10-23 — **Acceso directo en la barra de menú del Mac**: `mac/build.sh` compila `~/Applications/Luma LG.app` (punto de color + «LG»; menú con estado, Encender/Apagar, Reiniciar, Ver registro). Lógica en `scripts/luma-control.mjs` (`status|start|stop|restart`, Node puro, pensado para reutilizar en Windows); `start-lab.mjs` escribe `.local/lab-status.json`. Probado: ciclo start/stop/restart y clic en «Apagar» desde el menú. No visto en pantalla (sin permiso de captura). **Pendiente:** Windows (bandeja del sistema que llame a `luma-control.mjs`, `ps` de `parentOf/commandOf` a sustituir), abrir al iniciar sesión, icono propio.

- 2026-10-23 15:05 — **El laboratorio ya no muere si la TV deja de responder.** A las 13:58 `npm run lab` terminó por `Callback was already called` (herramientas de webOS tras `read ETIMEDOUT`). Copiada la solución de la rama `holy`: `scripts/crash-guard.mjs` (absorbe solo errores de conexión con la TV; cualquier otro sale con código 1) instalada al inicio de `start-lab.mjs`, y `scripts/lab-supervisor.mjs` (ahora `npm run lab`) que lo reinicia (2 s; 30 s tras 5 fallos en un minuto), se apaga con Ctrl-C y no reintenta si ya hay otro laboratorio (código 2). `npm test` + `test-crash-guard.mjs`. Probado solo en el Mac (reinicio y Ctrl-C con un hijo falso); **no reiniciado**: Holy estaba en uso.

- 2026-10-23 06:00 — **Revisión completa de los 13 marcadores.** Medición en TV con el puente real: 12/13 abrían; fallaba `framextv.xyz` (→`framextv.cc`) porque usa `disable-devtool` y se expulsaba a `about:blank` al notar el inspector. Parches: `devtools-quiet.mjs` (console inerte en páginas web), escudo de ventanas ampliado a los 13 sitios, `crash-memory.mjs` + aviso ⚠ en mosaicos (UI: IPK sin instalar), `isChallengeResponse`, `turnstile-defer`. Repetición final: 13/13 abren (AnimeOnline Ninja muestra la casilla de Cloudflare, esperado). `npm test` ampliado (36 del puente, devtools-quiet, crash-memory). Lab y Luma restaurados, buscador Google. Detalle: `docs/TURNSTILE-FIX.md`.

- 2026-10-23 05:10 — **Turnstile resuelto en TV (carga sin cierres).** Medido en TV: al cargar el iframe de Turnstile muere **todo WebAppMgr** (proceso principal con GPU en proceso + renderizadores) y webOS lo reinicia; no es JS ni WebGL solo. Causa: AnimeYT (6) y AsiaLiveAction (4) arrancan widgets Turnstile de sus formularios de cuenta **ocultos** al cargar; AnimeOnline Ninja es la página de verificación (403 + `cf-mitigated`) que Luma tapaba con su error 403. Arreglos: `isChallengeResponse` en el puente y `scripts/turnstile-defer.mjs` (aplaza widgets ocultos hasta que se muestran; nada se bloquea ni responde). TV con puente nuevo: AnimeYT inicio/episodio, AsiaLiveAction inicio/episodio y AnimeOnline Ninja (casilla visible) vivos 40–60 s. `npm test` (+`test-turnstile-defer`, 34 del puente). Lab reiniciado con el código nuevo, Luma en Inicio, buscador Google. Detalle: `docs/TURNSTILE-FIX.md`.
