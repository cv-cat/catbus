<p align="center">
  <img src="assets/logo.svg" width="160" alt="catbus logo">
</p>

<h1 align="center">catbus（猫巴士）</h1>

<p align="center"><b>上车，开往任何平台</b></p>

<p align="center">
  一个命令操作小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。<br>
  同一套命令、同一种 JSON 输出，给人用，也给 AI Agent 用。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A6E3A1" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%5E22.22.2%20%7C%20%5E24.15.0%20%7C%20%3E%3D26-339933?logo=nodedotjs&logoColor=white" alt="Node ^22.22.2 | ^24.15.0 | >=26">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/platforms-10-F38BA8" alt="10 platforms">
</p>

<p align="center">
  简体中文 · <a href="./README.en.md">English</a>
</p>

---

catbus 的能力来自作者 [cv-cat](https://github.com/cv-cat) 的 10 个开源项目，全部用 TypeScript 重写：运行时不调用 Python，装好 Node 就能用。10 个平台的 web 端都已移植，app / pc 端在规划中。

```bash
catbus bilibili item get BV1xx411c7mD
catbus xhs item search 露营 --sort latest --limit 50
catbus douyin comment list <item> --limit 100 -o jsonl
catbus x user get elonmusk
```

## 目录

- [亮点](#亮点)
- [支持的平台](#支持的平台)
- [快速开始](#快速开始)
- [命令速览](#命令速览)
- [输出与退出码](#输出与退出码)
- [账号与配置](#账号与配置)
- [给 AI Agent 用](#给-ai-agent-用)
- [已知限制](#已知限制)
- [项目结构与开发](#项目结构与开发)
- [路线图](#路线图)
- [文档索引](#文档索引)
- [致谢](#致谢)
- [免责声明](#免责声明)
- [License](#license)

## 亮点

- **同义同名**：笔记、作品、稿件、推文、商品一律叫 `item`，搜索一律叫 `search`，点赞一律叫 `like`。含义相同的能力在所有平台上用同一个命令、同一组参数、同一种输出结构，换平台只需要换平台 id。
- **10 个平台**：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。覆盖搜索、详情、评论、推荐流、下载、发布、私信、直播弹幕等，每个平台支持哪些命令见 [能力矩阵](docs/capabilities.md)。
- **统一的 JSON 输出**：stdout 只输出 JSON 信封，`Item`、`User`、`Comment`、`Live` 等归一化类型跨平台字段一致；列表命令可以用 `-o jsonl` 逐行输出；需要平台原始字段时加 `--raw`。
- **只需要 Node**：不需要 Python、C/C++ 编译器或其他系统依赖。原生依赖都带预编译包，支持 Windows、macOS、Linux（x64 / arm64，Linux 含 glibc 与 musl）。
- **登录态留在本机**：凭证按 平台 × 端 × 账号 隔离保存在 `~/.catbus/`（目录 0700、文件 0600），支持多账号切换。catbus 不收集、不上传任何数据，没有遥测。
- **与上游行为一致**：请求构造和签名用对拍测试核对：在固定的随机数和时钟下运行上游 Python 生成请求，再逐字节比对 TS 实现产出的 URL、header 顺序、cookie 和 body。
- **为 Agent 设计**：退出码稳定，错误里带 `hint`（下一步该执行的命令），`catbus platforms` 输出完整的能力清单，适合被脚本和 AI Agent 调用。

## 支持的平台

| 平台 | id | 别名 | `item` 是 | 登录方式（**粗体**为默认） | 上游仓库 |
|---|---|---|---|---|---|
| 小红书 | `xhs` | `xiaohongshu` `rednote` | 笔记 | **扫码** · 短信 · cookie；创作者中心自动换取 | [Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| 抖音 | `douyin` | `dy` | 作品 | **扫码** · 短信 · cookie | [DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| TikTok | `tiktok` | `tt` | 视频 | **cookie** | [TiktokApis](https://github.com/cv-cat/TiktokApis) |
| B 站 | `bilibili` | `bili` `b` | 稿件 | **扫码** · 短信 · 密码 · cookie | [BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| 快手 | `kuaishou` | `ks` | 作品 | **扫码** · 短信 · cookie | [KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| 微博 | `weibo` | `wb` | 微博 | **cookie** | [WeiboApis](https://github.com/cv-cat/WeiboApis) |
| 闲鱼 | `xianyu` | `goofish` `xy` | 闲置商品 | **扫码** · cookie | [XianYuApis](https://github.com/cv-cat/XianYuApis) |
| 淘宝 | `taobao` | `tb` | 商品 | **cookie** | [TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| 京东 | `jd` | `jingdong` | 商品 SKU | **扫码** · 短信 · cookie | [JdApis](https://github.com/cv-cat/JdApis) |
| X | `x` | `twitter` | 推文 | **cookie** | [XApis](https://github.com/cv-cat/XApis) |

- 命令、目录名、配置键和输出里的 `platform` 字段都用 id；别名只在命令行里可用。
- 每个平台各有一些扩展命令，例如 B 站的投币、三连、弹幕、动态、专栏，京东的订单、购物车、优惠券，X 的长文。完整列表见 [能力矩阵](docs/capabilities.md) 或 `catbus platforms <platform>`。
- 矩阵里标 ○ 的是规划中的能力，执行时返回 `NOT_IMPLEMENTED`（退出码 4）。

## 快速开始

### 1. 安装

需要 Node `^22.22.2 || ^24.15.0 || >=26.0.0`。

**从源码安装（现在）**

```bash
git clone https://github.com/cv-cat/catbus.git
cd catbus
npm ci
npm run assets:jd     # 取回京东验证码模型（约 81 MB）
npm run assets:ocr    # 取回验证码 OCR 模型（约 34 MB，B 站极验点选用）
npm run build
npm link              # 把 catbus 命令链接到全局
```

**从 npm 安装（即将发布）**

```bash
npm i -g catbus-cli
```

npm 包发布后，模型随依赖 `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` 一起安装，运行时不再下载任何东西。

### 2. 检查环境

```bash
catbus doctor
```

逐项检查 Node 版本、HTTP 库、canvas、onnx、验证码模型、`~/.catbus` 权限和签名 vm。全部通过时 `ok` 为 true；有检查项不通过时退出码为 1，`data` 里是完整的检查结果。

### 3. 登录

web 端不登录几乎看不到内容，所以除 `auth` 外的命令都需要先登录；未登录时报 `AUTH_REQUIRED`（退出码 3），`hint` 里给出登录命令。

**扫码**（xhs、douyin、bilibili、kuaishou、xianyu、jd 默认）：二维码画在终端（stderr）里，同时把 PNG 存到 `~/.catbus/cache/<platform>/`，用 App 扫码确认即可。小红书扫码目前会被人机验证拦下（见 [已知限制](#已知限制)），请直接用 cookie 导入。

```bash
catbus bilibili auth login
catbus douyin auth login -a work        # 登录到名为 work 的账号
```

**导入 cookie**（tiktok、weibo、taobao、x 只支持这种方式；其他平台加 `--method cookie`）：

1. 在浏览器里登录对应网站；
2. 打开 DevTools → Network（网络），刷新页面，点开任意一个发往该站点的请求；
3. 复制 Request Headers 里完整的 `Cookie` 值。

不要用 Console 里的 `document.cookie`：它拿不到 HttpOnly 的 cookie，而登录态的关键 cookie（例如小红书的 `web_session`）正是 HttpOnly 的。

```bash
catbus x auth login --cookie "auth_token=...; ct0=...; ..."
catbus weibo auth login --cookie @weibo-cookie.txt        # 从文件读取
pbpaste | catbus taobao auth login --cookie -             # 从 stdin 读取（macOS 剪贴板）
catbus xhs auth login --method cookie --cookie "a1=...; web_session=...; ..."
```

`--cookie` 也接受浏览器导出的 cookie JSON 数组；douyin、tiktok 另外接受一个 JSON 对象，把 ticket、证书、私钥等设备数据一并导入（这两个平台的写操作需要它们）。导入后 catbus 会在线校验一次。短信、密码登录见 `catbus <platform> auth login --help`。

确认登录状态：

```bash
catbus bilibili auth status
```

### 4. 第一条命令

```bash
catbus bilibili item get BV1xx411c7mD
catbus bilibili item search 猫 --sort views --limit 20
catbus bilibili user items me --all -o jsonl > my-videos.jsonl
```

## 命令速览

### 语法

```text
catbus <platform> <resource> <action> [参数...] [选项...]
```

- 选项可以出现在任意位置；`--` 之后的内容一律按参数处理（用于以 `-` 开头的文本）。
- 参数接受 ID、URL（包括分享短链）、平台上的自然标识（B 站 BV 号、X 用户名），用户参数还可以是 `me`。所有输出对象都带 `id` 和 `url`，可以直接作为下一条命令的参数。小红书的 `url` 带 `xsec_token`，优先传 URL。
- 端用 `-e web|app|pc` 指定，默认 `web`。app / pc 端目前都是规划中：`catbus xianyu item get <id> -e app` 返回 `NOT_IMPLEMENTED`。
- 帮助分四层：`catbus --help`、`catbus xhs --help`、`catbus xhs item --help`、`catbus xhs item get --help`。

### resource

| resource | 含义 | 常用 action |
|---|---|---|
| `auth` | 登录态 | `login` `status` `logout` `list` `use` |
| `user` | 用户 | `get` `search` `items` `likes` `collects` `followers` `following` `follow` |
| `item` | 平台的主内容单元 | `get` `search` `related` `list` `media` `download` `like` `collect` `repost` `publish` `delete` |
| `product` | 内容平台里挂的商品 | `get` |
| `comment` | 评论，也包括商品评价 | `list` `replies` `add` `delete` `like` |
| `feed` | 推荐 / 热门 / 关注流 | `list` `categories` |
| `live` | 直播 | `get` `list` `search` `listen` `history` `send` `gifts` `products` `media` `start` `stop` |
| `keyword` | 搜索词 | `suggest` `hot` |
| `notice` | 通知 | `list` `count` |
| `msg` | 私信 / IM / 客服 | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `media` | 媒体上传 | `upload` |
| `folder` | 收藏夹 | `list` `items` `create` `update` `delete` |
| `series` | 合集 / 播放列表 | `list` `items` |
| `history` / `topic` / `poi` | 浏览历史 / 话题 / 地点 | `list` / `search` / `search` |

完整词表和各动作的语义见 [AGENTS.md 4.4–4.5](AGENTS.md#44-动作语义)。

### 同一个命令，不同的平台

```bash
# 搜索：同一组筛选选项（--sort / --type / --time），平台不支持的取值报 UNSUPPORTED
catbus xhs item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus douyin item search 露营 --type video --sort latest
catbus x item search camping --sort latest
catbus jd item search 机械键盘 --sort sales

# 用户和他发布的内容
catbus x user get elonmusk
catbus xhs user items "<主页 URL>" --limit 100
catbus bilibili user items me --sort views

# 评论
catbus douyin comment list "<作品 URL>" --limit 100
catbus bilibili comment list BV1xx411c7mD --sort latest

# 下载媒体：文件名为 <platform>_<id>_<序号>.<ext>
catbus xhs item download "<笔记 URL>" --dir ./downloads

# 直播弹幕：持续输出 jsonl，Ctrl-C 或 --duration 到期退出
catbus bilibili live listen <room> --duration 10m

# 私信 / 联系卖家
catbus xianyu msg send "还在吗" --item "<商品 URL>"
catbus jd msg send "请问什么时候发货" --order <订单号>

# 发布：本地文件自动上传
catbus xhs item publish --title 周末露营 --text @note.md --image 1.jpg --image 2.jpg --visibility private
catbus x item publish --text "hello from catbus" --image cat.png
```

更多约定：

- 用了平台原生叫法会报 `UNSUPPORTED` 并提示规范词，例如 `catbus xhs note get <id>` 的 `hint` 是 `用规范词：catbus xhs item get`。
- 删除、撤回、B 站投币 / 三连、直播送礼属于危险操作：终端里会询问 y/N，非交互环境必须加 `-y`，否则报 `CONFIRM_REQUIRED`。
- 分页：默认只取一页；`--limit N` 自动翻页取满 N 条，`--all` 翻到底，`--cursor <c>` 从上次返回的 `page.cursor` 继续。

## 输出与退出码

stdout 只输出结果；日志、提示、进度、二维码一律写到 stderr。下面是 `item get` 的信封（字段值为示意）：

```json
{
  "ok": true,
  "platform": "bilibili",
  "endpoint": "web",
  "resource": "item",
  "action": "get",
  "account": "default",
  "data": {
    "id": "BV1xx411c7mD",
    "kind": "video",
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "title": "示例稿件",
    "text": "稿件简介",
    "author": { "id": "123456", "name": "示例 UP 主", "url": "https://space.bilibili.com/123456" },
    "created_at": "2025-10-04T14:17:54+08:00",
    "cover": "https://i0.hdslb.com/bfs/archive/example.jpg",
    "media": [],
    "stats": { "views": 12000, "likes": 800, "comments": 56, "collects": 120, "shares": 30 },
    "price": null,
    "status": null
  },
  "page": null,
  "error": null
}
```

出错时 `ok` 为 false、`data` 为 null：

```json
{"ok":false,"platform":"bilibili","endpoint":"web","resource":"item","action":"get","account":null,"data":null,"page":null,"error":{"code":"AUTH_REQUIRED","message":"item get 需要登录","hint":"catbus bilibili auth login","detail":null}}
```

- **`-o json`**（默认）：恰好输出一个信封；stdout 是终端时缩进，否则是紧凑的一行。
- **`-o jsonl`**：每行一个 `data` 条目，适合管道；结束时在 stderr 写一行摘要信封（带 `page` 和 `error`）。
- **`--raw`**：用平台原始对象代替归一化对象，信封不变。
- 规则：ID 一律是字符串；计数是整数（"1.2万" → 12000）；时间是带时区的 ISO 8601；字段总是存在，缺失时为 `null` 或 `[]`。

```bash
catbus bilibili item search 猫 -o jsonl | jq -r '.url'
```

| 退出码 | code | 含义 |
|---|---|---|
| 0 | — | 成功 |
| 1 | `ERROR` | 未分类错误 |
| 2 | `USAGE` / `UNSUPPORTED` / `CONFIRM_REQUIRED` | 参数错误 / 平台或端不支持该命令 / 危险操作未确认 |
| 3 | `AUTH_REQUIRED` / `AUTH_EXPIRED` | 未登录或登录态失效 |
| 4 | `NOT_IMPLEMENTED` | 规划中的端或能力 |
| 5 | `RISK_CONTROL` | 验证码或风控，`detail.kind` 为 `captcha` / `rate_limit` / `blocked` |
| 6 | `NETWORK` | 网络 / 代理错误 |
| 7 | `UPSTREAM` | 平台返回业务错误，原始错误码在 `detail` 里 |

全部归一化类型和每个命令的输出见 [AGENTS.md 第 6 节](AGENTS.md#6-输出)。

## 账号与配置

### 多账号

```bash
catbus xhs auth login -a work     # 登录到 work 账号
catbus xhs auth list              # 本平台的账号
catbus xhs auth use work          # 设为当前账号
catbus xhs item search 咖啡 -a work  # 单次指定账号
catbus xhs auth logout -a work    # 删除本地凭证（B 站、快手同时在服务端登出）
catbus auth list                  # 所有平台、所有端的账号
```

身份选择的优先级：`-a <name>` > 当前账号 > 未登录（web 端报 `AUTH_REQUIRED`）。账号名匹配 `[a-z0-9][a-z0-9_-]{0,31}`。

### 数据目录

```text
~/.catbus/                     # 可用 CATBUS_HOME 覆盖
├── config.toml
├── auth/<platform>/<endpoint>/
│   ├── <account>.json         # 一个账号一个文件
│   └── _current               # 当前账号名
└── cache/<platform>/          # 二维码 PNG 等，可随时删除
```

- 目录 0700、文件 0600（Windows 依赖用户目录的 ACL），所有写入都是原子的。
- 平台自动刷新的 token 和响应里的 Set-Cookie 会合并回凭证文件。
- `-v` 输出的调试日志会对 cookie、token、Authorization 等打码。

### 代理与超时

```bash
catbus config set proxy http://127.0.0.1:7890        # 全局代理
catbus config set xhs.proxy socks5://127.0.0.1:1080  # 平台代理
catbus config set timeout 60                         # 单次请求超时（秒），默认 30
catbus config list
catbus bilibili item get BV1xx411c7mD --proxy http://127.0.0.1:8080   # 单次代理
```

优先级：`--proxy` > `<platform>.proxy` > `proxy`。catbus **不读取** `HTTP(S)_PROXY` 环境变量和系统代理，代理只能显式配置。

## 给 AI Agent 用

catbus 从一开始就按「被程序调用」来设计：

- **stdout 只有 JSON**：成功和失败都是同一种信封，不用解析人类可读的文字；帮助是唯一的例外。
- **稳定的退出码和错误码**：按退出码分支即可，`error.hint` 给出下一步该执行的命令（例如登录命令）。
- **自描述**：`catbus platforms [platform]` 输出每个平台、每个端的全部命令，以及登录要求、实现状态和上游支持程度；`--help` 的内容由同一份注册表生成。
- **非交互友好**：`--cookie -` 从 stdin 读取，非 TTY 下危险操作用 `-y` 显式确认，`-q` 关掉提示，长连接命令输出 jsonl。

```bash
# 列出抖音 web 端已实现的命令
catbus platforms douyin | jq -r '.data.commands[] | select(.status == "implemented") | "\(.resource) \(.action)"'
```

给 Agent 的使用说明见 [skills/catbus/SKILL.md](skills/catbus/SKILL.md)，项目概要见 [llms.txt](llms.txt)。MCP 模式在 M4 规划中。

## 已知限制

各平台的真机验证进度不一（X 还没开始，闲鱼、淘宝只验证了少数命令），平台风控和上游能力也决定了一些命令还不能用，或者结果不完整。详细记录和各平台进度见 [docs/trouble.md](docs/trouble.md)，主要有：

- **抖音**：发布、点赞、评论、私信等写操作受平台的设备风控（dtrait）限制：发布目前报 `RISK_CONTROL`，其余写操作还没有验证通过；只读命令正常。
- **小红书**：扫码登录在手机确认后会被要求人机验证（HTTP 471），目前过不了，请改用 cookie 导入；评论接口偶尔要求人机验证（HTTP 461），几十秒到几分钟后自行恢复。
- **TikTok**：只导入 Cookie 字符串时，点赞、收藏、评论、发布、私信等写操作需要浏览器会话数据，catbus 会在本地拦下并提示导入方式。
- **B 站**：`danmaku list` 目前只能取到前 2 分钟的弹幕、超过 6 分钟的视频会报错（上游 bug，待修复）；`item delete` 需要人机验证，暂报 `RISK_CONTROL`。
- **快手**：连续请求可能触发滑块验证，catbus 会自动尝试一次，不保证通过，没过时报 `RISK_CONTROL`。
- **京东**：风控较严，真机验证时测试账号被封过；请控制调用频率。
- **X** 还没有做真机验证；其他平台也有不少写操作（私信、直播发言、投稿等）还没有真机验证。
- 部分归一化字段平台接口本身不返回，恒为 `null`（例如抖音作品没有标题、小红书热搜没有热度值）。

## 项目结构与开发

```text
catbus/
├── src/
│   ├── cli/              # 入口、argv 解析、帮助、信封输出、确认
│   ├── core/             # 注册表、auth store、config、http、签名 vm、日志
│   └── platforms/<p>/    # 平台声明 index.ts、上游基线 UPSTREAM、web/ 实现
├── static/<p>/           # 上游签名 JS 等，原样复制
├── packages/             # @cv-cat/catbus-assets-jd、@cv-cat/catbus-assets-ocr（模型）
├── scripts/golden/<p>/   # 调用上游 Python 生成对拍数据
├── tests/                # vitest；golden/<p>/ 是对拍数据
└── docs/                 # 能力矩阵、上游对照、真机问题
```

完整的目录说明见 [AGENTS.md 7.7](AGENTS.md#77-目录结构)。

```bash
npm ci
npm run assets:jd && npm run assets:ocr   # 京东、B 站极验的测试要加载模型
npm run typecheck
npm test                    # 离线测试，默认禁止联网
npm run test:e2e            # 在线只读测试，用本机 ~/.catbus 里的登录态，不在 CI 里跑
npm run gen:capabilities    # 改了注册表后重新生成 docs/capabilities.md
```

新增或修改命令先改 [AGENTS.md](AGENTS.md)（它就是 catbus 的规范），再改代码；移植平台照 `src/platforms/bilibili/web/` 的结构写，并补对拍测试。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，测试说明见 [TESTING.md](TESTING.md)。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 定名、定规范、定技术方案 | ✅ 完成 |
| M1 | 骨架：CLI、注册表、信封、auth store、依赖选型、对拍框架、发布流程 | ✅ 完成 |
| M2 | bilibili、xhs 的 web 端：上游已有的能力全部移植并通过对拍 | ✅ 完成 |
| M3 | 其余 8 个平台的 web 端 | ✅ 完成 |
| — | 首次发布到 npm（`catbus-cli`） | 即将进行 |
| M4 | MCP 模式、`table` 输出、shell 补全、external provider（Go / Java 等非 JS 上游）、app / pc 端 | 规划中 |

## 文档索引

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 项目规范：命令、登录态、输出、架构、开发约定 |
| [docs/guide/](docs/README.md) | 用户指南：快速上手、登录、输出、配置、常见问题 |
| [docs/platforms/](docs/platforms/README.md) | 各平台说明：登录、命令、私有选项、示例、已知限制 |
| [examples/](examples/README.md) | 示例脚本：跨平台搜索、导出评论、备份作品、录直播弹幕、Node 封装 |
| [docs/capabilities.md](docs/capabilities.md) | 能力矩阵（由注册表生成） |
| [docs/upstream-map.md](docs/upstream-map.md) | 上游移植对照：鉴权、签名、Python → TS 替换 |
| [docs/trouble.md](docs/trouble.md) | 真机验证中未解决的问题和各平台进度 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |
| [TESTING.md](TESTING.md) | 测试：离线测试、对拍、在线测试、冒烟测试 |
| [SECURITY.md](SECURITY.md) | 安全问题的报告方式 |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录 |
| [skills/catbus/SKILL.md](skills/catbus/SKILL.md) | 给 AI Agent 的使用说明 |
| [llms.txt](llms.txt) | 给 LLM 的项目概要 |

## 致谢

catbus 的平台能力全部来自 [cv-cat](https://github.com/cv-cat) 的开源项目：

| 平台 | 上游仓库 |
|---|---|
| 小红书 | [cv-cat/Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| 抖音 | [cv-cat/DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| TikTok | [cv-cat/TiktokApis](https://github.com/cv-cat/TiktokApis) |
| B 站 | [cv-cat/BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| 快手 | [cv-cat/KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| 微博 | [cv-cat/WeiboApis](https://github.com/cv-cat/WeiboApis) |
| 闲鱼 | [cv-cat/XianYuApis](https://github.com/cv-cat/XianYuApis) |
| 淘宝 | [cv-cat/TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| 京东 | [cv-cat/JdApis](https://github.com/cv-cat/JdApis) |
| X | [cv-cat/XApis](https://github.com/cv-cat/XApis) |

也感谢 catbus 依赖的开源项目，特别是 [wreq-js](https://www.npmjs.com/package/wreq-js)（浏览器指纹 HTTP）、[ddddocr](https://github.com/sml2h3/ddddocr)（验证码 OCR 模型）、[onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)、[jsdom](https://github.com/jsdom/jsdom)、[protobuf.js](https://github.com/protobufjs/protobuf.js)；logo 配色取自 [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha。

## 免责声明

- 本项目仅供学习和研究使用，请勿用于商业用途或任何违法用途。
- 使用时请遵守各平台的用户协议和服务条款，以及你所在地的法律法规；不要用它采集、传播他人的隐私数据，不要对平台造成过大的请求压力。
- 自动化操作可能触发平台风控，导致验证码、限流乃至账号被封禁。由使用本项目产生的一切后果（包括账号、数据和法律风险）由使用者自行承担，作者不承担任何责任。
- 本项目与上述任何平台都没有关联，也未获得其授权或认可。各平台名称和商标归其所有者所有。

## License

[MIT](LICENSE) © 2026 cv-cat

`@cv-cat/catbus-assets-ocr` 中的模型来自 [ddddocr](https://github.com/sml2h3/ddddocr) 1.6.1，同样以 MIT 许可证发布，原许可证随包附带。
