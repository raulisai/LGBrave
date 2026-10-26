# Validación Windows, Mac y TV · 2026-10-25

## Resultado observado

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
