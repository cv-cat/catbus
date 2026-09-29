# 登录

各平台的 web 端不登录几乎看不到内容，所以 catbus 在 web 端除 `auth` 以外的命令都需要登录。未登录时命令报 `AUTH_REQUIRED`（退出码 3），`hint` 里就是该执行的登录命令。

```bash
catbus <platform> auth login [-a <账号名>] [--method qrcode|sms|password|cookie] [--scope <子站点>]
```

规范见 [AGENTS.md 5.2、5.3](../../AGENTS.md#53-登录与登出)。

## 各平台支持的方式

| 平台 | 扫码 | 短信 | 账密 | cookie | 默认 |
|---|---|---|---|---|---|
| xhs | ✓ | ✓ |  | ✓ | qrcode |
| douyin | ✓ | ✓ |  | ✓ | qrcode |
| tiktok |  |  |  | ✓ | cookie |
| bilibili | ✓ | ✓ | ✓ | ✓ | qrcode |
| kuaishou | ✓ | ✓ |  | ✓ | qrcode |
| weibo |  |  |  | ✓ | cookie |
| xianyu | ✓ |  |  | ✓ | qrcode |
| taobao |  |  |  | ✓ | cookie |
| jd | ✓ | ✓ |  | ✓ | qrcode |
| x |  |  |  | ✓ | cookie |

表格来自注册表，以 `catbus <platform> auth login --help` 为准。不支持的方式报 `UNSUPPORTED`，`hint` 列出可选的方式。

## 扫码

```bash
catbus bilibili auth login
catbus xhs auth login --method qrcode
```

- 二维码画在终端（stderr）上，同时保存成 PNG：`~/.catbus/cache/<platform>/qrcode.png`（权限 0600），终端显示不全时打开这张图扫。
- 用对应的 App 扫码，并在手机上确认。扫码后终端会提示「已扫码，请在手机上确认」。
- 要在几分钟内完成（各平台 2～5 分钟不等），超时或二维码失效时报 `AUTH_REQUIRED`，重新执行即可。
- **小红书**：扫码确认后，服务端可能要求做一次人机验证（HTTP 471），catbus 和上游都还不能自动通过，会报 `RISK_CONTROL`，`hint` 建议改用 cookie 导入。见 [trouble.md 第 2 节](../trouble.md#2-小红书扫码登录被要求人机验证http-471)。

## 短信

在终端里（stdin 和 stderr 都是 TTY）一步完成：先发验证码，再提示输入。

```bash
catbus kuaishou auth login --method sms --phone 13800000000
```

在脚本或 Agent 里（非 TTY）分两步，中间态保存在 `~/.catbus/cache/<platform>/`，10 分钟内有效：

```bash
catbus kuaishou auth login --method sms --phone 13800000000   # 发验证码，data 为 {"sent": true, "phone": "..."}
catbus kuaishou auth login --method sms --code 123456         # 用验证码完成登录
```

两步要用同一个 `-a`（不给时都是默认账号）。

平台差异：
- **bilibili**：发验证码前要过极验。catbus 先自动识别；识别不过时，在终端里会在本机起一个验证页面（`127.0.0.1`），在浏览器里手动完成后自动继续；非 TTY 下报 `RISK_CONTROL`，建议改用扫码。
- **jd**：部分账号在验证码之后还要求「额外安全验证」，会再发一条短信。TTY 下直接提示输入；非 TTY 下报 `AUTH_REQUIRED`，`hint` 是用新验证码继续的命令（`--code <验证码>`）。
- **douyin**：`--sso` 改走 `login.douyin.com` 页的 SSO 链（与上游的 `DY_PHONE_LOGIN_PROFILE=sso` 相同），只用于 `--method sms`。
- **xhs**：短信登录可能同样遇到 471 人机验证。

## 账密（仅 bilibili）

密码只从 stdin 读取，不接受命令行参数，避免留在 shell 历史里。TTY 下隐藏输入：

```bash
catbus bilibili auth login --method password --username <手机号或邮箱> --password-stdin
```

脚本里从管道传入：

```bash
printf '%s' "$BILI_PASSWORD" | catbus bilibili auth login --method password --username <手机号或邮箱> --password-stdin
```

登录前同样要过极验，处理方式同短信。

## 导入浏览器 cookie

tiktok、weibo、taobao、x 只能用这种方式；其他平台在扫码被风控时也可以用它。

### 怎么复制

`document.cookie` 拿不到 HttpOnly 的 cookie（例如小红书的 `web_session`、B 站的 `SESSDATA`、抖音的 `sessionid`），而它们恰恰是登录态本身，**所以一定要从请求头里复制**：

1. 用浏览器打开平台网站并登录（见下表的网址）。
2. 打开 DevTools（F12 或 ⌥⌘I），切到 **Network（网络）** 面板，刷新页面。
3. 点开任意一个发往该网站域名的请求（文档请求或接口请求都行），在 **Request Headers（请求标头）** 里找到 `Cookie`，复制它的完整值。
4. 导入：

```bash
catbus weibo auth login --cookie "SUB=...; SUBP=...; ..."
```

默认方式不是 cookie 的平台（扫码为默认）要加 `--method cookie`：

```bash
catbus xhs auth login --method cookie --cookie "a1=...; web_session=...; ..."
```

cookie 写在命令行里会留在 shell 历史中，更推荐从文件或 stdin 读：

```bash
catbus x auth login --cookie @x-cookie.txt     # 从文件读，读完可以删掉这个文件
pbpaste | catbus x auth login --cookie -       # 从 stdin 读（macOS 剪贴板）
```

`--cookie` 接受：
- `a=1; b=2` 形式的 Cookie 请求头（开头带 `Cookie:` 也可以）；
- 浏览器扩展导出的 cookie JSON 数组（`[{"name": ..., "value": ..., "domain": ...}]`），会保留各自的 domain 和过期时间；
- douyin、tiktok 另外接受一个 JSON 对象，一并导入写操作需要的设备数据，见下文。

导入后 catbus 会在线校验一次（取当前用户），cookie 无效或过期时报 `AUTH_REQUIRED`，不保存。

### 各平台要从哪里复制、至少要有哪些 cookie

| 平台 | 网址 | catbus 会检查的 cookie |
|---|---|---|
| xhs | https://www.xiaohongshu.com | `a1`（52 位）、`web_session` |
| douyin | https://www.douyin.com | `sessionid` |
| tiktok | https://www.tiktok.com | `sessionid` / `sid_tt` / `multi_sids` 之一 |
| bilibili | https://www.bilibili.com | `SESSDATA`；写操作还要 `bili_jct` |
| kuaishou | https://www.kuaishou.com | 在线校验 |
| weibo | https://weibo.com | `SUB` |
| xianyu | https://www.goofish.com | `unb`，以及 `_m_h5_tk`、`cookie2` |
| taobao | https://www.taobao.com | `unb`，以及 `_m_h5_tk`、`cookie2` |
| jd | https://www.jd.com | `thor`（或 `pt_key`）与 `pin` |
| x | https://x.com | `auth_token`、`ct0` |

缺少时报 `USAGE` 并说明缺了哪个。复制整条 Cookie 请求头最省事，不要自己挑。

### 抖音：连同 ticket 与设备素材一起导入

抖音的写操作（发布、评论、点赞、私信等）除了 cookie，还要 bd-ticket-guard 凭证，而且要和 cookie **属于同一次登录**。**扫码或短信登录时 catbus 会自动拿到这些**，所以写操作优先用扫码登录。

只有 cookie 时只读命令正常，写操作会在本地被拦下并报 `AUTH_REQUIRED`。已经有配套凭证时，可以用一个 JSON 对象导入（格式对应上游 `DouyinAuth.from_cookie` 的参数）：

```json
{
  "cookie": "<浏览器的完整 Cookie，或 cookie JSON 数组>",
  "ticket": "...",
  "ts_sign": "...",
  "client_cert": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "dtrait_blob": "..."
}
```

```bash
catbus douyin auth login --method cookie --cookie @dy.json
```

- `cookie`（也可以写成 `cookies`）必填，其余可选。
- dtrait 设备素材（`dtrait_blob`、`dtrait_profile`、`session_dtrait`）：不给时按随包的设备档案现算。想用自己浏览器的设备指纹时再导入：`dtrait_blob` 是抓到的内层 blob，`dtrait_profile` 是设备档案对象（结构同 `static/douyin/dtrait_profile.json`），两者都给时 `dtrait_blob` 优先。
- JSON 里出现任何一个 dtrait 键时，这一组整体替换，值为 `null` 表示清掉；一个都没有时沿用同名账号已有的。之后再扫码登录同名账号，也会继承已有的 dtrait 素材。

**已知问题**：目前即使凭证齐全，抖音的发布仍返回空响应（上游同样失败），点赞在缺设备素材时还会导致登录态被踢。详见 [trouble.md 第 1 节](../trouble.md#1-抖音写操作需要-dtrait_blob)。

### TikTok：导入浏览器会话 JSON

TikTok 只能导入 cookie。只导入 Cookie 字符串时，缺的设备数据会在本地补齐，**只读命令可以正常使用**；但点赞、收藏、评论、发布、私信、直播发言等写操作需要浏览器 security-sdk 的 ticket-guard 数据，catbus 在本地拦下并报 `AUTH_REQUIRED`，提示用会话 JSON 重新登录。

会话 JSON 是一个扁平对象，字段名与上游 TiktokApis 的 `.tiktok-runtime.json` 相同（见上游 README 的「发布 Demo」一节），**必须来自同一次已登录的浏览器会话**：

```json
{
  "cookie": "<完整的 Cookie 请求头>",
  "document_cookie": "...",
  "device_id": "...",
  "odin_id": "...",
  "user_agent": "...",
  "local_storage": { "...": "..." },
  "session_storage": { "...": "..." },
  "browser_metrics": { "...": "..." },
  "ticket_guard_private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "ticket_guard_encrypt_ticket": "...",
  "ticket_guard_ts_sign": "...",
  "ticket_guard_version": "...",
  "ticket_guard_iteration_version": "..."
}
```

```bash
catbus tiktok auth login --cookie @tiktok-session.json
```

- `cookie` 必须是 Cookie 字符串，其余字段原样存进凭证文件的 `device`。
- 写操作至少要有 `ticket_guard_private_key`、`ticket_guard_encrypt_ticket`、`ticket_guard_ts_sign`；缺哪个，报错里会列出来。
- `device_id` 不给时，catbus 依次从 localStorage 的 Tea 缓存、`multi_sids` 里找，再没有就请求一次首页取服务端分配的值。

## 多账号

每个平台、每个端可以存多个账号，用 `-a <账号名>` 区分：

```bash
catbus xhs auth login -a work             # 登录到账号 work
catbus xhs item search 咖啡 -a work       # 用 work 执行
catbus xhs auth use work                  # 设为当前账号
catbus xhs auth list                      # 本平台的账号
catbus auth list                          # 所有平台、所有端的账号
```

- 身份的选择顺序：`-a <name>` > 当前账号 > 未登录。`-a` 指定的账号不存在时报 `AUTH_REQUIRED`，`hint` 为 `catbus <p> auth login -a <name>`。
- 不带 `-a` 登录时：有当前账号就登录到当前账号，否则登录到 `default`。第一次登录的账号自动成为当前账号。
- 账号名只能用小写字母、数字、`_` 和 `-`，以字母或数字开头，最长 32 位。`guest` 是保留名。
- 如果这个名字下已经存了另一个用户，登录报 `USAGE`，新凭证不保存：换一个 `-a`，或者先 `auth logout`。

## 子站点（--scope）

有的平台的创作者中心、直播等子站点有单独的登录态：
- **能自动换取的，不需要再登录**：例如小红书的创作者中心，第一次用到（`item list`、`item publish` 等）时用主站的登录态自动换取；失效后也会自动重新换取。
- **需要单独登录的**，用 `--scope` 登录到同一个账号的对应分区。目前只有小红书声明了 `creator`：

```bash
catbus xhs auth login --scope creator                  # 扫码登录创作者中心
catbus xhs auth login --scope creator --method sms --phone 13800000000
catbus xhs auth login --scope creator --method cookie --cookie @creator-cookie.txt
```

命令缺少需要的 scope 时报 `AUTH_REQUIRED`，`hint` 里带上 `--scope`。

## 查看、刷新与登出

```bash
catbus xhs auth status      # 在线校验，返回 {logged_in, user, method, expires_at}
catbus xhs auth logout      # 登出当前账号
catbus xhs auth logout -a work
```

- `auth status` 未登录或已失效时返回 `logged_in: false`，不报错；`expires_at` 取自登录 cookie 的过期时间，取不到时为 null。
- 平台返回登录失效时，命令报 `AUTH_EXPIRED`（退出码 3），`hint` 是重新登录的命令。
- 会自动刷新的 token（例如 B 站的 refresh_token）和响应里的 Set-Cookie，会自动合并回凭证文件。
- `auth logout` 删除本地凭证文件，并清除指向它的当前账号。bilibili 和 kuaishou 会同时调用服务端登出；服务端登出失败时只删本地凭证。

## 凭证保存在哪里

```
~/.catbus/auth/<platform>/<endpoint>/<account>.json
```

- 目录权限 0700、文件 0600（Windows 依赖用户目录本身的 ACL），写入都是原子的。
- 凭证只保存在本机，catbus 不会上传到任何地方。不要把这个目录提交到 git、打包分享，或贴到 issue 里。
- 可以用 `CATBUS_HOME` 换一个数据目录，见 [configuration.md](configuration.md)。
