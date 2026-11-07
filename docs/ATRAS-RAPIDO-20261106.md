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

`scripts/test-holy-fast-back.mjs`: 30 regresiones controladas, sin TV ni Internet:
CDP/limpieza/estado sin respuesta, pulsaciones repetidas, fallo al guardar,
cancelación durante resolución, lista explícita de capítulos, llegada local al
inicio, selector de idioma, beforeunload, animación, movimiento reducido,
respaldo, confirmación, inicio ya cargado, sin binding, iframe y relevo de dueño.
Se conserva la prueba de capítulos y se actualiza la expectativa de Atrás a la
solicitud del usuario; no se elimina esa regresión para ocultar un fallo.

La suite no navega la TV. El ensayo físico autorizado de0.9.27 y sus tiempos
están al final de este informe; la confirmación inicial de0.9.26 no bastó.
El cambio del backend no necesita un IPK nuevo. Ambos equipos deben
actualizarlo para usarlo cuando atiendan la TV.

Alcance del despliegue: el aplazamiento de caché en `src/Holy.svelte` corre en el
inicio HTTP `/holy/` servido por el build0.9.26. El IPK instalado sigue0.9.24:
si webOS reabre el inicio `file://…`, sus assets empaquetados conservan la lectura
de caché anterior. El indicador inyectado sí cubre documentos nuevos mientras
el runtime esté conectado, pero no sustituye los assets del IPK. Cubrir también
ese primer arranque con el nuevo Svelte requerirá empaquetar/instalar0.9.26 y
validarlo aparte. No se instaló un IPK nuevo en esta revisión.

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

## Causa reproducida en LG y corrección0.9.27

El usuario confirmó que0.9.26 seguía tardando, ahora bajo «Cargando el inicio».
Con prueba autorizada: documento propio200 en~1s; primerScript200 con cabecera
X-Luma-Blocked:1, encodedBodySize/decodedBodySize0 y #app vacío45s. El filtro
seguía usando la identidad anterior del reproductor porque Fetch delScript
puede adelantarse a frameNavigated. Recargar una vez establecido el inicio
recibió171235B deJS y montó el menú en3356ms. Esto identifica la regresión de
red; el indicador anterior no solucionaba esa causa.

La excepción de assets propios usa documentURL del evento Network de ese
mismo networkId y frame raíz. El primer ensayo con solo esa correlación
volvió a fallar: elScript tenía networkId, pero Fetch llegó sin identidad
Network disponible. Por eso también se conserva el Document raíz propio
observado directamente por Fetch; solo permite sus JS/CSS públicos en
`/holy/assets/`, y se borra al navegar a otro Document externo o confirmar un
frame raíz externo sin petición Document (historial/BFCache). No acepta
Referer como prueba ni amplía acceso a API, iframes u otros equipos. El mapa
Network está acotado a256 y se consume por petición. Las30 regresiones
incluyen ambos órdenes de eventos, ausencia de networkId, cambio a sitio
externo y peticiones no autorizadas.

### Resultado físico final

Con el backend0.9.27 activo en Windows y un único observador CDP, sin otro
interceptor: dos regresos desde el mismo episodio de YouTube al inicio HTTP
montaron el menú visible en **3390ms y2745ms**, medidos desde una sola orden
Atrás. Ambos recibieron **171235B de JS**, sin X-Luma-Blocked, con encabezado
visible y señal de pintura del inicio. Antes el mismo primerScript tenía0B y
la app seguía vacía tras45s. Se restauró el mismo vídeo al segundo1690.0884;
la verificación posterior encontró readyState4, sin pausa y tiempo avanzando.
Google y las preferencias se conservaron. No se extrapola a todos los
proveedores ni a cualquier red. Mac estaba apagada y requiere actualizar main
y reiniciar su backend. Evidencia sanitizada:
`evidence/holy/fast-back-0927-20261106.json`.

### Mejora de CPU separada

El perfil del catálogo real (1472títulos,47entradas de historial,22votos y8
preferencias) encontró40211 consultas de voto por cálculo del inicio. Cada
consulta repetía normalización/búsqueda de toda la lista. Ahora se indexan
dirección y título por versión, manteniendo la primera coincidencia global
del algoritmo anterior. No cambia el orden, la afinidad ni los motivos.

Medición local de escritorio: Catalog.home pasó de2161–2599ms a~495ms. Los
JSON completos de inicio y packHome fueron idénticos con reloj fijo; las15
pruebas de gustos incluyen equivalencia y cambios/borrado/importación. Esta
mejora reduce CPU, pero **no explica elScript vacío**; los tiempos de Windows
no se presentan como tiempos de la TV.

Gate final completo:36casos/12fuentes, suite completa (30 regresiones Atrás y15
gustos) y3builds correctos. Huella de entrada/salida idéntica:
`b625573d5ae5a0b16eaccb628c7e2aea939f3b2f48c7f2355c4bc1ed9d88f202`.
Código final aplicado con reinicio pasivo del backend; sin reinstalar IPK/EXE.
