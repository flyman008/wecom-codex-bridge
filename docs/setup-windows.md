# Windows 部署

## 1. 准备环境

需要 Windows 10/11、Node.js 20.12+、Git、PowerShell 和已登录的 Codex CLI。

```powershell
node --version
codex --version
codex login status
```

## 2. 安装工程

```powershell
git clone https://github.com/flyman008/wecom-codex-bridge.git
Set-Location .\wecom-codex-bridge
npm ci
npm run check
```

## 3. 企微文档授权

```powershell
npx wecom-cli auth init
npx wecom-cli auth show --status
```

## 4. 由使用者配置

在交互式 PowerShell 或 Codex 可见终端中运行：

```powershell
npm run setup
```

使用者需要选择人设、Codex 模型策略、目录权限、会话方式和是否自启动。Bot Secret 输入不会回显，结果只保存到被 Git 忽略的本机配置中；Codex 是唯一的模型依赖，无需配置第二套模型服务。

## 5. 启动和验收

```powershell
npm run build
.\scripts\start-service.ps1
.\scripts\status-service.ps1
npm run doctor
```

然后在企微中发送普通消息和一个 CSV 转企微在线表格任务。

`status-service.ps1` 会分别显示保活进程、监督进程、业务进程和企微连接状态。业务进程异常退出时由监督进程重启；监督进程异常退出时由保活进程在 15 秒内重新拉起。

## 6. 修改自启动选择

```powershell
npm run autostart:apply
```

命令根据 `.env` 中由使用者设置的 `SERVICE_AUTOSTART=true/false` 安装或移除自启动项。安装时优先使用当前用户计划任务，权限策略不允许时回退到启动目录快捷方式。
