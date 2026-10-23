# Recursos comunes del motor Brave

Descargados 2026-10-21 del repositorio oficial `brave/adblock-rust`, commit `1c0740d27d531a2389c808212a8702592bb74138`:
https://github.com/brave/adblock-rust/blob/1c0740d27d531a2389c808212a8702592bb74138/data/brave/brave-resources.json

SHA-256 `f7ce26ede6b3bb90a0a9e20819e1d7f6b6dd71ee3ec8ae88f882ec7fcb232ebb`.
211 recursos de la muestra upstream, con dependencias/alias/permisos originales. Se combinan por nombre con los 17 recursos personalizados (ya presentes entre los 211) y las rutinas locales. No es una descarga autenticada del componente distribuido de Brave ni una auditoría completa de su código. El JSON se validó con adblock-rs 0.13.3.

Los recursos comunes incluyen código de uBlock Origin; se conserva GPL-3.0 en UBLOCK-LICENSE.txt, y la licencia del repositorio Brave en LICENSE. Las fuentes del recurso se conservan dentro del JSON como contenido base64. Uso actual en el Mac; este archivo no se empaqueta en la app de TV.
