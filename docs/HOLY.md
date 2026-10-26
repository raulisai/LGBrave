# Holy · informe

Fecha: 2026-10-23. Rama `holy`. App webOS `com.lgapp.holy`, separada de Luma (`com.lgapp.lab`). 0.1.0 se probó en el Mac; **0.2.0 (con buscador) se instaló y probó en la TV** a las 13:00–13:35, sin otras sesiones activas.

## Rama

`holy` parte de un commit que copia exactamente el árbol de trabajo de Luma 0.8.0 tal como estaba sin commit en `main` (índice temporal, sin tocar `main` ni su índice). Se trabaja en `.claude/worktrees/holy`. `main` sigue con sus cambios sin guardar.

## Qué pidió el usuario y qué hay

| Pedido | Estado |
| --- | --- |
| App aparte con el motor de este navegador | Hecho: mismo puente/filtros/escudos; app id, puerto (43190), candado y datos propios |
| UI parecida a Netflix | Hecho: vista previa grande que sigue al foco, filas horizontales, secciones, tarjetas con progreso |
| Arriba lo que quedó a la mitad | Hecho: «Continuar viendo», una tarjeta por serie, «Siguiente» al terminar un episodio |
| Recomendaciones de lo último de Cuevana, RePelis… y los favoritos | Hecho para Cuevana 3, RePelisHD, JKAnime y DoramasMP4 (los favoritos con conector) |
| Secciones películas, doramas, anime | Hecho (+ series de Cuevana) |
| Al dar clic, directo al vídeo, transparente | Hecho en Mac: el Mac resuelve el reproductor; cortina de Holy; autoplay; pantalla completa |
| Recomendar según gustos | Hecho: perfil por géneros/tipo con decaimiento temporal; «Porque viste X»; filas «Porque te gusta: …» |
| «La lista que te voy a enviar» | Pendiente de recibir; ahora se usan los favoritos que ya existían |
| Buscador en todas las páginas, las más rápidas primero | Hecho (0.2.0): los 4 sitios a la vez; cada fila aparece cuando su sitio responde |

## Directo al vídeo, por sitio

| Sitio | Qué abre la TV | Por qué |
| --- | --- | --- |
| Cuevana 3 | El primer servidor del sitio (Latino) en `tungtungsahur.cuevana3c.pro` con `pops=false` | Es la ruta ligera ya validada en TV con Luma 0.7.2 |
| JKAnime | `video[0]` = `jkanime.net/jkplayer/…` (Desu) | Servidor validado en TV (`docs/JKANIME-VALIDATION.md`) |
| RePelisHD | Mixdrop latino de la API de PlayLatinSrc (`/api/embed-links`), con referencia a PlayLatinSrc | Mixdrop fue el único servidor estable en TV; Dropload/dr0pstream y UnlimPlay cargan Turnstile y cierran la app. Si un título solo tiene esos, Holy lo rechaza con un aviso en vez de abrirlo |
| DoramasMP4 | ok.ru `videoembed/…?autoplay=1` | Alojamiento de vídeo simple; el `<video>` vive en shadow DOM |

Si la resolución falla por red (no por seguridad), Holy abre la página del título y el paso automático busca el reproductor allí (Cuevana: primer servidor; JKAnime: iframe del reproductor). RePelisHD nunca usa esa vía.

Nada se descarga ni se reescribe: la TV carga la misma página del reproductor que cargaría el sitio. El motor de Brave y los escudos siguen activos.

## Validación en Mac (`evidence/holy/desktop/validation.json`)

Chrome sin interfaz en el Mac haciendo de TV, puente real de Holy, filtros activos. El título más nuevo de cada sitio; muestras cortas.

| Muestra | Hasta reproducir | Avanza | Atrás → inicio | Posición guardada |
| --- | --- | --- | --- | --- |
| Cuevana · Street Fighter | 7,2 s | Sí (30 s) | Sí | 31 s |
| RePelisHD · Idiots (Mixdrop) | 5,6 s | Sí | Sí | 9 s |
| JKAnime · Hyouken no Majutsushi II ep. 3 | 5,7 s | Sí | Sí | 9 s |
| DoramasMP4 · Till I See You cap. 9 (ok.ru) | 10,8 s | Sí | Sí | 9 s |
| Cuevana · Shaque 1x5 | 3,5 s | Sí | Sí | 8 s |
| Reanudar Street Fighter | 2,5 s | Sí, desde ≥31 s | Sí | 35 s |

Hallazgos durante la prueba:
- La regla de uBlock `||127.0.0.1^$third-party` impedía volver al inicio servido en `127.0.0.1` (solo pasaba en el arnés del Mac). Holy ya no filtra su propio inicio.
- PlayLatinSrc puede ofrecer solo UnlimPlay; por eso Holy consulta su API desde el Mac y elige servidor.
- ok.ru guarda su `<video>` en shadow DOM: el autoplay, el guardado y la reanudación lo buscan ahí.

