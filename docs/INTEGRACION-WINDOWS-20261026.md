# Integración en Windows · 2026-10-26 · 0.9.11

## Resultado

Windows actualizado, aplicación nativa recompilada e instalada y servicio atendiendo Holy en la TV. Ambas computadoras cooperan: se verificó el ciclo real Mac→Windows→Mac→Windows, con una reserva exclusiva y perfil sincronizado tras cada conexión. No se ejecutaron comandos para navegar la TV, lanzar apps o reproducir capítulos.

## Git y conservación

- Rama de integración: codex/integracion-windows-20261026.
- Base Windows: 716b966. Se conservaron los cambios existentes antes de integrar, en el commit 96de463 y una copia local excluida de Git.
- origin/main: 2d59cd0 (35 commits nuevos); origin/holy: cbb1763, ya incluida en main. No hay otra rama remota pendiente de integrar al comprobar de nuevo fetch --all --prune.
- Se combinaron controlador/supervisor, reserva SSH, relevo, pruebas y documentación; se conservaron recuperación del perfil Windows, normalización de AppData, diagnóstico y watchdog. No se descartaron las reparaciones locales.
- La integración queda confirmada localmente. Este trabajo no instala ni actualiza por sí mismo el checkout ni el menú Swift de la Mac.

## Instalación ejecutada

- Código común/paquete: 0.9.11. EXE WinForms: 0.9.11.0.
- Instalación por usuario en %LOCALAPPDATA%/Programs/HolyLuma, apuntando a F:/proyectos/LGBrave y Node 24.21.
- Autoprueba del binario correcta antes y después de instalar; inicio automático activado y conservado. Copia del EXE anterior en .local/integration-20261026/native (fuera de Git).
- Compilados dist, dist-holy y dist-holy-web. Servidor reiniciado con los cambios nuevos. Reinstalar la bandeja no detuvo la conexión de TV.
- Doctor · Reparar visible y probado mientras la Mac atendía la TV: conserva esa sesión y espera. La línea web tiene espacio para sus tres direcciones; los resultados anteriores de Doctor desaparecen cuando cambia el estado.
- La TV ya tenía Luma 0.9.2 y Holy 0.9.5: versiones leídas en vivo mediante SSH. No fue necesario reinstalar sus IPK para esta actualización de Windows.

## Funciones incorporadas

Todos los cambios recientes de Mac: elección y recuperación de idioma, premios/listas conocidas, catálogo web, apertura de reproductores, nombres locales, estado web y relevo pedido desde la bandeja. Se conservaron categorías enlazables, registro de fallos/atascos, gustos y Anime clásico Top 100.

Se corrigió además una omisión del perfil: la elección de idioma por serie era local. El perfil v1 ahora incluye esas preferencias, combina por fecha y conserva borrados. Mantiene las 300 selecciones más recientes para no desbordar el transporte. Los perfiles antiguos sin ese campo siguen siendo compatibles y no borran la copia local nueva. Las URL privadas y campos ajenos se excluyen.

La Mac observada con código 0.9.10 ya coopera con reservas y gustos/historial. **Debe cargar este código 0.9.11 para compartir también la nueva preferencia de idioma.** No se compiló ni instaló su aplicación nativa desde Windows.

## Verificación en Windows

- npm test completo correcto después del último ajuste. Incluye 33 comprobaciones de resistencia Holy, 23 escritorio, 11 relevo, 10 reparación, 19 SFTP, 11 perfil y la nueva prueba de idioma compartido (ida/vuelta, borrado, perfil antiguo, persistencia, limpieza y límite de 300).
- test-desktop-process: procesos reales con hijo simulado; inicio repetido/exclusión, caída de hijo, watchdog, reinicio, conflicto reintentado, despertar y apagado.
- test-desktop-host: servidor real con TV/Internet desactivados; Luma/Holy y sus JS por HTTP, salud y apagado limpio.
- npm run build:all: los tres builds correctos.
- Compilación e instalación nativa con self-test correcto. No se cambiaron protecciones de Windows. El bloqueo del EXE antiguo registrado en informes previos no se reprodujo en la instalación actual.
- La prueba de recuperación de vídeo separa ahora su espera de servidor fallido de la comprobación posterior de vídeo: evita un límite artificial de 30 ms sensible a I/O en Windows. No se cambiaron tiempos de recuperación en producción.
- Motor: 15/15 semánticas controladas. Se conservaron los manifiestos de filtros actualizados automáticamente; esto no demuestra cobertura general de Internet.

## Verificación real de red y relevo

Comprobado entre 03:06 y 03:12 de México (09:06–09:12 UTC):

- Windows djoker: 192.168.1.65; Mac holy-mac: 192.168.1.102; TV: 192.168.1.134, perfil lg-lab autenticado.
- Inicialmente Mac connected y Windows standby, sin error público. Doctor conserva respaldo.
- Petición desde Windows: la Mac cedió y Windows connected a com.lgapp.holy; perfil synced.
- Al detener ordenadamente Windows, Mac pasó a connected y perfil synced. Windows se inició de nuevo y pidió el relevo; volvió a connected con perfil synced, Mac standby. Se dejó Windows atendiendo la TV.
- HTTP 200 y JS correctos: /luma-home/ en 43187, /holy/ y / en 43190. También responden la IP LAN y http://djoker:43190/. Salud muestra catálogo real sin errores de fuentes al comprobarlo.
- Navegador servido por Windows: Anime muestra «Anime clásico · Top 100 AniList · hasta 2006», tendencia/temporada y géneros. Películas muestra Óscar y categorías; clic en Terror abre recomendadas, nuevas, valoradas y todos los títulos. No se cambió el gusto del usuario ni se lanzó un vídeo.
- Evidencia nativa: ../artifacts/windows-integrado-0.9.11.png. Los datos de autorización permanecen fuera del repositorio.

## Límites y siguiente comprobación

El relevo de conexión/perfil sí se probó con equipos reales. La continuidad de un vídeo durante todo el cambio, la recuperación de un atasco prolongado, suspensión/apagón, reinicio físico de Windows y uso desde un teléfono físico siguen sin medirse. No se reinstaló ni se validó en pantalla cada novedad del IPK de TV. La sesión y el buscador no se cambiaron mediante comandos de prueba.

El perfil de TV es caché temporal en /tmp y las copias locales son persistentes; no hay sincronización en la nube. No se pueden recuperar cambios nunca publicados por un equipo apagado. La coordinación requiere servicios que respeten la reserva; herramientas externas antiguas pueden ignorarla. No se promete ausencia total de errores ni cobertura general de Internet.
