# Cómo Brave mantiene al día su bloqueo y cómo seguirlo

Revisión del 23 de octubre de 2026, hecha sobre el código y los repositorios públicos de Brave (no sobre documentación de marketing). Las cifras con fecha son lecturas de ese día.

## Respuesta corta

Brave **no tiene un método secreto** para que no aparezcan anuncios. Combina cuatro cosas:

1. **Listas comunitarias** (uBlock Origin, EasyList y regionales) más listas propias de Brave, que sus mantenedores corrigen a diario cuando un sitio cambia.
2. **Un espejo automático** que descarga esas listas cada 30 minutos y comprueba que no estén corruptas.
3. **Componentes firmados**: empaqueta las listas y los scriptlets, y cada navegador los consulta al arrancar y luego cada 5 horas.
4. **Defensas genéricas** del motor (reglas por dominio, ocultación cosmética genérica, scriptlets, respuestas sustitutas, CNAME…) que ya cubren muchos dominios nuevos antes de que alguien escriba una regla para ellos.

Cuando una web cambia su forma de servir anuncios, lo que la arregla es **una regla nueva en una lista**. Brave la recibe en horas. Brave también falla a veces; la diferencia es lo rápido que llega la corrección.

**Sí podemos seguir a Brave casi en tiempo real**, usando las mismas fuentes públicas de las que él parte. Lo que no podemos (ni debemos) usar es su servidor de componentes, porque exige una clave privada de Brave.

## La cadena completa de Brave

```
autores de listas ─► brave/adblock-resources (catálogo de qué listas usar)
        │
        ▼ cada 30 min (GitHub Actions, cron 15 y 45 de cada hora)
brave/adblock-lists-mirror, rama «lists»
  · un archivo por fuente, nombrado md5(URL)
  · valida la suma de control de cada lista
        │
        ▼ Brave lanza el empaquetado con un commit concreto del espejo
brave-core-crx-packager
  · preprocesa !#if, quita directivas peligrosas e incompatibles
  · prueba que no bloquea páginas legítimas (Wikipedia, brave.com…)
  · une listas en list.txt por componente
  · genera resources.json (scriptlets de uBlock + recursos de Brave)
  · firma cada componente (CRX) y lo publica
        │
        ▼ go-updater.brave.com (requiere clave de Brave)
navegador Brave
  · al arrancar fuerza una comprobación de cada componente
  · después revisa cada 5 h (valor por defecto de Chromium)
  · recompila el motor adblock-rust en caliente
```

### 1. El catálogo decide qué listas se usan

`brave/adblock-resources/filter_lists/list_catalog.json` tiene 62 entradas. Cada una indica sus fuentes, si está activa por defecto, el idioma y el identificador de su componente. Ese archivo es el que Brave cambia cuando añade, quita o sustituye una lista (último cambio: 1 de septiembre, «add permission mask»).

Listas activas por defecto en un Brave de escritorio en español:

| Componente | Fuentes |
| --- | --- |
| Default Adblock | uBO filters (+ 2020–2026, general, badware, resource-abuse, unbreak, quick-fixes, link-shorteners), EasyList, URLhaus, Brave unbreak, brave-specific, brave-social, brave-sugarcoat, brave-android-specific |
| Default Privacy | EasyPrivacy, uBO privacy |
| First Party | brave-firstparty, brave-firstparty-regional |
| Avisos de cookies | Fanboy Cookiemonster (variante uBO), uBO annoyances-cookies, brave-cookie-specific |
| Promos de apps | Fanboy mobile notifications |
| Español | EasyList Spanish |

### 2. El espejo: la clave de la frecuencia

`brave/adblock-lists-mirror` lee el catálogo, descarga cada fuente, valida su suma de control y guarda los archivos en la rama `lists`, nombrados por el MD5 de su URL. Se ejecuta a los minutos 15 y 45 de cada hora. El 22–23 de octubre se vieron 30 commits seguidos con 20–40 minutos de separación.

### 3. El empaquetado: lo que Brave hace con cada lista

`brave/brave-core-crx-packager` (`scripts/generateAdBlockRustDataFiles.js`, `lib/adBlockRustUtils.js`) toma un commit concreto del espejo y:

