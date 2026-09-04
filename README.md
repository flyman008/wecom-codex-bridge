# 自建企微 Codex 桥接服务

基于企业微信官方 Node.js 长连接 SDK 的本地常驻服务。企业微信消息直接进入使用者已登录的 Codex CLI。它依赖 Codex 提供的模型能力和有效账号；使用者可以通过 ChatGPT 账号或 OpenAI API Key 登录 Codex，但不需要再部署第二套模型服务或路由模型。使用者可以选择人设、Codex 模型策略、会话方式、目录权限和是否登录后自动启动。支持 Windows 10/11 和 macOS。

如果准备让 Codex 帮你部署，克隆仓库后直接说：

> 按照 AGENTS.md 帮我完成企微机器人桥接服务的部署和验收。

Codex 会按操作系统选择脚本，并只在登录、扫码和填写本地密钥时请求人工处理。

## 快速开始

```bash
git clone https://github.com/flyman008/wecom-codex-bridge.git
cd wecom-codex-bridge
npm ci
npm run check
npm run setup
```

也可以克隆后直接让 Codex 按照仓库根目录的 `AGENTS.md` 完成部署和验收。

## 当前能力

- 企业微信 WebSocket 长连接、自动认证、心跳和断线重连。
- 所有文字对话直接进入 Codex；Codex 是唯一的模型依赖。
- 对话人设由首次安装生成的 `.runtime/persona-profile.json` 管理。
- 群聊按发送人隔离会话；个人偏好可以跨群使用，群内最近对话不会串到其他群或其他人。
- 可选择让同一企微会话持续使用同一个 Codex 会话，自然保留上下文。
- 文本、语音转写、单图、多图图文混排和文件附件接入；图片会下载解密后作为 Codex 附件处理。
- 文件下载使用企微官方 SDK 解密，暂存 15 分钟，成功转换后自动清理。
- 流式内容节流、最终结束、超时转后台及完成后主动通知。
- 持久会话异常断流时自动切换到新会话继续当前请求，避免超大上下文反复失败。
- 消息去重，同一发送人最多三个并发任务。
- Codex 固定主工作目录，可配置多个附加目录，并使用 `workspace-write` / `read-only` 沙箱。
- 仅监听本机回环地址的健康检查。
- 日志不记录消息正文、内部人员标识、会话标识或凭证。

## 架构

```text
企业微信官方 SDK
  → 消息标准化与去重
  → 本地规则识别明确的企微文档转换要求
  → 对话人设与“发送人 + 单聊/群聊”会话隔离
  → Codex CLI
  → 流式回复或主动通知
```

官方 SDK 只承担企微连接与消息收发。本项目负责会话隔离、任务状态、文件暂存和 Codex 调用。

## 环境要求

