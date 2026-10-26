# Between Steps: español y recuperación · 0.9.16

2026-10-26, Windows. Revisión de main hasta b2ad35d, cambios locales de listas/evidencia conservados.

## Lo observado

La última apertura registrada antes de esta revisión fue Between Steps 5 en DoramasMP4/Morencius, copia anunciada como Subtitulado. La TV estaba de nuevo en la búsqueda de Holy. La API y una consulta independiente al sitio DoramasFlix devolvieron Español latino (38) y Coreano con subtítulos en español (13109) para capítulos 4 y 5; los enlaces españoles siguen incluyendo Streamtape. El idioma recordado de la serie en DoramasFlix seguía siendo español. No se perdió esa preferencia en la sincronización.

Se abrió en LG la lista de episodios de DoramasFlix y se reprodujo el capítulo 5 con el idioma recordado. Streamtape arrancó y avanzó; el usuario confirmó que veía y escuchaba español. Este arranque funcionó con 0.9.15, antes de modificar código en esta revisión. No se pudo reproducir ahora un bloqueo de los enlaces españoles ni afirmar que todos los fallos anteriores tuvieran una sola causa.

## Qué se había movido

0.9.14 modificó detección de pausa/atasco y provocó la falsa pausa inicial que ya corrigió 0.9.15. Esos commits no modificaron el parser de idiomas de DoramasFlix ni la elección de la interfaz corregida en 0.9.12. El último arranque en español 0.9.15 acreditado arriba evita atribuir este reporte sin evidencia a un nuevo fallo del parser.

La revisión completa de los reintentos sí encontró un comportamiento anterior: nextVersion podía pasar del doblaje al coreano al agotar servidores; findElsewhere/resolvePlayable aceptaban una copia subtitulada o de idioma desconocido. Las preferencias son por serie y proveedor; abrir directamente la tarjeta DoramasMP4 no la convierte en la edición española de DoramasFlix. El log de este incidente no demuestra qué interacción escogió esa tarjeta.

## Cambios 0.9.16

- Un idioma elegido/recordado limita los reintentos al mismo tipo de audio/subtítulos. Otra versión del mismo tipo y otro proveedor compatible siguen permitidos.
- Se rechazan copias incompatibles y de idioma desconocido durante recuperación; queda evento language-skipped. Sin elección previa se conserva el orden del sitio.
- Catálogo web y TV aplican la misma comprobación; un sitio con un único idioma conserva versionKind aunque no requiera selector.
- Si falta el idioma en la apertura, el estado informa que no se pudo abrir y permite elegir otra opción. No cambia la preferencia guardada.
- Reconectar a una reproducción existente recupera también la elección recordada.

## Validación y límites

npm test completo y build:all pasan. Regresiones con catálogo real y puente/CDP simulado: español fallido no abre coreano; sin español se informa error; se omiten copias subtituladas/desconocidas y se admite otra copia latina; catálogo web conserva el idioma incluso cuando el proveedor solo lista uno. Pruebas de pausa, arranque, sincronización y UI compilada con Svelte siguen pasando.

La LG reprodujo físicamente el capítulo 5 en español, confirmado por usuario. No se forzó un fallo de servidor en la TV ni se comprobaron todos los capítulos/proveedores. Se deja el capítulo reproduciéndose; buscador sin cambios. No requiere reinstalar EXE/IPK; Mac debe traer 0.9.16 y reiniciar backend. Alertas SDK y Invalid InterceptionId ya documentados siguen siendo pendientes independientes.

Activación Windows comprobada: tras reiniciar el servicio con 0.9.16, la LG conservó mismo capítulo/proveedor/huella y avanzó de ~240 a ~297 s, paused=false, readyState=4, MediaError=0. Canal Mac↔Windows en synced. Sin volver al inicio ni recargar el reproductor durante esa activación.
