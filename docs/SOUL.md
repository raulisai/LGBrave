# SOUL · Holy

**Lee solo este archivo al empezar.** Resumen vivo de la rama `holy`: qué es, qué hay hecho, qué falta, reglas y dónde mirar. El detalle de Holy está en `docs/HOLY.md`; el historial del motor (Luma) en `docs/SEMILLA.md`, solo si esto no basta.

**Cómo mantenerlo (obligatorio):** al terminar cualquier ajuste, actualizar aquí (1) la tabla de estado, (2) «Pendiente», (3) versión/fecha, (4) una línea en «Últimos cambios» (máx. 8). Detalles largos van a `docs/HOLY.md`. Sin secretos. Separar siempre lo probado en TV, lo probado solo en Mac/escritorio y lo no probado.

Actualizado: 2026-10-23 (19:40) · Código: **Holy 0.4.0** (`package.json`, `com.lgapp.holy`) · Instalado en TV: **0.4.0** (`artifacts/com.lgapp.holy_0.4.0_all.ipk`). `npm run holy` (con supervisor) corre en una pestaña de la terminal. **Pendiente: validar 0.4.0 en la TV** (la TV estaba encendida y no se interrumpió).

## Qué es

App de películas, anime, doramas y series para la LG 75UR8750PSA (webOS 25, Chromium 120, 1920×1080) con interfaz tipo Netflix. Es **otra app** (`com.lgapp.holy`) que reutiliza el motor de Luma: puente CDP en el Mac, bloqueo con el motor de Brave, escudos de ventanas/QR y asistente de reproductores. La rama `holy` nace de una copia exacta del árbol de trabajo de Luma 0.8.0 (sin commit en `main`); `main` no se tocó. Español y lenguaje sencillo con el usuario.

## Cómo funciona

1. `npm run holy` (Mac) arranca `holy-supervisor.mjs`, que mantiene vivo `holy.mjs` (lo reinicia si se cae). Sirve el inicio en `http://<IP del Mac>:43190/holy/`, lee los estrenos de los 7 sitios cada 30 min y espera a que Holy esté abierta en la TV (no la abre).
2. El inicio muestra «Continuar viendo», «Recomendado para ti», películas, anime, doramas, series y filas «Porque te gusta…»; cada título lleva su **% de coincidencia** con tus gustos.
3. Al pulsar OK, el Mac busca **el reproductor que el propio sitio abriría** y la TV va directo a él (con la referencia del sitio), tapado por una cortina de Holy. El puente pulsa «play» solo, quita la cortina, pone el vídeo a pantalla completa y guarda el segundo cada 10 s. Si un servidor no arranca en 28 s, o arranca y se queda atascado 20 s al principio, prueba el siguiente servidor del título; **si el sitio no tiene reproductor o fallan todos sus servidores, busca el mismo título (o el mismo episodio) en tus otros sitios** y sigue tras la misma cortina. Atrás vuelve al inicio.
4. Tras ver un buen rato (terminado, 60 % o 15 min), el inicio pregunta una vez «¿Qué te pareció?». El botón verde califica cualquier título: No es para mí / Me gusta / Me encanta.

## Características

