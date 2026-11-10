# 更新日志

本项目的所有重要变更都记录在这里。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 全局选项 `--fields <路径,...>`：只输出 `data` 条目里的这些字段，点号进入嵌套对象，经过数组时作用到每个元素，没有的字段为 null；json、jsonl 都适用，在 `--raw` 之后生效
- 全局选项 `--dry-run`：做完参数、选项、是否已实现、本地登录态的检查就停下，不调用平台接口；`data` 为 `{args options confirm}`，凭证类选项打码
- UserRef 带上头像：作者、评论者、主播、观众、私信对方等所有 UserRef 改为 `id name url avatar`，`avatar` 从同一个原始对象里取（统一成 https，不额外请求），取不到时为 null。AccountUser 的字段与 UserRef 相同，类型名保留
- 评论带上图片：Comment 新增 `media: Media[]`（评论附带的图片、表情包、商品评价的晒图；动图也记为 `image`，正文里的行内表情不算），取自同一个原始评论对象，不额外请求。xhs（`pictures`）、douyin / tiktok（`image_list`、`sticker`，商品评价的晒图）、bilibili（`content.pictures`）、weibo（`url_struct` / `pic_infos` / `pic`）、x（回复推文的 `extended_entities`）、jd（评价的 `pictureInfoList`）；kuaishou 的评论查询不返回图片、youtube 评论没有图片，为 `[]`
- `item download --subdir none|id|title`：每条内容放进 `--dir` 下自己的子目录，默认 `none`（行为不变）。`title` 按标题命名（没有标题用正文开头，再没有用 ID），目录名去掉 emoji、平台表情码（如 `[笑哭R]`、`#话题[话题]#`）和 Windows / macOS / Linux 不允许的字符，避开 Windows 保留名，最长 60 个字符；同名目录里已有别的内容时加上 ID 后 6 位。文件名不变。支持所有有 `item download` 的平台（mteam 在 `title` 模式下多查一次种子详情取标题）
- 账号带上头像：Account 与 AuthStatus 的 `user` 改为新类型 AccountUser（`id name url avatar`），凭证文件的 `user` 也保存 `avatar`。登录、cookie 导入和 `auth status` 复用流程里原有的那次当前用户请求取头像（统一成 https），不额外请求；`auth status` 拿到新的昵称 / 头像会写回凭证。旧凭证文件没有 `avatar` 时读成 null，不需要迁移。taobao、xianyu、jd、jimeng 的校验接口不给头像，为 null
- 新增 `youtube`（YouTube，别名 `yt`）平台的 web 端。没有上游仓库，直接对接 YouTube 网页背后的 InnerTube 接口（`/youtubei/v1/`），接口说明见 `src/platforms/youtube/UPSTREAM`：
  - 不登录可用：`item get` / `search`（`--sort general|popular`、`--time`、`--type`）/ `related` / `media` / `download`，`comment list` / `replies`，`user get` / `search` / `items`，`series list` / `items`（播放列表），`keyword suggest`，`live get` / `search` / `history` / `listen`（直播聊天）
  - 需要登录：`feed list`（首页推荐、订阅流），`history list`，`notice list` / `count`，`user likes` / `collects`（稍后观看）/ `following`（只能看自己的），`item like` / `unlike` / `collect` / `uncollect`，`user follow` / `unfollow`（订阅），`comment add`（含 `--reply-to`）/ `delete` / `like` / `unlike`
  - 登录只支持导入浏览器 cookie；支持多账号（`-a`、`auth use`）。没有开 YouTube 频道的 Google 账号以 Google 账号 ID 作为用户 ID
  - `item media` / `download` 走 VISIONOS 客户端、不带登录，给出最清晰的视频轨和音频轨两个文件；同一出口 IP 请求过多时 YouTube 会要求人机验证（`RISK_CONTROL`）
  - `item list`（自己上传的视频，数据来自 YouTube Studio）；`live send`：发直播聊天文字消息；`channel create`：给账号开频道
  - `item publish`（◐ 部分支持）：发布视频（标题、简介、标签、`--visibility public|private`、`--schedule` 定时发布）。自定义封面（`--cover`）未经真机验证，可能需要已验证的账号；`item delete`：删除自己的视频（需要确认，2026-10-30 实测通过）。两者走 YouTube Studio：建视频和删除要求网页端 BotGuard 校验，由本机的无头 Chromium 计算，其余请求都由 Node 发出。Chromium 按 `catbus config set youtube.browser <路径>`、环境变量 `CATBUS_YOUTUBE_BROWSER`、Playwright 缓存的顺序查找，不使用系统里的 Google Chrome（AGENTS.md 5.7）
  - core：配置项新增 `youtube.browser`（AGENTS.md 5.5）
