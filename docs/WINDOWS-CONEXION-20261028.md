# Conexión Windows · 2026-10-28 · 0.9.19 / EXE0.9.12.0

## Evidencia y recuperación

El programa nativo y su servicio estaban iniciados. Doctor comprobó TV192.168.1.134:9922 accesible y perfil lg-lab configurado en el usuario actual. Sin embargo, la respuesta cruda del worker decía configured=false y state=setup; también mostraba un perfil de sincronización sin emparejar. El controlador, ejecutado bajo el usuario actual, sí encontraba el registro existente. No se acreditó pérdida de la llave ni se necesitó un PIN nuevo.

Doctor recargó el servicio usando el perfil actual. Después, Windows pasó a connected/com.lgapp.holy, profile=synced y peerSync.paired=true. Lectura por el túnel vivo de la LG: «Conectado a la computadora», sin navegar ni reproducir contenido; se conservó el inicio actual (Coda seleccionada).

La discrepancia entre entornos/procesos está comprobada. No se capturó la ruta exacta del registro usado por el worker viejo antes de detenerlo; no se atribuye con certeza a una variable concreta del arranque anterior.

## Corrección del lanzador

HolyLuma0.9.12.0 establece USERPROFILE, HOME, APPDATA y LOCALAPPDATA de cada proceso Node usando las carpetas conocidas de Windows, incluidos perfiles redirigidos. Evita que un entorno heredado temporal o diferente elija otro registro webOS, llave o archivo de sincronización. Start, status, reparación y reinicio usan la misma factoría de procesos.

La autoprueba lanza Node real y compara las cuatro carpetas recibidas con las del usuario. La instalación ejecuta el binario primero con entorno normal y después con APPDATA/LOCALAPPDATA/HOME alterados: ambas ejecuciones deben producir la misma huella SHA-256. Solo se conserva la huella en el comprobante, sin publicar rutas, llaves o tokens.

scripts/test-windows-launcher.mjs compila el ejecutable y ejecuta esa regresión automáticamente en Windows, sin instalar ni navegar la TV. En macOS omite la prueba nativa; no acredita este EXE allí. Integrado en npm test y playback:check, con caso24 en la matriz. El nuevo ejecutable quedó instalado y el inicio automático se conservó activado.

## Validación

- playback:check completo correcto: suite, prueba nativa real, contratos de7fuentes, matriz24casos y3builds. Huellas de código antes/después coinciden.
- Compilación y autopruebas nativas normal/entorno alterado correctas.
- Instalación real confirmada en Windows, autostart=true; servicio siguió connected a Holy, error vacío y perfil TV sincronizado.
- LG confirmó el estado de conexión mediante lectura DOM del inicio actual. No hubo reproducción nueva ni navegación de prueba.
- Mac no respondía en sus direcciones guardadas; sus cambios permanecen pendientes localmente. Eso no impide la asistencia directa Windows→LG. No se alteró su instalación.
- No se cambiaron firewall, DNS, firmware, arranque de la TV, credenciales ni biblioteca.

El arreglo de conexión no modifica parsers de vídeo ni resuelve por sí mismo el aviso de RePelisHD sobre Between Steps. Ese reporte anterior sigue pendiente: se identificó que el mensaje estático confunde falta de enlaces con servidores no compatibles y que la ficha se publica como película; no se entregó aún una corrección de esa ruta.

Integración final: se conservó también el cambio web de la Mac (ba72910/origin1d86ca8) para cambiar idioma desde ficha/reproductor. Código combinado0.9.19; EXEWindows0.9.12.0.