| Área | Estado | Notas clave |
| --- | --- | --- |
| Inicio tipo Netflix | Hecho, **probado en TV** | `src/App.svelte` + `src/holy.js`: vista previa grande del título enfocado, filas horizontales, secciones Inicio/Películas/Anime/Doramas/Series/Gustos/Buscar, ↻ para buscar estrenos, botón rojo quita de «Continuar viendo». Imágenes por la caché del Mac (`/holy-api/img`). Peticiones con plazo y un reintento (`getJSON`) |
| Catálogo (7 sitios) | Hecho, **probado contra los sitios reales** (`validate-holy-sites.mjs`, 7/7, 0 imágenes rechazadas) | `sources.mjs` (Cuevana 3, RePelisHD, JKAnime, DoramasMP4) + `more-sources.mjs` (**DoramasFlix** .io con espejos .in y doramasia.com, **AnimeYT**, **Asia Live Action**), registro en `connectors.mjs`. **~709 títulos**: además de cada inicio, páginas de género de Cuevana (15) y RePelisHD (16), catálogo de AnimeYT, directorio de DoramasMP4 y «Animes recientes» de JKAnime (`more()`/`genrePages`, una página de género que repite el listado normal se descarta). Productoras/estudios (JKAnime, AnimeYT, DoramasFlix) y país (DoramasMP4, DoramasFlix, RePelisHD, anime = Japón). Inicio con filas por género (Acción, Comedia, Drama, Suspenso y thriller, Terror, Ciencia ficción, Romance, Animación…, tus favoritos primero) y «Anime/Doramas para descubrir»; JSON comprimido (gzip). géneros unificados (sin etiquetas «4k»), anime adulto (Hentai/Erótica, «sin censura») fuera. Un sitio caído o colgado (plazo 45 s) conserva sus títulos y no frena a los demás |
| % de coincidencia y «Gustos» | Hecho; 0.3.0 probado en TV, **0.4.0 solo en Mac** | `library.mjs`: perfil por géneros, tipo, década, **productora/estudio y país** con lo visto (peso por cuánto se vio, mitad cada 21 días), lo calificado (Me encanta +2,5, Me gusta +1,5, No es para mí −1,5; mitad cada 180 días) y los **gustos elegidos** en «Gustos» (género, productora, país: ±3, no se desvanecen); gustos y disgustos escalados aparte. Calificar con el botón verde en cualquier título; pregunta «¿Qué te pareció?» tras ver (`pendingRating`). «Gustos» con filas de chips Géneros / Productoras y estudios / Países. Porcentaje logístico 5–99 % acercado a 50 % mientras hay pocas señales (2 señales ≈ ±14 puntos). Sección «Gustos»: filas por género para calificar (OK me gusta, rojo no me gusta, amarillo dos veces borra), panel «Tu perfil». API `/holy-api/taste`, `/holy-api/vote` |
| Buscador | Hecho, **probado en TV** (4 sitios; los 3 nuevos probados desde el Mac) | Menú «Buscar»: pregunta a todos los sitios a la vez (Asia Live Action no tiene buscador usable: su búsqueda da error 520) (`/holy-api/search`) y pinta cada fila cuando su sitio responde (los rápidos primero; TV: todos en ≤1,2 s) + coincidencias del catálogo. Series/anime/doramas abren su lista de episodios (`/holy-api/episodes`): Cuevana por temporadas, JKAnime por su lista paginada (One Piece 1180 en bloques de 50), DoramasMP4 por capítulos. Solo se dibujan tarjetas de filas cercanas al foco |
| Directo al vídeo | Hecho, **probado en TV en los 7 sitios** | Cuevana → `tungtungsahur…&pops=false`; JKAnime → `jkplayer` (Desu); RePelisHD → API de PlayLatinSrc → Mixdrop latino (nunca Dropload/dr0pstream/UnlimPlay: cierran la app; si solo hay esos, se rechaza el título); DoramasMP4 → ok.ru (también dentro del selector pkaa.top); DoramasFlix → acción del servidor del sitio → host real (ok.ru, Mixdrop, Streamtape, Streamwish…; Voe al final); AnimeYT → pestañas de Mytsumi → MP4 directo, luego ok.ru; Asia Live Action → ok.ru. Cada título lleva servidores alternos. Autoplay busca vídeos en shadow DOM e iframes con sesión propia |
| Continuar viendo / recomendaciones | Hecho, probado en TV (guardar/reanudar) | `scripts/holy/library.mjs` (`.local/holy-library.json`): una tarjeta por serie, reanuda en el segundo guardado, siguiente episodio al terminar; gustos por género y tipo con decaimiento de 21 días, motivo «Porque viste X», sin duplicar el mismo título entre sitios |
| Motor de Luma | Heredado, actualizado a Luma 05:10 | Filtros, escudos, `player-assist`, **aplazador de Turnstile**, memoria de cierres, conexión pasiva. La barra Safari no se usa en Holy (`toolbar:false`); Atrás va siempre al inicio |
| Resistencia | Hecho, probado | Supervisor que reinicia el proceso; `guard.mjs` sobrevive al error de las herramientas de webOS cuando la TV se desconecta (causó la caída de las 13:58); archivos dañados se apartan (`.dañado-…`) y se arranca limpio; servidor responde 400 a datos malos o enormes; `/holy-api/health` con estado por sitio. `test-holy-robust.mjs`: fuzz de todos los lectores con 250+ páginas basura, sitio colgado, cambio de servidor, atascos |

