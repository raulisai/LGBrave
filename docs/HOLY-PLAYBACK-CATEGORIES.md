# Holy 0.9.2 · reproducción y categorías

Fecha: 2026-10-25 (México). Cambios locales sobre un árbol con trabajo previo sin commit; se conserva ese trabajo.

## Registro para investigar fallos

El servicio actualizado escribe `.local/logs/holy-playback.jsonl`, en la computadora que atiende Holy. `npm run holy:errors` resume ambos archivos conservados y los 30 eventos más recientes. No reconstruye errores de ayer ni recoge información mientras el servicio nuevo no esté activo.

Cada evento conserva fecha completa, título/episodio, sitio, hostname del servidor, fase, segundo/duración e intentos; los atascos incluyen disponibilidad de datos, estado de red del vídeo, código MediaError y segundos almacenados por delante. Se registran aperturas, fallos de servidor, errores HTTP/de red de peticiones Media observadas, desaparición del vídeo, tiempo de inicio agotado, desconexiones del reproductor y fases de recuperación. Las excepciones internas conservan su fase, no el texto arbitrario de terceros. No todas las solicitudes del reproductor son clasificadas como Media por Chromium: no es captura completa del tráfico.

Campos cerrados: no se guardan URLs de vídeo, consultas, fragmentos, credenciales ni cookies. Rotación a 1 MiB más un respaldo `.1`; los fallos de escritura no detienen la reproducción. Los títulos e historial de visualización son información local del usuario; no se envían a terceros. La memoria de errores internos se limita a 100 entradas.

## Recuperación

Se conserva el cambio de servidor/sitio existente. Tras unos 25 s sin avanzar a mitad del vídeo, o sin encontrar el vídeo que estaba reproduciéndose, se registra el incidente y se intenta continuar desde cinco segundos antes. También se detecta el atasco de los primeros segundos aunque no haya otro servidor. Si no hay alternativa, se permite una recarga del mismo servidor por sesión. Máximo tres rescates automáticos por título; agotados, se conserva la página para el control del usuario.

Las pausas voluntarias no disparan rescates. Un error MediaError se registra incluso si el reproductor queda pausado por el fallo. Retroceder manualmente reinicia el contador de atasco. Si el reproductor todavía no acepta el segundo guardado, se reintenta durante hasta 15 s; queda un evento si no se confirma. «recovery-started» significa que arrancó; «recovery-advancing» exige avance observado más allá del punto del incidente. No garantiza que todos los proveedores puedan recuperarse: tokens caducados, red y errores del sitio siguen siendo causas posibles. No se conoce la causa del incidente de ayer.

## Categorías

Películas, Anime, Doramas y Series presentan todos los géneros disponibles después de Continuar/Recomendado/En emisión, antes de las filas por sitio. Inicio también tiene géneros enlazables. Se unifican acentos y algunos alias (Horror/Terror, Action/Acción, Thriller/Suspenso); no se exige un mínimo de títulos ni se limita a ocho géneros.

Clic en el título o «Ver todas» abre ese género dentro de la sección actual. Con flechas, Izquierda desde la primera tarjeta enfoca el título y OK abre la categoría. Atrás devuelve la fila y columna anteriores; los episodios vuelven primero a la categoría. El botón Volver funciona con puntero. La búsqueda y el cambio de sección cierran el filtro.

Cada categoría muestra las filas que tengan datos:
- Recomendadas según el perfil de gustos existente.
- Nuevas: año actual o anterior, con año conocido.
- Más vistas en tu biblioteca: segundos realmente vistos guardados localmente, no audiencia mundial.
- Selecciones de listas verificadas: AFI 100 Thrills (2001) y Sight and Sound (2022), subconjuntos pequeños de películas con alias en español, inglés y algunos japoneses. Solo se incluyen títulos que coincidan exactamente y con el año; no se confunden remakes. No equivalen a listas completas ni a tendencias actuales.
- Mejor valoradas: puntuaciones numéricas sobre 10 proporcionadas por los sitios, sin mezclar con clasificación por edad ni inventar votos o posición global.
- Clásicas: títulos de hace al menos 20 años (criterio cronológico, no certificación de calidad).
- Todos los títulos, con recuento. Se unifican copias de la misma película/año/idioma; los episodios conservan su URL para no mezclar temporadas.

Fuentes consultadas 2026-10-25:
- AFI: https://www.afi.com/afis-100-years-100-thrills/
- BFI: https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time

Las selecciones externas no abarcan series o doramas ni aseguran disponibilidad. Se necesitan metadatos de género/año y catálogo suficiente para poblar cada fila; una fila vacía se oculta. Incorporar datos globales de audiencia o rankings de series/anime completos sigue pendiente, sin inventar estadísticas.

## Validación y entrega

Pruebas controladas en Windows, sin TV ni navegación de Internet: `npm test`, incluido `test-holy-discovery.mjs` (aislamiento por sección/género, alias, copias, año de remake, filas con datos, registro sin tokens y rotación, pausas, salto hacia atrás, vídeo desaparecido, MediaError pausado, reanudación aplazada y recarga limitada). Suite Holy existente y build/IPK de Holy correctos. Artefacto: `artifacts/com.lgapp.holy_0.9.2_all.ipk`.

No instalado ni probado visualmente en TV. IP local verificada `192.168.1.65`; TV configurada `192.168.1.134` responde a ping. Estado real del servicio: setup, falta vincular el perfil webOS local. Ping no demuestra conexión CDP ni reproducción. No se inició otro interceptor, no se navegó la TV y no se cambió el buscador. Activación pendiente: resolver vinculación, reiniciar el servicio cuando termine la sesión del usuario, instalar IPK y probar categorías con Magic Remote y reproducción prolongada.
