# Holy Companion · progreso del navegador

Este complemento es opcional para el catálogo y las valoraciones, y necesario para registrar automáticamente el minuto de un vídeo abierto en un sitio externo desde Chrome/Brave/Edge. La TV ya registra su posición mediante el servicio habitual.

## Instalación por usuario

Ejecuta npm run browser:companion. En el navegador abre su página de extensiones, activa el modo desarrollador y carga la carpeta artifacts/holy-companion como extensión descomprimida. No se ha instalado automáticamente ni se han aceptado permisos por el usuario.

Recarga la página de Holy después de instalar. Abre el vídeo desde Holy. Para un proveedor no declarado de antemano, abre el icono del complemento en la pestaña del vídeo, pulsa Guardar progreso de este vídeo y autoriza ese sitio. Los frames de otro origen necesitan permiso para su proveedor; no se promete compatibilidad con todos los reproductores.

Mantén el servicio local de Holy ejecutándose. El progreso guardado en él se transmite al otro equipo por el canal cifrado. Al cerrar el navegador desaparecen las sesiones temporales del complemento; el progreso ya guardado permanece en la biblioteca.

## Datos y permisos

El seguimiento se limita a una pestaña/iframe vinculado a una reproducción abierta desde Holy. Una pestaña cualquiera no recibe sesión ni se lee su vídeo. El complemento envía segundo, duración, secuencia y tamaño visible, y trata de reanudar al minuto recordado. No copia cookies, contraseñas o navegación general. Los tokens de sesión se mantienen en storage.session; las URL del reproductor se reducen a origen/ruta para vincular la pestaña, sin guardar sus parámetros firmados. La sesión del servidor contiene solo el título público y expira en 24 horas.

Los orígenes locales de Holy y proveedores habituales se declaran en manifest.json; un proveedor nuevo se solicita con un clic del usuario. No hay acceso obligatorio a todas las páginas HTTPS. El generador añade las direcciones locales configuradas; si cambian, vuelve a generarlo y recarga la extensión.

Arquitectura basada en [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) y [storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage). Todo el JavaScript está incluido localmente, sin código remoto.

## Validación

Pruebas automatizadas con las implementaciones reales del worker y el script de vídeo y APIs Chrome simuladas; pruebas HTTP reales del registro y sincronización de progreso. Instalación y reproducción en navegadores físicos pendientes. Las tareas Mac están en docs/TAREAS-MAC-SINCRONIZACION.md.