- 平台规范：YouTube 的 web 端声明 `guest: true`（AGENTS.md 5.2 的特例），读取命令不登录可用
- 新增 `docs/platforms/youtube.md`，更新 Agent 技能、多语言 README 与 llms.txt
- `catbus tui`：全屏交互界面（Ink + React）。平台、命令、参数表单、登录要求都从注册表读，新增平台自动出现；`/` 命令面板跨平台搜命令；结果页左列表右详情，自动翻页；底部始终显示等价的命令行，按 `c` 复制
- 界面里登录：二维码画在界面里（黑码白底，固定色，纠错等级 M），短信验证码、密码（隐藏输入）、cookie 在界面里输入，即梦的浏览器授权链接显示在界面里，抖音扫码后风控要求的短信验证码（2046）也在界面里输入；平台在提问前给的说明（待选账号等）显示在提问上方。登录页的表单从注册表里 `auth login` 的选项生成（含 `--auto-bind` 和平台私有选项），新增登录选项时自动出现；`a` 账号页可切换（与 `auth use` 一样调用端的切换钩子）、在线检查、登出、登录新账号。`core/login.ts` 增加 `LoginUi` 钩子和 `claimStdin()`（界面运行期间钩子之外的提问报 `USAGE`，不抢 stdin），CLI 行为不变
- 界面里监听：`live listen`、`msg listen` 显示成滚动事件流，可暂停、按类型过滤，带 `--duration` 倒计时和每分钟事件数
- 结果页 `Enter`：列出可以接着做的命令（评论、作者、监听、12306 的票价与经停站），参数已按 4.8 填好；`Esc` 回到上一页结果
- 像素版猫巴士吉祥物和约 1 秒的启动动画（任意键跳过）；Windows 上默认不动（控制台整屏重绘会闪），`CATBUS_TUI_ANIMATE=1` 打开
- 配色：Catppuccin Mocha / Latte，文字对底色对比度不低于 4.5:1；`T` 键运行中切换；`NO_COLOR`、`CATBUS_TUI_THEME`、`CATBUS_TUI_ASCII`（终端把 ● │ 显示成两列宽时用）
- `catbus doctor` 新增 `tui` 检查项：在子进程里用假 TTY 把真实界面跑一遍（渲染、布局、按键），CI 的冒烟测试借此在每个目标系统上覆盖界面
- 冒烟测试（`scripts/smoke.mjs`）增加三项 `catbus tui` 检查：非交互环境报 `USAGE`、离屏渲染自检、伪终端里启动与退出（POSIX 且有 python3 时，`scripts/smoke-tui.py`）
- 文档：`docs/guide/tui.md`

### Changed

- 内部：`src/cli/exec.ts` 提供进程内运行命令的 `prepare` / `invoke`，按 `runPlatform` 的顺序调用 `dispatch.ts` 里同一批校验、身份解析、凭证落盘函数，TUI 只经它运行命令；`dispatch.ts` 里这几个函数改为导出，`--auto-bind` 的检查和 `auth status` 的回写各抽成一个函数，CLI 行为不变。`tests/exec.test.ts` 检查两条路径结果一致

### Fixed

