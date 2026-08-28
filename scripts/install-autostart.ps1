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
$startScript = Join-Path $projectRoot 'scripts\start-service.ps1'
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

try {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description '当前用户登录后启动企业微信智能机器人 Agent 路由服务' `
    -Force `
    -ErrorAction Stop | Out-Null

  Write-Output "Scheduled task installed: $taskName"
} catch {
  Write-Warning 'Scheduled task registration was unavailable; using the current user Startup folder.'
  $startupDirectory = [Environment]::GetFolderPath('Startup')
  $shortcutPath = Join-Path $startupDirectory "$taskName.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($powershellCommand) {
    $shortcut.TargetPath = $powershellCommand.Source
  } else {
    $shortcut.TargetPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
  }
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.WindowStyle = 7
  $shortcut.Description = '启动企业微信智能机器人 Agent 路由服务'
  $shortcut.Save()
  Write-Output "Startup shortcut installed: $shortcutPath"
}
