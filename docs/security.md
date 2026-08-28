# 安全边界与发布检查

## 凭证

- Bot ID、Bot Secret、Codex 登录态和企微 CLI 授权信息只能保存在部署机器本地。
- `.env`、`.runtime/` 和 `logs/` 已加入 `.gitignore`。使用者生成的人设文件也位于 `.runtime/`，不会进入 Git。
- 仓库中的 `.env.example` 与 `persona-profile.example.json` 只包含中性空白示例，不携带任何部署者的人设、模型或自启动偏好。
- 真实凭证一旦出现在聊天、截图、日志或 Git 历史中，应先轮换再发布。
- 不提供包含真实值的示例配置。

## Codex 文件权限

- `CODEX_WORKDIR` 是主工作目录。
- `CODEX_ADDITIONAL_DIRS` 会成为可写附加目录，默认必须为空。
- 不应在可复用仓库中默认授权整块磁盘、用户主目录或其他宽泛目录。
- 服务使用 `workspace-write` 或 `read-only`，不使用绕过沙箱参数。

## 会话和日志

- 会话映射使用 SHA-256 键，不保存原始 userid/chatid。
- 日志不记录消息正文、凭证和内部标识。
- 暂存附件默认 15 分钟，成功转换后清理。
- 健康检查只监听 `127.0.0.1`。

## Git 发布前检查

```bash
git status --short
git ls-files
git grep -n -I -E 'WECOM_BOT_SECRET=.+' -- ':!*.example'
npm ci
npm run check
```

同时确认以下内容不在 Git 中：

- `.env`
- `.runtime/`
- `logs/`
- `node_modules/`
- `dist/`
- 本机绝对路径
- Bot ID、Secret、Codex 登录凭证、userid、chatid