- xhs：扫码确认后的短信人机验证适配主站 2026-11-09 实测的新协议（HTTP 471，`verifyType 213` 登录强制短信验证，替代 0.3.0 适配的验证页链 120）。在登录链的会话上直接验证（不重建验证页会话、无 vc/init），验证码发到输入的手机号（`--phone` 或终端输入，需与账号绑定手机一致；非交互下与验证码一起从 stdin 读两行）；getverifyuserinfo / vc/send / vc/check 的请求键序照实测。120 链保留：服务端按环境在两条验证间切换。短信登录（`--method sms`）的独立链路不变

## [0.3.0] - 2026-11-05

### Fixed

- bilibili：`item edit` 一执行就报「找不到这条稿件」。`archiveDetail` 返回的已经是接口的 `data`，原实现又按 `data.archives` 取了一层，永远取不到原稿；改为按编辑页的 `x/vupre/web/archive/view` 取稿件
- mteam：`item download` 被拒（「下载地址不属于受支持的官方 HTTPS 域名」）。`api.m-team.cc` 的下载地址会 302 到下载节点 `*.halomt.com`，现在允许跳转到这个域名（第一跳仍须是 MT 自己的域名）
- 抖音：扫码后 2046（「为保障你的账号安全，请前往抖音APP完成验证后再进行登录」）把登录流程白白中断。2046 是 passport 新加的二次验证风控门，不再报错：catbus 默认选短信验证，按登录页验证组件的请求形状直接调 `/passport/web/send_code/` 发码（stderr 提示发往的掩码手机号），验证码从 stdin 读一行（支持管道喂给 AI），`/passport/web/validate_code/` 校验通过后用同一个二维码 token 继续轮询等放行；回车跳过短信或决策里没有短信选项时，退回「等 App 端验证」的原有轮询，超时与过期逻辑不变，全程无浏览器
- 能力矩阵的「登录方式」表按 `LOGIN_METHODS` 生成，不再写死 4 种方式
- xhs：扫码确认后被要求短信人机验证（HTTP 471，`verifyType 120`）时不再直接失败：向账号绑定的手机发验证码，在终端输入（非交互时从 stdin 读一行）后继续登录

### Added

- bilibili：`item publish --schedule <ISO 时间>`，定时发布（`x/vu/web/add/v3` 的 `dtime`），时间按 B 站限制校验在 2 小时后、15 天内
- bilibili：`item edit --schedule <ISO 时间>|none`，改期 / 取消定时（`x/vu/web/edit` 的 `dtime`）；不给时沿用原稿的定时，避免编辑封面时把定时稿变成立即发布
- bilibili：`item publish` 支持 B 站双封面，新增私有选项 `--cover43`（稿件列表页的 4:3 封面），与 `--cover`（播放页的 16:9）各传一张，提交时一起写进 `x/vu/web/add/v3` 的 `cover` / `cover43`
- bilibili：`item edit` 支持只改资料，`--video` 不再必填；新增 `--cover43`。不给 `--video` 时按编辑页接口 `x/vupre/web/archive/view` 取原稿的分 P（`filename` + `cid`，`x/vu/web/edit` 两个都要），只换 16:9 / 4:3 封面不用重传视频、不丢原分 P；`--cover` / `--cover43` 缺省沿用原图。编辑时沿用原稿的 `is_only_self`，不给 `--visibility` 不会把「仅自己可见」的稿改成公开
- mteam：网页账密登录（`--method password`），请求带网页前端的 HMAC 签名；新设备的两步验证支持邮箱验证码（`--email` 发码、`--code` 完成，非 TTY 分两次执行）和 TOTP
- mteam：`item collect` / `uncollect`、`user collects`、`item download --qbit`（推送到本机 qBittorrent，`--qbit-savepath` 指定保存目录；multipart 自己拼，结尾边界带 CRLF，避免 qBittorrent 把结尾边界读进最后一个字段）、`seed list`、`seed stats`、`exam get`（考核进度）、`bonus get`（时魔）、`bonus history`（新扩展类型 `BonusRecord`）、`msg list` / `history`（站内信只读，只支持账密登录）；`item search` / `feed list` 新增私有选项 `--order-by` / `--asc`
- 新增 `jimeng`（即梦，别名 `dreamina`）平台：管理即梦官方 CLI `dreamina` 的多账号登录态，不注册生成类命令
  - `auth login`：浏览器授权（新登录方式 `oauth`），由 `dreamina` 发起设备码授权，把钥匙串里的登录态存到账号名下
  - `auth use`：把目标账号的登录态写回钥匙串，之后直接运行 `dreamina` 就是这个账号
  - `auth status`：用 `dreamina user_credit` 在线校验；`auth logout`：钥匙串里正是这个账号时同时 `dreamina logout`
  - `dreamina` 自己刷新 token 后，catbus 在下次改写钥匙串前把最新值存回所属账号
  - 只支持 macOS，需要先安装 `dreamina`
