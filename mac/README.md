# macOS

`LumaMenu.swift` es el control en la barra de menú. `build.sh` compila la app
en `~/Applications/Luma LG.app`. Necesita Node y el proyecto disponibles.
La conexión utiliza el mismo controlador de `../desktop/shared/` que Windows.

Después de vincular este Mac con la TV, usa `npm run desktop:start`.
`npm run holy:autostart -- on` configura el inicio de sesión (el script de compilación no lo activa salvo `LUMA_AUTOSTART=1 mac/build.sh`).
No ejecutes el antiguo `npm run lab` al mismo tiempo que el servicio común.
Para el relevo seguro, ambos equipos deben tener la versión actualizada.
