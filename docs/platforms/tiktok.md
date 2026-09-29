# TikTok（tiktok）

| 项 | 值 |
|---|---|
| 平台 id | `tiktok` |
| 别名 | `tt` |
| `item` 指 | 视频（也包括图文 photo） |
| 上游仓库 | [cv-cat/TiktokApis](https://github.com/cv-cat/TiktokApis) |
| 移植基线 | master 上的 [`b3b2a44`](https://github.com/cv-cat/TiktokApis/commit/b3b2a448800e4ca9e061203b9ba1f53d1d6d3082)，记录在 [`src/platforms/tiktok/UPSTREAM`](../../src/platforms/tiktok/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 55 条（✓ 47 · ◐ 8），规划中 ○ 20 条 |

命令表由注册表生成，与 `catbus platforms tiktok` 一致；选项以 `catbus tiktok <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

TikTok **只支持导入 cookie**（上游的登录接口只是占位）。有两种导入形式：

| 形式 | 命令 | 能做什么 |
|---|---|---|
| Cookie 字符串 | `catbus tiktok auth login --cookie @tiktok-cookie.txt` | 只读命令。缺的设备数据在本地补齐 |
| 浏览器会话 JSON | `catbus tiktok auth login --cookie @tiktok-session.json` | 只读命令，以及点赞、收藏、评论、关注、发布、私信、直播发言等需要 ticket-guard 的写操作 |

- Cookie 从 www.tiktok.com 的 DevTools → Network 复制完整的 Cookie 请求头，至少要有 `sessionid`、`sid_tt`、`multi_sids` 之一（这几个是 HttpOnly 的，`document.cookie` 拿不到）。
- 会话 JSON 的字段名与上游的 `.tiktok-runtime.json` 相同，必须来自**同一次**已登录的浏览器会话；写操作至少要有 `ticket_guard_private_key`、`ticket_guard_encrypt_ticket`、`ticket_guard_ts_sign`。格式见 [登录指南：TikTok](../guide/login.md#tiktok导入浏览器会话-json)。
- 只导入 Cookie 字符串时做写操作，catbus 会在本地拦下，报 `AUTH_REQUIRED`，`hint` 提示用会话 JSON 重新登录，不会发出请求。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示 TikTok 没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ◐ | 用户资料。me 部分支持。 |
| `user items` | ✓ | 用户发布的视频。 |
| `user collects` | ✓ | 用户收藏的视频。 |
| `user reposts` | ✓ | 用户转发的视频。 |
| `user followers` | ✓ | 粉丝列表。 |
| `user following` | ✓ | 关注列表。 |
| `user follow` | ✓ | 关注。 |
| `user unfollow` | ✓ | 取消关注。 |
| `user search`、`user likes` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 视频详情。 |
| `item search` | ✓ | 搜索视频。 |
| `item related` | ✓ | 相关推荐。 |
| `item list` | ✓ | 我发布的视频，带审核状态。 |
| `item media` | ◐ | 视频的媒体地址。媒体地址取自视频详情里的 `video.playAddr`（图文取 `imagePost`），上游没有单独解析。 |
| `item download` | ◐ | 下载视频的媒体。媒体地址同 `item media`。 |
| `item like` | ✓ | 点赞。 |
| `item unlike` | ✓ | 取消点赞。 |
| `item collect` | ✓ | 收藏。 |
| `item uncollect` | ✓ | 取消收藏。 |
| `item publish` | ✓ | 发布视频。`--video` 和 `--image` 二选一；视频要同时给 `--cover`。取值：`--visibility` public / private / friends。不支持 `--title`、`--poi`、`--category`、`--schedule`、`--price`。私有选项 `--allow-comment`、`--allow-duet`、`--allow-stitch`、`--allow-content-reuse`、`--allow-ai-remix`。 |
| `item repost`、`item unrepost`、`item delete` | ○ | 规划中 |

### product

| 命令 | 状态 | 说明 |
|---|---|---|
| `product get` | ✓ | 商品详情。 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ✓ | 评论列表；传商品 URL 或加 `--product` 时列出商品评价。 |
| `comment replies` | ✓ | 评论的回复。 |
| `comment add` | ✓ | 发表评论。 |
| `comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ✓ | 推荐 / 热门 / 关注流。取值：`--kind` recommend / following。 |
| `feed categories` | ○ | 规划中 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播间信息。 |
| `live list` | ✓ | 直播列表。只有关注的人里正在直播的（上游 get_webcast_feed 是直播页侧栏的关注列表）；没关注的人在播时为空。 |
| `live search` | ✓ | 搜索直播。 |
| `live categories` | ✓ | 直播分类。 |
| `live listen` | ✓ | 监听弹幕、礼物、进场等事件。持续输出 jsonl。 |
| `live history` | ◐ | 最近的弹幕。只有进房拉取（im/fetch）时带回的弹幕。 |
| `live send` | ◐ | 发弹幕，或用 `--gift` 送礼。`--gift` 规划中。送礼（`--gift`）需要确认。 |
| `live like` | ✓ | 直播间点赞。 |
| `live rank` | ✓ | 直播间排行榜。 |
| `live gifts` | ✓ | 礼物列表。 |
| `live media` | ◐ | 直播流地址。上游没有解析拉流地址：取自 /api-live/user/room 的 liveRoom.streamData，或 room/enter 的 stream_url。 |
| `live products`、`live start`、`live stop` | ○ | 规划中 |

### keyword

| 命令 | 状态 | 说明 |
|---|---|---|
| `keyword suggest` | ✓ | 搜索联想词。 |
| `keyword hot` | ○ | 规划中 |

### notice

| 命令 | 状态 | 说明 |
|---|---|---|
| `notice list` | ✓ | 通知列表。 |
| `notice count` | ✓ | 未读通知数。 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg list` | ✓ | 会话列表。 |
| `msg history` | ✓ | 会话的消息记录。 |
| `msg send` | ◐ | 发私信。只支持文本；只能发给已经有会话的用户（上游不能新建会话）。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### folder

| 命令 | 状态 | 说明 |
|---|---|---|
| `folder list` | ✓ | 收藏夹列表。 |
| `folder items` | ✓ | 收藏夹里的视频。 |
| `folder create` | ✓ | 新建收藏夹。 |
| `folder update` | ✓ | 修改收藏夹。 |
| `folder add` | ✓ | 把视频加入收藏夹（只能加已收藏的视频）。平台扩展。 |
| `folder delete` | ○ | 规划中 |

### series

| 命令 | 状态 | 说明 |
|---|---|---|
| `series list` | ✓ | 合集列表。 |
| `series items` | ○ | 规划中 |

### poi

| 命令 | 状态 | 说明 |
|---|---|---|
| `poi search` | ◐ | 搜索地点。在推荐地点里按关键词筛选。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `history` | `list` |
| `topic` | `search` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item publish` | `--allow-comment on\|off` | 允许评论，默认 `on` |
| `item publish` | `--allow-duet on\|off` | 允许合拍（Duet），默认视频 `off`、图文 `on`（照上游） |
| `item publish` | `--allow-stitch on\|off` | 允许拼接（Stitch），默认视频 `off`、图文 `on`（照上游） |
| `item publish` | `--allow-content-reuse on\|off` | 允许他人复用内容，默认 `on` |
| `item publish` | `--allow-ai-remix on\|off` | 允许 AI 改编，默认 `on` |
| `folder create <name>` | `--visibility public\|private` | 沿用标准选项 `--visibility`，只取 `public`、`private`；新建默认 `private`（与上游一致） |
| `folder update <folder>` | `--name <名字>`、`--visibility public\|private` | 至少给一个，没给的保持原值 |

| 扩展命令 | 说明 | 输出 |
|---|---|---|
| `folder add <folder> <item>` | 把视频加入收藏夹，一次一个。TikTok 只能把**已收藏**的视频加进收藏夹，先 `item collect` | `{id}`（视频 id） |

定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 视频 `<item>` | 视频页链接 `https://www.tiktok.com/@<用户名>/video/<id>`（图文是 `/photo/<id>`）、分享短链（`vt.tiktok.com`、`vm.tiktok.com`、`www.tiktok.com/t/...`），或 15–21 位的数字 ID |
| 用户 `<user>` | 用户名（`tiktok` 或 `@tiktok`）、主页链接 `https://www.tiktok.com/@<用户名>`、`secUid`（`MS4wLj` 开头）、数字 uid，或 `me` |
| 直播间 `<room>` | 主播用户名、主播主页或直播间链接（查出当前的房间号），或 10–21 位的数字房间号 |
| 商品 `<product>` | 商品 ID，或 `https://shop.tiktok.com/.../pdp/<slug>/<id>`、`/view/product/<id>` 链接 |
| 收藏夹 `<folder>` | 收藏夹 ID（`folder list` 输出的 `id`） |
| 会话 `<conversation>` | `msg list` 输出的会话 `id` |

- 只给 `secUid` 时取不到完整的用户资料（`user get` 会报 `USAGE`），请传用户名或主页链接。
- 商品评价：`comment list` 的参数是 `shop.tiktok.com` 链接时自动按商品处理；纯 ID 要加 `--product`。

## 示例

```bash
# 导入浏览器会话 JSON（写操作需要）
catbus tiktok auth login --cookie @tiktok-session.json

# 用户资料与全部视频
catbus tiktok user get @<username>
catbus tiktok user items @<username> --all -o jsonl > videos.jsonl

# 搜索视频，取 50 条
catbus tiktok item search "street food" --limit 50

# 视频详情、评论、相关推荐
catbus tiktok item get "<video_url>"
catbus tiktok comment list "<video_url>" --limit 200 -o jsonl
catbus tiktok item related "<video_url>"

# 下载视频
catbus tiktok item download "<video_url>" --dir ./tiktok

# 新建私密收藏夹，把一个已收藏的视频放进去
catbus tiktok folder create 灵感 --visibility private
catbus tiktok folder add <folder_id> "<video_url>"

# 监听直播间 10 分钟
catbus tiktok live listen @<host_username> --duration 10m > live.jsonl
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **写操作要浏览器会话 JSON**：只导入 cookie 时，点赞、收藏、评论、私信、直播发言、发布会在本地被拦下（上游同样要求 security-sdk 的 ticket-guard 数据）。这些写操作还没有用会话 JSON 做过真机验证；`folder create` 已验证可用。见 [trouble.md 6.1](../trouble.md#61-已验证平台里没测的命令)。
- **`live list` 可能为空**：它是直播页侧栏的「关注的人在播」列表，账号没关注正在直播的人时返回空数组。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
- **`folder list` 列不出刚建的私密收藏夹**：对自己也只返回 `total: 0`，可能只列公开的收藏夹，原因待查。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
- **推断的结构**：私信翻页的游标位置、`live media` 的流地址结构是按协议推断的，上游没有解析，还没真机确认。见 [trouble.md 第 10 节](../trouble.md#10-上游有catbus-漏移植的2026-09-28-审计)。
- **视频发布要给封面**：catbus 不带 ffmpeg，截不了首帧，`--video` 必须配 `--cover`，且只读 MP4。
- 私信只能发文本，而且只能发给已经有会话的用户（上游不能新建会话）。
- TikTok 的 story 和收藏夹之间移动不提供，见 [AGENTS.md 4.12](../../AGENTS.md#412-不提供的能力)。
