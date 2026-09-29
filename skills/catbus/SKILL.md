---
name: catbus
description: 用 catbus CLI 读取或操作小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X 这 10 个平台的数据（搜索、详情、评论、用户、直播、私信、发布等）。用户要查询、导出或操作这些平台上的内容时使用。
---

# catbus

catbus（猫巴士）是一个命令行工具，用统一的命令、参数和 JSON 输出调用 10 个平台的 web 端接口。stdout 只输出 JSON，日志、提示、二维码都在 stderr。

先确认它能用：`catbus version`、`catbus doctor`。找不到 `catbus` 命令时告诉用户安装（npm 包 `catbus-cli`，或从源码 `npm link`），不要自己去装。

## 命令语法

```
catbus <platform> <resource> <action> [参数...] [选项...]
```

- platform：`xhs` `douyin` `tiktok` `bilibili` `kuaishou` `weibo` `xianyu` `taobao` `jd` `x`（别名如 `bili`、`dy`、`twitter` 也能用）。
- resource / action 用规范词，**所有平台同名**：笔记、视频、微博、推文、商品一律叫 `item`，搜索一律叫 `search`，收藏夹叫 `folder`，私信叫 `msg`。`note`、`video`、`tweet` 这类平台原生叫法会报 `UNSUPPORTED`，`hint` 里给出规范词。
- 参数接受 ID、URL（包括分享短链）、平台自然标识（B 站 BV 号、X 用户名），用户参数还可以是 `me`。输出对象都带 `id` 和 `url`，可以直接当下一条命令的参数。
- **xhs 一律传 URL**：小红书取详情要 `xsec_token`，它只在链接里。用 `search` / `feed list` 等命令输出的 `url`，不要只传 24 位 ID。
- 以 `-` 开头的位置参数放在 `--` 之后，例如 `catbus bilibili item search -- -1s`。选项可以出现在任意位置。
- 端 `-e web|app|pc`，默认 `web`。app / pc 端都还没实现（`NOT_IMPLEMENTED`）。

各 resource 的命令与参数速查见 [reference/commands.md](reference/commands.md)。

## 先发现能力，再调用

平台之间能力差别很大，调用前先查，不要猜：

```bash
catbus platforms xhs                 # JSON：该平台每条命令的 status（implemented / planned）、auth、note
catbus xhs --help                    # 人读的命令总览，带 ○ 的是规划中
catbus xhs item --help               # 某个 resource 下的 action
catbus xhs item search --help        # 参数、选项、筛选取值、登录要求、输出类型
```

从 JSON 里取已实现的命令：

```bash
catbus platforms xhs | jq -r '.data.commands[] | select(.endpoint=="web" and .status=="implemented") | "\(.resource) \(.action)"'
```

- `note` 字段写着能力限制（例如「只支持 me」「只能取第一页」），调用前看一眼。
- 筛选选项（`--sort` `--type` `--time` `--kind`）每个平台支持的取值不同，以 `--help` 为准。取值不支持时报 `UNSUPPORTED`，`hint` 列出可选值。
- `--help` 是 stdout 上唯一不是 JSON 的输出。

## 信封与退出码

默认 `-o json`：stdout 恰好一个信封，成功和失败都是。

```json
{ "ok": true, "platform": "bilibili", "endpoint": "web", "resource": "item", "action": "get",
  "account": "default", "data": {}, "page": null, "error": null }
```

失败时 `ok` 为 false，`data` 为 null，`error` 为 `{code, message, hint, detail}`。**先读 `error.hint`**：它是建议执行的命令或做法。

| 退出码 | code | 该怎么做 |
|---|---|---|
| 0 | — | 成功 |
| 1 | `ERROR` | 未分类错误，把 message 告诉用户 |
| 2 | `USAGE` | 参数写错了，按 hint 或 `--help` 改正后重试一次 |
| 2 | `UNSUPPORTED` | 平台没有这个命令或取值；按 hint 换规范词 / 取值，或告诉用户该平台不支持 |
| 2 | `CONFIRM_REQUIRED` | 危险操作没确认，见下文「写操作」 |
| 3 | `AUTH_REQUIRED` / `AUTH_EXPIRED` | 未登录或登录失效，见下文「登录」 |
| 4 | `NOT_IMPLEMENTED` | 规划中的能力或端（○），不要重试，告诉用户目前还不支持 |
| 5 | `RISK_CONTROL` | 验证码 / 限流 / 封禁，见下文「风控」 |
| 6 | `NETWORK` | 网络或代理问题，可以稍后重试一次；持续失败让用户检查代理（`catbus config list`） |
| 7 | `UPSTREAM` | 平台返回业务错误，原始错误码在 `detail`，告诉用户，不要盲目重试 |

归一化的对象结构（User、Item、Comment、Live、Message……）所有平台相同，字段总是存在，取不到时为 null 或 `[]`。ID 都是字符串，计数是整数，时间是带时区的 ISO 8601。需要平台原始字段时加 `--raw`。完整字段表见仓库 AGENTS.md 6.2。

## 分页

列表命令（`search`、`user items`、`comment list`、`feed list` 等）默认只取一页，信封带 `page: {cursor, has_more}`。