- core：端声明新增 `use` 钩子，`auth use` 设置当前账号前调用（AGENTS 5.3、5.6）
- 新增 `docs/platforms/jimeng.md`、AGENTS.md 5.6，更新能力矩阵、登录指南、Agent 技能和 llms.txt
- `user update`：修改当前账号的昵称（`--name`）、头像（`--avatar`）、简介（`--bio`），只改给出的字段，返回修改后的 User
- bilibili：`user update`，接口按网页端个人中心 `account.bilibili.com` 补（`x/member/web/sign/update`、`face/update`、`web/update`），上游没有，没有对拍。改昵称前先查 `uname/update/message` 的资格；改昵称扣硬币，带 `--name` 时需要确认
- 新增 `maoyan`（猫眼演出）平台，web 端免登录只读查询：
  - 城市热门演出（`feed list`）：私有选项 `--city`（城市名或演出城市 ID，默认北京），`--category` 本地筛选
  - 演出分类（`feed categories`）、演出城市检索（`poi search`）：内置数据，不联网
  - 演出详情（`item get`）：场次时间、城市、场馆、票价档、售卖状态逐行写进 `text`；详情接口要 H5guard 的 `mtgsig`，在本地 vm 里出签
  - 离线测试（真实响应裁剪的 fixture）与在线 E2E 测试；平台文档、能力矩阵、Agent 技能与多语言 README
- `maoyan`：新增 `auth login`（大众点评 App 扫码，不用打开浏览器；或 `--method cookie` 导入 `dper`）、`auth status`，以及 `item get --tickets`（需要登录）：把场次、票档、实售价、余票逐行追加到 `text`，原始字段在 `--raw` 的 `shows`
- bilibili：`comment pin` / `comment unpin`，置顶 / 取消置顶自己作品评论区里的一级评论（`x/v2/reply/top`，平台扩展，AGENTS 4.7）

## [0.2.1] - 2026-10-22

### Added

- bilibili：`feed list --kind following`，关注的人的视频投稿（动态流 `x/polymer/web-dynamic/v1/feed/all`，`type=video`），游标是接口返回的 `offset`；需要登录。上游没有这个接口，请求按网页端动态页补，没有对拍

- 新增 `12306`（12306 铁路）平台，支持公开只读查询功能：
  - 车站检索（`station search`）：支持中文站名、拼音全拼/首字母前缀、电报码，车站字典本地缓存 24 小时
  - 余票查询（`ticket search`）：直达列车与余票信息，支持 `--date`、`--type`（车型过滤）、`--available`（只看有票），输出统一 `Ticket` 与 `Station` 对象及 12306 深链
  - 票价详情（`ticket price`）：各席别价格详情，输出标准 `Price { amount, currency }`
  - 经停时刻（`route get`）：全途经停站、到达/发车时间、停留时长
  - 中转方案（`transfer search`）：两段换乘方案，支持 `--via` 指定换乘站、`--limit` 限制方案数量，支持「同车换座」标记
