param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('worker', 'dashboard')]
  [string]$Mode,
  [string]$BaseCodes = '',
  [int]$Delay = 0,
  [string]$Label = ''
)

$ErrorActionPreference = 'Stop'
$windowsDir = $PSScriptRoot

if ($Mode -eq 'dashboard') {
  & (Join-Path $windowsDir 'run-dashboard-geral.cmd')
  exit $LASTEXITCODE
}

& (Join-Path $windowsDir 'run-worker-base.cmd') $BaseCodes $Delay $Label
exit $LASTEXITCODE
