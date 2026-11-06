# Revisión de seguridad · 2026-11-06

Alcance: lo que escucha en la red (servidor de Holy, servidor de pruebas, canal de sincronización), lo que ejecuta comandos, llaves y secretos, la extensión del navegador, los lanzadores de Windows/Mac y las dependencias. Hecha en Windows (`djoker`), **sin navegar la TV** y sin cambiar nada del sistema. Probado con pruebas locales (`npm test`); **no probado con la TV real** ni con el servicio en marcha (sigue con el código anterior hasta reiniciarlo).

## Cómo se ve el riesgo

El servidor de Holy (puerto 43190) escucha en toda la red local. Quien llega a él no es solo «un equipo de la casa»: también cualquier **página web** abierta en un navegador de la red (o en la propia TV, que abre páginas con anuncios) puede mandarle peticiones. Los huecos buscados son los que permitían eso.

## Corregido (en código, con pruebas)

| # | Riesgo | Qué pasaba | Qué cambia |
| --- | --- | --- | --- |
| 1 | **Alto** | El origen `null` se aceptaba desde cualquier equipo. Una web cualquiera lo produce con un iframe «sandbox», así que podía mandar órdenes: **cambiar a qué dirección se conecta Holy para un sitio** (`/holy-api/sites`, desde la propia computadora por `localhost`), lanzar Doctor, votar, borrar «Continuar viendo», forzar búsquedas. Cambiar un sitio hacía que Holy leyera y abriera contenido de un sitio ajeno en la TV. | `null` solo vale si viene de la IP de la TV (la app empaquetada la usa); nunca para `sites` ni `doctor`. |
| 2 | Medio | Todas las respuestas llevaban `Access-Control-Allow-Origin: *`: cualquier web podía **leer** tus gustos, historial, estado y sitios. | Solo las páginas de la red local y la TV pueden leer; los sitios de Internet no. |
| 3 | Medio | No se miraba la cabecera `Host`: «DNS rebinding» (un dominio público re-apuntado a la computadora) leía el servidor como si fuera suyo. | Solo se aceptan direcciones IP, `localhost`, nombres sencillos (`djoker`) y sufijos de red local (`.local`, `.lan`…). |
| 4 | Medio | El servidor descargaba cualquier `https://` que le pidieran (`episodes`, `versions`, `resolve`): se podía apuntarlo a otros equipos, al router o a servicios internos. | Solo nombres públicos que no resuelvan a direcciones privadas (`scripts/holy/public-url.mjs`). |
| 5 | Bajo | Imágenes: una redirección podía llevar la petición a la red local; una imagen SVG abierta directamente podía ejecutar scripts. | Redirecciones seguidas a mano y comprobadas salto a salto; `Content-Security-Policy: sandbox` y `nosniff`. Además `X-Content-Type-Options` y `X-Frame-Options` en todo. |
| 6 | Medio | El escudo de la TV no impedía que una página de Internet (un anuncio) pidiera cosas a Holy, al router o a `localhost`. | `scripts/private-network.mjs`: se bloquea lo que una página **pública** pida a la red local (abrir una dirección local escrita por ti sigue funcionando; Holy y Luma no cambian). No cuenta como «anuncio bloqueado». |

Pruebas nuevas: `scripts/test-holy-security.mjs` (7 comprobaciones, incluidas las del servidor real con `Host` falso, orígenes ajenos, `null`, descargas hacia la red de casa y redirecciones de imágenes) y un caso en `test-bridge.mjs`. Se ajustó `test-holy-robust.mjs`, que daba por bueno el `null` desde cualquier equipo.

## Revisado y correcto

- **Llave SSH de la TV**: cifrada con passphrase y con permisos solo para tu usuario. Ninguna llave, token ni passphrase en el repositorio ni en su historial (el único «BEGIN RSA PRIVATE KEY» es el dato falso de una prueba).
- **Sincronización entre equipos**: AES‑256‑GCM más HMAC, nonce de un solo uso y ventana de 5 minutos, comparación en tiempo constante, tamaño limitado. Sólida.
- **Supervisor local**: solo `127.0.0.1`, con token aleatorio.
- **Servir archivos**: `safePath` evita salirse de la carpeta.
- **Extensión del navegador**: solo acepta servidores Holy (puerto 43190) con el mismo origen de la página, token por sesión, comprueba que el reproductor sea el registrado. Bien diseñada.
- **CI**: permisos de solo lectura, sin credenciales guardadas.
- **Dependencias**: `npm audit --omit=dev` → 0 vulnerabilidades. Las 5 alertas conocidas son del SDK de webOS (solo herramientas de desarrollo).
- **Registro**: los 107 rechazos de origen guardados son de las propias pruebas (`evil.example`); no hay señales de un intento real.

