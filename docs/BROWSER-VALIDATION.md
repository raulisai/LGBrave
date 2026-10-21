# Validación de navegador y bloqueo en LG

Fecha: 21 de octubre de 2026. Equipo: LG 75UR8750PSA, firmware 33.31.75, SDK 10.3.2. La IP 192.168.1.134 se confirmó con el usuario y autenticación; Developer Mode seguía activo. No se volvió a obtener una lectura exacta del contador en esta fase.

## Resultados medidos

| Prueba | Resultado | Alcance |
| --- | --- | --- |
| Semántica del motor Node | 15/15 correctas | Dominio, tipo, terceros, excepciones, important, reemplazo, removeparam, CSS y scriptlet |
| Motor Brave en WASM dentro de la TV | 5/5 comprobaciones correctas | Anuncios conocidos, rastreador, contenido permitido y excepción |
| Inicialización WASM con listas | 2,674 ms | Una ejecución; no un benchmark estadístico |
| Memoria lineal WASM | 48,627,712 bytes ≈ 46.4 MiB | No incluye DOM, JS, proceso ni toda la RAM de la app |
| Fichero WASM | 2,244,249 bytes | Motor más adaptador local |
| Listas cargadas en WASM | 141,878 líneas | Incluye comentarios y cabeceras; no es un recuento de reglas activas |
| Hook local después de load | 0/7 solicitudes iniciales bloqueadas | Demuestra la limitación de intervenir tarde |
| Hook local fetch posterior | Solicitud publicitaria impedida; legítima preservada | Una pareja de solicitudes controladas |
| Prefiltrado local de HTML propio | 7/7 bloqueadas, 8/8 legítimas preservadas | Fuente y estructura conocidas; no acredita compatibilidad general |
| Interceptor CDP + motor Mac | 7/7 bloqueadas, 8/8 legítimas preservadas | Verificado contra registros del servidor, además de decisiones del motor |
| Filtrado cosmético | 3 elementos visibles → 0 | Incluye elemento insertado dinámicamente con selector ya conocido |
| Scriptlet temprano en navegación preparada | Marcador presente antes del script de página | Solo prueba controlada, no todos los scriptlets de Brave |
| UI | 1920 × 1080, sin desbordamientos | Captura real de la TV, no maqueta |

### Sitios públicos, última pasada

| Sitio | Solicitudes observadas | Bloqueadas | Observación |
| --- | ---: | ---: | --- |
| Example Domain | 2 | 0 | Contenido renderizado |
| MDN Web Docs | 66 | 1 | Contenido y barra de Luma renderizados |
| BBC | 153 | 30 | Contenido y barra de Luma renderizados |

Los recuentos cambian con región, contenido, consentimiento, tiempo y estado de la página. **30 solicitudes bloqueadas no equivale a 30 anuncios ni demuestra ausencia de todos los anuncios.** No se inició sesión ni se validó cada enlace o reproductor de esos sitios.

En la regresión de la versión 0.4.0, Example Domain y MDN volvieron a cargar; BBC agotó la espera de la prueba. Los 30 bloqueos de BBC de la tabla corresponden a la pasada anterior exitosa, no a una carga acreditada en esa regresión. El archivo JSON guarda el resultado de la última ejecución.

## Comportamientos específicos de esta TV

- La app empaquetada pudo leer y modificar un iframe HTTP del laboratorio y obtener una respuesta sin CORS. Esto contradice una extrapolación genérica de las restricciones de un navegador de escritorio. No se extrapola ese permiso a todos los contextos o URLs.
- `chrome.webRequest`, `chrome.declarativeNetRequest` y `webview.loadURL` no estaban expuestos en el contexto probado. WebAssembly sí funcionó.
- Una respuesta `X-Frame-Options: DENY` produjo un rechazo explícito en consola y destruyó el contexto de la prueba. La aplicación pasó por un error de carga. Esta prueba se aisló de la suite para poder continuar. No se eliminaron cabeceras de seguridad de sitios públicos.
- `Fetch.failRequest` sobre un marco publicitario provocó la página de error de WAM. La implementación actual evita contactar al destino y devuelve una respuesta local vacía válida. No son exactamente los mismos eventos de error que recibiría un sitio bajo Brave.
- Volver a la app file:// después de navegar a HTTP produjo una página sin recursos ejecutados en una iteración. Se cambió el bundle a script clásico IIFE y el regreso del modo asistido usa una copia de la página de inicio servida por el Mac. El inicio empaquetado funciona al lanzar la app normalmente.
- La barra superpuesta vive en un mundo aislado de JS, y el binding del Mac no se expuso en el mundo principal del sitio MDN. Sin embargo, el DOM y la presentación siguen bajo influencia del sitio: no es una barra de navegador con las garantías de seguridad de la interfaz nativa de Brave.
- Se observó un corte SSH `ECONNRESET` en la CLI oficial durante la sesión. El iniciador `npm run lab` reconecta inspector y motor en ese caso. La app sigue instalada aunque la protección asistida requiere una conexión activa.

## Qué significa “autónomo” en estas pruebas

El motor y las decisiones WASM se ejecutaron en la TV, sin `Fetch.enable` ni evaluación de reglas en Node. El Mac siguió sirviendo una página controlada como cualquier servidor web y guardando sus accesos; el inspector se usó para iniciar la prueba y leer resultados. No se afirma funcionamiento sin red, ni compatibilidad de navegación pública completa sin Mac.

El prefiltrado local solo acepta el fixture propio. No se expuso como navegación arbitraria porque srcdoc altera origen, URL, cookies y comportamiento de scripts; todavía falta diseñar aislamiento seguro y compatibilidad.

## Evidencias

En `evidence/browser-lab/`:

- `validation.json`: línea base, bloqueos CDP, decisiones por solicitud y sitios reales.
- `engine-validation.json`: 15 pruebas del motor en Mac.
- `native-validation.json`: motor WASM, memoria, tiempos, limitaciones del hook tardío y registros del servidor.
- `native-prefilter-validation.json`: prefiltrado en TV y comprobación de solicitudes recibidas.
- `navigation-ui.json`: favoritos y regreso por la barra con interacciones automatizadas.
- `ui-verification.json`, `safari-final.png`: comprobación y captura de la interfaz final.
- `fixture-before.png`, `fixture-after.png`: comparación visual controlada.
- `site-*.png`: capturas de sitios públicos.

## Límites pendientes y siguiente fase

El avance demuestra el motor y varias formas de integrarlo. No demuestra equivalencia con Brave en fingerprinting, cookies, CNAME, antiphishing, anuncios insertados en video, YouTube, DRM, login, aislamiento de sitios o consumo sostenido.

La siguiente decisión técnica es cómo conservar el contexto y el aislamiento originales de cada sitio sin un interceptor de navegador disponible para una app normal. El prefiltrado podría ampliarse, pero requiere medir compatibilidad y fugas por cada clase de recurso; no debe presentarse como un navegador universal todavía.

DNS queda pendiente para una fase posterior, por solicitud del usuario. No se cambiaron DNS, firmware, bootloader, particiones ni configuraciones globales de red de la TV.