**No acredita la TV.** WAM puede tratar los iframes, el autoplay y la memoria de forma distinta.

## Pendiente

Ver «Pendiente» en `docs/SOUL.md`. Lo principal: instalar `artifacts/com.lgapp.holy_0.1.0_all.ipk` y repetir el recorrido en la TV cuando nadie más la use.

## Prueba en la TV (`evidence/holy/tv/`)

LG 75UR8750PSA real, `validate-holy-tv.mjs`: un solo proceso (servidor + catálogo + puente pasivo de Holy), vídeo silenciado, historial de prueba en un archivo aparte que se borra. Antes: Luma al frente en su inicio. Después: se reabrió Luma y su laboratorio pasivo se reconectó solo.

| Muestra (segunda pasada completa) | Hasta reproducir | Avanza | Atrás → Holy | Posición guardada |
| --- | --- | --- | --- | --- |
| Cuevana · Street Fighter | 12,7 s | Sí | Sí | 78 s |
| RePelisHD · Idiots (Mixdrop) | 22,4 s | Sí | Sí | 10 s |
| JKAnime · Hyouken II ep. 3 | 11,7 s | Sí | Sí | 11 s |
| DoramasMP4 · Till I See You cap. 9 (ok.ru) | 13,1 s | Sí | Sí | 19 s |
| Cuevana · Shaque 1x5 | 8,5 s | Sí | Sí | 30 s |
| Reanudar Street Fighter | 10,3 s | Sí, desde 78 s | Sí | 84 s |

La app no se cerró en ninguna muestra (dos pasadas completas y dos de búsqueda). Memoria libre de la TV 154 MB antes y 189 MB después en la primera pasada. Cuevana y ok.ru recuerdan su propia posición entre pruebas, por eso algunas muestras no empiezan en 0. Las capturas con vídeo salen negras: la TV dibuja el vídeo en una capa de hardware que no entra en la captura; se mide con la posición del `<video>`.

Primera pasada: un error de medición del validador marcó «no avanza» en tres muestras (leía la posición antes de que el puente la registrara); corregido, las posiciones finales sí avanzaban.

**Buscador en TV** (`search-validation.json`): «one piece» → Tu catálogo 0,2 s, Cuevana 0,4 s (23), RePelisHD 0,7 s (16), JKAnime 0,8 s (22), DoramasMP4 1,2 s (1). OK en One Piece (JKAnime) → 24 bloques de episodios → episodio 1180 reproduciendo en 10,3 s → Atrás a Holy. El texto se escribió por código; falta probar el teclado en pantalla con el control real.

## Holy 0.3.0 · repertorio completo, gustos y resistencia (2026-10-23 15:10)

### Sitios

| Sitio | Lee | Reproductor | Búsqueda | Episodios | Notas |
| --- | --- | --- | --- | --- | --- |
| Cuevana 3 | Inicio | Servidor propio `tungtungsahur` | Sí | Temporadas | — |
| RePelisHD | Inicio | Mixdrop por la API de PlayLatinSrc | Sí | — | Nunca Dropload/UnlimPlay |
| JKAnime | Pestaña «Animes» | `jkplayer` (Desu) | Sí | Lista paginada | Sin pestaña adulta |
| **AnimeYT** | JSON `home/episodes` | Pestañas de Mytsumi: MP4 directo → ok.ru → resto | JSON `catalog/search` | Página de la serie | Sin «sin censura»; Holy nunca abre las páginas de AnimeYT (sus widgets Turnstile ocultos cerraban la app) |
| **DoramasFlix** | Datos «flight» de Next.js | Acción del servidor `getEpisodeLinks`/`getMovieLinks` → host real (ok.ru, Mixdrop, Streamtape, Streamwish…, Voe al final) | Acción `searchQuickAction` | Temporadas | Ids de las acciones se leen de los scripts del sitio (cambian en cada despliegue); espejos .in y doramasia.com |
| DoramasMP4 | Inicio | ok.ru (también dentro del selector pkaa.top) | Sí | Capítulos | — |
| **Asia Live Action** | «Últimos Episodios» | `allVideos`: ok.ru → FM → VK | No (error 520) | Página de la serie | Sinopsis real, no el texto de descarga |

Sin conector: AnimeOnline Ninja (Cloudflare devuelve 403 al Mac), FrameTV (app de solo scripts, en inglés), OnlyFlix (en inglés), DoramasFlix .beer (los reproductores no vienen en la página).

`validate-holy-sites.mjs` (en vivo, `evidence/holy/sites.json`): 7/7 OK — títulos, géneros, dos reproductores por sitio, búsqueda y episodios.

### % de coincidencia y «Gustos»

