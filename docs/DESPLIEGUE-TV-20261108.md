# Despliegue y validación LG · 2026-11-08

Código y Holy **0.9.31**. Se instaló el IPK en la LG real; el servicio actualizado corre en Mac. **Windows no se actualizó**. Las comprobaciones locales pasaron; las muestras de Internet tienen resultados parciales que se detallan abajo.

## Preparación y protección de los datos

Antes de modificar la TV se confirmó por SSH/CDP que Holy0.9.24 estaba en Inicio visible, sin vídeos ni descriptor de reproducción. Se comprobaron las direcciones vivas y la salud de ambas computadoras. Windows atendía la TV y Mac estaba en respaldo. Se solicitó el relevo normal a Mac; Windows cedió.

Se guardaron una copia privada de los cinco archivos de la app instalada, un IPK0.9.24 de reversión y respaldos privados de biblioteca/preferencias. Se instaló primero0.9.29 para validar las funciones y, tras los hallazgos,0.9.31. La versión se comprueba leyendo el manifiesto instalado, además de abrir la interfaz.

Las pruebas de contenido usaron **un único runtime/interceptor**, con catálogo copiado y biblioteca/cola/preferencias temporales. El servicio común de Mac estuvo detenido durante ellas. El servidor aislado no incluye la sincronización de perfil; rechazó las consultas periódicas de sincronización de Windows con404, evitando publicar el progreso sintético. La biblioteca real conserva sus datos; los títulos de prueba no se añaden a su historial/cola. No se modificaron firmware, arranque, particiones ni DNS.

## Dos fallos encontrados y corregidos

1. **Cola vacía:** amarillo agregaba y quitaba correctamente, pero ocho segundos después de vaciar la sección aparecían carga indefinida y una ficha ajena a la cola. Ahora muestra «Tu cola está vacía» y explica el botón amarillo, sin esqueleto ni héroe del catálogo.
2. **Pausa de películas con un idioma:** «A cualquier precio» avanzaba, pero no abría el panel de pausa aunque tuviera dos servidores. `watch` solo lo abría en episodios o con varios idiomas. Se añade la condición de alternativas de servidor. La LG muestra ahora Seguir viendo y Servidor para esa película.

Se añadieron dos regresiones al gate: renderizado de la plantilla Svelte real para la cola vacía (conservando los estados Inicio/Buscar/Gustos) y ejecución de `watch` real con película de un idioma y alternativas.

## Validación local antes de instalar0.9.31

`npm run package:holy` ejecutó su prevalidación completa: **191 archivos JS/MJS**, suite local, matriz de **42 casos / 11 contratos de fuentes** y compilaciones Luma, Holy TV y Holy web. Huella de código estable antes/después. Resultado correcto; paquete `artifacts/com.lgapp.holy_0.9.31_all.ipk` generado e instalado. El informe local queda en `.local/playback-validation/report.json`.

Estas cifras son pruebas controladas; no significan42 películas reproducidas ni11 sitios actualmente disponibles en la TV. No se repitió el sondeo HTTP general del07/11 porque el cambio posterior se limita al estado vacío y a la condición de pausa.

## Resultados en la LG

| Comprobación | Resultado observado |
| --- | --- |
| Amarillo, alta/baja | Agrega el título enfocado, aparece en Mi cola y el segundo amarillo lo quita |
| Cola vacía0.9.31 | Mensaje correcto, sin carga infinita y sin ficha de otro título, también tras8s |
| Película «A cualquier precio» / RePelisHD / mxdrop.to | Avance5.802→11.636s, readyState4,1728×720, sin MediaError. Siguió hasta~57s antes de pausar. **Usuario confirmó imagen y audio** |
| Pausa de esa película0.9.31 | Posición conservada durante6s; opciones Seguir viendo y Servidor; selector con2alternativas |
| Cambio de esa película a doodstream.com | Petición aceptada en57.638s, pero el target de Holy desapareció~4s después. No se acreditó reproducción de esa alternativa. Posteriormente Holy volvió a aparecer en Inicio. Causa del cierre no confirmada |
| Between Steps5 / Streamtape0.9.31 | Avance5.847→11.464s, readyState4,1280×720,sinMediaError; pausa estable durante6s |
| Idioma y Servidor0.9.31 | Selector de2idiomas; Atrás vuelve a pausa; Servidor aparece junto a Idioma y ofrece3alternativas |
| Cambio Streamtape→Primeload0.9.31 | Petición en57.677s; Primeload reprodujo62.396s, readyState4,1280×720,sinMediaError,369fotogramas y226518bytes de audio decodificados. Avance posterior correcto; mantiene español latino (`dub`) |
| Atrás desde el capítulo0.9.31 | Inicio visible en2.834s, progreso temporal guardado en62s; al final de la prueba Inicio y Google correctos |
| Muestra inicial0.9.29 / Between Steps5 | Streamtape avanzó5.295→10.514s,1280×720,sinMediaError. Idioma/Servidor abrieron; Atrás desde Idioma volvió a pausa. Flaswish no arrancó en28s; recuperó Streamtape. No es un cambio de servidor exitoso |
| Muestra inicial0.9.29 / Silent Night / Pelisflix | nupload.my y su alternativa no iniciaron la muestra dentro del plazo; resultado fallido conservado |

