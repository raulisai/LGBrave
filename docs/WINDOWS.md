# Holy y Luma en Windows · código/EXE 0.9.11, TV Luma 0.9.2 / Holy 0.9.5

El mismo proyecto ejecuta los dos navegadores de la TV desde Windows o macOS. Holy conserva catálogo, conectores, reproducción y gustos de `origin/holy`; Luma conserva su interfaz y sus marcadores. No es el navegador Brave completo: ambos reutilizan su motor de filtrado.

## Actualización comprobada en Windows (2026-10-26)

Ya se integraron los cambios de origin/main y origin/holy con las reparaciones locales, se generaron los tres builds y se instaló **HolyLuma.exe 0.9.11.0**. Autoprueba correcta, inicio automático conservado y Doctor visible. El binario actual ejecuta correctamente; el bloqueo de la versión antigua es histórico. No se cambiaron protecciones de Windows.

Probado en vivo: Mac→Windows→Mac→Windows mediante reserva/relevo, perfil sincronizado, Doctor en respaldo sin interrumpir a la Mac, y catálogo HTTP/navegador desde Windows. Al cierre Windows atiende Holy. Informe completo: [INTEGRACION-WINDOWS-20261026.md](INTEGRACION-WINDOWS-20261026.md).

Para próximas actualizaciones:

1. Revisa git status y conserva los cambios locales antes de integrar las ramas nuevas; no los descartes.
2. Integra el código del repositorio. Actualiza dependencias si cambiaron package.json/package-lock.json; no copies node_modules de la Mac.
3. Ejecuta npm test y npm run build:all (Luma, Holy TV y Holy web).
4. Ejecuta npm run desktop:restart para cargar el servicio nuevo.
5. Si cambió windows/HolyLuma.cs o moviste el proyecto/Node, ejecuta npm run windows:install. Los cambios de JavaScript solo necesitan reiniciar el servicio; el EXE requiere compilar e instalar para reflejar sus propios cambios.
6. Comprueba el estado real y la dirección web. No reinstales paquetes de TV cuando solo cambien el servicio o la bandeja.

El instalador valida el nuevo ejecutable antes de reemplazar la instalación y conserva el inicio automático elegido. Si una política impide ejecutar una versión futura, conserva la anterior y muestra el error; no desactives protecciones.

## Abrir el control de Windows

**Aplicación nativa instalada:** `%LOCALAPPDATA%\Programs\HolyLuma\HolyLuma.exe`, con acceso **Holy y Luma** en el menú Inicio y **arranque automático activado al iniciar sesión** por petición del usuario. Es un ejecutable WinForms de Windows, sin terminal visible. El icono **LG** aparece junto al reloj o dentro de la flecha `^`; su punto es verde conectado, ámbar esperando/conectando o rojo apagado/error. Al pasar el mouse muestra el estado; doble clic abre el panel y clic derecho ofrece los controles.

También puedes abrir `windows/Iniciar Luma.cmd`, que inicia ese mismo ejecutable. Cerrar el panel conserva la bandeja y el servicio en segundo plano. «Apagar conexión» detiene el servicio y ambos servidores; «Salir del icono» conserva la conexión; «Apagar todo y salir» detiene ambos. «Iniciar con Windows» permite cambiar el arranque al iniciar sesión.

La instalación es por usuario, sin administrador, y conserva Node.js y el proyecto como dependencias. Si mueves el proyecto o cambias Node, vuelve a ejecutar `npm run windows:install` para actualizar las rutas. No es un paquete autónomo que incluya todos los módulos dentro del EXE.

