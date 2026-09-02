# 最终实现架构

## 主链路

```text
企业微信用户
  → 企微官方 WebSocket 长连接
  → 消息标准化、去重和并发限制
  → 生成“会话 + 发送人”隔离键
  → 查找持久 Codex thread
  → 使用者选择的 Codex 首选模型与推理策略
  → 额度不足时可选使用者指定的备用模型
  → 流式回复、主动通知或媒体消息
```

消息不经过独立路由模型，直接进入 Codex。明确的企微文档转换要求由本地规则识别。

## 会话隔离

- 单聊键：`single + userid`。
- 群聊键：`group + chatid + userid`。
- 持久化文件只保存 SHA-256 会话键和 Codex thread ID，不保存原始 userid/chatid。
- 同一会话串行进入同一个 Codex thread，不会每条消息创建新对话。
- 每轮记录累计输入 Token；达到配置阈值后，旧 thread 生成精简交接摘要，新 thread 携带摘要和当前请求继续处理。
- 持久 thread 因上下文过大等原因发生临时断流时，桥接服务会停止反复恢复旧 thread，切换到新 thread 继续当前请求。

## 模型链

1. `CODEX_MODEL` 由使用者指定；留空时继承其 Codex 默认模型。
2. `CODEX_FALLBACK_MODEL` 可留空；配置后仅在额度、配额或限流错误时切换。
3. `CODEX_REASONING_EFFORT` 和 `CODEX_SERVICE_TIER` 由使用者选择；留空时继承 Codex 配置。
4. Fast 只在所选模型支持时传递，避免发送无效配置。

网络失败、工具失败和业务失败不会触发模型切换，避免重复执行有副作用的任务。

单图和图文混排中的多张图片会由官方 SDK 下载解密，短暂保存到隔离任务目录并作为 Codex 附件传入；任务结束后自动清理。

## 文件链路

```text
文件消息或引用文件
  → SDK 下载并解密
  → 按会话暂存 15 分钟
  → 用户明确要求生成企微在线内容
  ├─ CSV/TSV/XLS/XLSX/ET → 普通在线表格 /sheet/
  └─ 其他支持文档 → 普通在线文档 /doc/
  → 返回链接
  → 清理暂存文件
```

CSV、XLS、XLSX 以及 DOC、DOCX、TXT 优先直接导入，减少模型等待；复杂格式由 Codex 转换后再调用企微 CLI。

## 操作系统差异

| 能力 | Windows | macOS |
| --- | --- | --- |
| Node 服务 | 相同 | 相同 |
| Codex CLI | Windows 安装方式 | 官方 macOS/Linux 安装器 |
| 企微 CLI | 项目内 Node 入口 | 项目内 Node 入口 |
| 后台进程 | PowerShell `Start-Process` | `nohup` |
| 登录后自启动 | 计划任务/启动目录 | LaunchAgent |
| 路径 | 盘符、反斜杠 | `/Users/...` |

业务协议、配置键、会话数据和测试口径保持一致。
