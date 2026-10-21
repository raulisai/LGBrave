# LG Lab

Laboratorio local para LG 75UR8750PSA. Primera sesión: 21 de octubre de 2026, zona America/Mexico_City.

## Resultado de esta sesión

Se configuró la CLI oficial de LG, se autenticó el acceso de desarrollo, se recopiló un inventario de lectura y se creó, empaquetó, instaló y ejecutó una app Svelte. Se verificó el renderizado real mediante el inspector de la TV y se guardó una captura.

No se escribió firmware, no se cambiaron particiones ni arranque y no se obtuvo acceso root. El inventario **no es un respaldo recuperable del firmware**.

| Dato | Resultado y procedencia |
| --- | --- |
| Modelo | 75UR8750PSA, confirmado por la TV |
| IP utilizada | 192.168.1.134, respondió por red y autenticación SSH |
| SDK | 10.3.2, confirmado por `ares-device` |
| Firmware | 33.31.75, confirmado por `ares-device` |
| Versión de interfaz aportada | webOS 25 / 10.3.2-33; no confundir con firmware 33.31.75 |
| Placa | K8LPN_ATSC_US |
| OTA ID | HE_DTV_W23P_AFADATAA |
| Kernel | Linux 5.4.268-294.24.papikonda.2, aarch64 |
| CPU visible | 4 procesadores lógicos; identificadores ARM 0xd05 y 0xd0a, dos de cada uno |
| RAM visible para Linux | MemTotal 1,252,016 KiB ≈ 1.19 GiB; no demuestra la RAM física total instalada |
| Memoria disponible inicial | 266,052 KiB; varía con la ejecución |
| Almacenamiento de apps | 665.4 MiB disponibles inicialmente en mmcblk0p59; compartido con otros datos |
| Disco completo visible | 7,634,944 bloques de 1 KiB, aproximadamente 7.28 GiB; no todo disponible para apps |
| Usuario SSH | prisoner, UID 5874, grupo jailer; sin root |
| Sesión Developer Mode | Usuario confirmó 999h:47m durante la sesión; requiere nueva comprobación en futuras sesiones |
| Key Server | Puerto 9991 accesible y obtención de llave exitosa |
| Motor real de la app | Chromium 120.0.6099.270, obtenido del user agent |
| Área real de la app | 1920 × 1080; devicePixelRatio 2 |
| WebGL | Creación de contexto exitosa; no constituye un benchmark |

## Evidencias y verificaciones

Carpeta: [evidence/2026-10-21T07-47-26.430Z](evidence/2026-10-21T07-47-26.430Z).

- `manifest.json`: comandos de lectura y sus códigos de salida.
- `identity.txt`, `cpu.txt`, `memory.txt`, `storage.txt`, `partitions.txt`: inventario.
- `app-runtime.json`: renderizado, dimensiones, motor y pruebas de teclas mediante DevTools.
- `app-tv.png`: captura real del contenido de la app desde el inspector.
- `install-confirmation.txt`, `running-after-verification.txt`: app instalada y en ejecución.
- `npm-audit.json`: avisos de dependencias de la herramienta de desarrollo.

Pasaron las comprobaciones de renderizado, flechas, OK, patrón de color y Atrás dentro del patrón. Las teclas se simularon en DevTools: falta validar el control físico y el comportamiento de Atrás fuera del patrón. No hubo excepciones notificadas durante la verificación; no implica ausencia de errores en todo el ciclo de vida.

La app dejó de aparecer en ejecución durante la primera revisión; no se determinó la causa. Tras relanzarla, el primer intento de inspección ocurrió antes de existir el DOM. Se agregó espera de renderizado al verificador y la revisión pasó sin modificar el paquete desplegado. Registrar si el cierre se repite.

`/etc/os-release` y `/sys/firmware/devicetree/base/model` no estuvieron disponibles. El inventario de particiones no establece su contenido ni el mecanismo de arranque. No se enumeraron todos los servicios internos ni sus permisos.

## Uso local

Node instalado: 22.22.3; npm 10.9.8; macOS 26.6.2 arm64; CLI 3.2.6 instalada solo en este proyecto. Versiones fijadas en package-lock.json. El paquete actual declara Node >=20; la página de instalación de LG conserva recomendaciones antiguas de Node 14–16. Se verificó el flujo con Node 22.

```sh
npm ci
npm run dev
npm run package
npm run tv:info
npm run inventory
```

