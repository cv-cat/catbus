# AGENTS.md — catbus（猫巴士）

> 本文件是本项目给所有 AI 编码代理（Claude Code / Codex / Cursor 等）的统一说明，也是 catbus 的规范本身。
> `CLAUDE.md` 通过 `@AGENTS.md` 引用本文件，**只维护这一份**。

## 1. 目标

做**一个 CLI —— 操作各大平台接口的统一入口**。

- 一个命令 `catbus`，按统一的命令规范调用 10 个平台：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。另有直接对接官方接口的 12306 和 YouTube（见第 3 节）。
- 能力来源是作者 [cv-cat](https://github.com/cv-cat) 的 10 个开源仓库，已克隆到 `references/`，作为**只读的原始来源**。
- 所有平台都在本仓库里**用 TypeScript 重写**，不在运行时调用上游的 Python。
- **用户只需要安装 Node**（版本见 7.1）。不需要 Python，不需要 C/C++ 编译器，也不需要其他系统依赖。例外：YouTube Studio 写操作和 Discord WebAuthn 需要本机 Chromium（见 5.7、5.10）。
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

- 目前支持第 3 节的 16 个平台。Discord `discord` 使用 macOS 桌面协议（`pc` 端），其余平台使用 `web` 端（见 4.3）。
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
| discord | discord-cli（本地 Python 上游） | `discord_cli/api.py`、`fidelity.py`、`gateway.py`、`remote_auth.py`（来源和摘要见 `src/platforms/discord/UPSTREAM`） |

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
- 端用选项 `-e/--endpoint` 指定，省略时用平台的默认端（见 4.3）。

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
| `discord` | — |

目录名、配置键、输出里的 `platform` 字段一律使用**规范 id**。只有平台有别名；resource 和 action 没有别名。

### 4.3 端（endpoint）

- `-e/--endpoint web|app|pc` 分别表示网页、移动应用和桌面客户端。省略时用注册表里的平台默认端，通常是 `web`，Discord 默认 `pc`。
- Discord 的 `pc` 端在帮助中标为「macOS 桌面端」。Discord 的 `web`、`app` 与其他平台尚未实现的端标为 planned。

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
| discord | 消息（使用 `msg` 词表） |

各动作的说明：
- `item list`：当前账号自己发布的内容，带审核状态，数据来自创作者中心。
- B 站 `topic search <keyword>` 使用创作中心投稿话题接口，返回话题 ID、名称、话题页和稿件播放量；支持偏移游标续页，登录必需。
- `item related`：相关推荐。
- `item media`：可播放 / 可下载的媒体地址。
- `item download`：把{item}的媒体下载到本地，可以同时导出帖子信息和评论（`--meta` / `--comments`，见 4.9「下载」）。
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
| discord | `auth login` | 默认 `qrcode`（手机端确认），支持 `password` 和 `token`。账密登录可用 `--mfa-method totp\|sms` 与 `--code` 提交已有验证码；人工验证码在浏览器完成，`--mfa-method webauthn` 通过浏览器调用通行密钥或安全密钥 | Account |
| discord | `user get [<user>]` / `account settings` / `device register` | 查询当前用户（默认 `me`）或指定用户、账号设置、按上游算法保存账号设备 ID 至 core 凭证 | User / `{settings}` / `{id client_uuid}` |
| discord | `guild list` / `guild get <guild>` / `guild leave <guild>` | 列服务器、查详情、退出服务器（确认） | `{id name icon}[]` / `{id name icon}` / `{id}` |
| discord | `channel list <guild>` / `channel get <channel>` / `channel create <guild> <name>` / `channel update <channel>` / `channel delete <channel>` | 服务器频道。创建支持 `--channel-type`、`--channel-topic`、`--parent`、`--channel-position`，编辑支持 `--name`、`--channel-topic`；删除需确认 | `{id guild_id name type topic}`（列表为数组）/ `{id}` |
| discord | `msg get <conversation> <message>` / `msg update <conversation> <message> <text>` / `msg purge <conversation> <messages>` / `msg typing <conversation>` | 查单条、编辑、批量删除（2 至 100 个逗号分隔 ID，确认）、输入状态 | Message / `{ids}` / `{id}` |
| discord | `msg pins <conversation>` / `msg pin <conversation> <message>` / `msg unpin <conversation> <message>` | 查询置顶、置顶、取消置顶 | Message[] / `{id}` |
| discord | `msg send [<text>] --conversation <id>` 或 `--to <user>`，可加 `--file <path>` / `--reply-to <message>` | 发送至频道或新建单人私信；附件按槽位流程上传并发消息；`msg read` 要求 `--message` | Message / `{id}` |
| discord | `reaction list <conversation> <message> <emoji>` / `reaction add <conversation> <message> <emoji>` / `reaction delete <conversation> <message> <emoji>` / `reaction clear <conversation> <message> [<emoji>]` | 反应用户列表、加反应、移除反应（`--user-id` 可指定用户，确认）、清空单类或全部反应（确认） | User[] / `{id}` |
| discord | `friend add <target>` / `friend delete <user>` / `friend accept <user>` / `friend block <user>` / `friend unblock <user>` | 按 ID 或用户名添加好友，其余按 ID 操作；移除好友需确认 | `{id}` |
| discord | `attachment download <url>` / `gateway get` / `gateway listen` | 下载附件（`--dir`、`--overwrite`）、Gateway 发现、流式接收 Gateway 事件（`--events`） | `{path filename size}` / `{url}` / `{event data}` |
| mteam | `auth login [--api-key-file <文件> \| --api-key-stdin]` | 官方 API Key 登录，默认 `--method apikey`；TTY 下省略选项时隐藏输入。凭证写入 `scopes.main.tokens.api_key`，不接受命令行明文 Key | Account |
| mteam | `auth login --method password --username <name> --password-stdin [--email <邮箱>] [--code <验证码>]` | 网页账密登录（`/login`，请求带网页前端的 HMAC 签名）。新设备要两步验证（code 1001）：邮箱方式先用 `--email` 让站点发码，非 TTY 下保存中间态（10 分钟有效，不含密码）后返回 `{sent, verify}`，再带 `--code` 重新执行一次（密码仍从 stdin 读）；TOTP 方式直接带 `--code`。凭证写入 `scopes.main.tokens` 的 `auth`（JWT）、`did`、`visitor_id`；站内信只支持这种登录 | Account |
| mteam | `item search <kw>` / `feed list` `[--mode normal\|movie\|tvshow\|music\|anime\|adult] [--category <id>] [--free] [--order-by date\|size\|seeders\|leechers\|name] [--asc]` | 资源搜索 / 浏览，默认综合区 normal；`--free` 只看免费资源；私有选项 `--order-by` 按字段排序（默认降序，`--asc` 升序；站点置顶的资源总在最前）；沿用 `--limit` / `--cursor` / `--all`。`feed list` 表示浏览最新资源，`item list` 仍保留“自己的投稿”语义 | Torrent[] |
| mteam | `item get <item>` / `item categories` / `item download <item> [--qbit] [--qbit-category <name>] [--qbit-paused] [--qbit-savepath <dir>]` | 详情 / 分类 / 下载 `.torrent` 文件；下载沿用 `--dir` / `--overwrite`。文件可能包含 Tracker 凭证，权限 0600，输出 File.url 为 null，不输出临时下载链接。私有选项 `--qbit` 下载后推送到本机 qBittorrent Web UI（`CATBUS_MTEAM_QBIT_URL`，默认 `http://127.0.0.1:25254`，直连、不走代理，默认分类 `mteam`，`--qbit-savepath` 指定保存目录，不给时用 qBittorrent 自己的设置）。带 `--qbit` 时 `data` 改为 `{id files qbit}`：`files` 同不带时的 File[]，`qbit` 为 `{status category savepath paused}`，`status` 为 `added`（已添加）或 `exists`（qBittorrent 回 `Fails.`，通常是已在任务列表，仍算成功，stderr 另有警告）。推送失败时整条命令报错（种子文件和 `--meta` 的 ExportDoc 照样写好）：连不上 Web UI 为 `NETWORK`，Web UI 要求认证（403）为 `ERROR`，其他 HTTP 错误或无法识别的回复为 `UPSTREAM`；`error.detail` 为 `{qbit: "failed", id, files, http_status}`，`files` 是已保存的文件，`http_status` 取不到时为 null。`detail.qbit` 为 `failed` 就表示种子已保存、只是推送失败；没有它的错误发生在保存种子之前。一次只下载一个 item，批量时按条执行，每个信封对应一个 `id` | Torrent / Category[] / File[] / `{id files:File[] qbit}` |
| mteam | `item collect` / `item uncollect <item>` / `user collects [me] [--mode <分区>]` | 收藏 / 取消收藏（接口按目标状态设置，重复执行不报错）/ 收藏列表（按分区，默认 normal） | `{id}` / Torrent[] |
| mteam | `seed list [--status seeding\|leeching\|completed\|incomplete\|uploaded]` | 我的做种 / 下载中 / 已完成 / 未完成 / 已发布列表，默认 `seeding`；本账号在该种子上的上传、下载、分享率写进 `text`。分页沿用 `--limit` / `--cursor` / `--all` | Torrent[] |
| mteam | `seed stats` | tracker 上当前的做种数和下载数（`/tracker/myPeerStatus`） | `{seeding leeching}` |
| mteam | `exam get` | 进行中的考核（新人考核等）进度（`/examine/getMyActiveList`）：`items` 依次为 `download` / `upload`（字节）和 `bonus`（魔力值），各带 `current target done`；没有进行中的考核时返回空数组 | `{id title status start_at end_at note items[{name current target done}]}[]` |
| mteam | `bonus get` | 时魔（`/tracker/mybonus`）：`per_hour` 每小时魔力值、`a` A 值、`seeding_count` / `seeding_size_gb` 计入时魔的做种数和体积（GB）、`two_factor` 是否开启两步验证 | `{per_hour a seeding_count seeding_size_gb two_factor}` |
| mteam | `bonus history` | 魔力值、上传量、下载量的变动记录（`/credit/logs`）：`change` 为魔力值变化，`note` 是站点说明（`text`）处理后的文字加上传 / 下载变化，以「；」分隔：去掉 IP（`[IP=…]` 和正文里的 IPv4 / IPv6）和种子 ID（`[TID=…]`），促销 `[DP=P50]` 写成「促销：50%」（促销代码的含义按站点代码推断），`[EXAM]` 写成「考核期间」（正文或其他标签里已经有「考核」时不再追加），中文标签（如 `[做種積分]`）去掉方括号，其余标签原样保留；`url` 是相关种子的详情页（格式同 Torrent.url，取 `[TID=…]`，没有时取 `TORRENT` 记录的 relatedId），没有相关种子时为 null；站点不给变动前后的余额，`before` / `after` 为 null | BonusRecord[] |
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
| bilibili | `series add <series> <item>` | 把已发布的稿件加进合集（`x2/creative/web/season/section/episodes/add`），挂到合集的第一个小节下；只能加进自己创建的合集 | `{id}`（稿件 BV 号） |
| bilibili | `series sort <series> [--order asc\|desc]` | 按发布时间重排合集第一个小节里的稿件（`x2/creative/web/season/section/edit`），`asc` 最早在前（默认），`desc` 最新在前；只能排自己创建的合集，合集自己的「排序方式」开关仍要在网页端设置 | `{id moved}`（合集 ID、移动的稿件数，顺序已对时为 0） |
| bilibili | `item subtitles <item>` | 字幕 | Subtitle[] |
| bilibili | `danmaku list <item>` | 视频弹幕。`--raw` 时每条是弹幕分段（`DmSegMobileReply`）里的原始字段：`id` `progress`（毫秒）`mode`（1–3 滚动、4 底部、5 顶部、6 逆向、7 高级、8 代码、9 BAS）`fontsize` `color`（十进制 RGB）`midHash` `content` `ctime` `weight` `pool` `idStr` `attr`，取不到的为 null | Danmaku[] |
| bilibili | `item media <item> [--all-tracks]` | 私有选项：返回 DASH 的全部轨道，不只挑最高画质的一路视频和码率最高的一路音频。视频轨按画质（`Media.id` 为 B 站的 qn，如 80 是 1080P、120 是 4K、125 是 HDR、126 是杜比视界）从高到低、同画质按码率从高到低，音频轨（含杜比全景声、Hi-Res 无损）按码率从高到低；`--raw` 时每条是 playurl 里的原始轨道（带 `codecs`、`SegmentBase`、`backupUrl`）。账号看不了的画质不在里面。老稿件没有 DASH 时和不带这个选项一样，是整段的 durl | Media[] |
| bilibili | `danmaku send <item> <text> --offset <秒> [--color] [--font-size] [--position]` | 发视频弹幕。`--color` 为 `#RRGGBB` 或十进制，`--font-size` 默认 25，`--position scroll\|top\|bottom` 默认 `scroll` | `{id}` |
| bilibili | `dynamic publish --text [--image]` | 发动态 | `{id url}` |
| bilibili | `dynamic delete <id>` | 删动态。`<id>` 为动态 ID 或动态链接（`dynamic publish` 输出的 `id`、`url` 都可以） | `{id}` |
| bilibili | `article publish --title --text [--category] [--tag] [--summary] [--draft]` | 发专栏：先存草稿，再提交。`--category` 为专栏分区 ID（数字，默认 0），没有对应的 categories 命令；`--summary` 为摘要；`--draft` 只存草稿、不提交。上游没有专栏封面，所以没有 `--cover` | `{id url}` |
| bilibili | `draft get <id>` | 专栏草稿 | Item（`kind` 为 `article`，`status` 为 `draft`） |
| bilibili | `draft delete <id>` | 删专栏草稿 | `{id}` |
| bilibili | `user items <user> [--keyword <词>]` | 私有选项：只看投稿里匹配关键词的 | Item[] |
| bilibili | `item collect` / `uncollect <item> [--folder <收藏夹 id>]` | 私有选项：收藏进 / 移出指定收藏夹，多个用逗号分隔。不给时收藏进第一个收藏夹，取消时从所有收藏夹移出 | `{id}` |
| bilibili | `item publish [--source <来源>] [--dynamic <文案>] [--allow-reprint] [--cover43 <4:3 图>] [--series <合集>] | 私有选项：`--source` 表示转载并给出来源，不给为自制；`--dynamic` 为同步到动态的文案；默认禁止转载，`--allow-reprint` 允许；`--cover43` 是稿件列表页的 4:3 封面，和 `--cover`（播放页 16:9）一起构成 B 站的双封面；`--series` 发布后把稿件加进合集（合集 ID 或合集链接），挂到合集第一个小节下 | Item |
| bilibili | `comment add <item> <text> --reply-to <comment> [--root <comment>]` | 私有选项：回复楼中楼时 `--root` 给根评论、`--reply-to` 给被回复的那条；不给 `--root` 时 `--reply-to` 就是根评论 | Comment |
| bilibili | `comment pin <item> <comment>` / `comment unpin <item> <comment>` | 置顶 / 取消置顶一级评论（`x/v2/reply/top`）。只能置顶自己管理的评论区里的一级评论；已有置顶时再置顶报 12029 | `{id}`（评论 ID） |
| bilibili | `live send <room> <text> [--color] [--font-size] [--position] [--reply-user <user>]` | 私有选项：弹幕样式同 `danmaku send`；`--reply-user` 为回复的观众（UID 或空间链接） | `{id}` |
| xianyu | `item publish [--original-price <金额>]` | 私有选项：原价（元），要和 `--price` 一起用 | Item |
| xianyu | `item publish [--shipping free\|distance\|fixed\|none]` | 私有选项：运费方式，默认 `free` 包邮；`distance` 按距离计费，`fixed` 一口价，`none` 无需邮寄 | Item |
| xianyu | `item publish [--postage <金额>]` | 私有选项：一口价运费（元），配合 `--shipping fixed` | Item |
| xianyu | `item publish [--pickup]` | 私有选项：支持自提 | Item |
| douyin | `item search <kw> [--length all\|short\|medium\|long] [--range all\|seen\|unseen\|following]` | 私有选项：视频时长（不限 / 1 分钟内 / 1–5 分钟 / 5 分钟以上）、搜索范围（不限 / 看过 / 没看过 / 关注的人）。`--type video` 走视频频道搜索，其余走综合频道（筛选值随 `filter_selected` 发出）；`--type image` 只要图文 | Item[] |
| douyin | `user search <kw> [--fans 0_1k\|1k_1w\|1w_10w\|10w_100w\|100w_] [--user-type common\|enterprise\|personal]` | 私有选项：粉丝数区间、用户类型（普通 / 企业 / 个人认证） | User[] |
| douyin | `item publish [--poi-name <名称>] [--series <合集 id>] [--hotspot <热点词>] [--no-download] [--ai-generated]` | 私有选项：地点名称（配合 `--poi`）、加入合集、关联热点、不允许下载、为视频或图文添加「内容由 AI 生成」声明（默认不声明） | Item |
| douyin | `item collect <item> --folder <folder>`、`item uncollect <item> --folder <folder>` | 私有选项：收藏后移进某个收藏夹 / 从某个收藏夹移出（仍保留收藏）。`<folder>` 是收藏夹 ID 或名字 | `{id}` |
| douyin | `msg send [--file <path>] [--share <item\|user\|url>]` | 私有选项：发文件（≤10MB）、分享作品 / 用户名片 / 网页卡片 | Message |
| douyin | `live rank <room> [--ranking contribution\|thousand]` | 私有选项：榜单，默认贡献榜，`thousand` 为千票榜 | Rank[] |
| douyin | `live like <room> [--count N]` | 私有选项：一次点赞的次数 | `{id}` |
| douyin | `comment list <product> --product [--label <标签名或 id>]` | 私有选项：商品评价按标签筛选（好评 / 差评 / 有图等） | Comment[] |
| douyin | `notice list [--group all\|fans\|mention\|comment\|like\|danmaku]` | 私有选项：通知分组，不带时为默认分组 | Notice[] |
| xhs | `item publish [--poi-name <名称>] [--poi <id>]` | 私有选项：地点名称。小红书的地点只能按名称搜，搜不到 id，所以 `--poi` 要和 `--poi-name` 一起用（取 id 相同的那个）；只给 `--poi-name` 时取名称完全相同的。都找不到时报 `USAGE` 并列出相近的地点 | Item |
| xhs | `item publish [--original] [--ai-generated]` | 私有选项：原创声明、「笔记含 AI 合成内容」声明，默认都不声明。名称与 douyin 的 `--ai-generated` 相同。定时发布（`--schedule`）的请求里没有声明字段，所以和 `--schedule` 一起用时报 `USAGE`；原创声明要用创作者 ID，登录态里没有时报 `AUTH_REQUIRED` | Item |
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
| maoyan | `item get <item> [--tickets]` | 私有选项：同时查场次（含开始时间）、票档、票面价、实售价、余票、每单限购，逐行追加到 `text`（格式见 4.8），原始字段在 `--raw` 的 `shows`。只有这个选项需要登录，未登录报 `AUTH_REQUIRED` | Item |
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
- bilibili 的 `live list`：不带 `--category` 时是直播首页推荐；`--category` 取 `live categories` 输出的 id，父分区（`parent_id` 为 null）和子分区都可以传，父分区列整个分区，子分区按它的 `parent_id` 找到父分区。分区列表接口要分区页 HTML 里的 `access_id` 作 `w_webid`（缺了报 -352），同一条命令翻页时只取一次。两个接口只返回正在直播的直播间。
- bilibili 的 `comment list` / `replies` 读取图文动态时，先用非上游的动态详情接口取 `basic.comment_type=11` 与 `comment_id_str`（相簿 ID），不能把动态 ID 当作评论区 oid；输出 `Comment.item_id` 仍为动态 ID。同一条命令翻页时复用解析结果。`comment add` / `delete` 仍只支持纯文字和转发动态。
- `msg send --item <item>`：对商品卖家 / 客服发消息（闲鱼、淘宝、京东）。
- `msg send --to <user> --item <item>`：就这件商品给指定用户发消息（闲鱼：卖家主动联系买家）。不支持的平台报 `UNSUPPORTED`。
- maoyan：演出（item）的场次时间、城市、场馆、票价档、售卖状态没有对应的 Item 字段，按「键：值」逐行写进 `text`，原始字段用 `--raw`。接口给了开售时间（`onSaleTime`）时，`feed list` 和 `item get` 的 `text` 另有一行「开售时间：<带时区的 ISO 8601>」（已开售的演出同样有，是过去的时间）；`feed list` 的「开售」仍是站点的相对文案（如「明天开售」）。`poi search` 只搜演出城市，`id` 是 `feed list --city` 的取值。`item get --tickets` 的场次和票档同样写进 `text`，不新增类型：每个场次一行「场次：<站点的场次名>」（如「场次：2026-11-14 周六 19:30」），接口给了开始时间（`startTime`）时下一行是「场次时间：<带时区的 ISO 8601>」，写法与「开售时间」一致；之后该场次的每个票档一行，如「票档：A，票面价 1080，实售价 648，余票 3，限购 6」，依次是票档名（`ticketName`，站点给的是 `A`、`L` 这样的字母，不是价格）、票面价（`ticketPriceVO.ticketPrice`）、实售价（`ticketPriceVO.sellPrice`，打折时低于票面价）、余票（`remainingStock`）、每单限购张数（`ticketBuyLimitVO.maxBuyLimit`），售罄（`showStatus` 为 2）时末尾加「售罄」；取不到的项省略，站点不显示的票档不输出。实测（2026-11-14）余票只出现过不超过限购数的值、限购数又常与余票相同，看起来余票封顶在每单限购数：余票等于限购时应理解为「至少这么多张」，不是精确库存。还没开票的演出没有场次（`--raw` 的 `shows` 为空数组），`text` 里不出现场次行和票档行。
- taobao 没有按用户查询、按用户发起会话的接口：`user get <user>` 的 `<user>` 只接受商品链接，返回这件商品的卖家；`msg send` 不支持 `--to`（报 `UNSUPPORTED`）。
- weibo 的转发微博（Item）：`id`、`url`、`author`、正文和计数仍取转发这条自己的（转发语和转发者）。转发这条自己没有媒体（没有 `page_info`，也没有图片）时，`kind`、`cover`、`media`、文章的 `title` 和视频的 `stats.views` 取原微博（`retweeted_status`），否则详情里只剩转发语、看不到被转发的视频和图片；原微博本身仍挂在 `--raw` 的 `retweeted_status` 上。
- x 的推文归一化（Item）：转推（`legacy.retweeted_status_result`）按原推归一化：`id`、`url`、`author`、正文、媒体和计数都取原推，因为外层只有截断的「RT @…」正文，没有媒体，计数也是 0；原始的转推对象仍挂在 `--raw` 上。推文自己没有媒体时，`cover` 依次退到被引用推文（`quoted_status_result`）的第一张媒体，再退到链接卡片（`card.legacy.binding_values`）的缩略图；`media` 只放推文自己的媒体。

### 4.9 选项

**全局选项**：

| 选项 | 说明 |
|---|---|
| `-a, --account <name>` | 使用哪个账号（见 5.2） |
| `-e, --endpoint web\|app\|pc` | 端，省略时用平台的默认端 |
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
- `--meta`：同时导出帖子信息，在媒体文件旁边（同一个 item 目录，由 `--dir` / `--subdir` 决定）写 `<platform>_<id>.json`（ExportDoc，见下）。帖子信息取自同一平台、同一端的 `item get`。
- `--comments <N|all>`：同时导出一级评论，N 为正整数，`all` 表示全部；默认不取。给了它就隐含 `--meta`。评论取自同一平台的 `comment list`，自动翻页取满 N 条，翻页间隔用平台默认值。
- `--replies <N|all>`：每条一级评论再取多少条回复（楼中楼），取自 `comment replies`；默认不取，只和 `--comments` 一起用时有意义（单独给出时 stderr 提示一行并忽略）。平台给出的回复数为 0 的评论不发请求。
- `--no-media`：不下载媒体，只写 ExportDoc（隐含 `--meta`）；目录规则不变。
- `--comments` / `--replies` 的取值不是正整数或 `all` 时报 `USAGE`。
- 取评论或回复时遇到 `RISK_CONTROL`：停止取评论，已经取到的照样写出，`comments_truncated` 为 true，stderr 提示一行；整条命令仍然成功。其他错误照常报错。
- 平台没有 `comment list` 时 `comments` 为 `[]`，没有 `comment replies` 时不取回复，都只在 stderr 提示一行，不报错。
- ExportDoc 文件已存在时与媒体一样默认跳过（不发请求），`--overwrite` 时重新导出。输出的 File[] 里多一个 `{path, type: "data", url: null, size}`。
- ExportDoc 的结构（UTF-8，缩进 2 个空格，权限与凭证文件相同为 0600）：

  ```jsonc
  {
    "schema": 1,
    "platform": "xhs",
    "exported_at": "2026-11-12T12:00:00+08:00",   // 带时区的 ISO 8601
    "item": {},                                    // 归一化的 Item（6.2），与 item get 的输出相同
    "comments": [],                                // Comment（6.2）再加一个字段 replies: Comment[]（没取时为 []）
    "comments_truncated": false                    // 取评论时遇到风控而停下时为 true
  }
  ```

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
| `catbus web [stop\|status]`（或 `--web`） | 启动 / 停止 / 查看本地 WebUI 服务（见 7.9） |
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

`catbus web`（`--web` 是它的别名，和 `--version` → `version` 一样；`catbus --web stop` 等同于 `catbus web stop`）：

| 选项 | 说明 |
|---|---|
| `--port <n>` | 端口，默认 5174；`0` 表示随机端口。端口被占用时报 `ERROR`，不自动换端口 |
| `--host <addr>` | 监听地址，默认 `127.0.0.1`。不是回环地址（如 `0.0.0.0`）时自动启用访问令牌（见 7.9），stderr 警告一行；`--demo` 时不启用令牌 |
| `--demo` | 演示模式：bridge 拒绝全部 `/api/*`，页面只用演示数据，不会用到任何真实账号；打开的地址带 `?demo` |
| `--headless` | 只启动服务，不打开浏览器 |
| `--detach` | 后台运行：服务就绪后命令立即返回，关掉终端服务也继续运行，日志写到 `cache/webui/server.log` |

- 不带 `--detach` 时在前台运行，直到 Ctrl-C，退出码 0。服务就绪后立即在 stdout 写出信封（`data` 见 6.3），之后 stdout 不再有输出。
- 运行中的服务记录在 `cache/webui/server.json`（`pid host port url demo token started_at`，文件 0600）。再次执行 `catbus web` 时，已有服务还在运行就直接复用：只打开浏览器（`--headless` 时不打开），`data.reused` 为 true；显式给出的 `--port` / `--host` / `--demo` 和运行中的不一致时报 `USAGE`，`hint` 为 `catbus web stop`。
- `catbus web stop`：结束运行中的服务（先 SIGTERM，5 秒后 SIGKILL），删除 `server.json`。没有在运行时 `data.running` 为 false，不报错。
- `catbus web status`：只读 `server.json` 并探测服务是否还活着，不启动服务。记录里的进程已经不在时删除这个记录。
- 打开浏览器：macOS 用 `open`，Windows 用 `rundll32 url.dll,FileProtocolHandler`，其他系统用 `xdg-open`；打不开时 stderr 提示地址，不算失败。
- WebUI 资源（`dist/webui/app/`）不存在时报 `ERROR`，`hint` 为 `npm run build:web`（只会发生在没有构建过 WebUI 的源码目录里）。

### 4.11 危险操作确认

以下操作执行前需要确认：
- 所有 `delete`；
- `msg revoke`；
- Discord 的 `guild leave`、`msg purge` 和 `reaction clear`；
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
- **登录在界面里完成**（5.3 的流程不变）：二维码画在界面里（黑码白底，固定色，不随主题；放不下时提示并可按 `o` 用系统图片查看器打开 `cache/<p>/qrcode.png`；手机已扫码、还没确认时，二维码下面的「等待扫码和确认」换成绿色的 ✓ 和平台的提示，换了新二维码时恢复），短信验证码、密码（隐藏输入）、人机验证和浏览器授权（`oauth`）的链接、cookie 导入都在界面里输入；平台在提问前打的说明（发往哪个手机号、待选账号列表）显示在提问上方。
  - **登录页的表单读注册表**：`auth login` 的选项里，这个登录方式能用的都列出来，文本可填、开关可切，不手写。选项属于哪种登录方式，看说明末尾的标注，例如 `手机号（sms）`、`记住设备（sms / password）`；不标注的对所有方式显示。所以平台或词表新增登录选项时，**说明末尾标上适用的登录方式**，界面就自动出现。不进表单的只有：`--method`、`--scope`（登录页有单独的两行），分步登录用的 `--code`、`--user`（界面里一步完成，由 handler 提问），以及名字以 `-stdin` 结尾的（界面里由 handler 提问）。
  - **实现**：`core/login.ts` 提供 `LoginUi` 钩子（`setLoginUi`）：二维码、已扫码、浏览器链接、提问、是否可交互五处走钩子，CLI 里默认走 stderr 和 readline，TUI 里换成界面。平台在扫码登录里查到「已扫码、等确认」时一律调用 `qrcodeScanned(ctx[, 说明])`，不要自己写日志（见 5.3 的 `qrcode`）。平台的登录流程里要用户输入时一律用 `core/login.ts` 的 `interactive()` / `prompt()`，要用户打开链接时用 `showLink()`，**不要直接读 `process.stdin`、不要自己开 readline**：直接读的在界面里收不到输入。非交互分支（管道喂验证码）可以读 stdin，但要先判断 `interactive()`。
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
├── webui/subscriptions.json      # WebUI 的订阅（见 7.9「订阅」）
└── cache/<platform>/              # 可随时删除：二维码 PNG、短信登录的中间态
```

- 账号名匹配 `[a-z0-9][a-z0-9_-]{0,31}`。`guest` 是保留名。
- 权限：
  - 目录 0700，文件 0600；
  - Windows 依赖用户目录本身的 ACL。
- 所有写入都是原子的：先写临时文件，再 rename。
- 早期 Discord 适配已保存的 `web` 凭证实际使用桌面协议。首次读取账号时，若尚无 `pc` 凭证目录，将旧目录原子迁移到 `pc`，保留当前账号指针。已有桌面凭证优先。

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
catbus <p> auth login [-a <name>] [--method qrcode|sms|password|cookie|oauth|apikey|token] [--scope <scope>]
```

**账号名**：
- 不带 `-a` 时：有当前账号就登录到当前账号，否则登录到 `default`。
- 登录成功后，如果还没有当前账号，就把它设为当前账号。
- 如果该名字下已经存了另一个用户，视为先登出再登录：旧凭证被新凭证替换，stderr 提示一行（不调用服务端登出）。
- `--auto-bind`：不按账号名，而按登录的用户决定存到哪个账号。本平台本端已经有这个用户（`user.id` 相同）的账号时，刷新那个账号的凭证；没有时新增账号：`default` 没被占用就用 `default`，否则按用户 id 起名（转成 5.1 的格式，重名时加 `-2`、`-3`……）。不改变已有的当前账号；还没有当前账号时同样设为当前账号。不能和 `-a`、`--scope` 一起用（报 `USAGE`）。信封里的 `account` 是实际落盘的账号。

**登录方式**：每个平台在注册表里声明支持哪些方式、默认用哪种，见 capabilities.md。

| 方式 | 选项 | 流程 |
|---|---|---|
| `qrcode` | — | 二维码画到 stderr，同时把 PNG 存到 `cache/<p>/`，然后等待扫码。上游能查到「已扫码、还没确认」的，查到时由 `core/login.ts` 的 `qrcodeScanned` 在 stderr 写一行以 `[catbus] 已扫码` 开头的提示（默认「已扫码，请在手机上确认」；平台要求二次验证等情况换后半句），同时调用 `LoginUi.scanned`；状态变化时才写，不在每次轮询里重复。WebUI、TUI 据此标出已扫码，这行的前缀不要改 |
| `sms` | `--phone`、`--code` | TTY 下先发验证码，再交互输入。非 TTY 下分两步：`--phone` 发验证码并保存中间态（10 分钟有效），再单独用 `--code` 完成登录 |
| `password` | `--username`、`--password-stdin` | 密码只从 stdin 读取，TTY 下隐藏输入。需要两步验证的平台（mteam）另用 `--code`，流程同 `sms` 的两步：非 TTY 下第一步发码并保存中间态，第二步带 `--code` 完成 |
| `cookie` | `--cookie <str\|@file\|->` | 导入后调一次 `me` 校验。也接受浏览器导出的 cookie JSON 数组；douyin、tiktok 另外接受一个 JSON 对象，把 ticket、证书、私钥等设备数据一并导入（这两个平台的写操作需要它们） |
| `oauth` | — | 浏览器授权（OAuth 设备码）：授权链接打到 stderr，用户在已登录该平台的浏览器里打开并同意，然后等待授权完成。目前只有 `jimeng`，由 `dreamina` 完成授权（见 5.6） |
| `apikey` | `--api-key-file`、`--api-key-stdin`（mteam 私有选项） | 从本地文件或 stdin 读取官方访问令牌，TTY 可隐藏输入；先在线校验，再由 core 保存到账号凭证。令牌只发到官方 API，不传给重定向目标 |
| `token` | `--token-file <文件>` 或 `--token-stdin`（Discord） | 导入已有 Authorization 凭证，调用 `/users/@me` 校验后由 core 保存。只从文件或 stdin 读取，TTY 隐藏输入 |

- **验证码**：上游能自动过的就自动过，需要人工时按平台流程打开验证页，无法继续时报 `RISK_CONTROL`（`detail.kind = captcha`），退出码 5。
- **登录中的人机验证**：平台在登录流程中途强制的短信验证码验证（例如 xhs 扫码确认后的 HTTP 471，`verifyType` 120 验证页链 / 213 主站登录强制链）由实现自动完成，手机号与验证码沿用 `--phone` / `--code` 或终端输入（非交互可从 stdin 逐行读，包括验证码发往的指定手机号）。验证通过后用同一组未完成的登录参数继续；验证失败与放弃按 `RISK_CONTROL` 报错。站点只接受账号绑定手机时，`hint` 写明。
- **子站点**（创作者中心、直播、IM 等）：
  - 能自动换取的凭证，登录时或第一次用到时自动获取，不需要用户再登录一次（例如 xhs 的创作者中心：用主站登录态换取）；
  - 需要单独登录的，用 `--scope <name>` 登录，各平台可用的 scope 在注册表里声明；
  - 命令缺少所需 scope 时，报 `AUTH_REQUIRED`，`hint` 带上 `--scope`。
- **`auth status`**：在线校验，返回 AuthStatus。未登录或已失效时返回 `logged_in: false`，不报错。校验成功且返回的是同一个用户时，新的昵称 / 头像由 core 回写到凭证文件。
- **头像**（账号的头像；作者、评论者等 UserRef 的头像见 6.2）：登录、cookie 导入校验和 `auth status` 复用流程里本来就有的那次当前用户请求，取到头像就存进凭证的 `user.avatar`（统一成 https 绝对地址），不为头像额外发请求；取不到时为 null。旧凭证文件没有 `avatar` 时读成 null，不需要迁移。
- **`auth logout`**：删除本地凭证文件（上游支持服务端登出的，同时调用服务端登出，包括 B 站、快手、即梦和 Discord），并清除指向它的 `_current`。
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
  "method": "qrcode",                    // qrcode | sms | password | cookie | oauth | apikey | token | guest
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

[discord]
browser = "/path/to/chromium"     # WebAuthn 用的本地 Chromium（见 5.10）
```

- 代理的优先级：`--proxy` > `<platform>.proxy` > `proxy`。
- 不读取 `HTTP(S)_PROXY` 环境变量，代理只能显式配置。
- `catbus config set xhs.proxy <url>`，用点号表示平台段。
- `youtube.browser` 与 `discord.browser` 只接受已存在的绝对路径（`checkBrowser`），不接受代理地址。

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

### 5.9 YouTube 的媒体下载（照 yt-dlp 的方式）

`youtube` 的 `item media` / `item download` 按 yt-dlp 的客户端顺序与解算方式取可下载的媒体地址（登录后的 WEB 客户端只给 SABR 流，没有可直接下载的地址）：

- **客户端顺序**：tv_samsung（首选，格式上限最高）→ visionos（明文直链，格式上限较低）→ 被人机验证拦下时走 iOS + PO token 的兜底（同 yt-dlp 的 PO Token Provider，见 `pot.ts`）。tv_samsung 与 visionos 都不带登录。
- **tv_samsung**：TVHTML5 客户端（clientVersion `5.20260707`、TV UA、`X-Youtube-Client-Name: 7`），player 请求必须带首页 ytcfg 的 visitorData 与 player JS 里的 `signatureTimestamp`（STS），缺了整个响应 UNPLAYABLE。
- **player JS**：路径取首页 ytcfg 的 `PLAYER_JS_URL`，没有时按 yt-dlp 的方式从 `/iframe_api` 拿当前版本再拼 `/s/player/<id>/base.js`。STS 用 yt-dlp 同款正则取；player JS 缓存在 `cache/youtube/`（AGENTS 5.1，按 player id 存文件，可随时删除），体积下限防止 HTML 错误页落缓存。
- **签名解算**：tv_samsung 的地址全是 `signatureCipher`（s 签名）且 URL 带 n 挑战。照 yt-dlp 的 EJS 方式：它的 solver core（`vendor/yt.solver.core.js`，Unlicense）原样复制进 `static/youtube/`，在 `node:vm` 里执行（AGENTS 7.4），AST 库 meriyah + astring 注入 context，批量解出 s 与 n 后拼回 URL；n 的替换按原文替换参数值，保持 query 参数顺序（googlevideo 的直链参数顺序敏感）。解算失败报 `UPSTREAM`，上层退到 visionos。
- **格式排序**：与 yt-dlp 的 FormatSorter 默认一致——视频分辨率 → 帧率 → 编码（av01 > vp9.2 > vp9 > h265 > h264 > vp8）→ 码率，音频码率 → 编码（opus 优先）；各取一路最优，没有分轨时用 muxed。OTF 流（`FORMAT_STREAM_TYPE_OTF`）与 DRM 不能直接下载，跳过（yt-dlp 同款）。
- **下载**：googlevideo 拒绝整文件请求。tv_samsung 的地址带 Range 请求头也会被 403，必须用它的 TV UA 加 `&range=<start>-<end>` 参数分段（每段 10 MB）；visionos 的地址沿用通用分段。地址来源客户端记在原始对象上，按来源选 UA。
- **测试**：离线测试用合成 mini player fixture（满足 solver 的 AST 约定，`tests/fixtures/youtube/mini-player.js`）与真实响应裁剪的 fixture，覆盖 tv_samsung 首选、UNPLAYABLE 退回 visionos、人机验证退 PO token、分段下载与 UA 选择。

### 5.10 Discord 人工验证与 WebAuthn

- 账密登录或添加好友遇到 hCaptcha 时，在 `127.0.0.1` 提供一次性页面，用户在系统浏览器操作官方组件。交互式 stderr 自动开启此流程，非交互式调用可显式加 `--captcha`。页面回调绑定源与 CSRF，完成后只在原请求的 `X-Captcha-*` 头里提交当次结果。每次请求最多接受上游既有的两次人工提交。取消、超时或验证未通过返回 `RISK_CONTROL`。
- Discord 提供 WebAuthn challenge 后，`--mfa-method webauthn` 或仅允许该方式的 MFA 会打开临时 Chromium 窗口。使用经过正常 TLS 验证的 `https://discord.com/robots.txt` 纯文本页和隔离执行上下文。用户点击验证后，浏览器调用系统通行密钥或硬件安全密钥。Chromium 用 DevTools pipe 和临时 profile，接收的只有公开 challenge 参数。
- CLI 检查 challenge、origin、RP ID 和凭证范围后，将断言 JSON 作为字符串 `code` 提交至 `/auth/mfa/webauthn`。浏览器配置使用 `discord.browser` 或 `CATBUS_DISCORD_BROWSER`，也可发现本机 Chrome、Chromium 和 Playwright Chromium。其他登录方式继续只依赖 Node。

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
| Media | `id type url width height duration`。`url` 在刚上传、平台还没给出可访问地址时（例如视频转码前），或列表接口只给时长、不给播放地址时（例如 bilibili 的搜索、推荐流，此时 Media 只用来表示视频时长）为 null |

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
| Event | `type time user:UserRef text gift{name count}\|null stats{viewers likes}\|null` |
| Gift | `id name price:Price` |
| Rank | `rank user:UserRef score` |

`Event.stats` 是这条消息带来的直播间实时数据：`viewers` 为当前在线人数，`likes` 为直播间累计点赞数，消息里没有的那项为 null；不带这类数据的消息为 null。只用来更新直播间的数字、没有用户动作的消息（如抖音的 `RoomStatsMessage`，B 站的 `ONLINE_RANK_COUNT`、`LIKE_INFO_V3_UPDATE`）`type` 为 `other`，`text` 仍是可读的说明；带用户动作的消息照常归类，只是另带 `stats`（如抖音的点赞消息同时带累计点赞数）。

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
| Ticket | `id url train_no type start{code name} end{code name} from{code name no} to{code name no} depart arrive duration date bookable has_ticket seats remaining prices seat_types` |
| Stop | `id station arrive depart stopover in_range url:null` |
| Fare | `id train_no date prices url:null` |
| Transfer | `id via same_station same_train kind depart arrive duration_minutes wait legs url:null` |
| TransferLeg | `id url train_no from to depart arrive duration seats remaining prices`，`url` 取不到时为 null |

**铁路与出行扩展字段说明**：
- `Ticket.url` 为 12306 官方余票查询深链（`https://kyfw.12306.cn/otn/leftTicket/init?...`），可直接在浏览器打开。
- `Ticket.start` / `end` 为本车次的始发站和终到站（`from` / `to` 是乘车区间）：`from.code` 与 `start.code` 相同表示在始发站上车，`to.code` 与 `end.code` 相同表示坐到终到站。站名先取余票接口响应里的 `map`，再取车站表，都没有时用电报码。
- `TransferLeg.url` 为这一段的余票深链，格式同 `Ticket.url`：站名和电报码取这一段的出发站、到达站，日期为这一段的上车日期（第一段取方案的 `train_date`，之后的段取 `middle_date`；段里的 `start_train_date` 是车次的始发日期，不用）。接口没给电报码或日期时为 null。`Transfer.url` 仍为 null。
- `prices` 中每个席别的值均为 `Price { amount, currency: 'CNY' }`，单位为元。
- `remaining` 为每个席别的余票张数：≤20 时为精确整数，≥21 时为封顶对象 `{ min: 21 }`；无座张数不封顶，为精确整数。
- `Transfer.kind`：同一车次分段有座（`same_train: true`）标为 `同车换座`，不同车次换乘标为 `换乘`。

**枚举值**：

| 字段 | 取值 |
|---|---|
| Item.kind | `video` `image` `text` `article` `goods` `torrent` |
| File.type | `image` `video` `audio` `torrent` `data`（`item download --meta` 写出的 ExportDoc，见 4.9「下载」） |
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
| `platforms` | Platform[] `{id name aliases default_endpoint endpoints{web app pc} commands[{endpoint resource action auth status upstream note}]}`；带平台参数时返回单个对象 |
| `doctor` | `{name ok message}[]` |
| `config list` | 对象：只含已设置的项，键用点号展开，例如 `xhs.proxy` |
| `config get` | 值 |
| `config set` / `unset` | `{key value}` |
| `version` | `{version node platform arch}` |
| `web` | `{running url host port pid demo detached reused log started_at}`；`url` 是带令牌的完整地址 |
| `web stop` | 同 `web`：停止前在运行的那个服务；没有在运行时只有 `running: false`，其余字段为 null |
| `web status` | 同 `web`，没有在运行时只有 `running: false`，其余字段为 null |

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
| `catbus-cli` | `dist/`（CLI、core、全部平台、WebUI 服务端 `dist/webui/` 与构建好的前端 `dist/webui/app/`）和 `static/`（上游签名 JS 等）。bin 为 `catbus` → `dist/cli/main.js` |
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
| 签名 JS 的依赖 | jsdom（JD）、crypto-js（XHS）、@napi-rs/canvas（JD、KS）、meriyah + astring（YouTube 的 player JS 解算，AGENTS 5.9） |
| 校验 | zod |
| 参数解析 | `node:util` 的 `parseArgs`，加上注册表。不用 CLI 框架 |
| 配置 | smol-toml |
| zip 打包（WebUI 把多个下载文件交给浏览器） | yazl：纯 JS，流式输出，支持 zip64 |
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
- 平台可通过 `defaultEndpoint` 声明默认端，默认值为 `web`。可用端可以用 `label` 提供 CLI 帮助中的名称。
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
│   ├── webui/                      # WebUI 服务端：bridge、登录、下载、媒体代理、静态文件、catbus web 的进程管理（见 7.9）
│   ├── platforms/_shared/          # 多个平台共用、但不属于 core 的实现，例如 impaas.ts（闲鱼、淘宝的钉钉 IMPaaS 私信长连）
│   └── platforms/<p>/
│       ├── index.ts                # 平台声明与命令注册
│       ├── UPSTREAM                # 移植所基于的上游仓库与 commit
│       └── web/                    # web 端实现；app/、pc/ 等真正实现时再建
├── static/<p>/                     # 上游签名 JS、proto 等，原样复制
├── packages/assets-jd/             # @cv-cat/catbus-assets-jd
├── packages/assets-ocr/            # @cv-cat/catbus-assets-ocr
├── scripts/golden/<p>/             # 调用上游 Python 生成对拍数据
├── web/                            # 本地 WebUI 前端（Vite + Vue 3，见 7.9）：独立的 npm 包，构建产物随 catbus-cli 发布
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

### 7.9 WebUI（开发中）

`web/` 是 catbus 的本地图形界面：左侧渠道（平台）菜单，右侧搜索结果瀑布流；亮色 / 暗色两套主题。

- **技术栈**：Vite + Vue 3 + TypeScript，动效用 GSAP，图标用 lucide，多语言用 vue-i18n（见「多语言」）。跨组件共享的状态放 Pinia（setup 风格的 store，`web/src/stores/`，一个 store 一个文件；组件外调用的 `openLogin()`、`openVerify()`、`toast()` 等在函数体里取 store），纯逻辑和局部逻辑留在 `web/src/composables/`。发现页的初始平台、排序、类型和每页条数取自设置（`web/src/stores/settings.ts`），平台不支持时的兜底值在 `web/src/stores/discover.ts` 的 `DEFAULTS`。前端是独立的 npm 包（`web/package.json`，`private: true`），在 `web/` 下自己装依赖，不加进根目录的 workspaces。
- **随包发布**：`npm run build:web`（`scripts/build-web.mjs`：`web/` 下没有 `node_modules` 时先 `npm ci`，再 `vite build`）把前端构建到 `dist/webui/app/`；`prepack` 依次执行 `build` 和 `build:web`，所以 npm 包里带着构建好的前端，用户不需要 Vite，也不需要再装依赖。`web/` 的源码本身不进包。`npm run build` 不构建前端（清理 `dist/` 时会一并删掉，开发时要用 `catbus web` 就再执行一次 `build:web`）。
- **服务端**：`src/webui/`，用 `node:http` 写，不依赖 Vite。`createBridge()` 返回一个处理 `/api/*` 的 handler，`catbus web`（4.10）用它加上静态文件服务起一个服务；开发时 `web/vite.config.ts` 的插件把同一个 handler 挂到 dev server 上（从编译好的 `dist/webui/` 加载，所以要先在根目录 `npm run build`）。静态文件只从 `dist/webui/app/` 里取，路径规范化后必须仍在该目录下，找不到的路径回退到 `index.html`。
- **数据**：浏览器不直接调平台接口。bridge 接收 `POST /api/catbus {argv}`，用子进程运行同一份 catbus（`process.execPath` + 本包的 `dist/cli/main.js`，开发时可用 `CATBUS_BIN` 覆盖），把 stdout 的信封原样返回。同时运行的子进程最多 4 个，其余按到达顺序排队（`src/webui/runner.ts`）；`version`、`platforms`、`auth list` 这类不访问平台的探测走单独的通道，不排在长请求后面。客户端在响应前断开时，排队中的直接出队、不启动子进程，运行中的结束子进程（SIGTERM，几秒后仍在就 SIGKILL）。页面在已经只采用最后一次结果的地方（发现页的搜索与各渠道的第一页、搜索联想、详情卡片换条目或关闭时的详情 / 评论 / 回复预取 / 相关推荐、作者页换作者）用 AbortSignal 取消过期的请求，被取消的不显示成错误、不弹提示、不把渠道缓存或账号标成失效；翻页不会因为无关的操作被取消。登录方式直接读本包的注册表。登录态仍只由 core 读写（5.4）。
- **访问控制**：所有 `/api/*` 请求都校验 `Host` 头（只接受回环名、监听地址本身，防 DNS rebinding）和同源。监听地址不是回环地址时启用访问令牌（`--demo` 除外：演示模式下 bridge 拒绝全部 `/api/*`，没有需要保护的数据，所以不要令牌，也不校验 `Host`，局域网里的设备直接打开 `/?demo`）：启动时生成 32 字节随机令牌，打开的地址带 `?token=<令牌>`，服务端校验后写入 `HttpOnly; SameSite=Strict` 的 cookie 并重定向到去掉令牌的地址；之后没有这个 cookie 的请求（包括静态文件）一律 401。令牌只存在 `server.json`（0600）和打开的地址里，不写日志。
- **bridge 的边界**：默认只监听 `127.0.0.1`（`--host` 改成别的地址时启用访问令牌，见上），拒绝跨站请求；argv 走白名单（另有只读的 `GET /api/filters`，见「筛选」），目前只放行 `version`、`platforms`、`auth list`、`<p> item search`、`<p> feed list`、`<p> item get`、`<p> comment list`、`<p> comment replies`、`<p> user get`、`<p> user items`（作者页，见「作者页」）、`<p> keyword suggest`、`<p> keyword hot`（搜索联想与热搜，见「搜索联想与热搜」；前缀最长 100 个字符）、`<p> item related`（只带 `--limit`，见「相关推荐」）、「我的」页的 `<p> item list`、`<p> user likes` / `collects` / `reposts`、`<p> folder list`、`<p> folder items`、`<p> series list`、`<p> series items`、`<p> history list`（见「各平台的「我的」页」；`user get` 另接受 `me`，列表命令只带 `--limit` / `--cursor`，`<folder>` `<series>` 只接受 http(s) 链接或 ID）及其分页 / 筛选选项（`item search` 的 `--sort` / `--type` / `--time`，`feed list` 的 `--kind`，见「筛选」）、`item search` / `feed list` 的平台私有排序 `--order-by <字段>` 和开关 `--asc`（见「筛选」，目前只有 mteam 声明）、详情卡片的 `<p> item media`、`<p> item subtitles`、`<p> danmaku list`（见「详情卡片的字幕、弹幕与媒体链接」，只带 `<item>`）、`item get` 的 `--raw` 开关（详情卡的原始 JSON，见「设置」）、`item media` 的 `--raw` 开关和只对平台 `bilibili` 放行的 `--all-tracks` 开关、`danmaku list` 的 `--raw` 开关（B 站的原生播放器要用原始的 DASH 轨道信息和弹幕的类型、颜色，见「详情卡片」的「媒体」）和 `-a <账号>`（账号名同 5.1，`guest` 不可用），关键词和 `<item>`、`<user>`（都只接受 http(s) 链接或 ID）、`<comment>`（只接受 ID）放在 `--` 之后；12306 查询页（见「12306 查询页」）另放行四条免登录的只读命令，只认平台 `12306`、不接受 `-a`：`12306 station search -- <关键词>`、`12306 ticket search [--date <YYYY-MM-DD>] [--type <车型,...>] [--available] -- <from> <to>`、`12306 route get [--date <YYYY-MM-DD>] -- <train_no> <from> <to>`、`12306 transfer search [--date <YYYY-MM-DD>] [--via <车站>] [--limit <1–50>] -- <from> <to>`，车站（关键词、`<from>` `<to>`、`--via`）只接受 1–32 个字母、数字、汉字和空格、`·`、`-`，日期必须是真实存在的日期，车型是逗号分隔的单个字母或数字，`<train_no>` 只接受 1–16 个字母或数字；不经过 shell。直播页的播放器另放行 `<p> live media`（只带 `<room>`，规则同 `<item>`，见「直播弹幕」）；直播页的发现与标签（见「直播弹幕」）另放行 `<p> live list [--limit N] [--cursor c] [--category <分类>]`（分类 1–64 个字母、数字和 `_` `.` `:` `-`）、`<p> live search [--limit N] [--cursor c] -- <关键词>`（关键词规则同 `item search`）、`<p> live categories`、`<p> live gifts` / `rank` / `history` / `products -- <room>`（只带 `<room>`）和 `<p> live replays [--limit N] [--cursor c] -- <user>`（`<room>` `<user>` 规则同 `<item>`），都可带 `-a`；`live send`、`live like`、`live start`、`live stop` 等写操作不放行。收件箱（见「通知与私信」）另放行四条只读命令，都可带 `-a <账号>`：`<p> notice list [--limit N] [--cursor c]`、`<p> notice count`、`<p> msg list [--limit N] [--cursor c]`、`<p> msg history [--limit N] [--cursor c] -- <conversation>`，`<conversation>` 只接受 http(s) 链接或会话 ID（1–256 个字母、数字和 `_` `-` `:` `.`，以字母或数字开头，如小红书群聊的 `group:<群 id>`）；`msg read`、`msg send` 等写操作不放行。长连接的 `<p> live listen` 不走 `/api/catbus`，走 `/api/live/*`（见「直播弹幕」）。订阅走 `/api/subs/*`（见「订阅」），检查时运行的命令在服务端拼好，不经过页面。新增放行的命令只能是读取类，写操作要先在本节登记确认方式。
- **登录**：登录相关的写操作只有 `auth login`、`auth use` 和 `auth logout`（登录后的确认，以及账号切换弹窗里的「设为默认」），走单独的接口（`/api/login/*`）。可用的登录方式从编译好的注册表（`dist/platforms/index.js`）读，与 CLI 一致。bridge 按表单字段自己拼 argv，字段逐个校验（账号名同 5.1，`guest` 不可用）；cookie、密码、API Key 只经 stdin 传给子进程，不进 argv、不写日志、不回传给页面。扫码登录在子进程里等待：bridge 从 stderr 的「二维码图片：<路径>」读出 PNG 交给页面，页面轮询状态，可以取消（结束子进程）。手机扫码、还没确认时，各平台都会在 stderr 写一行以「已扫码」开头的提示（抖音换码前查到时是「换码前发现已扫码」）：bridge 据此在会话里标记 `scanned`，换了新二维码（过期后换码）时清掉；页面把二维码虚化，中间画绿底白勾，表示已扫码、等手机上确认。短信和 mteam 的两步验证沿用非 TTY 的两步流程（5.3）。表单不填账号名时带 `--auto-bind`（5.3），填了才用 `-a`。登录到的账号不是当前账号时，页面询问是否设为默认账号，同意后走 `POST /api/login/use`（`catbus <p> auth use <account>`，账号名同样校验），只在用户点确认后调用。凭证仍由 core 落盘。
- **账号切换**（设计稿 T、T2、T3）：侧栏底部的账号卡显示本页浏览用的账号，点击弹出 web 端的账号列表（`auth list`）。账号可以多选：每行左侧是复选框，点一行切换勾选（不关闭弹窗），标题右侧是「已选 n / 总数」。勾选的是本页浏览用的账号集合，没勾选过时为 `_current`；至少保留一个，只剩一个时它的复选框锁定，点它提示「至少保留一个账号」。失效的账号不能勾选，也不参与请求（勾选的都失效时仍用第一个，让页面报出登录失效）；重新登录后恢复。勾选变化后停 400ms 再重新请求，连点几个账号只请求一次。
  - **多账号合并**：勾选了几个账号时，每次加载（搜索、推荐流、刷新、翻页）用每个账号各发一次同样的请求（各带 `-a`），结果按条目 id 去重后合并：以第一个勾选的账号为主，各账号的条目轮流排（第一个账号的第 1 条、第二个账号的第 1 条……），已经出现过的跳过。翻页时每个账号各自记 cursor，没有更多或出错的账号停下，其余账号继续翻；部分账号出错时弹提示、其余结果照常显示，全部出错才整页报错。条目记下取到它的账号，详情、评论、悬停预览、下载用这个账号请求。勾选多个账号时列表下方显示「N 个账号同时加载 · 重复条目只显示一次」。去重只在同一个渠道内做。
  - 账号卡：只勾选一个账号时显示它的头像和昵称；勾选多个时头像叠放，写「<第一个> 等 N 个」；聚合模式下叠放选中渠道的图标（最多 3 个，其余写 `+N`），写「N 渠道 · M 账号」，副标题按渠道列出账号数，有失效账号时改为提示失效。
  - **聚合模式的渠道 Tab**：聚合模式下账号列表上方是一排渠道 Tab，顺序与选中的渠道相同，打开时停在最后点选的渠道。Tab 是渠道图标、名称和已选账号数，渠道有失效账号时带琥珀色小点；切 Tab 只换下面的列表、标题和「添加账号」，不发请求。不超过 3 个渠道时 Tab 平分宽度；超过 3 个时一行排开、可以横向滑动，不显示滚动条，两侧出现箭头（每次翻一屏，到头的那侧变淡），边缘渐隐提示还有内容；切到的 Tab 自动滚到可见。勾选变化只重新请求那个渠道。
  - 每个账号（无论是否失效）都可以删除，要在行内二次确认：走 `POST /api/login/logout`（`catbus <p> auth logout -a <account>`，账号名同样校验），删除本地凭证，有服务端登出的平台（B 站、快手）同时登出；删掉的是当前账号时 `_current` 一并清除，删掉的账号同时从勾选里去掉。勾选只改本页浏览用的账号（之后的请求带 `-a`），不改 `_current`；「设为默认」才调用 `auth use`，需要用户点按钮，不改变勾选。请求返回 `AUTH_EXPIRED` / `AUTH_REQUIRED` 的账号标为失效，「重新登录」打开登录弹窗并预填账号名。
- **批量选择与下载**：卡片右上角的选择框可以单选，也可以按住拖动连续选择（按条目顺序选中起点到当前卡片之间的全部，拖到列表上下边缘时自动滚动）；有选中时搜索框左侧出现全选、全不选、反选三个圆按钮和一个红色的下载分体按钮：左半边写「下载」和已选条数，点了按上次的选择直接下载；右半边是下拉箭头，打开下载面板（手机底部操作条上仍是分开的「下载」「选项」两个带文字的按钮）。下载是 bridge 放行的第三类写操作，不改平台数据，用户点下载按钮即视为确认。分两段：
  - **下载面板**：批量下载分体按钮的下拉箭头和详情卡片下载按钮旁的下拉箭头打开下载面板（玻璃面板，与时间筛选、AppSelect 同一套样式；手机上是底部弹层）。内容多选：媒体（默认勾选）、信息（标题、正文、作者、互动数）、评论；勾了评论就隐含信息（信息锁定为勾选），至少保留一项。评论和子评论的条数取设置里的「评论下载条数」「子评论下载条数」，面板里写明当前条数，并给出「去设置」入口（打开设置的「下载」分栏）。格式单选：JSON / 纯文本 / Excel，只作用于信息和评论。面板上的选择直接记进 `catbus.settings`（`dlMedia` `dlMeta` `dlComments` `dlFormat`），直接点下载按钮本身就按上次的选择下载。条目所属平台 web 端的 `comment list` 都没有实现时评论置灰，tooltip 说明原因；能力由 `GET /api/filters` 的 `comments` 从注册表读出，读不到时不置灰（没有评论的平台由 CLI 写出空的评论列表）。
  - **服务端下载**：走 `/api/download/*`，bridge 逐条运行 `catbus <p> item download [-a <账号>] --dir <目录> [--meta] [--comments <N|all>] [--replies <N|all>] [--no-media] -- <item>`（`<item>` 只接受 http(s) 链接或 ID，一批最多 200 条，同一时间只跑一条），下到这一批的临时目录 `~/.catbus/cache/webui/downloads/<批次 id>/<p>/<标题>/`（属于 5.1 的 cache，可随时删除；目录 0700、文件 0600），每条笔记 / 视频一个文件夹。文件夹名取标题（没有标题时用正文开头，再没有用 ID），按三大系统都能用的规则清洗：去掉 emoji 和平台表情码（如 `[笑哭R]`）、控制字符和 `<>:"/\|?*`，空白合并成一个空格，去掉首尾的空格和点，避开 Windows 保留名（`CON`、`NUL`、`COM1` 等），最长 60 个字符；清洗后为空时用 ID。同一批里不同条目清洗出同一个名字时，后来的加上 ` (<ID 后 6 位>)`。发起下载的 `POST /api/download/start` 除条目外另有 `media`（布尔）、`meta`（布尔）、`comments`（`0` `5` `10` `20` `50` `100` `1000` `'all'`）、`replies`（`0` `3` `10` `20` `50` `100` `'all'`）、`format`（`json` `txt` `xlsx`），都可以不给，缺省为 `media: true, meta: false, comments: 0, replies: 0, format: 'json'`（只下媒体）；bridge 逐个按白名单校验，拼成 argv：`meta` → `--meta`，`comments` 不为 0 → `--comments <n|all>`，`comments`、`replies` 都不为 0 → `--replies <n|all>`，`media` 为 false → `--no-media`；`media`、`meta` 都为 false 且 `comments` 为 0 时报 400。这一批的这些选项存进下载记录（`opts`），重试时沿用。每条下载完后，CLI 输出的 File[] 里 `type` 为 `data` 的是帖子信息 `<platform>_<id>.json`（ExportDoc），记录里存它的路径和取到了什么（媒体文件数、是否有信息、一级评论条数、楼中楼条数、`comments_truncated`）。每次点下载算一批，下载记录（每条的状态 queued / running / done / failed、文件路径、错误）存在 `~/.catbus/cache/webui/downloads.json`（可随时删除；服务重启时未完成的标为中断）。
  - **交给浏览器**：文件最终由浏览器保存（页面可能是在手机或局域网里别的电脑上打开的，文件不能留在服务端机器上），保存位置看浏览器自己的下载设置。一批全部结束（没有排队中、下载中的）后，页面自动把成功的文件交给浏览器一次：只有一个文件时直接下载这个文件，多个文件时服务端流式打成 zip（`yazl`，只存不压缩，支持 zip64；zip 里是 `<p>/<标题>/<文件名>`），zip 名为 `catbus-<p>-<日期时间>.zip`，一批只有一条时用清洗后的标题。帖子信息按这一批的格式交付（`src/webui/export-format.ts`）：`json` 原样放在这条帖子的目录里；`txt` 用 `toText` 生成 `info.txt` 代替 json；`xlsx` 整批用 `toXlsx` 汇总成一个 `catbus-<p>-<日期时间>.xlsx`，放在 zip 根目录（单条帖子同样是一个 xlsx）；读不出来的信息文件原样交付。只要信息、不要媒体，整批只剩一个最终文件时直接下载这个文件（txt 用清洗后的标题命名），不打 zip。失败的条目重试成功后，重试的这些条目单独交付一次（规则同上）。自动交付只发生在发起下载或重试的那个页面里，刷新后不再自动触发。页面用隐藏的 `<a href download>` 触发（同源，自动带访问令牌的 cookie），不用 `window.open`；触发前先发一次 `HEAD` 确认文件还在。取文件的接口是 `GET`（以及 `HEAD`）`/api/download/<批次 id>/file[?item=<条目 id>&item=...]`（整批，或这一批里的几条）和 `/api/download/<批次 id>/<条目 id>/file`（一条），只按批次和条目 ID 取，不接受任何路径参数：bridge 从下载记录里找文件，用 realpath 校验每个文件仍在这一批的临时目录里（防穿越、防软链接逃逸，逃逸的报 403）；响应头 `Content-Disposition: attachment; filename="<ASCII 回退>"; filename*=UTF-8''<百分号编码>`、`Content-Type` 按扩展名（zip 为 `application/zip`，不认识的为 `application/octet-stream`）、`Cache-Control: no-store`；跨站（`Sec-Fetch-Site: cross-site`）的请求拒绝。未知的批次或条目 404，文件已被清理 410。
  - **补救与清理**：浏览器拦截、用户取消、手机没存上时服务端无从得知，所以批次和条目上都有「重新保存」（重新走上面的交付）。临时文件不在交付后删除：删除记录时删掉对应的临时文件，最后一条下载完成超过 1 小时的批次删掉整个临时目录（服务启动时和运行中定期清理，没有记录的残留目录一并删掉），删掉后条目标为已过期。取文件得到 410 时页面提示「文件已过期，请重新下载」，已过期的条目可以重试（重新跑 CLI）。
  - **下载记录**：顶栏的下载列表按钮弹出历史，按批分组、可展开，一批只有一条时直接显示那一条；完成的条目显示「已交给浏览器」；下了信息的条目改为显示取到了什么，如「媒体 ✓ · 信息 ✓ · 评论 87/100（遇到风控，已停止）」（评论条数取「全部」时只写取到的条数），评论遇到风控提前停止（`comments_truncated`）的部分完成用琥珀色标出。列表里说明文件由浏览器保存、位置看浏览器的下载列表。平台要求人机验证（`RISK_CONTROL`，`detail.verify_url`）时，搜索结果和下载记录都给出「去验证」：弹窗说明在登录了同一账号的浏览器里打开验证链接、完成后点重试（链接只接受 https，由用户点击后在新标签页打开，WebUI 不代为验证）；下载记录里失败或已过期的条目可以重试（`POST /api/download/retry {batch, item?}`，重新排队）。历史里可以单独删除一条或一整批记录（`POST /api/download/remove {batch, item?}`，连同临时文件一起删；正在下载的不能删，排队中的删掉即取消）。WebUI 不打开服务端机器上的文件管理器。
  - **下载投递动画与角标**：点下载、请求提交成功之后，不自动打开下载记录，改为像加入购物车一样投递：从要下载的卡片飞出一张缩略图（封面；纯文字卡用一块品牌红的圆角方块），沿抛物线（先被拿起、略微放大，再边飞边缩小、旋转，落点前淡出，约 0.7 秒）落进下载列表按钮，按钮连同角标回弹一下（`web/src/composables/flyToDownloads.ts`，缩略图传送到 body、在最上层，不挡点击）。批量下载从选中卡片里在视口内的那几张飞出，最多 6 张、依次错开出发；选中的都滚出了视口时从点下的下载按钮飞出。详情卡片从媒体区飞出，纯文字的从下载按钮飞出。目标是页面上看得见的下载列表按钮（被盖住的发现页不算）。下载列表按钮右上角是红色角标，写还没结束（排队中、下载中）的条数（超过 99 写 `99+`），外圈缓慢扩散；第一张缩略图落进按钮时才弹出，全部结束后缩小消失；读屏把按钮读作「下载记录，N 条正在下载」。发现页筛选栏吸顶时（顶栏的按钮在视口外），有下载在跑、正要投递或从它打开了下载记录时，搜索栏左侧过渡出现一个同样的下载列表按钮（从小弹出、旁边的元素让位，高 36，手机上 44），先等它出现再投递，下载全部结束后过渡消失；它同样打开下载记录。页面上同时有几个下载列表按钮时，下载记录只在点开的那个下面打开。减少动效时不飞、不回弹，角标直接出现。
  - **演示模式**：`?demo` 下页面模拟下载进度，交付时在页面里生成文件（Blob）交给浏览器，不请求服务端：只下媒体时是一个说明文字的 `.txt`；下了信息时用演示数据生成同结构的 ExportDoc，按格式给出 JSON 或纯文本，Excel 退化成 JSON 并提示（不把 yazl 打进前端包）；评论取 1000 条或全部时模拟遇到风控提前停止。
  - **推送到 qBittorrent（M-Team）**：Penpot 设计稿 `mteam-desgin` 的 Y8、Y9。下载面板（分体下载按钮的下拉、详情卡片下载按钮的下拉）里，这次要下载的条目有 M-Team 的时，「下载内容」下面多一节「推送到 qBittorrent」：开关、分类（默认 `mteam`）、保存目录（可空，空时用 qBittorrent 自己的设置）、添加后暂停。关掉开关时下面的选项收起。M-Team 的「媒体」就是种子文件（行名写「种子文件」）。打开推送后可以不勾种子文件：只推送、不交给浏览器（按钮写「推送 N 条」）；CLI 推送前总会先把种子文件写进临时目录，所以这种情况仍按下载种子文件请求，只是页面不自动交付，下载记录里仍可「重新保存」。面板上的这几项记进 `catbus.settings`（`qbit` `qbitCategory` `qbitSavepath` `qbitPaused`），不在设置弹窗里显示。推送是 4.7 mteam `item download --qbit` 的 WebUI 入口，属于本节已登记的写操作（只改本机 qBittorrent 的任务列表，不改平台数据），用户点下载按钮即视为确认。
    - **bridge**：`POST /api/download/start` 另有 `qbit`（布尔）、`qbitCategory`（1–64 个字符）、`qbitSavepath`（绝对路径：`/` 开头或 Windows 盘符 `X:\` / `X:/` 开头，最长 512 个字符）、`qbitPaused`（布尔），缺省为不推送。分类和目录拒绝控制字符（含换行）；分类另外拒绝 `\ / : * ? " < > |`，目录拒绝 `..` 段。`qbit` 只对平台 `mteam` 有效：别的平台带 `qbit: true` 报 400；`qbit` 为 true 时 `media` 必须为 true（CLI 的 `--qbit` 不能和 `--no-media` 一起用），否则报 400。拼成 argv：`--qbit [--qbit-category <分类>] [--qbit-savepath <目录>] [--qbit-paused]`（分类等于默认的 `mteam` 时也照样带上），存进这一批的 `opts`，重试时沿用。
    - **结果**：带 `--qbit` 时 CLI 成功输出 `{id files qbit}`，`files` 同 File[]，`qbit.status` 为 `added`（已推送）或 `exists`（已在 qBittorrent 的任务列表里，仍算成功）。推送失败时是错误信封，`error.detail.qbit` 为 `failed`、`detail.files` 是已经保存的文件、`detail.http_status` 是 Web UI 的 HTTP 状态（取不到时 null）：bridge 把这条记为失败，同时记下已保存的文件（种子文件仍可交给浏览器）。下载记录的每条存 `qbit: {status: added|exists|failed, category, savepath, paused, code, http_status}`（没推送时没有这个字段）。列表里写「种子 ✓ · 已推送」「种子 ✓ · 已在任务列表」「种子 ✓ · 推送失败（种子已保存）」，失败的条目原因写错误信息（连不上 Web UI 为 `NETWORK`，要求认证为 `ERROR`）。推送失败的可以重试：重跑整条 `item download --qbit`（CLI 不重新下载已存在的种子文件，直接推送本地这份）。一批结束后弹一条汇总提示：全部推送成功、部分已在任务列表、有推送失败（带「重试推送」）三种。
    - **qBittorrent 地址**：由运行 `catbus web` 的那台电脑上的 `CATBUS_MTEAM_QBIT_URL` 决定（默认 `http://127.0.0.1:25254`），WebUI 不读也不改，面板里只说明「推送由运行 catbus 的电脑完成」。
    - **演示模式**：`?demo` 下面板照常可用，推送结果在页面里模拟（大约每三条里一条「已在任务列表」、一条连不上），重试后成功。
- **服务端设置**：bridge 放行的第四类写操作，只改本机的 catbus 配置、不改平台数据，用户在设置弹窗「实验性」里点保存即视为确认。`GET /api/settings` 读、`PUT /api/settings` 改（请求体必须是 `application/json` 的对象，否则 415 / 400），只认一个键 `proxy`，出现别的键（包括以前的 `downloadDir`）整个请求报 400、什么都不改。`proxy`：就是 config.toml 的全局 `proxy`（5.5），经 core 的 config 模块读写，与 `catbus config set proxy` 同一套校验（http、https、socks4、socks5、socks5h），`null` 或空字符串清空（`config unset proxy`），对命令行同样生效。读的时候另外只读返回平台代理（`<p>.proxy`），WebUI 只展示、不改。下载不再有服务端目录可设（见「批量选择与下载」）；以前的 `~/.catbus/webui.json` 不再使用，读到也忽略。与其他 `/api/*` 一样校验 `Host`、同源和访问令牌；`--demo` 时拒绝（503），页面在演示模式下把这一项显示为禁用并说明原因。
- **详情卡片**：点击瀑布流卡片不再跳转，而是打开详情卡片（设计稿 `web-desgin.pen` 的 E / F / G）；按住 ⌘ / Ctrl / Shift 或中键点击仍在新标签页打开原链接，选择模式下点击只切换选中。卡片先用搜索结果里的数据显示，再用 `item get` 补全正文和媒体、`comment list` 取评论（滚到底部按 `--cursor` 续翻）。有回复的评论默认带出第一条回复：评论滚进视野时用 `comment replies --limit 1` 取，同一时间只发一个请求，请求之间留间隔（小红书 3 秒，其余 1.2 秒），遇到风控就停止自动预取；其余回复点「展开 N 条回复」再取，可以继续展开、收起。平台没有 `comment replies` 时只显示回复数。正文和评论里的平台表情码按对照表渲染成图片，不认识的码原样显示：小红书（如 `[点赞R]`）用 `web/src/data/emoji/xhs.json`，表取自小红书网页版的 `redmoji`；抖音（如 `[捂脸]`）用 `web/src/data/emoji/douyin.json`，表取自抖音网页版免登录的表情列表接口（`aweme/v1/web/emoji/list`），图片地址是接口给出的带签名长效链接（约 2036 年过期，过期后重新生成）。两者的图片都在公开 CDN 上，不带 Referer、cookie 也能加载。微博（如 `[心]`、`[doge]`）用 `web/src/data/emoji/weibo.json`，表取自微博网页版表情配置接口（`ajax/statuses/config`，要登录）里的标准表情面板（`emoticon.ZH_CN`，不收七千多条的 `emoticonRender`），图片在 `face.t.sinajs.cn`，同样不需要 Referer、cookie。评论附带的图片（`Comment.media`）显示成缩略图，点击全屏看大图（← / → 切换，Esc 或点空白关闭，只关大图、不关详情卡片）；只有图片没有文字的评论不显示空行。只读：不能发评论、点赞、收藏、关注，互动数只显示数量；头部「原链接」在新标签页打开平台页面；「下载」把这一条加入下载，与批量下载走同一个接口（`/api/download/*`，一条算一批），用户点按钮即视为确认。
  - **布局**：媒体宽高比 ≥ 1.2 时为横屏卡片（最宽 1360，信息栏 368），否则为竖屏卡片（媒体高 = 视口高 − 80，宽按比例夹在 9:16 与 3:4 之间，信息栏 420）；放不下卡片时（手机，以及竖屏平板）全屏打开，信息栏在媒体下方，见下面的「响应式」。信息栏头部分两行：第一行是作者（种子、演出换成各自的内容，见下）和关闭按钮，第二行是操作按钮（原始 JSON、下载、本地收藏、原链接），作者名因此有整行的宽度；只有浮在页面上、宽度够的纯文字单栏卡片放在一行里。亮色 / 暗色主题都用 `tokens.css` 的变量。
  - **动效**：GSAP 共享元素放大：卡片从瀑布流里的位置连续放大到详情卡片（480ms，`expo.out`），信息栏随后展开、内容依次淡入；关闭时缩回原卡片（360ms，`power3.inOut`），原卡片已不在视口内时原地淡出。打开期间原卡片隐藏。`prefers-reduced-motion` 时只做 180ms 淡入淡出。Esc、点遮罩、× 关闭。
  - **媒体**：视频打开后自动播放（浏览器不允许带声音时静音播放并提示开声音）；播放出错时从当前进度自动重试两次，仍不行才提示，提示里可以手动重试或去原链接；图文显示轮播，← / → 切换。B 站用原生 `<video>` 加 Media Source Extensions 播放（`web/src/composables/dash.ts`）：B 站给的是音视频分离的 DASH（各一个 fMP4 文件，带 `sidx` 索引），页面请求 `catbus bilibili item media [-a <账号>] --all-tracks --raw -- <item>` 取得全部视频轨和音频轨（地址、`mimeType`、`codecs`、`SegmentBase`；CLI 还不认识 `--all-tracks` 报 `USAGE` 时去掉它再请求一次，只拿到最高画质的一路），按 `sidx` 把每个文件切成段，经媒体代理按 Range 分段取回、分别喂给两个 SourceBuffer：只缓冲当前位置往后约 30 秒，丢掉往前 30 秒以外的，拖动时从目标所在的段重新取；画质随这个账号在 B 站网页上能看的范围。每个画质（qn）按浏览器能解的编码挑一路，依次优先 AVC、HEVC、AV1；音频取浏览器能解的码率最高的一路。控制栏右侧是画质下拉（AppSelect 的 chip 样式，只有一个画质时不显示）：默认取不超过上次所选画质的最高一档，没选过时取 HDR、杜比视界以外的最高一档；换画质时从当前进度接着放，保持播放或暂停，所选画质记进 `catbus.settings` 的 `biliQuality`（qn，不在设置弹窗里显示）。控制栏另有弹幕开关（图标按钮，开着时高亮），默认打开，记进 `catbus.settings` 的 `danmaku`（不在设置弹窗里显示）。打开时请求 `catbus bilibili danmaku list [-a <账号>] --raw -- <item>`（原始字段带类型 `mode`、颜色 `color`、字号 `fontsize`），结果按条目在本页会话里缓存，叠在画面上（`web/src/components/DanmakuLayer.vue`）：滚动弹幕（mode 1–3、6）从右向左 8 秒走完，顶部（5）、底部（4）弹幕居中停 4 秒；高级、代码、BAS 弹幕（7–9）不显示。位置按视频的当前时间逐帧计算，所以暂停、拖动、倍速都跟着画面；拖动时清掉屏上的弹幕，从新位置往后接着出。滚动弹幕占画面上方四分之三，按行排开、同一行不重叠，排不下的丢掉；字号按画面高度缩放，颜色取原色、黑色描边，不挡点击。取不到弹幕时不显示，也不提示。轨道地址在 `baseUrl` 和 `backupUrl` 里取第一个过得了媒体代理白名单的（PCDN 节点带非 443 端口，跳过）。浏览器不支持这个编码（如杜比视界）、没有 MSE、取不到可用地址、或是演示模式时，退回官方嵌入播放器；老稿件没有 DASH、只有整段 mp4 时直接交给 `<video>`。出错重试时重新取一次轨道地址（地址带时效），从出错时的进度接着放。YouTube 用官方嵌入播放器。
  - **媒体代理**：部分平台的视频 CDN 校验 Referer（抖音不带 `Referer: https://www.douyin.com/` 返回 403），视频经 bridge 的 `GET /api/media?platform=<p>&url=<地址>` 转发。只接受 https，主机必须在按平台列出的 CDN 后缀白名单里（抖音 `douyinvod.com`、小红书 `xhscdn.com`、快手 `kwaicdn.com` / `yximgs.com` / `ndcimgs.com`、微博 `weibocdn.com` / `sinaimg.cn`、TikTok `tiktokcdn.com` / `tiktokcdn-us.com` / `tiktokv.com`、X `twimg.com`；直播流另有抖音 `douyincdn.com`（它会 302 到腾讯云边缘节点 `v.smtcdns.net`、金山云边缘节点 `ksyungslb.com` 或阿里云边缘节点 `mobgslb.tbcache.com`，这三个域名只在重定向时接受）、B 站 `bilivideo.com` / `bilivideo.cn`（点播的 DASH 文件也在这两个后缀下），B 站加 `Referer: https://live.bilibili.com/`，点播 CDN 同样接受）；按平台加 Referer，透传 `Range` 以支持拖动进度；不跟随重定向到白名单外，不带 cookie，不经过 catbus 的代理配置。被拒的域名在 stderr 记一行，平台换了新 CDN 时据此补白名单。图片同样经这个接口转发，但只限校验 Referer 的图床：新浪图床（`sinaimg.cn`、`weibocdn.com`）对浏览器 UA 不带 `Referer: https://weibo.com/` 的请求返回 403，`<img>` 设不了这个 Referer，所以这两个域名的图片（封面、轮播、大图、头像、评论图片、表情）一律按 `platform=weibo` 转发（`web/src/api/client.ts` 的 `imgSrc`，按主机判断，不看条目属于哪个平台）；其他图片仍由浏览器直接加载，不经 bridge。
- **相关推荐**：详情卡片信息栏的正文之后、评论区之上有一行横向滚动的「相关推荐」（设计稿 S / S2 / S3）。数据来自 `catbus <p> item related [-a <账号>] --limit 12 -- <item>`（`<item>` 只接受 http(s) 链接或 ID），只取一页，最多显示 12 张。只在条目所属平台 web 端的 `item related` 已实现时请求和显示：能力由 `GET /api/filters` 的 `related` 从编译好的注册表读出，读不到时当作不支持；种子和演出的详情不显示。请求在 `item get` 回来之后发出，不阻塞正文和评论（评论先取，相关推荐随后）；加载中显示 4 张骨架卡片，返回空或请求失败时整段不渲染、不提示错误。结果按「平台 + 条目」在本页会话里缓存（只在内存里），切换上一条 / 下一条、关闭卡片时丢弃还没回来的结果。小卡片宽 112、封面 4:5，下面是标题和作者，视频有播放数时封面左下角显示播放数；整张是按钮，悬停时封面描红边、标题变红。右缘渐隐提示还能滑动；能悬停的设备上标题右侧有左右翻页按钮（每次滚两张，到头的那个变淡），触屏直接横滑。点一张小卡片在当前详情卡片里切到那一条，不关闭卡片：媒体区和信息栏交叉淡入（0.25s，减少动效时直接切换），滚动区回到顶部，新条目同样补全详情、取评论和它自己的相关推荐；地址不变。从相关推荐切过去的条目不在瀑布流里：关闭时找不到原卡片，按打开时的规则原地淡出；「上一条 / 下一条」以进入相关推荐之前所在的那一条为基准，切到它在列表里的前一条 / 后一条（连续点相关推荐时基准不变）。
- **种子卡片**：`kind` 为 `torrent` 的条目（M-Team）没有作者、点赞、评论，瀑布流卡片换一套内容（设计稿 `web-desgin.pen` 的 K），只用 Torrent 已有的字段。标题是 `text` 的第一段（`|` 之前，一般是中文名），种子名（`title`）降为第二行等宽小字，最多两行；`text` 为空时种子名直接当标题。封面一律按 2:3 的海报比例；左上角是优惠标签（`FREE`、`2X FREE` 红底，`50%`、`30%`、`2X`、`2X 50%` 藏青底，`NORMAL` 或 null 不显示，不认识的代码原样显示），左下角是体积（1024 进制，如 `20.8 GB`）。底部左侧是 ↑ 做种数、↓ 下载数，做种为 0 时标红；右侧是发布时间（相对时间）。关掉「卡片上显示互动数据」时只留发布时间。没有封面或封面加载失败时不用纯文字卡，优惠和体积挪到标题上方。完成数、浏览数、评论数不显示（列表接口里都是 0）。
- **种子详情**：种子的详情卡片同样换一套内容（设计稿 L）。头部原来作者的位置是优惠标签（规则同种子卡片）加体积，下面一行是发布时间（操作按钮同普通条目，在第二行）。正文先是中文名（取自搜索结果里那一条的 `text`，因为 `item get` 返回的 `text` 是整段简介）和等宽小字的种子名，再是简介：站点的 BBCode 在页面里拆成块渲染（`web/src/composables/bbcode.ts`），`[img]`（以及 Markdown 的 `![](…)`）显示成图片（只接受 http(s)，不带 Referer，加载失败的隐藏，点击在新标签页打开原图），`[quote]` 显示成引用块，`[code]` 显示成等宽代码块（不换行，横向滚动），其余样式标记（`[b]`、`[color=…]`、`[font=…]`、`[size=…]` 等）去掉、只留文字；全部按文本渲染，不生成 HTML。没有评论区，也不请求 `comment list`。底部原来互动数的位置是 ↑ 做种、↓ 下载、文件数。海报按 2:3 显示；没有封面时单栏显示同样的内容。
- **演出卡片**：猫眼演出（`maoyan`）的条目没有点赞、评论和发布时间，瀑布流卡片换一套内容（设计稿 M）。分类、演出者、开售文案和开售时间从 `text` 的「键：值」行里取（4.8）。封面按海报比例（0.72）；左上角是分类，还没开售的在左下角用深色半透明角标写站点的开售文案（如「明天开售」，不用红色，不出现「抢票」字样）。底部左侧是演出者头像和名字（没有演出者时写开售文案），右侧是红色起价「¥380 起」（`price`）。
- **演出详情**：演出的详情卡片同样换一套内容（设计稿 N）。头部是演出者头像和名字，下面一行「分类 · 城市」（详情接口不给演出者和分类，取自列表里那一条；没有演出者时写分类）。正文是标题，时间、场馆（场馆名，下面一行「城市 · 地址」）、票价档（每档一个小标签）各一行带图标，再是「演出详情」长图（`media` 里的图片；左侧媒体区只放海报）。接口返回的售卖状态文案（如「预约抢票，快人一步」）不显示：catbus 不提供抢票（4.12），界面上不给人能抢票的印象。没有评论区，也不请求 `comment list`。底部左侧是起价，右侧是开售倒计时（`SaleCountdown.vue`）：`text` 里有「开售时间」时显示「距开售 · M月D日 HH:mm」和逐秒跳动的「时 分 秒」，超过一天显示「天 时 分」；到点或已开售只写「已开售」；没有开售时间（如「即将开售」，或旧版 CLI）时显示站点的开售文案。只是显示时间，没有任何操作。
- **猫眼演出的城市**：Penpot 设计稿 `maoyan-desgin` 的 W1（亮色）、W2（暗色）、W3（手机）、W4（各种状态）。筛选栏最左是城市 chip（定位图标、城市名、箭头，始终是中性的玻璃样式，展开时描红边），单一模式下是猫眼时、聚合模式下选中了猫眼时显示，只对猫眼生效（`catbus maoyan feed list [--city <城市>]`，别的平台不带 `--city`）。城市默认北京（不带 `--city`）。点 chip 打开城市面板（桌面和平板是传送到 body 的玻璃面板，手机是底部弹层「选择城市」，标题旁写当前城市）：上面是搜索框，没输入时是「最近选择」和「热门城市」两组 chip（当前城市红色），有输入时是搜索结果列表。热门城市是前端写死的一份（北京、上海、广州、深圳、成都、杭州、南京、武汉、西安、重庆、天津、苏州）；最近选择存在 localStorage `catbus.maoyanCities`（城市名数组，最近的在前，最多 3 个，不是设置项）。搜索用 `catbus maoyan poi search -- <关键词>`（只搜演出城市，`address` 恒为 null），输入停下 200ms 后才请求，只采用最后一次请求的结果，同一关键词在本页会话里缓存；输入法组合输入期间不请求。结果列表 `role="listbox"`，↑ / ↓ 循环、Enter 选中、Esc 收起；搜不到时写「没有找到「<关键词>」」。选了城市（包括选当前城市以外的最近 / 热门 / 搜索结果）就收起面板、记进最近选择，并重新请求猫眼。城市进地址栏：`/maoyan?city=<城市名>`（聚合模式下同样带，排在 `agg` 之后），北京省略；当前路径和 `agg` 都不含猫眼时不写 `city`，切回猫眼时仍沿用页面上的城市。渠道缓存按城市区分（城市算进查询）。演示模式不请求服务端，搜索按内置城市表做子串匹配，换城市时演示数据换一批。
- **猫眼演出的场次与票档**：设计稿 W5（亮色）、W6（暗色）、W7（手机）、W8（各种状态）。演出详情的场馆之后、「演出详情」长图之前是「场次与票档」区块。打开详情不自动查：区块先是「查看场次与余票」按钮，点了才请求 `catbus maoyan item get [-a <账号>] --tickets -- <item>`（需要登录）；返回 `AUTH_REQUIRED` 时区块变成「登录后查看场次与余票」，`AUTH_EXPIRED` 时变成「登录已失效」，按钮打开现有的登录弹窗，登录后再点一次即可。结果按「平台 + 条目」在本页会话里缓存（只在内存里），区块右上角写「HH:mm 查询」和一个刷新按钮（重新请求、替换缓存）。场次和票档从 `text` 的行里解析（格式见 4.8）：`场次：<场次名>` 开始一个场次，`场次时间：<ISO>` 是它的开始时间，之后每行 `票档：<名>，票面价 N，实售价 N，余票 N，限购 N[，售罄]` 是它的一个票档；各项取不到时省略，解析时容错。场次横向滚动（右缘渐隐），不分组：每张场次卡写「M月D日 / 周X HH:mm」（有场次时间时按它，否则用场次名原文），一场的票档全部售罄时置灰并写「售罄」，仍然可以选；默认选中第一个没有售罄的场次。选中场次下面一行是它的日期时间，再下面是票档表：票档名（站点给的字母，不画色点）、票面价（与实售价不同时划线，相同时只显示实售价那一列）、实售价、余票。余票：0 或「售罄」写「售罄」并整行置灰；有限购数时，余票等于（或超过）限购写「有票」，少于限购写红色「余 N 张」；没有限购数时写「余 N 张」，没有余票数时写「有票」。不写每单限购数。票档表下面一行「余票为查询时的数量，较多时只显示有票」和「在猫眼打开」外链（条目的 `url`）。这一场没有票档时写「这一场暂时没有票档信息」。查到场次后隐藏上面原来的「票价」一行（未查询、未登录、加载中、失败、没有场次时仍显示）。`text` 里没有场次行（还没开票）时写「还没有场次信息」。加载中显示场次卡和票档表的骨架；请求失败显示「没能查到场次与余票」和「重试」。只读：区块里没有任何购买、抢票、预约、开售提醒的按钮或字样。演示模式用演示数据：猫眼的演示列表里固定有一条查询时返回 `AUTH_REQUIRED`（看未登录的样子）、一条没有场次，其余生成几个场次（含打折、整场售罄、余票不足）。
- **猫眼演出的 bridge 命令**：bridge 为上面两节另外放行三条只读命令，平台只认 `maoyan`：`maoyan poi search [-a <账号>] -- <关键词>`（关键词 1–32 个字母、数字、汉字和空格、`·`、`-`）；`feed list` 的 `--city <城市>`（城市名或演出城市 ID，规则同关键词）；`item get` 的开关 `--tickets`（与 `--raw` 一样不带值）。
- **作者页**：设计稿 P（亮色）、P2（暗色）、P3（头部的各种状态）、P4（手机）。详情卡片头部的作者头像和昵称、瀑布流卡片底部的作者区，点了进入站内的作者页，不再跳去平台原站；只有平台 web 端的 `user get` 和 `user items` 都已实现时才这样（`GET /api/filters` 另给出 `author`，从注册表读），否则保持原来的外链行为。卡片底部作者区的点击不打开详情；选择模式下点击仍只切换选中；按住 ⌘ / Ctrl / Shift 或中键点击作者仍在新标签页打开平台原主页。作者页的数据：`catbus <p> user get [-a <账号>] -- <user>` 取作者（User），`catbus <p> user items [-a <账号>] [--limit N] [--cursor c] -- <user>` 取作品（Item[]，滚到底按 `--cursor` 自动翻页，每页条数取设置），`<user>` 同地址里的 `<作者>`；按条目自己的平台和该平台本页浏览用的账号请求（聚合模式下同样）。侧栏不变；内容区是返回按钮、作者头部（头像带平台角标，昵称、`@handle`、简介最多三行，粉丝 / 关注 / 作品 / 获赞四项数字，`null` 的项整项不显示、全部缺失时整行不显示，没有简介时不显示简介行）、「全部作品」加数量（`stats.items`，缺失时不显示）和右侧「已加载 N / 总数 · 耗时」，下面复用发现页的瀑布流、卡片、详情卡片、批量选择与下载；不显示排序、类型等筛选。头部有「原主页」外链（作者没有 `url` 时不显示），没有关注按钮。加载中显示与真实头部同尺寸的骨架（带 1.2 秒的高光扫过，减少动效时不扫）和卡片骨架；请求出错沿用发现页的错误态（含「去登录」「去验证」）。在作者页提交搜索回到发现页搜索；在侧栏点渠道也回到发现页。手机上头部竖排居中，「原主页」收成顶栏右侧的图标按钮。演示模式下作者和作品都用演示数据。
- **各平台的「我的」页**：Penpot 设计稿 `mine-desgin` 的 Z1（亮色）、Z2（暗色，自己的内容带审核状态）、Z3（手机）、Z4（收藏夹）、Z9（各种状态与各平台的标签）。当前账号自己的内容一页看完，状态在 `web/src/stores/mine.ts`，页面是 `web/src/views/MineView.vue`。
  - **标签按注册表显示**：标签依次是 作品（`item list`）、赞过 / 喜欢（`user likes`）、收藏（`user collects`）、转发（`user reposts`）、收藏夹（`folder list` + `folder items`）、合集 / 播放列表（`series list` + `series items`）、浏览记录（`history list`），只有平台 web 端对应的命令都已实现时才出现：收藏夹、合集要列表和内容两条命令都已实现（只实现了列表、点进去看不了内容的不显示）。能力由 `GET /api/filters` 的 `mine` 给出（按上面的顺序列出可用的标签键 `works` `likes` `collects` `reposts` `folders` `series` `history`），没有可用标签的平台没有「我的」页。标签的叫法按平台（如抖音、快手、YouTube 写「喜欢」，B 站写「投稿」，YouTube 写「播放列表」）。第一个标签是默认标签。M-Team 仍用自己的「我的」页（见「M-Team「我的」页与筛选」），不走这一套。
  - **入口与地址**：单一模式下当前渠道有「我的」页时，侧栏这个渠道的行下面展开「发现 / 我的」两个子项（与 M-Team 相同）；手机上发现页标题下面是「发现 / 我的」分段。地址 `/<平台规范 id>/me?tab=<标签>`，默认标签省略 `tab`，收藏夹、合集里点开了一个时另带 `folder=<id>` / `series=<id>`，`?demo` 保留在最前；进入、切标签、开收藏夹用 `history.pushState`，前进 / 后退按地址恢复。不在可用标签里的 `tab` 回到默认标签。像作者页一样盖在发现页上面，发现页在后台不动；点「发现」或别的渠道回到发现页。
  - **数据**：用这个平台本页浏览用的第一个账号（`-a`）。头部是 `catbus <p> user get [-a <账号>] -- me`（头像、昵称、`@handle`、四项数字，规则同作者页的头部，取不到时只显示账号卡里的头像和昵称）；作品 `item list`，赞过 / 收藏 / 转发 `user likes` / `collects` / `reposts`（不带位置参数，即当前账号），浏览记录 `history list`，都带 `--limit`（每页条数取设置）和 `--cursor`，滚到底自动翻页，结果复用发现页的瀑布流、卡片、详情卡片、批量选择与下载。作品带审核状态时（`Item.status` 不是 null 也不是 `published`），卡片左上角显示状态：审核中、仅自己可见、未通过、草稿。收藏夹、合集：桌面上左侧是列表（`folder list` / `series list`，名称和条数），右侧是选中那一个的内容（`folder items` / `series items -- <id>`，分页同上），右上角「在 <平台> 打开」（有 `url` 时）；默认选中第一个；手机上先是列表，点一个进入内容、返回回到列表。每个标签的结果在本页会话里缓存，切回来不重新请求；右上角刷新按钮重新请求当前标签。
  - **状态**：没有这个平台的账号时整页是「登录<平台>后查看你的<标签>」和「登录」按钮；`AUTH_EXPIRED` 时是「登录已失效」和「重新登录」；空标签写「还没有<标签>」；`RISK_CONTROL` 沿用发现页的错误态（「去验证」「重试」）；其余错误显示原因和「重试」。头部和标签各自出错，头部取不到不影响下面的列表。只读：不能删除、取消点赞或收藏。演示模式下各标签都用演示数据，其中一个标签为空。
- **本地收藏与稍后看**：设计稿 Z5（亮色）、Z6（手机）、Z7（按钮、菜单与提示）、Z9（状态）。不登录也能把任何平台的条目先存下来，只存在浏览器里（localStorage `catbus.local`，内容是 `{version: 1, groups, items}`），不发请求、不进服务端、不同步到平台。状态在 `web/src/stores/local.ts`，页面是 `web/src/views/LocalView.vue`。
  - **存什么**：存进来时的整条 Item（6.2 的归一化对象，去掉 `--raw` 挂的原始对象），加上平台、加入时间和所在分组；按「平台 + 条目 id」去重，再存一次只更新分组。最多 2000 条，满了提示先清理，不自动删旧的。写不进 localStorage（隐私模式、空间满）时提示一次，本次会话里照常可用。
  - **分组**：内置「稍后看」（不能改名、不能删），另外可以新建分组（名字 1–20 个字符，不能重名），可以改名、删除（删分组不删条目，条目只是离开这个分组）。一条可以同时在几个分组里，也可以不在任何分组里（只在「全部」里）。
  - **加入**：瀑布流卡片悬停时右上角选择框左边多一个书签按钮（触屏上一直显示，选择模式下不显示），点了加入「稍后看」，按钮变实心；再点打开分组菜单。详情卡片头部同样有书签按钮，已收藏时信息栏顶部列出所在分组的小标签。分组菜单（玻璃菜单，手机上是底部弹层）列出全部分组，可多选，最后一行是就地新建分组，底部「从本地收藏移除」。加入后弹出提示「已加入「稍后看」」，带「加入分组」（打开分组菜单）和「撤销」。
  - **入口与地址**：侧栏右上角的书签图标按钮，与左上角的设置按钮对称（样式同设置按钮，配色是淡粉色的半透明玻璃，只有图标、不显示条数；平板窄栏里与设置按钮一样不显示，侧栏浮出时排在关闭按钮左边），地址 `/local`，选了分组时带 `group=<分组 id>`（`later` 为稍后看），`?demo` 保留在最前；同样盖在发现页上面，聚合模式下也能进。
  - **页面**：左侧是分组面板（全部、稍后看、自定义分组，各带条数；「新建分组」；底部「导出」「导入」），手机上分组是顶部横向滚动的 chip。右侧顶部是本地搜索框（在标题、正文、作者名里做子串匹配，不发请求）、排序（最近加入 / 最早加入 / 发布时间）、平台 chip（只列出有条目的平台，可多选）。卡片复用瀑布流卡片，左上角带平台图标；点开是详情卡片，详情和评论照常按条目的平台和该平台浏览用的账号请求。可以批量选择：移到分组、移除（要二次确认）、下载（按平台各建一批）。条目在平台上已经不可用（`item get` 返回 `UPSTREAM` 且像是已删除，或明确的不存在）时卡片上盖一层「原内容已不可用」，给出「移除」和「原链接」。空的时候写「还没有本地收藏」，说明怎样加入。
  - **导出 / 导入**：导出是一个 JSON 文件 `catbus-local-<日期>.json`（`{schema: 1, exported_at, groups, items}`），由页面生成后交给浏览器保存，不经服务端。导入读用户选的文件，校验结构（不认识的字段丢掉，不合法的条目跳过），和现有的合并：分组按名字合并，条目按「平台 + 条目 id」去重、分组取并集；之后提示导入了几条、与已有的合并了几条、跳过了几条。
- **搜索历史**：设计稿 Z8。每个平台各自记最近提交过的关键词，存在 localStorage `catbus.history`（`{<平台>: [关键词...]}`，最近的在前，每个平台最多 20 条，去重；聚合模式下记到最后点选的渠道），只在浏览器里。搜索框聚焦、输入为空时，面板在热搜上面先列「最近搜过」（最多 6 条，标题右侧「清空」，每行右侧 × 删掉这一条）；没有热搜的平台也显示历史。有输入时，历史里包含输入的（不区分大小写）排在联想前面，最多 3 条，带时钟图标，与联想去重。键盘、点选的行为与联想相同。设置弹窗「通用」里有「记住搜索历史」开关（默认打开，存 `catbus.settings` 的 `searchHistory`），关掉时不再记录，并清空已有的历史。演示模式同样记录。
- **复制等价命令**：页面上调好的查询可以复制成 CLI 命令，交给脚本或 Agent 重放（与 TUI 底部的等价命令对应，4.13）。命令由页面发请求时用的同一份 argv 生成（`web/src/composables/command.ts`），去掉 `--cursor`（续翻的位置只对这次会话有意义），保留 `-a` 和 `--limit`，写成 `catbus <p> <resource> <action> <位置参数> <选项>`；含空格、引号或 shell 特殊字符的参数用单引号包起来（单引号写成 `'\''`），以 `-` 开头的位置参数前面加 `--`。入口：发现页右上角「N 条 · 耗时」里刷新按钮旁的终端图标（聚合模式下复制最后点选的渠道那一条；没加载过时不显示），作者页、「我的」页的计数旁同样一个；详情卡片正文之后一行等宽小字 `$ catbus <p> item get <url>`，右侧复制按钮（种子、演出同样有）。点了复制并提示「已复制」。演示模式同样生成（演示数据的链接不是真的，只用来看格式）。
- **导出已加载的列表**：选中的条目不经服务端、不再请求平台，直接用页面上已有的数据生成文件交给浏览器（`web/src/composables/export-list.ts`）。批量操作里「下载」旁边是「导出」按钮（手机底部操作条同样有），点开是一个小菜单：CSV（UTF-8 带 BOM，Excel 直接打开不乱码）或 JSON。CSV 每条一行，列依次是 平台、ID、类型、标题、正文、作者、作者链接、发布时间、播放、点赞、评论、收藏、分享、价格、链接；种子另加体积、做种、下载；表头按当前界面语言写（中文界面就是上面这些列名，其他语言用对应的译文），单元格里的值不翻译；正文里的换行保留在引号里。JSON 是 `{schema: 1, exported_at, items: [{platform, item}]}`，item 是 6.2 的 Item（去掉 `--raw` 挂的原始对象）。文件名 `catbus-<平台或 mixed>-<日期时间>.<扩展名>`。发现页、作者页、「我的」页、本地收藏页都能用；导出不改变选中。演示模式同样可用。
- **看过的标记**：点开过详情的条目在瀑布流里变淡（封面和文字 0.55 透明度，悬停时恢复），封面右下角一个小标签「看过」，翻多页时不重复看。记录只在浏览器里：localStorage `catbus.seen`（`{<平台>: [条目 id...]}`，最近的在后，总共最多 5000 条，满了丢最早的）。设置弹窗「显示」里有「标记看过的内容」开关（默认打开，存 `catbus.settings` 的 `markSeen`）和「清除看过记录」（点两次生效）；关掉开关时不再记录、也不显示标记，已有的记录保留。选择模式和本地收藏页不显示标记。
- **评论区筛选**：详情卡片的评论超过 5 条时，评论标题行右侧出现一个搜索图标和排序下拉（默认 / 最热 / 最新）。只作用于已经加载的评论（不发请求，不改翻页）：搜索在评论正文和评论者昵称里做子串匹配（不区分大小写），匹配的部分高亮；最热按点赞数降序，最新按发布时间降序，取不到的排在最后。有筛选时标题下面一行「在已加载的 N 条里找到 M 条」和「清除」，滚到底照常翻下一页，新加载的评论同样参与筛选。换条目时复位。楼中楼不参与筛选。
- **详情卡片的字幕、弹幕与媒体链接**：只在条目所属平台 web 端的对应命令已实现时出现，能力由 `GET /api/filters` 的 `subtitles`（`item subtitles`）、`danmaku`（`danmaku list`）、`media`（`item media`）从注册表读出，读不到时当作不支持。
  - **字幕、弹幕**：正文之后、相关推荐之前一行「字幕」「弹幕」两个折叠按钮（目前只有 B 站）。点了才请求（`catbus <p> item subtitles|danmaku list [-a <账号>] -- <item>`），结果在本页会话里按「平台 + 条目」缓存。字幕：有几种语言时上面是语言 chip，下面逐行是「mm:ss 文字」，最高 320、内部滚动，右上角「复制全文」（只复制文字，一行一句）；没有字幕时写「这个视频没有字幕」。弹幕：按视频内的时间排序，逐行「mm:ss 文字」，最高 320、内部滚动，标题写条数；为空时写「没有弹幕」。出错时在折叠区里显示原因和「重试」。
  - **媒体链接**：详情卡片的下载菜单（下载按钮旁的下拉）底部一行「复制媒体链接」：请求 `catbus <p> item media [-a <账号>] -- <item>`，把 Media[] 的 `url` 一行一个复制到剪贴板，提示「已复制 N 条链接」并说明链接可能有时效、部分平台要带 Referer 才能打开；没有可用的链接或取不到时，在这一行下面写明原因（带警示图标），菜单不收起。链接不写日志。
- **瀑布流的键盘操作**：发现页、作者页、「我的」页、本地收藏页的瀑布流支持键盘（焦点不在输入框里、没有打开详情卡片和弹窗时）：`j` / `→` 下一张、`k` / `←` 上一张（按条目顺序），第一次按时从视口里第一张开始；当前卡片描红边并滚进视口。`Enter` / `o` 打开详情卡片，`x` 选中 / 取消选中，`b` 加入稍后看（同书签按钮），`/` 聚焦搜索框，`Esc` 取消当前卡片。设置弹窗「通用」末尾列出这些按键（只读）。触屏设备上不生效。
- **直播弹幕**：平台 web 端的 `live listen` 已实现时（`GET /api/filters` 的 `live`），单一模式下侧栏这个渠道的子项多一个「直播」（与「发现 / 我的」并列；手机上分段同样多一项），地址 `/<p>/live?room=<直播间>`，同样盖在发现页上面（`web/src/views/LiveView.vue`，状态在 `web/src/stores/live.ts`）。
  - **页面**：顶部是直播间输入框（直播间链接或 ID；粘贴 App 的分享文案时取出其中的链接，如抖音的 `v.douyin.com` 短链，由 CLI 换成直播间）、时长（不限 / 10 分钟 / 30 分钟 / 1 小时）和「开始」。开始后先请求一次 `catbus <p> live get [-a <账号>] -- <room>`（平台实现了时）显示直播间头部（封面、标题、主播、在线人数、状态；不在直播时写「主播不在直播」，仍然可以开始监听）。下面是弹幕面板（标题「弹幕」和条数，右侧是暂停、导出两个图标按钮，下面一行类型过滤，再下面是事件流）；桌面上有直播画面时左边是画面、右边是弹幕面板（宽约 30%，320–420px），两栏一起撑满剩下的高度，收起画面或平板、手机上上下排列。一条事件都没收到就出错时，错误显示在弹幕面板里，不留空的事件流。事件流：最新的在下面，自动滚到底；用户往上滚时停止自动滚动，右下角出现「N 条新消息」，点了回到底部。每条是时间、类型图标、用户名、文字，礼物写「送出 <礼物> × N」（琥珀色），进场、关注、点赞是灰色小字。工具栏：暂停 / 继续（暂停时收到的事件先存着，继续时一起显示，暂停不断开连接）、按类型过滤（聊天、礼物、点赞、进场、关注、其他，多选 chip，带各类的计数）、「导出 jsonl」（把本次会话收到的全部事件按 CLI 的 jsonl 格式交给浏览器）、「停止」。时长到期、主动停止或连接断开时，事件流末尾一行说明原因，事件保留，可以重新开始。页面只保留最近 2000 条（导出的同样是这 2000 条），超出时丢最早的并在顶部说明。
  - **直播画面**：平台 web 端的 `live media` 已实现时（`GET /api/filters` 的 `liveMedia`），开始监听后在直播间头部下面显示播放器（`web/src/components/LivePlayer.vue`）。流地址来自 `catbus <p> live media [-a <账号>] -- <room>`，只播 FLV（mpegts.js，按直播的低延迟设置），跳过纯音频和 HEVC；经 `/api/media` 转发（B 站的直播 CDN 校验 Referer，地址还绑定取流时的 IP），直播流不缓存。静音自动播放，点画面上的喇叭开声音。控制栏是自己画的（不用浏览器自带的控件），直播没有进度条：左侧是播放 / 暂停、红点「直播」标记和刷新，右侧是静音和音量、全屏；刷新重新取一次流地址、从最新的画面接着放（地址带时效，卡住或延迟变大时用它），保持当前画质；暂停后再播放同样从最新的画面接着放，不接着放暂停前缓冲的那一段。鼠标在画面上移动时显示控制栏，停下 2.5 秒后隐藏（暂停时一直显示，触屏上点画面显示或隐藏）；点画面播放 / 暂停，双击全屏。有几种画质时右上角可以切换，默认不选原画。出错时先换同一画质的备用地址，再重新取一次流地址，仍不行才显示原因和「重试」。可以收起画面（收起时断开流）。头部显示主播不在直播时不显示播放器。停止监听时播放器一并卸载。演示模式不播放，只显示占位说明。
  - **发现直播间**：没有在监听时（包括停止后点「发现直播间」回来），直播间输入框下面是「发现直播间」，只显示平台已实现的部分（`GET /api/filters` 的 `liveList`、`liveSearch`、`liveCategories`）：搜索框（`catbus <p> live search [-a <账号>] [--limit N] [--cursor c] -- <关键词>`）、分类 chip（`catbus <p> live categories`，只在平台的 `live list` 接受 `--category` 时出现，第一项「推荐」不带分类）、推荐列表（`catbus <p> live list [-a <账号>] [--limit N] [--cursor c] [--category <分类>]`）。没提交关键词时显示推荐列表，提交了显示搜索结果，清空关键词回到推荐；平台没有 `live list` 时，没搜索前只写一句提示。直播间卡片排成网格：16:9 封面（左上角「直播中」或「未开播」，左下角在线人数）、标题（最多两行）、主播头像和昵称；点卡片把直播间（`url`，没有时 `id`）填进输入框并开始监听。滚到底按 `--cursor` 翻页，每页条数取设置。结果按「平台 + 分类或关键词」在本页会话里缓存，标题旁的刷新按钮重新请求；加载中显示骨架卡片，空列表写「现在没有正在直播的直播间」或「没有找到「<关键词>」的直播」，出错沿用错误态（「重试」「去登录」「去验证」）。
  - **直播间标签**：监听开始后，弹幕面板的标题行换成一排标签：弹幕，以及平台已实现的礼物（`live gifts`）、榜单（`live rank`）、带货商品（`live products`）、回放（`live replays`，只在直播间头部有主播时出现，`<user>` 取主播的 `url`，没有时 `id`），能力来自 `GET /api/filters` 的 `liveGifts`、`liveRank`、`liveProducts`、`liveReplays`。除弹幕外，切到标签时才请求（`catbus <p> live gifts|rank|products [-a <账号>] -- <room>`、`catbus <p> live replays [-a <账号>] [--limit N] [--cursor c] -- <user>`），结果按「平台 + 直播间」在本页会话里缓存，标签右上角的刷新按钮重新请求。礼物是名称和价格（Price，虚拟货币写平台的货币代码）的格子；榜单是名次（前三红色）、头像、昵称和分数；带货商品和回放是封面、标题（商品另有价格，回放另有时长或发布时间）的列表，点一条打开详情卡片，旁边的外链图标在新标签页打开原链接。切换标签不影响监听：弹幕照常收，回到弹幕标签时补上。为空时写「没有礼物信息」「榜单暂时为空」「没有带货商品」「还没有回放」，出错时在标签里显示原因和「重试」。手机上标签横向滚动。
  - **最近弹幕**：平台已实现 `live history` 时（`liveHistory`），开始监听时同时请求一次 `catbus <p> live history [-a <账号>] -- <room>`，把进入直播间前的最近弹幕放在事件流最前面，下面一行「以上是进入直播间前的弹幕」。这些弹幕同样按类型过滤，但不计入条数、不进导出；取不到时不提示。
  - **bridge**：`POST /api/live/start {platform, room, account?, duration?}` 起一个 `catbus <p> live listen [-a <账号>] [--duration <600|1800|3600>] -o jsonl -- <room>` 子进程，返回会话 id；`GET /api/live/<id>/events` 是 SSE（`text/event-stream`），每个 `data:` 是一条 Event（6.2），结束时发 `event: end`（`data` 是 `{reason: done|stopped|error, error}`，`error` 取 stderr 的摘要信封）；`POST /api/live/<id>/stop` 结束子进程。平台、账号名的校验同其他命令，`<room>` 只接受 http(s) 链接或 ID。同时最多 2 个监听会话，第 3 个报 429；SSE 连接断开 15 秒内没有重新连上时结束子进程；不限时长的会话最长 6 小时。监听不占 `/api/catbus` 的并发名额。事件只经过内存，不落盘、不写日志。
  - **状态**：没有这个平台的账号时与「我的」页一样提示登录；`AUTH_EXPIRED` / `RISK_CONTROL` 时沿用错误态（「重新登录」「去验证」）。演示模式不请求服务端，按大约每秒 2–6 条生成演示事件（含礼物、进场），时长和停止照常生效；发现直播间、各标签和最近弹幕用 `web/src/api/mock/live.ts` 的演示数据，能力与注册表一致。
- **通知与私信**：当前账号收到的通知和私信，一页看完，只读（`web/src/views/InboxView.vue`，状态在 `web/src/stores/inbox.ts`）。Penpot 设计稿 `inbox-desgin` 的 X1（亮色，只有通知）、X2（暗色）、X3（通知 + 私信，切在私信）、X4（手机）、X5（各种状态）。不做成「我的」页的标签：「我的」页是瀑布流，这里是列表和对话。
  - **能力**：`GET /api/filters` 的 `inbox` 从注册表读出 `{notices, count, messages}`：`notices` 为 web 端的 `notice list` 已实现，`count` 为 `notice count` 已实现，`messages` 要 `msg list` 和 `msg history` 都已实现（只有 `msg history` 的平台找不到会话，不显示私信）。`notices`、`messages` 至少有一个时平台才有收件箱；只有 `count` 的平台没有收件箱。
  - **入口与地址**：单一模式下侧栏这个渠道的子项多一个「收件箱」（与「发现 / 我的 / 直播」并列；手机上分段同样多一项），右侧是未读通知数的红色角标（`notice count` 的 `total`，超过 99 写 `99+`，为 0 或取不到时不显示）。地址 `/<p>/inbox?tab=<notices|messages>&type=<通知类型>&c=<会话 id>`，`?demo` 保留在最前；默认标签（有通知时是通知，否则是私信）省略 `tab`，不过滤类型时省略 `type`，没选中会话时省略 `c`。进入、切标签、选会话用 `history.pushState`，前进 / 后退按地址恢复；地址里不可用的标签回到默认标签。同样盖在发现页上面；点「发现」或别的渠道回到发现页。
  - **未读角标**：只在这几个时候请求 `catbus <p> notice count [-a <账号>]`：单一模式下第一次选中这个渠道（每个平台、每个账号在本页会话里一次）、进入收件箱、点收件箱的刷新按钮。不轮询；看了通知也不会让角标变少（WebUI 不标记已读），刷新后以平台给的数为准。取不到时不显示角标，也不提示。
  - **标题与标签**：标题按平台的能力写：只有通知叫「通知」，只有私信叫「私信」，两者都有叫「通知与私信」，旁边是「通知 / 私信」分段，通知一段带 `notice count` 的 `total`（为 0 或取不到时不带），私信一段不带数字。标题右侧一行灰字「只读 · 回复和管理请到<平台>」。
  - **通知**：`catbus <p> notice list [-a <账号>] --limit N [--cursor c]`（每页条数取设置），滚到底按 `--cursor` 翻页。通知在一个连续的面板里，行之间是细分隔线，按日期分组：今天、昨天、本周（7 天内）、更早。面板头一行是类型 chip（全部、评论、@、赞、关注、系统，`Notice.type`，各带类型图标），右侧是「已加载 N 条 · 耗时」、复制命令和刷新。chip 只作用于已经加载的通知，不重新请求；有 `notice count` 时各类型带对应的数（为 0 或 null 时不带），没有时不带数字；过滤后不够一屏时自动再翻一页。每行是头像（右下角一个类型色的小徽标：评论蓝、@ 青、赞红、关注绿、系统灰，颜色在 `tokens.css` 的 `--type-*`，亮色、暗色各一套）、用户名和类型说明（如「评论了你」「赞了你」）、相对时间、正文（最多三行）；赞和点赞类通知的正文是被赞的那条自己的内容，用灰字加左侧引用线。没有用户的通知用类型色的图标块代替头像，名字位置写类型说明（「系统通知」「有人@了你」「有人赞了你」等）。
  - **时间**：通知、会话列表统一用相对时间、普通字体：1 分钟内「刚刚」，1 小时内「N 分钟前」，今天「N 小时前」，昨天「昨天 HH:mm」，7 天内「N 天前」，今年「M月D日」，更早带年份；悬停显示完整时间。
  - **详情栏**：桌面（> 1024px）上通知面板右侧是一栏：上面是选中通知的详情（头像、名字、类型说明、全文、完整时间、「在<平台>打开」（`target.url`）、「TA 的主页」（`user.url`），没有链接的按钮不显示），下面是「按类型」概览（各类型的数量和比例条，点一类等于点对应的 chip；有 `notice count` 时用它，否则写明「按已加载的通知统计」）。点一行是选中（默认选中第一条），↑ / ↓ 在行之间移动；平板和手机上没有这一栏，点一行直接在新标签页打开 `target.url`（没有时不可点）。
  - **私信**：一个整宽的面板分两栏：左侧是会话列表（`catbus <p> msg list [-a <账号>] --limit N [--cursor c]`，滚到底翻页），头部写「会话」和已加载的个数、复制命令、刷新；每行是对方头像、名字、相对时间、最后一条消息（一行省略）和红色未读数（`unread`，只显示，不清零）；没有对方信息的会话（如群聊）显示群图标、「群聊」和会话 id 的后 6 位。右侧是选中会话的消息（`catbus <p> msg history [-a <账号>] --limit N [--cursor c] -- <会话 id>`），头部是对方头像、名字、已加载的条数和「在<平台>打开」（`peer.url`，没有时不显示）；按时间从上到下排，打开时滚到最下面；滚到顶时（或点顶部的「加载更早的消息」）按 `--cursor` 取更早的一页，接在上面、保持当前看到的位置。自己发的（`from.id` 等于当前账号的用户 id）靠右、红色气泡，对方的靠左、玻璃气泡带头像；群聊里对方的消息上方写发送人。图片显示缩略图，点击看大图；视频、卡片和其他消息显示文字，没有文字时写「[视频]」「[卡片]」「[其他消息]」。消息之间隔超过 10 分钟时插一行时间。只读：没有输入框，不发消息、不撤回、不删除、不标记已读；消息流底部是只读栏「只读，回复请到<平台>」。桌面上默认选中第一个会话（替换地址，不多出一条历史）；手机上先是会话列表，点一个进入会话页（顶栏返回、对方、外链），返回回到列表。会话和消息在本页会话里按「平台 + 账号 + 会话」缓存，切回来不重新请求；刷新按钮重新请求当前标签（私信时连同当前会话）。
  - **状态**：没有这个平台的账号时整页是「登录<平台>后查看<标题>」和「登录」；`AUTH_EXPIRED` 时是「<平台>的登录已失效」和「重新登录」；`RISK_CONTROL` 是「去验证」「重试」；其余错误（包括 M-Team 用 API Key 登录时站内信报的 `UNSUPPORTED`）显示原因和「重试」。通知、会话列表、消息各自出错、各自重试（会话列表正常时只有消息栏显示错误）。空态：「还没有通知」「没有这一类通知」（带「看全部」）「还没有私信」「这个会话还没有消息」。加载中显示与真实行同尺寸的骨架。
  - **复制等价命令**：面板头的终端图标复制当前列表的命令（通知是 `notice list`，私信选中会话时是 `msg history`，否则是 `msg list`），规则同「复制等价命令」。
  - **演示模式**：不请求服务端，用 `web/src/api/mock/inbox.ts` 的演示数据：通知覆盖五种类型（可翻页），会话有单聊和一个群聊、其中一个没有消息，消息有文字、图片、自己发的和对方发的，可以往上翻更早的；演示的能力表与注册表一致。
- **订阅**：关键词和作者可以订阅，`catbus web` 的服务端定时检查有没有新内容。只读：不自动下载，也不推送到 qBittorrent，新内容只在订阅页里显示为未读。
  - **订阅入口**：发现页提交了关键词后，计数「N 条 · 耗时」旁边有「订阅」按钮，订阅当前渠道的这个关键词（聚合模式下是最后点选的渠道）；作者页的头部也有「订阅」按钮，订阅这个作者的作品。已经订阅的按钮显示「已订阅」，再点一次取消订阅。按钮只在平台 web 端的 `item search`（关键词）或 `user items`（作者）已实现时出现（取自 `GET /api/filters` 的 `search` 和 `author`）。最多 50 条订阅，已满时提示先取消一些。同一平台、同一种类、同一个关键词或作者重复订阅时，服务端返回原来那条，不新建、不报错。手机上发现页不显示计数，订阅按钮放在筛选栏里。
  - **存储**：订阅存在 `~/.catbus/webui/subscriptions.json`（目录 0700，文件 0600，原子写入），不放在 cache 里，以免清缓存时一起删掉。每条订阅的字段：`{id platform kind query label account created_at last_check next_check error seen unread}`（`last_check` 是上次检查成功的时间，`next_check` 是毫秒时间戳）。`kind` 取 `keyword` 或 `author`；`query` 是关键词，或作者的链接 / ID（规则同作者页的 `<user>`）；`label` 是显示名（关键词本身或作者昵称）；`account` 是订阅时这个平台浏览用的账号，可以为 null；`seen` 记最近见过的条目 ID，最多 500 个；`unread` 是新内容（Item，去掉 `--raw` 的原始对象），新的排在前面，最多 100 条。文件另有 `paused: {<平台>: {at, verify_url}}`。
  - **检查**：服务端每分钟扫一遍到期的订阅（`next_check` 已过），一次只检查一条，经 `/api/catbus` 同一个队列运行（runner.ts）。关键词订阅运行 `catbus <p> item search [-a <账号>] [--sort latest] --limit 20 -- <关键词>`，平台的 `item search` 支持 `latest` 时才带 `--sort latest`；作者订阅运行 `catbus <p> user items [-a <账号>] --limit 20 -- <作者>`。每次检查后的下一次在 30 分钟后，再随机加 0–5 分钟，把各条错开。新建的订阅在 0–60 秒内做第一次检查；第一次检查成功时只把已有的条目记进 `seen`，作为基线，不算新内容。之后不在 `seen` 里的条目进 `unread`。只在 `catbus web` 运行时检查：服务停着的时间不补。
  - **风控**：检查遇到 `RISK_CONTROL` 时，这个平台的全部订阅暂停（写进 `paused`，带 `detail.verify_url`），直到用户在订阅页点「恢复」；恢复后立刻检查一次这个平台到期的订阅。其他错误只记在这条订阅的 `error` 上（错误信封里的 `error`），下个周期照常重试；检查成功后清掉 `error`。
  - **接口**：`GET /api/subs` 返回 `{subs, paused}`；`POST /api/subs/add {platform, kind, query, label?, account?}`；`POST /api/subs/remove {id}`；`POST /api/subs/read {id}`（清空这条的 `unread`）；`POST /api/subs/check {id}`（立刻检查这一条；平台暂停时报 409）；`POST /api/subs/resume {platform}`。平台、账号名的校验同其他命令；关键词 1–100 个字符，不能有控制字符；作者只接受 http(s) 链接或 ID；`label` 最长 100 个字符。校验、同源、访问令牌的规则与其他 `/api/*` 相同，`--demo` 时拒绝。
  - **订阅页**：侧栏 12306 下面一行「订阅」（铃铛图标，右侧是未读总数），地址 `/subs`，选中了一条订阅时带 `sub=<id>`，`?demo` 保留在最前；和本地收藏一样盖在发现页上面，聚合模式下也能进。左侧是订阅列表：每行是平台图标、关键词或作者名、未读数、上次检查的相对时间，有错误时显示错误。右侧是选中那条订阅的新内容，复用瀑布流、卡片、详情卡片、批量选择与下载；顶部是「全部标为已读」「立即检查」「取消订阅」（取消要点两次）。没有未读时右侧写「没有新内容」。平台被风控暂停时，列表上方一条琥珀色提示「<平台>遇到风控，订阅已暂停」，带「去验证」（有验证链接时）和「恢复」。订阅页打开时每 60 秒重新读一次 `/api/subs`。没有订阅时写「还没有订阅」，并说明在哪里订阅。手机上订阅列表在上面，点一条进入它的新内容。
  - **演示模式**：页面里模拟订阅（存在内存里，刷新后清空），新建的订阅马上带几条演示的新内容，「立即检查」再随机多出几条。
- **12306 查询页**：Penpot 设计稿 `design-12306` 的 V1（亮色）、V2（暗色）、V3（手机）、V4（中转）、V5（各种状态）。12306 不是内容平台，没有瀑布流，单独一页（`web/src/views/RailView.vue`，状态在 `web/src/stores/rail.ts`）。
  - **入口**：侧栏渠道列表最后，与内容平台之间隔一条分隔线，一行「12306」带「免登录」标签（`web/src/data/platforms.ts` 的 `RAIL`，不在 `PLATFORMS` 里，所以不进发现页、聚合、筛选和渠道缓存）；渠道计数算上它（单一模式 14，聚合模式的总数仍是 13）。点它进入查询页，点别的渠道回到发现页。在查询页上「单一 / 聚合」开关置灰；聚合模式下这一行置灰，提示「12306 不参与聚合」，点了只闪现提示。账号卡换成「无需登录 · 购票请前往 12306 官方」，不能点。顶栏只有标题（上方小字「12306 · 免登录查询」，标题「车票查询」）和主题按钮，没有搜索框和下载记录按钮；演示数据时同样显示「当前状态仅供演示」标记。
  - **数据**：全部是免登录的只读命令（见「bridge 的边界」），不带 `-a`。车站联想用 `12306 station search -- <关键词>`，直达用 `12306 ticket search --date <日期> -- <from> <to>`，经停用 `12306 route get --date <日期> -- <train_no> <from.code> <to.code>`（站取这一趟车自己的上下车站，不是查询的站：结果里有同城车站），中转用 `12306 transfer search --date <日期> [--via <中转站>] -- <from> <to>`。车型和「只看有票」在页面里筛选（一次查询只请求一次，切换筛选不重新请求），bridge 虽然放行 `--type` / `--available`，页面不用。同一个查询（出发、到达、日期、直达或中转、中转站）的结果在本页会话里缓存，切回来不重新请求；「⟳ N 趟 · 耗时」按钮重新请求并替换缓存。经停按 `train_no + 上下车站 + 日期` 缓存。新的查询会取消还在路上的旧请求（同发现页）。
  - **表单**：出发站、交换按钮、到达站、日期、「查询」。车站框是输入框，右侧小字显示电报码（选过联想项时才有）；输入后停 200ms 用 `station search` 联想，只采用最后一次的结果，同一关键词在本页会话里缓存。联想面板（`role="listbox"`）每行是站名、拼音（与输入相同的前缀加粗）、城市、电报码，↑ / ↓ 循环、Enter 选中、Esc 收起，点一项即填入；输入法组合输入期间不请求。没有选联想项也可以直接查询，原样把输入交给 CLI（它接受站名、电报码、拼音和城市）。交换只交换两个框，不自动查询。日期只能选今天起 15 天内（含今天）：表单下面是从今天起 9 天的日期条（「今天」「明天」，其余写星期），右侧「更多日期」和日期框都打开日期选择器（月历，范围外的日子置灰，底部写「今天 M月D日」「可选今天起 15 天内」）；地址里的日期不在范围内时退回今天。点日期条或在日期选择器里选了日期就直接查询（两个站都填了时），换站之后要点「查询」。出发站或到达站为空时点「查询」，空的那一框抖一下并聚焦，不发请求。桌面和平板上表单吸顶，样式与发现页的筛选栏一致：碰到页面顶边时贴边停住，左右伸进页面的内边距铺满宽度，上边直角、下边圆角，换成玻璃底；手机上表单太高，不吸顶。滚过 640px 后右下角出现回顶按钮，与发现页是同一个组件（`web/src/components/BackToTop.vue`）。
  - **结果**（直达）：筛选栏是「直达 / 中转」分段、车型多选（全部、G 高铁、D 动车、C 城际、Z 直达、T 特快、K 快速、其他；按车次首字母，选了几个就显示几类，都不选等于全部）、「只看有票」开关（`has_ticket`），右侧是刷新按钮和「N 趟 · 耗时」。下一行左侧是摘要「北京南 → 上海虹桥 · 11月16日 周一」，结果里有和查询不同名的车站时加「含同城车站」；右侧是排序：出发最早（默认）/ 出发最晚 / 历时最短，在页面里排。每趟车一行：车次和车型名、出发时间与出发站、历时和箭头、到达时间与到达站（跨天时到达时间后标 `+1`），站名前的小标记按 Ticket 的 `start` / `end`：`from.code === start.code` 为「始」，`to.code === end.code` 为「终」，其余为「过」。席别不是固定列，按这一趟车自己的席别（`remaining` 的键序）从左排：席别名、余票、票价；余票取 `remaining`，`{min: 21}` 显示「有」，数字显示「N 张」，≤ 9 张标红，0 显示「无」并整格置灰；`bookable` 为 false 时余票都显示为「—」。行尾是「在 12306 打开」（`Ticket.url`，新标签页）和展开按钮。没有任何购票、预订、候补按钮。
  - **展开经停**：点展开按钮（或行本身）在行内展开经停，同一时间可以展开多行。第一次展开才请求 `route get`，请求中显示一行加载，失败时显示错误和「重试」。桌面是横向时间线：每站一个点，上面站名、下面时刻（始发站写出发时刻，其余写到达时刻）和「始发」「终到」「停 N 分」；乘车区间（`in_range`）的点和连线是红色，区间外置灰；站多时横向滚动。手机是竖向时间线。标题行「经停站 · N 站」，右侧「红色为你的乘车区间」，底部一行「catbus 只查询时刻和余票，购票请在 12306 官方完成。」
  - **中转**：分段切到「中转」时请求 `transfer search`；筛选栏换成「途经」下拉（AppSelect，第一项「不限中转站」，其余是不限中转站时结果里出现过的中转站，选了就带 `--via` 重新请求），车型和只看有票不显示。排序：全程最短（默认，`duration_minutes`）/ 出发最早 / 等候最短（`wait` 解析成分钟）。列表上方一行说明「中转方案要在 12306 分段购买，每一段单独出票；每段右侧可以打开对应的余票页。」每个方案一张卡：头部是种类标签（`同车换座` 红色、`换乘` 灰色；`same_station` 为 false 时另加「需换站」）、「经 南京南 中转」、全程出发到达时间（跨天标 `+1`）和「全程 N 小时 M 分」；下面是各段：序号、车次、出发时间与站、历时、到达时间与站、席别（规则同直达，横排）和「在 12306 打开」（`TransferLeg.url`，为 null 时不显示）。段与段之间一行等候说明：同车换座「不用下车，在 X 换个座位 · 等候 N」，同站换乘「在 X 换乘 · 等候 N」，换站「在 X 下车，前往 Y 换乘 · 等候 N」。每一段不标始 / 终 / 过。
  - **状态**：没有查询过时显示提示卡「输入出发站和到达站，查询车次和余票」；加载中显示骨架行，筛选栏下沿显示 LoadingBar，右侧「加载中…」和跳动的耗时（同发现页）；直达没有车次时显示「没有直达车次」，说明里写站和日期，按钮「查看中转方案」切到中转；有车次但被车型 / 只看有票筛光时显示「没有符合筛选的车次」和「清除筛选」；中转没有方案时显示「没有找到中转方案」；请求出错用 StateView 的错误态（重试）。
  - **地址**：`/12306?from=<站名>&to=<站名>&date=<YYYY-MM-DD>&view=transfer&via=<中转站>`，`?demo` 原样保留在最前；日期是今天时省略 `date`，直达时省略 `view`，不限中转站时省略 `via`；车型、只看有票、排序不进地址。点「查询」、换日期、切直达 / 中转、换中转站时用 `history.pushState` 改地址，前进 / 后退按地址恢复并查询（缓存里有就直接恢复）。打开时地址里有出发站和到达站就直接查询；没有时表单填上次查询的两个站（localStorage `catbus.rail`），不自动查询。离开查询页回到发现页时，发现页沿用离开前的状态和地址。
  - **演示模式**：`?demo` 下用 `web/src/api/mock/rail.ts` 的演示数据，整页可用：车站联想从一张内置车站表里按站名、拼音、电报码匹配；北京 → 上海一带的直达、经停和中转取自真实输出的裁剪，其他站之间按车次生成；站名带「崇礼」时直达为空（演示「没有直达车次」）。
  - **手机**：表单竖排（出发、交换、到达一行，下面日期框、日期条横向滚动、整行宽的「查询」）；「直达 / 中转」和「只看有票」一行，车型 chip 一行横向滚动，排序是摘要行右侧的 AppSelect。每趟车是一张卡片：车次、出发 / 到达时间和站、历时，下面是席别格；右上角是展开按钮，卡片收起时没有外链，展开后底部是竖向经停和整行宽的「在 12306 打开」。车站联想改成底部弹层（BottomSheet：标题「选择出发站 / 到达站」、输入框、站列表，行高 44），日期选择器同样是底部弹层。中转卡片里各段竖排，席别换行。
- **M-Team「我的」页与筛选**：Penpot 设计稿 `mteam-desgin` 的 Y1（亮色）、Y2（暗色）、Y3（手机）、Y4–Y6（浏览筛选）、Y7（成人分区设置）、Y10（各种状态）。M-Team 是 PT 站，账号自己的做种、时魔、考核比内容流更常用，所以单独一页（`web/src/views/MteamMeView.vue`，状态在 `web/src/stores/mteam.ts`，接口在 `web/src/api/mteam.ts`），浏览页加三组 M-Team 专用的筛选。
  - **入口与地址**：单一模式下当前渠道是 M-Team（或正在看「我的」）时，侧栏的 M-Team 行下面展开「发现 / 我的」两个子项（照 Y1）；聚合模式下不展开。手机上没有常驻侧栏，发现页（当前是 M-Team 时）和「我的」页的标题下面是「发现 / 我的」分段。没有其他入口。地址是 `/mteam/me`，种子列表不在「做种中」时带 `tab=<status>`（如 `/mteam/me?tab=completed`），`?demo` 保留在最前；进入、切种子分段用 `history.pushState`，前进 / 后退按地址恢复。「我的」页像 12306 查询页一样盖在发现页上面，发现页在后台不动；点「发现」或别的渠道回到发现页。
  - **数据**：全部是 bridge 放行的只读命令，只认平台 `mteam`，可带 `-a <账号>`（账号规则同其他命令）：`mteam seed stats`、`mteam bonus get`、`mteam exam get`（都不带别的选项）、`mteam seed list [--status seeding|leeching|completed|incomplete|uploaded] [--limit N] [--cursor c]`、`mteam bonus history [--limit N] [--cursor c]`、`mteam user collects [--mode normal|movie|tvshow|music|anime|adult] [--limit N] [--cursor c]`，以及分类菜单用的 `mteam item categories`。`--limit` 只接受 1–100，`--cursor` 同其他命令。用 M-Team 本页浏览用的第一个账号请求。
  - **只手动刷新**：进入页面时各块各自请求一次，之后不自动刷新、不轮询；右上角的刷新按钮（写「更新于 HH:mm · 耗时」）把各块全部重新请求。各块各自加载、各自出错：一块失败只在那一块里显示原因和「重试」，不影响别的块；全部失败且是同一种原因（如连不上、登录失效）时整页显示一次错误（「重试」「去登录」）。没有 M-Team 账号时整页是「登录 M-Team 后查看做种、时魔和考核」和「登录」按钮。加载中各块显示与真实布局同尺寸的骨架。
  - **四块数字**（照 Y1）：做种中（`seed stats` 的 `seeding`，下面一行「下载中 N」）；时魔（`bonus get` 的 `per_hour`，保留两位小数，「/ 小时」，下面「计入 N 个 · 体积」）；A 值（`a`，千分位、两位小数）；两步验证（`two_factor` 为 false 时整块红色「未开启」，下面一行「在 M-Team 网页设置」链接到站点；WebUI 不改这项设置）。
  - **考核**：`exam get` 的每一项考核一张卡：标题、状态标签（`ONGOING` 写「进行中」，其余原样）、起止日期和「剩 N 天 N 小时」（不到 3 天时红色），下面依次是下载量、上传量（字节，按 1024 进制显示成 GiB / TiB）、魔力值三项：「当前 / 目标」和进度条，达标（`done`）的写「已达标」、进度条用主色，未达标的进度条红色并写「差 X」；最下面一行是站点的备注原文（`note`）。没有进行中的考核时一行空态「没有进行中的考核」。
  - **我的种子**：分段对应 `seed list --status` 的五个值（做种中 / 下载中 / 已完成 / 未完成 / 已发布），做种中、下载中带 `seed stats` 的数；右侧「已加载 N / 总数」（总数只有做种中、下载中知道）。每行是海报、中文名（`text` 里「分享率」行之后的第一行取 `|` 之前；没有时用种子名）+ 优惠标签（规则同种子卡片）、种子名（等宽，单行省略）、体积和 ↑ 做种 ↓ 下载、我的上传、我的下载、分享率。本账号的上传、下载、分享率从 `text` 的「上传：」「下载：」「分享率：」三行取原文，分享率小于 1 时红色；这三行解析不出来时整段 `text` 原样显示在种子名下面。点一行打开种子详情卡片（同发现页）。滚到列表底部时按 `--cursor` 翻页（`--limit` 取设置的每页条数）。分段写进地址（见上）。空列表写「没有正在做种的种子」等对应的空态。
  - **魔力流水**：`bonus history`，按天分组（今天、昨天、其他写日期），每行是时间、`note`（CLI 已去掉 IP，直接显示）、`change`（带符号，0 灰色，减少的红色，有变动的加粗）；有 `url` 的行可以点，打开相关种子的详情卡片。滚到这一块的底部时按 `--cursor` 翻页。右上角「只看魔力变动」开关默认关，打开后只显示 `change` 不为 0 的（只在页面里过滤，不改请求；过滤后不够一屏时自动再翻）。底部一行说明「上传、下载的变化写在每条里；站点不提供变动前后的余额」。
  - **收藏**：`user collects --mode <分区>`，右上角是分区的 AppSelect（默认综合，成人分区按「成人分区」设置决定出不出现），种子海报小卡横排（照 Y10），点开是种子详情卡片；空时「这个分区还没有收藏」。只读：不能在这里收藏或取消收藏。
  - **两种登录方式**：API Key 和账号密码登录在「我的」页上能用的功能相同，不做区别；账号卡的副标题写登录方式（API Key / 账号密码）。站内信不在这一页。
  - **浏览筛选**（照 Y4–Y6）：M-Team 的 `item search` / `feed list` 另带三组筛选，放在字段排序之前、同一行：分区（`--mode`，分段：综合、电影、剧集、音乐、动漫，成人分区打开时多一个「成人」）、分类（`--category <id>`，AppSelect，选项来自 `item categories`，按大类分组、只列当前分区的大类：综合是除成人外的全部大类，电影 `100`、剧集 `105`、音乐 `110`、动漫 `449`，成人是 `115` `120` `445` `446`）、只看免费（`--free`，开关 chip）。实测（2026-11-14）`--category 100` 这样的大类 ID 返回空列表，不等于整个大类；而 `--mode movie --category 419` 只在对应分区里有结果，所以菜单里大类只作分组标题、不能选，只能选子类；选了分类后 chip 只写分类名并变红，第一项「全部分类」清掉分类。换分区时清掉分类。分类表在本页会话里只取一次（演示模式用演示的分类表），取不到时分类 chip 置灰并说明原因。地址参数：`mode=<分区>`（综合省略）、`category=<子类 id>`、`free=1`，与 `sort` 等并存，如 `/mteam?mode=tvshow&category=402&free=1`；地址里的分类不属于这个分区时丢掉。三组筛选进渠道缓存的查询（换了就重新请求）。聚合模式下只在选中了 M-Team 时出现，只对 M-Team 那一路生效（别的渠道照常请求）。bridge 对 `item search` / `feed list` 放行 `--mode`（取值同上）、`--category`（1–16 个逗号分隔的数字 ID）、`--free`（开关）；别的平台带了由 CLI 报 `USAGE`，页面不会带。
  - **成人分区**：默认不显示。设置弹窗「显示」分栏的「M-Team」小节有一个开关「显示成人分区」（存 `catbus.settings` 的 `mteamAdult`，照 Y7），打开后分区分段、收藏的分区下拉里多一个「成人」，分类菜单里出现成人的大类。关闭时地址带 `mode=adult` 回到综合，并提示「成人分区没有打开，已切到综合」（带「去设置」）。
  - **演示模式**：`?demo` 下整页可用，数据取自真实输出的裁剪（账号信息换成假的）：四块数字、考核、各状态的种子列表（「下载中」为空，演示空态）、魔力流水（可翻页）、收藏（综合区有几条，其他分区为空）；分类表、按分区 / 分类 / 免费换一批种子。
  - **手机**（照 Y3）：顶栏是菜单按钮、标题和刷新按钮，下面「发现 / 我的」分段和更新时间；四块数字 2×2，考核三项竖排，种子行收成三行（中文名 + 优惠、种子名、体积 · 做种下载 · 分享率），种子分段横向滚动；收藏的分区下拉是底部弹层。可点元素不低于 44px。
- **地址**：页面状态写在地址栏里，`/<平台规范 id>?sort=<排序>&type=<类型>&kind=<推荐流分类>&time=<时间>&keyword=<关键词>`，例如 `/douyin?sort=latest&type=video&time=week&keyword=%E7%8C%AB`、`/douyin?kind=hot`。聚合模式（见「聚合模式」）另带 `agg=<渠道,...>`，按选中的顺序列出平台规范 id，排在 `sort` 前面，路径里的平台是其中最后点选的那个；未知的平台丢掉，路径里的平台不在列表里时补到最后。取默认值（综合、全部、推荐、不限、空关键词）的参数省略；关键词用 `encodeURIComponent` 编码；`?demo` 原样保留在最前。仍是单页应用：换渠道、换筛选、提交搜索时只用 `history.pushState` 改地址，不重新加载页面；只在输入框里打字不改地址，提交时才改。浏览器前进 / 后退按地址恢复状态并重新搜索。打开时按地址初始化；`/`、未知平台和不在选项里的取值回到默认，并用 `replaceState` 改成规范地址。服务端对没有扩展名的路径回退到 `index.html`，所以这些地址可以直接打开、刷新、收藏。作者页的地址是 `/<平台规范 id>/user?u=<作者>`，`<作者>` 是作者的 `url`（有就用它，小红书的链接带 `xsec_token`），没有时用 `id`，整体用 `encodeURIComponent` 编码，`?demo` 同样保留在最前（如 `/xhs/user?demo&u=...`）；进入作者页用 `history.pushState`，后退回到原来的发现页，发现页的筛选、结果和滚动位置原样恢复，不重新请求。
- **筛选**：排序和类型按钮按当前平台 web 端 `item search` 在注册表里声明的 `--sort` / `--type` 取值置灰，不支持的不能点（用 `aria-disabled`，不用原生 `disabled`，否则收不到鼠标事件），鼠标移入或键盘聚焦时用 tooltip 说明原因（如「抖音不支持按「评论最多」排序」）；只有推荐流（`feed list`）或没有已实现的 `item search` 的平台，除默认值（综合、全部）外全部置灰。平台的 `item search` 声明了私有选项 `--order-by`（目前只有 mteam，4.7）时，`/api/filters` 另外给出它的取值（`order`），单一模式下排序按钮换成这一组：默认（不带选项）、发布时间、体积、做种、下载、名称；点一下按该字段降序，再点当前选中的那个在降序 / 升序之间切换，按钮上用 ↓ / ↑ 标出方向。请求带 `--order-by <字段>`，升序再加 `--asc`，没有关键词（`feed list`）时同样生效。地址里仍用 `sort` 参数，取值是字段名，升序加 `_asc` 后缀（如 `/mteam?sort=size_asc`）。聚合模式下只有选中的渠道全都声明了 `--order-by` 才显示这一组，否则仍是标准排序，已选的字段排序退回综合。取值表由 bridge 的 `GET /api/filters` 从编译好的注册表读出，只含公开的能力信息，演示模式下同样放行；读不到时不置灰。换渠道或地址里带了当前平台不支持的取值时，先退回默认值再请求，地址随之改正。
- **推荐流分类与时间筛选**（设计稿 R / R2 / R3）：筛选栏按已提交的关键词换内容，两组之间交叉淡入。没有关键词时走 `feed list`，筛选栏最左是「推荐 / 热门 / 关注」分段（样式同排序分段），请求带 `--kind hot|following`（推荐是默认，不带选项），排序、类型、时间都不显示，右侧结果文字为「推荐 · 已加载 N 条」；分段只在平台已实现的 `feed list` 在注册表里声明了不止一种 `--kind` 时出现（猫眼只有 recommend、M-Team 没有声明，都不显示），声明了 `--order-by` 的平台（M-Team）浏览时仍显示字段排序那一组。只有推荐流的平台（猫眼）有关键词时同样按推荐流显示。有关键词时走 `item search`，分类分段消失，排序、类型之后是下拉 chip「时间 · <当前值>」（`TimeFilter.vue`），取值 不限 / 一天内 / 一周内 / 一月内 / 半年内 / 一年内，对应 `--time all|day|week|month|half_year|year`（不限不带选项）；不是「不限」时 chip 为红色激活态。时间筛选用公共下拉 AppSelect 的 chip 样式（`variant="chip"`，见「下拉列表」）：菜单是传送到 body 的玻璃菜单（筛选栏是横向滚动容器，放在里面会被裁掉），键盘、ARIA 与其他下拉列表相同（焦点留在 chip 上，`role="combobox"` + `listbox`；上下键移动，跳过置灰项、循环，Enter / 空格选中，Esc 收起，选中或收起后焦点回到 chip），点外面、页面滚动时收起。`/api/filters` 另外给出 `item search` 的 `--time` 取值（`time`）和已实现的 `feed list` 的 `--kind` 取值（`kind`），置灰规则与排序 / 类型相同：不支持的分类、时间置灰并用 tooltip 说明原因（如「小红书暂不支持「热门」流」「小红书不支持「一月内」」，菜单项的 tooltip 在右侧），平台对时间整个不支持时 chip 整体置灰；聚合模式下有一个选中的渠道支持就能点，不支持的渠道按默认值（推荐、不限）请求。置灰的分段、chip、菜单项在触屏上点按时弹出原因，2 秒后自动消失。手机上筛选栏一行横向滚动、左右各留 16px，右缘有 40px 渐隐，所有可点元素高 44（分段项 36），时间筛选与其他下拉列表一样改为底部弹层（选项高 52，点置灰项闪现原因）。分类和时间不进设置（没有「默认分类」「默认时间」）。演示模式不请求 `/api/filters`，用 `web/src/api/mock/filters.ts` 里与注册表一致的取值表，换分类、换时间时演示数据换一批。
- **搜索联想与热搜**：搜索框聚焦时在下方弹出玻璃面板（设计稿 `web-desgin.pen` 的 Q / Q2）：输入为空时显示热搜（`catbus <p> keyword hot [-a <账号>]`，最多 10 条，前三名红色），有输入时显示联想（`catbus <p> keyword suggest [-a <账号>] -- <前缀>`，最多 8 条，与输入相同的前缀加粗）；两者都返回 Keyword[]。只在当前平台 web 端对应命令已实现时出面板，能力由 `GET /api/filters` 的 `suggest` / `hot` 从注册表读出；只有联想没有热搜的平台，空输入时不出面板；聚合模式下用最后点选的渠道。联想在输入停下 150ms 后才请求，只采用最后一次请求的结果，同一平台同一前缀在本页会话里缓存；热搜每个平台本页会话只取一次。请求失败、风控、未登录时静默不出面板、不弹提示，并且这个平台本次会话不再自动请求（避免反复触发风控）；结果为空时也不出面板。↑ / ↓ 循环选中（与鼠标悬停共用一个高亮），Enter 用选中项搜索，没有选中项时照常提交输入框；点一项即填入并搜索；Esc、点面板外或失去焦点时关闭。输入法组合输入期间不请求，Enter 不提交。面板是 `role="listbox"`，输入框带 `aria-expanded`、`aria-controls`、`aria-activedescendant`。手机上面板撑满宽度，行高 44，没有底部按键提示。只是帮助输入，提交搜索、改地址的方式与原来相同。演示模式用 `web/src/api/mock/keyword.ts` 的演示词。
- **渠道缓存**：每个渠道（平台）在本页会话里保留最后一次的结果，像 keep-alive 一样：切回已经看过的渠道时，恢复它的排序、类型、推荐流分类、时间、关键词、已加载的卡片、翻页位置和滚动位置，不重新请求；只有地址（前进 / 后退）或浏览账号与缓存时不同才重新请求。缓存只在内存里，刷新页面即清空；请求出错时丢掉该渠道的缓存，删除账号时丢掉用它浏览的缓存。右上角「N 条 · 耗时」左侧的刷新按钮（`RefreshCw`）按当前渠道已提交的筛选和关键词重新请求，替换缓存（输入框里没提交的关键词不算）。
- **聚合模式**：侧栏渠道列表上方原来「渠道」两个字的位置是一个磨砂玻璃质感的开关（`ModeSwitch.vue`，`role="switch"`），切换「单一 / 聚合」。单一模式一次看一个渠道（上面各条说的都是它）；聚合模式同时看几个渠道，状态在 `web/src/stores/discover.ts`，格子的排列在 `web/src/stores/lanes.ts`。
  - **选渠道**：进入聚合时默认只选当前渠道，沿用它已有的结果，不重新请求。聚合模式下点侧栏的渠道是选上 / 去掉（多选），不是切换；至少留一个，只剩一个时点它无效。选中的渠道各自带底色和次序号。开关右侧的渠道数从 `13` 变成 `已选/总数`（如 `1/13`），「`1/`」从 `13` 后面向左滑出。账号卡汇总全部选中渠道的账号，账号列表上方按渠道分 Tab（见「账号切换」），勾选账号只重新请求那一个渠道。平板窄栏里没有开关（展开后才有），已经在聚合模式时点图标同样是选上 / 去掉。
  - **排列**：卡片按选中的顺序在各渠道之间轮流排（抖音、小红书、X、抖音、小红书、X……），各渠道内部的顺序不变；某个渠道的条目用完后，其余渠道接着排。每张卡片左上角显示渠道图标（由小到大弹出，依次出现；纯 CSS 动画，只在进出聚合模式、卡片新出现时播一次，重排时不重播），视频角标右移让位。
  - **新选一个渠道**：每张原有的卡片后面插入它的一张，原有的卡片各让出一格（从旧位置平滑移到新位置）。它的第一页还没回来时插入的是骨架占位（带渠道图标和加载图标，数量不超过每页条数），筛选栏下沿的进度条同时显示；数据回来后占位在原位换成卡片，高度变了时卡片自上而下展开、下面的卡片被平滑挤开。渠道缓存里正好有同一个查询的结果时直接用上，不出骨架。请求出错时占位收起、弹出提示，渠道仍保持选中（登录后重新搜索会再请求它）；选中的渠道全部出错时才整页报错，「去登录」「去验证」针对第一个出错的渠道。
  - **去掉一个渠道**：它的卡片在原位淡出，其余卡片合拢；选择里属于它的条目一并去掉。
  - **筛选与搜索**：关键词、排序、类型对选中的渠道一起生效。排序 / 类型的取值只要有一个选中的渠道支持就能点，不支持它的渠道按默认值（综合、全部）请求；选中的渠道都不支持时置灰。换筛选、重新搜索、刷新时旧卡片留在原位变淡，各渠道的新结果回来后各自原位替换；查询没变的渠道不重新请求。
  - **翻页**：滚到底时还有下一页的渠道各翻一页，全部回来后新条目按渠道轮流接在最后，已有的卡片不动。某个渠道翻页出错时它不再继续翻，已有的卡片保留。
  - **详情与下载**：详情卡片、悬停预览、上一条 / 下一条按每条自己的平台和该平台的浏览账号请求；批量下载按平台各建一批。
  - **回到单一模式**：聚合时加载好的渠道都记进渠道缓存，页面回到最后点选的渠道并回到顶部，其余渠道的卡片淡出；之后切到这些渠道直接恢复。
  - **动效**：瀑布流是一个扁平的 keyed 列表：所有格子是同级节点、绝对定位，列按估算高度分配，每列的 top 按 ResizeObserver 量到的真实高度累加，所以卡片换列、换顺序时不卸载重建，只改位置（新格子接在 DOM 末尾，已有节点不挪动）。格子换位置用 FLIP：旧位置取自上一次排版的结果，不读 DOM，用 Web Animations 从旧位置滑到新位置；只动视口附近的格子，下一次排版只取消上一次动过的那些；只在末尾追加、已有格子都没动时不做位移，只让新格子浮现。`prefers-reduced-motion` 时直接到位。
- **加载反馈**：切换到没有缓存的渠道时立即清空列表（连同翻页状态和选择）、回到顶部，显示骨架卡片，旧平台的卡片不留在新平台下；同一渠道里换排序、类型或重新搜索时保留旧结果，但整体变淡、不可点击和选择，新结果回来后淡入替换。加载期间筛选栏下沿显示品牌红的循环进度条（随筛选栏吸顶），右上角的「N 条 · 耗时」改为「加载中…」和从 0.00s 实时跳动的耗时。连续快速切换时只采用最后一次请求的结果。`prefers-reduced-motion` 时进度条不滑动、只轻微明暗变化，淡入淡出改为直接切换。页面和弹窗按需加载：发现页随首屏加载，其余的页（作者页、「我的」页、本地收藏、订阅、直播、12306 查询页等）在第一次进入时才取，取的时候内容区显示加载图标，取不到时显示「重试」；详情卡片、登录、设置、下载记录等在首屏之后空闲时预取，第一次打开时不用等，打开动画照常。
- **演示数据**：跑不起 catbus（或 URL 带 `?demo`）时用 `web/src/api/mock/` 的演示数据（按领域分文件，`index.ts` 统一导出），界面上标明「演示数据」。`catbus web --demo` 时服务端对全部 `/api/*` 返回 `BRIDGE` 错误信封，页面请求（没有扩展名的路径）不带 `?demo` 时一律 302 到带 `?demo` 的地址。使用演示数据时，标题「发现」右侧显示黄色玻璃质感的「当前状态仅供演示」标记。
- **响应式**：断点在 `web/src/composables/useBreakpoint.ts`（`BREAKPOINTS`）和 `web/src/styles/tokens.css` 里各写一份，数值相同：手机 ≤ 640px、平板 641–1024px、桌面 > 1024px。触屏另用 `(hover: none) and (pointer: coarse)` 判断，不跟宽度绑定。
  - **侧栏**：桌面上是完整侧栏；平板上收成只有平台图标的窄栏（72px），点开后完整侧栏浮在内容上面；手机上是抽屉，顶栏左侧的按钮打开，点遮罩、Esc 或左滑关闭。内容区一律按 `--content-left` 定位。
  - **发现页**：瀑布流的最小列宽随断点变小，手机上 2 列；筛选栏放不下时横向滚动，不换行；手机上搜索框单独占一行。
  - **触屏**：没有悬停，卡片的选择框一直显示，长按卡片进入选择模式（代替拖动连续选择）；悬停提示（`v-tip`）不显示；可点区域至少 44px。
  - **弹层**：登录、验证、账号切换、下载记录在手机上从底部弹出（底部弹层），软键盘弹出时输入框不被遮挡；详情和大图在手机上全屏，支持左右滑动切换、下滑关闭，大图可以双指缩放。
  - **安全区**：页面用 `viewport-fit=cover`，贴边的元素（侧栏、顶栏、回顶按钮、底部弹层）按 `env(safe-area-inset-*)` 让开刘海和 Home 指示条；高度用 `dvh`。手机上输入框字号不小于 16px，避免 iOS 聚焦时放大页面。
- **背景**：两层，都只用品牌的红和藏青。底下是两团缓慢漂移的光晕（右上角红、左下角藏青，`AmbientBlobs.vue`），给毛玻璃一点可模糊的颜色；漂移是只做平移的 CSS 动画，在合成器上跑，减少动效时停住；上面是 Canvas 画的方块像素（`PixelBackground.vue`，亮色、暗色边长都是 20px，格间留缝）。像素本身静止，按一层遮罩改变浓淡：右上角最完整，往下、往左渐隐，左下大片留空；每格再叠一点固定的随机深浅，少数格子留空。只有交互时才动，静止后不再重绘：鼠标附近的像素变亮，正中心转成红色，交互的亮度不受遮罩影响，所以在像素淡出的地方鼠标会把像素「照」出来。人浪：点击搜索、主题、下载按钮时起一浪，搜索加载中（包括换渠道、换筛选）每 1.1 秒起一浪、加载结束就停；波前约 1.5 秒从右上角斜着扫到左下角，经过的像素依次站起来（变大、变亮），每格先后略有错落，颜色从红色起、越往左下越浅；点击后紧接着开始加载只起一浪。手机 / 触屏像素加大、不跟随指针、约 30fps；`prefers-reduced-motion` 时只画静止的像素，没有跟随和人浪。
- **设置**：侧栏左上角的齿轮打开设置弹窗（`web/src/components/settings/`），状态在 Pinia store `web/src/stores/settings.ts`。弹窗左侧是分栏菜单（通用、显示、下载、实验性），右侧是该分栏的设置项，每项一行：标题、一句说明（可省略）、控件；说明只写用户需要知道的（这一项管什么、会有什么影响），不写实现和设计细节，控件本身已经说清楚的就不写说明；底部「恢复默认」要点两次才生效。Esc、点遮罩、× 关闭，焦点留在弹窗内；手机上是底部弹层，分栏菜单变成顶部的分段选择。通用：语言（见「多语言」）、启动时打开的平台（上次浏览的或固定平台）、默认排序与类型、每页条数（20 / 40 / 60）。设置项尽量少：能定下来的行为直接定死，不做开关——滚到底总是自动加载下一页，卡片总是显示作者头像和昵称，详情视频总是自动播放，退回 B 站嵌入播放器时总是开弹幕（`autoplay=1&danmaku=1`）。启动时打开的平台只在地址栏没带平台时生效：固定平台进入那个平台，「上次浏览的」进入 localStorage `catbus.lastPlatform` 记下的平台（每次切换平台时更新，没有记录时第一个平台）。默认排序与类型是地址栏没带 `sort` / `type` 时、以及切换到没有缓存的平台时的初始值（有缓存时恢复该渠道自己的筛选，见「渠道缓存」）；地址里等于默认值的参数省略，平台不支持时（`/api/filters` 置灰）回退到该平台支持的第一个值，不发出会报 `UNSUPPORTED` 的请求；改了设置不重新搜索、不改当前筛选，只按新的默认值重写地址（`replaceState`）。每页条数是搜索和翻页的 `--limit`，改了之后下一次请求生效。显示：主题、卡片密度、卡片上显示互动数据、背景动效（像素背景和人浪是一个开关）、减少动效（跟随系统 / 总是减少）。背景动效默认关闭。关闭时卸载像素画布（逐帧绘制随之停止），换成不动的静态底色（右上角一抹红、左下角藏青，叠极淡的细点纹理）。点击和加载也不起人浪，加载中途关掉时当前的人浪立即停下。减少动效取「总是减少」时等同系统开启「减少动态效果」：`prefersReducedMotion()` 返回 true，`<html>` 带 `data-motion="reduce"`，全局样式把 CSS 动画和过渡缩到接近 0，像素背景的逐帧绘制、人浪和光晕漂移立即停下；「跟随系统」时随媒体查询实时变化。卡片密度改的是瀑布流的最小列宽和间距（桌面上紧凑 190px / 12px、标准 240px / 16px、宽松 300px / 20px，平板、手机按比例缩小，手机标准档仍是 2 列），切换时卡片从旧位置平滑移到新列（FLIP，减少动效时直接到位）。关掉互动数据时卡片底部只留作者。下载：评论下载条数（5 / 10 / 20 / 50 / 100 / 1000 / 全部，默认 10）、子评论下载条数（每条评论的楼中楼，3 / 10 / 20 / 50 / 100 / 全部，默认 3），都用 AppSelect；评论条数超过 100（1000、全部）时下方出现红色的风险提示：评论取得越多请求越多，容易触发平台风控或要求账号验证。这两项是下载面板勾选评论时 `--comments` / `--replies` 的取值（见「批量选择与下载」）；下载面板上次的选择也存在设置里，但不在设置弹窗里显示。实验性：详情卡显示原始 JSON（`--raw`）、悬停视频卡片时静音预览，以及服务端设置（代理，见「服务端设置」，不存 localStorage）。打开原始 JSON 时详情卡标题栏多一个 `{}` 按钮，点一下在信息栏里切换到原始 JSON 视图（再点回到详情），第一次切过去时才请求 `catbus <p> item get [-a <账号>] --raw -- <item>`，换一条时复位；视图用等宽字体，对象和数组可折叠（默认展开两层，可全部展开 / 全部折叠），「复制」复制格式化后的整段 JSON；原始对象里可能有带签名的链接，不写日志、不打印到控制台；演示模式下用演示条目拼一个平台风格的对象；关掉设置时按钮消失、立即回到详情。悬停预览只在能悬停的鼠标上生效：在视频卡片上停留约 400ms 后取视频地址——条目 `media` 里有直链就直接用，没有时（如小红书的搜索结果）请求一次 `catbus <p> item get [-a <账号>] -- <item>`，结果按平台 + 条目缓存（取不到也缓存，不重试），取地址期间封面上扫过一道柔光；拿到后一个传送到 body 的浮层从封面的位置和大小出发，读到视频尺寸后用约 0.8 秒平滑长成视频的比例（面积约为封面的 1.5 倍，以封面中心为中心，限制在内容区和视口内，不盖住侧栏、不推挤别的卡片），同时静音循环播放（按平台经 `/api/media` 转发），开始播放后视频淡入；鼠标离开卡片和浮层时浮层缩回封面再卸载，清空 `src` 释放连接；页面滚动、窗口缩放时直接收掉；点浮层等于点卡片；同一时间只播一张；B 站没有直链：请求 `catbus bilibili item media [-a <账号>] --all-tracks --raw -- <item>`（缓存规则同上），取浏览器能解的 480P 及以下最高的一档视频轨（都比 480P 高时取最低一档，不取音频），经媒体代理用 MSE 播（与详情卡片同一套，`web/src/composables/dash.ts`），播放出错时丢掉缓存的轨道（地址带时效），下次悬停重新取；不是视频的、以及只能用嵌入播放器的 YouTube 不预览；减少动效时不做长大和收回的动画。除服务端设置外，这些设置只存在浏览器的 localStorage，键 `catbus.settings`，内容是 `{version: 2, ...各项}`（版本 1 存下的像素背景开关是旧默认值，读取时丢掉；已经去掉的设置项读取时忽略）；读取时与默认值合并，不认识或不合法的值回到默认值，写不进去（隐私模式）时只在本次会话里生效。主题取 `light` / `dark` / `system`：`system` 跟随系统的 `prefers-color-scheme`，系统切换时实时变化；`<html data-theme>` 始终是实际生效的 `light` / `dark`，`index.html` 的内联脚本在首帧前按同样的规则定好主题，避免闪烁。顶栏的主题按钮在亮色、暗色之间切换实际主题（跟随系统时点一下就改成固定值）。旧版本的主题键 `catbus.theme` 第一次读取时迁移进 `catbus.settings`，然后删除。
- **多语言**：界面文字支持简体中文（`zh-CN`，源语言）、英语（`en`）、日语（`ja`）、韩语（`ko`），用 vue-i18n（Composition API，`useI18n()`）加 `@intlify/unplugin-vue-i18n`（构建时预编译文案，运行时不编译、不用 `eval`）。
  - **文案文件**：`web/src/locales/<语言>/<命名空间>.json`，key 为 `<命名空间>.<key>`（文件名就是命名空间，如 `login.json` 里的 `qrcode.title` 用 `t('login.qrcode.title')`）。`zh-CN` 是源语言，随页面一起加载，也是缺 key 时的回退；其他语言切过去时才按需加载。插值用具名占位（`{n}`、`{name}`）；带数量的文案一律写成 `t(key, { n }, n)`，译文可以用 `|` 分出单复数（中文只写一支）；各语言的 key 与占位必须和 `zh-CN` 一致，由 `npm run i18n:check`（`web/scripts/i18n-check.mjs`）检查：缺 key、多余 key、占位不一致、空译文、代码里用到却不存在的 key 都报错；加 `--hardcoded` 时另外列出代码里残留的中文（注释、`// i18n-ignore` 行和演示数据除外）。
  - **写法**：组件里用 `const { t } = useI18n()`；组件外（store、composable、`data/`）用 `web/src/i18n` 导出的 `t`，只能在函数里调用，不能在模块顶层求值，常量里只放 key（如 `{ value: 'latest', labelKey: 'filters.sort.latest' }`），渲染时再 `t()`，这样切换语言时立即生效、不用刷新。日期、数字、相对时间用 `Intl`（`web/src/composables/format.ts`）并带当前语言，不写死 `'zh-CN'` / `'en-US'`。
  - **不翻译的**：平台内容（标题、正文、评论、作者名、种子名、演出 `text` 里的「键：值」）、平台表情码、演示数据的内容。CLI 信封里的 `error.message` / `hint` 是 CLI 生成的中文：页面按 `error.code` 显示自己的译文，原文只在详情里给出。平台名按平台 id 取译名（`platforms.<id>.name`）。例外有两处，按固定的键换成译名、不认识的原样显示：12306 的席别名（CLI 输出的键是中文席别名，如「商务座」，按 `rail.seat.name.*` 换）和猫眼的默认城市（不带 `--city` 时的「北京」，按 `maoyan.city.default` 换；其他城市名和城市搜索结果仍是平台数据）。
  - **选择语言**：设置弹窗「通用」的第一项「语言」：自动（默认）或固定一种语言，存在 `catbus.settings` 的 `locale`（`system` 或语言代码）。自动时按顺序匹配：浏览器语言（`navigator.languages`，逐个取，主语言相同即算匹配，`zh-*` 都归到 `zh-CN`）→ 浏览器时区（`Intl.DateTimeFormat().resolvedOptions().timeZone`：中国大陆、香港、澳门、台湾的时区 → `zh-CN`，`Asia/Tokyo` → `ja`，`Asia/Seoul` / `Asia/Pyongyang` → `ko`）→ 都不匹配时用英语。自动时浏览器语言变化（`languagechange`）实时生效。切换语言不刷新页面，`<html lang>` 随之改变（CJK 字形按它选字体）。挂载前先加载好当前语言的文案，避免先闪一下中文。
- **吉祥物**：侧栏顶部的车掌小姐头像是关键帧动画（`MascotAvatar.vue`）。帧在一张图集里（`web/src/assets/mascot/anim/atlas.webp`，清单 `web/src/data/mascot-anim.json`），首屏只加载中立帧 `neutral.webp`，图集在空闲时加载，没到之前点击只有回弹。每个动作分「入 → 循环 → 出」，入的第一帧和出的最后一帧都是中立姿势，所以动作之间直接衔接；切帧时叠一个挤压回弹（Web Animations），探身的位移和爱心、蒸汽粒子由 GSAP 做，图里不画特效；空闲时的呼吸漂浮是 CSS 动画，眨眼的回弹也不经 GSAP，动作结束后不留常驻的补间，空闲时主线程不逐帧写样式。空闲时每 2.4–5.6 秒眨眼，偶尔猫抖耳朵；鼠标在头像附近时眼睛看向鼠标（左 / 右 / 上）。点头顶（或按住来回蹭）是摸头，点脸是戳脸（左右各一帧，愣一下），8 秒内再戳或连点 4 次以上会害羞捂脸，点身体直接害羞，点肩上的小黑猫它会躲进挎包再回来。5 秒内连点 8 次会生气：鼓腮扭头不理人，期间再点没有反应，几秒后偷看一眼、笑出来恢复。3 分钟没有鼠标和键盘操作时打瞌睡（闭眼点头），鼠标移到头像上或点到她时惊醒。空闲 45–90 秒随机探身张望一次：裁剪圆从圆环内圈向上长大，上半身越过圆环，下半身仍被圆环下沿挡住，扒着圆环的手单独一层盖在圆环上面（层级做出的裸眼 3D）；点击或鼠标悬停时不探身，探身中点击会缩回。缩回时整个人先沉到圆环下沿后面、裁剪圆同步收回（帽子不会被收拢的圆切到），藏住之后换回中立帧再从下面冒回原位。平板窄栏的小头像（小于 80px）只眨眼，不响应点击。减少动效时不漂浮、不探身、不出粒子，点击只换一下表情。帧的出图方法见 `scripts/assets/mascot.md`。
- **下拉列表**：一律用公共组件 `web/src/components/AppSelect.vue`（设计稿 U、U2、U3），不用原生 `<select>`。桌面和平板上是玻璃胶囊触发器加传送到 body 的玻璃菜单（与时间筛选同一套样式）：菜单与触发器左对齐、宽度不小于触发器，下方放不下时向上弹出；超过 8 项时最高 340、内部滚动，上下有内容时对应的边渐隐；选项可带平台 logo 或图标，可以用分隔线分组；置灰项（`disabled` 为原因）悬停用 tooltip 说明。键盘照 APG 的 select-only combobox：焦点一直在触发器上（`role="combobox"`，菜单 `role="listbox"`），↓ / ↑ / Enter / 空格打开，↑ ↓ 循环（跳过置灰项）、Home / End、Enter / 空格选中、Tab 收起，打字跳到首字母匹配的项。Esc 只收菜单：外层 BottomSheet 看到 `[data-esc-layer]` 时不关自己。筛选栏里的下拉用 chip 样式（`variant="chip"`）：宽度随文字、高 32（手机 44），`active` 时为红色激活态，插槽 `value` 自定义触发器上的文字；`disabled` 可以给原因字符串，悬停用 tooltip 说明、触屏点按时闪现。手机上不弹浮层菜单，改为底部弹层（BottomSheet，标题和说明取设置项），选项高 52，点选即生效；触发器高 44、字号 16。
- **设计**：配色沿用第 1.1 节（藏青 `#232838`、红 `#E8414F`），吉祥物头像在 `web/src/assets/mascot/`；平台图标直接引用 `scripts/assets/logos/`。

## 8. 开发约定

- **语言**：与用户沟通用中文；面向用户的文字用中文（WebUI 界面多语言，见 7.9「多语言」）；代码标识符用英文。
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
