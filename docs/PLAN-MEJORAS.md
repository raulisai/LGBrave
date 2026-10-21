# Próximos pasos · rapidez y seguridad

Fecha: 2026-10-21. Propuestas basadas en el proyecto actual; no son funciones implementadas ni una auditoría completa.

## Orden recomendado

| Prioridad | Trabajo concreto | Cómo demostrar que sirve |
| --- | --- | --- |
| 1 | Inicializar Git y guardar código, locks, documentación y manifiesto de fuentes; conservar IPK 0.5.0 con SHA-256 fuera de carpetas temporales | Restaurar copia en otro directorio y reproducir build; comprobar instalación de una versión conocida sin perder preferencias |
| 2 | Configuración única TV/Mac y diagnóstico previo con resultados claros | Cambiar IP en un solo lugar; detectar TV ausente, servidor apagado o puerto ocupado antes de navegar |
| 3 | Lanzador único que controle servidor, inspector y puente; bloqueo de instancia | Segundo arranque se rechaza o reutiliza conexión; cierre limpia solo procesos propios; reconexión no crea dos interceptores |
| 4 | Separar servicio habitual de fixtures y registro de pruebas; minimizar exposición local | Uso normal sin endpoints de prueba; accesos no autorizados rechazados; revisar orígenes y comandos, no depender solo de IP |
| 5 | Pruebas cortas por tipo de cambio y una regresión TV coordinada | UI: build + captura; resolver: casos locales; red: motor + fixtures; suite larga solo ante cambios relevantes |
| 6 | Medir estabilidad y latencia antes de optimizar | Registrar mediana y percentil 95 en varias cargas, fallos por sitio y memoria durante una sesión prolongada, separando Mac/TV/red |
| 7 | Actualizaciones verificables de filtros con vuelta a la lista anterior | Validar formato, procedencia/licencias y regresión; conservar lista previa si actualización falla |

## Qué puede ahorrar tiempo ahora

- Leer `docs/SEMILLA.md` al comenzar y seguir únicamente los archivos pertinentes.
- No reconstruir WASM cuando solo cambie la interfaz; `public/adblock.wasm` ya está preparado.
- En modo asistido el inicio se sirve desde `dist`: un build puede mostrar cambios sin reinstalar el IPK. Cambios del inicio empaquetado o metadatos sí requieren empaquetar e instalar. Comprobar ambos caminos antes de entregar.
- Separar pruebas deterministas de búsquedas públicas: Google u otros proveedores pueden limitar solicitudes; no confundir un 429 con un fallo del resolver.
- Evitar dos pruebas controlando la TV a la vez. Tras una validación, restaurar configuración y puente del usuario.

## Seguridad que ya existe y qué falta

Ya existe: validación de protocolos, preferencias con escritura atómica, llave fuera del proyecto, restricciones de IP en servidor, mundo JS aislado para la barra y conservación de CSP de páginas. No se modificó firmware.

Falta revisar: confianza entre página de inicio servida y comandos privilegiados del puente, integridad del inicio transportado por HTTP local, aislamiento visual de la barra frente al DOM de sitios, accesos al inspector, conservación de datos de navegación y dependencias de herramientas. La lista de IPs por sí sola no demuestra autenticación ni protege contra todo sitio malicioso. Hasta validar esos puntos, las pruebas de sesiones sensibles siguen fuera del alcance demostrado.

## Viabilidad futura

Autonomía sin Mac exige interceptar solicitudes antes de enviarlas manteniendo origen, cookies y comportamiento de sitios. El WASM ya resuelve reglas; el problema pendiente es integrarlo en la red del navegador. Definir primero una prueba pequeña que demuestre esa integración con los permisos disponibles.

OSE requiere identificar SoC real, arranque firmado, controladores de panel/audio/red y una recuperación verificable para este modelo. El nombre comercial α5 no basta para afirmar compatibilidad. Investigar con inventario de lectura y documentación antes de cualquier modificación. DNS se evaluará al final y no reemplaza el filtrado de rutas ni el bloqueo cosmético.