Señales: lo visto (0,35 + 0,65 × parte vista, mitad cada 21 días, más con repeticiones) y lo calificado (±1,5, mitad cada 180 días). Afinidad por género (repartida entre los géneros del título), tipo y década; gustos escalados 0…1 por el más fuerte y disgustos −1…0 por el más fuerte (un «no me gusta» no apaga los favoritos). Probabilidad = logística de 1,9 × ajuste de género (media + ½ del mejor) + 0,35 × tipo + 0,3 × década + 0,35 × nota del sitio − 0,35, acercada a 50 % con confianza señales/(señales + 4). Sin al menos dos señales no se muestra porcentaje. «Recomendado para ti» = no vistos con ≥55 %, mejor primero.

«Gustos»: filas por los géneros principales del catálogo con títulos sin calificar, fila «Ya calificados» y panel «Tu perfil». OK = me gusta, rojo = no me gusta (otra vez: quitar), amarillo dos veces = borrar lo calificado (lo visto sigue contando).

### Resistencia

- **Caída real encontrada**: a las 13:58 la TV dejó de responder y las herramientas de webOS lanzaron «Callback was already called» fuera de cualquier `try`, matando el proceso de Holy (y el laboratorio de Luma en `main`). Ahora `guard.mjs` lo absorbe y `holy-supervisor.mjs` reinicia el proceso ante cualquier otra caída (2 s; 30 s si falla 5 veces en un minuto).
- Servidores alternos por título y cambio automático si no arranca en 28 s o se atasca 20 s al empezar (en TV, Voe se quedó en 0,9 s).
- Un sitio caído conserva sus títulos; uno colgado se corta a los 45 s sin frenar a los demás.
- Archivos dañados (`holy-library.json`, catálogo) se apartan como `.dañado-<fecha>` y se arranca limpio; datos viejos o raros se normalizan.
- Servidor: 400 a JSON roto o cuerpos de más de 16 KB (sin cortar la conexión), 403 a imágenes de otros hosts y rutas fuera de `dist/`.
- Inicio: peticiones con plazo y un reintento, caché local, títulos sin nombre o imágenes rotas no rompen la pantalla.
- `test-holy-robust.mjs` (12): sitios nuevos, gustos, archivos dañados, sitio colgado, cambio de servidor y atasco, rutas HTTP con datos malos, guardia de caídas en un proceso hijo y fuzz de todos los lectores (250+ páginas basura por sitio, ninguno lanza ni se cuelga). Encontró y corrigió: un «no me gusta» que reducía los gustos, un 70 % para títulos sin géneros en común y el corte de conexión con cuerpos grandes.

### Pruebas en la TV (`evidence/holy/tv/`)

Holy 0.3.0 instalada; TV libre (Holy en su inicio, sin nada reproduciéndose; ninguna otra sesión activa). Vídeo silenciado, historial de prueba aparte y borrado.

| Muestra | Reproductor | Hasta reproducir | Posición (s) | App viva | Atrás |
| --- | --- | --- | --- | --- | --- |
| Cuevana · Street Fighter | tungtungsahur | 14 s | 85→108 | Sí | Sí |
| RePelisHD · Oro sin ley | Mixdrop | 13,4 s | 0→10 | Sí | Sí |
| JKAnime · Tokyo Revengers T4 | jkplayer | 10,1 s | 1→11 | Sí | Sí |
| DoramasMP4 · Pls Love | ok.ru (vía pkaa.top) | 20,2 s | 1→11 | Sí | Sí |
| Cuevana · Shaque 1x5 | tungtungsahur | 9,6 s | 30→40 | Sí | Sí |
| AnimeYT · Tokyo Revengers T4 | MP4 directo | 6,6 s | 1→11 | Sí | Sí |
| DoramasFlix · Teach Me Touch Me | Voe | 12,4 s | **0→1 (atascado)** | Sí | Sí |
| Asia Live Action · Merry Berry Love | ok.ru | 23 s | 1→10 | Sí | Sí |
| Reanudar Street Fighter | tungtungsahur | 10,1 s | 110→115 | Sí | Sí |

Tras el atasco de Voe: DoramasFlix prefiere Streamwish y se añadió el cambio por atasco. Reprobado en TV (`doramasflix-validation.json`): Streamwish 9,2 s, 1→21 s en 20 s; reanuda 20→25 s. «Gustos» en TV (`taste-validation.json`): 3 votos con el control simulado, marcas y panel correctos. Memoria libre de la TV 83 MB antes y 205 MB después de la pasada completa. Cuevana recuerda su propia posición entre pruebas, por eso no empieza en 0.

En el Mac (`evidence/holy/desktop/`): 9/9 muestras de los 7 sitios reproducen y avanzan.


## Holy 0.4.0 · reintento en otro sitio, catálogo grande y gustos 2 (2026-10-23 19:40)

