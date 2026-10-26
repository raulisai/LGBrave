# Validación y corrección de pausa · 0.9.14

2026-10-26, Windows. Base integrada: origin/main 2c40043, incluida la confirmación de sincronización real desde la Mac.

## Problema y corrección

El detector permitía rescatar un vídeo pausado si reportaba MediaError. Además retenía tiempos de atasco previos a la pausa, confundía un fotograma pausado cerca del final con fin de capítulo y podía observar un anuncio activo en otro marco en lugar del contenido pausado.

Holy ahora conserva una pausa observada después de empezar a reproducir, suspende la recuperación automática y borra los relojes de atasco al pausar/reanudar. También cancela la cuenta de siguiente capítulo al detectar pausa, mantiene como referencia la duración del contenido y conserva el estado de pausa durante el relevo entre computadoras. El vídeo inicialmente pausado durante una carga normal todavía puede arrancar automáticamente. Al reanudar, un atasco real sin pausa sigue cambiando de servidor.

Limitación: algunos proveedores también ponen el elemento de vídeo en pausa al fallar. Sin una señal fiable del proveedor no se puede atribuir siempre la causa; se prioriza respetar esa pausa y esperar la reanudación del usuario. No se garantiza recuperar todos los reproductores de Internet.

## Validación ejecutada

- npm test completo: pasa, repetido después de verificar dependencias.
- Nueva regresión con HolyBridge real y CDP simulado: pausa de 20 minutos con error, pérdida de muestras, error de navegación, reanudación sin salto inmediato, pausa en primeros segundos, pausa cerca del final, cancelación de siguiente capítulo, anuncio en otro marco y relevo pausado. Un atasco real reanudado sí recupera.
- holyAutoplay real ejecutado en VM: la pausa evita autoplay, incluso tras crear otro mundo aislado.
- build:all: Luma, Holy TV y Holy web pasan.
- Sintaxis Node: 146 módulos JS/MJS comprobados sin errores.
- EXE Windows: compilación y autoprueba correctas con --build-only; versión nativa 0.9.11.0 sin cambios y sin reinstalación necesaria.
- Windows: servicio reiniciado con código 0.9.14 y conexión SSH real restablecida. La página conservó su huella, proveedor Streamtape, Between Steps capítulo 5 y avanzó de ~3697 a ~3713 segundos, error de vídeo 0. Sin navegar, recargar ni pausar la TV.
- Canal Mac↔Windows: ambos activos y sincronizados en estado vivo antes del reinicio; comprobar de nuevo tras actualizar cada lado.

La pausa larga es una prueba controlada: no se ha pausado físicamente la LG para ensayarla. Se solicitó autorización, recibida después de publicar la corrección; ver intento físico posterior. La corrección nueva aún no se ha ejecutado en la Mac; sus tareas están en TAREAS-MAC-SINCRONIZACION.md.

## Dependencias: pendiente identificado

npm audit sobre el lockfile final informa 5 alertas: 1 moderada, 3 altas y 1 crítica, dentro del SDK oficial @webos-tools/cli 3.2.6 y sus dependencias (body-parser, proxy-addr, brace-expansion y qs). La versión más reciente consultada sigue siendo 3.2.6. El SDK publica npm-shrinkwrap.json y conserva esas versiones; overrides ordinarios ensayados no las sustituyeron y se retiraron. El lockfile conserva las resoluciones originales; no se aplicó audit fix --force ni una degradación del SDK.

El servicio HTTP de Holy usa node:http; el servidor Express auxiliar ares-server del SDK no está ejecutándose. Esto delimita la exposición observada, no elimina las alertas. Pendiente revisar una actualización oficial o aislar/sustituir el SDK y volver a validar SSH/instalación antes de adoptarla. No se publican credenciales ni archivos de diagnóstico privados.

Referencias primarias de las alertas: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). [Reglas de npm para overrides y shrinkwrap](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).

## Intento físico autorizado · 2026-10-26 13:20 México

Al recibir permiso, la TV estaba en Inicio sin vídeo. Después apareció Oppenheimer en Mixdrop: se pausó mediante HTMLMediaElement.pause a los 29.986 s. El runtime registró pause-hold, sin intento de recuperación en ese intervalo. Antes de completar dos minutos, el contenido cambió a Steins;Gate 0 episodio 1; la comprobación detectó otra página y se abstuvo de pausar/reanudar ese capítulo. También hubo liberación y nueva pausa del primer vídeo antes del cambio. El ensayo no es concluyente: falta mantener un contenido estable dos minutos y verificar avance después de reanudar. Se pidió al usuario avisar cuando estuviera listo. No se navegó ni se abrió contenido desde el cliente de diagnóstico.
