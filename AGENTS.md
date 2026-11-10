# AGENTS.md — catbus（猫巴士）

> 本文件是本项目给所有 AI 编码代理（Claude Code / Codex / Cursor 等）的统一说明，也是 catbus 的规范本身。
> `CLAUDE.md` 通过 `@AGENTS.md` 引用本文件，**只维护这一份**。

## 1. 目标

做**一个 CLI —— 操作各大平台接口的统一入口**。

- 一个命令 `catbus`，按统一的命令规范调用 10 个平台：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。另有直接对接官方接口的 12306 和 YouTube（见第 3 节）。
- 能力来源是作者 [cv-cat](https://github.com/cv-cat) 的 10 个开源仓库，已克隆到 `references/`，作为**只读的原始来源**。
- 所有平台都在本仓库里**用 TypeScript 重写**，不在运行时调用上游的 Python。
- **用户只需要安装 Node**（版本见 7.1）。不需要 Python，不需要 C/C++ 编译器，也不需要其他系统依赖。例外：`youtube` 的 `item publish` / `item delete` 需要本机的 Chromium（见 5.7）。
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
| npm scope | `@cv-cat`，用于 `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` 和将来的 provider 包 |
| 仓库 | https://github.com/cv-cat/catbus ，默认分支 `master` |
| 许可证 | MIT（主包、assets-jd、assets-ocr 相同） |
| 数据目录 | `~/.catbus/`，可用 `CATBUS_HOME` 覆盖 |
| 环境变量前缀 | `CATBUS_` |
| Logo | 吉祥物是一位 Q 版的巴士车掌小姐（原创角色）：深藏青色短卷发、一侧小辫系红发带、琥珀色大眼睛，戴红色帽带和金色巴士徽章的车掌帽，藏青双排扣制服、红领结、白手套、棕色挎包，举着一张印着 `>_` 的车票，挎包里有时探出一只小黑猫；白边贴纸风格。图由图像模型生成，角色描述、画风和每张图的用途见 `scripts/assets/mascot.md`，新图沿用同一段角色描述。`assets/logo.png`（透明底）是主图，`assets/stickers/` 是 README 里的其他姿势，`assets/banner.txt` 是终端字符画（沿用 `( >ω_ )`）。配色取自吉祥物：藏青 `#232838`、红 `#E8414F`，不用橙色和紫色。README 里的图（`hero-<语言>-<主题>`、`platforms-<主题>`）和 `social-preview.png` 都由 `scripts/gen-assets.mjs` 生成（`npm run gen:assets`），不手改：首屏左边是字标 `catbus`、标题、副标题和安装命令 `npm i -g catbus-cli`，右边是吉祥物；字体都是 OFL（Nunito、Geist Mono、Noto Sans 的简中、日文、韩文），第一次运行时下载到 `.cache/fonts/`，图里的字全部转成轮廓，随语言变化的文案每种语言出一张图；平台图一律用各平台真实的图标（`scripts/assets/logos/`，来源见其中的 `SOURCES.txt`），在路上的平台同样是原色，只在右上角挂 `soon` 标签；图上的平台列表与注册表对账，不一致时生成脚本报错 |

## 2. 范围

- 目前支持第 3 节的 15 个平台的 web 端（10 个内容与电商平台 + 12306 铁路平台 `12306` + YouTube `youtube` + 即梦 `jimeng` + 猫眼演出 `maoyan` + M-Team `mteam`）；app / pc 端在注册表里为 planned（见 4.3）。
- `jimeng` 不调用平台接口，只保存和切换即梦官方 CLI `dreamina` 的登录态，是第 1 节「只需要 Node」「支持全部目标系统」的例外：需要另外安装 `dreamina`，只支持 macOS（见 5.6）。`youtube` 的 `item publish` / `item delete` 同样是「只需要 Node」的例外，需要本机的 Chromium（见 5.7）。
- 矩阵里的 ○（平台有这个概念、上游没有的能力）只占位：注册为 planned，执行时返回 NOT_IMPLEMENTED，有需要时再实现。移植中发现矩阵与上游不符（上游其实没有、或只是占位）的能力，按上游实际情况标为 ○ 或 ◐，以 `docs/capabilities.md` 为准。
- 新平台开始移植时，先把平台 id、别名、`item` 叫法等登记到第 3 节、4.2 和 4.5，再进注册表；在那之前 `catbus <平台>` 是未知平台（`USAGE`）。
- 改规范先改本文件，再写代码。

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
| 12306 | （无上游仓库，直接对接 12306 官方公开接口） | `https://kyfw.12306.cn`（接口端点见 `src/platforms/12306/UPSTREAM`） |
| youtube | （无上游仓库，直接对接 YouTube web 端的 InnerTube 接口） | `https://www.youtube.com/youtubei/v1/`（接口端点见 `src/platforms/youtube/UPSTREAM`） |
| jimeng | （无上游仓库，封装即梦官方 CLI `dreamina` 的登录态） | `dreamina` 的子命令与钥匙串项（见 `src/platforms/jimeng/UPSTREAM`、5.6） |
| maoyan | （无上游仓库，直接对接猫眼演出公开接口） | `https://yanchu.maoyan.com`、`https://m.dianping.com`（接口端点见 `src/platforms/maoyan/UPSTREAM`） |
| mteam | （无上游仓库，直接对接 M-Team 官方 API） | `https://api.m-team.cc/api`（来源与验证范围见 `src/platforms/mteam/UPSTREAM`） |

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
- 没有上游仓库的平台（`12306`、`maoyan`、`youtube`）直接对接官方接口：`UPSTREAM` 记录对接的服务端点与接口说明；离线测试不采用 Python 对拍（golden），改用基于真实响应裁剪的 fixture，通过 `mockSender` / `fakeResponse` 回放测试。
- `jimeng` 平台没有上游仓库，也不发 HTTP 请求：`UPSTREAM` 记录验证过的 `dreamina` 版本、用到的子命令和钥匙串项；离线测试替换 `dreamina` 子进程和钥匙串读写（`tests/jimeng.test.ts`）。
- `mteam` 平台通过官方 API Key 或网页账密登录的令牌调用接口，无 Python 上游；离线测试使用假凭证与合成响应，通过 `mockSender` / `fakeResponse` 校验请求和输出，不保存真实账号数据。

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
| `12306` | — |
| `youtube` | `yt` |
| `jimeng` | `dreamina` |
| `maoyan` | — |
| `mteam` | `mt`, `m-team`, `mantou` |

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
| `user` | 用户 | `get` `search` `items` `likes` `collects` `reposts` `followers` `following` `follow` `unfollow` `update` |
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
| youtube | 视频 |
| jimeng | 作品（目前没有 item 命令） |
| maoyan | 演出项目 |
| mteam | 种子资源（输出 Torrent，含统一 Item 字段及 PT 元数据） |

各动作的说明：
- `item list`：当前账号自己发布的内容，带审核状态，数据来自创作者中心。
- `item related`：相关推荐。
- `item media`：可播放 / 可下载的媒体地址。
- `item download`：下载到本地。
- `item categories`：发布和搜索时 `--category` 的取值。
- `feed list --kind recommend|hot|following`：默认 `recommend`。
- `user update`：修改当前账号的资料（昵称、头像、简介），只改给出的字段。
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
| mteam | `auth login [--api-key-file <文件> \| --api-key-stdin]` | 官方 API Key 登录，默认 `--method apikey`；TTY 下省略选项时隐藏输入。凭证写入 `scopes.main.tokens.api_key`，不接受命令行明文 Key | Account |
| mteam | `auth login --method password --username <name> --password-stdin [--email <邮箱>] [--code <验证码>]` | 网页账密登录（`/login`，请求带网页前端的 HMAC 签名）。新设备要两步验证（code 1001）：邮箱方式先用 `--email` 让站点发码，非 TTY 下保存中间态（10 分钟有效，不含密码）后返回 `{sent, verify}`，再带 `--code` 重新执行一次（密码仍从 stdin 读）；TOTP 方式直接带 `--code`。凭证写入 `scopes.main.tokens` 的 `auth`（JWT）、`did`、`visitor_id`；站内信只支持这种登录 | Account |
| mteam | `item search <kw>` / `feed list` `[--mode normal\|movie\|tvshow\|music\|anime\|adult] [--category <id>] [--free] [--order-by date\|size\|seeders\|leechers\|name] [--asc]` | 资源搜索 / 浏览，默认综合区 normal；`--free` 只看免费资源；私有选项 `--order-by` 按字段排序（默认降序，`--asc` 升序；站点置顶的资源总在最前）；沿用 `--limit` / `--cursor` / `--all`。`feed list` 表示浏览最新资源，`item list` 仍保留“自己的投稿”语义 | Torrent[] |
| mteam | `item get <item>` / `item categories` / `item download <item> [--qbit] [--qbit-category <name>] [--qbit-paused] [--qbit-savepath <dir>]` | 详情 / 分类 / 下载 `.torrent` 文件；下载沿用 `--dir` / `--overwrite`。文件可能包含 Tracker 凭证，权限 0600，输出 File.url 为 null，不输出临时下载链接。私有选项 `--qbit` 下载后推送到本机 qBittorrent Web UI（`CATBUS_MTEAM_QBIT_URL`，默认 `http://127.0.0.1:25254`，直连、不走代理，默认分类 `mteam`，`--qbit-savepath` 指定保存目录，不给时用 qBittorrent 自己的设置）；qBittorrent 回复 `Fails.`（通常是已在任务列表）时只在 stderr 警告 | Torrent / Category[] / File[] |
| mteam | `item collect` / `item uncollect <item>` / `user collects [me] [--mode <分区>]` | 收藏 / 取消收藏（接口按目标状态设置，重复执行不报错）/ 收藏列表（按分区，默认 normal） | `{id}` / Torrent[] |
| mteam | `seed list [--status seeding\|leeching\|completed\|incomplete\|uploaded]` | 我的做种 / 下载中 / 已完成 / 未完成 / 已发布列表，默认 `seeding`；本账号在该种子上的上传、下载、分享率写进 `text`。分页沿用 `--limit` / `--cursor` / `--all` | Torrent[] |
| mteam | `seed stats` | tracker 上当前的做种数和下载数（`/tracker/myPeerStatus`） | `{seeding leeching}` |
| mteam | `exam get` | 进行中的考核（新人考核等）进度（`/examine/getMyActiveList`）：`items` 依次为 `download` / `upload`（字节）和 `bonus`（魔力值），各带 `current target done`；没有进行中的考核时返回空数组 | `{id title status start_at end_at note items[{name current target done}]}[]` |
| mteam | `bonus get` | 时魔（`/tracker/mybonus`）：`per_hour` 每小时魔力值、`a` A 值、`seeding_count` / `seeding_size_gb` 计入时魔的做种数和体积（GB）、`two_factor` 是否开启两步验证 | `{per_hour a seeding_count seeding_size_gb two_factor}` |
| mteam | `bonus history` | 魔力值、上传量、下载量的变动记录（`/credit/logs`）：`change` 为魔力值变化，上传 / 下载变化写进 `note`；站点不给变动前后的余额，`before` / `after` 为 null | BonusRecord[] |
| mteam | `msg list [--box inbox\|system\|sent]` / `msg history <conversation>` | 站内信列表（收件箱 / 系统通知 / 发件箱，每条站内信作为一个会话）/ 读取一条站内信。只读，读取不会标记已读；只支持账密登录的会话，API Key 会话报 `UNSUPPORTED` | Conversation[] / Message[] |
| tiktok | `folder add <folder> <item>` | 把视频加入收藏夹（一次一个视频）。TikTok 只能把已收藏的视频加进收藏夹 | `{id}`（视频 id） |
| tiktok | `folder create <name> [--visibility public\|private]` | 收藏夹公开 / 私密：用 4.9 的标准选项 `--visibility`，只取 `public`、`private`；默认 `private`（与上游一致） | Folder |
| tiktok | `folder update <folder> [--name <name>] [--visibility public\|private]` | 同上。`--name`、`--visibility` 至少给一个，没给的保持原值 | Folder |
| tiktok | `item publish [--allow-comment on\|off]` | 私有选项：允许评论，默认 `on` | Item |
| tiktok | `item publish [--allow-duet on\|off]` | 私有选项：允许合拍（Duet），默认视频 `off`、图文 `on`（照上游） | Item |
| tiktok | `item publish [--allow-stitch on\|off]` | 私有选项：允许拼接（Stitch），默认视频 `off`、图文 `on`（照上游） | Item |
| tiktok | `item publish [--allow-content-reuse on\|off]` | 私有选项：允许他人复用内容，默认 `on` | Item |
| tiktok | `item publish [--allow-ai-remix on\|off]` | 私有选项：允许 AI 改编，默认 `on` | Item |
| bilibili | `item coin <item> [--count 1\|2] [--like]` | 投币；`--like` 同时点赞 | `{id}` |
| bilibili | `item triple <item>` | 一键三连 | `{id}` |
| bilibili | `item edit <item> [--video <文件>] [--title <标题>] [--text <简介>] [--cover <16:9 图>] [--cover43 <4:3 图>] [--schedule <ISO 时间>\|none] [--tag <标签>...] [--category <分区 id>] [--visibility public\|private]` | 编辑已投稿件；给出 `--video` 时替换视频（先上传新文件，再走 `x/vu/web/edit`），不给则只改资料，分 P 沿用原稿的 `filename` + `cid`，可见性沿用原稿的 `is_only_self`，提交后重新审核。缺省沿用原标题/简介/封面/标签/分区。B 站封面分 16:9（`--cover`，播放页）与 4:3（`--cover43`，稿件列表页）两张，只给一张时另一张沿用原图。`--schedule` 改期、`none` 取消定时，不给时沿用原稿的定时 | Item |
| bilibili | `item subtitles <item>` | 字幕 | Subtitle[] |
| bilibili | `danmaku list <item>` | 视频弹幕 | Danmaku[] |
| bilibili | `danmaku send <item> <text> --offset <秒> [--color] [--font-size] [--position]` | 发视频弹幕。`--color` 为 `#RRGGBB` 或十进制，`--font-size` 默认 25，`--position scroll\|top\|bottom` 默认 `scroll` | `{id}` |
| bilibili | `dynamic publish --text [--image]` | 发动态 | `{id url}` |
| bilibili | `dynamic delete <id>` | 删动态。`<id>` 为动态 ID 或动态链接（`dynamic publish` 输出的 `id`、`url` 都可以） | `{id}` |
| bilibili | `article publish --title --text [--category] [--tag] [--summary] [--draft]` | 发专栏：先存草稿，再提交。`--category` 为专栏分区 ID（数字，默认 0），没有对应的 categories 命令；`--summary` 为摘要；`--draft` 只存草稿、不提交。上游没有专栏封面，所以没有 `--cover` | `{id url}` |
| bilibili | `draft get <id>` | 专栏草稿 | Item（`kind` 为 `article`，`status` 为 `draft`） |
| bilibili | `draft delete <id>` | 删专栏草稿 | `{id}` |
| bilibili | `user items <user> [--keyword <词>]` | 私有选项：只看投稿里匹配关键词的 | Item[] |
| bilibili | `item collect` / `uncollect <item> [--folder <收藏夹 id>]` | 私有选项：收藏进 / 移出指定收藏夹，多个用逗号分隔。不给时收藏进第一个收藏夹，取消时从所有收藏夹移出 | `{id}` |
| bilibili | `item publish [--source <来源>] [--dynamic <文案>] [--allow-reprint] [--cover43 <4:3 图>]` | 私有选项：`--source` 表示转载并给出来源，不给为自制；`--dynamic` 为同步到动态的文案；默认禁止转载，`--allow-reprint` 允许；`--cover43` 是稿件列表页的 4:3 封面，和 `--cover`（播放页 16:9）一起构成 B 站的双封面 | Item |
| bilibili | `comment add <item> <text> --reply-to <comment> [--root <comment>]` | 私有选项：回复楼中楼时 `--root` 给根评论、`--reply-to` 给被回复的那条；不给 `--root` 时 `--reply-to` 就是根评论 | Comment |
| bilibili | `comment pin <item> <comment>` / `comment unpin <item> <comment>` | 置顶 / 取消置顶一级评论（`x/v2/reply/top`）。只能置顶自己管理的评论区里的一级评论；已有置顶时再置顶报 12029 | `{id}`（评论 ID） |
| bilibili | `live send <room> <text> [--color] [--font-size] [--position] [--reply-user <user>]` | 私有选项：弹幕样式同 `danmaku send`；`--reply-user` 为回复的观众（UID 或空间链接） | `{id}` |
| xianyu | `item publish [--original-price <金额>]` | 私有选项：原价（元），要和 `--price` 一起用 | Item |
| xianyu | `item publish [--shipping free\|distance\|fixed\|none]` | 私有选项：运费方式，默认 `free` 包邮；`distance` 按距离计费，`fixed` 一口价，`none` 无需邮寄 | Item |
| xianyu | `item publish [--postage <金额>]` | 私有选项：一口价运费（元），配合 `--shipping fixed` | Item |
| xianyu | `item publish [--pickup]` | 私有选项：支持自提 | Item |
| douyin | `item search <kw> [--length all\|short\|medium\|long] [--range all\|seen\|unseen\|following]` | 私有选项：视频时长（不限 / 1 分钟内 / 1–5 分钟 / 5 分钟以上）、搜索范围（不限 / 看过 / 没看过 / 关注的人）。`--type video` 走视频频道搜索，其余走综合频道（筛选值随 `filter_selected` 发出）；`--type image` 只要图文 | Item[] |
| douyin | `user search <kw> [--fans 0_1k\|1k_1w\|1w_10w\|10w_100w\|100w_] [--user-type common\|enterprise\|personal]` | 私有选项：粉丝数区间、用户类型（普通 / 企业 / 个人认证） | User[] |
| douyin | `item publish [--poi-name <名称>] [--series <合集 id>] [--hotspot <热点词>] [--no-download]` | 私有选项：地点名称（配合 `--poi`）、加入合集、关联热点、不允许下载 | Item |
| douyin | `item collect <item> --folder <folder>`、`item uncollect <item> --folder <folder>` | 私有选项：收藏后移进某个收藏夹 / 从某个收藏夹移出（仍保留收藏）。`<folder>` 是收藏夹 ID 或名字 | `{id}` |
| douyin | `msg send [--file <path>] [--share <item\|user\|url>]` | 私有选项：发文件（≤10MB）、分享作品 / 用户名片 / 网页卡片 | Message |
| douyin | `live rank <room> [--ranking contribution\|thousand]` | 私有选项：榜单，默认贡献榜，`thousand` 为千票榜 | Rank[] |
| douyin | `live like <room> [--count N]` | 私有选项：一次点赞的次数 | `{id}` |
| douyin | `comment list <product> --product [--label <标签名或 id>]` | 私有选项：商品评价按标签筛选（好评 / 差评 / 有图等） | Comment[] |
| douyin | `notice list [--group all\|fans\|mention\|comment\|like\|danmaku]` | 私有选项：通知分组，不带时为默认分组 | Notice[] |
| xhs | `item publish [--poi-name <名称>] [--poi <id>]` | 私有选项：地点名称。小红书的地点只能按名称搜，搜不到 id，所以 `--poi` 要和 `--poi-name` 一起用（取 id 相同的那个）；只给 `--poi-name` 时取名称完全相同的。都找不到时报 `USAGE` 并列出相近的地点 | Item |
| weibo | `item publish [--poi-name <名称>]` | 私有选项：地点名称，发成「#名称[地点]#」的地点标签。微博发布没有地点 id，不支持 `--poi` | Item |
| douyin | `auth login --method sms --sso` | 私有选项：短信登录改走 `login.douyin.com` 页的 SSO 链 | Account |
| jd | `order list` | 订单 | Order[] |
| jd | `order list [--range 3m\|this_year\|<年份>]` | 私有选项：订单的时间范围。`3m` 近三个月（默认），`this_year` 今年内，`2025` 这样的四位年份表示那一年 | Order[] |
| jd | `cart count` | 购物车数量 | `{count}` |
| jd | `coupon list <item>` | 商品可用优惠券 | Coupon[] |
| jd | `item get` / `item search` / `item related` / `coupon list` / `cart count` / `history list` / `user collects` `[--area <地区编码>]` | 私有选项：收货地区，影响价格和库存。取值是京东的地区编码 `省_市_区_镇`，用 `_` 或 `-` 分隔，例如 `1_2800_55812_0`；默认取登录态里的 `ipLoc-djd` cookie，没有时为 `1_2800_55812_0` | Item / Item[] / Coupon[] / `{count}` |
| jd | `msg send <text> --order <订单> [--item <item> \| --conversation <venderId>]` | 私有选项：按订单咨询客服，会话和消息都带上订单号。`<订单>` 是订单号（`order list` 输出的 id），也接受订单详情页 URL。可以和 `--item`、`--conversation` 之一一起用；单独用时联系京东自营客服 | Message |
| x | `item publish [--thread <text> ...]` | 私有选项：发 thread。`--text` 是第一条，每个 `--thread` 是后面的一条，依次回复上一条；`--image` / `--video` / `--quote` 只作用于第一条。返回第一条 | Item |
| x | `article publish --text [--title] [--cover]` | 发文章（Premium 长文）：`--text` 是 Markdown，依次建草稿、写标题、正文、封面，再发布。不给 `--title` 时取正文第一行的 `# 标题`。独占一行的 `![](图片)` 上传成插图，相对路径按 `--text @file` 的文件所在目录解析（直接给正文时按当前目录） | `{id url}` |
| x | `article delete <article>` | 删文章：草稿或已发布的都可以，已发布的连同文章推文一起删 | `{id}` |
| youtube | `channel create [--name <名称>] [--handle <handle>]` | 给当前 Google 账号开 YouTube 频道（上传、评论、直播聊天都要求有频道）。名称默认用账号名，handle 默认用 YouTube 推荐的；已有频道时报 `USAGE` | User |
| maoyan | `feed list [--city <城市>]` | 私有选项：城市，城市名或演出城市 ID（`poi search` 输出的 `id`），默认北京 | Item[] |
| maoyan | `item get <item> [--tickets]` | 私有选项：同时查场次、票档、实售价、余票，逐行追加到 `text`，原始字段在 `--raw` 的 `shows`。只有这个选项需要登录，未登录报 `AUTH_REQUIRED` | Item |
| 12306 | `station search <keyword>` | 车站搜索（支持站名、拼音前缀、电报码） | Station[] |
| 12306 | `ticket search <from> <to> [--date <YYYY-MM-DD>] [--type <G,D...>] [--available]` | 直达车次与余票（`--date` 默认今天；`--type` 过滤车型；`--available` 只看有票车次） | Ticket[] |
| 12306 | `ticket price <train> --from-no <序号> --to-no <序号> --seat-types <编码> [--date <YYYY-MM-DD>]` | 票价详情（参数取自 ticket search 输出的 train_no、from.no、to.no、seat_types） | Fare |
| 12306 | `route get <train> <from> <to> [--date <YYYY-MM-DD>]` | 经停站与时刻（`<train>` 为 train_no，`<from>`/`<to>` 为出发站与到达站） | Stop[] |
| 12306 | `transfer search <from> <to> [--date <YYYY-MM-DD>] [--via <中转站>] [--limit N]` | 中转方案搜索（同一车次分段有座标为「同车换座」） | Transfer[] |
| kuaishou | `auth login --user <用户 id>` | 短信验证通过后手机号下有多个用户（官方 result `100110031`，响应带 `userInfos` 与 `multiUserToken`）时选择登录哪一个。TTY 下直接在终端列出账号选择；非 TTY 下保存待选中间态（10 分钟内有效，含原 `--phone` 与会话 cookie），验证码一步返回 `{sent, phone, users}`，再带 `--user <用户 id>` 重新执行完成登录（不用再输验证码）。multiUserToken 走官方登录页的 `/pass/kuaishou/login/multiUserToken`（_sig4 名单内_，字段 channelType、countryCode、isWebSig4、multiUserToken、phone、setCookie、sid、targetUserId、account，签名缺失时服务端报 `400013`），后续站点换票与短信登录成功后一致 | Account |
| kuaishou | `auth login --user <用户 id> --code <验证码>` | 选号时若进入统一安全验证（官方 result `400013`，响应带 captchaUrl，含 unionToken / unLoginUserId），第一次带 `--user` 执行会先挂起（`{sent, verify: true}`，不发验证码）；不带 `--code` 重复执行 `--user <id>` 即发起 / 重发语音、短信验证码（接口为验证页同款 form，字段 unionToken、kpn、bizName、contextIdentifier、type=53、useVoice、sid、unLoginUserId）；TTY 下直接提示「回车发起电话，输验证码完成」。验证码填入后用 `--code` 提交（验证或选号一步都接受），catbus 校验拿到 `phoneVerifySuccToken` / `phoneVerifyType` 后带 `ztIdentityVerificationType` / `ztIdentityVerificationCheckToken` 重发 multiUserToken 完成登录。待验证凭证不随失败消耗，验证码错了可再执行；整链不需要浏览器 | Account |

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
| user | `get` / `items` / `follow` / `unfollow <user>`；`likes` / `collects` / `reposts` / `followers` / `following [user]`，省略时为 `me`；`search <kw>`；`update` 不带位置参数，只改当前账号 |
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
- bilibili 的 `comment replies <item> <comment>` 支持视频、专栏和图文动态：`<item>` 接受 BV 号、av 号、aid、视频链接（含分享短链），`cv<id>` / 专栏链接，或动态链接 / ID。纯文字和转发动态的楼中楼尚未验证，不开放。`<comment>` 是 `comment list` 返回的根评论 ID。分页读取该根评论下的可见楼中楼，沿用 `--limit`、`--cursor`、`--all`；`comment list --raw` 中的少量 `replies` 只是预览。
- bilibili 的 `comment list` / `replies` 读取图文动态时，先用非上游的动态详情接口取 `basic.comment_type=11` 与 `comment_id_str`（相簿 ID），不能把动态 ID 当作评论区 oid；输出 `Comment.item_id` 仍为动态 ID。同一条命令翻页时复用解析结果。`comment add` / `delete` 仍只支持纯文字和转发动态。
- `msg send --item <item>`：对商品卖家 / 客服发消息（闲鱼、淘宝、京东）。
- `msg send --to <user> --item <item>`：就这件商品给指定用户发消息（闲鱼：卖家主动联系买家）。不支持的平台报 `UNSUPPORTED`。
- maoyan：演出（item）的场次时间、城市、场馆、票价档、售卖状态没有对应的 Item 字段，按「键：值」逐行写进 `text`，原始字段用 `--raw`。`poi search` 只搜演出城市，`id` 是 `feed list --city` 的取值。`item get --tickets` 的场次和票档同样写进 `text`，不新增类型。
- taobao 没有按用户查询、按用户发起会话的接口：`user get <user>` 的 `<user>` 只接受商品链接，返回这件商品的卖家；`msg send` 不支持 `--to`（报 `UNSUPPORTED`）。
- x 的推文归一化（Item）：转推（`legacy.retweeted_status_result`）按原推归一化：`id`、`url`、`author`、正文、媒体和计数都取原推，因为外层只有截断的「RT @…」正文，没有媒体，计数也是 0；原始的转推对象仍挂在 `--raw` 上。推文自己没有媒体时，`cover` 依次退到被引用推文（`quoted_status_result`）的第一张媒体，再退到链接卡片（`card.legacy.binding_values`）的缩略图；`media` 只放推文自己的媒体。

### 4.9 选项

**全局选项**：

| 选项 | 说明 |
|---|---|
| `-a, --account <name>` | 使用哪个账号（见 5.2） |
| `-e, --endpoint web\|app\|pc` | 端，默认 `web` |
| `-o, --output json\|jsonl` | 输出格式，默认 `json`（见 6.1） |
| `--raw` | 用平台原始对象代替归一化对象 |
| `--fields <路径,...>` | 只输出 `data` 条目里的这些字段（见 6.1） |
| `--dry-run` | 只校验、不执行（见 6.1） |
| `--proxy <url>` | 本次调用使用的代理 |
| `-v, --verbose` | stderr 输出调试日志（已脱敏） |
| `-q, --quiet` | 不输出提示和进度，只保留错误 |
| `-y, --yes` | 跳过危险操作的确认（见 4.11） |
| `-h, --help` | 帮助 |

**分页**：

| 选项 | 说明 |
|---|---|
| `--limit N` | 默认只取一页。指定 N 后自动翻页，直到取满 N 条。翻页间隔用平台默认值 |
| `--cursor <c>` | 从上次返回的 `page.cursor` 继续翻。cursor 是不透明字符串。`--limit` 截在一页中间时，`page.cursor` 指回这一页，续翻时跳过已经输出的，不丢数据 |
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
| `--text <str\|@file>` | 正文。`@file` 表示从文件读取，正文里的相对路径（如 Markdown 插图）按该文件所在目录解析 |
| `--image <path\|url>` | 图片，可重复 |
| `--video <path\|url>` | 视频 |
| `--cover <path\|url>` | 封面 |
| `--tag`、`--topic`、`--mention` | 均可重复 |
| `--poi <id>` | 地点 |
| `--category <id>` | 分类 |
| `--visibility public\|private\|friends\|fans` | 默认 `public`。`friends` 为好友（互相关注）可见，`fans` 为粉丝可见。平台在注册表里声明支持哪些取值，不声明时为 `public` `private` `friends`；平台不支持时报 `UNSUPPORTED`，不是标准值时报 `USAGE` |
| `--schedule <ISO 时间>` | 定时发布 |
| `--price <金额>` | 商品价格（闲鱼） |
| `--quote <item>` | 引用一条内容（ID 或 URL），发成引用。目前只有 x 支持，其他平台没有这个选项 |

平台在注册表里用 `supports` 声明 `item publish` 支持上表中的哪些选项。没声明支持的选项不出现在帮助里，用了报 `UNSUPPORTED`（`hint` 列出可用的选项），不会被静默忽略。各平台的取舍见 capabilities.md。

本地文件会自动上传，不需要先调 `media upload`。

**资料**（`user update`）：

| 选项 | 说明 |
|---|---|
| `--name <str>` | 昵称 |
| `--avatar <path\|url>` | 头像图片，本地文件自动上传 |
| `--bio <str>` | 简介 / 签名，传空字符串表示清空 |

三个至少给一个，没给的保持原值。平台在注册表里用 `supports` 声明支持哪几个；平台对修改次数、冷却期、审核的限制，按平台返回的错误报 `UPSTREAM`，`hint` 写明限制。

**下载**：
- `--dir <目录>`：默认当前目录。文件名为 `<platform>_<id>_<序号>.<ext>`。
- `--overwrite`：覆盖已有文件，默认跳过已有文件。
- `--subdir none|id|title`：每个 item 放进 `--dir` 下自己的子目录，默认 `none`（直接放在 `--dir` 里）。`id` 用 item 的 ID；`title` 用标题（没有标题时用正文开头，再没有用 ID）。文件名不变。
  - `title` 的目录名按 Windows、macOS、Linux 都能用的规则清洗：去掉 emoji 和平台表情码（如小红书的 `[笑哭R]`、`#话题[话题]#`）、控制字符和 `<>:"/\|?*`，空白合并成一个空格，去掉首尾的空格和点，避开 Windows 保留名（`CON`、`NUL`、`COM1` 等，前面加 `_`），最长 60 个字符；清洗后为空时用 ID。
  - 同名目录里已经有别的 item 的文件（按文件名前缀 `<platform>_<id>_` 判断）时，目录名后面加 ` (<ID 后 6 位>)`。

**长连接**：`listen` 总是输出 jsonl，断线自动重连。`--duration <秒|10m|1h>` 指定运行时长，Ctrl-C 正常退出，退出码 0。

平台私有选项在注册表里声明，**不能与上面的标准选项重名**。

### 4.10 全局命令与帮助

全局命令不带平台，名字与平台 id、别名互斥：

| 命令 | 输出 |
|---|---|
| `catbus platforms [platform]` | 能力矩阵：平台 × 端 × resource.action 及其状态，数据来自注册表 |
| `catbus doctor` | 逐项检查：Node 版本；原生依赖能否加载（HTTP 库、canvas、onnx、`catbus tui` 用的 ink）；`@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` 是否就位；`~/.catbus` 的权限；签名 vm 能否运行 |
| `catbus auth list` | 所有平台、所有端下的账号 |
| `catbus config get\|set\|unset\|list` | 读写 `config.toml`（见 5.5） |
| `catbus version`（或 `--version`） | 版本、Node 版本、系统与架构 |
| `catbus tui` | 全屏交互界面（见 4.13）。这是唯一不输出 JSON 信封的命令；非 TTY 下报 `USAGE` |

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
- bilibili 的 `item coin` / `item triple`，以及带 `--name` 的 `user update`（改昵称扣硬币）；
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
- xhs 的蒲公英（达人）和千帆（分销达人）：只对开通了的品牌 / 机构账号有用，普通账号访问会被拒，被拒后几分钟内主站的评论等接口还会要求人机验证；
- 12306（`12306`）的登录、下单、候补提交、退票改签：购票由用户本人在 12306 APP 完成，catbus 仅提供免登录的只读查询能力；
- 猫眼演出（`maoyan`）的下单、抢票、预约：catbus 只提供只读查询。

如果某条命令内部需要其中的能力（例如心跳），由实现内部调用。

### 4.13 终端界面（`catbus tui`）

给人用的全屏界面。CLI 和 Agent 的接口不变，TUI 只是同一份注册表、同一批 handler 的另一个入口。

- **启动条件**：stdin 和 stdout 都是 TTY，且终端不小于 80 × 24。否则报 `USAGE`，`hint` 为 `catbus --help`；这是 6.1 "stdout 只输出结果" 的唯一例外，界面本身画在 stdout 的备用屏幕上，退出后终端恢复原样。
- **不另写业务**：平台、命令、参数、选项、登录要求、状态全部读注册表，新增平台或命令时界面自动出现，不手写菜单。命令在进程内调用，不起子进程，也不解析自己输出的 JSON。
  - **执行只有一份规则**：校验、身份解析、凭证落盘都在 `src/cli/dispatch.ts`；`src/cli/exec.ts` 的 `prepare` / `invoke` 按 `runPlatform` 的顺序调用同一批函数，界面只经它运行命令。给 `runPlatform` 加一步检查或加工时，写成 `dispatch.ts` 里的导出函数，并在 `exec.ts` 里补上同一步，界面就跟着生效；`tests/exec.test.ts` 会检查两边一致，漏了会失败。
  - **新增动作**：界面按动作名判断能不能运行（白名单，见下一条）。新增的只读动作加进 `src/tui/model.ts` 的 `READ_ACTIONS` 和下一条的列表；不加的话命令在界面里显示为 `○`、只给出等价命令，不会被误运行。
- **能在界面里运行的命令**：读取类（动作是 `get` `list` `search` `related` `media` `items` `replies` `categories` `suggest` `hot` `count` `history` `status` `price` `likes` `collects` `reposts` `followers` `following` `rank` `gifts` `products` `replays` `subtitles` `stats`）、长连接的 `listen`，以及账号管理（`auth login` `auth use` `auth logout` `auth status`，在账号页里做）。其余命令（写入、成对动作、`delete`、`publish`、`download`、`upload`、`send`、`coin`、`triple`、`start`、`stop`、`revoke`、`read`）在命令栏里显示为 `○`，选中时显示等价的 CLI 命令，不能在界面里执行。这样 4.11 的危险操作确认不需要在 TUI 里重做。
- **登录在界面里完成**（5.3 的流程不变）：二维码画在界面里（黑码白底，固定色，不随主题；放不下时提示并可按 `o` 用系统图片查看器打开 `cache/<p>/qrcode.png`），短信验证码、密码（隐藏输入）、人机验证和浏览器授权（`oauth`）的链接、cookie 导入都在界面里输入；平台在提问前打的说明（发往哪个手机号、待选账号列表）显示在提问上方。
  - **登录页的表单读注册表**：`auth login` 的选项里，这个登录方式能用的都列出来，文本可填、开关可切，不手写。选项属于哪种登录方式，看说明末尾的标注，例如 `手机号（sms）`、`记住设备（sms / password）`；不标注的对所有方式显示。所以平台或词表新增登录选项时，**说明末尾标上适用的登录方式**，界面就自动出现。不进表单的只有：`--method`、`--scope`（登录页有单独的两行），分步登录用的 `--code`、`--user`（界面里一步完成，由 handler 提问），以及名字以 `-stdin` 结尾的（界面里由 handler 提问）。
  - **实现**：`core/login.ts` 提供 `LoginUi` 钩子（`setLoginUi`）：二维码、浏览器链接、提问、是否可交互四处走钩子，CLI 里默认走 stderr 和 readline，TUI 里换成界面。平台的登录流程里要用户输入时一律用 `core/login.ts` 的 `interactive()` / `prompt()`，要用户打开链接时用 `showLink()`，**不要直接读 `process.stdin`、不要自己开 readline**：直接读的在界面里收不到输入。非交互分支（管道喂验证码）可以读 stdin，但要先判断 `interactive()`。
  - **stdin 归界面**：TUI 启动时调用 `claimStdin()`。之后没有登录钩子时（运行读取类命令、监听），`interactive()` 为 false、`prompt()` 报 `USAGE`，不会去抢 stdin。
- **监听在界面里运行**：`live listen`、`msg listen` 显示成滚动的事件流，可暂停、按类型过滤，`--duration` 变成倒计时，`Esc` 停止（与 Ctrl-C 一样走同一个 AbortSignal）。界面不保存事件；要录制用 `-o jsonl`。
- **下一步与返回**：结果页选中一项后，`Enter` 列出可以接着做的命令（同一平台里首个参数是这类对象的读取类命令，参数已按 4.8 的规则填好：优先 URL，其次 ID），选中即运行；`Esc` 回到上一页结果。这是 4.8 “输出里的 `id` 和 `url` 可以直接作为下一条命令的参数” 在界面里的对应。
- **账号页**（`a`）：列出本平台的账号，切换当前账号（与 `auth use` 走同一个 handler，端的 `use` 钩子照常调用）、在线检查登录态、登出（界面内确认）、登录新账号。登出前的确认在界面里做，不再走 4.11 的 stderr 提问。
- **启动动画**：猫巴士开进来，不超过 1 秒，任意键跳过。`CATBUS_TUI_ANIMATE=0`、Windows（默认）、`NO_COLOR`、`CATBUS_TUI_ASCII` 下不出现。
- **等价命令**：任何时候界面底部都显示当前选择对应的 CLI 命令，按 `c` 复制。TUI 帮人学会命令行，也方便把同一条命令交给 Agent 重放。
- **按键**：纯键盘即可完整使用。方向键和 `j k h l` 移动，`Tab` 换栏，`/` 命令面板，`Enter` 运行，`Esc` 返回，`c` 复制命令，`a` 账号页，`T` 切换浅色 / 深色，`?` 帮助，`q` 退出。
- **日志不乱屏**：TUI 运行期间，读取类命令用到的日志（`ctx.log`）和直接写 `process.stderr` 的提示，都改道到界面内的日志区，不直接写终端。
- **配色**：沿用 Catppuccin（与 logo 同色板），深色 Mocha，浅色 Latte。文字对背景的对比度不低于 4.5:1。遵守 `NO_COLOR`；终端不支持真彩色时降级到 256 色。
- **宽字符**：宽度一律按 `string-width` 计算，模糊宽度字符（`●` `○` `│` 等）默认按 1 列；终端把它们显示成 2 列时，用 `CATBUS_TUI_ASCII=1` 切到纯 ASCII 边框和标记。
- **系统**：在 darwin 和 win32 上必须可用（Windows Terminal、PowerShell 7、cmd；macOS 的 Terminal.app、iTerm2），linux 同样要求。Windows 控制台遇到占满整屏的帧时，Ink 每帧都会清屏重绘，所以 Windows 上默认限制帧率并关掉吉祥物动画（`CATBUS_TUI_ANIMATE=1` 打开）；Windows 上不依赖 ANSI 以外的终端能力，复制命令优先用系统剪贴板命令（macOS `pbcopy`、Windows PowerShell 的 `Set-Clipboard`、Linux `wl-copy` / `xclip` / `xsel`），都不可用时退回 OSC 52，再不可用就只显示命令不报错。macOS 自带的 Terminal.app 不支持 OSC 52，所以不能只靠它。

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

- `-a guest` 强制使用游客身份（只在支持游客态的端上有意义）。`auth login` / `logout` / `use` 不接受 `-a guest`（保留名），报 `USAGE`。
- `-a` 指定的账号不存在时，报 `AUTH_REQUIRED`，`hint` 为 `catbus <p> auth login -a <name>`。

**游客态只在声明了 `guest: true` 的端上存在**（见 7.6）。不支持游客态的端上没有 `guest.json`：`auth status` 等 auth 命令没有账号时，用一份只在内存里的空凭证，不落盘。
- **web 端默认不支持游客态**：各内容与电商平台的 web 端不登录几乎看不到内容，所以 web 端默认 `guest: false`，除 `auth` 命令外全部需要登录，未登录时直接报 `AUTH_REQUIRED` 并提示登录命令。游客态主要留给 app 端。公开内容不登录也能读的平台在 web 端声明 `guest: true`，目前是 `12306`、`maoyan` 和 `youtube`：读取命令沿用词表默认的 `auth: optional`，写操作和只看自己的命令仍为 `required`；不需要登录的端可以不提供 `auth login`（如 `12306`）。猫眼演出（`maoyan`）另外提供 `auth login`（大众点评扫码或 cookie 导入，凭证是 `.dianping.com` 的 `dper`，约七天有效），只有 `item get --tickets` 要求登录。各平台具体哪些命令免登录、支持哪些登录方式，见注册表和 `docs/platforms/<p>.md`。
- 支持游客态的端上，很多平台匿名访问也需要设备 cookie 或 token（例如 xhs 的 `a1`、抖音的 `ttwid`、B 站的 `buvid`、X 的 guest token）。catbus 自动生成这些数据，缓存到 `guest.json`，过期后重新生成；各平台的生成方式见 upstream-map。
- 登录流程本身仍会先生成这些设备数据（很多平台的登录接口要求先有设备 cookie），这与游客态无关。

每个命令在注册表里标注 `auth: required | optional`；不支持游客态的端上一律是 `required`：

| 情况 | 行为 |
|---|---|
| `required`，当前是游客 | `AUTH_REQUIRED`，退出码 3，`hint: catbus xhs auth login`（非 web 端时带上 `-e`） |
| `optional`，当前是游客 | 照常执行（信封里 `account` 为 `"guest"`），同时在 stderr 提示一行（若该端支持登录且非 `-q` / `-a guest`；见下） |
| 平台返回登录墙 | `AUTH_REQUIRED`，退出码 3 |
| 登录态失效 | `AUTH_EXPIRED`，退出码 3，`hint` 为重新登录的命令 |

`optional` 时在 stderr 输出的提示：

```
[catbus] 未登录 xhs (web)，本次以游客身份访问，结果可能不完整；很多操作需要登录。登录：catbus xhs auth login
```

- `-q` 或 `-a guest` 时不输出这行提示。
- 若该端未注册 `auth login` 命令（例如 `12306`），则不输出该行提示（避免提示不存在的登录命令）。
- 只提示，不在命令中途弹出交互式登录。

### 5.3 登录与登出

```bash
catbus <p> auth login [-a <name>] [--method qrcode|sms|password|cookie|oauth|apikey] [--scope <scope>]
```

**账号名**：
- 不带 `-a` 时：有当前账号就登录到当前账号，否则登录到 `default`。
- 登录成功后，如果还没有当前账号，就把它设为当前账号。
- 如果该名字下已经存了另一个用户，视为先登出再登录：旧凭证被新凭证替换，stderr 提示一行（不调用服务端登出）。
- `--auto-bind`：不按账号名，而按登录的用户决定存到哪个账号。本平台本端已经有这个用户（`user.id` 相同）的账号时，刷新那个账号的凭证；没有时新增账号：`default` 没被占用就用 `default`，否则按用户 id 起名（转成 5.1 的格式，重名时加 `-2`、`-3`……）。不改变已有的当前账号；还没有当前账号时同样设为当前账号。不能和 `-a`、`--scope` 一起用（报 `USAGE`）。信封里的 `account` 是实际落盘的账号。

**登录方式**：每个平台在注册表里声明支持哪些方式、默认用哪种，见 capabilities.md。

| 方式 | 选项 | 流程 |
|---|---|---|
| `qrcode` | — | 二维码画到 stderr，同时把 PNG 存到 `cache/<p>/`，然后等待扫码 |
| `sms` | `--phone`、`--code` | TTY 下先发验证码，再交互输入。非 TTY 下分两步：`--phone` 发验证码并保存中间态（10 分钟有效），再单独用 `--code` 完成登录 |
| `password` | `--username`、`--password-stdin` | 密码只从 stdin 读取，TTY 下隐藏输入。需要两步验证的平台（mteam）另用 `--code`，流程同 `sms` 的两步：非 TTY 下第一步发码并保存中间态，第二步带 `--code` 完成 |
| `cookie` | `--cookie <str\|@file\|->` | 导入后调一次 `me` 校验。也接受浏览器导出的 cookie JSON 数组；douyin、tiktok 另外接受一个 JSON 对象，把 ticket、证书、私钥等设备数据一并导入（这两个平台的写操作需要它们） |
| `oauth` | — | 浏览器授权（OAuth 设备码）：授权链接打到 stderr，用户在已登录该平台的浏览器里打开并同意，然后等待授权完成。目前只有 `jimeng`，由 `dreamina` 完成授权（见 5.6） |
| `apikey` | `--api-key-file`、`--api-key-stdin`（mteam 私有选项） | 从本地文件或 stdin 读取官方访问令牌，TTY 可隐藏输入；先在线校验，再由 core 保存到账号凭证。令牌只发到官方 API，不传给重定向目标 |

- **验证码**：上游能自动过的就自动过，过不了报 `RISK_CONTROL`（`detail.kind = captcha`），退出码 5。
- **登录中的人机验证**：平台在登录流程中途强制的短信验证码验证（例如 xhs 扫码确认后的 HTTP 471，`verifyType` 120 验证页链 / 213 主站登录强制链）由实现自动完成，手机号与验证码沿用 `--phone` / `--code` 或终端输入（非交互可从 stdin 逐行读，包括验证码发往的指定手机号）。验证通过后用同一组未完成的登录参数继续；验证失败与放弃按 `RISK_CONTROL` 报错。站点只接受账号绑定手机时，`hint` 写明。
- **子站点**（创作者中心、直播、IM 等）：
  - 能自动换取的凭证，登录时或第一次用到时自动获取，不需要用户再登录一次（例如 xhs 的创作者中心：用主站登录态换取）；
  - 需要单独登录的，用 `--scope <name>` 登录，各平台可用的 scope 在注册表里声明；
  - 命令缺少所需 scope 时，报 `AUTH_REQUIRED`，`hint` 带上 `--scope`。
- **`auth status`**：在线校验，返回 AuthStatus。未登录或已失效时返回 `logged_in: false`，不报错。校验成功且返回的是同一个用户时，新的昵称 / 头像由 core 回写到凭证文件。
- **头像**（账号的头像；作者、评论者等 UserRef 的头像见 6.2）：登录、cookie 导入校验和 `auth status` 复用流程里本来就有的那次当前用户请求，取到头像就存进凭证的 `user.avatar`（统一成 https 绝对地址），不为头像额外发请求；取不到时为 null。旧凭证文件没有 `avatar` 时读成 null，不需要迁移。
- **`auth logout`**：删除本地凭证文件（上游支持服务端登出的，同时调用服务端登出，目前有 B 站和快手），并清除指向它的 `_current`。
- **`auth use <account>`**：设置 `_current`。端声明了 `use` 钩子的（目前只有 `jimeng`），先调用钩子，再设置 `_current`；钩子报错时不切换。
- **`auth list`**：列出本平台、本端的账号。
- **自动刷新**：会自动刷新的 token（如 B 站的 refresh）和响应里的 Set-Cookie，都会合并回凭证文件并原子写入。

### 5.4 凭证文件

```jsonc
{
  "schema": 1,
  "platform": "xhs",
  "endpoint": "web",
  "account": "default",                  // 游客文件为 "guest"
  "user": { "id": "5f...", "name": "...", "url": "...", "avatar": "https://..." },   // AccountUser；游客为 null
  "method": "qrcode",                    // qrcode | sms | password | cookie | oauth | apikey | guest
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

[youtube]
browser = "/path/to/chromium"     # 发布与删除用的本地 Chromium（见 5.7）
```

- 代理的优先级：`--proxy` > `<platform>.proxy` > `proxy`。
- 不读取 `HTTP(S)_PROXY` 环境变量，代理只能显式配置。
- `catbus config set xhs.proxy <url>`，用点号表示平台段。
- `youtube.browser` 只接受已存在的绝对路径（`checkBrowser`），不接受代理地址。

### 5.6 代管外部 CLI 的登录态

有的平台已经有官方 CLI，生成、查询等能力直接用官方 CLI 更合适，catbus 只补上它缺少的多账号管理。目前只有 `jimeng`（即梦官方 CLI `dreamina`）。

- **范围**：只注册 `auth` 命令（`login`、`status`，以及 core 提供的 `list`、`use`、`logout`），不注册 item 等业务命令；业务操作由用户直接运行官方 CLI。
- **存储**：外部 CLI 自己的登录态存放位置（`dreamina` 是 macOS 钥匙串里的一项：service `dreamina`，account `byted_cli_user_token`）同一时间只有一个账号。catbus 把这一项的原值存进对应账号凭证的 `scopes.main.tokens.keyring`，凭证文件仍只由 core 读写（5.4）。
- **当前账号与外部登录态一致**：`auth use` 通过端的 `use` 钩子把目标账号的登录态写回外部存储，之后直接运行官方 CLI 就是这个账号。`auth login`、`auth status` 会临时占用外部存储，结束时（包括失败）切回 `_current` 指向的账号。
- **刷新回写**：外部 CLI 会自己刷新 token、改写外部存储。catbus 每次改写外部存储前，先按外部存储里的用户 id 找到所属账号，把最新值存回该账号的凭证。外部存储里的用户不属于任何账号时，在 stderr 警告它会被覆盖。
- **登录**：`--method oauth`，由外部 CLI 发起设备码授权（`dreamina relogin --headless`，再 `dreamina login checklogin --poll`），授权链接打到 stderr。外部 CLI 发起登录时会先清掉外部存储里原来的登录态。
- **校验**：`auth status` 用外部 CLI 的只读命令在线校验（`dreamina user_credit`），失效时返回 `logged_in: false`。
- **登出**：`auth logout` 的服务端登出钩子只在外部存储里正是这个账号时调用外部 CLI 的登出（`dreamina logout`），再由 core 删除本地凭证。
- **依赖与系统**：外部 CLI 由用户自己安装，找不到时报 `ERROR` 并提示安装。外部存储的读写按系统适配，未适配的系统报 `UNSUPPORTED`（`jimeng` 目前只支持 macOS）。
- **限制**：同一时间只有一个账号生效，不能两个账号同时运行外部 CLI；不要绕过 catbus 用外部 CLI 自己的登录命令换账号，否则新登录的账号没有保存，下次切换时会被覆盖。

### 5.7 YouTube Studio 写操作与本地 Chromium

`youtube` 的 `item publish` 与 `item delete` 走 YouTube Studio（studio.youtube.com）。Studio 的写请求要在 `context.request` 里带两样 Google 的网页环境校验结果，catbus 在 Node 里生不成，所以这两个命令是「只需要 Node」的例外（见第 1 节）。

- **分工**：无头 Chromium 只负责在 Studio 页面里计算 BotGuard（`src/platforms/youtube/web/botguard.ts` 的 `runBotGuard`，经 CDP 的 `Runtime.evaluate` 注入）。其余请求全部由 Node 发出：`att/get`、`att/esr`、reauth、`ars/grst`、上传（`upload.youtube.com`）、`upload/createvideo`、`video_manager/metadata_update`、`video/delete`。浏览器只用来算校验，不用来点页面。
- **CDP 传输**：用 `--remote-debugging-pipe`，协议消息走 fd 3 / fd 4，以 `\0` 分隔，不开调试端口。调试端口会让同机其他进程拿到会话 cookie，所以不用。因为 CDP 不走 WebSocket，这里不涉及第 7.3 节的 WebSocket 选型。
- **顺序**：每个写命令内，先开浏览器，再 `att/get`（CREATOR_STUDIO_ACTION）→ BotGuard → `att/esr` 换 `sessionToken`（esr 要求 reauth 时再走 `security/get_web_reauth_url` 与 `ars/grst`），拿到令牌之后才开始上传。这样浏览器启动失败或 reauth 被拒绝时，不会白传一遍视频。上传期间浏览器保持打开，上传完成后用它对 UNBOUND 挑战加上 `scottyResourceId` 算一次 BotGuard，放进 `attestationResponseData`。写请求带 `sessionInfo.token`。
- **interpreter 白名单**：BotGuard 的 interpreter 地址来自 `att/get` 的响应，取回后要在已登录的 Studio 页面里执行，所以只允许 `https` 协议、主机在白名单里（目前只有 `www.google.com`，即实测出现过的 `//www.google.com/js/th/…`）。取回时不跟随重定向，跳转目标不在白名单里直接拒绝；最终地址也要再校验一次。新的 Google 静态域要先确认是真实出现过，再加进白名单。
- **找浏览器**，按顺序：`catbus config set youtube.browser <绝对路径>` → 环境变量 `CATBUS_YOUTUBE_BROWSER`（同样要求绝对路径）→ Playwright 缓存里最新的 `chromium-<版本>`（`npx playwright install chromium` 装的；macOS 在 `~/Library/Caches/ms-playwright`，Linux 在 `~/.cache/ms-playwright`，Windows 在 `%LOCALAPPDATA%\ms-playwright`，`PLAYWRIGHT_BROWSERS_PATH` 优先）。指定的路径必须是可以执行的文件（`X_OK`），否则报 `ERROR`；都没有时也报 `ERROR`。
  - 不扫描系统里的 Google Chrome：那是用户日常在用的浏览器，catbus 不占用它。
  - 不用 `chromium_headless_shell`：它过不了 Studio 的浏览器检查。
- **浏览器启动参数**：每次命令用独立的临时 profile，用完删除（删除失败时打 warn 并给出路径）；UA 与 Node 侧请求一致，不带 `HeadlessChrome`。
  - **代理**：与 Node 侧使用同一个代理（`--proxy` / `<platform>.proxy` / `proxy`）。没有配置代理时传 `--proxy-server=direct://`，不读取系统代理。浏览器的子进程环境里去掉 `*_PROXY` 变量，与第 5.5 节「不读取 `HTTP(S)_PROXY`」一致。Chromium 的 `--proxy-server` 放不下认证信息，代理带账号密码时报 `USAGE`。
  - **进程**：非 Windows 上放进独立的进程组，结束时整组发信号（先 SIGTERM，超时 SIGKILL），等进程组结束后才删除临时 profile。
- **cookie**：打开页面前把凭证里的全部 cookie 注入浏览器（设置失败的个数会 warn）；命令结束时，把浏览器里的 cookie 按「名字 + 域 + 路径」写回凭证，覆盖注入时的全部域。写回的条件：浏览器的值与注入时不同（浏览器确实轮换过），并且 Node 侧这一份在这期间没有被改过。两边都改过同一个 cookie 时，取 `expires` 较新的那个；相同时保留 Node 侧的值（它是最后经过 Set-Cookie 确认的）。
- **重试**：会话相关的请求（att/get、att/esr、reauth、ars/grst）和 interpreter 下载，网络出错时再试一次；页面导航也重试（只读）。上传分段在网络出错或状态码可重试（429、5xx）时，用同一个 offset 重发同一段，最多三次。`metadata_update` 是幂等的，网络出错时再试一次。
- **不重试的写请求**：`upload/createvideo` 与 `video/delete` 遇到网络错误时，请求可能已经生效，报 `UPSTREAM`，hint 写「可能已经生效，先到 Studio 或用 `item list` 确认，不要直接重试」。建视频没有返回视频 ID 时，如果是上传被拒（`uploadFeedbackItemRenderer` 里 `REJECTED`），按原因报错（限流报 `RISK_CONTROL`）；否则报 `UPSTREAM`。
- **视频建好之后**：任何失败（包括 `metadata_update` 的网络错误、AUTH 类错误）一律报 `UPSTREAM` 并附上视频 ID，hint 写「不要重新发布，视频已存在」。不透传 `NETWORK` 或 `AUTH_EXPIRED`，否则调用方会以为能重试整条发布，结果产生重复视频。
- **大文件**：本地视频按段从磁盘读取，不整个读进内存；URL 形式的 `--video` 先下载到内存（只有这种情况）。
- **错误**：找不到或无法执行浏览器 → `ERROR`；浏览器启动后立即退出或超时 → `ERROR`；浏览器打开页面后跳到 Google 登录页 → `AUTH_EXPIRED`；reauth 被拒绝或没有发放令牌 → `RISK_CONTROL`（`detail.kind` 为 `blocked`）；BotGuard 在页面里报错 → `UPSTREAM`；interpreter 不在白名单、或跳转 → `UPSTREAM`。
- **测试**：离线测试替换 `browser.open`（假浏览器只记录 BotGuard 的 binding）和 Studio 的响应；`findChrome` 的路径按 darwin / linux / win32 的目录布局做单测；`runBotGuard` 在 `node:vm` 里独立运行；`openBrowser` 的失败路径（不可执行、启动后立即退出、超时）用假的可执行脚本测，并检查临时目录被清理。真机验证只在测试账号上做，视频一律私享，测完用 `item delete` 删掉。

### 5.8 YouTube 的 cookie 轮换

Google 会定期轮换登录会话的时效性 cookie（`SIDCC`、`__Secure-1PSIDCC`、`__Secure-3PSIDCC`、`__Secure-1PSIDTS`、`__Secure-3PSIDTS`）。浏览器里由 `accounts.youtube.com/RotateCookiesPage` 的隐藏 iframe 自动完成；catbus 导入的 cookie 没有这个机制，不轮换就会慢慢失效（需要登录的接口回 200 但内容为空，`logged_in=0`）。catbus 用 Node 复刻这个轮换（`src/platforms/youtube/web/client.ts` 的 `rotateCookies`）：

- **接口**（2026-11-10 实测）：
  1. `GET accounts.youtube.com/RotateCookiesPage?origin=https://www.youtube.com&yt_pid=1`，带全部凭证 cookie。响应 HTML 末尾内联 `init('<token>', m, o, l, interval)`：token 是本次轮换的凭证，interval 是下次轮换的间隔秒数（默认 600，最小 60）；响应同时已用 Set-Cookie 轮换过一轮。
  2. `POST accounts.youtube.com/RotateCookies`，`Content-Type: application/json`，body 是 protobuf-over-JSON 数组 `[m, token, o, l]`（数值字段为 0 时写 null；实测 `[null,"<token>",1]`）。响应是 `)]}'` 前缀的 JSON 数组，`[0][1]` 是下次间隔秒数；Set-Cookie 完成轮换。
- **触发时机**：登录后的 InnerTube 请求响应里 `logged_in=0`（cookie 失效的信号）时，先轮换一次再重试原请求；轮换后恢复了就继续，没恢复才报 `AUTH_EXPIRED`。此外 `auth status` 也顺带轮换一次（浏览器是登录后每 600 秒轮一次，catbus 命令都是一次性的，没有常驻进程可定时）。
- **节流**：下次尝试时间记在凭证 `device.cookieRotate.nextAttemptAt`（毫秒时间戳），间隔用服务端给的值（默认 600 秒、最小 60 秒），失败翻倍退避；未到时间不发起轮换，避免每次命令都打一遍。页内 token 一次有效，拿到后立即用掉，不复用、不落盘。
- **写回**：轮换的 Set-Cookie 由 `HttpClient` 自动写进 cookie 罐，随凭证由 core 落盘（5.3「自动刷新」）。轮换成功时 stderr 提示一行。
- **与浏览器共存**：轮换会让浏览器里那份 cookie 的时效性 cookie 失效（反之亦然），与 5.7 的浏览器写回是同一个取舍：catbus 用着的时候，导出 cookie 的那个浏览器会话应保持关闭。
- **测试**：离线测试用 fixture 回放 RotateCookiesPage 与 /RotateCookies 的真实响应（裁剪），校验触发时机、请求体、节流与 Set-Cookie 写回。

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

`--fields <路径,...>`：只输出每个 `data` 条目里的这些字段，用来省掉不需要的数据。
- 逗号分隔，用点号进入嵌套对象，例如 `--fields id,url,author.name,stats.likes`。路径经过数组时作用到数组的每个元素（`media.url`）。
- 列表命令作用到每一条，非列表命令作用到 `data` 本身；`data` 不是对象时（如 `config get`）不变。json 和 jsonl 都适用，信封的其他字段不变。
- 输出保留嵌套结构，键按 `--fields` 里的顺序；条目里没有的路径输出 null。同时给出 `author` 和 `author.name` 时输出整个 `author`。
- 在 `--raw` 之后生效，路径按原始对象的字段写。
- 路径为空或有空段（`a..b`）时报 `USAGE`。

`--dry-run`：做完执行前的全部检查就停下，不调用平台接口、不联网、不确认、不写凭证。
- 检查的内容和顺序与真正执行时一样：参数和选项（`USAGE` / `UNSUPPORTED`）、是否已实现（`NOT_IMPLEMENTED`）、身份（`AUTH_REQUIRED`，只看本地有没有账号，不在线校验登录态）。
- 通过时退出码 0，`data` 为 DryRun `{args options confirm}`：`args` 是位置参数，`options` 是校验后的选项（含默认值，凭证类的值打码；`--text @file` 等不读文件内容，原样给出），`confirm` 表示真正执行时是否需要危险操作确认。`page` 为 null，不受 `--fields` 影响。
- 只用于平台命令；用在全局命令上报 `USAGE`。和 `-h` 一起用时输出帮助。

### 6.2 归一化类型

所有平台的同一种对象都输出同一结构。

**基础类型**：

| 类型 | 字段 |
|---|---|
| UserRef | `id name url avatar`。`avatar` 为头像的 https 绝对地址，从同一个原始对象里取，不为头像额外发请求；取不到时为 null |
| Price | `amount currency`。`amount` 用货币主单位（元）的十进制数。虚拟货币也用它，`currency` 写平台货币代码 |
| Media | `id type url width height duration`。`url` 在刚上传、平台还没给出可访问地址时（例如视频转码前）为 null |

**内容与互动**：

| 类型 | 字段 |
|---|---|
| User | `id name handle avatar url bio stats{followers following items likes}` |
| Item | `id kind url title text author:UserRef created_at cover media:Media[] stats{views likes comments collects shares} price:Price\|null status\|null` |
| Torrent | Item 的全部字段（`kind: torrent`），另有 `size file_count category_id seeders leechers completed discount`；大小为字节，计数为整数或 null，优惠为站点代码或 null |
| BonusRecord | `id time type before after change user:UserRef\|null note url`：PT 站魔力值明细的一条；`before` / `after` / `change` 为数字（变化量带符号），站点不提供时为 null；`url` 为相关链接，没有时为 null |
| Comment | `id item_id parent_id author:UserRef text media:Media[] created_at stats{likes replies}` |
| Folder / Series | `id name count url` |
| Category | `id name parent_id` |
| Keyword | `text heat` |
| Topic | `id name url stats{views items}` |
| Poi | `id name address` |

`Comment.parent_id` 表示直接被回复的评论 ID；楼中楼回复可能指向另一条子回复，不能统一填成根评论 ID。bilibili 的原始 `root` / `parent` 通过 `--raw` 保留。

`Comment.media` 是评论里附带的图片、表情包（贴纸）、商品评价的晒图，取自同一个原始评论对象，不为它额外发请求；动图（GIF、动态表情包）仍记为 `image`，只有平台给的是视频文件时（例如 X 回复里的视频和 GIF）才是 `video`。正文里的行内表情（如 B 站的 `[doge]`）仍是文本，不进 `media`。没有时为 `[]`。

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
| AccountUser | `id name url avatar`：字段与 UserRef 相同，只用于账号（Account、AuthStatus、凭证文件），保留这个类型名 |
| AuthStatus | `logged_in user:AccountUser\|null method expires_at` |
| Account | `platform endpoint account current user:AccountUser\|null method updated_at` |
| File | `path type url size` |

**扩展类型**（见 4.7）：

| 类型 | 字段 |
|---|---|
| Subtitle | `lang name url lines[{from to text}]`，`lang` 缺失时为 null |
| Danmaku | `id item_id offset text created_at`，`offset` 为视频内的秒数 |
| Order | `id status total:Price items:Item[] created_at` |
| Coupon | `id title discount:Price threshold:Price\|null start_at end_at` |
| Station | `id name code pinyin abbr city url:null` |
| Ticket | `id url train_no type from{code name no} to{code name no} depart arrive duration date bookable has_ticket seats remaining prices seat_types` |
| Stop | `id station arrive depart stopover in_range url:null` |
| Fare | `id train_no date prices url:null` |
| Transfer | `id via same_station same_train kind depart arrive duration_minutes wait legs url:null` |
| TransferLeg | `id train_no from to depart arrive duration seats remaining prices url:null` |

**铁路与出行扩展字段说明**：
- `Ticket.url` 为 12306 官方余票查询深链（`https://kyfw.12306.cn/otn/leftTicket/init?...`），可直接在浏览器打开。
- `prices` 中每个席别的值均为 `Price { amount, currency: 'CNY' }`，单位为元。
- `remaining` 为每个席别的余票张数：≤20 时为精确整数，≥21 时为封顶对象 `{ min: 21 }`；无座张数不封顶，为精确整数。
- `Transfer.kind`：同一车次分段有座（`same_train: true`）标为 `同车换座`，不同车次换乘标为 `换乘`。

**枚举值**：

| 字段 | 取值 |
|---|---|
| Item.kind | `video` `image` `text` `article` `goods` `torrent` |
| File.type | `image` `video` `audio` `torrent` |
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

读取类命令按资源返回对应类型。列表类命令返回数组，并带 `page`。mteam 的 `item get` 返回 Torrent，`item search` / `feed list` / `user collects` / `seed list` 返回 Torrent[]，`bonus history` 返回 BonusRecord[]；`user get` 只支持 me。

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
| `station search` | Station[] |
| `ticket search` | Ticket[] |
| `ticket price` | Fare |
| `route get` | Stop[] |
| `transfer search` | Transfer[] |

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
| `user update` | User，修改后的当前账号 |
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
| `@cv-cat/catbus-assets-ocr` | 验证码 OCR 模型：ddddocr 1.6.1 的检测模型 `common_det.onnx`、识别模型 `common_old.onnx` 和字符集，约 34 MB（B 站极验点选在用）。同样是精确钉版本的普通依赖 |

- 拆出 assets-jd / assets-ocr 是因为模型很少变。放在主包里的话，每次发版都要上传 100 多 MB。
- 两个包的源码在 `packages/assets-jd/`、`packages/assets-ocr/`，是 npm workspace，开发时直接链接。
- 模型文件不进 git，由 `npm run assets:jd`（`scripts/fetch-jd-models.mjs`）按 `src/platforms/jd/UPSTREAM` 的 commit 取回并校验 sha256：有 `references/JdApis` 时从本地复制，否则从 GitHub 下载。打包 assets-jd 时会自动执行。
- OCR 模型同样不进 git，由 `npm run assets:ocr`（`scripts/fetch-ocr-models.mjs`）从 PyPI 上固定版本的 ddddocr wheel 里取出，wheel 和每个文件都校验 sha256：本机装过同版本 ddddocr（如 `.golden/<p>` 虚拟环境）时直接复制，否则下载 wheel（也可用 `CATBUS_DDDDOCR_WHEEL` 指定本地 wheel）。打包 assets-ocr 时会自动执行。ddddocr 是 MIT 许可证，包里附带它的原许可证 `LICENSE-ddddocr`。
- catbus 自己**不做**按系统划分的运行时包。原生依赖（HTTP 库、`@napi-rs/canvas` 等）各自通过 `optionalDependencies` 带上本机的预编译包。
- `npm i` 之后完全离线可用，npmmirror 可以完整镜像。
- **目标系统**：
  - win32-x64、win32-arm64；
  - darwin-arm64、darwin-x64；
  - linux-x64、linux-arm64，glibc 和 musl 都要支持。
- CI 在全部目标系统上跑冒烟测试，musl 用 Alpine。**任何一个目标系统缺预编译包的依赖都不能用。**
- 发布：
  1. 改 `package.json` 的版本号。模型变了时同时改 `packages/assets-*/package.json` 的版本，并把主包里钉住的依赖改成同一个版本（测试会检查）。
  2. 在 `CHANGELOG.md` 写好 `## [<版本>] - <日期>` 一节。
  3. 推送 `v<版本>` tag，触发 `.github/workflows/release.yml`：先检查 tag 与版本号一致、CHANGELOG 里有这个版本；跑完整 CI；发布 CI 里测过的同一份 tarball；最后用 `scripts/release-notes.mjs` 从 CHANGELOG 生成 GitHub Release。
  - 顺序：先发 assets-jd、assets-ocr，再发 `catbus-cli`。已经在 npm 上的版本跳过，失败后重跑不会重复发布。
  - 认证：npm 上给三个包配了 trusted publishing（GitHub Actions，`cv-cat/catbus`，`release.yml`，允许 `npm publish`）时走 OIDC，否则用仓库 secret `NPM_TOKEN`。trusted publishing 配好后两天内要成功发布一次，否则失效。
  - 仓库公开时发布带 `--provenance`，私有时不带（npm 只给公开仓库生成 provenance），由 release.yml 按仓库可见性自动判断。
- **Docker 镜像**（可选）：`Dockerfile` 走与 npm 发布相同的路径，先打出三个包，再在 `node:<版本>-bookworm-slim` 里全局安装这三个 tarball；`CATBUS_HOME=/data`（卷），工作目录 `/work`；默认以 root 运行（挂进来的目录都能写），Linux 上可以 `--user "$(id -u):$(id -g)"` 配合挂自己的数据目录。`compose.yaml` 提供 `catbus`（一次性命令）和 `live-listen`（长时间监听直播）两个服务。CI 的 `.github/workflows/docker.yml` 在 x64 与 arm64 上构建并跑 `version` / `doctor`，不推送到任何镜像仓库。
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
| 验证码 OCR | 移植 ddddocr：模型跑在 onnxruntime-web 上，可参考 ddddocr-node。模型来自 ddddocr 1.6.1 的 wheel，放在 `@cv-cat/catbus-assets-ocr`（见 7.2） |
| 签名 JS 的依赖 | jsdom（JD）、crypto-js（XHS）、@napi-rs/canvas（JD、KS） |
| 校验 | zod |
| 参数解析 | `node:util` 的 `parseArgs`，加上注册表。不用 CLI 框架 |
| 配置 | smol-toml |
| 终端二维码 | qrcode |
| 终端界面（`catbus tui`，见 4.13） | Ink + React。依赖树全是纯 JS（Yoga 以内嵌 WASM 分发），没有 install 脚本。只在 `catbus tui` 里动态加载，其他命令不付启动成本。OpenTUI 在 Node 上要求 26.4+ 加 `--experimental-ffi`，与 7.1 的 engines 冲突，不用 |
| 日志 | 自己写的 stderr logger，负责给凭证打码 |


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
  - 随机数和当前时间只经 `core/rand.ts`，等待用 `rand.sleep`；与 Python 对应的编码（`urlencode`、`quote`、`json.dumps`）用 `core/py.ts`；需要精确键序的 JSON 用 Map。解析平台响应用 `core/py.ts` 的 `jsonLoads`（与 `json.loads` 一样保留 64 位整数 ID），不直接用 `JSON.parse`。
  - HTTP 用 `core/http.ts` 的 `HttpClient`（`toolkit.httpClient(ctx)`），请求头按上游顺序显式给出；cookie 在凭证的 cookie 罐里，Set-Cookie 自动写回，命令结束时由 core 落盘。
  - 签名 JS 复制到 `static/<p>/`，用 `core/vm.ts` 的 `loadScript` / `callScript` 执行。
  - 业务错误映射到 6.4 的错误码：登录墙 → `toolkit.authError`，风控 → `RISK_CONTROL`，其余 → `UPSTREAM`（原始错误码放 `detail`）。
- **上游基线**：`src/platforms/<p>/UPSTREAM` 记录上游仓库地址和 commit。无上游仓库的平台（如 `12306`、`youtube`）记录对接的官方服务端点与接口说明。
- **上游更新时**：
  1. 用 `git -C references/<repo> log <commit>..` 查看变更；
  2. 同步移植；
  3. 重新生成对拍数据；
  4. 更新 UPSTREAM。
- **maoyan 平台**：H5guard（mtgsig）和它的环境补丁放在 `static/maoyan/`，在同一个 vm context 里依次执行 `env_core.js`、`env.js`、`H5guard.js`。`env.js` 为 vm 改写过（不读文件、不用 `process`，页面 cookie 只含设备数据、不含登录态），其余原样。扫码登录走 `accountapi.dianping.com` 的 `qrlogin` 接口，不开浏览器：取图接口的 `qruuid` cookie 拼成二维码内容，交给 `showQrcode`。离线测试在 `tests/maoyan.test.ts`，fixture 来自真实响应裁剪；在线测试在 `tests/e2e/maoyan.e2e.ts`。
- **无上游平台的离线与在线测试**：`12306`、`youtube` 没有 Python 参考实现与 golden 对拍数据。离线测试（`tests/<p>.test.ts`）采用真实响应裁剪的 fixture，配合 `mockSender` / `fakeResponse` 覆盖信封、退出码、字段解析与降级容错；在线测试在 `tests/e2e/12306.e2e.ts` 中覆盖免登录查询全链路。
- **在线测试**：`npm run test:e2e`，用单独的配置 `tests/e2e/vitest.config.ts`，不在 `npm test` 和 CI 里。使用开发者本机 `~/.catbus` 里的登录态，没登录的平台整组跳过；`npm run test:e2e -- -t <platform>` 只跑一个平台（`-t` 按名字前缀匹配，x 要写成 `-t '^x '`，否则会连 xhs、xianyu 一起跑）。
  - 只跑只读命令：从注册表枚举每个平台已实现的读取类命令，前面命令返回的对象（item、用户、评论、直播间、会话、收藏夹……）的 `url` 或 `id` 作为后面命令的参数，逐条校验信封和 6.2 的字段结构。写操作、下载、长连接不跑。
  - 命令之间默认间隔 1.5 秒，小红书 4 秒，避免触发风控。以下记为跳过：子站点没登录（`AUTH_REQUIRED`）、平台风控（`RISK_CONTROL`）、默认参数落在规划中的取值上（`NOT_IMPLEMENTED`）、注册表 note 写明的限制（有 note 的命令报 `UNSUPPORTED`）。
  - 每条命令的信封（列表只留前 3 条）写到 `.e2e/<platform>.json`，不进版本控制，用来检查归一化的字段是否取到了值。
- **CI**（`.github/workflows/ci.yml`）：只跑离线测试，再加上全部目标系统的冒烟测试（`scripts/smoke.mjs`），冒烟测试包括：
  - 安装包；
  - 运行 `version`、`doctor`、`platforms`；
  - 跑一次签名 vm；
  - 加载原生依赖；
  - `catbus tui`：非交互环境报 `USAGE`（顺带加载整个界面模块）；用包里的离屏渲染跑一遍真实界面（Ink、React、Yoga WASM 在该系统上能算出布局、响应按键）；POSIX 且有 python3 时，再在真实伪终端里启动、进出备用屏幕、退出（Windows 没有可用的伪终端，Alpine 没有 python，跳过并说明）。

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
- 端的字段：`login`（登录方式与子站点）、`logout?`（服务端登出）、`use?`（`auth use` 设置当前账号前调用，见 5.3、5.6）、`guest?`（是否支持游客态，默认 false）、`commands`。`guest` 为 false 时，除 `auth` 外的命令一律按 `auth: required` 处理，声明 `optional` 会在启动时报错。web 端只有公开内容不登录也能读的平台设 `guest: true`（见 5.2）。

命令的字段：

| 字段 | 说明 |
|---|---|
| `summary` | 一句话说明 |
| `args` | 位置参数 |
| `options` | 私有选项和筛选取值，用 zod 声明 |
| `supports?` | 词表给这个命令的标准选项里，平台支持哪些（如 `item publish` 的发布选项）。不写时全部支持；没列出的不出现在帮助里，用了报 `UNSUPPORTED` |
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
├── AGENTS.md  CLAUDE.md→AGENTS.md
├── README.md（英文，默认；另有 zh-CN、ja、ko 译本）  CHANGELOG.md  llms.txt
├── package.json  tsconfig.json  tsconfig.build.json   # npm 主包 catbus-cli
├── Dockerfile  compose.yaml  Makefile  .dockerignore
├── .github/                        # 仓库治理：CONTRIBUTING、TESTING、SECURITY、PRIVACY、CODE_OF_CONDUCT
├── assets/                         # logo、banner、README 用的图（由 scripts/gen-assets.mjs 生成）
├── docs/
│   ├── guide/  platforms/          # 用户指南、各平台说明
│   ├── examples/                   # 组合 catbus 的示例脚本
│   ├── capabilities.md             # 能力矩阵（由注册表生成，不手改）
│   ├── upstream-map.md             # 上游移植对照
│   └── trouble.md  roadmap.md      # 内部文档（真机验证记录、路线图）：只在本地，不进版本控制
├── .claude/skills/catbus/          # 给 AI Agent 的技能：SKILL.md 总纲，platforms/、workflows/ 按需读；与注册表的一致性由 tests/skill.test.ts 检查
├── references/                     # 上游仓库：只读，不进版本控制
├── src/
│   ├── cli/                        # 入口 main.ts、argv 解析、帮助、信封输出、确认
│   ├── tui/                        # 终端界面（4.13）：只依赖 core/、cli/exec.ts（进程内运行命令）和平台注册表（platforms/index.ts），不依赖具体平台
│   ├── core/                       # registry、auth store、config、errors、http、schemas、signing(vm)、log
│   ├── platforms/_shared/          # 多个平台共用、但不属于 core 的实现，例如 impaas.ts（闲鱼、淘宝的钉钉 IMPaaS 私信长连）
│   └── platforms/<p>/
│       ├── index.ts                # 平台声明与命令注册
│       ├── UPSTREAM                # 移植所基于的上游仓库与 commit
│       └── web/                    # web 端实现；app/、pc/ 等真正实现时再建
├── static/<p>/                     # 上游签名 JS、proto 等，原样复制
├── packages/assets-jd/             # @cv-cat/catbus-assets-jd
├── packages/assets-ocr/            # @cv-cat/catbus-assets-ocr
├── scripts/golden/<p>/             # 调用上游 Python 生成对拍数据
└── tests/                          # vitest；golden/<p>/ 放对拍数据
```

`.gitignore`：`references/`、`node_modules/`、`dist/`、`packages/assets-jd/`、`packages/assets-ocr/` 下的模型文件，`gen:assets` 下载的字体 `.cache/`，以及内部文档 `docs/trouble.md`、`docs/roadmap.md`。

### 7.8 provider 协议（规划中）

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
