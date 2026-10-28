# Protocolo de reproducción · Holy 0.9.17

Actualizado: 2026-10-26, Windows. Baseline anterior publicado: cb8a890 (0.9.16). Este protocolo protege comportamientos acreditados, no promete disponibilidad perpetua de los proveedores externos.

## Matriz y alcance

scripts/fixtures/playback/known-cases.json registra 23 casos y enlaza cada uno a evidencia y regresiones ejecutables. Incluye los siete conectores: Cuevana, RePelisHD, JKAnime, AnimeYT, DoramasFlix, DoramasMP4 y Asia Live Action.

Los scopes distinguen controlled, tv-user-confirmed, tv-metrics, desktop-http y navigation-only. Las evidencias históricas conservan su alcance; no se convierten en pruebas físicas actuales al ejecutar un fixture. Solo Between Steps 4/5 en español tiene confirmación del usuario de imagen/audio; varias muestras históricas fueron silenciadas. Un vídeo de120s o una portada no acredita un episodio completo. Los ensayos con advancing=false siguen pendientes y no se cuentan como éxitos.

## Antes de publicar o instalar

1. Leer SOUL y git status; conservar trabajo y biblioteca locales.
2. Ejecutar npm run playback:check sobre una revisión estable. Hace suite completa y compila Luma, Holy TV y Holy web.
3. Exigir ok=true en .local/playback-validation/report.json. Registra plataforma, Node, commit base y SHA-256 de entradas antes/después. Si cambia código durante la ejecución, falla y se repite. No sirve un informe de otro árbol.
4. Ante cambios de conectores, ejecutar también npm run playback:probe. Guarda providers.json: HTTP y resolución de muestras, sin navegar TV ni reproducir medios. ok significa que cada fuente entregó al menos un enlace; allSamplesResolved=false o availability=partial conserva las muestras fallidas. Nunca interpretarlo como todos los capítulos disponibles.
5. Si afecta reproducción real, hacer un ensayo serial en LG con el usuario: mismo capítulo/idioma, avance de tiempo y fotogramas, readyState/error, pausa y reanudación, conservar posición y verificar audio con el usuario. La prueba no debe abrir otro interceptor. Restaurar sesión y buscador al terminar.
6. Actualizar SOUL con versión, evidencia y pendientes exactos; publicar código y datos de prueba sanitizados. Mantener .local, llaves, tokens y URLs firmadas fuera de Git.

npm run package, package:holy y windows:install ejecutan playback:check mediante prehooks. El arranque del servicio no hace pruebas que alteren la TV. Los atajos directos a scripts no sustituyen este protocolo.

GitHub Actions ejecuta el mismo gate en windows-latest y macos-latest con Node24 en push a main, PR y ejecución manual; guarda solo report.json. Un check fallido señala regresión. El workflow por sí solo no impide un merge administrativo: exigir ambos checks en protección de rama es una configuración de GitHub independiente, no activada por este commit.

## Barreras añadidas

- Contratos offline de los siete sitios: parser→Catalog.resolve, idiomas, Referer, alternativas, caché/invalidation, formato roto y fallo de fuente. Fetch inesperado falla; no hay disponibilidad externa asumida.
- Conservar idioma vivo durante relevo tras cambiar de proveedor: viaja solo el enum dub/sub/orig, con compatibilidad de descriptores antiguos.
- Un ID local de idioma no puede contradecir el tipo elegido al resolver otra fuente.
- Seek y Seguir viendo se dirigen a la duración observada del contenido; omiten vídeos de otra duración en marcos anteriores. Incluye shadow DOM.
- Seek devuelve éxito solo si el segundo real coincide; un setter ignorado permite reintento. Play rechazado o pendiente tiene límite y se respetan sesiones canceladas.
- Siguen protegidos pausa larga, segundo0 durante arranque, end-card, retroceso, reanudación, recuperación limitada e idioma elegido.
- Logs añaden requestedKind/playingKind solo como enums. No se guardan IDs privados, cookies ni direcciones firmadas.