- Windows 10/11 或当前受支持的 macOS
- Node.js 20.12 或更高版本
- 已安装并登录 Codex CLI（可使用 ChatGPT 账号或 OpenAI API Key，见 [Codex 官方身份验证说明](https://developers.openai.com/codex/auth)）
- 企业微信智能机器人已切换到 API 长连接模式

## 首次安装配置

安装依赖并通过测试后，运行跨平台配置向导：

```bash
npm ci
npm run check
npm run setup
```

向导会让使用者逐项选择，不携带任何发布者的个人偏好：

- 专业、温和或完全自定义的机器人人设；
- 是否启用连续偏离工作话题提醒，以及提醒阈值和文案；
- Codex 首选模型、额度降级模型、推理强度和 Fast 策略；这些项目均可留空并继承使用者自己的 Codex 配置；
- Codex 工作目录、附加授权目录、只读或可写沙箱；
- 同一企微会话是否保持一个持续的 Codex 上下文；
- 持久会话达到 160000 输入 Token 时自动生成交接摘要并换新会话，阈值可通过 `CODEX_SESSION_MAX_INPUT_TOKENS` 调整；
- Codex 网络或上游流临时中断时，默认使用同一模型自动续跑两次，可通过 `CODEX_TRANSIENT_RETRIES` 调整；
- 是否在当前用户登录后自动启动服务，并可立即应用选择；

结果只写入被 Git 忽略的 `.env` 和 `.runtime/persona-profile.json`。`.env.example` 与 `persona-profile.example.json` 只是中性字段示例，不代表推荐策略。详细解释见 [安装配置项](docs/configuration.md)。

Codex 登录默认由 `codex login` 管理，不写入本项目的 `.env`。不要把 `.env` 提交到 Git，也不要在日志或聊天中输出凭证。默认不要配置整块磁盘到 `CODEX_ADDITIONAL_DIRS`；只添加用户明确授权的目录。

## 运行

```bash
npm ci
npm run check
npm start
```

Windows 常驻运行：

```powershell
.\scripts\start-service.ps1
.\scripts\status-service.ps1
.\scripts\stop-service.ps1
```

Windows 启动后使用双向保活：监督进程负责重启业务服务并补回意外退出的保活进程；保活进程同时检查监督进程、业务进程和健康接口，异常连续出现时重建整条服务链。

macOS 常驻运行：

```bash
./scripts/start-service.sh
./scripts/status-service.sh
./scripts/stop-service.sh
```

使用者可在 `npm run setup` 中选择是否自动启动。以后修改 `.env` 中的 `SERVICE_AUTOSTART` 后，可统一应用：

```bash
npm run autostart:apply
```

Windows 使用计划任务或启动目录，macOS 使用用户级 LaunchAgent；两者都会复用当前用户的 Codex 登录态。也可以直接使用对应系统脚本：

```powershell
.\scripts\install-autostart.ps1
```

```bash
./scripts/install-autostart.sh
```

开发时可以使用：

```bash
npm run dev
```

统一诊断：

```bash
npm run doctor
```

本地健康检查：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8787/health'
```

macOS 可使用：

```bash
curl http://127.0.0.1:8787/health
```

更完整的步骤见 [Windows 部署](docs/setup-windows.md) 和 [macOS 部署](docs/setup-macos.md)。

## 企微使用方式

直接发送自然语言即可，不需要命令前缀。

文件生成企微在线内容：

1. 在企微中发送一个文档文件，并发送“生成企微在线文档”；
2. 两条消息先后顺序不限，系统会在 15 分钟内自动匹配；
3. CSV / XLS / XLSX 会生成企微普通在线表格；DOC / DOCX / TXT 会生成企微普通在线文档；其他格式按内容转换后再导入。

也可以引用文件消息并发送“生成企微在线文档”。支持 HTML、Markdown、TXT、Word、PDF、PPT、Excel、CSV、JSON、XML 及部分常见国产办公格式；复杂排版和旧版二进制格式属于尽力转换。

## 当前边界

- 转换要求和去重状态只保存在内存中；未过期的暂存附件可在服务重启后按会话恢复。
- 持久 Codex 会话映射仅保存哈希会话键与 Codex thread ID，原始人员和群聊标识不会写入文件。
- 图片和视频暂不交给 Codex；支持的文件可作为当前 Codex 对话资料，只有用户明确要求时才生成企微在线文档或表格。
- 自启动使用当前用户启动项，以便复用该用户的 Codex CLI 登录态。
- macOS 的 LaunchAgent 与 Windows 计划任务实现不同，但业务链路和会话数据格式一致。
- 所有文字任务进入 Codex；明确的企微文档转换要求由本地规则识别，不调用额外模型。
- 未使用危险的 Codex 无沙箱参数；需要更高权限的任务必须在本机人工执行。

## 仓库文档

- [部署代理说明](AGENTS.md)：给使用者的 Codex 读取。
- [安装配置项](docs/configuration.md)：哪些决策由使用者选择。
- [最终架构](docs/architecture.md)：消息、会话、模型与文件链路。
- [安全边界](docs/security.md)：密钥、目录权限、日志和发布检查。
- [Windows 部署](docs/setup-windows.md)
- [macOS 部署](docs/setup-macos.md)

## License

[MIT](LICENSE)
