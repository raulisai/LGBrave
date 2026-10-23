# Holy 0.1.0 · informe

Fecha: 2026-10-23. Rama `holy`. App webOS `com.lgapp.holy`, separada de Luma (`com.lgapp.lab`). **Probado solo en el Mac** (Chrome de escritorio sin interfaz y el panel del navegador); la TV no se usó porque otra sesión tenía pruebas activas.

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
