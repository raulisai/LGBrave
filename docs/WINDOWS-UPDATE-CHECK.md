# Comprobación de actualización Windows · 2026-10-25

Rama revisada: main en 716b966 (igual a origin/main), más los cambios locales existentes. Los dos commits más recientes son documentación/exclusiones; la incorporación funcional de Windows y el servicio común está en da4b964. No se hizo pull, commit ni push en esta revisión.

## Qué requiere actualizarse

| Cambio | Acción necesaria |
| --- | --- |
| Ventana nativa, botones, bandeja y lógica interna de HolyLuma.cs | Recompilar y actualizar el EXE mediante npm run windows:install. |
| Servicio JavaScript: conexión, perfiles, gustos, registros y recuperación | Reiniciar el servicio para cargar los módulos nuevos. El EXE apunta al proyecto y ejecuta desktop-control.mjs; no contiene una copia del servicio. Algunas respuestas del controlador cambian en la siguiente consulta. |
| Interfaz de Holy/Luma instalada en la TV | Generar e instalar el IPK correspondiente, en una ventana sin otra sesión de pruebas. Es independiente del EXE Windows. |

## Resultado real

El EXE instalado era 0.9.1.0; la fuente nativa actual es 0.9.2.0. El paquete/Holy es 0.9.3: son versiones de componentes diferentes. La instalación apunta a F:/proyectos/LGBrave y a C:/Program Files/nodejs/node.exe.

Se detectó que un lanzador de desarrollo puede omitir APPDATA y LOCALAPPDATA, haciendo fallar el instalador y leyendo el registro webOS desde una ubicación distinta. desktop/shared/desktop-config.mjs ahora completa esas variables con las carpetas del mismo usuario de Windows, conservando las rutas explícitas/redirigidas y sin alterar macOS. Tres pruebas nuevas, dentro de las 22 comprobaciones de test-desktop, pasaron.

Validación --build-only correcta esta vez: el bloqueo de firma documentado en revisiones anteriores no impidió ejecutar el binario actual. Se guardó una copia del EXE y su configuración anteriores en .local/windows-native/pre-update, y se ejecutó el instalador normal.

Instalado y leído desde el recurso de versión del archivo: 0.9.2.0. Recibo de instalación: installed=true, autostart=true, selfTest=true. La ventana mostró Doctor · Reparar y el estado normal de respaldo; captura artifacts/windows-actualizado.png. Se probó la interacción del Doctor en ese estado, sin forzar otra sesión.

Estado vivo final comprobado: servicio activo de respaldo ante otra reserva de TV. Al comenzar la revisión se observó conectado/sincronizado; justo antes de instalar el servicio ya aparecía detenido. Por ello no se afirma que se haya conservado el mismo PID de servicio durante toda la revisión. El instalador arrancó la aplicación normal y quedó servicio activo. No se enviaron órdenes de navegación ni se instaló IPK en la TV.

Los cambios locales pendientes siguen sin commit; actualizar otro equipo solo desde origin/main no incluye esos ajustes locales. Relevo físico con ambos equipos y prueba tras reiniciar Windows siguen pendientes.