En otra instalación, primero ejecuta desde PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Preparar.ps1
npm run windows:install
```

Requiere Node 22.13 o posterior, npm y Git. `adblock-rs` es un módulo nativo: si npm necesita compilarlo, también requiere Rust y las herramientas C++ de Visual Studio. Se probó aquí con Node 24.21 y Windows. No copies `node_modules` del Mac.

## Vincular la TV una vez en cada computadora

En Developer Mode de la TV confirma la IP actual y activa Key Server. En el control pulsa **Vincular TV**; una ventana solicita la IP y la passphrase temporal. La herramienta oficial guarda la llave en el directorio del usuario, fuera del repositorio. No copies llaves, contraseñas ni passphrases a `.local/desktop-config.json`, informes o commits.

«Configurar» guarda IP de TV, perfil webOS (por defecto `lg-lab`), IP opcional de la PC y direcciones opcionales de otras computadoras. Al guardar una IP actualiza también el perfil oficial; no basta con cambiar una etiqueta del panel. La selección automática evita adaptadores virtuales de Hyper-V/WSL. Una VPN o varias interfaces físicas pueden requerir elegir la IP manualmente.

En macOS puedes usar la CLI oficial para vincular y después `npm run desktop:start`; el menú existente que llama a `luma-control.mjs`/`holy-control.mjs` usa el servicio común. El inicio automático del Mac sigue disponible mediante `npm run holy:autostart -- on|off|status`.

## Comandos en Windows y Mac

```powershell
npm run desktop:start      # segundo plano
npm run desktop:status     # JSON del estado vivo
npm run desktop:doctor     # comprueba puerto actual, perfil, builds y otras computadoras
npm run desktop:restart
npm run desktop:repair     # reparaciones pasivas y diagnóstico de autorización
npm run desktop:stop
npm run desktop            # primer plano, Ctrl-C detiene todo
npm run holy               # alias del mismo servicio común
npm run build:all          # dist/ (Luma) + dist-holy/ (Holy) + dist-holy-web/ (página web)
npm run package            # IPK de Luma
npm run package:holy       # IPK de Holy
npm test                   # pruebas locales, sin TV
```

En PowerShell usa `npm.cmd` si la política local impide ejecutar `npm.ps1`.

`npm run lab` queda como ruta anterior de Luma para diagnóstico. No la ejecutes junto al control común: comparten candado y el panel avisa del conflicto. Los puertos de los servidores son 43187/43188 (Luma y fixtures) y 43190 (Holy; ese mismo puerto, en su raíz `http://<computadora activa>:43190/`, sirve además todo el catálogo de Holy como página para cualquier teléfono, tablet o laptop del wifi — ver «Holy desde cualquier dispositivo del wifi» más abajo). Si otro programa ya los ocupa, el servicio no cae en bucle: muestra «Otro runtime local está activo» con el puerto y el programa (`netstat`/`tasklist` en Windows, `lsof` en Mac) y reintenta solo cada 30 s. El canal de control elige un puerto de loopback aleatorio y exige un token local; nunca debe abrirse en el firewall. La TV necesita alcanzar los servidores de inicio: si Windows pregunta por Node, permite la red privada. La instalación no modifica automáticamente el firewall.

## Dos computadoras y relevo

1. Instala **esta misma versión en ambos equipos**, vincula cada uno con la TV y ejecuta el servicio común en ambos.
2. El primero que obtiene una reserva temporal en `/tmp/luma-desktop-assist` de la TV la asiste; el otro muestra **La TV la atiende «Nombre (IP)»** y queda en respaldo. No hay preferencia entre Mac y Windows: conserva al equipo que ya está atendiendo.
3. Al apagar el servicio, la reserva se libera. Al perder energía o red, vence después de aproximadamente 60 segundos; el otro equipo vuelve a intentar cada 5 segundos (SSH puede añadir demora). Un reloj monotónico y un vigilante de 15 segundos impiden que una renovación tardía reactive una conexión vencida. SSH envía keepalive cada 5 segundos, con dos faltas permitidas.
4. **Cambiar de equipo a mano (0.9.5):** en el que quieres usar, elige **Usar esta computadora para la TV** (menú «● LG» del Mac, bandeja de Windows) o ejecuta `npm run desktop:handoff`. La petición queda en `/tmp/luma-desktop-handoff` de la TV; el equipo activo la ve en su siguiente renovación (≤5 s), suelta la TV y espera 2 minutos antes de volver a intentarlo, y el que pidió la toma enseguida. El que espera muestra **La TV la atiende «Nombre (IP)»**, porque quien toma la TV escribe su nombre en la reserva. Un equipo con una versión anterior ignora la petición: actualízalo o apaga su servicio.
5. Dentro del equipo activo un único runtime selecciona Holy con prioridad; si solo está Luma, selecciona Luma. Nunca lanza apps de la TV. Si webOS conserva ambas como targets, Holy tiene prioridad hasta cerrarla.

También se detecta un cliente ya conectado al puerto del inspector, por ejemplo un runtime viejo del Mac o DevTools, y se espera sin interceptar. **Un runtime antiguo no conoce las reservas y podría conectarse después**: actualizar ambos equipos y detener los servicios anteriores es necesario para el relevo seguro. No se garantiza coordinación con herramientas externas que ignoren el protocolo.

El inicio de Holy recibe la dirección del equipo activo mediante CDP, incluso si aún está cargado desde el otro. Luma y Holy tienen direcciones de inicio por instancia; no se mezclan los dos navegadores. No se cambia de página por detectar una computadora distinta.

El equipo activo publica preferencias, buscador, marcadores, historial y gustos por **SSH/SFTP autenticado**, usando una caché temporal de hasta 1 MiB en `/tmp/luma-desktop-profile.json` de la TV. El siguiente equipo importa las preferencias y combina la biblioteca por fecha, con marcas de borrado para evitar que reaparezcan valoraciones eliminadas. Desde 0.9.11, el perfil incluye también el idioma elegido por serie, con fechas y marcas de borrado (máximo 300, conservando las selecciones recientes). Para compartir esa nueva preferencia ambos equipos necesitan 0.9.11. Cada equipo conserva su copia persistente; antes de la primera importación guarda un respaldo `.before-sync`. No se comparten llaves, sesiones web ni enlaces firmados de reproductores. Catálogo, listas y reglas aprendidas siguen siendo locales.

