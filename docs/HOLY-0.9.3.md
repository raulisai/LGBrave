# Holy y Luma 0.9.3 · diagnóstico, gustos, clásicos y recuperación

Fecha local: 2026-10-25, México. El trabajo previo sin commit se conservó. No incluye firmware, DNS, arranque de la TV ni particiones.

## Hallazgos reales de la conexión

- La TV fotografiada tiene Developer Mode y Key Server activos. La passphrase de la imagen no se copió a archivos ni registros.
- Windows actual: `192.168.1.65`. TV: `192.168.1.134`. El perfil y una llave utilizable sí existen: una sesión SSH real autenticó y ejecutó únicamente consultas.
- Se observó discrepancia entre el trabajador (perfil ausente, setup) y el controlador recién abierto (perfil presente). Reiniciar el servicio desde el entorno actual resolvió ese estado. No se determinó retrospectivamente por qué el proceso anterior leía un estado distinto; no era prueba de que el usuario debiera volver a vincular.
- Después aparecieron dos y luego tres conexiones del inspector ya abiertas. Consultas de red de la TV mostraron SSH desde otra computadora `192.168.1.102`; el usuario confirmó que puede haber una laptop encendida. No se cerraron ni se atribuyeron forzosamente esos canales a un proceso ajeno.
- El PC quedó en `standby`: **En respaldo · la TV tiene otra sesión activa**. Es un estado normal; el controlador público usa `standbyReason` para el detalle, sin presentar una falta de vinculación. No se lanzó ni navegó ninguna aplicación de la TV ni se cambió el buscador.

## Doctor y recuperación

`npm run desktop:repair` ejecuta el Doctor; `desktop-control.mjs doctor` también repara y presenta un diagnóstico, para que funcione con el botón Diagnóstico del EXE ya instalado. `desktop-control.mjs diagnose` es consulta sin reparación.

El Doctor puede iniciar el servicio detenido y recargar un trabajador obsoleto, colgado o con error de conexión cuando hay perfil, llave local y puerto de TV disponible. Espera si otro inspector atiende la TV. Si falta autorización o la IP requiere confirmación lo comunica: no inventa llaves ni salta autenticación.

Al encontrar un perfil válido, se conserva una copia de **metadatos públicos** en `%LOCALAPPDATA%/HolyLuma/profile-recovery.json`: nombre, dirección, tipo y nombre del archivo de llave. No copia el contenido de la llave ni contraseñas ni passphrases. Puede restaurar un registro ausente usando esa llave que ya existe en `.ssh`. No reemplaza silenciosamente un registro existente ilegible ni una autorización inválida.

El supervisor reinicia el trabajador que deja de informar durante 40 s; mantiene el reinicio tras caída con espera progresiva. También detecta el caso setup del trabajador con perfil presente para su supervisor y fuerza una recarga, limitada a una por minuto. La ventana nueva solicita recuperación de ese estado obsoleto y de procesos no respondientes sin bucles continuos.

El código del panel tiene botón y menú **Doctor · Reparar** y conserva su resultado. Compiló y pasó una autoprueba inicial. En la construcción posterior, **Windows Code Integrity bloqueó ejecutar el EXE nuevo** (evento 3077: incumple requisitos de firma Enterprise). No se desactivó ni eludió esa política; se conserva el EXE instalado. Por ello la nueva etiqueta/botón no está instalada. El botón existente **Diagnóstico** invoca ahora el Doctor a través del controlador actualizado. Interacción por puntero y estado visual de respaldo comprobados; `artifacts/windows-respaldo.png`.

## Dos computadoras encendidas

Un único asistente tiene la reserva SSH temporal; el otro permanece listo para el relevo, sin competir ni abrir apps. Se preservan sesión y punto de reproducción mediante el descriptor ya existente. Ambos equipos deben ejecutar el código coordinado actualizado; un runtime antiguo que ignore las reservas no obtiene mágicamente ese protocolo.

El propietario renueva cada 5 s y deja de operar tras 15 s sin confirmación. La reserva remota expira a los 60 s. Además se arma un vigilante temporal en la TV mediante `nohup sh`, ligado **solo al sshd de la conexión propietaria**: verifica token, PID, nombre sshd y tiempo de creación del proceso; tras más de 20 s sin renovación termina únicamente esa conexión. Así una laptop suspendida no debería dejar su túnel ocupando el inspector hasta un timeout del sistema. No cambia sshd ni servicios de webOS. Al liberar la reserva el vigilante termina solo. Otros inspectores se respetan.

Probado con procesos/transportes simulados: exclusión, caída, suspensión lógica, expiración, relevo y conservación de posición. En TV real solo se verificaron SSH, estado de sockets y sintaxis/arranque del vigilante con un token de prueba que no coincidía con ninguna reserva; **no se forzó un apagado de la laptop ni se probó el relevo físico**, para conservar la sesión actual. Tampoco se terminaron conexiones ajenas.

## Registro para depurar

