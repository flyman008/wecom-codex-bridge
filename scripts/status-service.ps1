$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'

function Read-ProcessState([string]$name) {
  $path = Join-Path $runtimeDir "$name.pid"
  if (-not (Test-Path -LiteralPath $path)) { return @($false, $null) }
  $processId = [int](Get-Content -LiteralPath $path -Raw)
  return @([bool](Get-Process -Id $processId -ErrorAction SilentlyContinue), $processId)
}

$keeper = Read-ProcessState 'keeper'
$supervisor = Read-ProcessState 'supervisor'
$service = Read-ProcessState 'service'
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3
  $connection = $health.status
  $activeTasks = $health.activeTasks
} catch {
  $connection = 'unavailable'
  $activeTasks = $null
}

[pscustomobject]@{
  KeeperRunning = $keeper[0]
  KeeperId = $keeper[1]
  SupervisorRunning = $supervisor[0]
  SupervisorId = $supervisor[1]
  ProcessRunning = $service[0]
  ProcessId = $service[1]
  Connection = $connection
  ActiveTasks = $activeTasks
}