## Pendiente (prioridad)

0. **Validar 0.4.0 en la TV** cuando el usuario lo autorice: `node scripts/validate-holy-tv.mjs` (7 sitios), `--item=doramasflix:Hope` (cambio a otro sitio), `--taste`.
1. Holy depende del Mac encendido con `npm run holy`. Para no depender de él: un equipo pequeño siempre encendido que corra lo mismo (recomendado).
2. Probar con el control real: teclado en pantalla en «Buscar» y calificar en «Gustos» (las pruebas usaron teclas simuladas).
3. **Luma (`main`) tiene el mismo fallo de caída** cuando la TV se desconecta (su laboratorio también murió a las 13:58): llevar `guard.mjs` y el supervisor a `main`.
4. Sin conector: AnimeOnline Ninja (Cloudflare devuelve 403 al Mac), FrameTV (app de solo scripts), OnlyFlix (en inglés), DoramasFlix .beer (los reproductores no vienen en la página). La lista que el usuario iba a enviar sigue pendiente.
5. El primer intento tras reinstalar el IPK a veces encuentra la conexión cerrada; el segundo funciona.
4. Atrás dentro de un reproductor en iframe con sesión propia (OOPIF) no tiene el atajo de Holy; en WAM probablemente no aplica, comprobar en TV.
5. Cuevana/JW Player recuerda su propia posición: puede reanudar más adelante que Holy (no es error).

## Reglas que no se rompen

- No tocar firmware, arranque, particiones ni DNS. Sin root.
- Un solo interceptor/prueba que navegue la TV a la vez; antes de probar revisar `ps`, IP del Mac/TV y `git status` (puede haber otra sesión, p. ej. Luma en `main`). Holy (`com.lgapp.holy`) y Luma (`com.lgapp.lab`) usan apps y candados distintos: no correr pruebas de ambas a la vez.
- La verificación «no soy un robot» (`challenges.cloudflare.com`) no se filtra ni se toca. Holy no abre servidores que la cargan y cierran la app.
- Holy no descarga vídeos ni quita protecciones: abre la página del reproductor del sitio con su referencia, como haría el sitio.
- Honestidad: lo probado en Chrome del Mac no acredita la TV; cifras de muestras cortas ≠ episodios completos.

## Mapa mínimo

| Qué | Dónde |
| --- | --- |
| Inicio (TV) | `src/App.svelte`, `src/holy.js` (filas por sección, formato de tiempo) |
| Proceso del Mac | `scripts/holy.mjs` (servidor + catálogo + puente pasivo) |
| Conectores de sitios | `scripts/holy/sources.mjs`, `more-sources.mjs`; orden en `connectors.mjs` |
| Catálogo y filas | `scripts/holy/catalog.mjs` |
| Historial y gustos | `scripts/holy/library.mjs` |
| Reproducción automática | `scripts/holy/holy-bridge.mjs`, `scripts/holy/page-scripts.mjs` (cortina, Atrás, autoplay, pantalla completa, reanudar) |
| Servidor e imágenes | `scripts/holy/server.mjs` (puerto 43190, solo red local) |
| App id/IP/puerto | `scripts/holy/config.mjs` (`LAB_HOST`, `HOLY_PORT`, `LAB_ORIGIN`) |
| Motor heredado | `scripts/browser-bridge.mjs`, `filter-engine.mjs`, `shields.mjs`, `navigation-shield.mjs`, `player-assist.mjs`, `lab-runtime.mjs` |
| Pruebas | `npm test` (incluye `test-holy.mjs` y `test-holy-robust.mjs`); `validate-holy-sites.mjs` (sitios en vivo desde el Mac); `validate-holy-desktop.mjs` (Chrome del Mac); `validate-holy-tv.mjs` (TV real, un solo interceptor, vídeo silenciado; `--search`, `--taste`, `--only=`, `--hold=`) |
| Proceso y caídas | `scripts/holy-supervisor.mjs`, `scripts/holy/guard.mjs` |

## Comandos esenciales