El paquete se genera en `artifacts/com.lgapp.lab_0.1.0_all.ipk` (18,476 bytes en esta sesión). El bundle solo incluye la app; la CLI permanece en el Mac.

Antes de cada conexión: abrir Developer Mode en la TV, confirmar IP, modo habilitado y contador vigente. No suponer que la IP histórica sigue correspondiendo a esta TV. Tras autenticar, comprobar el modelo con `npm run tv:info`.

El dispositivo `lg-lab` quedó registrado en la configuración local de la CLI. La llave está en `~/.ssh/lg-lab_webos`, fuera del proyecto. No incluir llaves ni passphrases en documentación ni control de versiones. Si cambia la IP, actualizar el perfil; si cambia la autenticación, activar Key Server y volver a obtener la llave con el comando interactivo.

```sh
npx --no-install ares-setup-device --modify lg-lab --info 'host=IP_ACTUAL'
npx --no-install ares-novacom --device lg-lab --getkey
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_0.1.0_all.ipk
npm run tv:launch
npx --no-install ares-inspect --device lg-lab com.lgapp.lab
```

El inspector imprime un puerto local variable. Conservar ese proceso durante la inspección y usar su origen local:

```sh
npm run verify:tv -- http://127.0.0.1:PUERTO evidence/runtime
```

El verificador modifica únicamente el estado visual de la app de prueba y guarda captura y datos en el Mac. Iniciar la app con “Probar OK” seleccionado y sin patrón abierto.

Para retirar solo esta app:

```sh
npx --no-install ares-install --device lg-lab --remove com.lgapp.lab
```

## Límites y camino hacia OSE

1. **Apps web:** el despliegue de Svelte está demostrado. La app está empaquetada con recursos locales y no necesita un servidor del Mac para ejecutarse. Las APIs internas están sujetas a permisos; SSH Developer Mode no concede control completo del sistema.
2. **Gráficos:** LG documenta gráficos hasta 1920 × 1080 para apps web en UHD. El panel es 3840 × 2160 a 60 Hz según la ficha del modelo. La capacidad de video 4K depende además del códec y sus límites. No se probó reproducción multimedia, DRM ni rendimiento sostenido.
3. **Persistencia:** Developer Mode caduca. LG indica que al desactivarse se desinstalan las apps de desarrollo. Renovar desde la app oficial antes de que expire; no se configuró renovación automática.
4. **Recursos:** espacio y memoria son limitados y variables. MemTotal y RAM disponible no son el máximo de memoria permitido a una app. Medir antes de cargas grandes.
5. **OSE:** las plataformas documentadas de referencia incluyen Raspberry Pi 4 y requieren una imagen específica. No se encontró en las fuentes consultadas soporte demostrado para 75UR8750PSA/K8LPN_ATSC_US. Compartir arquitectura ARM no basta: se necesitan BSP, kernel y controladores de gráficos, panel, audio, video y periféricos.
6. **Arranque:** siguen sin verificar bloqueo del bootloader, secure boot, posibilidad de arranque externo y recuperación oficial. No inferir que se puede instalar OSE desde Developer Mode. No se hicieron pruebas de escritura ni se descargó/flasheó una imagen para la TV.

Próximos experimentos: probar control físico; medir memoria y FPS de una carga pequeña; probar video con archivos locales controlados; explorar solo APIs públicas necesarias; localizar fuentes abiertas LG de la placa/firmware y estudiar BSP, arranque y recuperación documentalmente. Si se desea experimentar con una imagen OSE antes de demostrar compatibilidad de esta TV, usar hardware de referencia externo por HDMI conserva el firmware de la pantalla, aunque no reemplaza su sistema interno.

La auditoría npm reportó 10 avisos en dependencias de la CLI (incluido uno crítico). `npm audit fix` no los resolvió. Se conserva el reporte y la versión oficial sin forzar sustituciones incompatibles. No se desplegaron estas dependencias en la TV.

## Fuentes oficiales consultadas

- [Developer Mode y conexión](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)
- [Instalación de CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
- [Código de la CLI oficial](https://github.com/webos-tools/cli)
- [Motor web por plataforma](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
- [Resolución de aplicaciones](https://webostv.developer.lge.com/develop/specifications/app-resolution)
- [Ficha LG México del modelo](https://www.lg.com/mx/tv-soundbars/ultra-grandes/75ur8750psa/)
- [Requisitos de OSE](https://www.webosose.org/docs/guides/setup/system-requirements/)
- [Adaptación a hardware de OSE](https://www.webosose.org/docs/guides/setup/bring-up-guide/bring-up-overview/)