### El fallo de «Hope»
El usuario abrió «Hope» y volvió al inicio sin verla. Hay dos «Hope» en el catálogo: la de RePelisHD (funciona, Mixdrop) y la de **DoramasFlix, que no tiene servidores**. Holy pedía los enlaces a DoramasFlix, recibía una lista vacía y se rendía. Ahora:
1. Servidores alternos del mismo sitio (como antes).
2. **Mismo título en otros sitios**: primero copias del catálogo y después la búsqueda de cada sitio compatible (películas: Cuevana, RePelisHD, DoramasFlix; anime: JKAnime, AnimeYT; doramas: DoramasFlix, DoramasMP4, Asia Live Action; series: Cuevana). Título igual (o el mismo título principal antes de «:», solo en películas), año ±1 cuando ambos lo dicen; en episodios, el mismo número (y temporada si ambos la numeran). La cortina dice «Probando en Cuevana 3…».
3. También cuando todos los servidores de la copia fallan o la página da error.
Mac: `--item=doramasflix:Hope` → Cuevana, reproduce y avanza.

### Catálogo
709 títulos (antes 174): páginas de género (Cuevana 15, RePelisHD 16), catálogo de AnimeYT (2 páginas), directorio de DoramasMP4 (2) y «Animes recientes» de JKAnime. Una página de género que repite el listado normal (slug desconocido) se descarta para no etiquetar mal. 24 filas en el inicio. JSON del inicio comprimido (837 KB → gzip).

### Gustos 2
- Calificar en tres niveles (No es para mí, Me gusta, Me encanta) con el botón verde en cualquier título.
- «¿Qué te pareció?» una vez tras ver un buen rato; «Ahora no» no vuelve a preguntar.
- «Gustos»: chips de Géneros, Productoras y estudios, Países (OK me gusta, rojo no).
- La probabilidad suma productora y país al modelo; el motivo lo dice («Te gusta Acción · MAPPA · de Japón»).

### Pruebas
`npm test`: 13 + **15 de resistencia** (nuevas: gustos 2, catálogo grande, otro sitio, imágenes permitidas). `validate-holy-sites`: 7/7 y 0 imágenes rechazadas. Mac: 9/9 muestras + fallback de Hope. **TV: 0.4.0 instalada, sin validar todavía.**

### Validación en la TV de 0.4.0 (2026-10-23 19:55–20:10)

| Prueba | Resultado |
| --- | --- |
| 7 sitios + reanudar (`validation.json`) | 9/9 arrancan solas (Cuevana 16,3 s, RePelisHD 23,7, JKAnime 12,9, DoramasMP4 15, Cuevana ep. 12,1, AnimeYT 6, DoramasFlix 12,3, Asia Live Action 12,1, reanudar 12,2); la app nunca se cerró; Atrás siempre volvió; memoria libre 39 → 183 MB |
| ok.ru sostenido 40 s (`okru-hold-validation.json`) | 10 → 50 s: avanza. Empezó en el segundo que ok.ru recordaba de pruebas anteriores y tardó en cargar desde ahí |
| «Hope» de DoramasFlix (`fallback-validation.json`) | Sin servidores en DoramasFlix → «Probando en Cuevana 3…» → reproduce en 16,1 s, 0,8 → 15,9 s |
| Gustos (`taste-validation.json`) | «¿Qué te pareció? · Street Fighter» → Me encanta; chips Drama ✓, Comedia ✗, J.C.Staff ✓; botón verde «Calificar» → Me encanta; panel «Evitas: Comedia · Productoras: J.C.Staff» |
| Buscar (`search-validation.json`) | 7 sitios responden en 0,1–4,4 s (Asia Live Action sin buscador: 0); One Piece → 24 bloques → ep. 1180 en 10 s, avanza; Atrás |

Hallazgo: el historial del usuario perdió «Identification» a las 19:02 (guardado desde la TV; la única vía es el botón rojo «Quitar de la fila», que actuaba con una pulsación). Ahora pide dos pulsaciones en 4 s.

## Holy 0.4.1 · Atrás siempre vuelve y anime en JKAnime primero (2026-10-23 21:10)

### La pantalla negra al volver

El usuario veía una película, pulsaba Atrás (o salía y volvía) y la app quedaba bloqueada o en negro. Tres causas:

