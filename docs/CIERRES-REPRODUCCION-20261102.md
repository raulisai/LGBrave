# Cierres de Amadeus y Dragon Ball · 2026-11-02 · 0.9.22

## Evidencia y límites

El corte de Amadeus del 02/11 22:27 México (03/11 04:27Z) sí está registrado en Windows0.9.21: último segundo7052/10825, readyState4, mediaError0 y ~63s de búfer. Después: iframe separado, navegación about:blank y DETACHED target_closed. La Mac tomó la reserva después del cierre; esto no demuestra que lo causara. No hay confirmación de OOM ni crash del renderer. El informe anterior deducía TV apagada por cualquier estado offline: esa deducción no era válida.

El usuario confirma que los cierres regresan al inicio de LG. Dragon Ball no figuraba inicialmente en los logs de Windows; durante el relevo posterior se observó Dragon Ball Super: Beerus4 en JKAnime avanzando1266/1397s sin MediaError. No se dispone del registro del corte previo de ese capítulo en la Mac; no se atribuye la misma causa sin evidencia.

Se reprodujo otro cierre automático de Amadeus a las22:55 México: target_closed en7727.928544/10825.606s. El usuario confirmó que no salió con el control. La guardia estaba instalada en el documento ya abierto y los contadores no registraron llamadas a close. Por tanto, la guardia NO demuestra haber resuelto el cierre. Una función nativa que un sitio hubiese capturado antes de reconectar tampoco queda interceptada; no se probó que eso ocurriera.

La lectura permitida de TV no encontró minidumps. getAppLifeStatus está denegado y memorymanager no existe en este modelo; no se cambiaron permisos ni servicios. Lecturas de memoria disponible131–237MB y JS heap10–16MB no prueban OOM. Se inició muestreo nativo pasivo para observar un nuevo corte.

## Correcciones

- Integrados origin/main02e589a (OnlyFlix, DoramasFlix.beer, catálogo IMDb/TMDB) y73aeeee de Windows. Un pull que reemplazara la rama local habría omitido el arreglo de aislamiento de apps de Tienda; el merge conserva ambos.
- Guard principal solo dentro de páginas externas de Holy: bloquea window.close() y window.open(), aunque scripts intenten reasignarlos. No toca vídeo, pausa, URL, cookies ni el control Atrás. Home, alias LAN de Home y Cloudflare conservados. También se aplica a documentos existentes tras reconexión.
- Telemetría de llamadas de cierre bloqueadas por iframe y heap observado. Motivo nativo del inspector conservado como enum. Cierre de iframe no se registra como cierre de app; incidente raíz una sola vez.
- Doctor web y panel Windows informan incidente reciente30min, incluso tras reiniciar el servicio (lectura acotada64KiB del registro), y conservan el minuto sin receta de reinicio. Una sesión sana sigue reproduciendo. Los registros permanentes conservan la evidencia; no se inventa causa.
- Informe clasifica sesiones cortadas como interrumpidas, distingue target cerrado/reemplazo de inspector/crash y separa el estado posterior de la causa.

Esto bloquea una vía de expulsión que estaba abierta. No prueba que window.close causara el corte anterior ni impide que webOS cierre un proceso o que el proveedor deje de funcionar. No hay cambios de firmware, red ni servicios internos de TV.

## Validación

Gate final correcto: suite completa (incluye6regresiones nuevas,9de logging y11de Doctor),30casos,10contratos y3builds, huellas de código iguales. Cambios nativos del EXE no necesarios.

HTTP real:8/10fuentes dieron al menos un enlace; DoramasMP4 agotó12s y .beer devolvió0títulos en esa lectura. Between Steps5 resolvió español/Streamtape. No son pruebas de vídeo.

Windows activado0.9.22 conservando página/servidor de Amadeus (7679→7692s), con guardia observada en root e iframe. Posteriormente ocurrió el segundo cierre descrito. El usuario volvió a abrir Amadeus a las23:03: esta vez la guardia estaba registrada antes de cargar la página. La nueva sesión fue observada19min04s, hasta23:22 México: mismo hash de página,8867.775588/10825.606s, paused=false, readyState4 y error0. Se dejó reproduciendo. El relevo y la activación final conservaron8186→8223s, sin recargar TV. No equivale a terminar ambas obras ni acredita solución definitiva.

Muestreo nativo:36lecturas durante~12min,131–194MB disponibles y209–295MB de RSS del renderer; el consumo subió y bajó. Sin confirmación de OOM. El muestreador temporal terminó; quedó solo el servicio habitual. Evidencia sin URLs privadas: evidence/holy/tv/exit-observation-20261102.json.

CI de código5133c40 correcta en Windows y macOS: https://github.com/raulisai/LGBrave/actions/runs/41582366855. No se probó físicamente la guardia en la Mac; debe actualizar y reiniciar su servicio.

## Mac

Actualizar repositorio, ejecutar npm ci y npm run playback:check; reiniciar servicio desde el menú una vez pase. No volver a vincular ni reemplazar llaves. No iniciar otro interceptor junto al servicio. Revisar npm run holy:errors en la Mac para Dragon Ball. El backend que tenga la reserva aplica estas protecciones; el otro queda en respaldo.
