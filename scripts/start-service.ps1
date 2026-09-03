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
$keeperPath = Join-Path $projectRoot 'scripts\service-keeper.ps1'

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

foreach ($requiredPath in @($entryPath, $supervisorPath, $keeperPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required file not found: $requiredPath" }
}

$supervisorRunning = $false
if (Test-Path -LiteralPath $supervisorPidFile) {
  $supervisorId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
  $supervisor = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisorId"
  if ($supervisor -and $supervisor.CommandLine -and $supervisor.CommandLine.IndexOf($supervisorPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $supervisorRunning = $true
  } else {
    Remove-Item -LiteralPath $supervisorPidFile -Force
  }
}

$keeperProcessId = $null
if (Test-Path -LiteralPath $keeperPidFile) {
  $candidateId = [int](Get-Content -LiteralPath $keeperPidFile -Raw)
  $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $candidateId"
  if ($candidate -and $candidate.CommandLine -and $candidate.CommandLine.IndexOf($keeperPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $keeperProcessId = $candidateId
  } else {
    Remove-Item -LiteralPath $keeperPidFile -Force
  }
}

if (-not $supervisorRunning -and (Test-Path -LiteralPath $pidFile)) {
  $legacyId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $legacy = Get-CimInstance Win32_Process -Filter "ProcessId = $legacyId"
  if ($legacy -and $legacy.CommandLine -and $legacy.CommandLine.IndexOf($entryPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Stop-Process -Id $legacyId -Force
  }
  Remove-Item -LiteralPath $pidFile -Force
}

Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
if (-not $keeperProcessId) {
  $powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if (-not $powershellCommand) { $powershellCommand = Get-Command pwsh.exe -ErrorAction Stop }
  $keeper = Start-Process -FilePath $powershellCommand.Source `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$keeperPath`"") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'keeper.stdout.log') `
    -RedirectStandardError (Join-Path $logDir 'keeper.stderr.log') `
    -PassThru
  $keeperProcessId = $keeper.Id
  Set-Content -LiteralPath $keeperPidFile -Value $keeperProcessId -Encoding ascii
}

$serviceProcessId = $null
for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
  if (-not (Get-Process -Id $keeperProcessId -ErrorAction SilentlyContinue)) { throw 'Service keeper exited during startup.' }
  if (Test-Path -LiteralPath $pidFile) {
    $serviceProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
    if (Get-Process -Id $serviceProcessId -ErrorAction SilentlyContinue) { break }
  }
  Start-Sleep -Milliseconds 200
}
if (-not $serviceProcessId) { throw 'Service did not become ready.' }

$supervisorProcessId = [int](Get-Content -LiteralPath $supervisorPidFile -Raw)
Write-Output "Service keeper running (PID $keeperProcessId); supervisor running (PID $supervisorProcessId); service running (PID $serviceProcessId)."
