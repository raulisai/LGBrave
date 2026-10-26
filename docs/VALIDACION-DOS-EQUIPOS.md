# Validación Windows, Mac y TV · historial y cierre 2026-10-26

## Cierre vigente · Windows 0.9.11 (2026-10-26)

La integración y la instalación nativa de Windows ya se completaron. Se comprobó en vivo el ciclo Mac→Windows→Mac→Windows y el perfil sincronizado, sin comandos de navegación. Al cierre Windows atiende Holy; Mac queda en respaldo. EXE 0.9.11.0 ejecuta correctamente con autoprueba e inicio automático activado. TV consultada por SSH: Luma 0.9.2 y Holy 0.9.5, sin reinstalarlas. Suite completa, tres builds y procesos/host aislados pasan.

La elección de idioma se añadió al perfil 0.9.11; para compartirla también hace falta actualizar el código de la Mac. El relevo con su versión actual ya funciona. Reproducción prolongada, suspensión real y reinicio físico siguen pendientes. Detalle y evidencia: [INTEGRACION-WINDOWS-20261026.md](INTEGRACION-WINDOWS-20261026.md). Las secciones siguientes registran observaciones históricas, incluidos el EXE antiguo bloqueado y los relevos que entonces estaban pendientes.

## Resultado observado (2026-10-25)

El usuario confirmó que Holy volvió a mostrar el catálogo desde Windows con la
Mac apagada. La interfaz instalada seguía pidiendo datos a la dirección anterior;
el puente ahora recupera esas peticiones y usa el servidor del equipo activo,
sin navegar, recargar la TV ni cambiar el buscador.

En la comprobación posterior la TV conservaba dos conexiones del inspector por
sesiones SSH desde 192.168.1.102. Windows quedó en espera para evitar una segunda
intercepción. No se terminaron conexiones ajenas. Ese host no respondió a TCP
22/43190; un puerto cerrado no identifica por sí solo al dueño del inspector.

## Correcciones y organización

- Windows/macOS comparten `desktop/shared/`; sus interfaces nativas permanecen
  en `windows/` y `mac/`. `src/`, `public/`, `holy-public/` son el código de TV.
  Las entradas estables en `scripts/desktop-*.mjs` conservan la compatibilidad.
- Reserva en la TV con vencimiento, reloj monotónico, vigilante, keepalive SSH,
  cancelación de conexiones tardías y un solo runtime local por candado atómico.
- Errores de lectura de archivos, categorías vacías, respuestas del equipo
  anterior, reintentos de catálogo y caché de imágenes corregidos.
- Perfil compartido por SFTP con archivos temporales exclusivos, renombrado
  condicionado al dueño de la reserva, límites, validación y respaldos locales.
  Historial y gustos se combinan por fecha y conservan marcas de borrado.
- Metadatos públicos del vídeo permiten adoptar el seguimiento en otro equipo,
  sin transportar el enlace firmado ni navegar el reproductor.
- Bandeja y menú Mac: control común, tiempos máximos, instancia única y errores
  visibles. El instalador prueba el nuevo EXE antes de sustituir el anterior.

## Evidencia y límites

`npm test` reúne pruebas locales del motor, puente, navegación, sesiones,
catálogo, recuperación de vídeo, Doctor, exclusión y relevo simulado. Pruebas
adicionales: 19 comprobaciones SFTP; 11 de dos equipos/perfil/vídeo; ciclo de
inicio, reinicio y apagado con hijo simulado; host Node real con ambos inicios y
assets por HTTP, TV y descargas desactivadas. Ambos builds Vite correctos.
La conexión SFTP real a la TV está disponible, comprobada sin segundo inspector.

También se conservaron y ejecutaron las 9 pruebas nuevas de Doctor/reparación del
otro chat: restauración del registro público con una llave local existente,
respeto del inspector ajeno, arranque y reparación de estado setup. No reemplaza
una autorización caducada ni guarda contraseñas o el contenido de las llaves.

Esto no acredita un relevo físico completo Mac→Windows→Mac ni reproducción
prolongada en sitios reales. El Mac está pendiente de actualizar y de compilar
su interfaz Swift. Las pruebas de categorías y fallos de vídeo del otro chat
se conservaron; no se instaló el nuevo IPK ni se probó su interfaz en TV.

