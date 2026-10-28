# Doctor: recuperación supervisada · 0.9.20

2026-10-28. EXEWindows0.9.12.0 ya instalado; no requiere otra reinstalación nativa.

## Problema integrado

El caso del28/10 queda registrado como profile-context-mismatch/profile-stale: el controlador encontraba el perfil y el worker decía que faltaba. El lanzador nativo ya fija las carpetas conocidas de Windows. Además, el worker ahora publica una huella del contexto de registro/SSH/sincronización; el controlador y el supervisor pueden comparar entornos sin exponer rutas de cuenta, llaves o claves del canal.

Doctor del panel y Doctor web comparten las decisiones de conexión. El supervisor aplica el mismo coordinador ante setup/error o ausencia de latidos, aunque el icono se haya cerrado. Una sesión sana o en respaldo no activa el monitor. La desconexión ordinaria de TV/red mantiene los reintentos pasivos existentes; Doctor puede despertarlos sin reiniciar todo el servicio.

## Casos y respuesta

| Caso | Respuesta |
| --- | --- |
| Conexión activa | Verifica estado y conserva proceso/sesión |
| Contexto distinto con conexión sana | Lo informa y difiere la recarga hasta desconexión |
| Perfil desactualizado en worker | Recarga una sola instancia con perfil actual |
| Registro ausente y respaldo válido | Restaura metadatos públicos usando la misma llave |
| Registro ilegible | Lo conserva y pide revisión; no pierde otros perfiles |
| Llave/perfil sin autorización utilizable | Indica Developer Mode; no inventa PIN ni sustituye credenciales |
| IP de TV incoherente | Solicita confirmar la dirección; no cambia DNS ni red |
| TV no responde | Espera, sin reinicios repetidos |
| App cerrada en TV | Pide abrir Holy/Luma; no la lanza ni navega |
| Otra computadora atiende TV | Permanece en respaldo; no solicita relevo desde Doctor |
| Servicio detenido | Puede iniciarlo al pedir reparación |
| Servicio bloqueado/error | Recupera solo su propio worker con límite de intentos |
| Puerto/otro runtime local ocupado | Informa el conflicto; no mata procesos ajenos |
| Catálogo viejo o sitios con fallo | Doctor web puede solicitar refresco acotado; no promete reparar el proveedor |
| Inicio automático desactivado | Informa; solo se activa por petición expresa |
| Memoria/dirección del host que requieren reinicio | Receta manual pendiente, bajo supervisor y límites; no es una verificación de vídeo |

No hay garantía de resolver cualquier fallo externo. Captcha, autorización expirada, equipos apagados y sitios que retiraron servidores requieren intervención o disponibilidad externa. Doctor no escribe parches de código por sí solo ni corrige el bug de ficha RePelisHD de Between Steps pendiente en SOUL.

## Resultado verificable y límites

Cada reparación distingue verified, pending, waiting, blocked, cooldown, busy y failed. Solo se declara verificada una conexión observada como connected con contexto coherente; iniciar un proceso todavía no significa que haya conectado. La espera de comprobación es acotada; el siguiente estado sigue disponible en el panel.

Una reserva exclusiva evita acciones simultáneas entre Doctor del panel, web y supervisor. El registro .local/doctor-state.json limita cada tipo de acción a3intentos por10minutos; reinicios repetidos esperan30/120/300s, y el límite de ventana prevalece. El contador persiste entre llamadas/procesos y no se borra al reiniciar. Si el registro de intentos no puede escribirse, se bloquea una acción destructiva sin control en lugar de repetirla. Los reinicios por salida/crash del proceso conservan también la política previa de backoff del supervisor; no se confunden con un diagnóstico de reproducción.

Antes de actuar se relee el estado: si apareció una conexión sana, está iniciando o hay otro dueño, se conserva. Los registros diagnósticos guardan códigos, acción, intento y resultado, sin secretos. No se cambian firmware, firewall, DNS, gustos ni llaves.

## Validación

15 escenarios nuevos y las20comprobaciones previas de Doctor/recuperación pasan. Hay pruebas de diagnóstico, contexto sin rutas expuestas, presupuesto persistente, concurrencia, espera verificable, error de acción, registro ilegible, llave existente, TV apagada, respaldo y reconexión sin reinicio total.

Una prueba ejecuta copias exactas de los módulos del supervisor en una carpeta temporal aislada, con host simulado y sin SDK/TV: setup obsoleto→un reinicio→connected; luego conserva el mismo proceso al estar sano y en standby. Se borra solo el directorio temporal verificado.

playback:check completo pasa:25casos documentados, contratos de7fuentes, prueba del EXEWindows y3builds, sin cambios de código durante la ejecución.

Activación en Windows comprobada en vivo: worker publica contexto conocido/coherente. Se invocó Doctor dos veces con la LG conectada: ambas verified/healthy y mismo PID del worker, sin reiniciar. La lectura pasiva del vídeo existente conservó huella de página y avanzó ~724→762s, sin pausa ni MediaError. Solo hubo la recarga necesaria para activar el código; después Doctor no alteró la reproducción. Esto acredita continuidad de esa sesión, no cobertura de todos los vídeos de Internet. No se provocó el fallo del perfil en la TV del usuario; la inyección se hizo únicamente en el entorno aislado.

## Cómo ampliar cobertura

Para un incidente nuevo: conservar evidencia sanitizada, asignar código estable, decidir acción segura y condiciones de espera, añadir reproducción controlada/regresión y pasar playback:check antes de desplegar. Si falta evidencia o autorización, devolver diagnóstico pendiente en lugar de una reparación inventada. Las fallas de proveedores se consultan aparte con playback:probe; no se experimenta sobre una TV en uso.
