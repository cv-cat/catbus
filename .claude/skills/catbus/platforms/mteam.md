# M-Team（web 端）

| | |
|---|---|
| id / 别名 | `mteam` / `mt` `m-team` `mantou` |
| `item` 是 | 种子资源 |
| 登录 | 官方 API Key（`apikey`，默认）；或网页账密（`--method password`，新设备需要邮箱验证码或 TOTP 两步验证） |

## 能做

- `user get`：当前用户资料，只支持 me。
- `user collects`：收藏列表，只支持 me，按分区（`--mode`）。
- `feed list`：浏览最新资源。
- `item search`、`get`、`categories`、`download`：搜索、详情、分类、下载 `.torrent` 文件（`--qbit` 推送到本机 qBittorrent）。
- `item collect`、`uncollect`：收藏 / 取消收藏。
- `seed list`：我的做种 / 下载中 / 已完成 / 未完成 / 已发布列表（`--status`）。
- `seed stats`：tracker 上当前的做种数和下载数。
- `exam get`：进行中的考核（新人考核）进度：下载量、上传量、魔力值的当前值、目标和是否达标。
- `bonus get`：时魔（每小时魔力值、A 值、计入的做种数和体积）。
- `bonus history`：魔力值、上传量、下载量的变动记录。note 已去掉 IP 等站点标记，url 是相关种子的详情页。
- `msg list`、`history`：站内信列表（`--box inbox|system|sent`）、读取一条站内信；只支持账密登录。

## 做不到

- 发布资源、评论、签到、上传；发送、删除站内信。
- 查询其他用户资料；app / pc 端尚未实现。

## 坑

- API Key 在 MT 的“控制台 → 实验室 → 存取令牌”生成。让用户在本地隐藏输入或提供凭证文件路径，不要要求粘贴 Key，不读出或打印保存的令牌。
- 账密登录在新设备上会返回两步验证（邮箱方式）。非 TTY 下分两次执行：第一次带 `--email <绑定邮箱>`，站点把验证码发到邮箱；第二次带 `--code <验证码>`，两次都从 stdin 读密码。中间态 10 分钟有效。密码只从 stdin 读，不要放进命令行参数。
- 登录令牌约 30 天有效，过期后报 `AUTH_EXPIRED`，按上面的流程重新登录。
- 站内信只认账密登录的令牌，API Key 会话调用报 `UNSUPPORTED`。`msg history` 不会把站内信标记为已读。
- 搜索 / 浏览支持 `--mode normal|movie|tvshow|music|anime|adult`、`--category <ID>`、`--free`，私有选项 `--order-by date|size|seeders|leechers|name`（默认降序，`--asc` 升序；站点置顶的资源总在最前）。
- 资源返回 `Torrent`，含大小、文件数、做种人数、下载人数、完成人次和优惠信息。分页沿用 `--limit` / `--all` / `--cursor`。
- 下载的种子文件含个人 Tracker passkey：不展示、转发或上传种子文件。临时下载地址不会写入 JSON 或日志。`--qbit` 时输出为 `{id files qbit}`，`qbit.status` 为 `added` 或 `exists`（已在任务列表，仍算成功）；推送失败时报错（`NETWORK` / `ERROR` / `UPSTREAM`），`error.detail.qbit` 为 `failed`、`detail.files` 是已保存的种子文件，不要重新下载。
- 下载大文件或非免费种前，先把大小、优惠和做种人数告诉用户；下载会影响分享率和新人考核。
- 遇到风控或令牌失效时读错误提示，让用户处理后重试。站点限流（「請求過於頻繁」）时放慢速度，命令间隔 3 秒以上。

## 示例

```bash
# 账密登录（两步）
printf '%s' "$MT_PASSWORD" | catbus mteam auth login --method password --username <用户名> --password-stdin --email <绑定邮箱>
printf '%s' "$MT_PASSWORD" | catbus mteam auth login --method password --username <用户名> --password-stdin --code <邮箱验证码>
catbus mteam auth login --api-key-file /私有目录/mteam-key.txt -a key
catbus mteam feed list --free --limit 5
catbus mteam item search 纪录片 --free --limit 20
catbus mteam item get https://kp.m-team.cc/detail/12345
catbus mteam item download 12345 --dir ./torrents --qbit
catbus mteam seed list --status seeding
catbus mteam exam get
catbus mteam bonus get
catbus mteam msg list --box system
```
