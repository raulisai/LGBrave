# Reconexión en Windows y apps de Tienda · 2026-10-31 · 0.9.21 / EXE0.9.13.0

## Causa

Windows da a cada app instalada desde la Tienda (paquete MSIX) una copia privada de `AppData`: lo que esa app o sus procesos hijos escriben en `%APPDATA%` o `%LOCALAPPDATA%` va a `%LOCALAPPDATA%\Packages\<app>\LocalCache`. Además, Windows termina esos procesos cuando la app se cierra o se actualiza. Las rutas y variables de entorno son idénticas dentro y fuera, por eso ni el lanzador 0.9.12.0 ni la huella de contexto de Doctor 0.9.20 podían verlo.

El 25/10 la vinculación se hizo desde Codex, que es app de Tienda. Quedaron dentro de su copia privada, y no en las carpetas normales:

| Dato | Dentro de Codex | Fuera (lo que ve el arranque de Windows) |
| --- | --- | --- |
| Registro webOS `novacom-devices.json` | con `lg-lab` y su passphrase | solo `emulator` |
| `HolyLuma\peer-sync.json` | identidad, clave y equipo emparejado | sin clave ni equipos |
| `HolyLuma\profile-recovery.json` | presente | ausente |

La llave `~/.ssh/lg-lab_webos` siempre estuvo en su sitio: la carpeta de usuario no se redirige.

Resultado: el servicio iniciado desde Codex conecta; el iniciado por el acceso de Windows dice «Falta vincular». Reiniciarlo desde Codex «lo arreglaba», y eso fue lo que el informe del 28/10 tomó por recarga correcta.

## Evidencia

- 27/10 04:06 inicio de sesión, servicio del acceso de Windows: `setup`. Sigue en `setup` en cada arranque hasta el 28/10 14:54, cuando un reinicio conectó en 9 s; el relato de esa sesión apunta a Codex, aunque el registro no guarda quién lo lanzó. Son unas 35 h en total, incluida la suspensión del equipo.
- 31/10 01:25:03 el equipo despierta; 01:25:09 último evento del servicio; 01:25:12 Windows actualiza el paquete de Codex. No hay evento `stopping`, ni del supervisor, ni nada más hasta las 02:35: el servicio murió con la actualización. Codex volvió a abrir a las 01:25:37.
- 31/10 02:35:55 el icono arranca desde Explorer (`--background`), fuera de Codex: `setup` y `authorization-missing` cada minuto hasta esta corrección.
- `Doctor` no podía repararlo: la llave existe, pero el perfil solo está en la copia privada. El respaldo público tampoco bastaba: la llave está cifrada y necesita la passphrase, que el respaldo no guarda a propósito. Esa recuperación nunca habría funcionado con la llave de esta TV.

## Corrección

- `desktop/shared/app-package.mjs` localiza copias privadas y detecta con una escritura real si el proceso vive dentro de un paquete.
- `profile-recovery.mjs` mueve el perfil completo desde una copia privada al registro propio del SDK, sin tocar los demás dispositivos. Exige que la llave exista. La copia pública sigue sin secretos y ya no se usa para restaurar una llave cifrada: en ese caso pide autorización, sin fingir que restauró.
- `desktop-host.mjs` adopta los ajustes de sincronización de una copia privada solo si los propios no tienen clave. Publica `appPackage` en el estado; `doctor` lo explica.
- `desktop-control start`, y por tanto `restart` y Doctor, ya no dejan el servicio dentro de una app: desde un paquete abren el acceso con Explorer y el icono arranca el servicio en la sesión del usuario. `install-windows-app` hace lo mismo con el icono.
- EXE0.9.13.0: una segunda instancia con `--background` pide iniciar el servicio en silencio, sin abrir el panel.
- El supervisor distingue una suspensión de un worker bloqueado. Antes cada despertar gastaba un intento de Doctor y reiniciaba un worker sano (16:07 del 30/10 y 01:25 del 31/10).

## Sin cambios, por diseño

- `La TV la atiende holy-mac`: la Mac tenía la reserva. La mayor parte de esas esperas son relevo normal.
- `fetch failed` del 30/10 16:56 a 17:00 (4 min): doodstream cerró la app en la TV; volvió al reabrirla. El mensaje es poco claro y cada reintento rehace la sesión SSH, pero no es un fallo de reconexión.

## Límites

- Si una app de Tienda escribe de nuevo el registro webOS (por ejemplo `ares-setup-device` desde Codex), ese cambio queda en su copia privada. Solo se recupera si falta el perfil; un cambio posterior de IP ahí no llega al registro normal. Usar «Vincular TV» o «Configurar direcciones» del panel.
- La suspensión y el reinicio físico siguen pendientes de observar en la práctica con esta versión.
- Se mantiene la copia privada de Codex: es un respaldo y no se borró.
