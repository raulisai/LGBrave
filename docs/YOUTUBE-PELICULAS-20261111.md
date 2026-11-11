# YouTube: películas completas en español · 2026-11-11

## Qué pasaba

Holy solo aceptaba un vídeo largo de YouTube si el título decía «español», «latino», «castellano», «doblado» o «subtitulado». Las películas que ya son en español casi nunca lo dicen: cine mexicano, Pedro Infante, El Santo, Cantinflas, «La ley de Herodes» o «El chico nuevo» (1:28:33, título solo «El chico nuevo»).

Medido en vivo con 10 búsquedas («chico nuevo», «nosotros los pobres», «el santo contra las momias», «la ley de herodes», «mi pobre angelito», «el padrino», «rambo», «amores perros», «cantinflas», «el chavo animado»):

- **Vídeos de 50 min o más:** 167.
- **Aceptados:** 14.
- **Descartados:** 153, la mayoría por:
  - 108 por la regla del idioma;
  - 27 porque el título no contenía todas las palabras buscadas («El Santo vs las momias» no dice «contra»);
  - 18 por palabras de comentario. Muchas son subidas de la película completa con «| Datos y Explicación» añadido al título, de 1:40 a 2:57.

Después: con las mismas búsquedas Holy aceptaba 58 vídeos. Las páginas de resultados se guardaron para comparar siempre lo mismo, porque YouTube cambia los resultados entre peticiones.

## Cambios (`scripts/holy/youtube.mjs`)

- **Idioma:**
  - un título vale si se lee en español («el», «los», «una», «película», «ñ», «¡¿»…) o si es solo un nombre;
  - se rechaza si se lee en portugués («Filme Completo Dublado», «uma», «ele»), en inglés («Full Movie», «The Godfather», «Episode») u otro idioma;
  - la etiqueta Latino/Castellano/Subtitulado sigue saliendo del título cuando lo dice.
- **Comentario en el título:** «Datos y explicación», «Reseña» o «Hechos» ya no descartan una subida si el título dice «completa» y dura una hora o más. Esas subidas van después de las limpias. Sin «completa» siguen fuera. Un resumen, tráiler, ranking, recopilación o «en minutos» nunca entra.
- **Palabras buscadas:** las de unión («contra», «vs», «con», «para», «sin», «al», «o») ya no son obligatorias.
- **Orden:**
  1. el vídeo cuyo nombre es exactamente lo buscado;
  2. secuelas o subtítulos («Mi pobre angelito 3»);
  3. luego canales verificados, calidad y vistas.

  Antes «El chico nuevo» quedaba detrás de títulos tipo «Chica tímida sufre bullying, pero el chico nuevo…».
- **Más resultados:** si la primera página trae menos de 12 títulos válidos, se lee la siguiente con la continuación oficial de YouTube. En vivo tardó entre 1,0 y 1,3 s en total. Si la segunda página falla, se conserva la primera.
- **Copias:** de cada película se muestran las 3 mejores subidas, para que un nombre no llene la fila.
- **Nombres:** se toma la primera parte del título que conserva un nombre al cortar el relleno.
  - «Mi Pobre Angelito (1990) Película Completa | Familiar de Comedia | Datos y Explicación» → «Mi Pobre Angelito». Antes salía «Familiar de Comedia».
  - Título entre comillas: «Película "¡Así es mi tierra!" con Cantinflas» → «¡Así es mi tierra!».
  - Relleno al principio: «PELICULA COMPLETA DE CANTINFLAS POR MIS PISTOLAS» → «Cantinflas Por Mis Pistolas».
  - Relleno al final: «una película mexicana», «Comedia familiar», «colorizado».
  - Año partido: «Nosotros Los Pobres (1948, Español…».
  - Año en una parte propia: «Águila o sol | 1938 | Cantinflas».
- **Capítulos:** «(1/8)» de las series rusas y turcas cuenta como capítulo 1.

Duración: una película dura de 1 h a 4 h, y un capítulo de 18 min a 2 h 30. No se cambió: subir el mínimo a 1 h 30 dejaría fuera muchas películas clásicas (El Santo, Cantinflas: de 1:12 a 1:30).

## Pruebas

`scripts/test-holy-youtube.mjs`: 7 comprobaciones nuevas (23 en total) con títulos reales del 11/11. Cubren:
- idioma: español sin marca, portugués, inglés, capítulo en inglés;
- orden exacto primero;
- comentarios con «completa» y sin ella;
- rankings, «(1/8)», «contra»/«vs»;
- limpieza de nombres;
- máximo de copias;
- segunda página: pedida, no pedida y fallida.

## Límites

- No se puede saber el audio real de un vídeo sin abrirlo. Un título neutro («Rambo 3») puede estar en inglés.
- Una subida con «Datos y explicación» suele ser la película, pero puede estar recortada o tener intro y final añadidos. Por eso va al final.
- Las tarjetas «descubrir» de las listas buscan por el título original («The Godfather»). En YouTube rinde más el título en español. Cambiarlo exige tocar la interfaz de la TV (IPK) y queda pendiente.
- Un título que empieza por el actor («Cantinflas - El boxeador») se muestra como «Cantinflas».
- YouTube cambia sus resultados y su página. Las cifras son de una muestra del 11/11, no una cobertura completa.
