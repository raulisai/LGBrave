# Luma Browser Lab · LG webOS

Prototipo Svelte con interfaz inspirada en Safari y motor de bloqueo de Brave. Instalado como `com.lgapp.lab`, versión 0.5.0, en LG 75UR8750PSA. Trabajo del 21 de octubre de 2026.

**El motor real funciona en la TV. La navegación pública con interceptación de red funciona actualmente con ayuda del Mac.** El modo local de prefiltrado está limitado a HTML propio de laboratorio.

## Configuración de buscador · 0.5.0

Google es el buscador predeterminado. El botón **Configuración** de inicio y **Config.** en las páginas permite elegir Google, Bing, DuckDuckGo o Brave Search. La elección se aplica a las dos barras; no hay cambio automático de proveedor si un sitio devuelve un error.

La preferencia se guarda en `.local/browser-settings.json` en el Mac y se refleja en el almacenamiento local de la app. Se conserva al recargar, volver a abrir la app y reiniciar el puente. El Mac sigue siendo necesario para la navegación asistida. La selección de buscador no cambia los filtros de Brave.

Verificación: `node scripts/test-navigation.mjs` y `node scripts/validate-settings.mjs http://127.0.0.1:PUERTO` (sin otro puente activo). Evidencias en `evidence/search-settings/`.

## Corrección de navegación 0.4.0

La barra de inicio y la barra de páginas comparten el mismo resolver de búsquedas y URLs. Se detectó un HTTP 429 de Brave Search durante una búsqueda real; el buscador predeterminado pasó a DuckDuckGo HTML. El motor de bloqueo continúa siendo Brave.

Se añadieron indicador animado de carga, progreso, transiciones de botones y favoritos, soporte de movimiento reducido y estados visibles de error con Reintentar e Inicio. Las hojas de estilo de la barra y los filtros cosméticos se aplican con CSSOM para funcionar también en páginas con CSP restrictiva, sin retirar cabeceras del sitio. El iniciador detecta si la TV reemplaza la instancia de la app y vuelve a conectar.

Las evidencias de esta corrección se guardan en `evidence/navigation-fix/`. Las pruebas se ejecutan con `node scripts/test-navigation.mjs` y, sin otro puente activo, `node scripts/validate-navigation.mjs http://127.0.0.1:PUERTO`.

## Resultados

- Motor Brave `adblock-rust` 0.13.3, compilado a WASM y ejecutado en la TV: 5/5 comprobaciones de reglas correctas; aproximadamente 2.7 s de inicialización y 46.4 MiB de memoria WASM con 141,878 líneas de listas.
- Prefiltrado local: 7/7 solicitudes publicitarias controladas impedidas y 8/8 legítimas preservadas. No demuestra compatibilidad con todos los sitios.
- Modo asistido por Mac: misma cuenta de fixtures, CSS y scriptlet temprano correctos; navegación real verificada en Example Domain, MDN y BBC.
- Motor Node: 15/15 pruebas de reglas, excepciones, tipos, reemplazos, parámetros, selectores y scriptlets.
- UI de TV: barra de direcciones, favoritos, navegación y estado de protección; captura a 1920 × 1080.

No hay un porcentaje defendible de “Brave completo replicado” o “anuncios de Internet eliminados”. Las cifras anteriores tienen denominadores concretos en pruebas controladas. DNS queda para el final; no se modificó.

## Documentación y evidencias

- [Semilla: estado actual y guía para continuar](docs/SEMILLA.md)
- [Plan para trabajar más rápido y con mayor seguridad](docs/PLAN-MEJORAS.md)
- [Informe de validación y límites](docs/BROWSER-VALIDATION.md)
- [Análisis del código de Brave y adaptación](research/BRAVE-ANALYSIS.md)
- [Inventario de la primera sesión](docs/INITIAL-INVENTORY.md)
- [Evidencias JSON y capturas](evidence/browser-lab/)
- [Procedencia y huellas de fuentes/binarios](research/provenance.json)

![Interfaz real en TV](evidence/browser-lab/safari-final.png)

## Ejecutar

Node 22.22.3 y npm 10.9.8 en macOS arm64. CLI LG instalada localmente. El lock fija versiones. La compilación WASM requiere Rust y el target `wasm32-unknown-unknown`; el binario preparado está incluido en `public/adblock.wasm`.

```sh
npm ci
npm run dev
npm run package
```

