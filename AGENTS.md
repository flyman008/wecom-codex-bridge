# Codex 部署说明

本仓库用于部署“企业微信智能机器人 → 本机 Codex”长连接桥接服务。用户要求部署、安装、配置或排障时，按本文执行。

## 不可违反的规则

- 不读取、输出、提交或记录 `.env` 中的密钥。
- 不把 `.env`、`.runtime/`、`logs/`、`dist/`、`node_modules/` 加入 Git。
- 默认只授权仓库目录；只有用户明确授权后，才能填写 `CODEX_ADDITIONAL_DIRS`。
- 不修改用户正在运行的旧服务目录。部署必须在当前克隆仓库内完成。
- 不创建 GitHub 远程仓库、不推送代码，除非用户明确要求。
- 遇到登录、扫码、Bot Secret 等必须由用户完成的步骤时，说明当前阻塞点并等待，不猜测凭证。

## 部署终态

只有同时满足以下条件才可报告完成：

1. Node.js 版本不低于 20.12。
2. `npm ci`、`npm run check` 成功。
3. Codex CLI 已安装且 `codex login status` 成功。
4. `wecom-cli auth show --status` 返回 `authorized`。
5. `.env` 已配置 Bot ID、Secret、Codex 工作目录，且没有真实密钥进入 Git。
6. 安装人已亲自确认路由方式、人设、Codex 模型策略、上下文策略、目录权限和自启动选择；代理不得代选。
7. 服务启动后 `npm run doctor` 全部通过，健康检查显示企微连接为 `ok`。
8. `SERVICE_AUTOSTART=true` 时已安装自启动项；为 `false` 时确认没有遗留自启动项。

## 操作步骤

### 1. 判断操作系统

- Windows：使用 `scripts/*.ps1`。
- macOS：使用 `scripts/*.sh`；不要要求安装 PowerShell。
- 其他系统：只支持前台运行，不安装自启动项。

### 2. 检查基础环境

- 检查 `node --version`、`npm --version`、`codex --version`。
- macOS 如缺少 Codex CLI，优先使用官方安装器：`curl -fsSL https://chatgpt.com/codex/install.sh | sh`。
- Codex 登录由用户完成；不要代替用户输入账号凭证。

### 3. 安装并检查工程

```bash
npm ci
npm run check
```

项目已固定依赖 `@wecom/cli`，无需依赖全局安装的企微 CLI。

### 4. 由安装人创建本地配置

- 不直接复制作者的 `.env` 或人设文件，也不要把示例值当作用户选择。
- 让安装人在交互式终端运行 `npm run setup`。
- 必须由安装人选择：路由模式、人设、偏题提醒、Codex 首选与备用模型、推理强度、速度、工作目录、附加目录、文件权限、会话是否持久以及是否自启动。
- 模型相关项目可以留空以继承安装人自己的 Codex 配置；不要擅自填入仓库作者曾使用的模型。
- Bot Secret 和 API Key 应由安装人在不回显的向导输入框中填写，不要求其粘贴到聊天。
- 向导只生成本机 `.env` 与 `.runtime/router-agent.profile.json`。

### 5. 完成企微 CLI 授权

```bash
npx wecom-cli auth init
npx wecom-cli auth show --status
```

授权过程需要用户在企业微信侧操作。授权成功结果必须是 `authorized`。

### 6. 启动与验收

Windows：

```powershell
.\scripts\start-service.ps1
.\scripts\status-service.ps1
```

macOS：

```bash
./scripts/start-service.sh
./scripts/status-service.sh
```

随后运行：

```bash
npm run doctor
```

最后请用户在企微中发送一条普通消息，再发送一个 CSV 并要求生成企微在线表格。

### 7. 应用安装人的自启动选择

向导已立即应用时只需核验；尚未应用时运行：

```bash
npm run autostart:apply
```

该命令根据 `SERVICE_AUTOSTART=true/false` 安装或移除当前系统的自启动项。不要把 `false` 擅自改成 `true`。

## 排障顺序

1. `npm run doctor`
2. 查看 `logs/service.stderr.log`，不得把其中可能出现的敏感内容复制到公开位置。
3. 检查 Codex 登录和模型可用性。
4. 检查企微 CLI 授权。
5. 检查 `.env` 的工作目录和授权目录是否真实存在。
6. 检查企微机器人是否处于 API 长连接模式。
