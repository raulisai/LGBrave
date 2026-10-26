# Sincronización de bibliotecas · 0.9.13 · 2026-10-26

## Estado entregado

Windows tiene el canal nuevo en ejecución y quedó emparejado mediante el SSH webOS existente. La Mac anterior responde como needs-update cuando está disponible; al cierre necesita actualizar el repositorio y ejecutar mac/Activar-sincronizacion.command. Las tareas completas están en TAREAS-MAC-SINCRONIZACION.md. No se afirma que el intercambio continuo ya esté activo en la Mac antigua.

Antes de activar el canal se respaldaron los gustos de ambos equipos fuera de Git y se combinaron mediante sus API existentes. Ambas copias coincidieron en la valoración que ya tenían. El historial completo y sus posiciones se combinarán cuando el servicio nuevo arranque también en la Mac.

## Canal de datos

Cada computadora mantiene su biblioteca persistente. Cada ~5 segundos consulta al otro equipo por HTTP privado en el puerto ya usado por Holy; transmite la biblioteca solo cuando difiere su huella. Los mensajes y respuestas se cifran con AES-256-GCM y se firman con HMAC-SHA256; se comprueban tiempo, nonce, identidad y contenido. Las peticiones repetidas, firmas inválidas y orígenes de páginas web se rechazan. No se publica una API anónima de importación de perfiles.

La primera vinculación usa el acceso SSH a la misma TV: una transacción SFTP breve, protegida con flock y timeout, guarda la clave del grupo y las direcciones en un registro temporal. No reserva el inspector ni instala otro interceptor. Las credenciales se guardan por usuario fuera del repositorio: LOCALAPPDATA/HolyLuma en Windows y ~/.config/HolyLuma en Mac. Nunca se imprimen, incluyen en URL ni se exportan en informes.

Después del emparejamiento los datos viajan directamente Mac↔Windows. La TV puede estar apagada. Si falta un equipo, los cambios permanecen en el archivo local y se combinan al regresar. El registro de TV ayuda a descubrir direcciones nuevas cada 30 segundos; si está apagada se mantienen las conocidas. No hay servidor en la nube ni requisito de activar SSH en la Mac.

## Datos y conflictos

Se comparten historial/posición de Continuar viendo, Me gusta/Me encanta/No es para mí, preferencias, idiomas y marcas de borrado. Las valoraciones borradas no reaparecen al conectarse una copia antigua. Las entradas se combinan por modificación, no tomando siempre el minuto más alto: un retroceso deliberado debe conservarse. Los cambios locales que llegan durante una respuesta remota no se reemplazan. Un reloj lógico protege los eventos después de observar una fecha remota mayor.

Una posición pausada sin cambios no publica una fecha nueva ni pisa la posición recibida del otro equipo. El progreso se sigue guardando por el registro de película/serie existente; la fila conserva el último episodio de cada serie, no un historial independiente de cada episodio visto. Antes de la primera combinación hay respaldo .before-sync. La sincronización de datos es independiente de quién tenga la reserva exclusiva de asistencia de TV.

## Navegador

Un sitio externo no informa automáticamente su reloj a la página Holy. Se preparó Holy Companion para Chrome/Brave/Edge, con sesiones de reproducción acotadas a los vídeos abiertos desde Holy. Cada sesión está vinculada al título público, usa un token aleatorio, secuencias para ignorar muestras viejas y caduca en 24 horas. No guarda enlaces firmados del reproductor en el servidor. El complemento registra avances mientras cambian y eventos de pausa/final/salto, e intenta reanudar al abrir el vídeo.

El complemento se genera con npm run browser:companion; la instalación y los permisos por proveedor requieren un paso del usuario en cada navegador. No se ha instalado automáticamente en Chrome/Brave/Edge ni se afirma que todos los proveedores funcionen. Sin complemento, las valoraciones/biblioteca sí se comparten; el minuto de un vídeo externo solo se conserva si lo reporta algún cliente compatible. La TV ya lo reporta sin extensión.

## Validación

- Suite npm test completa y tres builds correctos. Se añadieron cinco pruebas: protocolo bidireccional, dos servidores HTTP, sesiones web, API completa y complemento.
- Se cubrieron mezcla de cambios offline, borrados, idiomas, retrocesos, reloj anterior, respuesta en carrera con escritura local, posición pausada, cifrado/alteración/firma/repetición y mensajes sin contenido cuando las copias ya coinciden.
- HTTP real en Windows con dos bibliotecas simuladas: un Me gusta y el segundo 160 cruzan en ambos sentidos. No equivale a haber activado el servicio nuevo en la Mac física.
- Complemento: worker y script reales con APIs Chrome simuladas; sesión para el vídeo vinculado, exclusión de otras pestañas, reanudación y datos de progreso. No instalación física comprobada.
- Emparejamiento real Windows↔TV: correcto, sin navegar ni intervenir en el vídeo. Se reinició el servicio de Windows para cargar el canal; siguió conectado a Holy y el reproductor conservó Between Steps capítulo 5, posición >1244 s (3981 s de duración), comprobado sin navegar.
- El activador de Mac pasó bash -n desde Windows; no se ejecutaron sus comandos en macOS. No se modificó el firmware, DNS, protecciones de Windows ni arranque automático.

Pendiente del lado Mac: actualizar código, ejecutar el activador y verificar los datos reales de ambos equipos; instalar el complemento si se desea el minuto desde el navegador. Los archivos están listos para ese paso, preservando .local y la configuración de cada equipo.