Los contadores de fotogramas/audio de esta WAM devolvieron0 en los reproductores iniciales y `requestVideoFrameCallback` no entregó muestra; allí se marcan **no disponibles**, sin confundirlo con falta de imagen. Primeload sí entregó contadores positivos. Las capturas CDP del vídeo tampoco incluyen necesariamente su plano de hardware. La confirmación física del usuario corresponde a la película indicada, no a todos los proveedores.

### Incidente de arranque durante el ensayo

Una primera validación automatizada recargó la página cuando el puente todavía se estaba iniciando. Se observaron un contexto de ejecución perdido y la página vacía. Cerrar y abrir Holy normalmente recuperó el catálogo con el paquete instalado0.9.31. Se corrigió el validador temporal para esperar el estado conectado completo y entrar por el comando normal de Inicio; el siguiente ensayo cargó la interfaz y ejecutó la cola y los menús. No se atribuye este incidente a un defecto probado del paquete ni se declara una prueba de arranque exhaustiva.

## Evidencia y límites

Evidencia sanitizada en `evidence/holy/tv/deploy-20261108/`: `validation.json` conserva el ensayo inicial y `validation-031.json` el resultado posterior; capturas de cola, pausa, idiomas y servidores acompañan los informes. Los fallos se conservan aunque la automatización alcance su paso final. Respaldos, registro inicial con datos de usuario y herramientas temporales quedan únicamente en `.local/deploy-20261108/`.

## Restauración comprobada

Terminada la prueba aislada, se cerró Holy, se restauró el servicio común0.9.31 y se pidió el relevo normal a Mac. Windows cedió y quedó en respaldo. La apertura normal del IPK mostró **Inicio,351tarjetas,Mi cola,conexión a Mac y ningún descriptor de reproducción**. El manifiesto instalado confirma0.9.31. Mac y Windows respondenHTTP200; el canal de biblioteca está sincronizado. Un único dueño local del runtime: el worker del servicio común; no quedan validadores activos.

Se comparó el historial con el respaldo: **57entradas idénticas**, sin nuevas reproducciones sintéticas. Se conservó el título de la cola real que ya estaba guardado antes de este último ensayo; no se restauró ciegamente un respaldo antiguo sobre cambios legítimos. Cola sin los títulos sintéticos del ensayo, preferencias con Google. La captura del Inicio real queda privada porque incluye historial del usuario. Resumen de restauración sin ese historial en `deployment.json`.

## Pendientes

El cierre al abrir Doodstream y los cierres nativos ya investigados siguen abiertos; no hay evidencia suficiente para atribuirlos a memoria, al sitio o a una llamada concreta. No se retiró un proveedor entero ni se alteraron las protecciones por una muestra. No se promete película completa, reproducción prolongada, todos los servidores o Internet en general. La cola continúa local por computadora y Windows requiere el mismo backend antes de validar allí las funciones nuevas y el relevo.

La autenticación general LAN, confianza SSH del primer contacto y alertas transitivas del SDK/compilación mantienen el seguimiento de [endurecimiento](ENDURECIMIENTO-20261107.md) y [auditoría](REVISION-CALIDAD-SEGURIDAD-20261107.md).
