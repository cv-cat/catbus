# B 站（bilibili）

| 项 | 值 |
|---|---|
| 平台 id | `bilibili` |
| 别名 | `bili`、`b` |
| `item` 指 | 稿件（视频投稿） |
| 上游仓库 | [cv-cat/BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| 移植基线 | master 上的 [`7d80150`](https://github.com/cv-cat/BilibiliApis/commit/7d80150893b429651deee76929af760ea642b844)，记录在 [`src/platforms/bilibili/UPSTREAM`](../../src/platforms/bilibili/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 48 条（✓ 41 · ◐ 7），规划中 ○ 30 条 |

B 站是 catbus 的参考实现（`src/platforms/bilibili/web/`），也是 10 个平台里登录方式最全的。命令表由注册表生成，与 `catbus platforms bilibili` 一致；选项以 `catbus bilibili <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus bilibili auth login` | 真机验证可用 |
| 短信 | `catbus bilibili auth login --method sms --phone <手机号>` | 发验证码前要过极验点选：catbus 先自动识别，失败时在终端里打开一个本地页面，在浏览器里手动完成；非交互环境自动识别失败时报 `RISK_CONTROL` |
| 账密 | `catbus bilibili auth login --method password --username <手机号或邮箱> --password-stdin` | 密码只从 stdin 读取，终端里隐藏输入。同样要过极验 |
| cookie | `catbus bilibili auth login --method cookie --cookie @bili-cookie.txt` | 从 www.bilibili.com 的 DevTools → Network 复制完整的 Cookie 请求头 |

- cookie 里要有 `SESSDATA`（HttpOnly，`document.cookie` 拿不到）；写操作还要 `bili_jct`（csrf）。
- **自动续期**：扫码、短信、账密登录会保存 `refresh_token`，catbus 每天最多检查一次，需要时换新的 `SESSDATA` 并写回凭证文件。cookie 导入的账号没有 `refresh_token`，过期后要重新导入。
- **服务端登出**：`auth logout` 会同时调用 B 站的登出接口，再删除本地凭证。
- 极验自动识别用到 `@cv-cat/catbus-assets-ocr` 里的 ddddocr 模型；从源码安装时先执行 `npm run assets:ocr`。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示 B 站没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证，同时在服务端登出。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 用户资料。 |
| `user search` | ✓ | 搜索用户。 |
| `user items` | ✓ | 用户发布的稿件。取值：`--sort` latest / views / collects。私有选项 `--keyword`。 |
| `user collects`、`user followers`、`user following`、`user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 稿件详情。 |
| `item search` | ✓ | 搜索稿件。取值：`--sort` general / views / latest / collects；`--type` video / article。 |
| `item related` | ✓ | 相关推荐。 |
| `item list` | ✓ | 我发布的稿件，带审核状态。 |
| `item media` | ✓ | 稿件的媒体地址。 |
| `item download` | ✓ | 下载稿件的媒体。 |
| `item like` | ✓ | 点赞。 |
| `item unlike` | ✓ | 取消点赞。 |
| `item collect` | ✓ | 收藏。私有选项 `--folder`。 |
| `item uncollect` | ✓ | 取消收藏。私有选项 `--folder`。 |
| `item publish` | ✓ | 发布稿件。必须给 `--video`、`--title`、至少一个 `--tag` 和 `--category`（取值见 `item categories`）。取值：`--visibility` public / private。不支持 `--image`、`--topic`、`--mention`、`--poi`、`--schedule`、`--price`。私有选项 `--source`、`--dynamic`、`--allow-reprint`。 |
| `item delete` | ◐ | 删除稿件。需要人机验证（极验点选），catbus 还不能自动通过，会报 `RISK_CONTROL`。危险操作，需要确认。 |
| `item categories` | ✓ | 稿件分类，即 `--category` 的取值。 |
| `item coin` | ✓ | 投币。平台扩展。危险操作，需要确认。 |
| `item triple` | ✓ | 一键三连。平台扩展。危险操作，需要确认。 |
| `item subtitles` | ✓ | 字幕。平台扩展。 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 评论列表。动态只支持纯文字和转发：图文动态（带图）的评论区挂在相簿上，上游没有查相簿 ID 的接口；稿件、专栏不受影响。取值：`--sort` popular / latest。 |
| `comment add` | ◐ | 发表评论。动态只支持纯文字和转发：图文动态（带图）的评论区挂在相簿上，上游没有查相簿 ID 的接口；稿件、专栏不受影响。私有选项 `--root`。 |
| `comment delete` | ◐ | 删除评论。动态只支持纯文字和转发：图文动态（带图）的评论区挂在相簿上，上游没有查相簿 ID 的接口；稿件、专栏不受影响。危险操作，需要确认。 |
| `comment replies`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | 推荐 / 热门 / 关注流。following 规划中。取值：`--kind` recommend / hot / following。 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播间信息。 |
| `live search` | ✓ | 搜索直播。 |
| `live categories` | ✓ | 直播分类。 |
| `live listen` | ✓ | 监听弹幕、礼物、进场等事件。持续输出 jsonl。 |
| `live history` | ✓ | 最近的弹幕。 |
| `live send` | ✓ | 发弹幕，或用 `--gift` 送礼。私有选项 `--color`、`--font-size`、`--position`、`--reply-user`。送礼（`--gift`）需要确认。 |
| `live gifts` | ✓ | 礼物列表。 |
| `live media` | ✓ | 直播流地址。 |
| `live start` | ✓ | 开播。`--category` 为直播分区，取值见 `live categories`。 |
| `live stop` | ✓ | 下播。 |
| `live list`、`live like`、`live rank`、`live replays` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### folder

| 命令 | 状态 | 说明 |
|---|---|---|
| `folder list` | ◐ | 收藏夹列表。只列出用户自己创建的收藏夹，一次返回全部。 |
| `folder items` | ◐ | 收藏夹里的稿件。非上游：上游没有收藏夹内容接口，请求按网页端收藏夹页补的（x/v3/fav/resource/list），没有对拍；只列出稿件。 |
| `folder create`、`folder update`、`folder delete` | ○ | 规划中 |

### danmaku

| 命令 | 状态 | 说明 |
|---|---|---|
| `danmaku list` | ✓ | 视频弹幕。平台扩展。 |
| `danmaku send` | ✓ | 发视频弹幕。平台扩展。 |

### dynamic

| 命令 | 状态 | 说明 |
|---|---|---|
| `dynamic publish` | ✓ | 发动态。平台扩展。 |
| `dynamic delete` | ✓ | 删动态。平台扩展。危险操作，需要确认。 |

### article

| 命令 | 状态 | 说明 |
|---|---|---|
| `article publish` | ✓ | 发专栏：先存草稿，再提交。平台扩展。 |

### draft

| 命令 | 状态 | 说明 |
|---|---|---|
| `draft get` | ✓ | 专栏草稿。平台扩展。 |
| `draft delete` | ✓ | 删专栏草稿。平台扩展。危险操作，需要确认。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `keyword` | `suggest` `hot` |
| `notice` | `list` `count` |
| `msg` | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `series` | `list` `items` |
| `history` | `list` |
| `topic` | `search` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `user items <user>` | `--keyword <词>` | 只看投稿里匹配关键词的 |
| `item collect` / `uncollect` | `--folder <收藏夹 id>` | 收藏进 / 移出指定收藏夹，多个用逗号分隔，取值来自 `folder list`。不给时收藏进第一个收藏夹，取消时从所有收着它的收藏夹移出 |
| `item publish` | `--source <来源>`、`--dynamic <文案>`、`--allow-reprint` | `--source` 表示转载并给出来源，不给为自制；`--dynamic` 是同步到动态的文案；默认禁止转载，`--allow-reprint` 允许 |
| `comment add <item> <text>` | `--reply-to <评论>`、`--root <评论>` | 回复楼中楼时 `--root` 给根评论、`--reply-to` 给被回复的那条；不给 `--root` 时 `--reply-to` 就是根评论 |
| `live send <room> <text>` | `--color`、`--font-size`、`--position`、`--reply-user <用户>` | 弹幕样式同 `danmaku send`；`--reply-user` 为回复的观众（UID 或空间链接） |

| 扩展命令 | 说明 | 输出 |
|---|---|---|
| `item coin <item> [--count 1\|2] [--like]` | 投币，默认 1 个；`--like` 同时点赞。**会真的花掉硬币**，需要确认 | `{id}` |
| `item triple <item>` | 一键三连，需要确认 | `{id}` |
| `item subtitles <item>` | 字幕：每种语言一条，带时间轴（`lines[{from to text}]`） | Subtitle[] |
| `danmaku list <item>` | 视频弹幕 | Danmaku[] |
| `danmaku send <item> <text> --offset <秒> [--color] [--font-size] [--position]` | 发视频弹幕。`--color` 为 `#RRGGBB` 或十进制，默认白色；`--font-size` 18 小 / 25 标准（默认）；`--position scroll\|top\|bottom`，默认 `scroll` | `{id}` |
| `dynamic publish --text <正文> [--image <图片>...]` | 发动态。B 站动态没有「仅自己可见」，发出去就是公开的 | `{id url}` |
| `dynamic delete <id>` | 删动态，需要确认 | `{id}` |
| `article publish --title <标题> --text <HTML> [--category] [--tag] [--summary] [--draft]` | 发专栏：先存草稿，再提交。`--text` 是 HTML；`--category` 是专栏分区 ID（数字，默认 0，catbus 没有专栏分区列表命令）；`--draft` 只存草稿、不提交。上游没有专栏封面，所以没有 `--cover` | `{id url}` |
| `draft get <id>` | 专栏草稿 | Item（`kind` 为 `article`，`status` 为 `draft`） |
| `draft delete <id>` | 删专栏草稿，需要确认 | `{id}` |

定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 稿件 `<item>` | BV 号（`BV1xx411c7mD`）、av 号（`av170001`）、纯数字 aid、视频页链接，或分享短链 `b23.tv/...` |
| 评论区（`comment list` / `add` / `delete` 的 `<item>`） | 稿件（同上）；专栏（`cv<id>` 或专栏链接 `/read/cv<id>`）；动态（动态链接 `t.bilibili.com/<id>`、`bilibili.com/opus/<id>`、`m.bilibili.com/dynamic/<id>`，17 位以上的动态 ID，或 `dyn:<id>`）。动态只支持纯文字和转发 |
| 用户 `<user>` | mid（数字，也可以写成 `uid:<mid>`）、空间链接 `https://space.bilibili.com/<mid>`，或 `me` |
| 直播间 `<room>` | 房间号（短号会自动换成真实房间号）、直播间链接 `https://live.bilibili.com/<房间号>`；也可以传主播（空间链接、`uid:<mid>`、`me`），自动查出他的直播间 |
| 收藏夹 `<folder>` | 收藏夹 ID、`folder list` 输出的 url（`.../favlist?fid=<id>`），或播放列表链接（`ml<id>`） |
| 动态 `<id>`（`dynamic delete`） | 动态 ID 或动态链接（`dynamic publish` 输出的 `id`、`url` 都可以） |
| 草稿 `<id>` | `article publish --draft` 返回的 `id` |

## 示例

```bash
# 扫码登录
catbus bilibili auth login

# 稿件详情、播放地址、下载
catbus bilibili item get BV1xx411c7mD
catbus bilibili item media BV1xx411c7mD
catbus bilibili item download BV1xx411c7mD --dir ./bili

# 按播放量搜索，取 50 条；搜专栏
catbus bilibili item search 猫 --sort views --limit 50
catbus bilibili item search 猫 --type article

# 某个 UP 主播放最多的投稿，只看标题含关键词的
catbus bilibili user items "<space_url>" --sort views --keyword 教程 --all -o jsonl

# 评论（按时间排序）、字幕
catbus bilibili comment list BV1xx411c7mD --sort latest --limit 100 -o jsonl
catbus bilibili item subtitles BV1xx411c7mD

# 直播：按主播找直播间并监听 10 分钟
catbus bilibili live listen "<space_url>" --duration 10m > live.jsonl

# 投币（危险操作，非交互环境要加 -y）
catbus bilibili item coin BV1xx411c7mD --count 1 --like -y
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **`danmaku list` 不完整**：上游 bug，分段请求固定带着 `ps=0&pe=120000`。6 分钟以内的视频**只返回前 2 分钟的弹幕，而且不报错**；超过 6 分钟的视频报 `UPSTREAM`（HTTP 404）。修复已提给上游，集成前不要依赖这条命令做完整统计。见 [trouble.md 第 4 节](../trouble.md#4-b-站弹幕只取到前-2-分钟超过-6-分钟直接失败上游-bug)。
- **`item delete` 过不了人机验证**：撤稿需要极验点选，验证码参数从哪里申请上游没写，catbus 还不能自动通过，会报 `RISK_CONTROL`。请在网页端撤稿。
- **动态评论区只支持纯文字和转发动态**：图文动态（带图）的评论区挂在相簿上，上游没有从动态 ID 查相簿 ID 的接口。稿件、专栏的评论区不受影响。见 [trouble.md 第 9 节](../trouble.md#9-待上游修复后集成)。
- **`user get` 没有计数**：`stats.followers / following / items / likes` 恒为 null，上游只有不含计数的用户信息接口。`item list` 的 `author.name` 也是空的。见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。
- **`folder items` 不是上游能力**：请求按网页端收藏夹页补的，没有对拍，只列出稿件。
- **还没真机验证**：`item coin` / `triple` / `publish`、`dynamic publish` / `delete`、`article publish`（正式提交）、`live send` / `start` / `stop`、`live listen`、`item download`。已验证：点赞、收藏、评论的增删、`danmaku send`、专栏草稿的存取删。见 [trouble.md 6.1](../trouble.md#61-已验证平台里没测的命令)。
- B 站笔记不提供，见 [AGENTS.md 4.12](../../AGENTS.md#412-不提供的能力)。
