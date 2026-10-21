# Navegación y carga · Luma 0.4.0

Corrección del 21 de octubre de 2026 en la LG 75UR8750PSA.

## Fallos encontrados

La barra de inicio y la barra superpuesta usaban resolutores distintos. La segunda anteponía `https://` a texto de búsqueda, produciendo direcciones inválidas. Además, el Mac podía conservar una conexión con un target anterior después de volver a abrir la app. En la primera reproducción, la app visible no tenía el binding del puente y mostraba que estaba desconectada.

Al probar realmente “anime j k”, Brave Search respondió HTTP 429. Google, Bing y DuckDuckGo HTML entregaron resultados en la TV durante la comprobación. Se eligió DuckDuckGo HTML como buscador predeterminado; el filtrado sigue usando el motor de Brave.

Se detectó también que las políticas CSP de algunas páginas impedían aplicar el estilo de la barra mediante un elemento style. Se adoptaron hojas de estilo construidas con CSSOM para la barra aislada y los filtros cosméticos. No se retiraron las cabeceras CSP de los sitios.

## Cambios

- Resolver único de URLs y búsquedas en la app, la barra y el puente. URLs con credenciales o protocolos distintos de HTTP(S) se rechazan con un mensaje.
- Spinner, progreso por etapas y panel de carga antes y después de la navegación. Las etapas no se presentan como porcentaje de bytes descargados.
- Transiciones de entrada, foco y pulsación, con soporte de `prefers-reduced-motion`.
- Mensajes de error para respuestas HTTP, conexiones fallidas, páginas vacías y tiempos de espera. Se ofrecen Reintentar e Inicio.
- Recuperación a la página local con el error visible cuando vence el tiempo de espera, para evitar depender de un documento remoto detenido.
- Protección frente a eventos de carga de la página anterior, estados tardíos de navegaciones canceladas y cambios dentro del documento.
- Reconexión cuando cambia la instancia de la app, aunque el túnel SSH siga abierto. Al reconectar se conserva la página actual cuando es posible.

## Verificación

`scripts/test-navigation.mjs`: 15 casos de URL, consultas con espacios y acentos, direcciones locales, codificación y rechazo de entradas inválidas.

`scripts/validate-navigation.mjs`: ocho comprobaciones en la TV:

1. Buscar “anime j k” desde la barra inicial usando eventos de teclado.
2. Buscar “anime de Jota k” desde la barra de una página abierta.
3. Mostrar y retirar el indicador en una carga lenta; comprobar estilo y movimiento reducido.
4. Mostrar error HTTP 503.
5. Verificar que Reintentar inicia otra navegación.
6. Detectar una página vacía.
7. Mostrar tiempo de espera y recuperar la interfaz local.
8. Poder navegar de nuevo después del error.

Las pruebas pasaron. Son interacciones automatizadas con la TV real; no acreditan por sí solas cada combinación del teclado virtual y el control físico.

La regresión de bloqueo conservó 7/7 solicitudes controladas impedidas y 8/8 legítimas preservadas. Example Domain y MDN cargaron; BBC agotó la espera en esa pasada y se registró como no verificado.

## Evidencia

En `evidence/navigation-fix/` están `validation.json`, `search-providers.json`, capturas de resultados desde ambas barras, carga, errores y recuperación. Los resultados de buscadores externos pueden cambiar y sus límites de solicitudes siguen dependiendo del proveedor.
