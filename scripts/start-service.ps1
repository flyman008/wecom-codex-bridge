$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$logDir = Join-Path $projectRoot 'logs'
$pidFile = Join-Path $runtimeDir 'service.pid'
$keeperPidFile = Join-Path $runtimeDir 'keeper.pid'
$supervisorPidFile = Join-Path $runtimeDir 'supervisor.pid'
$stopFile = Join-Path $runtimeDir 'service.stop'
$entryPath = Join-Path $projectRoot 'dist\src\index.js'
$supervisorPath = Join-Path $projectRoot 'scripts\service-supervisor.mjs'
$keeperPath = Join-Path $projectRoot 'scripts\service-keeper.mjs'
$nodePath = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "Build output not found: $entryPath"
}
if (-not (Test-Path -LiteralPath $supervisorPath)) {
  throw "Supervisor script not found: $supervisorPath"
}
if (-not (Test-Path -LiteralPath $keeperPath)) {
  throw "Keeper script not found: $keeperPath"
}

$supervisorRunning = $false
if (Test-Path -LiteralPath $supervisorPidFile) {
  $existingSupervisorId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
  $existingSupervisor = Get-CimInstance Win32_Process -Filter "ProcessId = $existingSupervisorId"
  if (
    $existingSupervisor -and
    $existingSupervisor.CommandLine -and
    $existingSupervisor.CommandLine.IndexOf($supervisorPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  ) {
    $supervisorRunning = $true
  } else {
    Remove-Item -LiteralPath $supervisorPidFile -Force
  }
}

$keeperProcess = $null
$keeperProcessId = $null
if (Test-Path -LiteralPath $keeperPidFile) {
  $existingKeeperId = [int](Get-Content -LiteralPath $keeperPidFile -Raw)
  $existingKeeper = Get-CimInstance Win32_Process -Filter "ProcessId = $existingKeeperId"
  if (
    $existingKeeper -and
    $existingKeeper.CommandLine -and
    $existingKeeper.CommandLine.IndexOf($keeperPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  ) {
    $keeperProcess = $existingKeeper
    $keeperProcessId = $existingKeeperId
  } else {
    Remove-Item -LiteralPath $keeperPidFile -Force
  }
}

# Clean up a legacy directly-started service before switching to the supervisor.
if (-not $supervisorRunning -and (Test-Path -LiteralPath $pidFile)) {
  $legacyProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $legacyProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $legacyProcessId"
  if (
    $legacyProcess -and
    $legacyProcess.CommandLine -and
    $legacyProcess.CommandLine.IndexOf($entryPath, [StringComparison]::OrdinalIgnoreCase) -ge 0
  ) {
    Stop-Process -Id $legacyProcessId -Force
  }
  Remove-Item -LiteralPath $pidFile -Force
}

Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue

if (-not $keeperProcess) {
  $keeperStdoutPath = Join-Path $logDir 'keeper.stdout.log'
  $keeperStderrPath = Join-Path $logDir 'keeper.stderr.log'
  $keeperProcess = Start-Process -FilePath $nodePath `
    -ArgumentList @("`"$keeperPath`"") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $keeperStdoutPath `
    -RedirectStandardError $keeperStderrPath `
    -PassThru
  Set-Content -LiteralPath $keeperPidFile -Value $keeperProcess.Id -Encoding ascii
  $keeperProcessId = $keeperProcess.Id
}

$serviceProcessId = $null
for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
  if (-not (Get-Process -Id $keeperProcessId -ErrorAction SilentlyContinue)) {
    $errorText = Get-Content -LiteralPath $keeperStderrPath -Raw -ErrorAction SilentlyContinue
    throw "Service keeper exited during startup. $errorText"
  }
  if (Test-Path -LiteralPath $pidFile) {
    $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
    if (Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue) { break }
  }
  Start-Sleep -Milliseconds 200
}

if (-not $serviceProcessId) {
  throw 'Service supervisor started, but the service process did not become ready.'
}

$supervisorProcessId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
Write-Output "Service keeper running (PID $keeperProcessId); supervisor running (PID $supervisorProcessId); service running (PID $serviceProcessId)."