La caché se pierde al reiniciar la TV: en ese caso el primer equipo que conecta vuelve a publicarla desde su copia local. No es sincronización en la nube y no asegura recuperar cambios del equipo apagado que nunca alcanzó a publicarlos. La Mac observada con 0.9.10 coopera con el relevo y el perfil base; necesita actualizar su código a 0.9.11 para compartir también idiomas. Los metadatos de la reproducción actual se conservan en la página para que el otro equipo pueda adoptar el seguimiento sin navegar ni buscar otro segundo del vídeo. Depende de que el reproductor siga abierto y de que el equipo anterior haya publicado esos metadatos; esto se probó de forma simulada.

La interfaz antigua de Holy puede seguir solicitando datos a la IP del Mac apagado. El puente reconoce únicamente ese inicio privado y redirige sus recursos/API a la computadora activa. No recarga ni cambia la página. Este arreglo permitió recuperar el catálogo en la TV desde Windows; el usuario lo confirmó con la Mac apagada.

## Holy desde cualquier dispositivo del wifi

`http://<computadora activa>:43190/` (la misma dirección e IP que usa la TV) abre el catálogo completo de Holy en un navegador normal — teléfono, tablet o laptop — sin instalar nada y sin tocar la TV, que sigue sirviéndose por separado en `/holy/`. En esta Mac, además, `http://holy-mac.local:43190/` funciona con ese nombre en vez de la IP (Bonjour/mDNS, nombre local cambiado con `sudo scutil --set LocalHostName holy-mac`): nativo en iPhone, iPad y otra Mac; puede no funcionar en Android o Windows sin algo que entienda `.local`. Funciona igual que en la TV para ver, buscar (con voz si el navegador la ofrece), calificar y revisar episodios. La diferencia es **Reproducir**: un navegador normal no tiene la automatización que limpia anuncios y abre el vídeo solo (eso es exclusivo de la conexión CDP con la TV), así que la computadora resuelve el reproductor real del sitio; cuando el sitio no exige su propia dirección como Referer se ve dentro de la misma página (sin ventanas emergentes ni redirecciones); el resto (la mayoría, Cuevana incluida) abre una pestaña nueva tal cual el enlace del propio sitio, con sus anuncios.

## Arquitectura y verificación

- `desktop/shared/`: implementación común del servicio, configuración y datos compartidos. `scripts/desktop-*.mjs` conserva entradas compatibles para instalaciones existentes. El perfil CLI se localiza en APPDATA en Windows y HOME en Mac.
- `desktop-control.mjs` → `desktop-supervisor.mjs` → `desktop-host.mjs`: control autenticado local, exclusión de instancias, reinicio y apagado por IPC. No usa `ps`, señales POSIX para apagar Windows ni mata PID guardados sin verificar identidad.
- `tv-lease.mjs` + `inspector-tunnel.mjs`: reserva por SSH, detección de inspector ocupado y túnel pasivo.
- `BrowserBridge` y `HolyBridge`: motor compartido con inicios independientes; scripts heredados de Holy en `scripts/holy/`, interfaz en `src/Holy.svelte`.
- `windows/HolyLuma.cs` + `scripts/install-windows-app.mjs`: aplicación WinForms nativa, compilada con el .NET Framework incluido en Windows; instala EXE y accesos en Inicio/Inicio de sesión. Consulta el controlador de Node sin consola cada 4 s. Instancia única, estado por color, panel y controles asíncronos. Reinstalar reemplaza solo procesos del EXE instalado, verificados por su ruta; conserva el servicio de conexión.
- `windows/LumaTray.ps1`: control anterior en PowerShell, conservado para diagnóstico. `Autostart.ps1` prefiere el EXE nativo cuando está instalado.

Pruebas adicionales explícitas (con el servicio local apagado):

```powershell
node scripts/test-desktop-process.mjs
node scripts/test-desktop-host.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File windows/LumaTray.ps1 -ValidateOnly
```

Las pruebas de procesos usan primero un hijo simulado; las del host real desactivan TV y descargas y sirven ambos builds por HTTP. `npm test` cubre selección de app, exclusión, pérdida de reserva y relevo simulados; esto no acredita un relevo físico entre computadoras, reproducción en sitios reales ni cobertura general de Internet.

Validación actual 2026-10-26: suite local completa, tres builds, ciclo real de procesos y host HTTP aislado correctos en Windows. Relevo real con Mac en ambos sentidos y perfil por TV sincronizado. Los paquetes instalados en TV se consultaron por SSH: Luma 0.9.2 y Holy 0.9.5. No se lanzaron apps, capítulos ni navegaciones de prueba.

**Bandeja:** EXE 0.9.11.0 instalado y autoprueba correcta; Doctor, dirección web y controles visibles. Arranque al iniciar sesión activado. Sin ensayo de reinicio físico de Windows, suspensión/red real ni vídeo prolongado tras relevo. No se compiló ni instaló Swift desde este equipo. Detalle: [INTEGRACION-WINDOWS-20261026.md](INTEGRACION-WINDOWS-20261026.md).