- `--limit N`：自动翻页直到取满 N 条。
- `--cursor <c>`：从上次的 `page.cursor` 继续。**游标是不透明字符串**，原样传回，不要解析或拼接。`--limit` 截在一页中间时游标会带 `#skip=N` 这样的后缀，续翻时 catbus 会重取这一页并跳过已输出的，照样原样传回即可。
- `--all`：翻到没有更多。量可能很大、请求很多，只在用户明确要全部时用，优先用 `--limit`。
- 翻页间隔由平台默认值控制，不需要自己 sleep。

大量数据用 `-o jsonl`：stdout 每行一条 `data` 条目，边翻边输出；结束时 stderr 最后一行是摘要信封（带 `page` 和 `error`），从那里取下一页游标和错误。

```bash
catbus bilibili user items <user> --limit 200 -o jsonl > items.jsonl 2> summary.log
tail -n 1 summary.log | jq -r '.page.cursor'
```

## 登录

web 端除 `auth` 命令外都需要登录，未登录时报 `AUTH_REQUIRED`，`hint` 是登录命令（如 `catbus xhs auth login`）。

**遇到 `AUTH_REQUIRED` / `AUTH_EXPIRED` 时，把 hint 里的登录命令交给用户，让用户自己在终端里执行。不要自己去跑扫码登录**：二维码画在 stderr 上，要用户用手机 App 扫，你无法完成；短信、账密、cookie 也都需要用户本人提供，不要索要或替用户保存密码、验证码、cookie。

- 查看登录态：`catbus <p> auth status`（在线校验，未登录时 `logged_in: false`，不报错）；所有平台的账号：`catbus auth list`。
- 多账号用 `-a <name>`；`-a` 指定的账号不存在时也报 `AUTH_REQUIRED`。
- tiktok、weibo、taobao、x 只能导入浏览器 cookie（`--method cookie --cookie ...`），这一步也交给用户。
- 登录态保存在用户本机的 `~/.catbus/`（或 `CATBUS_HOME`），不要读取、打印或修改其中的凭证文件。

## 写操作

发布、评论、私信、点赞、关注、删除等会真实改变用户的账号，执行前确认用户确实要这么做。

- **危险操作**（所有 `delete`、`msg revoke`、bilibili 的 `item coin` / `item triple`、`live send --gift`）需要确认。你在非交互环境里运行时，不带 `-y` 会报 `CONFIRM_REQUIRED`。**只有在用户明确同意这一次具体操作后才加 `-y`**，不要为了省事默认加。
- **发布默认用 `--visibility private`**（仅自己可见），除非用户明确说要公开。各平台支持的可见范围不同，看 `item publish --help`；有的平台（例如 xianyu、x）只支持 `public`，这时先告诉用户会公开发布，得到同意再发。
- **不要给真实用户发私信、评论、@ 或关注**，除非用户明确要求并给出了对象和内容。不要批量发送。
- 本地文件直接传路径（`--image ./a.jpg`），catbus 会自动上传；`--text @file` 从文件读正文。
- `item download` 默认下载到当前目录，已有文件跳过；用 `--dir` 指定目录。

## 风控

`RISK_CONTROL`（退出码 5）表示平台要求验证码、限流或封禁，`detail.kind` 为 `captcha` / `rate_limit` / `blocked`。

- **不要重试轰炸**：连续重试会让账号被标记得更久，甚至被封。停下来，把情况告诉用户。
- 小红书评论接口的人机验证（HTTP 461）通常几十秒到几分钟后自己恢复；可以建议用户过几分钟再试，不要循环重试。
- 小红书扫码登录可能在最后一步被要求验证（HTTP 471），hint 会建议改用 cookie 导入，照 hint 告诉用户。
- 需要连续执行多条命令时，命令之间留出间隔（小红书建议 4 秒以上），不要并发请求同一个平台。

## 长连接

`live listen`、`msg listen` 持续输出 jsonl，直到 Ctrl-C 或 `--duration` 到期（退出码 0）。**总是带 `--duration`**（如 `60`、`10m`），避免进程一直挂着。

```bash
catbus bilibili live listen <room> --duration 5m
```

## 常用示例

```bash
# 详情
catbus bilibili item get BV1xx411c7mD
catbus xhs item get "https://www.xiaohongshu.com/explore/<id>?xsec_token=..."
catbus x user get elonmusk

# 搜索与筛选
catbus xhs item search 露营 --sort latest --limit 50
catbus jd item search 机械键盘 --sort sales
catbus douyin item search 猫 --type video --time week

# 用户与评论
catbus bilibili user items me --limit 100 -o jsonl
catbus douyin comment list <item> --limit 100
catbus xhs comment replies <item-url> <comment-id>

# 媒体
catbus bilibili item media BV1xx411c7mD
catbus xhs item download <item-url> --dir ./downloads

# 取字段（jq）
catbus bilibili item search 猫 | jq -r '.data[] | [.id, .title, .stats.views] | @tsv'

# 发布（默认仅自己可见）
catbus weibo item publish --text "测试" --visibility private
catbus xhs item publish --title "标题" --text @note.md --image ./1.jpg --visibility private

# 登录相关（交给用户执行）
catbus xhs auth status
catbus auth list
```

## 需要注意的限制

- 各平台真机验证的进度和已知问题见仓库的 `docs/trouble.md`。例如抖音的发布目前仍会被风控拦截；B 站 `danmaku list` 只能拿到前 2 分钟的弹幕。
- 部分字段因为上游接口不返回而恒为 null（例如抖音作品没有 `title`，抖音、小红书列表没有 `stats.views`），这不是错误。
- 结果为空或字段缺失时，照实告诉用户，不要编造数据。
