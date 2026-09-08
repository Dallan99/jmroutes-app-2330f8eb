$ErrorActionPreference = 'Stop'

$workerDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runner = Join-Path $PSScriptRoot 'run-worker-base.cmd'
$taskPrefix = 'JMRoutes Meli Worker'

if (-not (Test-Path (Join-Path $workerDir '.env.local'))) {
  throw 'Arquivo .env.local não encontrado. Configure o worker antes de instalar o início automático.'
}
if (-not (Test-Path (Join-Path $workerDir 'dist\index.js'))) {
  throw 'Worker não compilado. Execute npm run build antes de instalar.'
}

$legacyTasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object TaskName -Like "$taskPrefix*"
foreach ($legacyTask in $legacyTasks) {
  Stop-ScheduledTask -TaskName $legacyTask.TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $legacyTask.TaskName -Confirm:$false
}

$bases = @(
  @{ Name = 'Grupo 1'; Code = 'SSP3,SSP38,SSP5,SSP17,SSP37'; Delay = 0; Label = 'GRUPO-1' },
  @{ Name = 'Grupo 2'; Code = 'ESP15,SSP20,SSP6,SSP45'; Delay = 20; Label = 'GRUPO-2' },
  @{ Name = 'Grupo 3'; Code = 'ESP16,SSP15,SSP23,SSC2'; Delay = 40; Label = 'GRUPO-3' },
  @{ Name = 'Grupo 4'; Code = 'ESP17,ESP18,SSP4,SSP7'; Delay = 60; Label = 'GRUPO-4' }
)

foreach ($base in $bases) {
  $taskName = "$taskPrefix $($base.Name)"
  $arguments = "/d /c call `"$runner`" `"$($base.Code)`" $($base.Delay) $($base.Label)"
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arguments -WorkingDirectory $workerDir
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

Write-Host 'Início automático instalado: quatro workers cobrindo todas as bases do Dashboard Geral.' -ForegroundColor Green
