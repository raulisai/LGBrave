# Servidor en pausa y Mi cola · 0.9.29

**Actualización 08/11: Holy 0.9.31 instalado en la LG y backend actualizado en Mac.** Amarillo, cola vacía, menús de pausa y cambio real de Streamtape a Primeload comprobados. Se corrigieron dos fallos encontrados en pantalla: carga/ficha ajena al vaciar la cola y ausencia del menú en películas de un idioma con alternativas. Una alternativa Doodstream cerró el target; sigue pendiente investigar la causa y actualizar Windows. Resultados, confirmación de imagen/audio, límites y restauración en [el informe de despliegue](DESPLIEGUE-TV-20261108.md). El resto de este documento conserva la implementación y las pruebas iniciales del07/11.

## Integración y revisión

Mac actualizada por fast-forward de f230218 a 319aec0 (13 commits): conexión en espera, seguridad LAN/API, recomendaciones/reparto, YouTube por playlist y reproductor oficial, retorno rápido al inicio y retirada del catálogo público. Se revisaron los flujos actuales de catálogo, menú de pausa, selección de idioma, recuperación, persistencia y protección de peticiones. La suite completa comprueba regresiones controladas; no es una auditoría exhaustiva de cada sitio de Internet.

Se conservaron exactamente los cuatro archivos locales previos de filtros/evidencia al resolver su solapamiento con main. Respaldo adicional en el stash «Preserve pre-existing local filter state before update 2026-11-07». No se incluyeron como parte de la característica.

## Uso

- Al pausar, pulsar Arriba para entrar en el panel. «Servidor» aparece junto a «Idioma» cuando hay dos o más direcciones de reproductor para la versión resuelta. Izquierda/derecha y OK eligen; Atrás vuelve al panel. El actual lleva «Ahora». Se muestra el dominio; reproductores del mismo dominio se distinguen por número.
- El cambio conserva título, idioma y segundo solicitado, guarda el progreso y vuelve a preparar el reproductor. La reanudación final depende de que el proveedor permita avanzar a ese punto. Los demás servidores quedan para la recuperación automática. No se inventan alternativas de otros idiomas ni de otros sitios.
- En una tarjeta del catálogo, búsqueda, episodios o Gustos, amarillo agrega o quita el título de «Mi cola». Repeticiones al mantener pulsado se ignoran. También hay botón junto a la indicación amarilla para puntero.
- «Mi cola» está en Inicio y en su propia sección, conserva orden de agregado y admite 100 títulos. Agregar no marca como visto ni cambia recomendaciones. Las series conservan su lista de capítulos; no se duplica una serie por cada episodio. Quitar se hace con amarillo; reproducir no elimina automáticamente.
- En Gustos, amarillo sobre una preferencia conserva el borrado de gustos con doble pulsación; sobre un título controla su cola.

## Alcance

La cola se guarda en la biblioteca local de la computadora que recibe la petición; aún no viaja por la sincronización del perfil. No admite agregar sin computadora conectada. En sesiones adoptadas tras relevo, el selector aparece después de una nueva resolución de reproductores; el descriptor compartido actual no transporta alternativas.

Comprobación viva: Mac 192.168.1.102 en respaldo; Windows djoker 192.168.1.65 atiende la TV configurada en 192.168.1.134; canal de perfil sincronizado. Sin comandos de navegación, sin cambiar buscador ni sesión. No prueba física de las funciones nuevas.

## Validación

Prueba nueva `test-holy-queue-servers.mjs`: biblioteca en directorio temporal, persistencia, orden/capacidad, series, filtrado de campos sensibles, API con origen permitido/rechazado, empaquetado de filas, menú real del puente, teclas y selección, segundo/idioma, un solo servidor sin selector. Compila con Svelte el manejador real de amarillo y el envío de la cola: feedback tras recarga, repetición, placeholders y Gustos.

Pruebas existentes de idiomas y pausa correctas. Gate completo correcto: suite local, 37 casos documentados/11 fuentes y 3 compilaciones, con huella de código estable. Paquete `artifacts/com.lgapp.holy_0.9.29_all.ipk` generado; backend de Mac reiniciado. Validación física e instalación en Windows/TV pendientes. Informe local: `.local/playback-validation/report.json`.
