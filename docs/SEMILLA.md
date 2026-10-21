# SEMILLA · Luma Browser Lab

Actualizada: 2026-10-21. Proyecto: `/Users/djoker/code/lgApp`. Versión instalada: **0.5.0**, app `com.lgapp.lab`. El usuario confirma que funciona bien. Esta es la memoria compacta para continuar; comprobar el código cuando contradiga el documento.

## Objetivo y decisiones del usuario

- Navegador para LG con interfaz inspirada en Safari y bloqueo basado en Brave. Validar capacidades reales antes de ampliar funciones.
- Google por defecto; Configuración permite Google, Bing, DuckDuckGo y Brave Search. No cambiar de proveedor automáticamente ante errores.
- Conservar el firmware original. No se autorizaron cambios de arranque, particiones ni flasheo. DNS queda para el final.
- Objetivo lejano: investigar viabilidad de webOS OSE personalizado; **no existe todavía una ruta de instalación o recuperación validada para esta TV**.
- Comunicación en español y sencilla. No prometer cero publicidad ni un porcentaje de Brave replicado.

## Equipo y entorno

- LG 75UR8750PSA, α5 AI 4K Gen6 comercial, panel 3840 × 2160; interfaz observada 1920 × 1080, Chromium 120.
- webOS 25; SDK/sistema mostrado 10.3.2-33; firmware inventariado 33.31.75. Consultar `docs/INITIAL-INVENTORY.md` antes de extrapolar hardware.
- TV observada `192.168.1.134`; Mac `192.168.1.148`. Son datos cambiantes. Usuario confirmó Developer Mode activo y contador 999h:47m en una fase anterior; no es una lectura actual.
- Perfil CLI `lg-lab`; llave fuera del proyecto `~/.ssh/lg-lab_webos`. Nunca copiar llaves ni passphrases a documentos/evidencias.
- Node 22.22.3, npm 10.9.8, macOS arm64. CLI LG local 3.2.6; Svelte 5.57.2, Vite 8.3.5. Versiones fijadas en lock.
- Último almacenamiento libre informado: ~0.66 GB; pendiente medir de nuevo. Inventario no equivale a respaldo recuperable del firmware.
- **No hay repositorio Git inicializado en esta carpeta al redactar esta semilla.** No existen commits o rollback por Git.

## Qué construimos y cómo funciona

1. Entorno CLI, conexión de desarrollo SSH, inventario y despliegue de app Svelte empaquetada como IPK.
2. Inicio, favoritos, barra de navegación y controles de TV. Bundle clásico IIFE: corrigió problemas de recursos al regresar desde páginas remotas.
3. Motor real Brave: Node `adblock-rs` 0.13.3 en Mac; crate Rust del mismo motor adaptado a WASM para TV. EasyList/EasyPrivacy y avisos de licencia incluidos. No se revisó todo Brave/Chromium.
4. **Modo público actual: asistido por Mac.** CDP intercepta solicitudes de la TV, motor Node decide y la TV renderiza. Recursos bloqueados reciben respuesta local vacía: fallarlos directamente provocó errores de WAM. CSS cosmético y scriptlets complementan el bloqueo.
5. Barra de páginas en un mundo JS aislado y Shadow DOM cerrado; CSSOM permite estilo con CSP restrictiva. DOM compartido con el sitio: no equivale a una barra nativa segura.
6. Motor WASM autónomo validado en HTML propio. Hook tardío no bloquea cargas iniciales; prefiltrado previo solo sirve para fixtures conocidos y altera origen/contexto. No se habilitó como navegador universal.
7. Resolver compartido para búsquedas/URLs; rechazo de protocolos no HTTP(S) y URLs con credenciales. Indicadores animados, movimiento reducido, errores HTTP/vacío/timeout, Reintentar e Inicio.
8. Lanzador reconecta al perder SSH o cambiar la instancia de app. Conserva página cuando puede; no garantiza recuperar sesión tras cualquier cierre.
9. Configuración de buscador persistente: autoridad en `.local/browser-settings.json` del Mac (escritura atómica, modo 0600); espejo en localStorage. Se aplica a ambas barras y sobrevive recarga/reinicio del puente.

## Mapa para continuar sin releer todo