1. **webOS hacía «historia atrás»** con el botón físico: el reproductor volvía a la página empaquetada de la app (`file://…/index.html`) o se quedaba sin página. Ahora `appinfo.json` lleva `disableBackHistoryAPI: true`: la app recibe la tecla 461 y decide.
2. **Tras reconectar el Mac** quedaban dos manejadores de Atrás en la página (el de la conexión vieja y el de la nueva); el viejo respondía primero, hablaba con una conexión muerta y cortaba la tecla. Ahora cada conexión sella la página (`data-holy-bridge="<mundo>|<hora>"` cada 2 s, visible para todos los mundos aislados) y solo responde el manejador de la conexión viva; los viejos se apartan.
3. **Sin Mac**, el manejador del iframe del reproductor (donde está el foco: `IFRAME https://…lol/v/…` en Cuevana) intentaba `top.location.assign`, que un iframe de otro origen no puede usar. Ahora pide a la página de arriba (que tiene el mismo manejador) que vaya al inicio por `postMessage` y además prueba `top.location.href`.

Además, cualquier navegación de la página principal al inicio cierra la sesión de reproducción en el Mac (guarda la posición), y el Mac arma el manejador también en la página que ya estaba abierta cuando se conecta. En el inicio, Atrás sale de la lista de episodios, el menú, las filas y las secciones; en Inicio avisa «Pulsa Atrás otra vez para salir de Holy» y una segunda pulsación en 3 s sale de la app (la salida en sí no se probó en la TV).

### Anime en JKAnime primero

`PREFERRED = { anime: 'jkanime' }` (`catalog.mjs`): al abrir un episodio de anime de otro sitio, Holy busca el mismo episodio en JKAnime (`catalog.elsewhere(…, { only })`) y lo abre ahí; el sitio elegido queda como siguiente opción y después los demás. La coincidencia de títulos es más estricta con arcos: una serie solo coincide si una de las dos es el título principal sin subtítulo. Mac: AnimeYT → JKAnime en 8/8 episodios recientes.

### Pruebas en la TV (`evidence/holy/tv/`)

Atrás se envió desde el Mac como la tecla 461 que webOS entrega a la app con `disableBackHistoryAPI`; el botón físico no se puede pulsar sin emparejar un control (pide permiso en la TV). **El usuario lo confirmó con el control físico** (2026-10-23): viendo una película, Atrás lo regresa al inicio de Holy.

| Prueba | Resultado |
| --- | --- |
| Recién abierta → película → Atrás | Inicio en 24 s (incluye arrancar la película), misma app, sesión cerrada |
| Desde el inicio → película → Atrás | Inicio, 19 s |
| Mac se reconecta viendo la película → Atrás | Inicio, 23 s (antes: se quedaba en el reproductor) |
| Mac desconectado viendo la película → Atrás | **La página va sola al inicio** (antes: se quedaba) |
| Salir a Ajustes y volver → Atrás | Volvió a la película (misma app) y Atrás llevó al inicio |
| Atrás en Inicio | Avisa «Pulsa Atrás otra vez…», sigue abierta (`back-home-validation.json`) |
| One Piece en JKAnime (`episodes-validation.json`) | 1180, 1179, 1150, 1100, 1000, 800, 500, 100 y 1: 9/9 reproducen solos en 9,2–12 s, avanzan, Atrás vuelve, posición guardada; app sin cierres |
| AnimeYT «Kusuriya no Hitorigoto» ep. 4 | Abre en JKAnime, 13,6 s, avanza |

El iframe del reproductor de Cuevana corre en el mismo proceso en la TV (`playerTargets: 0`); los iframes con proceso propio (OOPIF) seguirían sin el manejador, hoy no se ven en WAM.

## Holy 0.4.2 · One Piece en la búsqueda, con sus episodios (2026-10-23 21:40)

**Qué veía el usuario:** al buscar One Piece en Holy no salía la serie (o lo mandaba a otra). Del historial y del registro de la TV:

- La búsqueda pintaba una fila por sitio en el orden en que respondían. Las primeras eran «En tu catálogo» (One Piece: Heroines, One Piece: Heroínas, LEGO ONE PIECE) y RePelisHD (películas); la serie de JKAnime (episodios hasta el 1180) quedaba en la 4.ª o 5.ª fila. El historial tiene LEGO ONE PIECE 1x1 visto entero.
- En la fila de Cuevana sí estaba «One Piece» (el anime), pero como **serie** y solo hasta el 642. A las 20:06 abrió el 15x642: Holy probó sus 5 servidores (Vidhide, vsembed, stellarconductor, vidlink, videasy) durante ~2 min, ninguno arrancó, y «JKAnime primero» no aplicaba porque no era «anime».

**Cambios**

