# 更新日志

本项目的所有重要变更都记录在这里。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 未发布

首个版本：10 个平台（小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X）的 web 端全部用 TypeScript 移植完成（M0–M3）。npm 包 `catbus-cli` 即将发布。各平台支持哪些命令见 [能力矩阵](docs/capabilities.md)，真机验证中已知的限制见 [docs/trouble.md](docs/trouble.md)。

### M0：定名与规范

#### Added

- 定名 catbus（猫巴士），命令 `catbus`，npm 主包 `catbus-cli`，模型包放在 `@cv-cat` scope 下。
- 规范 [AGENTS.md](AGENTS.md)：统一的命令语法 `catbus <platform> <resource> <action>`、通用词表与「同义同名」、端（`-e web|app|pc`）、登录态、JSON 信封与归一化类型、退出码、架构与开发约定。
- Logo：`assets/logo.svg`、`assets/logo-wordmark.svg`、终端字符画 `assets/banner.txt`。

### M1：骨架

#### Added

- TypeScript（strict、ESM）工程，`tsc` 编译到 `dist/`。
- CLI：argv 解析（`node:util` 的 `parseArgs` 加注册表）、四层中文帮助、JSON 信封与 `-o json|jsonl`、退出码 0–7、危险操作确认（TTY 询问，非 TTY 需要 `-y`）。
- 能力注册表：通用词表加 10 个平台的 web 端声明，app / pc 端占位（`NOT_IMPLEMENTED`，退出码 4）；平台原生叫法报 `UNSUPPORTED` 并提示规范词。
- 登录态存储：按 平台 × 端 × 账号 隔离，目录 0700、文件 0600，原子写入；`auth list` / `use` / `logout` 由 core 实现。
- 全局命令：`platforms`、`doctor`、`auth list`、`config get|set|unset|list`、`version`。
- 配置 `config.toml`：`proxy`、`timeout`、`<platform>.proxy`；代理只能显式配置，不读 `HTTP(S)_PROXY`。
- core：基于 wreq-js 的 HTTP 会话（浏览器 TLS / HTTP2 指纹）、签名 JS 的 `node:vm` 执行环境、给凭证打码的 stderr logger。
- `docs/capabilities.md` 由注册表生成（`npm run gen:capabilities`），测试检查它是否最新。
- `@cv-cat/catbus-assets-jd`：京东验证码模型包，模型不进 git，打包时取回并校验 sha256。
- CI：3 个系统 × Node 22 / 24 / 26 跑测试；8 个目标系统（Windows、macOS、Linux 的 x64 / arm64，Linux 含 glibc 与 Alpine musl）安装冒烟。
- 发布流程：推送 `v*` tag 后先跑完整 CI，再发布 CI 里测过的同一份 tarball。

### M2：移植基础设施与 B 站

#### Added

- core：可注入的随机数与时钟（`core/rand.ts`）、与 Python 对应的编码函数（`core/py.ts`）、cookie 罐、`HttpClient`、归一化工具、登录流程（扫码 / 短信 / 账密 / cookie）、下载、长连接、无 schema 的 protobuf 解码。
- 对拍框架：`scripts/golden/` 在确定性的随机数与时钟下运行上游 Python、截获 curl_cffi 与 requests 的请求；`tests/golden.ts` 的 `replay()` / `expectRequests()` 逐字节比较 TS 发出的请求。
- bilibili web 端：WBI 签名、bili_ticket、设备初始化与指纹上报、cookie 续期、扫码与 cookie 登录、弹幕长连、upos 投稿。

### M3：其余 8 个平台

#### Added

- weibo：cookie 登录、用户、微博详情 / 搜索 / 发布、评论、媒体上传。
- taobao：cookie 登录、按商品查卖家、私信（钉钉长连）、媒体上传；上游签名 JS 在 vm 里执行。
- x：cookie 登录；用户、推文、搜索、评论、推荐流、私信读取；关注、点赞、收藏、转推、发推与删除、媒体上传；`x-client-transaction-id` 纯算。
- kuaishou：扫码 / 短信 / cookie 登录，一并换取主站、创作者、直播三个子站点的凭证；用户、作品、搜索、评论、推荐流、直播（弹幕长连、礼物、回放）、通知数、图集与视频发布。
- xianyu：扫码 / cookie 登录、商品详情、发布（`--shipping` / `--postage` / `--pickup`）、媒体上传、私信（钉钉长连）。
- tiktok：cookie 或浏览器会话 JSON 登录；用户、视频、搜索、评论、商品与商品评价、推荐流、直播、通知、私信、收藏夹、合集、地点、创作者发布；X-Bogus / X-Gnarly / msToken / ticket-guard 等签名移植成 TS。
- jd：扫码 / 短信（含 JCAP 验证码自动求解，onnxruntime-web 加模型包）/ cookie 登录；商品详情、搜索、评价、搜索联想与热词、客服私信（咚咚长连）、浏览历史、关注商品；扩展命令 `order list`、`cart count`、`coupon list`。
- douyin：扫码 / 短信 / cookie 登录（cookie 可附带 ticket、证书、私钥等设备数据）；用户、作品、搜索、点赞与收藏、图文与视频发布、商品与商品评价、评论、推荐流、直播、通知、私信、收藏夹；a_bogus / X-Bogus / msToken / bd-ticket-guard 等签名全部对拍。
- xhs：扫码 / 短信 / cookie 登录（含创作者中心子站点）；笔记、搜索、媒体与下载、用户、评论、推荐流、热词、通知、收藏夹、话题与地点、直播、私信、发布；x-s / x-s-common 等签名全部对拍。
- 补齐上游已有、第一轮漏移植的能力（按平台登记到 AGENTS 4.7 后实现），例如：
  - B 站：相关推荐、专栏搜索与发布、专栏 / 动态评论区、楼中楼、投币同时点赞、弹幕样式、收藏夹、投稿转载、极验点选自动识别（移植 ddddocr，新增 `@cv-cat/catbus-assets-ocr` 模型包）；
  - 抖音：搜索筛选与视频频道、作品管理（`item list`）、发布的地点 / 合集 / 热点、私信文件与分享卡片、直播榜单、商品评价标签、通知分组、短信登录的 SSO 链；
  - 快手：滑块风控自动通过、服务端登出、直播礼物全量、发布后取回作品状态；
  - 小红书：搜索联想、`item search --time`、`user following`、群聊私信、直播弹幕走长连兜底、创作者中心视频元数据；
  - X：`item publish --thread`、`--quote`、长推、扩展命令 `article publish` / `delete`、媒体搜索；
  - 京东：`order list --range`、`--area` 收货地区、`msg send --order` 按订单咨询客服、国际手机号短信登录；
  - 闲鱼：`item publish --original-price`、`msg send --to` 主动联系用户；
  - TikTok：`folder add`、`folder create` / `update --visibility`、`item publish --allow-*`。