- `.local/logs/diagnostics.jsonl` + cuatro archivos rotados de hasta aproximadamente 1 MiB cada uno.
- Fecha UTC completa, versión de código, identificador de ejecución, secuencia e identificador de equipo derivado del hostname; componentes servicio, conexión, navegador, páginas, HTTP, catálogo, reproducción, perfiles y Doctor.
- Errores internos con mensaje/stack acotado y limpiado. Errores UI y promesas rechazadas llegan por un endpoint limitado a 30 avisos/minuto. Respuestas HTTP fallidas o lentas y fallos de conectores se registran sin guardar consultas/bodies.
- Muestras de reproducción cada 10 s: posición, duración, datos listos, red, MediaError, buffer, pausa y cantidad de marcos. En incidentes se adjuntan hasta 12 muestras recientes.
- `holy-playback.jsonl` conserva el diagnóstico especializado e incluye el mismo identificador de ejecución.
- `npm run debug:export` genera un JSON local en `artifacts/` con los registros conservados y últimas líneas del flight log. No lee llaves, cookies, variables de entorno ni archivos privados de perfiles. Limpia URLs con tokens, credenciales, contraseñas y passphrases. Los títulos vistos siguen siendo datos personales locales: el archivo no se envía a terceros.

No es captura ilimitada o retroactiva, ni garantía de observar todo tráfico de Internet; algunas peticiones de streaming llegan como XHR en vez de Media. Un error previo a la activación de esta versión puede no estar registrado.

## Gustos portables y más precisos

Se separan abrir/reintentar y saltar de reproducción observada. Solo suma avance compatible con el tiempo real transcurrido; abrir 20 veces no genera 20 señales. Se necesita al menos 120 s observados para inferir interés. Las valoraciones explícitas pesan más, se reconocen copias del mismo título/tipo/año y tienen explicación directa. Hay perfiles por clase de contenido cuando existen señales suficientes, alias comunes de géneros y confianza inicial/media/alta. La puntuación es **afinidad estimada**, no probabilidad validada ni promesa de acierto.

Las valoraciones y preferencias se combinan por identidad y fecha, conservando marcas de borrado y de reinicio del perfil para no revivir gustos eliminados al volver a un equipo antiguo. La combinación es determinista, idempotente y convergente en las pruebas. El reloj lógico incorpora el estado conocido; no sustituye una hora de sistema correcta en ediciones simultáneas desconectadas. Los archivos previos se respaldan antes de importar y las escrituras son atómicas. El perfil compartido existente por SSH adopta esta combinación y conserva los reintentos/rollback del trabajo previo.

En un mismo servidor, TV y navegadores de la red usan la biblioteca común. Entre computadoras coordinadas se intercambia al conectar mediante la caché temporal de la TV y copias locales persistentes. La caché `/tmp` de la TV no es una nube: tras un reinicio y sin ninguna computadora que conserve la copia nueva no puede reconstruir cambios perdidos.

En Gustos de escritorio hay Exportar/Importar; la TV conserva su flujo normal. También: `npm run holy:tastes -- export ruta.json` o `import ruta.json` con el servicio activo. El archivo portable lleva gustos, sin historial de reproducción ni llaves; importar combina, no sustituye las valoraciones nuevas.

## Anime clásico · Top 100

Fila exclusiva dentro de Anime, después de Continuar/Recomendado/En emisión. Copia de 100 entradas únicas obtenida de la API oficial de AniList, por puntuación media ponderada descendente, popularidad y luego ID para desempatar. Estreno anterior a 2007, más de 10 000 usuarios de popularidad, formatos TV/TV_SHORT/OVA/ONA/MOVIE y filtro no adulto. Temporadas y películas son entradas separadas; no es una selección de 100 franquicias ni un ranking universal objetivo.

La lista está fechada, trae puesto, año y puntuación de AniList. El timestamp del origen se conserva en UTC y la fecha de interfaz se muestra para México. Coincide con el catálogo solo por alias exacto y año, para evitar remakes. Si no hay coincidencia comprobada, la tarjeta ofrece buscar en los sitios sin afirmar que pueda reproducirse. Al enfocarla no intenta resolverla como vídeo. Se dibujan solo tarjetas cercanas, como las demás filas.

Fuente y API: https://anilist.co/search/anime ; https://docs.anilist.co/reference/query ; https://docs.anilist.co/reference/object/media . Actualizar explícitamente con `npm run anime:classics:update`; si no son 100 entradas válidas se conserva la copia anterior.

## Validación y entrega

`npm test` incluye categorías/reproducción, gustos/Top 100/privacidad, Doctor/recuperación, SFTP y relevo de perfiles. La integración de procesos Windows se ejecutó con hijo simulado: iniciar dos veces, exclusión, caída, reinicio, detención y recuperación por pérdida de latido; servicio normal restaurado al terminar. Build de Holy y `artifacts/com.lgapp.holy_0.9.3_all.ipk` generados. Top 100 comprobado en la interfaz de navegador del PC. No se instaló este IPK ni se ensayó su control remoto en TV.

Pendiente: firma/instalación del EXE nuevo, desplegar la misma versión coordinada en la laptop, prueba física de relevo conservando un episodio, y después instalar/validar el IPK en una ventana sin otra sesión activa.


## Actualización Windows posterior · 2026-10-25

El EXE 0.9.2 ya se validó e instaló correctamente tras completar las variables de carpetas de usuario ausentes. Doctor · Reparar está visible en la aplicación instalada y el inicio automático continúa activo. El bloqueo de firma anterior no se reprodujo en esta construcción. Estado final: respaldo normal. Ver docs/WINDOWS-UPDATE-CHECK.md para versiones, comprobaciones y límites de esta revisión.
