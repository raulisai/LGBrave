# Tareas en la Mac · sincronización Holy 0.9.13

El lado Windows está preparado. Este archivo puede ejecutarlo el otro agente de Codex en la Mac. El activador listo para usuario está en mac/Activar-sincronizacion.command.

## 1. Actualizar conservando lo local

Lee docs/SOUL.md y git status. Conserva los cambios existentes antes de traer main del mismo repositorio; no uses reset --hard ni borres .local. La biblioteca y gustos locales se combinarán con Windows, no se sustituirán por una copia vacía. No copies node_modules ni las llaves de Windows.

## 2. Activar

Después de actualizar el repositorio, desde la raíz:

    bash mac/Activar-sincronizacion.command

También se puede abrir con doble clic. Hace npm test, build:all, genera el complemento, empareja por el SSH webOS ya autorizado e inicia el servicio nuevo. Conserva el arranque automático elegido. No navega la TV ni abre otro capítulo.

Para el primer emparejamiento, la TV debe estar encendida, en la red y con Developer Mode vigente; usa el perfil lg-lab que ya tiene esta Mac. No hace falta copiar contraseñas/PIN/llaves ni abrir el puerto 22 de la Mac. Si la TV no está disponible, el servicio conserva todo local y reintentará. Tras emparejar, el intercambio de bibliotecas es directo Mac↔Windows y puede funcionar con la TV apagada.

Si falta la dirección de Windows, usa su IPv4 actual (la última comprobada fue 192.168.1.65):

    node scripts/profile-sync.mjs setup --peer 192.168.1.65
    npm run desktop:restart
    npm run profile:status

La dirección normalmente se descubre a través del registro de la TV. Los cambios de IP se anuncian cada 30 segundos mientras la TV está disponible. Sin ella se usan las direcciones guardadas hasta volver a descubrirlas.

## 3. Confirmar datos en ambos sentidos

npm run profile:status debe indicar paired=true y state=synced, con el otro equipo y una fecha actual. Las API de salud también muestran peerSync. needs-update significa que falta cargar esta versión en el otro equipo; pending/offline conserva los cambios y reintenta. No publiques el archivo privado peer-sync.json: la clave vive en ~/.config/HolyLuma, fuera del proyecto.

Comprueba una valoración en Mac→Windows y otra Windows→Mac, cambio de preferencia, quitar una valoración y Continuar viendo. Usa datos de prueba o conserva y restaura las valoraciones originales. No inicies un segundo interceptor de TV. El relevo de quién asiste la TV es independiente del canal de datos.

## 4. Registrar el minuto del navegador

La TV ya reporta su progreso. Un reproductor abierto en un sitio externo desde Chrome/Brave/Edge necesita el complemento Holy Companion para comunicar su minuto a Holy. Sin él, los Me gusta y la biblioteca sí se sincronizan; el sitio externo no entrega automáticamente su reloj a la página del catálogo.

1. El activador genera artifacts/holy-companion. En Brave abre brave://extensions (Chrome: chrome://extensions; Edge: edge://extensions), activa modo desarrollador y usa Cargar descomprimida para esa carpeta. Este paso lo aprueba y realiza el usuario; no se ha instalado automáticamente desde Windows.
2. Recarga la página del catálogo Holy y abre el capítulo desde ella. El complemento vincula solo esa reproducción; no guarda la navegación general ni copia cookies/contraseñas.
3. Para un proveedor nuevo, abre el icono del complemento en la pestaña del vídeo y pulsa Guardar progreso de este vídeo. Autoriza únicamente ese sitio. Streamtape y otros proveedores habituales están declarados de antemano.
4. Mantén el servicio local de Holy encendido. El complemento envía posiciones mientras cambian, aproximadamente cada 5 segundos, y al pausar/finalizar/saltar. También intenta reanudar al abrir el vídeo. El proveedor debe permitir leer y cambiar el tiempo del vídeo; reproductores ajenos o con permisos faltantes pueden necesitar autorización adicional. No garantiza todos los proveedores.

Si cambian las direcciones de los equipos, vuelve a generar npm run browser:companion y recarga el complemento. Usar las direcciones locales nombradas holy-mac.local/djoker reduce la dependencia de la IP cuando el navegador las resuelve.

## Cobertura que debe anotar el agente Mac

