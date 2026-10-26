param([ValidateSet('on','off','status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Holy y Luma.lnk'
if ($Action -eq 'on') {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $nativeApp = Join-Path $env:LOCALAPPDATA 'Programs\HolyLuma\HolyLuma.exe'
    if (Test-Path -LiteralPath $nativeApp) {
        $shortcut.TargetPath = $nativeApp
        $shortcut.Arguments = '--background'
    } else {
        $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "' + (Join-Path $PSScriptRoot 'LumaTray.ps1') + '"'
    }
    $shortcut.WorkingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $shortcut.WindowStyle = 7
    $shortcut.Save()
} elseif ($Action -eq 'off') { if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath } }
@{installed=(Test-Path -LiteralPath $shortcutPath)} | ConvertTo-Json -Compress
