# 常见问题

## 基本

### catbus 和 cv-cat 的那些 Python 仓库是什么关系？

catbus 的能力来自 [cv-cat](https://github.com/cv-cat) 的 10 个开源仓库（Spider_XHS、DouYin_Spider、TiktokApis、BilibiliApis、KuaiShou-Spider、WeiboApis、XianYuApis、TaoBaoApis、JdApis、XApis）。catbus 把它们的请求构造、签名和解析逻辑**用 TypeScript 重写**，并用对拍测试保证同样的输入产出逐字节相同的请求。运行时不调用上游的 Python。

区别在于：catbus 是一个统一的命令行，10 个平台用同一套命令、参数和 JSON 输出；上游是各自独立的 Python 库。每个平台基于哪个上游 commit，记录在 `src/platforms/<platform>/UPSTREAM`。

### 需要装 Python 吗？

不需要。用户只需要 Node（`^22.22.2 || ^24.15.0 || >=26.0.0`），不需要 Python、C/C++ 编译器或其他系统依赖。Python 只在开发时用来生成对拍数据。

### 支持哪些系统？

- Windows：x64、arm64
- macOS：arm64（Apple Silicon）、x64（Intel）
- Linux：x64、arm64，glibc 和 musl（Alpine）都支持

CI 在这 8 个目标上跑安装和冒烟测试。原生依赖（HTTP 库、`@napi-rs/canvas`）都带预编译包，安装时不需要编译。

### 怎么安装？npm 上搜不到 catbus-cli

npm 包还没有发布（即将发布）。现在请从源码安装：

```bash
git clone https://github.com/cv-cat/catbus.git
cd catbus
npm ci && npm run assets:jd && npm run assets:ocr && npm run build && npm link
```

发布后用 `npm i -g catbus-cli` 安装。npm 上的 `catbus` 是别人的库，不是这个项目。

### 模型包为什么这么大？

catbus 依赖两个模型包：
- `@cv-cat/catbus-assets-jd`：京东验证码（JCAP）的 onnx 模型，约 81 MB；
- `@cv-cat/catbus-assets-ocr`：验证码 OCR 模型（ddddocr 1.6.1 的检测、识别模型和字符集），约 34 MB，B 站极验点选在用。

模型是自动过验证码必需的。拆成单独的包是因为模型很少变，放在主包里的话每次发版都要重新上传 100 多 MB。它们是主包的普通依赖，安装 `catbus-cli` 时自动装上，不需要单独安装。catbus 的原则是开箱即用、装完即可离线使用，安装体积不是优先考虑的因素。

从源码安装时，模型文件不进 git，要用 `npm run assets:jd`、`npm run assets:ocr` 取回，脚本会校验 sha256。

### catbus 会收集或上传我的数据吗？

不会。catbus 没有遥测，不收集、不上传任何数据。登录态只保存在本机的 `~/.catbus/`（目录 0700、文件 0600），请求只发往你操作的那个平台（以及你配置的代理）。

## 登录

### 为什么什么都要登录？

各平台的 web 端不登录几乎看不到内容（搜索、详情、评论都会被登录墙拦住），所以 catbus 的 web 端除 `auth` 以外的命令都需要登录，未登录时直接报 `AUTH_REQUIRED` 并提示登录命令。游客态留给将来的 app 端。

### tiktok / weibo / taobao / x 为什么不能扫码？

TikTok、微博、淘宝的上游仓库只实现了 cookie 登录；X 的上游有账密登录，但依赖 Castle 反自动化令牌，catbus 没有移植。所以这 4 个平台要从浏览器导入 cookie。

### 导入的 cookie 提示缺少字段或登录失败

多半是用 `document.cookie` 或浏览器的 Application 面板只复制了一部分。关键的登录 cookie（小红书的 `web_session`、B 站的 `SESSDATA`、抖音的 `sessionid` 等）是 HttpOnly 的，`document.cookie` 里没有。请从 DevTools → **Network** → 任一请求的 **Request Headers** 里复制完整的 `Cookie`，见 [login.md](login.md#导入浏览器-cookie)。

### 小红书扫码后报 RISK_CONTROL

扫码确认后，小红书服务端可能要求做一次人机验证（HTTP 471）。这是平台风控，上游 Spider_XHS 同样失败，catbus 和上游都还不能自动通过。请按 `hint` 改用 cookie 导入：

```bash
catbus xhs auth login --method cookie --cookie @xhs-cookie.txt
```

cookie 导入后，创作者中心会用主站登录态自动换取，不需要再扫码。

### 抖音 / TikTok 只导入了 cookie，写操作报 AUTH_REQUIRED

- **抖音**的写操作需要和 cookie 同一次登录的 bd-ticket-guard 凭证，扫码或短信登录会自动拿到；只导入 cookie 时 catbus 在本地拦下，不发请求。
- **TikTok** 的写操作需要浏览器 security-sdk 的 ticket-guard 数据，只能从浏览器会话 JSON 导入。

导入格式见 [login.md](login.md#抖音连同-ticket-与设备素材一起导入)。

### 抖音发布一直失败

已知问题：即使凭证齐全，`create_v2` 仍返回空响应，上游在新登录的会话上同样失败，原因在上游的设备档案没有被服务端接受，正在等上游修复。另外，缺少设备素材时点赞会导致登录态被踢。详见 [trouble.md 第 1 节](../trouble.md#1-抖音写操作需要-dtrait_blob)。

## 使用

### xhs 为什么要传 URL，不能只传 ID？

小红书取笔记详情要带 `xsec_token`，而它只出现在链接里。所以 xhs 请优先传完整的笔记 URL（`https://www.xiaohongshu.com/explore/<id>?xsec_token=...`）。catbus 输出的 xhs 对象，`url` 字段都带着 `xsec_token`，可以直接当下一条命令的参数：

```bash
url=$(catbus xhs item search 咖啡 | jq -r '.data[0].url')
catbus xhs item get "$url"
catbus xhs comment list "$url"
```

### NOT_IMPLEMENTED 是什么？

退出码 4，表示这个能力是**规划中**的：
- 能力矩阵里标 ○ 的命令：平台有这个概念，但上游还没有实现，catbus 先占了位置；
- app 端、pc 端：目前所有平台都只有 web 端，`-e app` / `-e pc` 一律返回 `NOT_IMPLEMENTED`。

重试没有用。哪些命令可用，看 `catbus <platform> --help`（带 ○ 的是规划中）或 [能力矩阵](../capabilities.md)。

### NOT_IMPLEMENTED 和 UNSUPPORTED 有什么区别？

- `NOT_IMPLEMENTED`（退出码 4）：平台有这个概念，只是还没做。
- `UNSUPPORTED`（退出码 2）：平台本身没有这个概念（矩阵里的 —），或者命令不在词表里，或者平台不支持这个筛选取值 / 登录方式。

用了平台原生叫法（`note`、`video`、`tweet`……）也会报 `UNSUPPORTED`，`hint` 里给出规范词：catbus 的命令一律用 `item`、`comment`、`msg` 这样的规范词，原生叫法不做别名。

### 遇到 RISK_CONTROL 怎么办？

`RISK_CONTROL`（退出码 5）表示平台要求验证码、限流或封禁，`detail.kind` 为 `captcha` / `rate_limit` / `blocked`。

- **不要连续重试**：短时间内反复请求会让账号被标记得更久，严重时会被封号。停一段时间再试。
- 上游能自动通过的验证码，catbus 会自动尝试（例如快手的滑块、B 站登录时的极验点选、京东的 JCAP）；自动通过不了才报 `RISK_CONTROL`。
- 小红书评论接口的人机验证（HTTP 461）是概率性的，通常几十秒到几分钟后自己恢复；请求越紧凑越容易触发。
- 连续执行很多命令时，命令之间留出间隔，不要并发请求同一个平台；翻页时 catbus 已经按平台加了间隔。
- 用 `--all` 抓取大量数据风险最高，优先用 `--limit`。

已知的风控问题和处理状态见 [trouble.md](../trouble.md)。

### 为什么有的字段总是 null？

归一化类型的字段总是存在，取不到时为 null。有些字段是上游接口本来就不返回，例如 B 站 `user get` 的粉丝数等计数、抖音作品的 `title`（抖音只有描述，放在 `text`）、抖音和小红书列表里的播放量。完整列表见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。需要平台原始字段时用 `--raw`。

### 结果不完整但没有报错

个别命令有已知限制，写在注册表的 `note` 里，`--help` 的「说明」一行和能力矩阵里都能看到。例如：
- 微博 `item search` 只能取第一页；
- 京东 `comment list` 只有第一页，`--limit N` 在一次请求里取 N 条；
- B 站 `danmaku list` 只能拿到前 2 分钟的弹幕，超过 6 分钟的视频直接报 `UPSTREAM`（上游 bug，见 [trouble.md 第 4 节](../trouble.md#4-b-站弹幕只取到前-2-分钟超过-6-分钟直接失败上游-bug)）。

### 危险操作为什么报 CONFIRM_REQUIRED？

所有 `delete`、`msg revoke`、B 站的 `item coin` / `item triple`、`live send --gift` 执行前需要确认。在终端里会在 stderr 上问 y/N；在脚本或 Agent 里（非 TTY）必须加 `-y`，否则报 `CONFIRM_REQUIRED`（退出码 2）。

### 测试写操作时怎样避免影响别人？

发布时用 `--visibility private`（仅自己可见），点赞、收藏只对自己的内容做，不要给真实用户发私信。注意有的平台发布只支持公开（例如闲鱼发布会上架真实商品，X 只有 `public`），B 站动态也没有仅自己可见。另外不少平台没有 `item delete`（矩阵里是 ○），测试内容需要在 App 里手动删。

### 能不能不设代理直接用系统代理？

不能。catbus 不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，也不用系统代理，代理只能通过 `--proxy`、`<platform>.proxy`、`proxy` 显式配置，见 [configuration.md](configuration.md#代理)。

### 能给 Claude Code 等 AI Agent 用吗？

可以。stdout 只输出 JSON、错误带 `code` 和 `hint`、退出码固定，适合 Agent 调用。仓库里的 [skills/catbus/SKILL.md](../../skills/catbus/SKILL.md) 是给 Agent 的使用说明。MCP 模式在 M4 规划中。

## 路线图

### 接下来会做什么？

M0–M3 已完成：10 个平台的 web 端全部移植。M4 规划中：MCP 模式、`table` 输出、shell 补全、external provider（接入 Go / Java 等非 JS 上游）、app / pc 端。见 [AGENTS.md 第 2 节](../../AGENTS.md#2-当前阶段与里程碑)。

### 发现平台接口变了怎么办？

请用「平台接口变了 / 风控」模板提 [issue](https://github.com/cv-cat/catbus/issues/new/choose)，最好附上上游仓库是否同样失败。catbus 的修复流程是先修到上游仓库，再按新 commit 同步移植、重新生成对拍数据。
