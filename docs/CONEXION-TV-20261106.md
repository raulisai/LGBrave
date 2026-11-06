# Conexión Windows ↔ LG y registros · 2026-11-06 · 0.9.23

## Cómo estaba funcionando (31/10 – 06/11, Windows)

- **Arreglo de apps de Tienda confirmado en la práctica.** Reinicio físico del 02/11 17:22, sesión a las 17:55, servicio iniciado por el acceso de Windows a las 17:57 sin Codex. Conectó con Holy a las 19:26, cuando se abrió en la TV. Nunca más apareció «Falta vincular».
- **Suspensiones normales.** Cuatro suspensiones (la más larga del 03/11 01:52 al 05/11 22:32). En cada despertar el servicio volvió solo en segundos.
- **Relevo con la Mac correcto.** La Mac usa a veces la IP .102 y a veces la .148; la sincronización funcionó por la .148.
- **No hubo pérdida de gustos ni de progreso** en lo registrado: ningún `merge-error` ni error de perfil, biblioteca de 41 títulos y 11 votos, muy por debajo de los límites de 300 títulos y 500 votos.

## Qué fallaba

1. **«Sin conexión» falso con la TV encendida y Holy cerrado.** El inspector de la TV solo escucha mientras hay una app de desarrollo abierta. Con Holy cerrado, el canal se reinicia y el servicio lo trataba como una conexión perdida. Cerraba SSH, soltaba la reserva y volvía a conectar cada pocos segundos: 1,5 h el 02/11 y 37 min el 06/11, con el icono en rojo. Mientras tanto la Mac podía colarse entre intentos, y el 01/11 se ven «reserva vigente» intercalados.
2. **Logs incompletos.**
   - El error se guardaba solo como «fetch failed», sin la causa.
   - No constaba por qué paraba el servicio, con qué código terminaba el proceso ni cuándo se suspendía el equipo.
   - Los estados de conexión normales solo vivían en el registro rotatorio, unos 10 días.
   - El primer aviso de un mes podía perderse si la carpeta de logs no existía.
3. **Sincronización con la Mac siempre en «pendiente».** La IP vieja de la Mac (.102), que nunca responde, mantenía el estado pendiente aunque la .148 estuviera sincronizada.

## Cambios

- `lab-runtime.mjs`: si el canal del inspector se reinicia (`ECONNRESET`/`UND_ERR_SOCKET`…), el estado es «En espera» (ámbar). Conserva la sesión SSH y la reserva, y conecta en cuanto se abre Holy. Un tiempo de espera agotado o la TV apagada siguen reconectando como antes. Cada estado lleva un código de causa (`inspector-closed`, `app-not-open`, `lost`, `handoff`, `tv-lease`, `TimeoutError`…).
- `desktop-host.mjs`: el motivo de cada parada (`network-changed` por suspensión, `stop-request`, `supervisor-gone`, `doctor-restart`, `signal`) y el código de causa en cada cambio de estado.
- `desktop-supervisor.mjs`: cada salida del proceso con su código y duración, y cada despertar con lo que duró la suspensión.
- `peer-sync.mjs`: motivo de cada fallo con la otra computadora (HTTP o red). Una dirección que nunca respondió no mantiene el estado en pendiente.
- `diagnostics.mjs`: registro mensual permanente `connection-AAAA-MM.jsonl` con toda la vida de la conexión, de servicio, perfil, sincronización y Doctor, en todos los niveles. Las repeticiones de 10 min se agrupan y el límite es de 50 MB/mes. La carpeta se crea antes de escribir.
- `npm run desktop:log [días]`: resumen de minutos por estado, cortes de una conexión activa con su causa, paradas, salidas y suspensión.

## Pruebas

`scripts/test-connection-log.mjs` cubre:
- la clasificación de errores;
- que con Holy cerrado haya una sola sesión SSH y conecte al abrirlo;
- que los demás fallos sigan reconectando;
- el registro mensual con repeticiones;
- el resumen del reporte;
- la IP antigua de la Mac.

Caso `windows-inspector-closed-wait` en la matriz.

## Límites y propuestas

- **Acciones de la TV con el servicio caído.** Un «me gusta» hecho en la TV con la computadora suspendida no se guarda; Holy avisa «No se guardó…». El idioma elegido se vuelve a preguntar. Para no perder ninguna haría falta una cola en la TV que reenvíe al volver, y eso exige reinstalar el IPK de Holy. Queda propuesta, no hecha.
- **Logs de la propia TV.** Los registros internos de webOS no se recogen; sí los de la página por CDP, en `flight.log` y `page/exception`.
- **Perfil en la TV.** El perfil que se guarda en la TV vive en `/tmp` y se borra al reiniciarla. No se pierde nada, porque cada computadora guarda su copia y la combina.
