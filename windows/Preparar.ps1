$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0) { throw 'Instala Node.js 22.13 o posterior y vuelve a abrir PowerShell.' }
if ([version]($nodeVersion.Trim().TrimStart('v')) -lt [version]'22.13.0') { throw 'Se requiere Node.js 22.13 o posterior. Actualiza Node.js y vuelve a abrir PowerShell.' }
Write-Host ('Node.js: ' + $nodeVersion)
& npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias. Revisa el error de npm; adblock-rs puede requerir Rust y las herramientas C++ de Visual Studio.' }
& node --input-type=module -e "import adblock from 'adblock-rs'; console.log('Motor de Brave: ' + typeof adblock.Engine)"
if ($LASTEXITCODE -ne 0) { throw 'El motor nativo no pudo cargarse. Revisa la compilacion de adblock-rs.' }
& npm.cmd run build:all
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron generar los inicios.' }
& npm.cmd run windows:install
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar el programa de Windows. Revisa el error anterior.' }
Write-Host 'Listo. Abre windows\Iniciar Luma.cmd. Usa Vincular TV en el menu de la bandeja.'