| Ruta | Responsabilidad |
| --- | --- |
| `src/App.svelte` | Inicio, configuración, carga, errores, control remoto |
| `src/navigation.js` | Resolver único y proveedores de búsqueda |
| `scripts/browser-bridge.mjs` | Intercepción CDP, navegación, estado y comandos |
| `scripts/toolbar.mjs` | Barra aislada superpuesta a páginas |
| `scripts/filter-engine.mjs` | Adaptación Node del motor y filtros |
| `scripts/preferences.mjs` | Preferencias persistentes del Mac |
| `scripts/start-lab.mjs` | Inspector, reconexión y ciclo del puente |
| `scripts/cdp.mjs` | Cliente CDP / conexión al target |
| `scripts/fixture-server.mjs` | Inicio servido y pruebas controladas, puertos 43187/43188 |
| `wasm-engine/`, `public/adblock.wasm` | Adaptador Rust y motor TV compilado |
| `research/BRAVE-ANALYSIS.md`, `research/provenance.json` | Componentes estudiados, fuentes y huellas |
| `docs/BROWSER-VALIDATION.md`, `docs/NAVIGATION-FIX.md` | Resultados detallados y problemas resueltos |
| `docs/PLAN-MEJORAS.md` | Prioridades propuestas para rapidez y seguridad |

## Evidencia y límites de los resultados

- Motor Node: **15/15** comprobaciones. Motor WASM en TV: **5/5**, arranque ~2.7 s, memoria lineal ~46.4 MiB; una medición, no toda la RAM de la app.
- CDP y prefiltrado local: **7/7** solicitudes publicitarias controladas impedidas y **8/8** legítimas preservadas; CSS 3 elementos → 0. Hook tardío: **0/7** iniciales impedidas.
- Sitios públicos: Example Domain y MDN cargaron. BBC cargó en una pasada (30 bloqueos de 153 solicitudes) y agotó espera en una regresión posterior. No presentarlo como estable.
- Corrección 0.4.0: ocho pruebas de búsqueda, carga, errores y recuperación pasaron en TV. Evidencias `evidence/navigation-fix/`.
- Versión 0.5.0: resolver **24 casos**; configuración **6 comprobaciones** en TV, persistencia tras recargar y reiniciar puente, cuatro proveedores, sin desbordamiento a 1920 × 1080. `evidence/search-settings/validation.json` y `settings-google.png`. Se restauró Google.
- Build, paquete 0.5.0 e instalación completados. Artefacto: `artifacts/com.lgapp.lab_0.5.0_all.ipk`.
- Las cifras controladas no miden todos los anuncios de Internet. Sin equivalencia demostrada con Shields completo: fingerprinting, CNAME, cookies, antiphishing, popups, workers, video con anuncios, YouTube, DRM, login, descargas y pagos pendientes.
- Sin cambios de DNS, firmware, particiones, bootloader ni root. No se retiraron cabeceras de seguridad de sitios públicos.

## Operación y pruebas

Desde la raíz del proyecto:

```sh
npm ci
node scripts/test-navigation.mjs
npm run validate:engine
npm run package
```

Uso asistido (dos terminales; comprobar IPs antes):

```sh
npm run lab:server
# En otra terminal:
npm run lab
```

Instalación cuando cambie el bundle empaquetado:

```sh
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_0.5.0_all.ipk
npm run tv:launch
```

Pruebas TV: detener el lanzador/puente activo, mantener servidor, abrir `npx --no-install ares-inspect --device lg-lab com.lgapp.lab` y usar el puerto impreso. **Un solo interceptor y una sola prueba que navegue a la vez.**

```sh
node scripts/validate-settings.mjs http://127.0.0.1:PUERTO
node scripts/validate-navigation.mjs http://127.0.0.1:PUERTO
npm run validate:browser -- http://127.0.0.1:PUERTO
npm run validate:native -- http://127.0.0.1:PUERTO
```

WASM nativo requiere inicio empaquetado y condiciones específicas descritas en README. Reiniciar `npm run lab` al terminar; dejar Google seleccionado. Puerto del inspector y procesos **no son persistentes**; `evidence/browser-lab/session-state.json` es una captura, no descubrimiento vivo.

## Pendiente y siguiente paso recomendado

1. Guardar una línea base versionada y definir un mecanismo probado de restauración del IPK/configuración antes de cambios grandes.
2. Unificar configuración de IPs y añadir diagnóstico de conexión, servidor, versiones, espacio y sesión de desarrollo disponible; no inventar lecturas inaccesibles.
3. Control de instancia única para impedir interceptores concurrentes y pruebas que interfieran con la sesión del usuario.
4. Separar servidor de uso habitual de fixtures y registro de pruebas; revisar aislamiento/autorización de comandos y acceso al servicio local antes de usar sesiones sensibles.
5. Medir tiempos de carga y estabilidad prolongada; optimizar a partir de mediciones. Mantener regresión controlada y ampliar sitios por categorías.
6. Evaluar autonomía sin Mac como investigación separada con criterios de viabilidad. OSE y DNS siguen posteriores; no hacer flasheo como experimento inicial.

## Entrega de esta sesión

2026-10-21: se creó esta semilla y el plan de mejoras a partir del código y evidencias locales. Se añadió índice de entrada para futuras sesiones. Solo documentación; no se modificó la app ni se repitieron pruebas que naveguen la TV. Usuario confirma buen funcionamiento. Mejoras de la lista siguen propuestas, no implementadas.