- 平台架构支持免登录（`guest: true`）模式，无需登录态直接调用查询命令
- 新增 `12306` 离线单元测试与在线 E2E 测试
- 新增 `docs/platforms/12306.md`，更新能力矩阵（`docs/capabilities.md`）、Agent 技能与多语言 README

### Fixed

- 小红书：扫码登录确认后 471（antiSpam）——登录链补 X25519 客户端公钥与 ssk 解密（App 9.43.1 协议，原语同上游 Spider_XHS）
- 小红书：发布笔记 -9059 参数错误——body 对齐 2026-10-17 现网 schema（视频 business_binds 去 coProduceBind、copyable 按类型）
- 小红书：可见范围映射勘误（浏览器下拉实测）：`--private` 对应 `privacy_info.type=1`（0=公开、1=仅自己可见、2=仅互关好友）
- 抖音：图文/视频发布空描述时 text_extra 补尾部分隔符，对齐网页端

### Changed

- 小红书：指纹族刷新到 2026-10-17 现网（webBuild 6.57.6 / Chrome 155），b1 与浏览器逐字节对齐（PC 1784 / 创作者 1868 字节），webprofile 参考档案按 82 字段实测重建
- 小红书：461/471 风控支持 App 扫码验证链（verifytype 124），qr/init 前自动重跑安全引导
- 抖音：passport SDK 版本族升到现网（jssdk 3.4.9 / p_ui 2.4.10 / p_zt 3.3.30 / p_ver 1.1.4-beta.5 / p_ca_real 1.0.0.938），UA Chrome/155
- 抖音：dtrait 内层 blob 与真实设备逐字节对齐（176 字节）；msToken 184 字节的差距由 TLS ClientHello 版本决定，curl_cffi 体系内为已知限制
- 抖音：Cookie 头按浏览器 wire 顺序序列化（45 键线序），安全 SDK cookie 与 web_sign_token 补齐收集
- 抖音：创作者域 msToken 独立轮换通道（ms_appid=2906，与主站分开）

## [0.1.0] - 2026-10-06

首个版本。

### Added

- 10 个平台的 web 端：小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。能力移植自 [cv-cat](https://github.com/cv-cat) 的开源项目，用 TypeScript 重写，请求与上游逐字节对拍。各平台支持的命令见 [能力矩阵](docs/capabilities.md)，用法与已知限制见 [各平台说明](docs/platforms/README.md)。
- 统一的命令语法 `catbus <platform> <resource> <action>`：含义相同的能力在所有平台上同名（笔记、作品、推文一律是 `item`），用了平台原生叫法时提示规范词；四层中文帮助。
- 输出：stdout 只有 JSON 信封，`-o json|jsonl`，跨平台统一的归一化类型，`--raw` 输出平台原始对象；退出码 0–7。
- 登录：扫码、短信、账密、cookie 导入（各平台支持的方式不同）；登录态按 平台 × 端 × 账号 隔离在 `~/.catbus/`，`-a` 切换账号，会自动续期的凭证自动写回。
- 分页 `--limit` / `--cursor` / `--all`；`item download` 下载媒体；`listen` 监听直播弹幕和私信，断线自动重连。
- 发布：图文、视频、文章，支持仅自己可见、定时、地点、话题等选项（各平台的取舍见能力矩阵）。
- 验证码：快手滑块、B 站极验点选、京东 JCAP 在本地自动识别，模型放在 `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr`。
- 全局命令：`platforms`、`doctor`、`auth list`、`config`、`version`；代理可以全局、按平台或单次设置。
- 给 AI Agent 用：Agent 技能（`npx skills add cv-cat/catbus`）和 [llms.txt](llms.txt)。
- Docker 镜像与 Compose。
- 只需要 Node（`^22.22.2 || ^24.15.0 || >=26.0.0`），支持 Windows、macOS、Linux 的 x64 / arm64（Linux 含 glibc 与 musl）。

[Unreleased]: https://github.com/cv-cat/catbus/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cv-cat/catbus/releases/tag/v0.1.0
