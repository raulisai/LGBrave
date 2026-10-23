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
