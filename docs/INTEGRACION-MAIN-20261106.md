# Integración en main y despliegue Windows/LG · 2026-11-06 · 0.9.24

## Unificación

main integra la mejora local878b58f, PelisFlix f230218 y la rama de conexión1e3f890. Los merges9648e5f y b03ff3c conservan seguridad, recomendaciones y pruebas. git branch -a --no-merged main quedó vacío: ninguna rama revisada tiene cambios fuera de main. Se conservan los nombres históricos de ramas.

## Correcciones detectadas al integrar

- Credits.fill contaba una identificación y después la misma ficha con reparto; devolvía3 cuando solo completó2títulos. Se cuenta la ficha completada una sola vez; la regresión existente de gustos pasa.
- En la LG empaquetada, voto e idioma respondieron403 porque WAM omitía Origin. HolyBridge identifica únicamente las peticiones al API propio originadas en el frame principal del inicio de Holy y conserva la redirección del equipo anterior. No añade identidad a jugadores externos, iframes, frames desconocidos ni otros destinos. El servidor mantiene sus restricciones. Regresión de seguridad con esos casos incluida.

## Validación

Gate local final correcto:33casos,12contratos offline, suite completa y builds Luma/Holy TV/Holy web con huellas idénticas. PelisFlix resolvió por HTTP una muestra latina con Nupload y una alternativa: no equivale a probar su vídeo en TV. Dependencias no cambiaron; EXE Windows0.9.13.0 sigue siendo válido.

## Despliegue y prueba física LG

- Servicio Windows reiniciado con el código nuevo; misma autorización, IP TV192.168.1.134.
- Holy0.9.24 instalado y versión leída del appinfo de la TV. La CLI necesita precargar scripts/desktop-config.mjs para completar APPDATA ausente del entorno de Codex; no se volvió a vincular ni se modificaron llaves.
- En pantalla: inicio conectado, Películas→Terror (141títulos; recomendadas, nuevas, vistas locales, AFI, valoradas y clásicas), Anime→Top100 clásico, Gustos con historial y preferencias.
- TVfile://: reenvío del voto existente de Between Steps sin cambiar su valor y reenvío de la preferencia de idioma existente: ambos HTTP200/ok. La consulta de versiones de la muestra del catálogo vino vacía en esta lectura; eso no acredita reproducción en español de ese capítulo.
- Cerrar Holy con el SDK deja Windows waiting con el mismo worker; reapertura sin vincular de nuevo. Un solo runtime de asistencia; Mac en respaldo mediante relevo normal.
- Shin Tennis, capítulo6: reanudado, vídeo readyState4/MediaError0. Pausa79.6s:118.264456s antes/después y mismo hash de página, sin cambiar servidor. Al terminar se volvió al minuto original68s y avanzó a110s; quedó reproduciéndose. Sin verificar audio por usuario.
- Evidencia sanitizada: evidence/holy/tv/main-unified-20261106.json. CI remoto de esta revisión pendiente al publicar.

## Límites

No se certifica todo Internet ni la eliminación del cierre nativo de Amadeus/Dragon Ball. No se actualizó físicamente la Mac; debe traer main y reiniciar su servicio. Firewall de administrador, huella SSH y autenticación LAN siguen pendientes del informe de seguridad; no se cambiaron firmware, arranque ni DNS.
