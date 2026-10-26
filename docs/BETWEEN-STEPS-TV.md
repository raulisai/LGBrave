# Between Steps no abría en LG · 2026-10-26

## Resultado

Corregido en código 0.9.12 / interfaz Holy 0.9.12 y aplicado al inicio HTTP que carga la LG. En la TV real, el capítulo 4 mostró «Español latino» y «Coreano · subtítulos en español», se seleccionó latino y comenzó la reproducción. El usuario confirmó que imagen y audio estaban bien. Se conserva el capítulo reproduciéndose por la petición del usuario; no se cambió el buscador ni la reproducción de la Mac.

## Causa comprobada

La API sí devolvía ambas versiones del capítulo 4 (id 38 doblada / 13109 subtitulada), sin elección recordada. El fallo ocurría antes del reproductor: episodeRows reconstruye tarjetas como objetos sin proxy. El estado profundo opening transformaba el objeto en un proxy de Svelte; después de await versionsFor, opening !== item resultaba verdadero y el flujo retornaba antes de mostrar el selector o enviar play. El temporizador de apertura se creaba después de ese retorno, así que la pantalla podía quedar permanentemente en «Abriendo».

La ruta de búsqueda podía funcionar porque sus tarjetas ya eran reactivas; la lista de episodios y otras tarjetas raw fallaban. Esto explica por qué la página web de la Mac dejaba elegir idioma mientras la interfaz específica de TV quedaba atascada.

## Corrección

- src/Holy.svelte conserva la tarjeta de apertura mediante $state.raw, sin cambiar su identidad. Se mantiene la protección que descarta respuestas tardías tras cancelar.
- Cuando no existe el binding de la computadora, se retira opening y su temporizador antes de mostrar el aviso; tampoco queda una cortina bloqueada en ese caso.
- scripts/test-holy-ui-opening.mjs extrae y compila con Svelte las funciones reales del componente. Prueba episodios raw y resultados reactivos, selector, elección española, preferencia recordada, falta de conexión, vencimiento y cancelación. Falló con el código anterior y pasa con el corregido; forma parte de npm test.
- Versiones: paquete 0.9.12; holy-public/appinfo.json 0.9.12 para futuros paquetes. El EXE no cambió.

## Validación

- npm test completo correcto; build:holy correcto (bundle index-CeaG19qM.js).
- Reproducción del fallo en una copia del inicio de TV en el navegador, desde la lista de episodios, sin modificar la TV durante el diagnóstico inicial.
- Con autorización explícita, se recargó en LG el inicio HTTP de Windows y se abrió la lista real de Between Steps desde DoramasFlix. Se usó el interceptor del servicio activo; los clientes de diagnóstico no habilitaron Fetch ni instalaron otro puente.
- Selector capturado en artifacts/between-steps-idiomas-tv.png, ambas versiones visibles y sin «Abriendo».
- Al pulsar Español latino: logs server-opening 09:35:24 UTC y playback-started 09:35:32 UTC, proveedor Streamtape.
- Muestreo de progreso de la misma sesión: 2.045 s → 6.066 s; después 92.830 s. Lectura directa del vídeo: 94.236 s de 4360.233 s, paused=false, readyState=4, error=0, 1280×720, visible y volumen 1, sin mute.
- Confirmación física del usuario: «si esta bien» al preguntar si ya veía imagen y escuchaba español en la TV.
- La captura CDP del vídeo salió negra; no se usó como prueba visual del vídeo. La confirmación física y las métricas están diferenciadas de la imagen del selector.

La LG conserva los paquetes instalados Luma 0.9.2 / Holy 0.9.5, pues el inicio en uso era http://192.168.1.65:43190/holy/ y ya carga el build nuevo. No fue necesario reinstalar IPK ni EXE. No se detuvo ni se sustituyó el servicio de la Mac. La prueba acredita este arranque y un seguimiento corto; no equivale a validar todos los capítulos/proveedores ni un episodio completo o un relevo durante vídeo.