```sh
npm test                                   # pruebas locales
npm run holy                               # Mac: supervisor + inicio + catálogo + puente (espera a Holy en la TV)
node scripts/validate-holy-sites.mjs       # ¿siguen funcionando los 7 sitios? (solo Mac)
HOLY_TV=0 npm run holy                     # solo inicio y catálogo, sin tocar la TV
node scripts/validate-holy-desktop.mjs     # recorrido real en Chrome del Mac (--only=cuevana, --refresh)
node scripts/validate-holy-tv.mjs          # TV real, sin otra sesión usándola (--search, --only=, --hold=)
npm run package                            # IPK en artifacts/
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.holy_0.3.0_all.ipk
npm run tv:launch                          # solo si el usuario lo autoriza
```

Entorno: TV `192.168.1.134`, Mac `192.168.1.148` (cambian; `config.mjs` toma la IP privada actual). Node 22, macOS arm64.

## Últimos cambios

- 2026-10-23 19:40 — **Holy 0.4.0: otro sitio si no se reproduce, 709 títulos, filas por género, gustos por productora y país, calificar y preguntar.** Diagnóstico del fallo de «Hope» (15:50): la copia de DoramasFlix no tiene servidores → Holy se rendía y volvía al inicio. Ahora busca el mismo título/episodio en los otros sitios (`catalog.elsewhere`, `HolyBridge.findElsewhere/nextSite`), también si fallan todos los servidores; probado en Mac: Hope de DoramasFlix → Cuevana, reproduce. Imágenes de AnimeYT rechazadas por la caché (403 en la TV a las 19:04) → hosts añadidos + prueba. País normalizado (Thailand→Tailandia…). La guardia de caídas funcionó en la vida real (la TV se apagó y Holy siguió). `npm test` (13 + 15), `validate-holy-sites` 7/7 con 0 imágenes rechazadas, Mac 9/9. **TV: instalada 0.4.0, sin validar** (la TV estaba encendida; no se interrumpió).
- 2026-10-23 15:10 — **Holy 0.3.0: 7 sitios, % de coincidencia, «Gustos» y resistencia.** Motor de Luma de las 05:10 traído (merge de una copia de `main`). Nuevos: DoramasFlix (+espejos), AnimeYT, Asia Live Action. Servidores alternos con cambio automático (no arranca en 28 s o se atasca 20 s). % de coincidencia y calibración. Supervisor + `guard.mjs` tras la caída de las 13:58 (TV desconectada → error en las herramientas de webOS). Pruebas: `npm test` (13 + 12 de resistencia), `validate-holy-sites` 7/7, Mac 9/9 muestras, **TV 8/8** (los 7 sitios arrancan solos en 6,6–23 s, sin cierres de la app, Atrás y reanudar; Voe se atascó en TV → DoramasFlix ahora prefiere Streamwish, reprobado en TV: avanza 20 s), «Gustos» en TV. Holy 0.3.0 instalada y `npm run holy` corriendo.
- 2026-10-23 13:35 — **Holy probada en la TV y buscador (0.2.0).** TV libre (sin otras sesiones). Instalada `com.lgapp.holy`; `validate-holy-tv.mjs` (un proceso, vídeo silenciado): los 5 títulos arrancan solos en 8,5–22 s, el vídeo avanza, la app nunca se cerró, Atrás vuelve a Holy, guarda posición y reanuda (Street Fighter 78 s → 84 s); memoria libre estable (154→189 MB en la primera pasada). Buscador nuevo en TV: «one piece» → 4 sitios en ≤1,2 s, One Piece → 24 bloques de episodios → ep. 1180 en 10,3 s, avanza, Atrás. Capturas de vídeo en la TV salen negras (capa de vídeo por hardware): se mide por posición. Luma restaurada al frente. `evidence/holy/tv/`.
- 2026-10-23 05:10 — **Holy 0.1.0 creada en la rama `holy`** (copia del motor Luma 0.8.0). Inicio tipo Netflix, catálogo de 4 sitios, salto directo al reproductor con cortina y autoplay, Continuar viendo, recomendaciones por gustos. `npm test` (12 comprobaciones de Holy + motor) pasa. Validación en Chrome del Mac (`evidence/holy/desktop/`): Cuevana película 7,2 s y episodio 3,5 s, RePelisHD (Mixdrop) 5,6 s, JKAnime 5,7 s, DoramasMP4 (ok.ru) 10,8 s hasta reproducir; el vídeo avanza, Atrás vuelve al inicio, se guarda la posición y al reabrir reanuda (31 s → ≥31 s). **Sin probar en TV.**
