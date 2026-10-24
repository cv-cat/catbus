# YouTube（youtube）

| 项 | 值 |
|---|---|
| 平台 id | `youtube` |
| 别名 | `yt` |
| `item` 指 | 视频 |
| 上游仓库 | 无（直接对接 YouTube 网页背后的 InnerTube 接口 `/youtubei/v1/`） |
| 接口来源 | 记录在 [`src/platforms/youtube/UPSTREAM`](../../src/platforms/youtube/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 39 条（✓ 37 · ◐ 2），规划中 ○ 4 条 |

命令表与 `catbus platforms youtube` 一致；选项以 `catbus youtube <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

YouTube 不登录也能看大部分内容，所以和国内平台不同，web 端支持游客态（AGENTS.md 5.2 的特例）：搜索、视频详情、评论、频道、播放列表、直播聊天、媒体地址都不需要登录。点赞、订阅、评论、推荐流、历史、通知等账号操作需要登录。

## 登录

YouTube **只支持导入 cookie**（Google 账号登录无法自动化）：

```bash
catbus youtube auth login --cookie @youtube-cookie.txt
```

- 在浏览器登录 youtube.com，打开 DevTools → Network，选任意一个发往 `youtubei/v1/` 的请求，复制请求头里完整的 Cookie。也可以用浏览器扩展导出 youtube.com 的 cookie JSON 数组，直接传给 `--cookie`。
- 必须有 `SAPISID`（或 `__Secure-3PAPISID`），缺了报 `USAGE`。catbus 用它按网页的算法生成 `Authorization: SAPISIDHASH …` 请求头。会话 cookie（`SID`、`__Secure-3PSID` 等）大多是 HttpOnly 的，`document.cookie` 拿不到，要从请求头复制。
- 导入后调一次头像菜单接口（`account/account_menu`）校验。账号的 `user.id` 是频道 ID（`UC…`）；没有开 YouTube 频道的 Google 账号没有频道 ID，改用 Google 账号 ID。
- `auth status` 的 `expires_at` 取自 `__Secure-3PSID`（或 `SID`）的过期时间。
- 导出 cookie 后不要在那个浏览器里退出登录，退出会让这份 cookie 失效。
- 浏览器一直开着这个登录会话时，Google 会定期轮换会话 cookie，导出的那份几分钟到十几分钟后就失效（实测）。建议在无痕窗口里登录、导出 cookie 后直接关掉窗口，catbus 就是这个会话唯一的使用方。失效后：`auth status` 返回 `logged_in: false`；需要登录的命令报 `AUTH_EXPIRED`（YouTube 对失效的 cookie 照样返回 200 和空内容，catbus 按响应里的 `logged_in=0` 判断，不会返回空列表）。重新导出，再 `auth login` 一次。
- 没有子站点。

### 多账号

每个账号单独导入一次，用 `-a` 起名：

```bash
catbus youtube auth login -a work --cookie @work-cookie.txt
catbus youtube auth list                 # 本平台的所有账号
catbus youtube auth use work             # 切换当前账号
catbus youtube feed list -a default      # 只在这一条命令里用另一个账号
catbus youtube item get dQw4w9WgXcQ -a guest   # 强制以游客身份访问
```

### 代理

国内网络访问 YouTube 需要代理。catbus 不读 `HTTP(S)_PROXY` 环境变量，要显式配置：

```bash
catbus config set youtube.proxy http://127.0.0.1:7890
```

## 支持的命令

✓ 已实现，◐ 部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示 YouTube 没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。「需要登录」的命令在游客态下报 `AUTH_REQUIRED`（退出码 3）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 频道资料：名字、@handle、头像、简介、订阅数、视频数。`me` 需要登录，且账号要有频道。 |
| `user search` | ✓ | 搜索频道。 |
| `user items` | ✓ | 频道「视频」tab 里的视频，不含 Shorts 和直播。 |
| `user likes` | ✓ | 「已点赞的视频」列表。需要登录，只能看自己的（`me`）。 |
| `user collects` | ✓ | 「稍后观看」列表。需要登录，只能看自己的（`me`）。 |
| `user following` | ✓ | 订阅的频道。需要登录，只能看自己的（`me`）。 |
| `user follow` | ✓ | 订阅频道。需要登录。 |
| `user unfollow` | ✓ | 取消订阅。需要登录。订阅列表更新有几秒延迟。 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 视频详情：标题、简介、频道、发布时间、播放数、点赞数、评论数。player 接口被人机验证拦下时，改用 watch 页的数据：发布时间只精确到天，stderr 有一行提示。 |
| `item search` | ✓ | 搜索视频（结果里也有 Shorts）。取值：`--sort` general / popular；`--time` all / day / week / month / year；`--type` all / video。 |
| `item related` | ✓ | watch 页右侧的推荐视频。 |
| `item media` | ◐ | 媒体地址：最清晰的一路视频轨 + 码率最高的一路音频轨（分轨）。限制见「已知限制」。 |
| `item download` | ◐ | 下载 `item media` 的视频轨和音频轨，得到两个文件，不合流。 |
| `item like` | ✓ | 点赞。需要登录。 |
| `item unlike` | ✓ | 取消点赞（也会取消点踩）。需要登录。 |
| `item collect` | ✓ | 加入「稍后观看」。需要登录。 |
| `item uncollect` | ✓ | 移出「稍后观看」。需要登录。 |
| `item list`、`item publish`、`item delete` | ○ | 规划中（YouTube Studio 接口） |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ✓ | 评论列表（默认排序）。 |
| `comment replies` | ✓ | 某条评论的回复。`<comment>` 是根评论 ID；YouTube 的回复只有一层。 |
| `comment add` | ✓ | 发表评论；`--reply-to` 给根评论或某条回复的 ID，回复都挂在根评论下。需要登录，账号要有频道。 |
| `comment delete` | ✓ | 删除自己的评论或回复。危险操作，需要确认。需要登录。 |
| `comment like` | ✓ | 点赞评论。需要登录。 |
| `comment unlike` | ✓ | 取消点赞评论。需要登录。 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ✓ | 首页推荐（`--kind recommend`，默认）或订阅流（`--kind following`）。需要登录：游客态的首页没有内容。 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播状态（live / offline）和在看人数（主播隐藏人数时为 null）。`<room>` 是直播的视频 ID 或链接。只请求 watch 页，不调容易触发人机验证的 player 接口。 |
| `live search` | ✓ | 搜索正在直播的视频。 |
| `live history` | ✓ | 直播聊天里最近的消息。取「Live chat」视图（全部消息），不是默认的「Top chat」（YouTube 筛选过的）。 |
| `live listen` | ✓ | 持续输出直播聊天：文字消息（`chat`）、Super Chat 与 Super Sticker（`gift`）、会员相关（`gift` / `other`）。按服务端给的间隔轮询（约 10 秒一次），不是长连接；开始时已有的历史消息不输出；同样取「Live chat」视图。 |
| `live send` | ○ | 规划中 |

### keyword / notice / series / history

| 命令 | 状态 | 说明 |
|---|---|---|
| `keyword suggest` | ✓ | 搜索联想词。 |
| `notice list` | ✓ | 通知列表。需要登录。 |
| `notice count` | ✓ | 未读通知数，只有总数，不分类。需要登录。 |
| `series list` | ✓ | 频道公开的播放列表；`me` 为自己的全部播放列表（含私享的），需要登录。 |
| `series items` | ✓ | 播放列表里的视频。 |
| `history list` | ✓ | 观看历史。需要登录。 |

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 视频 `<item>` / `<room>` | 11 位视频 ID（如 `dQw4w9WgXcQ`），或 `youtube.com/watch?v=…`、`youtu.be/…`、`/shorts/…`、`/live/…`、`/embed/…` 链接 |
| 频道 `<user>` | 频道 ID（`UC…`）、`@handle`（如 `@LofiGirl`）、频道链接（`/channel/…`、`/@…`、`/c/…`、`/user/…`），或 `me`。不带 `@` 的名字按 @handle 处理 |
| 播放列表 `<series>` | 播放列表 ID（`PL…` 等），或带 `list=` 的链接 |
| 评论 `<comment>` | `comment list` 输出的 `id`；回复的 ID 形如 `<根评论 ID>.<回复 ID>` |

视频 ID 可能以 `-` 开头（如 `-RogqxfnBdg`），直接写会被当成选项。这时在前面加 `--`（`catbus youtube item get -- -RogqxfnBdg`），或者传链接（`https://youtu.be/-RogqxfnBdg`）。

## 示例

```bash
# 不登录：搜索、详情、评论、频道
catbus youtube item search "lofi hip hop" --sort popular --limit 50
catbus youtube item get dQw4w9WgXcQ
catbus youtube comment list dQw4w9WgXcQ --limit 100 -o jsonl
catbus youtube user items @LofiGirl --limit 60
catbus youtube series list @LofiGirl

# 下载视频轨和音频轨
catbus youtube item download https://youtu.be/dQw4w9WgXcQ --dir ./yt

# 监听直播聊天 10 分钟
catbus youtube live listen <直播视频 ID> --duration 10m

# 登录后：推荐流、订阅、点赞、评论
catbus youtube auth login --cookie @youtube-cookie.txt
catbus youtube feed list --kind following --limit 40
catbus youtube user follow @LofiGirl
catbus youtube item like dQw4w9WgXcQ
catbus youtube comment add dQw4w9WgXcQ "Nice video"
```

## 已知限制

- **搜索排序只有两种**：YouTube 2025 年改版后搜索页只剩「Relevance」和「Popularity」，对应 `--sort general` 和 `--sort popular`；按上传时间排序已经下线。`--time` 按上传时间筛选仍然可用。
- **媒体地址**：`item media` / `download` 用 YouTube 的 ANDROID_VR 客户端取地址，不带登录（登录后的 WEB 客户端只给 SABR 流，没有可直接下载的地址）。同一出口 IP 请求过多时，YouTube 会要求「Sign in to confirm you're not a bot」，catbus 报 `RISK_CONTROL`，过一段时间或换代理出口再试。年龄限制、会员专享、仅儿童可见等视频拿不到地址。下载得到的是视频轨和音频轨两个文件，需要的话自己用 ffmpeg 合流。**只能完整下载 1 分钟以内的视频**（如 Shorts）：实测这些地址只给前约 60 秒的数据，再往后的请求回 403（YouTube 要求 PO token，它要运行 Google 的 BotGuard 才能生成，catbus 不做）；更长的视频下载到 1 分钟处会报错，说明原因。下载按 10 MB 一段用 range 请求（整文件请求会被拒绝）。
- **列表里看不到的视频**：有些视频（实测是一个「面向儿童」的合集）点赞、加入稍后观看都成功，但 YouTube 在点赞列表、稍后观看列表里把它隐藏（页面提示「1 unavailable video is hidden」），`user likes` / `user collects` 里也就没有它。
- **只能看自己的列表**：`user likes`、`user collects`、`user following` 只接受 `me`，YouTube 不公开别人的点赞、稍后观看和订阅。
- **没有频道的 Google 账号**：`user get me` 报错；YouTube 不允许没有频道的账号发评论。点赞、订阅、稍后观看不受影响。这样的账号登录时 `user.id` 是 Google 账号 ID；之后开了频道，再登录到同一个账号名会被当成另一个用户拒绝，先 `auth logout -a <name>` 再登录。
- **Shorts 没有作者**：搜索结果、频道页里 Shorts 栏目的条目，YouTube 不给频道信息，`author` 为 null；要作者时对这条再 `item get`。普通视频（包括多人合作的视频）都有作者，合作视频取第一个合作者（上传者）。
- **相对时间是近似值**：列表里的 `created_at` 由页面上的「3 days ago」这类相对时间推算；`item get` 的发布时间是精确的。计数如 `1.2M` 按显示值换算，有舍入。
- **页面语言固定为英文**（`hl=en`），只影响 YouTube 自己生成的文字，标题和简介保持原文。
- **没有私信**：YouTube 2019 年已下线私信，`msg` 命令都不支持。
- **没有热门**：YouTube 已下线「趋势」页，`feed list --kind hot`、`keyword hot` 都不支持。
- **规划中**：`live send`；`item publish` / `list` / `delete`（YouTube Studio 接口）。修改频道资料（`user update`）还不支持。
