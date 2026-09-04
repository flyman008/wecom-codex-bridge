$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.runtime\service.pid'
$supervisorPidFile = Join-Path $projectRoot '.runtime\supervisor.pid'
$keeperPidFile = Join-Path $projectRoot '.runtime\keeper.pid'
$stateFile = Join-Path $projectRoot '.runtime\supervisor-state.json'
$stopFile = Join-Path $projectRoot '.runtime\service.stop'
$expectedEntry = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\src\index.js'))
$expectedSupervisor = [IO.Path]::GetFullPath((Join-Path $projectRoot 'scripts\service-supervisor.mjs'))
$expectedKeeper = [IO.Path]::GetFullPath((Join-Path $projectRoot 'scripts\service-keeper.mjs'))

Set-Content -LiteralPath $stopFile -Value 'stop' -Encoding ascii

$stopped = @()

if (Test-Path -LiteralPath $keeperPidFile) {
  $keeperProcessId = [int](Get-Content -LiteralPath $keeperPidFile -Raw)
  $keeperInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $keeperProcessId"
  if ($keeperInfo) {
    if (
      -not $keeperInfo.CommandLine -or
      $keeperInfo.CommandLine.IndexOf($expectedKeeper, [StringComparison]::OrdinalIgnoreCase) -lt 0
    ) {
      throw "PID $keeperProcessId does not belong to this keeper; refusing to stop it."
    }
    Stop-Process -Id $keeperProcessId -Force
    $stopped += "keeper PID $keeperProcessId"
  }
}

if (Test-Path -LiteralPath $supervisorPidFile) {
  $supervisorProcessId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
  $supervisorInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorProcessId"
  if ($supervisorInfo) {
    if (
      -not $supervisorInfo.CommandLine -or
      $supervisorInfo.CommandLine.IndexOf($expectedSupervisor, [StringComparison]::OrdinalIgnoreCase) -lt 0
    ) {
      throw "PID $supervisorProcessId does not belong to this supervisor; refusing to stop it."
    }
    Stop-Process -Id $supervisorProcessId -Force
    $stopped += "supervisor PID $supervisorProcessId"
  }
}

if (Test-Path -LiteralPath $pidFile) {
  $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceProcessId"
  if ($processInfo) {
    if (
      -not $processInfo.CommandLine -or
      $processInfo.CommandLine.IndexOf($expectedEntry, [StringComparison]::OrdinalIgnoreCase) -lt 0
    ) {
      throw "PID $serviceProcessId does not belong to this service; refusing to stop it."
    }
    & taskkill.exe /PID $serviceProcessId /T /F | Out-Null
    $stopped += "service PID $serviceProcessId"
  }
}

Remove-Item -LiteralPath $pidFile,$supervisorPidFile,$keeperPidFile -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

if ($stopped.Count) {
  Write-Output "Stopped $($stopped -join '; ')."
} else {
  Write-Output 'Service is not running.'
}
