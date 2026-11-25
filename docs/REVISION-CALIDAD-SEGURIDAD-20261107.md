> **Seguimiento 0.9.30:** se aplicaron correcciones verificadas en Mac a descargas, identidad SSH (TOFU), respuestas HTTP y cola; se limitó parcialmente la escritura desde otros orígenes LAN. Consulta [el estado de correcciones](ENDURECIMIENTO-20261107.md). Este informe y su evidencia conservan los hallazgos originales de 0.9.29; «abierto» en las tablas de abajo describe esa revisión histórica. Autenticación general LAN, primer contacto SSH y dependencias siguen con límites.

# Revisión de calidad y seguridad

**Fecha:** 2026-11-07, México. **Código:** 0.9.29, base Git `319aec0` más cambios locales de servidor/cola de la tarea anterior. **Entorno:** macOS, Node 22.22.3. **Resultado:** el gate funcional pasa; quedan riesgos de seguridad y defectos de calidad abiertos. No se certifica el proyecto como seguro ni se confunde el gate con una auditoría de penetración completa.

La revisión actual **no cambia código funcional, dependencias, firewall, vinculación, servicios activos ni paquetes de TV**. Entrega documentación, evidencia y una reproducción aislada. Los cambios funcionales previos permanecen sin descartar. Las correcciones propuestas abajo no se consideran aplicadas.

[Instalación](INSTALACION.md) · [Arquitectura y diagramas](ARQUITECTURA.md) · [Evidencia JSON](auditoria/evidencia-20261107.json) · [Reproducción aislada](auditoria/reproducir-20261107.mjs).

## Alcance y método

Se inventariaron **199 archivos / 24 936 líneas** en áreas de código propio y CI, incluidas pruebas y datos JavaScript. Se comprobó la sintaxis de **183 archivos JS/MJS**, sin fallos. No es una medida de cobertura ni significa que se revisó manualmente cada línea. El inventario no incluye código vendorizado de investigación.

La lectura manual siguió los puntos de confianza: servidor HTTP y API, descargas de conectores e imágenes, CLI/SSH/CDP, reserva de TV, control local y supervisor, sincronización/perfil, persistencia, registro, extensión del navegador, apertura/pausa/selección de reproducción, instaladores, configuración de builds y CI. Se contrastaron las instrucciones existentes con los scripts que realmente se ejecutan.

Se hicieron pruebas HTTP reales en puertos efímeros y con bibliotecas temporales, incluyendo un proceso hijo con la misma guardia de errores del servicio. Para probar redirecciones se simularon el primer destino HTTPS público y su DNS; el salto HTTP entre dos fixtures de loopback fue real. No se consultaron router, servicios privados reales ni reproductores externos.

Se consultó `npm audit` contra el registro y documentación primaria de LG, Node, ssh2 y OWASP. No se ejecutó `npm audit fix`, no se instaló software ni se abrió ningún puerto del router. No se examinó el historial Git completo con una herramienta especializada de secretos.

El estado vivo de la Mac indicó respaldo con Windows atendiendo la TV y perfil sincronizado. Solo se consultó el estado; no se navegó la TV ni se cambió la sesión o el buscador. La comprobación no equivale a inspeccionar físicamente qué veía el usuario.

## Hallazgos priorizados

| ID | Prioridad | Hallazgo | Estado / evidencia |
| --- | --- | --- | --- |
| SEC-01 | Alta, P1 | Chequeo anti-SSRF no cubre todas las redirecciones / resoluciones | Confirmado con fixture de redirección; abierto |
| SEC-04 | Alta, P1, condicionada a atacante en red | La aplicación no fija/verifica la huella SSH de la TV | Lectura de implementación y SDK; sin ataque real; abierto |
| SEC-02 | Media, P2 | La API habitual confía en equipos/orígenes de la LAN sin emparejarlos | Confirmado con HTTP y helper de autorización; abierto |
| SEC-05 | Media, P2 | Límites de respuestas externas se aplican tarde o no existen | Lectura de implementación; sin agotar memoria; abierto |
| SEC-03 | Media, P2 | URL de petición malformada queda fuera del manejo de errores | Confirmado en proceso aislado; abierto |
| DEP-01 | Media, P2, con alerta crítica transitiva | Diez paquetes reportados por npm audit | Consulta actual; alcance condicionado al uso; abierto |
| QUAL-01 | Media, P2 | Cola llena devuelve 404 genérico y oculta el motivo | Confirmado con 100 títulos temporales; abierto |
| QUAL-02 | Media, P2 | Faltan comprobaciones automáticas de tipos, lint y algunas fronteras | Lectura de package/CI y pruebas; abierto |
| QUAL-03 | Baja, P3 | Módulos grandes/compactados y contratos duplicados dificultan cambios | Inventario y lectura; abierto |
| DOC-01 | Media, P2 | Guías de entrada mezclaban estado histórico e instalación actual | Corregido documentalmente en esta revisión |

