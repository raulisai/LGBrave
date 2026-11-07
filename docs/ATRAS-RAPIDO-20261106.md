# Atrás rápido y animación de retorno · 2026-11-06

## Problema y causa reproducida

El usuario describe negro durante 30–60 segundos al salir de una película, o la
necesidad de pulsar Atrás repetidamente. El código esperaba limpieza del
reproductor (`Runtime.evaluate`), retirada de cortina y envío de estado antes de
mandar `Page.navigate`. Cada petición CDP admite 15 segundos. La ruta del control
consideraba suficiente tener heartbeat vivo y no tenía un respaldo si ese
comando no lograba navegar. Esa dependencia se reproduce con CDP bloqueado en
una prueba controlada; no identifica por sí sola todos los posibles bloqueos LG.

## Cambio

- Atrás desde película o capítulo cancela la sesión y guarda el último progreso
  observado inmediatamente. Envía stopLoading y navegación al inicio sin esperar
  a JavaScript del sitio, cortina ni estado. Las repeticiones en vuelo se agrupan.
- La limpieza queda ligada al contexto anterior. Un retorno local al inicio
  procesa su frame sin esperar esa limpieza, para no retrasar la interfaz nueva.
- El control muestra al instante un indicador ligero con «Volviendo al inicio…»:
  anillo giratorio, texto y fondo uniforme; sin imágenes, blur ni innerHTML.
  Respeta la preferencia de movimiento reducido. También funciona con foco en
  un iframe, que solicita el indicador a su página superior.
- Con puente vivo pero sin navegación, un temporizador local de 800 ms intenta
  ir al inicio. Es el plazo para iniciar el respaldo, no una garantía de que una
  TV sin red o con su renderizador bloqueado cargue el menú en ese tiempo.
- Cerrar el selector de idioma confirma la acción y retira el indicador, sin
  abandonar el vídeo. El aviso beforeunload del sitio se acepta únicamente
  mientras el usuario ya pidió salir. Otros diálogos no se contestan.
- Las cortinas de abrir/cambiar idioma/sitio/servidor excluyen el inicio de Holy,
  aunque tarde en retirarse su script. «Ver capítulos» sigue disponible mediante
  su opción explícita; el botón Atrás va directamente al inicio.

## Verificación

`scripts/test-holy-fast-back.mjs`: 23 regresiones controladas, sin TV ni Internet:
CDP/limpieza/estado sin respuesta, pulsaciones repetidas, fallo al guardar,
cancelación durante resolución, lista explícita de capítulos, llegada local al
inicio, selector de idioma, beforeunload, animación, movimiento reducido,
respaldo, confirmación, inicio ya cargado, sin binding, iframe y relevo de dueño.
Se conserva la prueba de capítulos y se actualiza la expectativa de Atrás a la
solicitud del usuario; no se elimina esa regresión para ocultar un fallo.

La prueba física del control y el tiempo percibido en LG quedan pendientes de
confirmación del usuario. No se navega ni se interrumpe su vídeo para ejecutar
esta suite. El cambio es del backend que inyecta el control: no necesita un IPK
nuevo. Ambos equipos deben actualizarlo para usarlo cuando atiendan la TV.

## Segunda demora de inicio

El usuario precisó que, tras desaparecer la animación, continuaban 15–30s de
negro antes del menú. No se da por resuelto con su primera confirmación.
El registro del ensayo mostró un segundo navigate que abortó el primer retorno
a los800ms. Ahora el Document propio confirma la navegación sin retirar el
indicador. La TV también expone file://com.lgapp.holy-webos/…: se reconoce como
el mismo archivo propio, sin aceptar imitaciones HTTP.

Un script aislado al inicio del documento nuevo dibuja el indicador antes de
Svelte y lo mantiene hasta observar el encabezado visible durante dos frames;
no lo retira por un temporizador. Durante ese arranque Atrás no puede cerrar la
app accidentalmente. Se priorizan binding y assets del inicio propio sin pasar
por JavaScript de seguridad del reproductor ni filtros de anuncios. Se aplaza
la lectura/parseo de caché grande hasta después del primer frame del menú.
Las nuevas regresiones cubren demora prolongada, reconocimiento del archivo
WAM, assets/binding y confirmación sin abortar la carga. Segundo ensayo LG pendiente.

Segundo gate completo correcto:35casos/12fuentes,23regresiones Atrás,3builds.
Huella estable ad3ac6c9452953a1988327313dd12fd74e916197503b16b6d7aef94657176241.
Windows recargado pasivamente y conectado a Holy, sin navegar el vídeo.
Evidencia sanitizada: evidence/holy/fast-back-validation-20261106.json.
