$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$stopFile = Join-Path $runtimeDir 'service.stop'
$targets = @(
  @{ Name = 'keeper'; Marker = (Join-Path $projectRoot 'scripts\service-keeper.ps1') },
  @{ Name = 'supervisor'; Marker = (Join-Path $projectRoot 'scripts\service-supervisor.mjs') },
  @{ Name = 'service'; Marker = (Join-Path $projectRoot 'dist\src\index.js') }
)

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Set-Content -LiteralPath $stopFile -Value 'stop' -Encoding ascii
$stopped = @()
foreach ($target in $targets) {
  $pidFile = Join-Path $runtimeDir "$($target.Name).pid"
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
  if ($processInfo) {
    if (-not $processInfo.CommandLine -or $processInfo.CommandLine.IndexOf($target.Marker, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      throw "PID $processId does not belong to $($target.Name); refusing to stop it."
    }
    if ($target.Name -eq 'service') {
      & taskkill.exe /PID $processId /T /F | Out-Null
    } else {
      Stop-Process -Id $processId -Force
    }
    $stopped += "$($target.Name) PID $processId"
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 300
Remove-Item -LiteralPath $stopFile -Force -ErrorAction SilentlyContinue
Write-Output $(if ($stopped.Count) { "Stopped $($stopped -join '; ')." } else { 'Service is not running.' })
