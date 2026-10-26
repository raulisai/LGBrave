param([switch]$NoStart, [switch]$ValidateOnly, [string]$NodePath = '')
$ErrorActionPreference = 'Stop'
$nativeApp = Join-Path $env:LOCALAPPDATA 'Programs\HolyLuma\HolyLuma.exe'
if (-not $ValidateOnly -and (Test-Path -LiteralPath $nativeApp)) {
    $nativeArguments = if ($NoStart) { @('--background', '--no-start') } else { @('--background') }
    Start-Process -FilePath $nativeApp -ArgumentList $nativeArguments -WindowStyle Hidden
    exit
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $NodePath) {
    $savedNodePath = Join-Path $projectRoot '.local\node-path.txt'
    if ([IO.File]::Exists($savedNodePath)) { $NodePath = [IO.File]::ReadAllText($savedNodePath).Trim() }
}
if (-not $NodePath -or -not [IO.File]::Exists($NodePath)) {
    foreach ($folder in $env:PATH.Split(';')) {
        if (-not $folder) { continue }
        $candidate = Join-Path $folder 'node.exe'
        if ([IO.File]::Exists($candidate)) { $NodePath = $candidate; break }
    }
}
if (-not $NodePath -or -not [IO.File]::Exists($NodePath)) { throw 'No se encontró Node.js. Ejecuta Preparar.ps1 primero.' }
$nodePath = $NodePath
$controllerPath = Join-Path $projectRoot 'scripts\desktop-control.mjs'
$mutexName = if ($ValidateOnly) { 'Local\LumaHolyDesktopTrayValidation' + $PID } else { 'Local\LumaHolyDesktopTray' }
$trayMutex = New-Object Threading.Mutex($false, $mutexName)
if (-not $trayMutex.WaitOne(0)) { exit }
[Windows.Forms.Application]::EnableVisualStyles()
$script:pending = $null
$script:lastStatus = $null
$form = New-Object Windows.Forms.Form
$form.Text = 'Holy y Luma · Conexión con la TV'
$form.Size = New-Object Drawing.Size(700, 570)
$form.MinimumSize = $form.Size
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$heading = New-Object Windows.Forms.Label
$heading.SetBounds(20, 20, 640, 50)
$heading.Font = New-Object Drawing.Font('Segoe UI', 16)
$heading.Text = 'Comprobando conexión…'
$details = New-Object Windows.Forms.TextBox
$details.SetBounds(20, 80, 640, 330)
$details.Multiline = $true
$details.ReadOnly = $true
$details.ScrollBars = 'Vertical'
$details.Anchor = 'Top,Bottom,Left,Right'
$form.Controls.AddRange(@($heading, $details))
function Invoke-Control([string]$Action, [string]$Payload = '') {
    if ($script:pending) { return }
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $nodePath
    $info.Arguments = '"' + $controllerPath + '" ' + $Action
    $info.WorkingDirectory = $projectRoot
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    $info.StandardOutputEncoding = [Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = [Diagnostics.Process]::Start($info)
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    if ($Payload) { $process.StandardInput.Write($Payload) }
    $process.StandardInput.Close()
    $script:pending = @{ Process = $process; Out = $outTask; Err = $errTask; Action = $Action; Started = [DateTime]::UtcNow }
    if ($Action -ne 'status') { $heading.Text = 'Procesando: ' + $Action + '…' }
}
function Show-Status($state) {
    $script:lastStatus = $state
    $heading.Text = $state.label
    $waiting = $state.state -in @('standby', 'waiting', 'starting', 'restarting')
    $heading.ForeColor = if ($state.state -eq 'connected') { [Drawing.Color]::ForestGreen } elseif ($waiting) { [Drawing.Color]::DarkOrange } else { [Drawing.Color]::Firebrick }
    $tooltip = 'Holy / Luma: ' + $state.label
    $tray.Text = $tooltip.Substring(0, [Math]::Min(63, $tooltip.Length))
    $tray.Icon = if ($state.state -eq 'connected') { [Drawing.SystemIcons]::Information } elseif ($waiting) { [Drawing.SystemIcons]::Warning } else { [Drawing.SystemIcons]::Error }
    $lines = @("Computadora: $($state.host)", "TV: $($state.tv.host):$($state.tv.port)", "Perfil webOS: $($state.tv.device)",
        "Aplicación: $($state.app)", "Inicio Holy generado: $($state.build.holy)", "Inicio Luma generado: $($state.build.luma)", '', $state.error)
    if ($state.checks) { $lines += @('', 'DIAGNÓSTICO'); $lines += $state.checks }
    if ($state.peers) { $lines += @('', 'OTRAS COMPUTADORAS'); foreach ($peer in $state.peers) { $lines += ($peer.host + ': ' + $(if ($peer.reachable) { 'responde' } else { 'no responde' })) } }
    $lines += @('', $state.history, '', 'El servicio sigue activo al cerrar esta ventana.', 'Registro: .local\logs\desktop.log')
    $details.Text = $lines -join [Environment]::NewLine
}
function Show-Configuration {
    if ($script:pending -or -not $script:lastStatus) { return }
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'Conexión · Configurar'
    $dialog.Size = New-Object Drawing.Size(560, 330)
    $dialog.StartPosition = 'CenterParent'
    $boxes = @{}
    $fields = @(@('device', 'Perfil webOS'), @('tvIp', 'IP actual de la TV'), @('host', 'IP de esta PC (vacío = automática)'), @('peers', 'Otras computadoras (IP separadas por coma)'))
    $y = 15
    foreach ($field in $fields) {
        $label = New-Object Windows.Forms.Label
        $label.Text = $field[1]; $label.SetBounds(15, $y, 510, 20)
        $box = New-Object Windows.Forms.TextBox
        $box.SetBounds(15, ($y + 22), 510, 24)
        $value = $script:lastStatus.config.($field[0])
        $box.Text = if ($field[0] -eq 'peers') { $value -join ',' } else { [string]$value }
        $boxes[$field[0]] = $box
        $dialog.Controls.AddRange(@($label, $box)); $y += 55
    }
    $save = New-Object Windows.Forms.Button
    $save.Text = 'Guardar'; $save.SetBounds(420, 240, 105, 30); $save.DialogResult = 'OK'
    $dialog.Controls.Add($save); $dialog.AcceptButton = $save
    if ($dialog.ShowDialog($form) -eq 'OK') {
        $peers = @($boxes.peers.Text.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $payload = @{device=$boxes.device.Text.Trim();tvIp=$boxes.tvIp.Text.Trim();host=$boxes.host.Text.Trim();peers=$peers} | ConvertTo-Json -Compress
        Invoke-Control 'configure' $payload
        $script:restartAfterConfigure = $true
    }
    $dialog.Dispose()
}
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.SystemIcons]::Application
$tray.Text = 'Holy / Luma'
$menu = New-Object Windows.Forms.ContextMenuStrip
foreach ($entry in @(@('Ver estado', 'show'), @('Encender conexión', 'start'), @('Apagar conexión', 'stop'), @('Reiniciar conexión', 'restart'), @('Diagnóstico', 'doctor'), @('Configurar direcciones', 'config'), @('Vincular TV (Developer Mode)', 'link'), @('Ver registro', 'log'), @('Iniciar al entrar en Windows', 'autostart-on'), @('Quitar inicio automático', 'autostart-off'), @('Salir del control (conserva conexión)', 'exit'))) {
    $item = $menu.Items.Add($entry[0]); $item.Tag = $entry[1]
    $item.Add_Click({
        switch ($this.Tag) {
            'show' { $form.Show(); $form.Activate(); Invoke-Control 'status' }
            'config' { Show-Configuration }
            'link' { Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -File "' + (Join-Path $PSScriptRoot 'Link-TV.ps1') + '"') -WindowStyle Normal }
            'log' { $logFile = Join-Path $projectRoot '.local\logs\desktop.log'; if (Test-Path -LiteralPath $logFile) { Start-Process notepad.exe -ArgumentList ('"' + $logFile + '"') -WindowStyle Hidden } }
            'autostart-on' { & (Join-Path $PSScriptRoot 'Autostart.ps1') -Action on }
            'autostart-off' { & (Join-Path $PSScriptRoot 'Autostart.ps1') -Action off }
            'exit' { $script:exiting = $true; $form.Close(); [Windows.Forms.Application]::ExitThread() }
            default { $form.Show(); Invoke-Control $this.Tag }
        }
    })
}
$tray.ContextMenuStrip = $menu
$buttonX = 20
foreach ($entry in @(@('Encender', 'start'), @('Apagar', 'stop'), @('Reiniciar', 'restart'), @('Diagnóstico', 'doctor'))) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $entry[0]; $button.Tag = $entry[1]
    $button.SetBounds($buttonX, 425, 145, 35)
    $button.Anchor = 'Bottom,Left'
    $button.Add_Click({ Invoke-Control $this.Tag })
    $form.Controls.Add($button); $buttonX += 160
}
$configButton = New-Object Windows.Forms.Button
$configButton.Text = 'Configurar'; $configButton.SetBounds(20, 470, 145, 35); $configButton.Anchor = 'Bottom,Left'
$configButton.Add_Click({ Show-Configuration }); $form.Controls.Add($configButton)
$linkButton = New-Object Windows.Forms.Button
$linkButton.Text = 'Vincular TV'; $linkButton.SetBounds(180, 470, 145, 35); $linkButton.Anchor = 'Bottom,Left'
$linkButton.Add_Click({ Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -File "' + (Join-Path $PSScriptRoot 'Link-TV.ps1') + '"') -WindowStyle Normal })
$form.Controls.Add($linkButton)
$tray.Add_DoubleClick({ $form.Show(); $form.Activate() })
$form.Add_FormClosing({ param($sender, $eventArgs) if (-not $script:exiting) { $eventArgs.Cancel = $true; $form.Hide() } })
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 500
$script:ticks = 0
$timer.Add_Tick({
    $script:ticks++
    if ($script:pending -and ([DateTime]::UtcNow - $script:pending.Started).TotalSeconds -gt 30) {
        $job = $script:pending; $script:pending = $null
        if (-not $job.Process.HasExited) { $job.Process.Kill() }
        $job.Process.Dispose()
        $script:restartAfterConfigure = $false
        $heading.Text = 'Revisar conexión'; $details.Text = 'El control tardó demasiado. Revisa el registro.'
        $tray.Icon = [Drawing.SystemIcons]::Error; $tray.Text = 'Holy / Luma: revisar conexión'
    }
    if ($script:pending -and $script:pending.Process.HasExited -and $script:pending.Out.IsCompleted -and $script:pending.Err.IsCompleted) {
        $job = $script:pending; $script:pending = $null
        $exitCode = $job.Process.ExitCode
        if ($exitCode -eq 0) {
            try { Show-Status ($job.Out.Result | ConvertFrom-Json) } catch { $details.Text = $_.Exception.Message }
        } else { $heading.Text = 'Revisar conexión'; $details.Text = $job.Err.Result }
        $job.Process.Dispose()
        if ($script:restartAfterConfigure -and $job.Action -eq 'configure') { $script:restartAfterConfigure = $false; if ($exitCode -eq 0) { Invoke-Control 'restart' } }
    }
    if (-not $script:pending -and $script:ticks % 8 -eq 0) { Invoke-Control 'status' }
})
if ($ValidateOnly) {
    $sample = & $nodePath $controllerPath status | ConvertFrom-Json
    Show-Status $sample
    if ($details.Text -notmatch '[\r\n]TV:') { throw 'El panel no separa las direcciones.' }
    $form.Dispose(); $tray.Dispose(); $trayMutex.ReleaseMutex(); $trayMutex.Dispose()
    Write-Output 'WinForms, menú y estado construidos correctamente.'; exit
}
$tray.Visible = $true
$timer.Start()
if ($NoStart) { Invoke-Control 'status' } else { Invoke-Control 'start' }
try { [Windows.Forms.Application]::Run() }
finally { $timer.Stop(); $timer.Dispose(); $tray.Visible = $false; $tray.Dispose(); $form.Dispose(); $trayMutex.ReleaseMutex(); $trayMutex.Dispose() }
