# Servicio común Windows y Mac

- `desktop-config.mjs`: rutas, perfil webOS y direcciones actuales.
- `desktop-control.mjs`: comandos e IPC local autenticado.
- `desktop-supervisor.mjs`: proceso de segundo plano y reinicio del host.
- `desktop-host.mjs`: servidores y un único puente a Holy o Luma.
- `profile-state.mjs`: preferencias e historial compartidos con copias locales.
- `tv-profile-store.mjs`: caché temporal de datos por SSH/SFTP autenticado.

`scripts/desktop-*.mjs` son entradas estables para instalaciones anteriores,
comandos npm y pruebas. No duplican la implementación.
