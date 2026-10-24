# JKAnime · QR dinámico · 2026-10-23

El QR reportado se reprodujo en la LG con el motor y las siete listas activos. No era el vídeo: una capa de pantalla completa se añadía después de la carga inicial y pedía «Confirm you're not a robot» / «Scan the qr-code with your phone».

## Origen comprobado

`evidence/jkanime/loader-trace.json` registra la pila al crear el iframe: apunta a `https://db.unboltsecole.com/r5K9akItvISYz1J/128512`. La solicitud pasaba por el motor sin bloqueo. La captura `qr-before.png` muestra la superposición real en la TV, no una simulación.

El iframe carecía de `src`, usaba posición fija, ocupaba la pantalla y tenía `z-index: 2147483646`. EasyList Español incluía para JKAnime un selector de iframe con `z-index: 2147483647`, que no coincide. El scriptlet que bloqueaba `window.open` tampoco impide que un script escriba un anuncio dentro de la página. La guardia propia anterior estaba limitada a Cuevana.

La inserción después de cargar está comprobada. No se midió rotación de dominios/campañas ni se conoce el momento exacto en que el sitio cambió: no atribuirlo sin evidencia a una actualización reciente, a todos los QR ni a un fallo de DNS.

## Corrección

- Regla de red de `scripts/shields.mjs`: bloquea scripts de `unboltsecole.com` únicamente cuando el origen es JKAnime. No depende de su ruta cambiante.
- `scripts/navigation-shield.mjs`: protección de ventanas en JKAnime y sus embeds, además de Cuevana. Los enlaces normales pueden seguir usándose en la misma pestaña.
- Segunda barrera para el QR observado: solo en esos sitios y sus embeds, iframe vacío accesible, sin `srcdoc`, fijo, de tamaño casi total y z-index muy alto, con las dos frases exactas y una imagen/canvas/SVG. Observa también el contenido que se añade después. No elimina QR genéricos, autenticación, captchas desconocidos ni iframes de vídeo.

Los cambios se ejecutan en el Mac. No requieren reinstalar el IPK ni modificar DNS, firmware o arranque. La protección asistida requiere el Mac conectado.

## Validación

`npm test` pasó: reglas de red, ámbito de ventanas, QR tardío, falsos positivos de login/reproductor/iframes inaccesibles, medios preservados y las regresiones previas. El fallback se valida aparte del bloqueo de red para comprobar que no dependa solo del dominio conocido.

Prueba real: `scripts/validate-jkanime.mjs`, informe `evidence/jkanime/validation.json`. Muestras cortas; no representan episodios completos, todos los servidores ni todos los anuncios de Internet. El validador espera después de cargar, pulsa el control real de reproducción, compara tiempo y fotogramas decodificados y prueba un salto a 60 segundos. Restaura la página anterior y conserva el buscador elegido.

| Muestra en la LG, servidor Desu | QR tras espera y reproducción | Tiempo/fotogramas | Salto a 60 s |
| --- | --- | --- | --- |
| One Piece 1180 | Ausente | Avanzan | Correcto |
| One Piece 1179 | Ausente | Avanzan | Correcto |
| Hyouken no Majutsushi II, 3 | Ausente | Avanzan | Correcto |

Cada muestra bloqueó seis solicitudes publicitarias/de seguimiento; una fue el cargador QR confirmado. Esto no equivale a seis anuncios visibles. Se esperaron al menos 18 segundos adicionales tras tener vídeo listo, más las muestras de reproducción y salto. No hubo errores del puente en el informe. Una prueba controlada en la TV insertó el QR observado de forma tardía: la segunda barrera lo retiró y conservó otro QR de inicio de sesión. Esa prueba se distingue de los tres recorridos públicos. Se restauró el inicio servido y Google, que era el buscador elegido al comenzar.

Operación: detener `npm run lab`; mantener el servidor local; ejecutar `node scripts/passive-inspect.mjs`; usar el endpoint que imprima para `node scripts/validate-jkanime.mjs ENDPOINT`. Detener ese túnel al terminar y restaurar `npm run lab`. Nunca ejecutar dos interceptores a la vez ni usar un bucle de `ares-inspect`.
