$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$logDir = Join-Path $projectRoot 'logs'
$keeperPidFile = Join-Path $runtimeDir 'keeper.pid'
$supervisorPidFile = Join-Path $runtimeDir 'supervisor.pid'
$servicePidFile = Join-Path $runtimeDir 'service.pid'
$stopFile = Join-Path $runtimeDir 'service.stop'
$supervisorPath = Join-Path $projectRoot 'scripts\service-supervisor.mjs'
$entryPath = Join-Path $projectRoot 'dist\src\index.js'
$keeperLogPath = Join-Path $logDir 'keeper.log'
$supervisorStdoutPath = Join-Path $logDir 'supervisor.stdout.log'
$supervisorStderrPath = Join-Path $logDir 'supervisor.stderr.log'
$nodePath = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Get-ExpectedProcess([string]$pidFile, [string]$commandMarker) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
  if ($processInfo -and $processInfo.CommandLine -and $processInfo.CommandLine.IndexOf($commandMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    return $processInfo
  }
  return $null
}

function Write-KeeperLog([string]$message) {
  $record = [ordered]@{ time = [DateTime]::UtcNow.ToString('o'); message = $message; keeperPid = $PID }
  Add-Content -LiteralPath $keeperLogPath -Value ($record | ConvertTo-Json -Compress) -Encoding utf8
}

$existingKeeper = Get-ExpectedProcess $keeperPidFile $PSCommandPath
if ($existingKeeper -and $existingKeeper.ProcessId -ne $PID) { exit 0 }
Set-Content -LiteralPath $keeperPidFile -Value $PID -Encoding ascii
Write-KeeperLog 'Keeper started'

try {
  while (-not (Test-Path -LiteralPath $stopFile)) {
    try {
      $supervisor = Get-ExpectedProcess $supervisorPidFile $supervisorPath
      if (-not $supervisor) {
        $orphanedService = Get-ExpectedProcess $servicePidFile $entryPath
        if ($orphanedService) {
          & taskkill.exe /PID $orphanedService.ProcessId /T /F | Out-Null
          Remove-Item -LiteralPath $servicePidFile -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $supervisorPidFile -Force -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath $nodePath `
          -ArgumentList @("`"$supervisorPath`"") `
          -WorkingDirectory $projectRoot `
          -WindowStyle Hidden `
          -RedirectStandardOutput $supervisorStdoutPath `
          -RedirectStandardError $supervisorStderrPath `
          -PassThru
        Set-Content -LiteralPath $supervisorPidFile -Value $process.Id -Encoding ascii
        Write-KeeperLog "Supervisor started: $($process.Id)"
      }
    } catch {
      Write-KeeperLog "Keeper check failed: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 15
  }
} finally {
  if (Test-Path -LiteralPath $keeperPidFile) {
    $ownedPid = [int](Get-Content -LiteralPath $keeperPidFile -Raw)
    if ($ownedPid -eq $PID) { Remove-Item -LiteralPath $keeperPidFile -Force -ErrorAction SilentlyContinue }
  }
  Write-KeeperLog 'Keeper stopped'
}