La prioridad representa impacto y acción recomendada, no una puntuación CVSS propia. No se encontró una ejecución arbitraria de comandos reproducible en el código propio revisado. Tampoco se afirma que no pueda existir fuera del alcance.

### SEC-01 · Descargas que siguen redirecciones fuera del destino validado

**Dónde:** `scripts/holy/server.mjs:184`, `scripts/holy/sources.mjs:10–17`, `scripts/holy/public-url.mjs:57–67`; imágenes en `scripts/holy/server.mjs:141–149` y comprobación de sitios en `scripts/holy/site-registry.mjs:74–80`.

La API comprueba el destino inicial de episodios/versiones con `publicHttpsURL`, pero `fetchText` sigue redirecciones automáticamente. Un destino inicial público aceptado puede contestar con una redirección a una IP privada; el transporte no repite la política. Algunos conectores descargan también enlaces derivados del HTML. En imágenes hay control por salto, pero `publicTarget` solo clasifica el nombre/IP escrito: no comprueba dónde resuelve un nombre público. `checkSite` tampoco usa el chequeo DNS completo.

**Evidencia:** API `/holy-api/episodes` → Catalog → `fetchText`, respuesta 200, un chequeo DNS inicial y **un acceso al fixture privado de destino**. El primer salto HTTPS/DNS fue simulado; la redirección y el acceso a loopback fueron reales. No se afirma haber atacado un router ni demostrado todas las rutas de cada conector.

**Impacto:** peticiones desde la computadora hacia destinos que la API dice rechazar. La lectura útil de la respuesta depende del parser y del servicio alcanzado; aun sin devolverla puede haber peticiones ciegas. Para explotar la redirección se necesita controlar o influir en el destino público/HTML utilizado.

**Corrección propuesta:** centralizar el transporte saliente; validar esquema/destino en cada salto, limitar redirecciones y fijar la resolución usada por la conexión o aplicar un control de salida equivalente. Rechazar resolución fallida para rutas sensibles. La resolución previa actual es una comprobación, no DNS pinning: resolver de nuevo al conectar deja una carrera. Añadir pruebas con URL pública → IP privada, nombre público → DNS privado, enlaces derivados y sitios movidos, sin inutilizar los Referer/cookies que requieren los lectores.

