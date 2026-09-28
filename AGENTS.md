# AGENTS.md — catbus（猫巴士）

> 本文件是本项目给所有 AI 编码代理（Claude Code / Codex / Cursor 等）的统一说明，也是 catbus 的规范本身。
> `CLAUDE.md` 通过 `@AGENTS.md` 引用本文件，**只维护这一份**。

## 1. 目标

做**一个 CLI —— 操作各大平台接口的统一入口**。

- 一个命令 `catbus`，按统一的命令规范调用 10 个平台：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。
- 能力来源是作者 [cv-cat](https://github.com/cv-cat) 的 10 个开源仓库，已克隆到 `references/`，作为**只读的原始来源**。
- 所有平台都在本仓库里**用 TypeScript 重写**，不在运行时调用上游的 Python。
- **用户只需要安装 Node**（版本见 7.1）。不需要 Python，不需要 C/C++ 编译器，也不需要其他系统依赖。
  - `npm i -g catbus-cli` 装完就能离线使用。
  - 必须支持全部目标系统（见 7.2）。
- 以 **npm 包**分发，不发 PyPI。安装体积不是约束，优先保证开箱即用。
- 上游目前只有 **web 端**接口。规范为 **app 端**、**pc 端**预留位置，例如 `catbus xianyu item get <id> -e app`。
- 登录态统一保存在 `~/.catbus/`，**按 平台 × 端 × 账号** 隔离。web 端不登录几乎看不到内容，所以都需要登录；游客态留给 app / pc 端。
- 输出对人和对 Agent 都友好：stdout 只输出 JSON，字段跨平台统一。
- **同义同名**：含义相同的能力在所有平台上用同一个命令、同一组参数、同一种输出结构。例如商品一律叫 `item`，搜索一律叫 `search`。
- 将来的非 JS 上游（Go / Java……）通过 provider 协议接入（见 7.8）。

### 1.1 命名（已定）

| 项 | 取值 |
|---|---|
| 品牌 | **catbus（猫巴士）**：一只能载你去任何地方的猫，呼应 cv-cat |
| slogan | 上车，开往任何平台 / all aboard, every platform |
| 命令 | `catbus` |
| npm 主包 | `catbus-cli`（npm 上的 `catbus` 已被别的库占用） |
| npm scope | `@cv-cat`，用于 `@cv-cat/catbus-assets-jd` 和将来的 provider 包。`@catbus` 已被占用；`@cv-cat` 由用户注册为 npm org |
| 仓库 | https://github.com/cv-cat/catbus ，默认分支 `master` |
| 许可证 | MIT（主包和 assets-jd 相同） |
| 数据目录 | `~/.catbus/`，可用 `CATBUS_HOME` 覆盖 |
| 环境变量前缀 | `CATBUS_` |
| Logo | `assets/logo.svg`（图标）、`assets/logo-wordmark.svg`（横版）、`assets/banner.txt`（终端字符画）。猫头就是一个终端窗口：左眼是提示符 `>`，右眼是闪烁的光标 `_`，嘴是 `ω`，配色取自 Catppuccin Mocha |

## 2. 当前阶段与里程碑

**M0–M3 已完成：10 个平台的 web 端全部移植。** 下一步是首次发布，然后是 M4。改规范仍然先改本文件，再写代码。

| 阶段 | 内容 |
|---|---|
| M0 | 定名（已定：catbus）、定规范、定技术方案（本文件 + `docs/`）。已完成 |
| M1 | 骨架，拆成下面三块。已完成 |
| M2 | bilibili、xhs 的 web 端：上游已有（✓ / ◐）的能力全部移植并通过对拍。已完成 |
| M3 | 其余 8 个平台的 web 端，范围同 M2。已完成 |
| M4 | MCP 模式、`table` 输出、shell 补全、external provider、app / pc 端 |

移植中发现矩阵与上游不符（上游其实没有、或只是占位）的能力，已按上游实际情况改为 ○ 或 ◐，以 `docs/capabilities.md` 为准。

M1 的内容：
- **项目与 CLI**：TS 工程；argv 解析、注册表、帮助、信封、退出码；auth store 与游客态；`platforms` / `doctor` / `auth list` / `config` / `version`。
  - 注册表里把全部能力都声明为 planned，执行时返回 NOT_IMPLEMENTED。
- **依赖选型**：确定 HTTP 库（见 7.3），在 CI 的全部目标系统上跑冒烟测试。
- **测试与发布**：对拍测试框架（见 7.5）、npm 发布流程。

矩阵里的 ○（上游没有的能力）只占位：注册为 planned，执行时返回 NOT_IMPLEMENTED，暂不排期，有需要时再实现。

## 3. 参考仓库 `references/`

| 平台 id | 仓库 | 主要入口 |
|---|---|---|
| xhs | Spider_XHS | `apis/xhs_pc_apis.py`、`apis/xhs_creator_apis.py`、`xhs_utils/` |
| douyin | DouYin_Spider | `dy_apis/douyin_api.py`、`dy_apis/douyin_creator_api.py`、`dy_apis/login_api.py` |
| tiktok | TiktokApis | `api/tiktok.py`、`api/tiktok_web.py`、`signing/` |
| bilibili | BilibiliApis | `apis/bili_apis.py`、`apis/bili_*_apis.py`、`builder/auth.py` |
| kuaishou | KuaiShou-Spider | `ks_apis/kuaishou_api.py`、`ks_apis/publish_api.py`、`ks_apis/login_api.py` |
| weibo | WeiboApis | `apis/weibo_apis.py`、`apis/weibo_mobile_apis.py`、`apis/weibo_creator_apis.py` |
| xianyu | XianYuApis | `goofish_apis.py`、`goofish_live.py` |
| taobao | TaoBaoApis | `taobao_apis.py`、`taobao_live.py`、`utils/taobao_utils.py` |
| jd | JdApis | `jd_apis/jd_api.py`、`jd_apis/jd_login_api.py`、`builder/auth.py` |
| x | XApis | `x_apis/x_api.py`、`x_apis/x_write_api.py`、`x_apis/login_api.py` |

参考资料：
- 每个仓库的鉴权、登录、API 方法、JS 资产、游客态生成位置，以及 Python → JS 的替换对照，见 [docs/upstream-map.md](docs/upstream-map.md)。
- 各平台的能力矩阵见 [docs/capabilities.md](docs/capabilities.md)。

规则：
- `references/` 只读。
  - 可以阅读，也可以运行（用来生成对拍数据，见 7.5）。
  - 可以在上游 gitignore 的位置装依赖，例如 `node_modules/`。
  - **不能修改其中任何受版本控制的文件**。
- `references/` 不进入本仓库的版本控制，它们各自是独立的 git 仓库。
- 每个平台的移植基于哪个上游 commit，记录在 `src/platforms/<p>/UPSTREAM`。

## 4. 命令规范

### 4.1 语法

```
catbus <platform> <resource> <action> [参数...] [选项...]
```

- 选项可以出现在任意位置。`--` 之后的内容一律按参数处理，用于以 `-` 开头的文本。
- 端用选项 `-e/--endpoint` 指定，默认 `web`（见 4.3）。

示例：

```bash
catbus xhs item get "https://www.xiaohongshu.com/explore/<id>?xsec_token=..."
catbus xhs user items <user> --all -o jsonl
catbus bilibili item get BV1xx411c7mD
catbus douyin comment list <item> --limit 100
catbus x user get elonmusk
catbus jd item search 机械键盘 --sort sales
catbus taobao msg send "在吗" --item <商品 url>
catbus bilibili live listen <room> --duration 10m
catbus xhs auth login
catbus kuaishou auth status -a work
catbus xianyu item get <id> -e app           # app 端尚未实现：NOT_IMPLEMENTED，退出码 4
```

### 4.2 平台 id 与别名

| 规范 id | 别名 |
|---|---|
| `xhs` | `xiaohongshu`, `rednote` |
| `douyin` | `dy` |
| `tiktok` | `tt` |
| `bilibili` | `bili`, `b` |
| `kuaishou` | `ks` |
| `weibo` | `wb` |
| `xianyu` | `goofish`, `xy` |
| `taobao` | `tb` |
| `jd` | `jingdong` |
| `x` | `twitter` |

目录名、配置键、输出里的 `platform` 字段一律使用**规范 id**。只有平台有别名；resource 和 action 没有别名。

### 4.3 端（endpoint）

- `-e/--endpoint web|app|pc`，默认 `web`，没有配置项可以改默认值。
- 每个平台在注册表里声明各端的状态：目前 web 为 available，app / pc 为 planned。

命令无法执行时，按下面的顺序判断：

| 情况 | code | 退出码 |
|---|---|---|
| 端为 planned，命令在词表内（第 4.5、4.7 节） | `NOT_IMPLEMENTED` | 4 |
| 端可用，命令是矩阵里的 ○（规划中） | `NOT_IMPLEMENTED` | 4 |
| 命令是矩阵里的 —（平台没有这个概念），或者不在词表内 | `UNSUPPORTED` | 2 |

- `UNSUPPORTED` 时，如果别的端有这个命令，`hint` 里提示加 `-e <端>`。
- 用了平台原生叫法（如 `note`、`video`），`hint` 里提示对应的规范词（见 4.6）。
- 参数和选项的校验（`USAGE`，以及筛选取值的 `UNSUPPORTED`）先于 ○ 的判断：写错的命令先报用法错误。端为 planned 时不做校验。

### 4.4 动作语义

| 动作 | 语义 |
|---|---|
| `get` | 取单个对象 |
| `list` | 取一个集合，不需要关键词。默认是当前账号自己的，或者推荐流 |
| `search` | 按关键词搜索 |
| 成对动作 | `like/unlike`、`collect/uncollect`、`repost/unrepost`、`follow/unfollow` |
| 写入 | `add`、`send`、`publish`、`create`、`update`、`delete`、`upload` |
| 长连接 | `listen`：持续输出 jsonl，直到 Ctrl-C 或 `--duration` 到期 |

### 4.5 通用词表

| resource | 含义 | action |
|---|---|---|
| `auth` | 登录态 | `login` `status` `logout` `list` `use` |
| `user` | 用户 | `get` `search` `items` `likes` `collects` `reposts` `followers` `following` `follow` `unfollow` |
| `item` | 平台的**主内容单元**（见下表） | `get` `search` `related` `list` `media` `download` `like` `unlike` `collect` `uncollect` `repost` `unrepost` `publish` `delete` `categories` |
| `product` | 内容平台里挂的商品（抖音 / TikTok 商城等） | `get` |
| `comment` | 评论，也包括商品评价 | `list` `replies` `add` `delete` `like` `unlike` |
| `feed` | 推荐 / 热门 / 关注流 | `list` `categories` |
| `live` | 直播 | `get` `list` `search` `categories` `listen` `history` `send` `like` `rank` `gifts` `products` `media` `replays` `start` `stop` |
| `keyword` | 搜索词 | `suggest` `hot` |
| `notice` | 通知（评论 / @ / 赞 / 关注 / 系统） | `list` `count` |
| `msg` | 私信 / IM / 客服 | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `media` | 媒体上传 | `upload` |
| `folder` | 收藏夹 | `list` `items` `create` `update` `delete` |
| `series` | 合集 / 播放列表 | `list` `items` |
| `history` | 浏览历史 | `list` |
| `topic` | 话题 | `search` |
| `poi` | 地点 | `search` |

`item` 在各平台的含义：

| 平台 | item = |
|---|---|
| xhs | 笔记 |
| douyin | 作品 |
| tiktok | 视频 |
| bilibili | 稿件 |
| kuaishou | 作品 |
| weibo | 微博 |
| x | 推文 |
| xianyu | 闲置商品 |
| taobao | 商品 |
| jd | 商品 SKU |

各动作的说明：
- `item list`：当前账号自己发布的内容，带审核状态，数据来自创作者中心。
- `item related`：相关推荐。
- `item media`：可播放 / 可下载的媒体地址。
- `item download`：下载到本地。
- `item categories`：发布和搜索时 `--category` 的取值。
- `feed list --kind recommend|hot|following`：默认 `recommend`。
- `live listen`：弹幕 / 礼物 / 进场等事件流。
- `live history`：最近的弹幕。
- `live media`：直播流地址。
- `live replays <user>`：回放列表。
- `live start` / `stop`：开播 / 下播。

### 4.6 平台原生叫法 → 规范词

| 平台原生叫法 | 规范词 |
|---|---|
| note / aweme / video / photo / work / post / status / tweet / goods / sku | `item` |
| digg、favorite（X 的点赞） | `like` |
| favour、bookmark、想要、关注商品 | `collect` |
| retweet | `repost` |
| board、collection（TikTok 收藏夹） | `folder` |
| mix、playlist、collection（快手合集） | `series` |
| reply、评价 | `comment` |
| DM、IM、咚咚 | `msg` |
| playurl | `item media` |
| location | `poi` |
| watch | `listen` |

原生叫法**不做别名**。用了原生叫法会报 `UNSUPPORTED`，`hint` 里给出规范词。

### 4.7 平台扩展

平台特有、没有跨平台对应物的能力，才用扩展：可以在通用 resource 上加 action，也可以新增 resource。**新增扩展前先登记到本节，再写代码。**

| 平台 | 命令 | 说明 | 输出 |
|---|---|---|---|
| bilibili | `item coin <item> [--count 1\|2]` | 投币 | `{id}` |
| bilibili | `item triple <item>` | 一键三连 | `{id}` |
| bilibili | `item subtitles <item>` | 字幕 | Subtitle[] |
| bilibili | `danmaku list <item>` | 视频弹幕 | Danmaku[] |
| bilibili | `danmaku send <item> <text> --offset <秒>` | 发视频弹幕 | `{id}` |
| bilibili | `dynamic publish --text [--image]` | 发动态 | `{id url}` |
| bilibili | `dynamic delete <id>` | 删动态 | `{id}` |
| bilibili | `article publish --title --text [--cover] [--category]` | 发专栏：先存草稿，再提交 | `{id url}` |
| xianyu | `item publish [--original-price <金额>]` | 私有选项：原价（元），要和 `--price` 一起用 | Item |
| xianyu | `item publish [--shipping free\|distance\|fixed\|none]` | 私有选项：运费方式，默认 `free` 包邮；`distance` 按距离计费，`fixed` 一口价，`none` 无需邮寄 | Item |
| xianyu | `item publish [--postage <金额>]` | 私有选项：一口价运费（元），配合 `--shipping fixed` | Item |
| xianyu | `item publish [--pickup]` | 私有选项：支持自提 | Item |
| jd | `order list` | 订单 | Order[] |
| jd | `cart count` | 购物车数量 | `{count}` |
| jd | `coupon list <item>` | 商品可用优惠券 | Coupon[] |

扩展类型的字段见 6.2。

### 4.8 参数

目标参数同时接受以下几种形式，由平台实现归一化：
- ID；
- URL，包括分享短链；
- 平台上的自然标识，例如 B 站的 BV 号、X 的用户名；
- `me`：只用于用户，表示当前账号。

所有输出对象都带 `id` 和 `url`，可以直接作为下一条命令的参数。xhs 的 `url` 带 `xsec_token`，因此 xhs 优先传 URL。

各 resource 的位置参数：

| resource | 形式 |
|---|---|
| user | `get` / `items` / `follow` / `unfollow <user>`；`likes` / `collects` / `reposts` / `followers` / `following [user]`，省略时为 `me`；`search <kw>` |
| item | `get` / `related` / `media` / `download` / `like` / `unlike` / `collect` / `uncollect` / `repost` / `unrepost` / `delete <item>`；`search <kw>`；`list`、`categories`、`publish` 不带位置参数 |
| product | `get <product>` |
| comment | `list <item>`；`replies` / `delete` / `like` / `unlike <item> <comment>`；`add <item> <text> [--reply-to <comment>]` |
| feed | `list`、`categories` |
| live | `get` / `listen` / `history` / `like` / `rank` / `gifts` / `products` / `media <room>`；`send <room> <text>`；`send <room> --gift <gift> [--count N]`；`replays <user>`；`list`、`categories`；`search <kw>`；`start` / `stop` |
| keyword | `suggest <prefix>`、`hot` |
| notice | `list`、`count` |
| msg | `list`；`history` / `read` / `delete <conversation>`；`revoke <conversation> <message>`；`send <text> --to <user> \| --conversation <id> \| --item <item>`，三者用一个，只有 `--to` 与 `--item` 可以同时用；可加 `--image` / `--video` |
| media | `upload <file>` |
| folder | `list [user]`，省略时为 `me`；`items <folder>`；`create <name>`；`update <folder> --name <name>`；`delete <folder>` |
| series | `list [user]`，省略时为 `me`；`items <series>` |
| history | `list` |
| topic / poi | `search <kw>` |

- 商品评价用 `comment list <product>`。
  - 传商品 URL 时，自动识别为商品。
  - 传纯 ID 时要加 `--product`，否则按 item 处理。
- `msg send --item <item>`：对商品卖家 / 客服发消息（闲鱼、淘宝、京东）。
- `msg send --to <user> --item <item>`：就这件商品给指定用户发消息（闲鱼：卖家主动联系买家）。不支持的平台报 `UNSUPPORTED`。

### 4.9 选项

**全局选项**：

| 选项 | 说明 |
|---|---|
| `-a, --account <name>` | 使用哪个账号（见 5.2） |
| `-e, --endpoint web\|app\|pc` | 端，默认 `web` |
| `-o, --output json\|jsonl` | 输出格式，默认 `json`（见 6.1） |
| `--raw` | 用平台原始对象代替归一化对象 |
| `--proxy <url>` | 本次调用使用的代理 |
| `-v, --verbose` | stderr 输出调试日志（已脱敏） |
| `-q, --quiet` | 不输出提示和进度，只保留错误 |
| `-y, --yes` | 跳过危险操作的确认（见 4.11） |
| `-h, --help` | 帮助 |

**分页**：

| 选项 | 说明 |
|---|---|
| `--limit N` | 默认只取一页。指定 N 后自动翻页，直到取满 N 条。翻页间隔用平台默认值 |
| `--cursor <c>` | 从上次返回的 `page.cursor` 继续翻。cursor 是不透明字符串 |
| `--all` | 一直翻到没有更多为止 |

**筛选**：各平台在注册表里声明支持哪些筛选、取哪些值。取值只能从下表里选；需要新取值时先改本表。

| 选项 | 标准取值 |
|---|---|
| `--sort` | `general` `latest` `popular` `views` `comments` `collects` `sales` `price_asc` `price_desc` |
| `--type` | `all` `video` `image` `text` `article` `goods` |
| `--time` | `all` `day` `week` `month` `half_year` `year` |
| `--kind` | `recommend` `hot` `following`（`feed list`，默认 `recommend`） |
| `--category <id>` | 取值来自对应的 `categories` 命令 |

取值是标准值、但该平台不支持时报 `UNSUPPORTED`；不是标准值时报 `USAGE`。

**发布**（`item publish`、`dynamic publish` 等）：

| 选项 | 说明 |
|---|---|
| `--title` | 标题 |
| `--text <str\|@file>` | 正文 |
| `--image <path\|url>` | 图片，可重复 |
| `--video <path\|url>` | 视频 |
| `--cover <path\|url>` | 封面 |
| `--tag`、`--topic`、`--mention` | 均可重复 |
| `--poi <id>` | 地点 |
| `--category <id>` | 分类 |
| `--visibility public\|private\|friends\|fans` | 默认 `public`。`friends` 为好友（互相关注）可见，`fans` 为粉丝可见。平台在注册表里声明支持哪些取值，不声明时为 `public` `private` `friends`；平台不支持时报 `UNSUPPORTED`，不是标准值时报 `USAGE` |
| `--schedule <ISO 时间>` | 定时发布 |
| `--price <金额>` | 商品价格（闲鱼） |

本地文件会自动上传，不需要先调 `media upload`。

**下载**：
- `--dir <目录>`：默认当前目录。文件名为 `<platform>_<id>_<序号>.<ext>`。
- `--overwrite`：覆盖已有文件，默认跳过已有文件。

**长连接**：`listen` 总是输出 jsonl，断线自动重连。`--duration <秒|10m|1h>` 指定运行时长，Ctrl-C 正常退出，退出码 0。

平台私有选项在注册表里声明，**不能与上面的标准选项重名**。

### 4.10 全局命令与帮助

全局命令不带平台，名字与平台 id、别名互斥：

| 命令 | 输出 |
|---|---|
| `catbus platforms [platform]` | 能力矩阵：平台 × 端 × resource.action 及其状态，数据来自注册表 |
| `catbus doctor` | 逐项检查：Node 版本；原生依赖能否加载（HTTP 库、canvas、onnx）；`@cv-cat/catbus-assets-jd` 是否就位；`~/.catbus` 的权限；签名 vm 能否运行 |
| `catbus auth list` | 所有平台、所有端下的账号 |
| `catbus config get\|set\|unset\|list` | 读写 `config.toml`（见 5.5） |
| `catbus version`（或 `--version`） | 版本、Node 版本、系统与架构 |

帮助：
- 不带参数的 `catbus` 等同于 `catbus --help`。
- 帮助分四层：`catbus --help`、`catbus xhs --help`、`catbus xhs item --help`、`catbus xhs item get --help`。内容由注册表生成，写到 stdout，这是 stdout 上唯一不是 JSON 的输出。
- 命令级帮助列出参数、选项、示例，以及下面两行：
  ```
  端:   web ✓ · app ○ planned · pc ○ planned
  登录: 需要 | 可选
  ```
- 面向人的文字（帮助、`message`、`hint`、提示）一律用中文。

`doctor` 有检查项不通过时，`ok` 为 false、退出码 1，`data` 里仍然是完整的检查结果。

### 4.11 危险操作确认

以下操作执行前需要确认：
- 所有 `delete`；
- `msg revoke`；
- bilibili 的 `item coin` / `item triple`；
- `live send --gift`。

确认方式：
- stdin 和 stderr 都是 TTY 时，在 stderr 上询问 y/N。
- 否则必须带 `-y`，不带时报 `CONFIRM_REQUIRED`，退出码 2。

### 4.12 不提供的能力

以下上游能力**不暴露为命令**：
- 埋点 / 心跳 / 上报；
- 弹窗 / 合规 / 钱包类接口；
- 系统配置；
- 闲鱼的自动回复示例；
- B 站笔记；
- 关系查询；
- xhs 的 share_code；
- 抖音的 PK / 连麦 / 评论标签；
- TikTok 的 story 和收藏夹移动；
- xhs 的蒲公英（达人）和千帆（分销达人）：只对开通了的品牌 / 机构账号有用，普通账号访问会被拒，被拒后几分钟内主站的评论等接口还会要求人机验证。

如果某条命令内部需要其中的能力（例如心跳），由实现内部调用。

## 5. 登录态

### 5.1 目录

```
~/.catbus/                         # 可用 CATBUS_HOME 覆盖
├── config.toml                    # 见 5.5
├── auth/
│   └── <platform>/                # 规范 id
│       └── <endpoint>/            # web | app | pc
│           ├── <account>.json     # 一个账号一个文件
│           ├── guest.json         # 游客态：设备 cookie、guest token 等，自动生成
│           └── _current           # 当前账号名
└── cache/<platform>/              # 可随时删除：二维码 PNG、短信登录的中间态
```

- 账号名匹配 `[a-z0-9][a-z0-9_-]{0,31}`。`guest` 是保留名。
- 权限：
  - 目录 0700，文件 0600；
  - Windows 依赖用户目录本身的 ACL。
- 所有写入都是原子的：先写临时文件，再 rename。

### 5.2 身份选择与游客态

身份按以下优先级选择：`-a <name>` > `_current` > 游客。

- `-a guest` 强制使用游客身份（只在支持游客态的端上有意义）。
- `-a` 指定的账号不存在时，报 `AUTH_REQUIRED`，`hint` 为 `catbus <p> auth login -a <name>`。

**游客态只在声明了 `guest: true` 的端上存在**（见 7.6）。
- **web 端都不支持游客态**：各平台的 web 端不登录几乎看不到内容，所以 web 端除 `auth` 命令外全部需要登录，未登录时直接报 `AUTH_REQUIRED` 并提示登录命令。游客态主要留给 app 端。
- 支持游客态的端上，很多平台匿名访问也需要设备 cookie 或 token（例如 xhs 的 `a1`、抖音的 `ttwid`、B 站的 `buvid`、X 的 guest token）。catbus 自动生成这些数据，缓存到 `guest.json`，过期后重新生成；各平台的生成方式见 upstream-map。
- 登录流程本身仍会先生成这些设备数据（很多平台的登录接口要求先有设备 cookie），这与游客态无关。

每个命令在注册表里标注 `auth: required | optional`；不支持游客态的端上一律是 `required`：

| 情况 | 行为 |
|---|---|
| `required`，当前是游客 | `AUTH_REQUIRED`，退出码 3，`hint: catbus xhs auth login`（非 web 端时带上 `-e`） |
| `optional`，当前是游客 | 照常执行（信封里 `account` 为 `"guest"`），同时在 stderr 提示一行（见下） |
| 平台返回登录墙 | `AUTH_REQUIRED`，退出码 3 |
| 登录态失效 | `AUTH_EXPIRED`，退出码 3，`hint` 为重新登录的命令 |

`optional` 时在 stderr 输出的提示：

```
[catbus] 未登录 xhs (web)，本次以游客身份访问，结果可能不完整；很多操作需要登录。登录：catbus xhs auth login
```

- `-q` 或 `-a guest` 时不输出这行提示。
- 只提示，不在命令中途弹出交互式登录。

### 5.3 登录与登出

```bash
catbus <p> auth login [-a <name>] [--method qrcode|sms|password|cookie] [--scope <scope>]
```

**账号名**：
- 不带 `-a` 时：有当前账号就登录到当前账号，否则登录到 `default`。
- 登录成功后，如果还没有当前账号，就把它设为当前账号。
- 如果该名字下已经存了另一个用户，报 `USAGE`，`hint` 为"用 `-a <新名字>`，或者先 logout"，新凭证不保存。

**登录方式**：每个平台在注册表里声明支持哪些方式、默认用哪种，见 capabilities.md。

| 方式 | 选项 | 流程 |
|---|---|---|
| `qrcode` | — | 二维码画到 stderr，同时把 PNG 存到 `cache/<p>/`，然后等待扫码 |
| `sms` | `--phone`、`--code` | TTY 下先发验证码，再交互输入。非 TTY 下分两步：`--phone` 发验证码并保存中间态（10 分钟有效），再单独用 `--code` 完成登录 |
| `password` | `--username`、`--password-stdin` | 密码只从 stdin 读取，TTY 下隐藏输入 |
| `cookie` | `--cookie <str\|@file\|->` | 导入后调一次 `me` 校验。也接受浏览器导出的 cookie JSON 数组；douyin、tiktok 另外接受一个 JSON 对象，把 ticket、证书、私钥等设备数据一并导入（这两个平台的写操作需要它们） |

- **验证码**：上游能自动过的就自动过，过不了报 `RISK_CONTROL`（`detail.kind = captcha`），退出码 5。
- **子站点**（创作者中心、直播、IM 等）：
  - 能自动换取的凭证，登录时或第一次用到时自动获取，不需要用户再登录一次（例如 xhs 的创作者中心：用主站登录态换取）；
  - 需要单独登录的，用 `--scope <name>` 登录，各平台可用的 scope 在注册表里声明；
  - 命令缺少所需 scope 时，报 `AUTH_REQUIRED`，`hint` 带上 `--scope`。
- **`auth status`**：在线校验，返回 AuthStatus。未登录或已失效时返回 `logged_in: false`，不报错。
- **`auth logout`**：删除本地凭证文件（上游支持服务端登出的，同时调用服务端登出，目前只有 B 站），并清除指向它的 `_current`。
- **`auth use <account>`**：设置 `_current`。
- **`auth list`**：列出本平台、本端的账号。
- **自动刷新**：会自动刷新的 token（如 B 站的 refresh）和响应里的 Set-Cookie，都会合并回凭证文件并原子写入。

### 5.4 凭证文件

```jsonc
{
  "schema": 1,
  "platform": "xhs",
  "endpoint": "web",
  "account": "default",                  // 游客文件为 "guest"
  "user": { "id": "5f...", "name": "...", "url": "..." },   // UserRef；游客为 null
  "method": "qrcode",                    // qrcode | sms | password | cookie | guest
  "created_at": "2026-09-27T12:00:00+08:00",
  "updated_at": "2026-09-27T12:00:00+08:00",
  "scopes": {                            // 子站点分区；单站点平台只有 main
    "main": {
      "cookies": [ { "name": "a1", "value": "...", "domain": ".xiaohongshu.com", "path": "/", "expires": null } ],
      "tokens": {}                       // ticket / ct0 / access_token / refresh_token 等
    },
    "creator": { "cookies": [], "tokens": {} }
  },
  "device": {},                          // 设备指纹、IM 私钥与证书、localStorage 等设备绑定数据
  "extra": {}                            // 平台私有字段
}
```

- cookie 统一存成带 domain 的列表。只导入了一段 cookie 字符串时，domain 取平台默认域。
- 凭证文件**只由 core 读写**。平台实现从 core 拿凭证，更新后交回 core 落盘。

### 5.5 配置与代理

`config.toml` 只有这几项：

```toml
proxy = "http://127.0.0.1:7890"   # 全局代理
timeout = 30                      # 单次请求超时（秒）

[xhs]
proxy = "socks5://..."            # 平台代理
```

- 代理的优先级：`--proxy` > `<platform>.proxy` > `proxy`。
- 不读取 `HTTP(S)_PROXY` 环境变量，代理只能显式配置。
- `catbus config set xhs.proxy <url>`，用点号表示平台段。

## 6. 输出

### 6.1 信封与格式

stdout 只输出结果。日志、提示、进度、二维码一律输出到 stderr。

信封：

```json
{ "ok": true, "platform": "xhs", "endpoint": "web", "resource": "item", "action": "get",
  "account": "default", "data": {}, "page": null, "error": null }
```

| 字段 | 说明 |
|---|---|
| `account` | 使用的账号名，游客为 `"guest"` |
| `page` | 分页命令为 `{ "cursor": "...", "has_more": true }`，其他命令为 `null` |
| `error` | 出错时 `ok` 为 false，`data` 为 null，`error` 为 `{ "code", "message", "hint", "detail" }`。`hint` 是建议执行的命令或做法，可以为 null |

全局命令的信封：
- `platform`、`endpoint`、`account` 都为 null；
- `resource` 是命令名，`action` 是子命令，没有子命令时为 null。
- 例如 `catbus auth list` 的 resource 是 `auth`，action 是 `list`。

`-o` 的两种格式：
- **`json`**（默认）：stdout 恰好输出一个信封，成功和失败都是。stdout 是 TTY 时缩进输出，否则输出紧凑的一行。
- **`jsonl`**：stdout 每行一个 `data` 条目。列表命令一行一条；非列表命令只有一行。
  - 结束时在 stderr 写一行摘要信封，`data` 为 null，带 `page` 和 `error`，用来取 next cursor 或错误信息。

`--raw`：用平台原始对象代替每个归一化对象，信封不变。

### 6.2 归一化类型

所有平台的同一种对象都输出同一结构。

**基础类型**：

| 类型 | 字段 |
|---|---|
| UserRef | `id name url` |
| Price | `amount currency`。`amount` 用货币主单位（元）的十进制数。虚拟货币也用它，`currency` 写平台货币代码 |
| Media | `id type url width height duration` |

**内容与互动**：

| 类型 | 字段 |
|---|---|
| User | `id name handle avatar url bio stats{followers following items likes}` |
| Item | `id kind url title text author:UserRef created_at cover media:Media[] stats{views likes comments collects shares} price:Price\|null status\|null` |
| Comment | `id item_id parent_id author:UserRef text created_at stats{likes replies}` |
| Folder / Series | `id name count url` |
| Category | `id name parent_id` |
| Keyword | `text heat` |
| Topic | `id name url stats{views items}` |
| Poi | `id name address` |

**直播**：

| 类型 | 字段 |
|---|---|
| Live | `id url title status host:UserRef cover stats{viewers}` |
| Event | `type time user:UserRef text gift{name count}\|null` |
| Gift | `id name price:Price` |
| Rank | `rank user:UserRef score` |

**消息与通知**：

| 类型 | 字段 |
|---|---|
| Conversation | `id peer:UserRef unread last_message updated_at` |
| Message | `id conversation_id from:UserRef type text media:Media[] created_at` |
| Notice | `id type user:UserRef target{id url}\|null text created_at` |
| NoticeCount | `total comment mention like follow system` |

**账号与本地**：

| 类型 | 字段 |
|---|---|
| AuthStatus | `logged_in user:UserRef\|null method expires_at` |
| Account | `platform endpoint account current user:UserRef\|null method updated_at` |
| File | `path type url size` |

**扩展类型**（见 4.7）：

| 类型 | 字段 |
|---|---|
| Subtitle | `lang name url lines[{from to text}]` |
| Danmaku | `id item_id offset text created_at`，`offset` 为视频内的秒数 |
| Order | `id status total:Price items:Item[] created_at` |
| Coupon | `id title discount:Price threshold:Price\|null start_at end_at` |

**枚举值**：

| 字段 | 取值 |
|---|---|
| Item.kind | `video` `image` `text` `article` `goods` |
| Item.status | `published` `reviewing` `rejected` `private` `draft`；商品另有 `on_sale` `sold` `off_shelf`。只有自己的内容和商品才有，其余为 null |
| Media.type | `image` `video` `audio` |
| Live.status | `live` `offline` |
| Event.type | `chat` `gift` `like` `enter` `follow` `other` |
| Message.type | `text` `image` `video` `card` `other` |
| Notice.type | `comment` `mention` `like` `follow` `system` |

规则：
- ID 一律是字符串。
- 计数是整数或 null，例如 "1.2万" → 12000。
- 时间用带时区的 ISO 8601。
- 字段总是存在，缺失时为 null 或 `[]`。
- 不追加平台私有字段；需要原始字段时用 `--raw`。
- 新增类型或字段，先改本节。

### 6.3 各命令的输出

读取类命令按资源返回对应类型。列表类命令返回数组，并带 `page`。

| 命令 | data |
|---|---|
| `user get` | User |
| `user search` / `followers` / `following` | User[] |
| `user items` / `likes` / `collects` / `reposts`，`item search` / `related` / `list`，`feed list`，`folder items`，`series items`，`history list`，`live replays` | Item[] |
| `item get`、`product get` | Item |
| `live products` | Item[]（`kind` 为 `goods`） |
| `item media`、`live media` | Media[] |
| `comment list` / `replies` | Comment[] |
| `live get` | Live |
| `live list` / `search` | Live[] |
| `live listen`（流） | Event |
| `live history` | Event[] |
| `live gifts` | Gift[] |
| `live rank` | Rank[] |
| `msg list` | Conversation[] |
| `msg history` | Message[] |
| `msg listen`（流） | Message |
| `notice list` | Notice[] |
| `notice count` | NoticeCount |
| `*categories` | Category[] |
| `keyword suggest` / `hot` | Keyword[] |
| `topic search` | Topic[] |
| `poi search` | Poi[] |
| `folder list` | Folder[] |
| `series list` | Series[] |
| `auth status` | AuthStatus |
| `auth list` | Account[] |
| `auth login` / `use` / `logout` | Account |

写操作的返回：

| 动作 | data |
|---|---|
| 成对动作、`delete`、`msg read` / `revoke`、`live send` / `like` / `stop` | `{id}`，即目标对象的 id |
| `item publish` | Item |
| `comment add` | Comment |
| `msg send` | Message |
| `media upload` | Media |
| `item download` | File[] |
| `folder create` / `update` | Folder |
| `live start` | `{id push{url key}}`，推流地址 |

全局命令的返回：

| 命令 | data |
|---|---|
| `platforms` | Platform[] `{id name aliases endpoints{web app pc} commands[{endpoint resource action auth status upstream note}]}`；带平台参数时返回单个对象 |
| `doctor` | `{name ok message}[]` |
| `config list` | 对象：只含已设置的项，键用点号展开，例如 `xhs.proxy` |
| `config get` | 值 |
| `config set` / `unset` | `{key value}` |
| `version` | `{version node platform arch}` |

### 6.4 退出码

| 退出码 | code | 含义 |
|---|---|---|
| 0 | — | 成功 |
| 1 | `ERROR` | 未分类错误 |
| 2 | `USAGE` / `UNSUPPORTED` / `CONFIRM_REQUIRED` | 参数错误 / 平台或端不支持该命令 / 危险操作未确认 |
| 3 | `AUTH_REQUIRED` / `AUTH_EXPIRED` | 未登录或登录态失效 |
| 4 | `NOT_IMPLEMENTED` | planned 的端或能力 |
| 5 | `RISK_CONTROL` | 验证码或风控，`detail.kind` 为 `captcha` / `rate_limit` / `blocked` |
| 6 | `NETWORK` | 网络 / 代理错误 |
| 7 | `UPSTREAM` | 平台返回业务错误，原始错误码放在 `detail` 里 |

## 7. 架构

### 7.1 技术栈

- **语言**：TypeScript，strict，ESM。用 `tsc` 编译到 `dist/`，发布的是编译后的 JS。Node 拒绝对 `node_modules` 里的文件做类型剥离，所以必须有编译这一步。
- **Node 版本**：`engines` 为 `^22.22.2 || ^24.15.0 || >=26.0.0`，跟随 jsdom 30 的要求。
- **测试**：vitest。
- **开发**：用 npm scripts，不引入额外的构建工具。

### 7.2 打包与分发

| 包 | 内容 |
|---|---|
| `catbus-cli` | `dist/`（CLI、core、全部平台）和 `static/`（上游签名 JS 等）。bin 为 `catbus` → `dist/cli/main.js` |
| `@cv-cat/catbus-assets-jd` | JD 验证码（JCAP）的 onnx 模型，约 81 MB。作为 `catbus-cli` 的普通依赖，精确钉版本 |

- 拆出 assets-jd 是因为模型很少变。放在主包里的话，每次发版都要上传 81 MB。
- assets-jd 的源码在 `packages/assets-jd/`，是 npm workspace，开发时直接链接。
- 模型文件不进 git，由 `npm run assets:jd`（`scripts/fetch-jd-models.mjs`）按 `src/platforms/jd/UPSTREAM` 的 commit 取回并校验 sha256：有 `references/JdApis` 时从本地复制，否则从 GitHub 下载。打包 assets-jd 时会自动执行。
- catbus 自己**不做**按系统划分的运行时包。原生依赖（HTTP 库、`@napi-rs/canvas` 等）各自通过 `optionalDependencies` 带上本机的预编译包。
- `npm i` 之后完全离线可用，npmmirror 可以完整镜像。
- **目标系统**：
  - win32-x64、win32-arm64；
  - darwin-arm64、darwin-x64；
  - linux-x64、linux-arm64，glibc 和 musl 都要支持。
- CI 在全部目标系统上跑冒烟测试，musl 用 Alpine。**任何一个目标系统缺预编译包的依赖都不能用。**
- 发布：推送 `v*` tag 触发 `.github/workflows/release.yml`，先跑完整 CI，再发布 CI 里测过的同一份 tarball。
  - 顺序：先发 assets-jd（该版本还没发布时），再发 `catbus-cli`。
  - 需要仓库 secret `NPM_TOKEN`，对 `catbus-cli` 和 `@cv-cat` org 有发布权限；在 npm 上配好 trusted publishing 后可以改用 OIDC。
  - 仓库目前是私有的，发布不带 `--provenance`（npm 只给公开仓库生成 provenance）。仓库公开后再加回来。
- 以后要提供 SDK 时，通过 `package.json` 的 `exports` 暴露，现在不做。

### 7.3 依赖选型

原则：
- 优先纯 JS / WASM。
- 原生依赖必须在全部目标系统上都有预编译包，不能有 install 脚本，也不能需要 node-gyp。
- 一律用最新版，由 `package-lock.json` 锁定。

| 用途 | 选择 |
|---|---|
| 带浏览器 TLS / HTTP2 指纹的 HTTP（替代 curl_cffi） | wreq-js：JA4 / H2 指纹与真 Chrome 一致，可关闭默认头以精确控制头顺序。impit 指纹不符、没有 WebSocket，不用 |
| WebSocket | wreq-js 自带的 `websocket()`，与 HTTP 同指纹、共享 cookie |
| protobuf | protobufjs。它的 Reader 也用来做无 schema 解码，替代 blackboxprotobuf |
| onnx 推理 | onnxruntime-web（WASM）。太慢再换 onnxruntime-node |
| 图像处理 | @techstark/opencv-js |
| 图片编解码 | @napi-rs/canvas，不用 sharp |
| 验证码 OCR | 移植 ddddocr：模型跑在 onnxruntime-web 上，可参考 ddddocr-node |
| 签名 JS 的依赖 | jsdom（JD）、crypto-js（XHS）、@napi-rs/canvas（JD、KS） |
| 校验 | zod |
| 参数解析 | `node:util` 的 `parseArgs`，加上注册表。不用 CLI 框架 |
| 配置 | smol-toml |
| 终端二维码 | qrcode |
| 日志 | 自己写的 stderr logger，负责给凭证打码 |

onnxruntime-web 的性能在 M1 的冒烟测试里验证，不通过再换 onnxruntime-node。

wreq-js 默认会读 `HTTP(S)_PROXY` 环境变量和 Windows 系统代理。为遵守 5.5，`core/http` 在启动时设置 `NO_PROXY=*`，代理只通过 per-request 的 `proxy` 传入。

### 7.4 签名 JS

- 上游的签名 JS **原样复制**到 `static/<p>/`，进版本控制，不手改。需要适配的地方在 TS 一侧包装。
- **执行方式**：放到 `node:vm` 的 context 里执行。
  - context 按脚本懒创建，创建后复用。
  - 需要 DOM 的脚本（JD）注入 jsdom。
  - `require` 用 `createRequire` 指向 catbus 自己的 `node_modules`，这样 `crypto-js` / `jsdom` / `@napi-rs/canvas` 从主包依赖里解析。
- 原来按命令行脚本写的 JS（读 argv / stdin、往 stdout 打印），由 TS 包装层喂参数、收结果。
- vm 跑不了的脚本（依赖进程级状态等），退回到 `worker_threads`，或者用 `process.execPath` 起子进程。
- 上游 Python 里围绕 JS 的胶水代码，以及纯 Python 实现的签名（如 wbi、mtop sign），都移植成 TS。

### 7.5 移植与对拍测试

- **移植**：上游 Python 的请求构造、签名、解析逻辑都重写成 TS。行为以上游为准：同样的输入，产出同样的请求（URL、query、header、body、签名）。
- **对拍数据**：用 `scripts/golden/<p>/gen.py` 生成，框架是 `scripts/golden/catbus_golden.py`。
  - 在开发机上用 Python 3.13 + uv 建一个不进 git 的虚拟环境 `.golden/<p>/`（`uv venv .golden/<p> --python 3.13`，再装上游的依赖），运行 `references/` 里的上游代码。
  - 框架替换了 Python 的 `random` / `secrets` / `uuid` / `os.urandom` / `time`，并截获 curl_cffi 与 requests 的请求（不联网，按用例给的响应回复）；上游起的 node 子进程通过 `NODE_OPTIONS` 预加载 `node_determinism.cjs`，固定 `Math.random` 与 `Date`。
  - 时区固定为北京时间（`Asia/Shanghai`）：框架会设置 `TZ`，TS 侧的测试在 `vitest.config.ts` 里固定同一时区。
  - 输出到 `tests/golden/<p>/<case>.json`。**只能用假凭证。**
- **对拍测试**：`tests/<p>.test.ts` 用 `tests/golden.ts` 的 `replay()` 在同样的随机数与时钟下运行 TS 实现，`expectRequests()` 逐字节比较请求（URL、header 顺序、cookie、body）。请求构造和签名都必须有对拍测试。
- **平台实现的约定**（参考实现是 `src/platforms/bilibili/web/`）：
  - 文件：`client.ts`（会话：设备初始化、签名密钥、带重试的请求、业务码 → 错误）、`api.ts`（一个函数对应一个上游方法，字段与顺序照抄）、`commands.ts`（命令 handler）、`normalize.ts`（原始对象 → 6.2 的类型，挂上原始对象供 `--raw`）、`resolve.ts`（参数归一化）。
  - 随机数和当前时间只经 `core/rand.ts`，等待用 `rand.sleep`；与 Python 对应的编码（`urlencode`、`quote`、`json.dumps`）用 `core/py.ts`；需要精确键序的 JSON 用 Map。
  - HTTP 用 `core/http.ts` 的 `HttpClient`（`toolkit.httpClient(ctx)`），请求头按上游顺序显式给出；cookie 在凭证的 cookie 罐里，Set-Cookie 自动写回，命令结束时由 core 落盘。
  - 签名 JS 复制到 `static/<p>/`，用 `core/vm.ts` 的 `loadScript` / `callScript` 执行。
  - 业务错误映射到 6.4 的错误码：登录墙 → `toolkit.authError`，风控 → `RISK_CONTROL`，其余 → `UPSTREAM`（原始错误码放 `detail`）。
- **上游基线**：`src/platforms/<p>/UPSTREAM` 记录上游仓库地址和 commit。
- **上游更新时**：
  1. 用 `git -C references/<repo> log <commit>..` 查看变更；
  2. 同步移植；
  3. 重新生成对拍数据；
  4. 更新 UPSTREAM。
- **在线测试**：`npm run test:e2e`，用单独的配置 `vitest.e2e.config.ts`，不在 `npm test` 和 CI 里。使用开发者本机 `~/.catbus` 里的登录态，没登录的平台整组跳过；`npm run test:e2e -- -t <platform>` 只跑一个平台。
  - 只跑只读命令：从注册表枚举每个平台已实现的读取类命令，前面命令返回的对象（item、用户、评论、直播间、会话、收藏夹……）的 `url` 或 `id` 作为后面命令的参数，逐条校验信封和 6.2 的字段结构。写操作、下载、长连接不跑。
  - 命令之间默认间隔 1.5 秒，小红书 4 秒，避免触发风控。子站点没登录（`AUTH_REQUIRED`）和平台风控（`RISK_CONTROL`）记为跳过。
  - 每条命令的信封（列表只留前 3 条）写到 `.e2e/<platform>.json`，不进版本控制，用来检查归一化的字段是否取到了值。
- **CI**（`.github/workflows/ci.yml`）：只跑离线测试，再加上全部目标系统的冒烟测试（`scripts/smoke.mjs`），冒烟测试包括：
  - 安装包；
  - 运行 `version`、`doctor`、`platforms`；
  - 跑一次签名 vm；
  - 加载原生依赖。

### 7.6 能力注册表

每个平台的 `src/platforms/<p>/index.ts` 导出平台声明：

```ts
export default definePlatform({
  id: 'xhs', name: '小红书', aliases: ['xiaohongshu', 'rednote'], item: '笔记',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode', scopes: ['creator'] },
      commands: {
        'user get': 'full',
        'item get': { upstream: 'full', handler: () => import('./web/item.js').then((m) => m.get) },
        'feed list': { upstream: 'partial', options: { kind: filter.kind('recommend', 'following') } },
        'order list': { upstream: 'full', summary: '订单列表', args: [], output: 'Order[]',
                        auth: 'required', paged: true },                   // 扩展命令（示意）：字段写全
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
```

- 第 4.5 节词表里的命令，默认的 summary、args、选项、auth、output 都来自 `src/core/vocab.ts`（summary 里的 `{item}` 替换成平台的 item 叫法）。平台只写与默认不同的部分。
- 命令的值可以是 `'full' | 'partial' | 'none'` 的简写，也可以是对象。
- 矩阵里 — 的命令不写。
- `auth list` / `use` / `logout` 由 core 自动注册。
- 端的字段：`login`（登录方式与子站点）、`logout?`（服务端登出）、`guest?`（是否支持游客态，默认 false）、`commands`。`guest` 为 false 时，除 `auth` 外的命令一律按 `auth: required` 处理，声明 `optional` 会在启动时报错。web 端都不设 `guest`。

命令的字段：

| 字段 | 说明 |
|---|---|
| `summary` | 一句话说明 |
| `args` | 位置参数 |
| `options` | 私有选项和筛选取值，用 zod 声明 |
| `auth` | `required` / `optional`；只在 `guest: true` 的端上可以是 `optional` |
| `confirm?` | 是否需要危险操作确认 |
| `stream?` | 是否长连接 |
| `paged?` | 是否分页 |
| `output` | 输出类型名 |
| `upstream` | 上游支持程度：`full` / `partial` / `none`，即矩阵里的 ✓ / ◐ / ○ |
| `note?` | 能力说明，例如"只支持图文" |
| `handler?` | 动态 import，懒加载。有 handler 的命令 status 为 `implemented`，否则为 `planned` |

注册表是唯一的事实来源，以下都从它生成：
- argv 解析、`--help`；
- `catbus platforms`；
- NOT_IMPLEMENTED / UNSUPPORTED 的判定；
- `docs/capabilities.md`：用 `npm run gen:capabilities` 生成，不手改，测试会检查它是否最新；
- 将来的 MCP 工具，工具名为 `<platform>_<resource>_<action>`。

执行一条命令时只加载这一个平台的这一个 handler，不会连带加载别的平台的依赖（如 JD 的 onnx）。

### 7.7 目录结构

```
All-In-One/
├── AGENTS.md  CLAUDE.md
├── package.json  tsconfig.json     # npm 主包 catbus-cli
├── assets/                         # logo、banner
├── docs/
│   ├── capabilities.md             # 能力矩阵（由注册表生成，不手改）
│   └── upstream-map.md             # 上游移植对照
├── references/                     # 上游仓库：只读，不进版本控制
├── src/
│   ├── cli/                        # 入口 main.ts、argv 解析、帮助、信封输出、确认
│   ├── core/                       # registry、auth store、config、errors、http、schemas、signing(vm)、log
│   └── platforms/<p>/
│       ├── index.ts                # 平台声明与命令注册
│       ├── UPSTREAM                # 移植所基于的上游仓库与 commit
│       └── web/                    # web 端实现；app/、pc/ 等真正实现时再建
├── static/<p>/                     # 上游签名 JS、proto 等，原样复制
├── packages/assets-jd/             # @cv-cat/catbus-assets-jd
├── scripts/golden/<p>/             # 调用上游 Python 生成对拍数据
└── tests/                          # vitest；golden/<p>/ 放对拍数据
```

`.gitignore`：`references/`、`node_modules/`、`dist/`，以及 `packages/assets-jd/` 下的模型文件。

### 7.8 provider 协议（M4）

给将来的非 JS 上游（Go / Java……）用：任意语言的可执行文件，以子进程形式运行，通过 stdin / stdout 传 JSON。

- **清单**：`provider.json` 声明 `id`、支持的 platform / endpoint、能力列表（`resource.action`，同样遵守第 4 节词表）和启动命令。
- **安装位置**：`~/.catbus/providers/<name>/`，或者 npm 包 `@cv-cat/catbus-provider-<name>`。
- **请求**：core 往 stdin 写一个 JSON：`{v, platform, endpoint, resource, action, args, options, account, credential}`。
- **响应**：provider 往 stdout 逐行写 JSON，消息类型有：
  - `result`：最终结果；
  - `item`：流式条目；
  - `credential_update`：刷新后的凭证；
  - `error`：错误，code 取 6.4。
- **日志**：写到 stderr，core 原样转发。
- **凭证**：provider 不直接读写 `~/.catbus/`。凭证由 core 放在请求里给它，更新后通过 `credential_update` 交回，由 core 落盘。
- **注册表**：provider 的能力合并进注册表，`platforms`、`--help`、NOT_IMPLEMENTED 对它一视同仁。

## 8. 开发约定

- **语言**：与用户沟通用中文；面向用户的文字用中文；代码标识符用英文。
- **工具链**：
  - 用户侧只需要 Node（版本见 7.1）。
  - 开发侧需要 Node、Python 3.13 和 `uv`。Python 只用来生成对拍数据。
- **依赖**：不引入需要现场编译的依赖（node-gyp、install 脚本）。新增原生依赖前，先确认全部目标系统都有预编译包。
- **凭证**：严禁把真实 cookie / token / 私钥写进代码、测试 fixture、日志或提交记录。凭证只在 `~/.catbus/` 里。logger 对 cookie、token、Authorization 等字段打码。
- **stdout 纯净**：调试输出一律走 stderr / logger。
- **新增命令**：
  1. 先查第 4 节词表，不够用就先改本文件；
  2. 在注册表里声明；
  3. 再实现。
- **移植**：
  - 移植以上游行为为准，请求构造和签名必须有对拍测试。
  - 发现上游 bug 时，修到对应的上游仓库，再按新 commit 重新同步。
- **`references/`**：只读。可以运行，可以在 gitignore 的位置装依赖，但不能修改受版本控制的文件。
