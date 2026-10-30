# YouTube（youtube）

| | |
|---|---|
| id / 别名 | `youtube` · `yt` |
| `item` 是 | 视频 |
| 登录 | **读取不用登录**；账号操作要导入 cookie（youtube.com 的 Cookie，要有 `SAPISID` 或 `__Secure-3PAPISID`） |

## 能做

- **读（不用登录）**：`item search` / `get` / `related` / `media` / `download`；`comment list` / `replies`；`user get` / `search` / `items`；`series list` / `items`（播放列表）；`keyword suggest`；`live get` / `search` / `history` / `listen`（直播聊天）。
- **读（要登录）**：`feed list`（首页推荐、订阅流）；`history list`；`notice list` / `count`；`user likes` / `collects`（稍后观看）/ `following`，这三个只能看自己的。
- **写（要登录）**：`item like` / `unlike` / `collect` / `uncollect`（稍后观看）；`user follow` / `unfollow`（订阅频道）；`comment add` / `delete` / `like` / `unlike`；`live send`（只发文字）；`channel create`（给账号开频道，上传、评论、直播聊天都要求有频道）。
- **自己的视频（要登录，账号要开频道）**：`item list`（数据来自 YouTube Studio）；`item publish`（发布，`--visibility public|private`，`--tag` 可重复，`--cover`，`--schedule` 定时发布）；`item delete`（需要 `-y`，2026-10-30 实测通过）。`item publish` 是部分支持（`--cover` 未验证），两者都需要本机 Chromium（见「坑」）。

## 做不到

`user update`、私信（YouTube 没有私信）、`keyword hot` 和热门流（趋势页已下线）、别人的点赞 / 订阅列表。

## 参数

- 视频：11 位 ID（如 `dQw4w9WgXcQ`），或 watch、youtu.be、shorts、live、embed 链接。直播间参数也是直播的视频 ID 或链接。
- 频道：频道 ID（`UC…`）、`@handle`（如 `@LofiGirl`）、频道链接，或 me。
- 播放列表：`PL…` 这类 ID，或带 `list=` 的链接。
- 评论：`comment list` 输出的 `id`。看回复时传根评论 ID；回复的 ID 形如「根评论 ID.回复 ID」。

## 筛选

`item search`：`--sort general|popular`（按上传时间排序已被 YouTube 下线），`--time all|day|week|month|year`，`--type all|video`。`feed list`：`--kind recommend|following`。

## 坑

- **发布与删除需要本机 Chromium**：Studio 要求网页端的 BotGuard 校验，由无头 Chromium 计算。找不到时报 `ERROR` 并给出安装方式：`npx playwright install chromium`，或 `catbus config set youtube.browser <绝对路径>`。不要用系统里的 Google Chrome。测试一律用 `--visibility private`，测完用 `item delete -y` 删掉。
- `item publish` 的 `--schedule` 要是将来的时间；过去的时间报 `USAGE`。
- `--cover` 未验证：2026-10-30 真机测试失败（封面字段报错）。自定义封面可能需要已验证的账号，没有证实。要用封面时先在 studio.youtube.com 确认账号能设置自定义封面。
- 未验证账号每天的上传数有限，超了会报 `RISK_CONTROL`（`detail.kind` 为 `rate_limit`）。测试别连续发。
- 国内网络需要代理（`catbus config set youtube.proxy <url>`），没配时请求超时报 `NETWORK`。
- 媒体地址走不带登录的 VISIONOS 客户端：同一出口 IP 请求多了会报 `RISK_CONTROL`（YouTube 要人机验证），过一段时间再试，不要连续重试。年龄限制、会员专享视频拿不到。下载得到视频轨、音频轨两个文件。
- 没有开频道的 Google 账号：`user get me` 报错，不能发评论；点赞、订阅、稍后观看可以用。
- 列表里的 `created_at` 是由「3 days ago」推算的近似时间，要精确时间用 `item get`。
- 发评论、点赞、订阅都以用户本人的账号公开进行，执行前先把内容给用户确认。
- 多账号：`-a <name>` 选账号，`auth use <name>` 切换当前账号，`-a guest` 强制游客。

## 示例

```bash
catbus youtube item search "lofi hip hop" --sort popular --limit 20
catbus youtube item get dQw4w9WgXcQ
catbus youtube comment list dQw4w9WgXcQ --limit 100 -o jsonl
catbus youtube user items @LofiGirl --limit 60
catbus youtube live listen <直播视频 ID> --duration 10m
catbus youtube feed list --kind following -a default
```
