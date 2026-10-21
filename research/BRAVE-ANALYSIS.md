# Análisis del bloqueo de Brave para Luma

Revisión del 21 de octubre de 2026. Se estudiaron los componentes de filtrado relevantes y se ejecutaron adaptaciones. **No se auditó todo el código de Brave**, Chromium ni la seguridad de su motor.

## Código examinado

1. `brave/adblock-rust`: README, API Rust `Engine`, `Request`, `FilterSet`, API Node, ejemplos y pruebas de bindings. Versión ejecutada: adblock-rs 0.13.3 en Mac y crate adblock 0.13.3 en WASM. El adaptador usa la API del crate publicado, que no coincide en todos los nombres con el master consultado.
2. `brave/brave-core/browser/net/brave_ad_block_tp_network_delegate_helper.cc`: integra las decisiones de filtrado con la red del navegador, controla excepciones, solicitudes propias/terceras, reescritura, redirecciones y resolución de CNAME.
3. `brave_ad_block_csp_network_delegate_helper.cc`: integración de reglas de CSP en el navegador. No se implementó ese componente en Luma.
4. `brave/adblock-resources`: README y recursos JSON publicados. Se cargaron sus 17 recursos personalizados en el motor del Mac. Esto **no equivale a cargar todos los recursos, listas y scriptlets utilizados por una distribución completa de Brave**.

Las copias revisadas están en esta carpeta. Las referencias upstream y los SHA-256 de archivos están en [provenance.json](provenance.json). Los SHA de master son referencias de consulta, mientras que package-lock.json y wasm-engine/Cargo.lock fijan lo ejecutado.

## Cómo funciona y qué se adaptó

El motor recibe URL de solicitud, URL de origen, tipo de recurso y método HTTP. Evalúa reglas, excepciones y prioridad; produce una decisión de bloqueo, una respuesta de reemplazo o una URL reescrita. Por separado calcula selectores CSS, excepciones cosméticas y código de scriptlets.

La biblioteca **no intercepta tráfico por sí sola**. En Brave esa integración reside en el navegador. En Luma hay tres integraciones diferentes:

- **Mac + inspector de TV:** `Fetch.requestPaused` de CDP entrega las solicitudes al motor Node. Se responden localmente las bloqueadas. Las permitidas continúan hacia su destino. Las páginas siguen renderizándose en la TV; el Mac no transmite una imagen del navegador.
- **WASM en TV, después de load:** el motor decide correctamente, permite aplicar CSS a un iframe controlado y filtrar llamadas fetch posteriores. Llega demasiado tarde para impedir solicitudes iniciales.
- **WASM en TV, antes del render:** una página HTML propia se descarga como texto, se prefiltran referencias estáticas y se instala un hook antes de sus scripts. El iframe srcdoc resultante pasó las pruebas controladas. Esta transformación cambia el contexto de navegación, y aún no sirve como navegador general seguro.

Se usaron EasyList y EasyPrivacy con sus cabeceras de versión y licencia conservadas. Las reglas `/ad-fixture/` y selectores de laboratorio son adicionales y solo justifican métricas de pruebas controladas. Los resultados de sitios reales usan EasyList y EasyPrivacy sin las reglas de fixtures.

## Qué queda fuera de esta adaptación

- Partición de cookies y almacenamiento de terceros, almacenamiento efímero y aislamiento completo de sitios.
- Aleatorización de fingerprinting, integración de CNAME en DNS, listas antiphishing y comportamiento equivalente de HTTPS.
- Conjunto completo de listas específicas de Brave, recursos uBO y mantenimiento automático de sus actualizaciones.
- Aplicación completa de reglas cosméticas procedurales y todos los scriptlets de sitios reales.
- Cobertura demostrada de WebSocket, workers, service workers existentes, popups/nuevas ventanas y peticiones iniciadas por otras aplicaciones.
- Integración estable con DRM, descargas, certificados, permisos de cámara/micrófono y reproducción con publicidad insertada en el video.

La conexión experimental deshabilita caché y evita service workers para que las comparaciones sean repetibles; no reproduce el entorno normal completo de Brave. Al finalizar las pruebas se restauran esos ajustes del inspector.

El hook temprano se prepara para navegaciones iniciadas por la barra de Luma. Se comprobó un marcador antes del script de la página controlada; no demuestra esa misma cobertura temporal para todos los cambios de origen, marcos o navegaciones iniciadas dentro de cualquier sitio.

## Resultado defendible

El motor real funciona en la TV y el filtrado de red por el inspector funciona contra solicitudes reales. No hay una cifra válida de “porcentaje de Brave replicado”: no existe un denominador acordado y las capacidades tienen impactos muy diferentes.

Sí hay porcentajes reproducibles: 7/7 solicitudes controladas bloqueadas y 8/8 recursos legítimos preservados con CDP; la misma cuenta con prefiltrado local de HTML propio. Un hook instalado después de load bloqueó 0/7 solicitudes iniciales. Ninguna de esas cifras mide todos los anuncios de Internet.

## Fuentes

- [Motor adblock-rust](https://github.com/brave/adblock-rust)
- [Integración de red en brave-core](https://github.com/brave/brave-core/blob/master/browser/net/brave_ad_block_tp_network_delegate_helper.cc)
- [Recursos de Brave](https://github.com/brave/adblock-resources)
- [Brave Shields](https://brave.com/shields/)
- [EasyList y licencias](https://easylist.to/pages/licence.html)
