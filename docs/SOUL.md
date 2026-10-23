# SOUL · Holy

**Lee solo este archivo al empezar.** Resumen vivo de la rama `holy`: qué es, qué hay hecho, qué falta, reglas y dónde mirar. El detalle de Holy está en `docs/HOLY.md`; el historial del motor (Luma) en `docs/SEMILLA.md`, solo si esto no basta.

**Cómo mantenerlo (obligatorio):** al terminar cualquier ajuste, actualizar aquí (1) la tabla de estado, (2) «Pendiente», (3) versión/fecha, (4) una línea en «Últimos cambios» (máx. 8). Detalles largos van a `docs/HOLY.md`. Sin secretos. Separar siempre lo probado en TV, lo probado solo en Mac/escritorio y lo no probado.

Actualizado: 2026-10-23 (05:10) · Código: **Holy 0.1.0** (`package.json`, `com.lgapp.holy`) · Instalado en TV: **no** (IPK en `artifacts/com.lgapp.holy_0.1.0_all.ipk`, 47 KB, sin instalar: otra sesión estaba usando la TV).

## Qué es

App de películas, anime, doramas y series para la LG 75UR8750PSA (webOS 25, Chromium 120, 1920×1080) con interfaz tipo Netflix. Es **otra app** (`com.lgapp.holy`) que reutiliza el motor de Luma: puente CDP en el Mac, bloqueo con el motor de Brave, escudos de ventanas/QR y asistente de reproductores. La rama `holy` nace de una copia exacta del árbol de trabajo de Luma 0.8.0 (sin commit en `main`); `main` no se tocó. Español y lenguaje sencillo con el usuario.

## Cómo funciona

1. `npm run holy` (Mac) sirve el inicio en `http://<IP del Mac>:43190/holy/`, lee los estrenos de los sitios favoritos cada 30 min y espera a que Holy esté abierta en la TV (no la abre).
2. El inicio muestra «Continuar viendo», «Recomendado para ti», películas, anime, doramas, series y filas «Porque te gusta…».
3. Al pulsar OK, el Mac busca **el reproductor que el propio sitio abriría** y la TV va directo a él (con la referencia del sitio), tapado por una cortina de Holy. El puente pulsa «play» solo, quita la cortina, pone el vídeo a pantalla completa y guarda el segundo cada 10 s. Atrás vuelve al inicio.

## Características

| Área | Estado | Notas clave |
| --- | --- | --- |
| Inicio tipo Netflix | Hecho, **probado en Mac** | `src/App.svelte` + `src/holy.js`: vista previa grande del título enfocado, filas horizontales, secciones Inicio/Películas/Anime/Doramas/Series, ↻ para buscar estrenos, botón rojo quita de «Continuar viendo». Imágenes por la caché del Mac (`/holy-api/img`) |
| Catálogo | Hecho, **probado contra los sitios reales desde el Mac** | `scripts/holy/sources.mjs` + `catalog.mjs`: Cuevana 3 (películas y episodios), RePelisHD, JKAnime (solo pestaña Animes), DoramasMP4. ~118 títulos, géneros unificados, sitio caído conserva sus títulos |
| Directo al vídeo | Hecho, **probado en Chrome del Mac, no en TV** | Cuevana → `tungtungsahur…&pops=false`; JKAnime → `jkplayer` (Desu); RePelisHD → API de PlayLatinSrc → Mixdrop latino (nunca Dropload/dr0pstream/UnlimPlay: cierran la app en la TV; si solo hay esos, Holy rechaza el título); DoramasMP4 → ok.ru `autoplay=1`. Autoplay busca vídeos también en shadow DOM e iframes con sesión propia |
| Continuar viendo / recomendaciones | Hecho, probado en Mac | `scripts/holy/library.mjs` (`.local/holy-library.json`): una tarjeta por serie, reanuda en el segundo guardado, siguiente episodio al terminar; gustos por género y tipo con decaimiento de 21 días, motivo «Porque viste X», sin duplicar el mismo título entre sitios |
| Motor de Luma | Heredado | Filtros, escudos, `player-assist`, conexión pasiva. La barra Safari no se usa en Holy (`toolbar:false`); Atrás va siempre al inicio |

## Pendiente (prioridad)

1. **Instalar y probar en la TV sin concurrencia** (confirmar con el usuario): `ares-install` del IPK, `npm run holy`, abrir Holy, probar los 4 sitios, Atrás, reanudar. En WAM los iframes pueden comportarse distinto que en Chrome de escritorio.
2. La lista de sitios que el usuario dijo que enviaría: añadir conectores. Sin conector aún: FrameTV, OnlyFlix, Asia Live Action, DoramasFlix, Doramasia. **Excluidos** AnimeYT y AnimeOnline Ninja: Cloudflare Turnstile cierra la app en esta TV (probado en Luma).
3. Búsqueda dentro de Holy (no existe aún) y ficha con episodios/temporadas.
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
| Conectores de sitios | `scripts/holy/sources.mjs` |
| Catálogo y filas | `scripts/holy/catalog.mjs` |
| Historial y gustos | `scripts/holy/library.mjs` |
| Reproducción automática | `scripts/holy/holy-bridge.mjs`, `scripts/holy/page-scripts.mjs` (cortina, Atrás, autoplay, pantalla completa, reanudar) |
| Servidor e imágenes | `scripts/holy/server.mjs` (puerto 43190, solo red local) |
| App id/IP/puerto | `scripts/holy/config.mjs` (`LAB_HOST`, `HOLY_PORT`, `LAB_ORIGIN`) |
| Motor heredado | `scripts/browser-bridge.mjs`, `filter-engine.mjs`, `shields.mjs`, `navigation-shield.mjs`, `player-assist.mjs`, `lab-runtime.mjs` |
| Pruebas | `npm test` (incluye `test-holy.mjs`); `node scripts/validate-holy-desktop.mjs` (Chrome del Mac, nunca la TV) |

## Comandos esenciales

```sh
npm test                                   # pruebas locales
npm run holy                               # Mac: inicio + catálogo + puente (espera a Holy en la TV)
HOLY_TV=0 npm run holy                     # solo inicio y catálogo, sin tocar la TV
node scripts/validate-holy-desktop.mjs     # recorrido real en Chrome del Mac (--only=cuevana, --refresh)
npm run package                            # IPK en artifacts/
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.holy_0.1.0_all.ipk
npm run tv:launch                          # solo si el usuario lo autoriza
```

Entorno: TV `192.168.1.134`, Mac `192.168.1.148` (cambian; `config.mjs` toma la IP privada actual). Node 22, macOS arm64.

## Últimos cambios

- 2026-10-23 05:10 — **Holy 0.1.0 creada en la rama `holy`** (copia del motor Luma 0.8.0). Inicio tipo Netflix, catálogo de 4 sitios, salto directo al reproductor con cortina y autoplay, Continuar viendo, recomendaciones por gustos. `npm test` (12 comprobaciones de Holy + motor) pasa. Validación en Chrome del Mac (`evidence/holy/desktop/`): Cuevana película 7,2 s y episodio 3,5 s, RePelisHD (Mixdrop) 5,6 s, JKAnime 5,7 s, DoramasMP4 (ok.ru) 10,8 s hasta reproducir; el vídeo avanza, Atrás vuelve al inicio, se guarda la posición y al reabrir reanuda (31 s → ≥31 s). **Sin probar en TV.**