- **Preprocesa `!#if`**: se queda solo con los bloques de Chromium y uBlock, y descarta los de Firefox, Safari, AdGuard, filtrado HTML, etc.
- **Bloquea `+js(brave-…)`** en listas que no son de Brave (solo Brave puede usar sus scriptlets privados).
- **Quita reglas incompatibles** con versiones antiguas del motor.
- **Prueba de cordura**: si una lista bloquea recursos legítimos conocidos (Wikipedia, brave.com, sus páginas de QA), no se publica esa versión.
- Si una fuente falla al descargarse, **no publica** ese componente y mantiene la versión anterior.
- Genera `resources.json` con los recursos de redirección y los scriptlets de **su copia fijada de uBlock** (`brave/uBlock`, commit `4dfbb048`, actualizado el 14 de septiembre mediante PR revisados), más los recursos propios de `brave/adblock-resources`. Usa adblock-rs 0.13.2; Luma usa 0.13.3, que es compatible.

El momento exacto de publicación ocurre en la infraestructura interna de Brave (Jenkins) y no es público.

### 4. El navegador

`brave-core/components/brave_shields/core/browser/ad_block_component_installer.cc` registra un componente por lista. A diferencia de otros componentes, **fuerza una actualización al registrarse** (al arrancar). Después, Chromium comprueba los componentes cada **5 horas** (`ConfiguratorImpl::NextCheckDelay`). Con cada versión nueva se recompila el motor sin reiniciar.

`go-updater.brave.com` responde `403 Missing auth header` a cualquier cliente sin la clave de servicio de Brave. Esa clave va incrustada en sus binarios; usarla sería suplantar a Brave, así que **queda descartado**.

### 5. Lo que hace que funcione también con dominios nuevos

Las listas no lo son todo. Brave Shields añade:

- **Reglas genéricas** por ruta y patrón (`/ads/`, `adsbygoogle`, `prebid`…), que valen para cualquier dominio nuevo.
- **Cosmética genérica**: observa clases e ids nuevos y aplica selectores genéricos.
- **Scriptlets** que neutralizan SDK publicitarios y anti-adblock, y **respuestas sustitutas** (scripts vacíos) para que la página no se rompa.
- **Descubrimiento de CNAME**: si `ads.sitio.com` es un alias de un rastreador, se aplica la regla del rastreador.
- **Listas de primera parte**, para anuncios servidos desde el propio dominio del sitio.
- Datos aparte del filtrado: `debounce.json` (saltar redirecciones de rastreo), `clean-urls.json` / `query-filter.json` (quitar parámetros de seguimiento), `request-otr.json` y `webcompat-exceptions.json`.

## Comparación con Luma hoy

| Aspecto | Brave | Luma |
| --- | --- | --- |
| Qué listas usar | Catálogo de Brave | Lista fija escrita a mano en `scripts/update-lists.mjs` |
| Fuente de cada lista | Espejo validado por Brave | Autor original directamente |
| Frecuencia | Espejo cada 30 min; navegador al arrancar y cada 5 h | Cada 100 min (`scripts/filter-updates.mjs`) |
| `!#if` | Preprocesado | **No**: el motor aplica ambos lados (351 bloques en las listas actuales; comprobado que activa reglas solo de Firefox) |
| Directivas `brave-` | Restringidas a listas de Brave | Sin restricción |
| Scriptlets de uBlock | Copia fijada por Brave (14 sep) | Instantánea de pruebas de adblock-rust (2 sep) |
| Prueba de cordura | Antes de publicar | Pruebas propias de Luma antes de activar |
| Fuentes por defecto que faltan | — | 15: badware, resource-abuse, link-shorteners, URLhaus, brave-specific, brave-social, brave-unbreak (ruta nueva), brave-android-specific, brave-sugarcoat, first-party (2), cookies uBO/Brave (3), mobile notifications |
| CNAME, debounce, limpiar parámetros | Sí | No |

## Cómo seguir a Brave automáticamente

La forma fiel y legítima es **reproducir su cadena con sus mismas entradas públicas**:

1. **Leer el catálogo de Brave** en cada comprobación y elegir lo mismo que un Brave de escritorio en español: `default_enabled`, sin las exclusivas de iOS, más la entrada de idioma `es`. Si Brave añade o cambia una lista, Luma la recoge sola.
2. **Descargar desde el espejo**, no desde cada autor: `raw.githubusercontent.com/brave/adblock-lists-mirror/<commit>/lists/<md5(url)>.txt`. Para saber si hay algo nuevo basta con `git ls-remote https://github.com/brave/adblock-lists-mirror refs/heads/lists`: si el commit no cambió, no se descarga nada. Así Luma se actualiza **en cuanto Brave tiene listas nuevas**, cada 30 minutos.
3. **Aplicar el mismo procesado** que el empaquetador: `!#if` con las condiciones de Brave, limitar `+js(brave-…)`, quitar incompatibles y pasar su prueba de cordura más las pruebas de Luma (YouTube, fixtures). Si algo falla, conservar la versión activa, como ya hace el actualizador actual.
4. **Generar los scriptlets como Brave**: leer qué commit de `brave/uBlock` fija `brave-core-crx-packager` y construir `resources.json` desde ese commit con `uBlockResources` de adblock-rs, más `adblock-resources/dist/resources.json`. Para ello hay que importar el `scriptlets.js` de uBlock en Node: debe hacerse en un proceso aislado (`node --permission`, sin red ni escritura), porque es código descargado.
5. **Seguir los datos auxiliares** (`debounce.json`, `clean-urls.json`) cuando se implementen esas funciones.

