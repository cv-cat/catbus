# 更新日志

本项目的所有重要变更都记录在这里。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增 `12306`（12306 铁路）平台，支持公开只读查询功能：
  - 车站检索（`station search`）：支持中文站名、拼音全拼/首字母前缀、电报码，车站字典本地缓存 24 小时
  - 余票查询（`ticket search`）：直达列车与余票信息，支持 `--date`、`--type`（车型过滤）、`--available`（只看有票），输出统一 `Ticket` 与 `Station` 对象及 12306 深链
  - 票价详情（`ticket price`）：各席别价格详情，输出标准 `Price { amount, currency }`
  - 经停时刻（`route get`）：全途经停站、到达/发车时间、停留时长
  - 中转方案（`transfer search`）：两段换乘方案，支持 `--via` 指定换乘站、`--limit` 限制方案数量，支持「同车换座」标记
- 平台架构支持免登录（`guest: true`）模式，无需登录态直接调用查询命令
- 新增 `12306` 离线单元测试与在线 E2E 测试
- 新增 `docs/platforms/12306.md`，更新能力矩阵（`docs/capabilities.md`）、Agent 技能与多语言 README

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
