# 更新日志

本项目的所有重要变更都记录在这里。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 `youtube`（YouTube，别名 `yt`）平台的 web 端。没有上游仓库，直接对接 YouTube 网页背后的 InnerTube 接口（`/youtubei/v1/`），接口说明见 `src/platforms/youtube/UPSTREAM`：
  - 不登录可用：`item get` / `search`（`--sort general|popular`、`--time`、`--type`）/ `related` / `media` / `download`，`comment list` / `replies`，`user get` / `search` / `items`，`series list` / `items`（播放列表），`keyword suggest`，`live get` / `search` / `history` / `listen`（直播聊天）
  - 需要登录：`feed list`（首页推荐、订阅流），`history list`，`notice list` / `count`，`user likes` / `collects`（稍后观看）/ `following`（只能看自己的），`item like` / `unlike` / `collect` / `uncollect`，`user follow` / `unfollow`（订阅），`comment add`（含 `--reply-to`）/ `delete` / `like` / `unlike`
  - 登录只支持导入浏览器 cookie；支持多账号（`-a`、`auth use`）。没有开 YouTube 频道的 Google 账号以 Google 账号 ID 作为用户 ID
  - `item media` / `download` 走 ANDROID_VR 客户端、不带登录，给出最清晰的视频轨和音频轨两个文件；同一出口 IP 请求过多时 YouTube 会要求人机验证（`RISK_CONTROL`）
  - `live send`、`item publish` / `list` / `delete` 规划中
- 平台规范：YouTube 的 web 端声明 `guest: true`（AGENTS.md 5.2 的特例），读取命令不登录可用
- 新增 `docs/platforms/youtube.md`，更新 Agent 技能、多语言 README 与 llms.txt

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