Con eso, Luma tendría las mismas listas que Brave en cuanto llegan a su espejo. Un Brave instalado las recibe más tarde: después de que Brave publique el componente (momento no público) y de su revisión de cada 5 horas.

### Lo que no conviene hacer

- Usar la clave de servicio de Brave o descargar sus CRX firmados: requiere su credencial.
- Activar todo el catálogo: incluye listas opcionales (redes sociales, distracciones, etc.) que Brave deja desactivadas porque rompen sitios.
- Copiar las listas regionales de otros idiomas: aumentan la memoria sin ayudar en webs en español.

## Implementado en Luma (23 de octubre)

- `scripts/brave-sync.mjs`: selección del catálogo como un Brave de escritorio en español, preprocesado `!#if`, restricción `+js(brave-…)`, reglas incompatibles y prueba de cordura, portados del empaquetador. Comprobación de commits con `git ls-remote`.
- `scripts/update-lists.mjs`: si el espejo (`lists`) y el empaquetador (`master`) no cambiaron, termina en menos de un segundo sin descargar nada. Si cambiaron, descarga el catálogo y cada fuente desde el espejo en ese commit exacto, une las fuentes por componente como Brave, lee el commit de `brave/uBlock` que fija el empaquetador y genera `resources.json` desde él (solo se rehace si Brave mueve ese commit). Después valida con las pruebas de Luma y cambia de versión de forma atómica. Si algo falla, conserva la versión activa; `npm run lists:rollback` vuelve a la anterior.
- `scripts/ublock-scriptlets.mjs`: importa el `scriptlets.js` descargado en un proceso con `--permission`, que solo puede leer esa copia (no escribe ni lanza procesos). Los scriptlets `trusted-*` llevan el permiso 1 y solo funcionan en listas con `permission_mask` 1, como en uBlock.
- `scripts/filter-engine.mjs`: carga cada componente con su formato y sus permisos.
- `scripts/filter-updates.mjs`: comprueba cada 30 min según `research/lists/sync-state.json`.
- `scripts/test-brave-sync.mjs`: 11 comprobaciones sin red, incluida la de que el proceso aislado no puede escribir.

Primera ejecución real: espejo `bd90decb`, empaquetador `72418b38`, uBlock `4dfbb048`. Seis componentes: Default (22 fuentes), Privacy, First Party, avisos de cookies, promociones de apps y español. En total 250 546 líneas, 0 bloques `!#if` restantes, 196 recursos de uBlock (33 con permiso) y 17 de Brave. Una comprobación sin cambios tarda 0,8 s.

## Licencias

uBlock Origin y uAssets: GPLv3. EasyList/Fanboy: GPLv3 o CC BY-SA. Listas de Brave: MPL-2.0. Usarlas en el Mac no plantea problema. Para empaquetarlas dentro del IPK hay que conservar sus avisos de licencia, como ya se hace con EasyList.

## Fuentes consultadas

- [Catálogo de listas](https://github.com/brave/adblock-resources/blob/master/filter_lists/list_catalog.json)
- [Espejo de listas y su workflow](https://github.com/brave/adblock-lists-mirror)
- [Empaquetador de componentes](https://github.com/brave/brave-core-crx-packager): `scripts/generateAdBlockRustDataFiles.js`, `scripts/packageAdBlock.js`, `lib/adBlockRustUtils.js`, `.github/workflows/adblock-data-files.yml`, `submodule-update.yml`
- [Instalador de componentes en brave-core](https://github.com/brave/brave-core/blob/master/components/brave_shields/core/browser/ad_block_component_installer.cc) y `ad_block_component_service_manager.cc`
- [Intervalo de Chromium](https://source.chromium.org/chromium/chromium/src/+/main:components/component_updater/configurator_impl.cc)
- [Listas propias de Brave](https://github.com/brave/adblock-lists)
