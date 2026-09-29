# catbus 命令速查

从 AGENTS.md 4.5（通用词表）、4.8（参数）、4.9（选项）提炼。**某个平台实际支持哪些命令、哪些筛选取值，以 `catbus platforms <platform>` 和 `catbus <platform> <resource> <action> --help` 为准**；本表列的是规范里的全集，很多命令在具体平台上是规划中（`NOT_IMPLEMENTED`）或不存在（`UNSUPPORTED`）。

```
catbus <platform> <resource> <action> [参数...] [选项...]
```

参数形式：`<user>` 接受 ID、主页 URL、用户名或 `me`；`<item>` 接受 ID 或 URL（含分享短链、B 站 BV 号）；`[user]` 省略时为 `me`。xhs 的 `<item>` 请传带 `xsec_token` 的 URL。

## 全局命令

| 命令 | 输出 |
|---|---|
| `catbus platforms [platform]` | 能力矩阵：每条命令的 `status`、`auth`、`upstream`、`note` |
| `catbus doctor` | 运行环境检查 `{name ok message}[]`；有一项不通过时退出码 1 |
| `catbus auth list` | 所有平台、所有端的账号 |
| `catbus config get\|set\|unset\|list [key] [value]` | 读写 `config.toml`：`proxy`、`timeout`、`<platform>.proxy` |
| `catbus version` | `{version node platform arch}` |

## 全局选项

| 选项 | 说明 |
|---|---|
| `-a, --account <name>` | 使用哪个账号 |
| `-e, --endpoint web\|app\|pc` | 端，默认 `web`（app / pc 尚未实现） |
| `-o, --output json\|jsonl` | 输出格式，默认 `json` |
| `--raw` | 用平台原始对象代替归一化对象 |
| `--proxy <url>` | 本次调用的代理 |
| `-v, --verbose` | stderr 输出调试日志（已脱敏） |
| `-q, --quiet` | 只保留错误 |
| `-y, --yes` | 跳过危险操作的确认 |
| `-h, --help` | 帮助 |

## auth

| 命令 | 输出 |
|---|---|
| `auth login [--method qrcode\|sms\|password\|cookie] [--scope <scope>]` | Account |
| `auth login --method sms --phone <手机号>`，再 `--code <验证码>` | 非 TTY 下分两步，中间态 10 分钟有效 |
| `auth login --method password --username <name> --password-stdin` | 密码只从 stdin 读 |
| `auth login --method cookie --cookie <str\|@file\|->` | 导入浏览器 cookie |
| `auth status` | AuthStatus（在线校验，未登录不报错） |
| `auth logout` | Account |
| `auth list` | Account[] |
| `auth use <account>` | Account |

## user

| 命令 | 输出 |
|---|---|
| `user get <user>` | User |
| `user search <keyword>` | User[]，分页 |
| `user items <user>` | Item[]，分页 |
| `user likes` / `collects` / `reposts [user]` | Item[]，分页 |
| `user followers` / `following [user]` | User[]，分页 |
| `user follow` / `unfollow <user>` | `{id}` |

## item

| 命令 | 输出 |
|---|---|
| `item get <item>` | Item |
| `item search <keyword> [--sort] [--type] [--time]` | Item[]，分页 |
| `item related <item>` | Item[]，分页 |
| `item list` | Item[]，分页：自己发布的，带审核状态 |
| `item media <item>` | Media[]：可播放 / 下载的地址 |
| `item download <item> [--dir <目录>] [--overwrite]` | File[]；文件名 `<platform>_<id>_<序号>.<ext>` |
| `item like` / `unlike` / `collect` / `uncollect` / `repost` / `unrepost <item>` | `{id}` |
| `item publish [发布选项]` | Item |
| `item delete <item>` | `{id}`，危险操作 |
| `item categories` | Category[]：`--category` 的取值 |

## product

| 命令 | 输出 |
|---|---|
| `product get <product>` | Item（`kind` 为 `goods`）：内容平台里挂的商品 |

闲鱼、淘宝、京东的商品本身就是 item，用 `item get`。

## comment

| 命令 | 输出 |
|---|---|
| `comment list <item> [--product]` | Comment[]，分页；传商品 URL 或加 `--product` 时列商品评价 |
| `comment replies <item> <comment>` | Comment[]，分页 |
| `comment add <item> <text> [--reply-to <comment>]` | Comment |
| `comment delete <item> <comment>` | `{id}`，危险操作 |
| `comment like` / `unlike <item> <comment>` | `{id}` |

## feed / keyword

| 命令 | 输出 |
|---|---|
| `feed list [--kind recommend\|hot\|following] [--category <id>]` | Item[]，分页；默认 `recommend` |
| `feed categories` | Category[] |
| `keyword suggest <prefix>` | Keyword[] |
| `keyword hot` | Keyword[] |

## live

| 命令 | 输出 |
|---|---|
| `live get <room>` | Live |
| `live list` / `live search <keyword>` | Live[]，分页 |
| `live categories` | Category[] |
| `live listen <room> [--duration <秒\|10m\|1h>]` | Event 流（jsonl） |
| `live history <room>` | Event[]：最近的弹幕 |
| `live send <room> <text>` | `{id}` |
| `live send <room> --gift <gift> [--count N]` | `{id}`，危险操作 |
| `live like` / `rank` / `gifts` / `products` / `media <room>` | `{id}` / Rank[] / Gift[] / Item[] / Media[] |
| `live replays <user>` | Item[]，分页 |
| `live start` / `live stop` | `{id push{url key}}` / `{id}` |

