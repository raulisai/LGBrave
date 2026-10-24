# Apertura involuntaria de Luma · 2026-10-23

El proceso del Mac que se dejó en segundo plano desde las pruebas repetía `ares-inspect`. En la CLI local 3.2.6, `lib/inspect.js:_runApp()` llama a `launcher.launch()` si el appId no aparece como ejecutándose. Al cerrar/suspender Luma o apagar y encender la TV, el bucle podía volver a abrirla y desplazar otra aplicación.

Se detuvieron el proceso y su inspector y se cerró Luma. El usuario confirmó que las demás aplicaciones volvieron a abrir normalmente. El problema no se atribuye a un cambio de firmware o arranque.

La conexión corregida usa exclusivamente autenticación SSH y reenvío hacia 9998, con puerto local aleatorio enlazado a 127.0.0.1. No importa `inspect` ni `launch`, no llama al gestor de aplicaciones ni envía órdenes de lanzamiento, activación o regreso a Inicio. `LabRuntime` descubre el target exacto de Luma, conecta cuando existe y espera cuando desaparece o la TV no está disponible. El bloqueo del runtime evita otra instancia en la misma carpeta.

Archivos: `scripts/start-lab.mjs`, `inspector-tunnel.mjs`, `lab-runtime.mjs`, `runtime-lock.mjs` y `cdp.mjs`. La biblioteca SSH interna pertenece a la CLI fijada 3.2.6: volver a validar al cambiar esa dependencia.

`scripts/test-lab-runtime.mjs`: 13 escenarios pasan, incluidos otras apps/targets vacíos, apagado y encendido simulados, pérdida de CDP, cierre durante conexión, identificación estricta, túnel TCP real simulado y exclusión mutua. El túnel se probó también contra la TV real: queda en espera cuando Luma no está abierta.

La comprobación física Luma→Pluto→apagado/encendido con el runtime corregido quedó pospuesta por el usuario. No se afirma validación de ese recorrido ni se cambiaron los ajustes normales de restauración de última app de LG. No hace falta reinstalar la app 0.7.2: el arreglo afecta al Mac.

Nunca dejar `ares-inspect` dentro de un bucle de reconexión. Para pruebas de red, usar el túnel pasivo y un solo interceptor por target; detener el laboratorio habitual antes de un validador que controle la navegación.
