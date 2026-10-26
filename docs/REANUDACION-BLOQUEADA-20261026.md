# Reanudación bloqueada · Holy 0.9.15

2026-10-26, Windows.

## Causa confirmada en LG

Between Steps capítulo 5, doramasmp4/Morencius, vídeo en segundo 0, readyState 4, sin MediaError. El runtime 0.9.14 registró pause-hold durante opening y dejó Volviendo a donde te quedaste. La protección de pausa añadida marcaba holySeenPlaying en cualquier evento play, aun sin haber avanzado: el ciclo play/pause inicial del proveedor quedaba confundido con una pausa voluntaria. Es una regresión introducida por 0.9.14.

## Corrección

Solo se conserva intención de pausa si hubo tiempo de reproducción positivo. Se limpian marcas obsoletas en segundo 0 y un marcador inicial no suspende el arranque. Reconectar a un descriptor sin posición conserva fase opening y lee el minuto guardado; no adopta una falsa pausa. Cuando por fin empieza el vídeo, también se retira una cortina dejada por el mundo aislado del servicio anterior. La pausa después de arrancar sigue protegida.

## Validación

Suite npm test completa y build:all (Luma/Holy TV/Holy web) pasan. Nuevas regresiones ejecutan holyAutoplay real y HolyBridge: play/pause en segundo 0, marca vieja de otra conexión, arranque posterior y adopción de carga sin posición. Se mantienen los casos de pausa larga, error y recuperación real sin pausa.

Windows reiniciado sin navegación: mismo reproductor y capítulo 5 pasó de 0 a ~1006 s, pausado=false, readyState=4, error=0, sin holy-curtain en DOM. Minuto reanudado desde biblioteca, no se borró el progreso. Mac y Windows indicaron synced en vivo. El backend de Mac requiere actualizar a 0.9.15; no se ha ejecutado allí esta corrección. No requiere reinstalar EXE/IPK.

El log también contiene Invalid InterceptionId durante solicitudes previas; queda como hallazgo separado, no hay evidencia de que provocara esta falsa pausa. No se afirma corregido.

## Pausa física completada

Con autorización del usuario, Between Steps 5 permaneció pausado ~132 s en 1015.889877/4015.72 s. Las muestras a ~59 s y ~132 s conservaron la huella de página, el mismo tiempo, paused=true y error=0. Después de play avanzó a 1041.290255 s, paused=false y error=0. Logs: pause-hold → pause-released sin recovery-attempt ni server-opening entre ambos. Se dejó reproduciendo el mismo episodio y servidor. Esto valida ese proveedor en esa sesión; no equivale a una pausa física de 20 minutos ni cobertura de todos los sitios.
