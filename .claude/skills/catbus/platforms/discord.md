# Discord（macOS 桌面端）

规范 id 是 `discord`，默认端是 `pc`。消息沿用 `msg` 资源，默认使用 Discord 手机端扫码登录。也可用账密或从文件与 stdin 导入 Authorization 凭证。

## 能做

- `user get`、`account settings`、`device register` 查询用户、读取账号设置、登记本地设备 ID。
- `guild list`、`guild get`、`guild leave` 管理服务器。
- `channel list`、`channel get`、`channel create`、`channel update`、`channel delete` 管理频道。
- `msg list`、`msg history`、`msg get`、`msg send`、`msg update`、`msg revoke`、`msg purge`、`msg typing`、`msg read`、`msg listen` 查询和操作消息。
- `msg pins`、`msg pin`、`msg unpin` 管理置顶。
- `reaction list`、`reaction add`、`reaction delete`、`reaction clear` 管理 Emoji 反应。
- `friend add`、`friend accept`、`friend delete`、`friend block`、`friend unblock` 管理好友请求和屏蔽。
- `attachment download` 下载附件。`gateway get` 获取网关地址。`gateway listen` 实时输出网关事件。

## 做不到

- app 和 web 端处于规划中。
- 浏览器人机验证需要用户本人操作，取消、超时或失败时返回 `RISK_CONTROL`。

## 常用参数

`msg send` 使用 `--conversation <频道 ID>` 或 `--to <用户 ID>`，可加 `--file` 或 `--reply-to`。`msg read` 要求最后已读消息的 `--message`。流式命令支持 `--duration`。删除、批量清空和退出服务器前需要确认。

## 凭证

优先使用 `catbus discord auth login`。账密登录通过 `--password-stdin` 读取密码。人机验证在一次性本机页面完成，非交互式调用可加 `--captcha`。`--mfa-method webauthn` 打开 Chromium，由用户确认通行密钥或安全密钥。已有凭证从 `--token-file` 或 `--token-stdin` 导入，由 Catbus 按端和账号管理。
