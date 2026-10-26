# Windows

`HolyLuma.cs` es la aplicación nativa de bandeja. Se compila e instala con
`npm run windows:install`; conserva Node y el proyecto como dependencias.
`Preparar.ps1` prepara dependencias, `Link-TV.ps1` vincula el equipo y
`Autostart.ps1` administra el inicio de sesión. `Iniciar Luma.cmd` abre la app.
`LumaTray.ps1` es la alternativa anterior para diagnóstico.

La conexión y los filtros se ejecutan desde `../desktop/shared/` y `../scripts/`.
Instrucciones y límites: `../docs/WINDOWS.md`.