Referencia de diseño: [OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

### SEC-04 · Identidad del servidor SSH sin fijar por la aplicación

**Dónde:** `scripts/inspector-tunnel.mjs:11–18`; el SDK instalado llama a `ssh.connect(this.target)` en `@webos-tools/cli/lib/base/novacom.js` sin configurar `hostVerifier`/`hostHash` en el recorrido revisado.

Se autentica el cliente con la llave de Developer Mode, pero la aplicación no aporta una comprobación persistente de la identidad del servidor. La llave del cliente y la huella del servidor resuelven problemas distintos.

**Impacto condicionado:** un atacante capaz de redirigir/suplantar la conexión de red podría presentar otro servidor y falsear el canal de comandos o perfil. Esto puede comprometer datos compartidos, incluida la confianza inicial del vínculo. **No significa que la llave privada del cliente se transmita ni se haya extraído.** No se realizó un ataque en la LAN ni se midió el algoritmo realmente negociado.

**Corrección propuesta:** registro inicial de huella SHA-256 con comprobación del dispositivo y rechazo de cambios posteriores; procedimiento explícito para cambio de TV/llave. Integrarlo en el transporte compartido para que descubrimiento de pares, reserva y túnel usen la misma política. Añadir prueba de primera conexión, huella igual y huella cambiada. La compatibilidad de algoritmos viejos del SDK debe revisarse aparte con evidencia de negociación.

Referencia: [opción hostVerifier de ssh2](https://github.com/mscdex/ssh2#client-methods).

### SEC-02 · La confianza de la API se basa en estar en la LAN

**Dónde:** `scripts/holy/server.mjs:59–91`, `:199–221`, `:385`.

El control del supervisor usa token local y la sincronización usa firmas/cifrado, pero la API de catálogo/votos/cola no tiene autenticación general de dispositivos. Una página alojada en otra IP privada con el puerto esperado puede escribir; un cliente no navegador puede enviar un `Origin` privado válido. Las lecturas de catálogo, gustos y estado son accesibles a quien alcance el servidor desde la LAN. CORS limita qué puede leer un navegador, no autentica a un cliente HTTP.

**Evidencia:** POST a cola con un origen privado ajeno devuelve 200 y guarda el título temporal. El helper de autorización también devuelve `true` con IP y origen privados distintos sin credencial. La respuesta observada es consistente con el modelo de confianza existente, no una evasión de una contraseña configurada.

**Impacto:** un invitado/equipo comprometido de la red puede conocer datos del catálogo/perfil y alterar valoraciones/cola u otras acciones permitidas. Cambiar «Webs» conserva la restricción adicional de loopback; no se generaliza el impacto a esa acción. HTTP tampoco cifra el tráfico habitual. La red privada reduce exposición, pero no equivale a identidad.

**Corrección propuesta:** emparejar clientes y exigir capacidad/token por acción, autorizar orígenes propios concretos y mantener excepciones de WAM únicamente desde el contexto verificado. Separar lectura pública opcional de cambios privilegiados. No colocar una clave general en una URL o bundle servido a cualquier cliente. Mientras no exista, limitar firewall y uso a una red de confianza, sin publicar en Internet.

### SEC-05 · Respuestas de proveedores sin límite durante la lectura

**Dónde:** `scripts/holy/sources.mjs:17` y `scripts/holy/server.mjs:152–153`; otros `fetch` de `catalog.mjs` también leen HTML completo.

El timeout limita tiempo, no bytes ni memoria. `response.text()` no tiene un límite propio. Las imágenes se limitan a 4 MB **después** de `arrayBuffer()`, cuando ya se ha reservado el cuerpo completo. No hay un presupuesto general de concurrencia para todos los pedidos HTTP que disparan lectores.

**Impacto:** un proveedor/redirección hostil o múltiples solicitudes puede consumir memoria y afectar el worker de reproducción. No se intentó provocar un agotamiento real ni se cuantificó un umbral de caída.

**Corrección propuesta:** lector streaming acotado por bytes descomprimidos, cancelación del body al superar el presupuesto, comprobación temprana de Content-Length como ayuda adicional y semáforo de concurrencia. Probar cuerpo por chunks sin Content-Length y cuerpo comprimido expansivo; no basta con revisar solo la cabecera.

### SEC-03 · URL malformada sin respuesta controlada

**Dónde:** `scripts/holy/server.mjs:205`; la construcción de `URL` está antes del `try`. En `scripts/crash-guard.mjs` el rechazo global se registra y no finaliza la petición.

**Evidencia:** `GET http://[` enviado solo a un proceso hijo temporal con la guardia real genera `Invalid URL`, no contesta en el plazo de observación de 400 ms y permite una petición de salud posterior con 200. **No se observó la caída del worker habitual**: la guardia conserva el proceso vivo. Sin esa guardia, el mismo rechazo puede terminar un proceso independiente.

**Impacto:** solicitudes inválidas quedan abiertas hasta que intervenga el transporte/cliente. Repetirlas puede consumir conexiones. No se realizó una prueba de saturación contra el servicio real.

**Corrección propuesta:** validar URL dentro del manejo de errores, devolver 400 y asegurar que cada rama termina la respuesta. Probar targets absolutos malformados, rutas inválidas y métodos no admitidos en un hijo aislado con y sin la guardia de producción.

### DEP-01 · Dependencias: 10 alertas, no 10 exploits demostrados

Consulta `npm audit --json` del 07/11/2026: **1 crítica, 3 altas, 4 moderadas y 2 bajas**. La cuenta es de paquetes reportados por npm, con propagación de dependencias; no son diez fallos independientes explotables en Holy.

| Paquete reportado | Gravedad npm | Relación / alcance |
| --- | --- | --- |
| `proxy-addr` | Crítica | Transitiva de CLI LG; asociada a la cadena Express de herramientas |
| `@webos-tools/cli`, `body-parser`, `brace-expansion` | Alta | CLI LG, servidor auxiliar y operaciones de herramientas |
| `glob`, `minimatch`, `qs`, `rimraf` | Moderada | Transitivas de CLI / utilidades |
| `deepmerge`, `@sveltejs/vite-plugin-svelte` | Baja | Configuración de compilación y dependencia afectada |

El servicio propio usa `node:http`, no Express; el servidor auxiliar de la CLI no se inicia en el flujo normal revisado. La CLI **sí se importa durante la conexión** por novacom, por lo que llamar a todo `devDependencies` no demuestra que nada llegue al runtime. El alcance exacto de cada advisory depende de la función utilizada. No se demostró explotación del advisory crítico en el servicio habitual.

Los vínculos a advisories y rutas transitivas están en [la evidencia](auditoria/evidencia-20261107.json). No se ejecutó un downgrade de CLI ni `npm audit fix --force`: npm propone cambios que requieren verificar compatibilidad, y el SDK lleva dependencias propias. Hay que ensayar una actualización/aislamiento de la CLI en un entorno separado, volver a ejecutar instalación, vinculación, empaquetado y gate, y registrar la aceptación temporal de alertas que queden. La cuenta cambia con el registro; repetir audit antes de una entrega.

### QUAL-01 · El límite de cola pierde su mensaje

**Dónde:** `scripts/holy/library.mjs:187–199`, `scripts/holy/server.mjs:379–380`, `src/Holy.svelte` (`toggleQueue`).

La biblioteca lanza un mensaje claro al superar 100 títulos. El manejador HTTP lo convierte en **404 / `no disponible`**, de modo que la UI no puede explicar que hay que quitar uno primero. La prueba previa de biblioteca comprueba el límite, pero no la presentación de ese fallo por la API.

**Evidencia:** cola temporal con 100 títulos; petición 101 → `{"ok":false,"error":"no disponible"}`. La cola permanece en 100; no se observó corrupción de datos.

**Corrección propuesta:** errores de dominio tipados (por ejemplo 409 y `queue_full`) con mensajes aptos para el usuario. Ampliar la prueba API y la prueba compilada de UI para fallos esperados, no solo éxito. La operación actual es un toggle: si se pierde la respuesta, su resultado puede ser ambiguo; un futuro comando explícito agregar/quitar sería más fácil de reintentar con seguridad.

### QUAL-02 / QUAL-03 · Mantenibilidad y verificación

- `playback:check` es una base fuerte: suite, contratos offline y tres builds con huella estable. No hay scripts de lint ni comprobación de tipos en `package.json`, ni esos pasos en CI. La compilación no comprueba contratos de datos entre todos los JSON, puente, API y Svelte.
- `Holy.svelte` tiene 1145 líneas; `holy-bridge.mjs`, 968; `browser-bridge.mjs`, 730. Muchos módulos de conexión/sincronización están compactados en líneas largas. El problema es la mezcla de responsabilidades y la dificultad de revisar cambios, no el número de líneas por sí solo. `anime-classics-data.js` es un bloque de datos y no debe contarse como complejidad lógica.
- Los validadores de red están repartidos entre `public-url`, `private-network`, `server`, `site-registry` y el complemento. Resuelven contextos distintos, pero la duplicación contribuye a excepciones e inconsistencias; SEC-01 es el ejemplo confirmado.
- `test-holy-security` cubre URL inicial, IP privada literal, Origin, Host y algunos redirects de imágenes. No cubría el redirect seguido dentro de `fetchText`, la URL malformada ni el error HTTP de capacidad de cola. Un gate verde no prueba esas propiedades que no aserta.
- El gate no produce un porcentaje de cobertura de código. Sus 37 casos son una matriz documental de escenarios, y sus 11 fuentes son contratos offline. CI usa acciones por etiqueta mayor, no por SHA inmutable, y no ejecuta npm audit como condición de entrega.
- Los tests crean logs temporales; `validate-engine`, incluido en la suite, también escribe evidencia versionada. En esta revisión se restauró el archivo de evidencia que ya existía antes del gate. Conviene separar artefactos de prueba de archivos de trabajo del dueño y limpiar los directorios temporales al terminar.

**Propuesta incremental:** primero pruebas de fronteras y errores tipados; después extraer transporte saliente y políticas de autorización; separar UI de catálogo, reproducción y persistencia en cambios pequeños respaldados por regresiones. Añadir comprobación de tipos/JSDoc, lint y formato gradual; evitar una reescritura simultánea del puente y su máquina de reproducción.

## Controles que sí se verificaron

- Control local de supervisor en loopback con token aleatorio; túnel inspector también en loopback y puerto aleatorio.
- Reserva de TV, exclusión local y guardias de pérdida/relevo; la suite no permite dos runtimes deliberados de prueba sobre la TV.
- Comandos del puente limitados por contexto propio/aislado; no se identificó un camino probado de texto del catálogo hacia `eval` de Node.
- Sincronización cifrada AES-GCM y firmada con HMAC, nonce, límites de tamaño y vigencia. Las pruebas de firma, repetición, merge y progreso pasan.
- Host/Origin y CORS del servidor, bloqueo de IP privadas directas en las rutas probadas, y sandbox/nosniff para imágenes. Son controles parciales con los límites descritos arriba.
- Cuerpos JSON acotados y tokens de progreso web limitados a una sesión; la extensión conserva autorizaciones por proveedor.
- Persistencia mediante temporales y renombrado en los flujos principales, marcas de borrado y respaldo previo a ciertas importaciones.
- Registro con eliminación de parámetros de URL y valores sensibles en las rutas revisadas.
- El escaneo heurístico encontró un marcador de llave privada **falso y explícito de fixture** en `test-app-package.mjs`, no una llave válida. El único `{@html}` del área escaneada está en `Icon.svelte` y usa el catálogo de SVG estáticos `icons.js`; no se identificó entrada remota allí. Esto no sustituye un escáner de secretos ni una auditoría del historial.

## Validación reproducible

```sh
# Suite y builds (no navega la TV)
npm run playback:check

# Consulta actual al registro; el código de salida puede ser distinto de cero por alertas
npm audit --json

# Solo fixtures temporales; recoge hallazgos abiertos, NO es un gate de seguridad aprobado
node docs/auditoria/reproducir-20261107.mjs
```

La reproducción crea sus servidores en puertos efímeros, usa directorios temporales y cierra el proceso hijo al terminar. El servidor de prueba reutiliza `startServer` y, por ello, escucha brevemente en todas las interfaces, aunque todas las peticiones de la prueba se envían a loopback. No usa los puertos fijos de producción ni abre conexiones SSH. Guarda resultados en `.local/audit-20261107/probes.json`. Su salida 0 significa que recogió evidencia; no significa que los problemas estén corregidos.

Resultado guardado del gate: suite completa y builds Luma / Holy TV / Holy web correctos, **37 casos / 11 fuentes**, con huella de entrada y salida iguales. Las duraciones, huellas y salidas están en el JSON de evidencia. No hubo prueba física nueva de TV, instalación limpia de Windows, ensayo de agotamiento de memoria ni prueba de todos los sitios de Internet.

## Documentación corregida y plan de cierre

El README anterior describía 0.6.0, IPs de octubre y arranque del laboratorio antiguo. La guía Windows mezclaba «Mac pendiente» con validaciones históricas ya superadas. Se reemplazó la entrada por documentación vigente y se conservaron los resultados históricos identificados como tales. Ahora se distinguen versión de código, EXE, IPK Holy e IPK Luma; dependencia de la computadora; paso que requiere instalación de UI; cola local; y reproducción web limitada por Referer.

| Orden | Trabajo | Criterio para cerrarlo |
| --- | --- | --- |
| 1 | Transporte saliente seguro (SEC-01/05) | Pruebas de saltos/DNS/bytes/concurrencia, contratos y gate; HTTP real posterior separado |
| 2 | Fijación de huella SSH (SEC-04) | Primera vinculación verificada, cambio rechazado y recuperación documentada; ensayo físico fuera de reproducción |
| 3 | Identidad/permisos para API LAN (SEC-02) | Cliente no emparejado no lee/cambia datos privados; TV y web autorizadas siguen funcionando |
| 4 | Respuestas 400 y errores de dominio (SEC-03/QUAL-01) | Petición inválida siempre termina; UI comunica cola llena y conserva datos |
| 5 | Dependencias y CI (DEP-01/QUAL-02) | Matriz de advisories actualizada, SDK compatible y checks continuos con alcance explícito |
| 6 | Refactor pequeño y pruebas faltantes (QUAL-03) | Contratos de módulos claros sin degradar pausa, Atrás, idioma ni progreso |

No se marca ninguno de los riesgos de código como resuelto por haber escrito esta guía. El despliegue pendiente de 0.9.29 en Windows/TV y los cierres nativos siguen en [SOUL](SOUL.md).