Las pruebas locales de Windows usan Svelte/HTTP reales y Chrome simulado. Windows emparejó con la TV sin interrumpir vídeo; no se ejecutó este activador en macOS ni se instaló el complemento en un navegador físico durante ese trabajo. Anota aquí y en SOUL el resultado real de la Mac, del intercambio físico entre ambos y del minuto en Brave. Conserva la sesión y el buscador del usuario.

## Resultado real en la Mac (2026-10-26 04:55, Claude)

Hecho en orden: `git pull` (limpio, fast-forward, sin tocar `.local` ni biblioteca), revisión del código nuevo (`sync-protocol.mjs`, `peer-registry.mjs`, `peer-sync.mjs`, manifiesto del complemento) antes de ejecutarlo, `npm test` completo (todas las pruebas nuevas incluidas, sin fallos), `npm run build:all`, `npm run browser:companion`, `node scripts/profile-sync.mjs setup` (emparejó con la TV por el SSH ya autorizado, sin pedir nada nuevo), `npm run desktop:restart`.

**Intercambio real Mac↔Windows confirmado:** `npm run profile:status` → `paired:true, state:"synced"`, con `192.168.1.65` (Windows) como par y marca de tiempo actual, mientras la TV la atendía Windows (`standby`, «La TV la atiende djoker»). Es decir: el canal de datos funcionó con la TV ocupada por el otro equipo, tal como describe este documento.

**Complemento del navegador:** generado en `artifacts/holy-companion`; **no se cargó en un navegador real** (ese paso lo decide y hace el usuario, como pide este mismo documento). Pendiente que el usuario lo instale en Brave y pruebe un vídeo externo.

**No probado:** una valoración real Mac→Windows o Windows→Mac de ida y vuelta con datos del usuario (se evitó tocar su biblioteca real sin pedírselo); el relevo físico de quién atiende la TV sigue siendo el mismo protocolo ya validado antes, sin cambios aquí.

## Actualización 0.9.14 · pausa (2026-10-26, Windows)

El canal Mac↔Windows ya está activado; conserva el emparejamiento existente. Tras leer SOUL y conservar cambios locales, trae main, ejecuta npm test y npm run build:all; después npm run desktop:restart y npm run profile:status. No requiere reinstalar el menú de Mac ni IPK: cambia el backend. Respeta una TV en uso y no abras otro interceptor. Comprueba pausa/reanudación con autorización del usuario, conserva capítulo, servidor y buscador. La regresión de pausa larga pasa en Windows; aún no se ejecutó esta versión en Mac. Auditoría y límites del SDK en docs/VALIDACION-PAUSA-20261026.md.

## Actualización necesaria 0.9.15 · arranque tras pausa

Actualizar el backend con main, npm test, npm run build:all y npm run desktop:restart. Sustituye 0.9.14: corrige su regresión de falsa pausa en segundo 0 que dejaba Volviendo a donde te quedaste. Windows ya activo; LG comprobó reanudación de Between Steps 5 y pausa de 132 segundos conservando servidor. Mac aún no ejecutó esta versión. Conserva vínculo y biblioteca existentes; no hace falta reinstalar el menú/IPK. Detalle: docs/REANUDACION-BLOQUEADA-20261026.md.

## Actualización 0.9.16 · idioma durante recuperación

Traer main conservando cambios locales, npm test, npm run build:all y npm run desktop:restart. Verificar npm run profile:status. Conserva emparejamiento y biblioteca. TV/web ahora mantienen el idioma elegido en reintentos y no aceptan una copia subtitulada cuando se pidió doblaje español; proveedor con idioma desconocido se omite en ese caso. Español confirmado por usuario en LG con Between Steps 5; este cambio aún no ejecutado en Mac. EXE/IPK sin reinstalar. Detalle: docs/BETWEEN-STEPS-ESPANOL-20261026.md.

## Actualización 0.9.17 · arneses de reproducción

Conservar cambios locales, traer main, leer docs/PROTOCOLO-REPRODUCCION.md y ejecutar npm run playback:check. Debe pasar suite+3builds con la misma huella de entradas. npm run playback:probe consulta las fuentes sin tocar TV; parcial no equivale a episodio completo reproducible. Reiniciar backend con npm run desktop:restart y verificar profile:status, sin renovar emparejamiento ni borrar .local. Aplica idioma vivo en relevo, IDs por tipo, seek/play al contenido observado y logs seguros. No requiere reinstalar menú/IPK. El gate pasó en Windows; Mac físico y ensayo LG0.9.17 pendientes.
