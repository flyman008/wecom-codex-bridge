$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime\service.pid'
$expectedEntry = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\src\index.js'))

if (-not (Test-Path -LiteralPath $pidFile)) {
  Write-Output 'Service is not running (PID file not found).'
  exit 0
}

$serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceProcessId"
if (-not $processInfo) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Output 'Service is not running (stale PID file removed).'
  exit 0
}

if (-not $processInfo.CommandLine -or $processInfo.CommandLine.IndexOf($expectedEntry, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw "PID $serviceProcessId does not belong to this service; refusing to stop it."
}

Stop-Process -Id $serviceProcessId -ErrorAction Stop
Remove-Item -LiteralPath $pidFile -Force
Write-Output "Service stopped (PID $serviceProcessId)."