| Dónde | Qué |
| --- | --- |
| `src/holy.js` `bestResults`, `searchScore`; `App.svelte` | Fila **«Mejores resultados»** arriba: título exacto (sin espacios/acentos/puntuación), luego los que empiezan igual; sitio preferido del tipo primero (anime → JKAnime), series antes que películas. Si el primero es una serie, fila **«One Piece · Episodios 1131–1180»** con los más nuevos. El inicio usa JKAnime como preferido aunque el proceso del Mac sea anterior |
| `catalog.mjs` `preference`, `genresOf`, `elsewhere({ kind })` | Serie con género «Anime» (Cuevana One Piece) → mismo episodio en JKAnime primero; LEGO ONE PIECE («Animación») no. JKAnime: episodio por dirección (`episodeURL`), sin descargar la lista (10,8 → 4,5 s) |
| `catalog.mjs` `sameEpisode` | Una temporada > 1 contra un sitio sin temporadas solo coincide con numeración absoluta (> 30): 15x642 = 642, 2x5 ≠ 5 |
| `sources.mjs` `jkanime.parseAiring/more` | Horario de JKAnime: 75 series en emisión con su último episodio → fila **«Anime en emisión»** (Inicio y Anime; primero lo que ves, luego el % y las series largas). One Piece queda 4.º para el perfil actual |
| `catalog.mjs` `post` | Sesión de JKAnime reutilizada 5 min: lista de One Piece 5,6 → 4,0 s |
| `catalog.mjs` `searchLocal` | «onepiece» encuentra «One Piece» |

**Pruebas:** `npm test` (13 + 17; nueva comprobación «One Piece…»). En el navegador del Mac (Holy en el puerto 43191 sin TV, y el inicio del proceso que corre en 43190): «one piece» → «Mejores resultados» con One Piece de JKAnime primero y debajo 1180, 1179, 1178…; abrir la serie → 24 bloques empezando por 1131–1180. Primero no se tocó la TV (estaba reproduciendo un anime).

**TV (21:50, con permiso del usuario; `evidence/holy/tv/search-validation.json`)**: IPK 0.4.2 instalado. El primer intento tras instalar encontró la conexión cerrada (fallo conocido); el segundo:

| Prueba | Resultado |
| --- | --- |
| Buscar «one piece» con las teclas del control | Sitios en 0,1–7,9 s; filas: «Mejores resultados», «One Piece · Episodios 1131–1180», En tu catálogo, Cuevana, JKAnime…; primer resultado «One Piece · Último episodio: 1180 · En emisión · Anime · JKAnime» |
| OK en la serie | 24 bloques, el primero 1131–1180, foco en el 1180 → reproduce en 13,4 s, avanza, Atrás vuelve |
| Cuevana «One Piece» 15x642 (serie) | Va a JKAnime 642, reproduce en 13,4 s, avanza |

## Holy 0.5.0 · Final de capítulo y de película (2026-10-23 22:25)

**Petición:** al terminar un capítulo, ofrecer el siguiente con un temporizador y, si no se pulsa nada en 5–6 s, ponerlo solo; al terminar una película, ofrecer volver al inicio o películas parecidas.

**Cómo funciona**

- El puente detecta el final con la posición que ya lee cada segundo: `ended`, a 4 s del final, o atascado 6 s dentro de los últimos 30 s sin pausa (un stream cuyo último trozo no carga). Si se rebobina más de 15 s, la tarjeta se quita.
- La tarjeta (`holyEndCard`) se dibuja en la página de arriba, en el mundo aislado del puente (sin `innerHTML`), encima del reproductor en modo teatro. Mientras está, cada marco lleva `data-holy-card` y `holyRemote` reenvía OK y flechas al Mac desde el iframe del reproductor; el clic del puntero también vale. Solo los contextos de Holy pueden responder.
- **Capítulo**: `Catalog.next` busca el siguiente por número en la lista del sitio (JKAnime la da de más nuevo a más viejo; Cuevana pasa de 1x10 a 2x1); si la lista no tiene uno mayor, es el último. Se busca al empezar a reproducir para que la tarjeta salga al instante. A los 6 s (`NEXT_DELAY`) reproduce el siguiente por el camino normal (cortina, JKAnime primero, servidores alternos, otro sitio). Mover a «Volver al inicio» para la cuenta.
- **Película**: «Volver al inicio» enfocado y hasta 4 parecidas (`Catalog.similar`: géneros en común ×12 + % de coincidencia; una por título; nunca la misma ni una ya terminada; con póster). No hay cuenta atrás.

**Pruebas**

- `npm test`: nueva comprobación «Final de un título…» (cuenta atrás → siguiente; → para la cuenta y OK → inicio; último capítulo; rebobinar; atascado al final cuenta, pausado no; película → parecida con clic; contextos ajenos no responden; `next` por número; `similar`; reenvío de teclas en el iframe).
- **TV** (`evidence/holy/tv/ending-validation.json`, `ending-next.jpg`, `ending-film.jpg`; teclas enviadas desde el Mac con `Input.dispatchKeyEvent`, vídeo silenciado, historial de prueba borrado):

