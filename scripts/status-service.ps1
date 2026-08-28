$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime\service.pid'
$serviceProcessId = $null
if (Test-Path -LiteralPath $pidFile) {
  $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
}

$processRunning = $false
if ($serviceProcessId) {
  $processRunning = [bool](Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue)
}

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3
  [pscustomobject]@{
    ProcessRunning = $processRunning
    ProcessId = $serviceProcessId
    Connection = $health.status
    ActiveTasks = $health.activeTasks
  }
} catch {
  [pscustomobject]@{
    ProcessRunning = $processRunning
    ProcessId = $serviceProcessId
    Connection = 'unavailable'
    ActiveTasks = $null
  }
}
