# Catálogo público (IMDb/TMDB) retirado · 2026-11-06 · 0.9.28

## Qué pasaba

La fuente «Catálogo público (IMDb/TMDB)» (`tmdb`) buscaba bien, pero ningún título se reprodujo nunca.

- **Búsqueda:** funciona. Cinemeta respondió en vivo («shrek» 20 resultados, «breaking bad» 5), y el servidor de Holy devolvió 26, 16 y 34 resultados para Shrek, Breaking Bad e Inception en menos de medio segundo.
- **Reproducción:** cero arranques en todos los registros disponibles (`history`, `incidents` y `holy-playback`, del 31/10 al 06/11), con 9 títulos intentados. Los servidores por identificador fallan así:
  - `share.cdnm.ink`: en 11 intentos el servidor ya había quitado el título.
  - `vidfast.vc`: «el vídeo apareció pero no avanzó en 28 s», 3 veces (Mr. Nobody).
  - `vidapi.xyz`: se salió a los 12 s sin vídeo.
  - `sv2.nontongo.stream`: pantalla en blanco bajo el inspector. Esto último consta en la nota del código del 02-03/11; no volvió a intentarse en esta revisión.
- **Prueba de hoy, solo HTTP, sin TV ni biblioteca:** desde la búsqueda se resolvió cada título.
  - Con otro sitio del dueño que lo tiene, se reproduce desde ese sitio: Shrek en RePelisHD, Parasite en DoramasFlix.
  - Sin ese sitio, solo quedaban los servidores propios: Inception, Mr. Nobody y Shawshank terminaban en `vidfast.vc`, el que no avanza.
- **Efecto en la pantalla:** el inicio mostraba 179 títulos en inglés guardados de esa fuente, ninguno reproducible desde ella.

## Decisión

Se quita. Todo lo que se podía reproducir ya estaba en los sitios propios del dueño, que tienen su propia búsqueda. Lo demás nunca arrancó, así que no se pierde nada reproducible.

## Qué cambió

- `more-sources.mjs`: se elimina el conector `tmdb`.
- `connectors.mjs`: sale de la lista y de la búsqueda de «el mismo título en otro sitio». Nuevo `RETIRED_SOURCES`.
- `catalog.mjs`:
  - al cargar descarta los títulos de la fuente, sus fichas de `imdb.com/title/`, y sus errores y salud;
  - quita el desvío especial `tmdb-elsewhere` y lo que solo existía para él (`any`, `skip`).
- `known-lists.mjs`: al cargar descarta las coincidencias de listas que apuntaban a la fuente (185 en la caché; alimentaban «Clásicos imprescindibles» con 9 títulos que no se podían reproducir), y esos títulos se buscan de nuevo en los sitios que quedan.
- `server.mjs`: `metahub.space` (pósters de Cinemeta) sale de la lista de imágenes permitidas.
- Pruebas: se quitan la del formato y la del orden de reproducción; entra una de retirada, sin Internet. Se quita el contrato de réplica `tmdb` y la rama `byId` que solo él usaba. El caso `source-tmdb` pasa a `source-tmdb-retired`.

## Qué se conserva

- `image.tmdb.org`: pósters de otros sitios (DoramasFlix, RePelisHD…).
- Cinemeta en `credits.mjs`: reparto, director y nota de un título; es otra función.
- Los 8 títulos de esta fuente que quedaron en tus datos guardados no se tocaron: eran intentos fallidos sin progreso (0 s), no salen en «Continuar viendo» y, si el título está en un sitio tuyo, se reproducen desde allí por nombre.

## Comprobado en vivo tras reiniciar el servicio

- Búsqueda `tmdb`: vacía. Cuevana y RePelisHD siguen buscando.
- La caché en disco y la lista de fuentes ya no tienen `tmdb`; 0 fichas de `imdb.com`.
- La fila «Clásicos imprescindibles» aún mostraba 9 títulos de la fuente justo después del primer reinicio: venían de la caché de listas, que se limpió después (arriba).

## Límites

- No se volvió a probar vidfast en la TV en esta revisión: la conclusión sale de los registros y de la nota del 02-03/11, no de un ensayo nuevo ni de un navegador. Un cambio de esos servidores podría hacerlos útiles; en ese caso se pueden volver a añadir desde el historial de git.
- El servicio en marcha necesita reiniciarse para aplicar el cambio. La TV no necesita IPK nuevo: el catálogo y la búsqueda llegan desde la computadora.
- Hallazgo sin atender: OnlyFlix tiene 235 títulos y ninguna reproducción iniciada en los registros; dos veces apareció `share.cdnm.ink` ya retirado. No se tocó.
