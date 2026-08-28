# macOS 部署

## 1. 准备环境

需要 Node.js 20.12+、Git 和已登录的 Codex CLI。

Codex CLI 官方安装方式：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login
codex login status
```

重新打开 Terminal，确认 `codex --version` 可用。

## 2. 安装工程

```bash
git clone https://github.com/flyman008/wecom-codex-bridge.git
cd wecom-codex-bridge
npm ci
npm run check
```

`@wecom/cli` 已作为项目依赖安装，不依赖全局 PATH。

## 3. 企微文档授权

```bash
npx wecom-cli auth init
npx wecom-cli auth show --status
```

成功结果必须为 `authorized`。

## 4. 由安装人配置

```bash
npm run setup
```

向导要求安装人选择人设、消息路由、Codex 模型策略、目录权限、会话方式和是否自启动。密钥输入不会回显，结果只保存到被 Git 忽略的本机配置中。

## 5. 启动和验收

```bash
npm run build
./scripts/start-service.sh
./scripts/status-service.sh
npm run doctor
```

然后在企微中发送普通消息进行对话，再发送一个 CSV 并要求生成企微在线表格。

## 6. 修改自启动选择

```bash
npm run autostart:apply
```

命令根据 `.env` 中由安装人设置的 `SERVICE_AUTOSTART=true/false` 安装或移除用户级 LaunchAgent。它不会创建系统级守护进程，也不要求管理员权限。

移除自启动并停止该服务：

```bash
./scripts/uninstall-autostart.sh
```
