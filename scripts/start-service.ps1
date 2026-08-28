$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$logDir = Join-Path $projectRoot 'logs'
$pidFile = Join-Path $runtimeDir 'service.pid'
$entryPath = Join-Path $projectRoot 'dist\src\index.js'

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Test-Path -LiteralPath $pidFile) {
  $existingProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
  if (Get-Process -Id $existingProcessId -ErrorAction SilentlyContinue) {
    Write-Output "Service is already running (PID $existingProcessId)."
    exit 0
  }
  Remove-Item -LiteralPath $pidFile -Force
}

if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "Build output not found: $entryPath"
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$stdoutPath = Join-Path $logDir 'service.stdout.log'
$stderrPath = Join-Path $logDir 'service.stderr.log'
$process = Start-Process -FilePath $nodePath `
  -ArgumentList @($entryPath) `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
Write-Output "Service started (PID $($process.Id))."
