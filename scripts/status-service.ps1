$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime\service.pid'
$supervisorPidFile = Join-Path $projectRoot '.runtime\supervisor.pid'
$keeperPidFile = Join-Path $projectRoot '.runtime\keeper.pid'
$stateFile = Join-Path $projectRoot '.runtime\supervisor-state.json'
$expectedEntry = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\src\index.js'))
$expectedSupervisor = [IO.Path]::GetFullPath((Join-Path $projectRoot 'scripts\service-supervisor.mjs'))
$expectedKeeper = [IO.Path]::GetFullPath((Join-Path $projectRoot 'scripts\service-keeper.mjs'))
$serviceProcessId = $null
$supervisorProcessId = $null
$keeperProcessId = $null
if (Test-Path -LiteralPath $pidFile) {
  $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
}
if (Test-Path -LiteralPath $supervisorPidFile) {
  $supervisorProcessId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
}
if (Test-Path -LiteralPath $keeperPidFile) {
  $keeperProcessId = [int](Get-Content -LiteralPath $keeperPidFile -Raw)
}

$processRunning = $false
$supervisorRunning = $false
$keeperRunning = $false
if ($serviceProcessId) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceProcessId"
  $processRunning = [bool](
    $processInfo -and $processInfo.CommandLine -and
    $processInfo.CommandLine.IndexOf($expectedEntry, [StringComparison]::OrdinalIgnoreCase) -ge 0
  )
}
if ($keeperProcessId) {
  $keeperInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $keeperProcessId"
  $keeperRunning = [bool](
    $keeperInfo -and $keeperInfo.CommandLine -and
    $keeperInfo.CommandLine.IndexOf($expectedKeeper, [StringComparison]::OrdinalIgnoreCase) -ge 0
  )
}
if ($supervisorProcessId) {
  $supervisorInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorProcessId"
  $supervisorRunning = [bool](
    $supervisorInfo -and $supervisorInfo.CommandLine -and
    $supervisorInfo.CommandLine.IndexOf($expectedSupervisor, [StringComparison]::OrdinalIgnoreCase) -ge 0
  )
}

$state = $null
if (Test-Path -LiteralPath $stateFile) {
  try { $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } catch { $state = $null }
}

try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 3
  [pscustomobject]@{
    SupervisorRunning = $supervisorRunning
    SupervisorId = $supervisorProcessId
    KeeperRunning = $keeperRunning
    KeeperId = $keeperProcessId
    ProcessRunning = $processRunning
    ProcessId = $serviceProcessId
    Connection = $health.status
    ActiveTasks = $health.activeTasks
    RestartCount = $state.restartCount
    LastExit = $state.lastExit.at
  }
} catch {
  [pscustomobject]@{
    SupervisorRunning = $supervisorRunning
    SupervisorId = $supervisorProcessId
    KeeperRunning = $keeperRunning
    KeeperId = $keeperProcessId
    ProcessRunning = $processRunning
    ProcessId = $serviceProcessId
    Connection = 'unavailable'
    ActiveTasks = $null
    RestartCount = $state.restartCount
    LastExit = $state.lastExit.at
  }
}
