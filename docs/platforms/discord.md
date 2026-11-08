# Discord

Discord 的 macOS 桌面适配位于 `src/platforms/discord/pc/`，通过 `catbus discord` 使用。默认端为 `pc`，Catbus WebUI 同样默认选中「macOS 桌面端」。`web` 与 `app` 暂未实现。升级时，若 `pc` 的凭证目录还不存在，Catbus 会将旧版 `web` 目录连同当前账号一起迁入 `pc`。平台采用 Catbus 的账号存储、代理配置、确认机制和 JSON 输出。常规命令使用 Catbus 的 Node.js 环境。浏览器验证使用本机已安装的浏览器。

```bash
catbus discord auth login
catbus discord user get
catbus discord guild list
catbus discord channel list <服务器ID>
catbus discord msg history <频道ID> --limit 50
catbus discord msg send "你好" --conversation <频道ID>
catbus discord msg send "附件" --conversation <频道ID> --file ./report.txt
catbus discord msg listen --conversation <频道ID> --duration 30s
catbus discord gateway listen --events MESSAGE_CREATE --duration 30s
```

默认登录方式为扫码，由 Discord 手机端确认。`--method password --username <名称> --password-stdin` 支持账密登录及 TOTP / 短信 MFA。非交互场景用 `--code` 提供已收到的验证码。已有 Authorization 凭证可用 `--method token --token-file <文件>` 或 `--token-stdin` 导入。Bot 凭证保留 `Bot ` 前缀，`--intents` 适用于 Bot 网关连接。

频道、消息、反应、好友和附件命令见 `catbus discord --help` 与 [能力矩阵](../capabilities.md)。`msg send --to` 创建单人私信会话，`--reply-to` 提交回复引用。`msg read` 通过 `--message` 指定最后已读消息。批量删除、清除反应和退出服务器遵守 Catbus 的确认机制。附件下载支持 `--dir` 和 `--overwrite`。

账密登录或添加好友遇到 hCaptcha 时，Catbus 打开本机一次性页面。你在官方组件完成验证，原命令继续执行。非交互式调用可加 `--captcha` 启用流程。取消、超时或 Discord 拒绝提交会返回 `RISK_CONTROL`。

使用通行密钥或实体安全密钥时运行以下命令。Discord 只提供 WebAuthn 时，Catbus 也会自动选择它。

```bash
catbus discord auth login --method password --username <邮箱或用户名> --password-stdin --mfa-method webauthn
```

在弹出的 Chromium 窗口点击验证，再按系统提示确认。Catbus 优先读取 `discord.browser` 或 `CATBUS_DISCORD_BROWSER`，也会查找本机 Chrome、Chromium 和 Playwright Chromium。临时窗口使用浏览器和系统实际提供的验证器。用独立 Chrome 用户资料同步的通行密钥可能需要改用系统通行密钥或实体安全密钥。

保存的安装 ID 用于 REST 的 `X-Installation-ID` 和用户账号的 Gateway IDENTIFY。另有 `device register`，它为当前账号生成并保存本地 `client_uuid`。原客户端在 Science 遥测中使用这个 UUID，该遥测链路尚未接入 Catbus。

Gateway 使用 JSON，包含心跳、会话恢复和重连。ETF、压缩流和原项目的 Science、Sentry 传输仍属于原项目的范围。附件 CDN 请求使用独立的必要请求头。

REST 限流按 Catbus 的 `RISK_CONTROL` 返回。流式命令可用 `--limit` 限定输出条数，或用 `--duration` 限定时长。

请求对拍从本地 `discord-cli` 使用合成凭证生成，覆盖 API URL、显式头序和载荷。扫码和 Gateway 的状态机用合成事件验证。人机验证回调经过本地 HTTP 测试，WebAuthn 在本机 Chromium 使用合成凭证验证断言签名。真实账号的只读 REST 查询已验证。登录交互、生产 Gateway 和原客户端线级一致性仍需动态对照。来源及复现命令见 [UPSTREAM](../../src/platforms/discord/UPSTREAM)。
