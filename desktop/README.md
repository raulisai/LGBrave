# Código para las computadoras

`shared/` contiene el servicio y el controlador comunes de Windows y macOS.
Las interfaces nativas están en `../windows/` (bandeja) y `../mac/` (barra de menú).
Los puentes CDP, filtros y conectores reutilizables permanecen en `../scripts/`.

La interfaz que se instala en la TV está en `../src/`, `../public/` y
`../holy-public/`. Los builds se generan en `dist/` y `dist-holy/`.
Ni el EXE ni el código Node se instalan en la TV.

Consulta [Instalación y operación](../docs/INSTALACION.md) para Mac, Windows, vinculación y relevo; [Arquitectura](../docs/ARQUITECTURA.md) contiene los diagramas y [la revisión](../docs/REVISION-CALIDAD-SEGURIDAD-20261107.md) los riesgos abiertos. `docs/WINDOWS.md` conserva detalles y verificaciones históricas del panel.
