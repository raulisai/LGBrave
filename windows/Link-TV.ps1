param([string]$TvIp = '', [switch]$NoStart)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
Write-Host 'Vincular esta computadora con la TV' -ForegroundColor Cyan
Write-Host 'Abre Developer Mode en la TV. Comprueba su IP y activa Key Server.'
if (-not $TvIp) { $TvIp = Read-Host 'IP actual de la TV' }
$statusJson = & node (Join-Path $projectRoot 'scripts\desktop-control.mjs') status
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar la configuración de la computadora.' }
$current = ($statusJson | ConvertFrom-Json).config
$current.tvIp = $TvIp.Trim()
$payload = $current | ConvertTo-Json -Compress
$payload | & node (Join-Path $projectRoot 'scripts\desktop-control.mjs') configure
if ($LASTEXITCODE -ne 0) { throw 'No se pudo guardar el perfil de la TV.' }
Write-Host 'Escribe la passphrase que muestra Developer Mode cuando la herramienta la pida. No se guarda en el proyecto.'
& node (Join-Path $projectRoot 'node_modules\@webos-tools\cli\bin\ares-novacom.js') --device $current.device --getkey
if ($LASTEXITCODE -ne 0) { throw 'No se pudo obtener la llave. Comprueba Key Server y la passphrase.' }
if (-not $NoStart) {
    & node (Join-Path $projectRoot 'scripts\desktop-control.mjs') restart
    if ($LASTEXITCODE -ne 0) { throw 'La llave se obtuvo, pero no se pudo reiniciar la conexión. Revisa el registro.' }
}
Read-Host 'Vinculacion terminada. Pulsa Enter para cerrar'
