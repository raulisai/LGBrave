<#
  Limita lo que Windows deja entrar al servicio de Holy y Luma.

  Hoy Windows tiene una regla «Node.js JavaScript Runtime» que deja entrar TCP y UDP desde
  CUALQUIER dirección, en cualquier puerto, a node.exe (perfil Público). Eso incluye cualquier
  otro programa de Node que abras (un servidor de desarrollo, por ejemplo), no solo Holy.

  Este script crea una regla estrecha: solo los puertos de Holy (43187, 43188 y 43190, TCP) y
  solo desde tu propia red (LocalSubnet). Con -QuitarReglasAmplias desactiva además las reglas
  amplias de Node.js (no las borra: se pueden volver a activar desde «Firewall de Windows»).

  Necesita una ventana de PowerShell «Ejecutar como administrador». No se ejecuta solo:
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\Firewall-LAN.ps1 -WhatIf   # solo muestra qué haría
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\Firewall-LAN.ps1           # crea la regla estrecha
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\Firewall-LAN.ps1 -QuitarReglasAmplias
    powershell -NoProfile -ExecutionPolicy Bypass -File windows\Firewall-LAN.ps1 -Deshacer # vuelve a lo anterior
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$QuitarReglasAmplias,
    [switch]$Deshacer
)
$ErrorActionPreference = 'Stop'
$ruleName = 'Holy y Luma (solo red local)'
$broadName = 'Node.js JavaScript Runtime'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $WhatIfPreference) { throw 'Abre PowerShell como administrador y vuelve a ejecutar este script.' }
if (-not (Test-Path -LiteralPath $node)) { throw "No encuentro Node.js en $node." }

if ($Deshacer) {
    if ($PSCmdlet.ShouldProcess($ruleName, 'Eliminar la regla estrecha')) { Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
    if ($PSCmdlet.ShouldProcess($broadName, 'Reactivar las reglas amplias de Node.js')) { Get-NetFirewallRule -DisplayName $broadName -ErrorAction SilentlyContinue | Set-NetFirewallRule -Enabled True }
    Write-Host 'Reglas anteriores restauradas.'
    return
}

# Primero la regla estrecha: así Holy no se queda sin entrada mientras se quitan las amplias.
if ($PSCmdlet.ShouldProcess($ruleName, 'Crear regla: TCP 43187,43188,43190 desde LocalSubnet')) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Enabled True -Profile Any `
        -Program $node -Protocol TCP -LocalPort 43187, 43188, 43190 -RemoteAddress LocalSubnet | Out-Null
}
if ($QuitarReglasAmplias -and $PSCmdlet.ShouldProcess($broadName, 'Desactivar las reglas amplias de Node.js')) {
    Get-NetFirewallRule -DisplayName $broadName -ErrorAction SilentlyContinue | Set-NetFirewallRule -Enabled False
}
Get-NetFirewallRule -DisplayName $ruleName, $broadName -ErrorAction SilentlyContinue |
    Select-Object DisplayName, Enabled, Profile, Direction, Action | Format-Table -AutoSize
Write-Host 'Comprueba después: npm run desktop:status  y abre http://<esta-computadora>:43190/ desde el teléfono y la TV.'
