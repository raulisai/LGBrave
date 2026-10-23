# Pestañas · 0.8.0

La fila superior aparece en Inicio y en la barra de páginas. «+» abre un Inicio nuevo; pulsar un nombre cambia a esa pestaña y su × la cierra. Al cerrar la activa se elige la vecina; al cerrar la última queda un Inicio nuevo. Hay hasta doce pestañas por sesión. Los nombres se insertan como texto, sin interpretar HTML.

Esta versión usa **pestañas suspendidas**: webOS mantiene una página activa. Cambiar de pestaña vuelve a cargar la dirección seleccionada e intenta recuperar su desplazamiento. Cada pestaña conserva un historial independiente de hasta cien direcciones; Atrás/Adelante no deben recorrer las otras pestañas. Los formularios, el estado interno de una web y la reproducción de vídeo no se conservan al cambiar. No hay reproducción en segundo plano ni múltiples páginas vivas. No se han retirado restricciones de iframes ni cabeceras de seguridad.

Las pestañas viven solo en la memoria del Mac y no se escriben a disco: las direcciones de reproductores pueden contener tokens. El runtime las conserva ante una reconexión al mismo target de Luma; las descarta al observar que la app se cerró o cambió su instancia. Un reinicio del proceso del Mac también las pierde. La reconexión continúa siendo pasiva: no abre Luma ni crea ventanas nativas.

En Inicio se usa la navegación espacial existente. En páginas, Arriba desde la dirección lleva a las pestañas; Izquierda/Derecha recorren los controles y Abajo regresa a la dirección. La fila y la barra se ocultan juntas al leer; se recuperan desde el borde superior o las teclas de color. El chip de diagnóstico está oculto por defecto en ambas superficies y solo se muestra con `LUMA_DEBUG=1 npm run lab`; conectarse al Mac no activa depuración. La protección sigue disponible en Configuración.

## Implementación y verificación

- `scripts/browser-tabs.mjs`: modelo en memoria, selección, cierre e historiales.
- `scripts/browser-bridge.mjs`: comandos `new-tab`, `select-tab`, `close-tab`, captura/restauración y estado compartido.
- `scripts/lab-runtime.mjs`: conservación solo dentro de la misma instancia de Luma.
- `src/App.svelte`, `scripts/toolbar.mjs`: controles de Inicio y páginas.
- `npm test`: ocho comprobaciones nuevas de pestañas e integración con CDP simulado; regresión del runtime para reconectar y descartar sesiones. Incluye cambios rápidos de pestaña antes de terminar una carga, cierre de la última y separación de historiales.
- Chrome de escritorio a 1920 × 1080: siete recorridos con clics y teclas, chip de diagnóstico oculto/visible y capturas revisadas en `evidence/tabs-0.8.0/desktop/`. Esto no es una validación en TV ni cobertura general de Internet.

Paquete: `artifacts/com.lgapp.lab_0.8.0_all.ipk`. Incluye la ocultación del diagnóstico de la sesión anterior. **Instalación y validación en TV pendientes**: el chat «Arquitect Main» está usando esa misma TV para otras pruebas; se pidió al usuario confirmar que ya está libre antes de intervenir. No se inició ningún interceptor ni navegación de prueba en la TV desde este trabajo.

## Reanudar vídeo y límite de la plataforma (2026-10-23)

Prueba en la TV (CDP, Luma en Inicio): `Target.createTarget` responde «Not supported» y `window.open` no crea otra ventana: **reemplaza la única página de la app** (quedó en `about:blank` y hubo que volver a Inicio). webOS da una sola página por app, así que no hay pestañas vivas en paralelo; la única vía serían iframes, que exigen quitar cabeceras de seguridad (descartado). Evidencia: salida de la prueba descrita aquí; no se guardó captura.

Mitigación en el Mac: al salir de una pestaña se guarda el segundo del vídeo más largo (documento o iframes, solo si pasó de 3 s) y, al recargarla, se intenta reponerlo durante 90 s (si estaba reproduciendo, intenta `play()`; el reproductor puede pedir un clic). Se guarda también el desplazamiento. Solo en memoria. Sin validar en TV; no sirve para vídeos en vivo ni para reproductores que ignoran `currentTime`.
