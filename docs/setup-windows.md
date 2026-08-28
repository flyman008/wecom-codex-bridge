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
git clone <repository-url>
Set-Location .\wecom-codex-bridge
npm ci
npm run check
```

## 3. 企微文档授权

```powershell
npx wecom-cli auth init
npx wecom-cli auth show --status
```

## 4. 由安装人配置

在交互式 PowerShell 或 Codex 可见终端中运行：

```powershell
npm run setup
```

安装人需要选择人设、消息路由、Codex 模型策略、目录权限、会话方式和是否自启动。密钥输入不会回显，结果只保存到被 Git 忽略的本机配置中。

## 5. 启动和验收

```powershell
npm run build
.\scripts\start-service.ps1
.\scripts\status-service.ps1
npm run doctor
```

然后在企微中发送普通消息和一个 CSV 转企微在线表格任务。

## 6. 修改自启动选择

```powershell
npm run autostart:apply
```

命令根据 `.env` 中由安装人设置的 `SERVICE_AUTOSTART=true/false` 安装或移除自启动项。安装时优先使用当前用户计划任务，权限策略不允许时回退到启动目录快捷方式。
