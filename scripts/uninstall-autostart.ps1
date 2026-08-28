$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
  $projectBytes = [Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())
  $projectHash = ([BitConverter]::ToString($sha256.ComputeHash($projectBytes))).Replace('-', '').Substring(0, 10).ToLowerInvariant()
} finally {
  $sha256.Dispose()
}
$taskName = "企微Codex桥接-$projectHash"
$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory "$taskName.lnk"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Scheduled task removed: $taskName"
}

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Output "Startup shortcut removed: $shortcutPath"
}

if (-not $task -and -not (Test-Path -LiteralPath $shortcutPath)) {
  Write-Output 'No Windows autostart item was installed.'
}