La versión 0.9.2 del EXE se compiló, pero Windows bloqueó su ejecución con una
directiva de Device Guard (código 4551 al intentarlo desde cmd). Se conservó el
EXE instalado 0.9.1 y su proceso. No se modificó ni eludió la política. El inicio
automático está configurado; falta verificarlo después de reiniciar Windows.

La caché de TV vive en `/tmp`: se pierde al reiniciar la TV. Las copias locales
persisten. Los cambios no publicados desde un equipo apagado no pueden
recuperarse hasta volver a encenderlo. No hay garantía de ausencia de fallos,
cobertura general de Internet o equivalencia con Brave completo.

Cierre de publicación: paquete/Holy 0.9.3, Luma TV y fuente EXE 0.9.2.
`test-holy-next` valida gustos observados, borrados convergentes, Top 100 AniList
y diagnóstico sin secretos. Suite completa y ambos builds volvieron a pasar
con todos los cambios de este espacio; el código se publica en `origin/main`.

## Comprobación en la Mac (2026-10-25 19:50)

- La Mac ejecutaba runtimes antiguos (`holy.mjs` y `start-lab.mjs`, que no conocen la reserva); se detuvieron junto al servidor de fixtures suelto que ocupaba 43187, y se inició `npm run desktop:start`.
- Estado de la Mac: **standby** («La TV tiene una reserva de asistencia vigente»). La reserva `/tmp/luma-desktop-assist` en la TV se renovaba cada pocos segundos (edad 1–3 s en tres lecturas) **aun con el servicio de la Mac detenido**: la mantiene otro equipo, que es la Windows. La Mac no interceptó, como pide el diseño; al apagar Windows la reserva vence en ~60 s y la Mac la toma sola (cada 5 s reintenta).
- **No probado**: ese relevo físico Windows→Mac→Windows (no se apagó la otra computadora) y reproducción larga tras el relevo. Los IPK instalados son Luma 0.9.2 y Holy 0.9.3, el mismo par para los dos equipos.
- Direcciones de otros equipos (`peers`) vacías en la Mac: el doctor no lista a Windows hasta añadir su IP en «Configurar».
- Fallo de macOS encontrado y corregido: `runtime-lock.mjs` trataba ENOTDIR (que macOS da al renombrar un directorio sobre un archivo antiguo) como error en vez de reintentar; `test-lab-runtime` fallaba en Mac y pasa 3/3.

## Relevo con nombre y «Usar esta computadora» (Mac, 2026-10-25 20:40)

- Código 0.9.5. Al tomar la TV, cada equipo escribe en la reserva `info` («Nombre (IP)», saneado para el shell) y `since`. Liberar y vencer borran `owner`, `at`, `since` e `info`; antes, un `info` extra impedía `rmdir` y dejaba una reserva muerta.
- **Visto en vivo en la Mac:** estado `standby` con «La TV la atiende djoker». Lectura SSH de solo lectura de la reserva: `owner`, `at` (renovado hace 4 s) e `info=djoker`, sin `since`. Es decir, la Windows ya escribe `info` con código que **no está en Git**; revisar `git status` en Windows antes de `git pull`.
- «Usar esta computadora para la TV» (`npm run desktop:handoff`, menú Mac, bandeja Windows) escribe `/tmp/luma-desktop-handoff` (hora de la TV y nombre). La renovación del equipo activo la acepta solo si es posterior a su `since`: suelta la TV, la libera y queda 2 min en espera. El que pidió despierta su servicio (`POST /wake` del supervisor) y la toma en cuanto queda libre. Tomar la TV borra la petición.
- Puertos ocupados: el servicio informa el programa y el supervisor reintenta los conflictos cada 30 s (`LUMA_CONFLICT_RETRY_MS` en pruebas).
- Pruebas: `test-desktop-handoff.mjs` (11, simuladas) y `test-desktop-process.mjs` (procesos reales con hijo simulado: conflicto reintentado y despertar). **No probado:** el relevo físico pedido, porque la Windows corre código anterior que no conoce la petición. No se escribió ninguna petición en la TV.