| Prueba | Resultado |
| --- | --- |
| One Piece 1178 (JKAnime), salto a 12 s del final | Tarjeta «Siguiente capítulo · Episodio 1179» en 12,9 s con cuenta atrás; 1179 reproduciendo 17,4 s después |
| 1179 al final + → y OK | → enfoca «Volver al inicio» y para la cuenta; 8 s después sigue en 1179; OK → inicio |
| «Papi Ricky: La Película» (Cuevana) | Primera vez: el reproductor se quedó en 5977/5987 s tras el salto y no hubo tarjeta → regla de «atascado al final». Segunda: tarjeta con Volver al inicio + Seriously Single Too, Volver a los 17, La hipótesis del amor, Un altre home (pósters cargan); → + OK reproduce la primera; Atrás → inicio |

No probado: el control físico y ver hasta el final real (la prueba salta a los últimos segundos). En la captura del capítulo, el reproductor de JKAnime muestra su propio aviso «¿Deseas continuar donde te quedaste?» (recuerda pruebas anteriores); no impidió el siguiente capítulo.

## Holy 0.6.0 · Idioma y botón azul (2026-10-24 00:15)

**Idioma.** `languageLabel` (sources.mjs) normaliza lo que digan los sitios a «Latino · Castellano · Inglés · Subtitulado». Cuevana lista en su reproductor una pestaña por versión (`tab-item-name`), que `parseDetail` lee; los demás tienen un valor por sitio (`language` del conector). Lo que no se sabe queda vacío. `Catalog.enrich` lo pone en cada título (catálogo, búsqueda y «Continuar viendo»); las páginas de Cuevana leídas antes de esto se vuelven a leer una vez. En `home()`, `once()` deduplica por título **y** idioma: la misma película en Latino (RePelisHD) y Subtitulado (Cuevana) sale dos veces. UI: pastilla en la vista previa, etiqueta LAT/CAST/ING/SUB en la tarjeta.

**Botón azul.** `keyCode 406` se atiende antes que el campo de búsqueda (sirve también escribiendo): `voiceSearch()` va a «Buscar»; con `SpeechRecognition`/`webkitSpeechRecognition` escucha en es-MX y busca lo que oye; sin ello enfoca el campo (teclado en pantalla con micrófono) y avisa. Pruebas en el navegador del Mac: reconocedor simulado «one piece» → «Mejores resultados» + episodios; sin reconocedor → aviso y campo enfocado. **No se sabe aún qué ofrece la TV**: `validate-holy-tv.mjs --voice` lo registra (`voice-validation.json`).

Aparte: `HOLY_LIBRARY=<archivo>` hace que `npm run holy` use otro historial (la vista previa del navegador usa una copia; el real no se toca).

## Holy 0.7.0 · Rapidez, menú del Mac y resistencia (2026-10-24 02:10)

**Menú «● LG» del Mac.** Mostraba solo Luma («LG encendida: abre Luma»). Ahora (`mac/LumaMenu.swift`, `mac/build.sh`, `scripts/holy-control.mjs`) el punto es el semáforo de Holy y el menú lista TV, Mac, lo que falta y «Doctor: revisar y arreglar»; enciende/reinicia/apaga Holy en el Mac y abre Holy en la TV; Luma queda en un submenú. **El Doctor ya no está en la TV** (pedido del usuario): la pantalla solo dice si está conectada al Mac. El arranque automático es una nota (el usuario no lo quiere todavía) y el Doctor no lo instala.

**Revisión de rapidez (medido antes de cambiar).**

| Hallazgo | Cambio |
| --- | --- |
| El inicio pesaba 1,18 MB de JSON (255 KB comprimido): cada título dos veces, con campos vacíos; se pedía al abrir, al volver de un vídeo y tras cada voto, y se recalculaba y comprimía en cada petición | Formato empaquetado `?v=2` (574 KB / 137 KB); construido una vez por versión y guardado comprimido. Las pantallas instaladas antes siguen recibiendo el formato plano |
| La TV guardaba esos 1,18 MB en su almacenamiento local en cada carga (bloquea) | Se guarda la versión empaquetada, 2,5 s después, en reposo |
| Svelte observaba en profundidad ~1.600 objetos del inicio | `$state.raw` (se reemplaza entero) |
| Cada fila cercana dibujaba todas sus tarjetas (hasta 40 con imagen) | Solo de 3 antes a 9 después de la posición de la fila; el resto, cajas vacías del mismo ancho (24 tarjetas reales en vez de ~80) |
| Imágenes que aparecían de golpe y se decodificaban en el hilo principal | `decoding=async` y fundido al cargar |
| Texto «Preparando tu catálogo…» al esperar | Esqueletos animados con forma de filas (también al cargar episodios y «Gustos») |
| El reproductor se buscaba solo después de pulsar OK | Al detenerse 1,2 s en una tarjeta, el Mac lo busca en segundo plano (JKAnime primero en anime) y lo guarda 150 s; si ese reproductor falla se olvida. En series, se carga la lista de episodios |