Para reconstruir el motor WASM desde el adaptador y el crate fijado:

```sh
rustup target add wasm32-unknown-unknown
npm run build:native
npm run package
```

La configuración actual utiliza TV `192.168.1.134` y Mac `192.168.1.148`. Confirmar ambas IP y la sesión de Developer Mode antes de conectar. Los fixtures y el botón de validación local contienen la IP actual del Mac; si cambia, actualizar también esas referencias y reempaquetar.

```sh
npm run tv:info
npx --no-install ares-install --device lg-lab artifacts/com.lgapp.lab_0.5.0_all.ipk
npm run tv:launch
```

Si cambia la IP de la TV, actualizar el perfil `lg-lab` con `ares-setup-device`. La llave de desarrollo está fuera del repositorio en `~/.ssh/lg-lab_webos`. No guardar llaves ni passphrases aquí.

## Navegación asistida con el Mac

Mantener tres procesos abiertos, en este orden:

```sh
npm run lab:server
npx --no-install ares-inspect --device lg-lab com.lgapp.lab
npm run lab:bridge -- http://127.0.0.1:PUERTO
```

La alternativa recomendada es mantener `npm run lab:server` y ejecutar `npm run lab` en otra terminal. Ese iniciador abre el inspector, conecta el motor y vuelve a conectar si se corta la sesión SSH. Conserva la página actual cuando es posible; si encuentra el inicio empaquetado, pasa al inicio servido por el Mac. No garantiza recuperar la sesión tras cualquier cierre.

El puerto lo imprime `ares-inspect` y cambia entre sesiones. El servidor local utiliza 43187 y 43188; solo acepta conexiones del Mac y la IP configurada de la TV. No se instaló inicio automático.

El Mac evalúa reglas y comunica decisiones por el inspector; **las páginas se renderizan en la TV**, no es transmisión de un navegador del Mac. Al cerrar el puente, la protección de red asistida deja de funcionar. El número mostrado es de solicitudes bloqueadas durante la conexión actual.

El modo sigue siendo experimental. La barra superpuesta no tiene las garantías de aislamiento de una barra nativa de navegador, y todavía no se validaron contraseñas, sesiones, DRM ni pagos. Las pruebas usaron páginas públicas sin iniciar sesión.

## Repetir las pruebas

No ejecutar dos interceptores o dos validaciones que naveguen la TV simultáneamente. Detener primero `lab:bridge`. Mantener servidor e inspector abiertos.

```sh
npm run validate:engine
npm run validate:native -- http://127.0.0.1:PUERTO
npm run validate:browser -- http://127.0.0.1:PUERTO
npm run verify:tv -- http://127.0.0.1:PUERTO
```

Para `validate:native`, lanzar la app empaquetada desde su inicio y después abrir el inspector. Esa prueba usa CDP para observar, con interceptación deshabilitada. La prueba pública necesita el interceptor y lo detiene al terminar. Los resultados se escriben en `evidence/browser-lab/`.

El botón **Motor local** permite ejecutar desde la TV la validación WASM y el hook tardío de la página controlada; el prefiltrado completo adicional se ejecuta con `validate:native`. Ambos requieren que el servidor de fixtures esté disponible, pero sus decisiones de filtrado se calculan en la TV.

Tras cerrar y relanzar la app puede cambiar el target del inspector. Volver a abrir `ares-inspect` si el puerto dejó de responder. El comando histórico `scripts/verify-tv.mjs` corresponde a la primera app; `npm run verify:tv` apunta al verificador actual.

## Alcance de seguridad y recursos

No se escribió firmware, no se modificaron particiones ni arranque y no se obtuvo root. El inventario no es un respaldo recuperable del firmware.

El acceso amplio que permite la app empaquetada a los fixtures no se habilitó como navegación arbitraria en iframes. Los experimentos locales están restringidos a HTML propio para no confundir un resultado de filtrado con un navegador aislado y seguro.

Las dependencias de herramientas de desarrollo conservan avisos npm, incluidos avisos en la CLI oficial. El reporte original está en las evidencias de inventario. Las dependencias Node, la CLI y el servidor no se empaquetan en la app; sí se incluye WASM, listas y sus avisos de licencia.

Licencias: motor Brave MPL-2.0, adaptador WASM local MPL-2.0, Svelte MIT; EasyList/EasyPrivacy conservan cabeceras y referencias de licencia. Ver `public/THIRD_PARTY.txt`.