- 标准发布选项 `--visibility` 增加取值 `fans`（粉丝可见）；新增通用发布选项 `--quote`（目前只有 X 支持）。
- `msg send` 允许 `--to` 与 `--item` 同时用（就某件商品联系某个用户）。

#### Changed

- web 端一律需要登录，游客态只留给 app / pc 端。
- 移植中发现与上游不符的能力，在能力矩阵里按上游实际情况改为 ○ 或 ◐（例如 weibo `item search` 只能取第一页）。
- 删除 xhs 的蒲公英 / 千帆（普通账号访问会被拒，还会连带触发主站的人机验证），登记到 AGENTS 4.12「不提供的能力」。
- x 的登录方式只声明 cookie（上游账密登录依赖 Castle，不移植）。
- 同步上游：抖音 fix-dtrait-blob（没有 dtrait_blob 时按设备档案纯算）、快手 feat/fix-slider-fingerprint-http2（刷新滑块指纹）、x 3fe6ea7、xhs 视频编码名混淆。

### 真机验证与代码审查修复

#### Added

- 在线测试 `npm run test:e2e`：按注册表跑各平台已实现的只读命令，前面命令的结果当后面命令的参数，校验信封与归一化类型的结构，报告写到 `.e2e/<platform>.json`；风控、子站点未登录记为跳过。
- [docs/trouble.md](docs/trouble.md)：记录真机验证中没跑通的问题、原因、状态与各平台进度。
- 小红书 `item publish --poi-name`（地点只能按名称搜到）。
- 快手滑块没通过时，`RISK_CONTROL` 的 `detail.verify` 带上服务端的回复。

#### Changed

- 各平台解析响应改用 `core/py.ts` 的 `jsonLoads`，与 Python 的 `json.loads` 一样保留 64 位整数 ID。
- `Media.url` 可以为 null：刚上传、平台还没给出可访问地址时不再填空串；下载时跳过没有地址的媒体。
- 快手 `feed list --kind recommend` 改走真正的推荐流，快手没有单独的热门流，去掉 `--kind hot`。
- 闲鱼、淘宝的钉钉 IMPaaS 私信长连抽到共享模块；跨平台的小工具并入 core。
- `--all` / `--limit` 翻页时游标没有变化就停止，避免死循环。
- 登录轮询容忍偶发的网络错误，扫码期间网络抖一下不再让登录失败。

#### Fixed

- core：响应声明了非 UTF-8 的 charset（例如京东的 GBK）时按它解码，修复京东登录后用户名乱码；拒收跨域 Set-Cookie；`auth login` 信封的 `account`；二维码 PNG 权限改为 0600；构建配置缺 DOM 类型导致 CI 打包失败。
- TikTok：新建收藏夹的 64 位 id 被 `JSON.parse` 取了近似值，接着 `folder update` 找不到它。
- 小红书：登录的 461 / 471 报 `RISK_CONTROL` 并提示改用 cookie 导入；创作者中心改用主站登录态自动初始化，不用再扫码；私信的会话 id、消息字段取错、重复发送；创作者中心桥接失败不再写坏凭证。
- 抖音：通知类型取错；缺 `UIFID` 时自动取回；写操作不再整条重跑；风控不再误报未登录；直播房间无效时不再无限重连。
- 快手：作品列表的时间范围与翻页游标；滑块背景图解码成全黑；`result=2` 按风控处理；仅自己可见的作品和单图作品的状态与类型。
- 京东：`comment list` 取成了问答；会话更新时间；业务接口 403 时区分风控与登录失效；JCAP 验证码图解码成全黑。
- B 站：二进制接口检查 HTTP 状态；动态评论区标为 ◐ 并说明限制；取消收藏时自动找到收藏夹；风控码区分 `rate_limit` / `blocked`；upos 上传的重试与错误映射。
- 闲鱼、淘宝：私信长连断线后停掉旧连接的心跳；`msg history` 截断时的游标；状态推送不再当成解码失败。
- 微博、X、TikTok、京东、快手：代码审查修复。

[Unreleased]: https://github.com/cv-cat/catbus/commits/master
[0.1.0]: https://github.com/cv-cat/catbus/commits/master