**Resistencia.** Ya existían: servidor que no arranca en 28 s o se atasca al principio → siguiente; sin servidores → mismo título en otro sitio; final atascado → tarjeta de final. Nuevo: **atasco a mitad del vídeo** (25 s sin avanzar, sin pausa, a más de 30 s del final) → siguiente servidor o sitio, retomando 5 s antes del punto; máximo 3 rescates por título.

**Pruebas.** `npm test`: 21 de resistencia (nuevas: inicio empaquetado ida y vuelta, ruta `?v=2` y plana; caché del reproductor, preparar una sola vez y nunca durante la reproducción, rescate con el mismo segundo y sin rescate si está en pausa; la TV sin Doctor). Navegador del Mac: 24 tarjetas reales y 57 cajas vacías, ~4 ms por pulsación. **TV pendiente**: `validate-holy-tv.mjs --speed` mide apertura, foco y arranque frío contra preparado.

## Holy 0.7.1 · Puntero del Magic Remote (2026-10-24 02:40)

**Problema del usuario:** con el puntero del control, al pasar por las películas «se mueve muy rápido y no me deja seleccionar». Causa: `onmouseenter` hacía lo mismo que una flecha (`rowIndex` y `columns`), y la fila se desplaza para dejar la tarjeta enfocada a la izquierda; con el puntero quieto, otra tarjeta quedaba debajo, el navegador avisaba «entró» y se repetía.

**Cambio (`src/App.svelte`):** modo puntero separado del foco de teclas. `hover` solo guarda `pointer` tras 110 ms de reposo (sin tocar filas ni columnas); `focused` y la tarjeta iluminada salen de `pointer` mientras se usa el puntero; vista previa a 260 ms. Desplazamiento con puntero: botones «‹ ›» por fila (5 tarjetas, transición 0,7 s) y rueda (una fila por muesca, 380 ms entre muescas). Solo cuenta un movimiento real (`mousemove` con ≥ 3 px; nada en los 500 ms tras una tecla). Primera flecha tras el puntero: devuelve el foco a esa tarjeta; OK abre la tarjeta del puntero; `cursorStateChange` de webOS al ocultarse el puntero.

**Pruebas:** navegador del Mac con ratón real a 1920×1080: pasar por 3 tarjetas no mueve la fila (`translateX(0px)`), se ilumina la del puntero y la vista previa cambia; «›» desplaza 5; la rueda baja una fila; con el ratón quieto, ↓ ↓ → mueven el foco por teclas sin que el puntero lo robe. `npm test` (comprobación de que `hover` no desplaza nada). **TV con el control: pendiente.**

## Holy 0.7.2–0.7.3 · Fluidez medida en la TV y orden de rescate (2026-10-24 02:55)

**Velocidad (`validate-holy-tv.mjs --speed`, TV real).**

| Medida | 0.7.1 | 0.7.2 | 0.7.3 |
| --- | --- | --- | --- |
| Abrir hasta ver títulos | 2,9 s | 3,5 s | 6,4 s (primera tras instalar) |
| Pulsación (mediana) | 104 ms | 72 ms | **58 ms** |
| Pulsación más lenta | 2,4 s | 1,0 s | **259 ms** |
| Título sin preparar | 12,2 s | 15,2 s | (falló el sitio, ver abajo) |
| Título preparado al detenerse | 10,4 s | 11,5 s | 11,2 s |

Medición fina en la página de la TV (lógica + diseño por pulsación): ↑↓ 90–120 ms → ~11 ms; ← → ~17 → ~16 ms con 10× más tarjetas listas. Lo que costaba: al cambiar de fila se construían las tarjetas de la fila nueva (≈ 4,6 ms por tarjeta en la TV) y cada tarjeta recalculaba si tenía el foco; luego, con todo construido, pintar el bloque de filas (89 ms) → `content-visibility:auto` (48 ms). Sombras, transiciones y `will-change` apenas influían.

**Orden de rescate.** En la prueba de 0.7.3, «Klara y el sol» de Cuevana no arrancó en 90 s: 5 servidores (dos espejos `.lol`, vsembed/stellarconductor, vidlink) de ~27 s cada uno, cuando el título también está en RePelisHD. Ahora: servidor sin reproductor → 15 s; tras 2 servidores de un sitio → otro sitio; si ese falla → los servidores restantes del primero. Prueba: `npm test` («Arranque que falla…»).

**7 sitios en la TV (`validation.json`)**: 9/9 arrancan solas (8,3 / 13,2 / 8,8 / 17,2 / 9,3 / 7 / 39,4 / 16,4 / 10,3 s), la app nunca se cerró, Atrás siempre volvió, memoria libre estable. Asia Live Action (ok.ru empezando en el segundo 54 que recordaba) y «reanudar» (5 s de observación) aún no avanzaban al medir; ya se había visto ese comportamiento de ok.ru antes.

