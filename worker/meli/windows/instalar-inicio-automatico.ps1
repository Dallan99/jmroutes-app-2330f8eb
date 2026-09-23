$ErrorActionPreference = 'Stop'

$workerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-worker-base.cmd'
$dashboardRunner = Join-Path $PSScriptRoot 'run-dashboard-geral.cmd'
$hiddenRunner = Join-Path $PSScriptRoot 'run-hidden.ps1'
$taskPrefix = 'JMRoutes Meli Worker'

if (-not (Test-Path (Join-Path $workerDir '.env.local'))) {
  throw 'Arquivo .env.local não encontrado. Configure o worker antes de instalar o início automático.'
}
if (-not (Test-Path (Join-Path $workerDir 'dist\index.js'))) {
  throw 'Worker não compilado. Execute npm run build antes de instalar.'
}
if (-not (Test-Path (Join-Path $workerDir 'dist\monitoring-worker.js'))) {
  throw 'Worker do Dashboard Geral não compilado. Execute npm run build antes de instalar.'
}

$envPath = Join-Path $workerDir '.env.local'
$envLines = @(Get-Content $envPath)
$dryRunIndex = -1
for ($i = 0; $i -lt $envLines.Count; $i++) {
  if ($envLines[$i] -match '^DRY_RUN=') { $dryRunIndex = $i; break }
}
if ($dryRunIndex -ge 0) { $envLines[$dryRunIndex] = 'DRY_RUN=false' }
else { $envLines += 'DRY_RUN=false' }
[IO.File]::WriteAllLines($envPath, $envLines, (New-Object Text.UTF8Encoding $false))

$legacyTasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object TaskName -Like "$taskPrefix*"
foreach ($legacyTask in $legacyTasks) {
  Stop-ScheduledTask -TaskName $legacyTask.TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $legacyTask.TaskName -Confirm:$false
}

$bases = @(
  @{ Name = 'Grupo 1'; Code = 'ESP15,ESP17'; Delay = 0; Label = 'GRUPO-1' },
  @{ Name = 'Grupo 2'; Code = 'ESP16,ESP18'; Delay = 30; Label = 'GRUPO-2' }
)

foreach ($base in $bases) {
  $taskName = "$taskPrefix $($base.Name)"
  $arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hiddenRunner`" -Mode worker -BaseCodes `"$($base.Code)`" -Delay $($base.Delay) -Label `"$($base.Label)`""
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $workerDir
  $triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  # Garante recuperação após suspensão, encerramento inesperado ou perda do processo.
  # Com MultipleInstances=IgnoreNew, esta verificação não cria duplicatas.
  $triggerWatchdog = New-ScheduledTaskTrigger `
    -Once `
    -At ((Get-Date).AddMinutes(1)) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

  $task = New-ScheduledTask -Action $action -Trigger @($triggerLogon, $triggerWatchdog) -Principal $principal -Settings $settings
  Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
}

$dashboardAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hiddenRunner`" -Mode dashboard" -WorkingDirectory $workerDir
$dashboardTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$dashboardWatchdog = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5)
$dashboardPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$dashboardSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "$taskPrefix Dashboard Geral" -Action $dashboardAction -Trigger @($dashboardTrigger, $dashboardWatchdog) -Principal $dashboardPrincipal -Settings $dashboardSettings -Force | Out-Null
Start-ScheduledTask -TaskName "$taskPrefix Dashboard Geral"

Write-Host 'Início automático instalado: dois workers XPT e um worker leve do Dashboard Geral.' -ForegroundColor Green