## Pendiente (por orden)

1. **Firewall de Windows** (necesita administrador; no lo cambié). La regla «Node.js JavaScript Runtime» deja entrar TCP y UDP desde **cualquier dirección y puerto** a `node.exe`, y la red está marcada «Pública». Cualquier otro programa de Node que abras queda expuesto. `windows/Firewall-LAN.ps1` crea una regla estrecha (TCP 43187, 43188 y 43190, solo red local) y, con `-QuitarReglasAmplias`, desactiva las amplias; con `-WhatIf` solo muestra qué haría y `-Deshacer` lo revierte. Probado solo en simulación.
2. **Huella SSH de la TV sin fijar.** El SDK de webOS no verifica la huella del host: quien se haga pasar por la TV en la red (suplantación ARP) podría recibir el canal del inspector y falsear el registro de equipos de la sincronización (llevando la biblioteca a un equipo ajeno; no revela la llave SSH). Diseño: guardar la huella en el primer contacto (`hostVerifier` en `AssistSession.begin`, `scripts/inspector-tunnel.mjs`) y avisar por Doctor si cambia. **No implementado:** si la TV regenera su llave (reinicio de fábrica, reactivar modo desarrollador) bloquearía la conexión y no puedo probarlo con la TV real.
3. **No hay autenticación entre equipos de la red.** La comprobación de origen frena a los navegadores, no a un programa que falsifique la cabecera (`curl`). Un equipo malicioso dentro de tu wifi sigue pudiendo leer el catálogo y votar o borrar historial. Propuesta: exigir la clave ya compartida de sincronización (firmar las peticiones que cambian datos) salvo para la TV y `localhost`. Requiere tocar la interfaz de la TV (IPK).
4. Servidor de pruebas (43187/43188) siempre activo; solo atiende a la TV y a esta computadora, pero guarda un registro de peticiones y lo sirve en `/lab-log`. Convendría arrancarlo solo al validar.
5. Sin `Content-Security-Policy` de scripts en las páginas de Holy (la web usa un reproductor incrustado que necesita su Referer); habría que medirlo antes.
6. Lanzador de Windows: abre la dirección de estado con el shell sin comprobar que sea `http://`, y los `.ps1` se ejecutan con `-ExecutionPolicy Bypass`. Riesgo bajo (la dirección sale del propio servicio); requiere recompilar el EXE.

## Para aplicar y comprobar

Los cambios del servidor valen cuando se reinicie el servicio (`npm run desktop:restart`; corta unos segundos la conexión con la TV, mejor sin vídeo en curso). Después:

1. Desde la TV: dar «Me gusta» y cambiar idioma. Si falla, `npm run desktop:log` o el registro mostrará `origin-refused` con `null`: significa que la IP de la TV guardada (`.local/desktop-config.json`, `tvIp`) no coincide con la real.
2. Desde un teléfono: abrir `http://<computadora>:43190/` por IP y por nombre; un nombre de Internet apuntando a la computadora ya no responde.
3. Opcional: ejecutar `windows/Firewall-LAN.ps1 -WhatIf`, luego sin `-WhatIf` como administrador.

## Aplicación y corrección física0.9.24 · 06/11

Windows reiniciado y Holy0.9.24 instalado en la LG. La TV real file:// omitía Origin: votos e idioma daban403. Se corrigió en HolyBridge: solo el frame principal del inicio propio recibe Origin del API propio, antes de reenviar la petición; se excluyen jugadores externos, iframes, frames desconocidos y destinos ajenos. El servidor mantiene sus reglas estrictas. Test de seguridad nuevo con estos límites y gate completo correctos. Repetición real desde LG: voto existente y preferencia de idioma existentes200/ok. Sin cambiar gustos efectivos, firewall ni llaves. Detalle: docs/INTEGRACION-MAIN-20261106.md.
