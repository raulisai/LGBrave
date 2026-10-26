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