Las pruebas nuevas ejecutan funciones de página reales en VM y HolyBridge/Catalog reales con CDP simulado; no son una certificación de todos los servidores.

## Resultado de esta revisión

Windows: playback:check pasó, suite completa en42.6s y tres builds; las huellas de entradas coinciden (43b02b0ebe5b90b6a4d967e27d59f67d066e5d474fdbdda21d94b7bc4e0a9b29). Primera pasada detectó una aserción antigua acoplada a texto interno de play; se sustituyó por comportamiento y duración. Otro intento terminó la compilación pero retuvo handles nativos: el worker ahora espera vite.build() y termina con éxito únicamente al resolverse esa API, sin deducir éxito del texto del log.

Consulta HTTP real: las siete fuentes entregaron al menos un enlace. Muestras: Cuevana/The Cycle, RePelisHD/Tony, JKAnime/Mahou Shoujo Ikusei Keikaku: Restart, AnimeYT/Bleach, DoramasFlix/Between Steps5 español, DoramasMP4/Khom Khlang y Between Steps5, AsiaLiveAction/Ash. En DoramasMP4, Lovers & Gangsters2 publicó un iframe src vacío: muestra no disponible, preservada como fallo parcial. No se modificó el parser para inventar un servidor.

Doctor recargó el perfil Windows existente; SSH y descubrimiento de pares respondieron. El inspector CDP no estaba disponible para un ensayo físico nuevo, por lo que no se navegó la LG. Backend Windows actualizado; Mac necesita traer esta versión y ejecutar el gate/reiniciar, conservando emparejamiento y datos.

Persisten límites independientes: disponibilidad de sitios/servidores, reinicio físico de Windows, reproducción prolongada/relevo físico, alertas del SDK y el hallazgo Invalid InterceptionId. Ver SOUL.

## Cuando falle una fuente

Conservar el informe y distinguir fallo de parser, título sin enlaces, red, idioma, bloqueo/captcha o fallo de vídeo. Añadir fixture sanitizado que reproduzca el formato y la regresión antes de arreglarlo. Un cambio intencionado actualiza evidencia y expectativa; no borrar pruebas fallidas para conseguir verde.

No intercambiar doblaje por subtítulos ni pisar progreso del usuario para ocultar un fallo. Mantener límites de rescate. Si una actualización propia rompe un caso acreditado, revertir ese cambio de código mediante un commit de git revert, ejecutar el gate y reconstruir; conservar .local y las bibliotecas, sin reset --hard ni borrado de credenciales. Publicar la reversión para ambos equipos y reiniciar solo el runtime activo.

Referencias del workflow: [setup-node](https://github.com/actions/setup-node), [checkout](https://github.com/actions/checkout), [upload-artifact](https://github.com/actions/upload-artifact). Se usaron sus contratos oficiales; el workflow remoto debe comprobarse en Actions.

Comprobación final de TV: SSH autenticado responde, pero el puerto local9998 del inspector no está escuchando y no tiene clientes. No se lanzó ninguna app para forzarlo; el ensayo físico nuevo queda pendiente.

## Resultado remoto confirmado

[GitHub Actions40400150371](https://github.com/raulisai/LGBrave/actions/runs/40400150371), código c355d0e50ea5037dbd440b1b144cb43f28189fe4: playback(windows-latest) y playback(macos-latest) concluyeron success. Ambos realizaron npm ci, playback:check y subieron report.json. Es macOS de CI, no la Mac física del usuario; ésta todavía debe actualizarse según tareas. Los cambios posteriores de esta anotación son solo documentación y no cambian la huella del código validado.

## Regresión Windows0.9.19 · 2026-10-28

La matriz añade el caso24: test-windows-launcher compila el EXE0.9.12.0 y verifica su Node real bajo entorno normal y APPDATA/LOCALAPPDATA/HOME alterados. Deben coincidir las huellas de carpetas del usuario. Corre en Windows dentro de npm test/playback:check; macOS lo omite explícitamente. No instala ni navega TV. Gate local0.9.19 correcto; instalación real y LG conectado verificados. Detalle: docs/WINDOWS-CONEXION-20261028.md.
