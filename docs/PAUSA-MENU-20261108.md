# Menú al pausar películas · 2026-11-08

Al iniciar: HEAD y origin/main en319aec0, sin commits faltantes ni ramas remotas
sin integrar. Cambios existentes de listas/filtros y evidencia se conservaron.
Windows conectado a Holy en TV192.168.1.134; Mac sincronizada en red. El IPK
instalado0.9.24 no explica el fallo: el panel lo inyecta el backend activo.

Los logs registran pause-hold en Rain Man, El árbol de la vida y Las vidas
posibles de Mr. Nobody. La pausa se detectaba; watch solo invocaba el menú si
era serie o tenía más de un idioma. Películas con una versión quedaban fuera.
Esa condición existía antes de los cambios de Atrás y del retiro de TMDB;
no era una pérdida de commits de GitHub.

0.9.29 muestra el panel para toda reproducción pausada después del plazo
habitual. Al reanudar se oculta. Idioma solo aparece con varias versiones y
Capítulos en contenido episódico. Otro servidor se ofrece si quedan enlaces
alternativos del idioma actual; una selección explícita guarda el segundo
y lo reanuda en el siguiente servidor. Una pausa por sí sola nunca lo cambia.
No se inventan idiomas, capítulos ni enlaces que el sitio no ofrece.

Regresiones controladas en test-holy-pause.mjs: películas sin variantes y con
un idioma, texto/panel visible solicitado, retirada al reanudar, múltiples
idiomas, capítulos, alternativa de servidor con segundo/idioma conservados y
ausencia de alternativa. Se conservan errores durante pausa larga, reconexión,
otros frames, fin de vídeo y recuperación real sin pausa.

Al reiniciar el backend o relevar una computadora, el descriptor conserva el
vídeo pero no las direcciones firmadas de servidores. El panel ya se dibuja
mientras recupera opciones del conector en segundo plano; una respuesta de
otro vídeo o sesión se descarta. Regresiones con resolución diferida cubren
ambas situaciones. No se navega al consultar los metadatos.

Prueba autorizada en LG con Rain Man: panel visible a2767ms y3252ms de pausar.
Captura inspeccionada: EN PAUSA, Rain Man, Seguir viendo y Otro servidor
después de recuperar metadatos. No hay varios idiomas en esta muestra; no se
inventó la opción. Mismo vídeo/duración8032.979s, posición6358.505→6361.207s,
readyState4 y sin pausa al terminar. Panel retirado al reanudar. No se navegó
a otra película ni se eligió un servidor para interrumpir la sesión.
El cambio de servidor/idioma y los capítulos se validaron de forma controlada,
no físicamente en este ensayo. El glifo de servidor faltaba en la fuente LG:
se sustituyó por ASCII. Gate final de esa revisión:37casos/11fuentes/3builds correctos.
Huella estable: 6686a9d5332a47e3131e1eaff25698684621a4eb46e39b60dbf0643d2870b6b0.
Evidencia sanitizada: evidence/holy/pause-menu-20261108.json.
No equivale a cobertura general de Internet ni a una prueba física en Mac.
