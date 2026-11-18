# Revisión de reproducción · 2026-11-17

Registros del 12 al 17/11 (Windows, `holy-playback.jsonl`, `incidents-2026-11.jsonl`), lectura HTTP de cada fuente y una simulación de escritorio nueva. Sin navegar la TV.

## Qué fallaba y por qué

| Síntoma en la TV | Causa | Arreglo |
|---|---|---|
| «La Teoría del Big Bang» (PelisFlix): 6 de 6 intentos fallan en 2–6 s, «El sitio no mostró contenido» | Nupload, el único reproductor de PelisFlix, es un JW Player vacío detrás de anuncios trampa («Confirm you're not a robot · Scan the qr-code», «¿Tu navegador es Firefox?»). En 60 s nunca recibe vídeo, ni con los filtros de Holy. Su alternativa voe.sx responde 404 (7 de 7). Histórico: 0 de 16 en la TV. | PelisFlix retirado. «Big Bang» y sus 12 temporadas se ven en Cuevana. |
| «Juego de Tronos», «Godzilla» (OnlyFlix): no arranca | vidapi.xyz responde 404; nontongo y medmedia no cargan vídeo; vidfast muestra la misma trampa del QR. Son los reproductores por identificador que ya hicieron retirar el catálogo público. Histórico: 0 de 8. | OnlyFlix retirado. «Game of Thrones» (8 temporadas) se ve en Cuevana. |
| Cuevana: «sin vídeo en la página tras 45 s» en «Big Bang», «La mesa final», «Todo en todas partes al mismo tiempo», «Fate/stay night» | Cuevana se mudó de `cuevana3c.pro` a `cuevana3t.pro`. Holy solo aceptaba reproductores de `cuevana3c.pro`, no encontraba ninguno y abría la ficha del título, que pide un clic. Por eso a mano sí reproducía. | Todo dominio `cuevana3?.pro` vale: conector, imágenes, escudo de ventanas, guiones de página, filtros. |
| RePelisHD: «no indicó el reproductor», 123 avisos «no se encontraron títulos» | El sitio se rehízo (tarjetas `<a class="cv">`, búsqueda `/buscar?q=`). El reproductor sigue siendo playlatinsrc. | Conector nuevo: películas, búsqueda y ficha (JSON-LD). Capítulos de series leídos del reproductor de series. |
| Series de RePelisHD | Los 949 capítulos de 10 series muestreadas solo tienen Dropload y Doodstream, ambos detrás de una verificación de Cloudflare que cierra la app (Doodstream lo hizo el 30/10). | No se listan (`REPELIS_SERIES = false`). Doodstream y playmogo pasan a la lista de servidores de riesgo. |
| «Between Steps» capítulo 13: 404 | Ningún sitio tiene todavía el 13 (DoramasMP4, DoramasFlix y .beer llegan al 12). «Continuar viendo» adivinaba el siguiente capítulo por la dirección. | El «siguiente capítulo» adivinado se comprueba con la lista del sitio (o la propia página) y se quita si no existe. |
| DoramasFlix .beer: 0 títulos | Tarjetas nuevas `v6-clean-card`; la búsqueda `?s=` devuelve la portada en caché. | Lee las dos tarjetas; busca en `/search/<texto>/`. |
| YouTube «El chico nuevo»: «el vídeo apareció pero no avanzó en 45 s» | Dos subidas: una con restricción de edad (YouTube pide cuenta) y otra que YouTube bloquea si el referrer es una IP. Holy enviaba `http://192.168.1.65:43190/`. Con un nombre de host (`djoker`, `localhost`) se reproduce. | Referrer con el nombre de la computadora. Restricción de edad: aviso claro al abrir y fuera de la búsqueda. Incrustación bloqueada: se abre la página de YouTube. |
| AnimeYT: «no indicó el reproductor» | El capítulo ahora incrusta `mytsumi.com/multiplayer/options.php` (un botón que abre `contenedor.php`, con la lista de servidores en JSON). | Lee el formato nuevo y el antiguo; ok.ru primero; MEGA y reproductores falsos nunca. |
| Páginas de reproductor construidas por script | Al terminar de cargar sin vídeo, el servidor se daba por caído al instante. | Una página vacía espera 15 s (28 s si ya mostró vídeo). Los errores reales de red no esperan. |
| «Callback was already called» (13 veces, cada una justo después de cerrarse Holy en la TV) | El SDK de webOS responde dos veces a un mismo paso cuando la TV corta la conexión (`error` tras `connect`/`timeout`, `error` de SSH tras `ready`). | Cada paso de la sesión responde una sola vez (`AssistSession`). |

Sin cambio, solo observado:
- ok.ru se atascó hacia el minuto 40 en los capítulos 9, 11 y 12 de «Between Steps». El rescate pasó a vidmoly en el mismo segundo y siguió.
- AsiaLiveAction responde 500 o «sin reproductores» en capítulos recientes.
- Los 143 avisos de conexión perdida son, casi todos, Holy cerrado o la TV apagada.

## Simulación de escritorio

`node scripts/simulate-player.mjs --source=<fuente> --q="título" [--season=N --episode=N]` resuelve el título como Holy y abre cada servidor en Chrome headless con el puente real (filtros, escudo de ventanas, guiones de Holy). Cuenta como reproducido cuando el vídeo avanza 3 s.

Chrome de escritorio es más nuevo que el Chromium 120 de la TV: que reproduzca es una evidencia fuerte, no una prueba en la TV. Resultados del 17/11 en «Resultados».

## Resultados (simulación de escritorio, 17/11)

| Fuente | Título | Servidor | Arranca |
|---|---|---|---|
| Cuevana | Big Bang T1E1, T1E2, T5E10 | tungtungsahur.cuevana3t.pro | sí, 6 s |
| Cuevana | Game of Thrones T1E4 | tungtungsahur.cuevana3t.pro | sí, 6 s |
| Cuevana | Todo en todas partes al mismo tiempo; La mesa final | tungtungsahur.cuevana3t.pro | sí, 6 s |
| RePelisHD | Amadeus; La gran apuesta | mxdrop.to | sí, 6 s |
| JKAnime | One Piece 1180 | jkanime.net | sí, 3 s |
| AnimeYT | One Piece: Heroines 1 | ok.ru | sí, 6 s |
| DoramasMP4 | Between Steps 12 | ok.ru | sí, 6 s |
| DoramasFlix | Between Steps 11 | streamtape.com | sí, 6 s |
| YouTube | La Hija del Mariachi 1; El chico nuevo (IYVQPge87o4, con referrer de nombre de host) | youtube | sí, 3 s |
| PelisFlix | Big Bang 1x1 | nupload.my | no (anuncios trampa, sin vídeo) |
| OnlyFlix | Game of Thrones 1x4 | vidapi, nontongo, medmedia, vidfast | no (404, vacío, trampa QR) |

Pendiente: confirmar en la TV, con permiso y sin otra prueba a la vez, Cuevana (serie y película), RePelisHD y AnimeYT.