## notice / msg

| 命令 | 输出 |
|---|---|
| `notice list` | Notice[]，分页 |
| `notice count` | NoticeCount |
| `msg list` | Conversation[]，分页 |
| `msg history <conversation>` | Message[]，分页 |
| `msg send <text> --to <user> \| --conversation <id> \| --item <item> [--image] [--video]` | Message；三个目标用一个，只有 `--to` 与 `--item` 可以同时用 |
| `msg listen [--duration]` | Message 流（jsonl） |
| `msg read <conversation>` | `{id}` |
| `msg revoke <conversation> <message>` | `{id}`，危险操作 |
| `msg delete <conversation>` | `{id}`，危险操作 |

`msg send --item <item>`：联系商品的卖家或客服（闲鱼、淘宝、京东）。

## media / folder / series / history / topic / poi

| 命令 | 输出 |
|---|---|
| `media upload <file>` | Media |
| `folder list [user]` | Folder[]，分页 |
| `folder items <folder>` | Item[]，分页 |
| `folder create <name>` | Folder |
| `folder update <folder> --name <name>` | Folder |
| `folder delete <folder>` | `{id}`，危险操作 |
| `series list [user]` / `series items <series>` | Series[] / Item[]，分页 |
| `history list` | Item[]，分页 |
| `topic search <keyword>` | Topic[]，分页 |
| `poi search <keyword>` | Poi[]，分页 |

## 标准选项

**分页**（列表命令）：

| 选项 | 说明 |
|---|---|
| `--limit N` | 自动翻页，取满 N 条 |
| `--cursor <c>` | 从上次的 `page.cursor` 继续；游标不透明，原样传回 |
| `--all` | 翻到没有更多 |

**筛选**（只能用下面的标准值；平台支持哪些看 `--help`）：

| 选项 | 标准取值 |
|---|---|
| `--sort` | `general` `latest` `popular` `views` `comments` `collects` `sales` `price_asc` `price_desc` |
| `--type` | `all` `video` `image` `text` `article` `goods` |
| `--time` | `all` `day` `week` `month` `half_year` `year` |
| `--kind` | `recommend` `hot` `following` |
| `--category <id>` | 来自对应的 `categories` 命令 |

标准值但平台不支持 → `UNSUPPORTED`；不是标准值 → `USAGE`。

**发布**（`item publish` 等）：

| 选项 | 说明 |
|---|---|
| `--title` | 标题 |
| `--text <str\|@file>` | 正文 |
| `--image <path\|url>` | 图片，可重复 |
| `--video <path\|url>` | 视频 |
| `--cover <path\|url>` | 封面 |
| `--tag` / `--topic` / `--mention` | 均可重复 |
| `--poi <id>` | 地点 |
| `--category <id>` | 分类 |
| `--visibility public\|private\|friends\|fans` | 默认 `public`；**Agent 发布时请用 `private`，除非用户明确要公开** |
| `--schedule <ISO 时间>` | 定时发布 |
| `--price <金额>` | 商品价格（闲鱼） |
| `--quote <item>` | 引用一条内容（目前只有 x） |

本地文件自动上传，不需要先 `media upload`。

**长连接**：`--duration <秒|10m|1h>`。

## 平台扩展

只在个别平台存在的命令（完整说明见 AGENTS.md 4.7）：

| 平台 | 命令 |
|---|---|
| bilibili | `item coin <item> [--count 1\|2] [--like]`（危险）、`item triple <item>`（危险）、`item subtitles <item>`、`danmaku list <item>`、`danmaku send <item> <text> --offset <秒>`、`dynamic publish --text [--image]`、`dynamic delete <id>`、`article publish --title --text [--draft]`、`draft get <id>`、`draft delete <id>` |
| tiktok | `folder add <folder> <item>`、`folder create <name> [--visibility public\|private]` |
| jd | `order list [--range 3m\|this_year\|<年份>]`、`cart count`、`coupon list <item>`；多数命令可加 `--area <地区编码>` |
| x | `item publish --thread <text>`（可重复）、`article publish --text [--title] [--cover]`、`article delete <article>` |

各平台还有私有选项（例如 douyin `item search --length`、bilibili `user items --keyword`），在该命令的 `--help` 里列出。

## 输出类型

所有平台同一种对象结构相同，字段总是存在（缺失为 null 或 `[]`）。常用的：

| 类型 | 字段 |
|---|---|
| UserRef | `id name url` |
| User | `id name handle avatar url bio stats{followers following items likes}` |
| Item | `id kind url title text author:UserRef created_at cover media:Media[] stats{views likes comments collects shares} price status` |
| Media | `id type url width height duration` |
| Comment | `id item_id parent_id author:UserRef text created_at stats{likes replies}` |
| Live | `id url title status host:UserRef cover stats{viewers}` |
| Event | `type time user:UserRef text gift{name count}` |
| Conversation | `id peer:UserRef unread last_message updated_at` |
| Message | `id conversation_id from:UserRef type text media:Media[] created_at` |

完整的类型与枚举值见 AGENTS.md 6.2、6.3。
