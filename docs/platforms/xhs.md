# 小红书（xhs）

| 项 | 值 |
|---|---|
| 平台 id | `xhs` |
| 别名 | `xiaohongshu`、`rednote` |
| `item` 指 | 笔记 |
| 上游仓库 | [cv-cat/Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| 移植基线 | master 上的 [`ebb6c4f`](https://github.com/cv-cat/Spider_XHS/commit/ebb6c4fbeaedf1237190ebc0c8e3ae8b7ddd030e)，记录在 [`src/platforms/xhs/UPSTREAM`](../../src/platforms/xhs/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 43 条（✓ 38 · ◐ 5），规划中 ○ 28 条 |

命令表由注册表生成，与 `catbus platforms xhs` 一致；选项以 `catbus xhs <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus xhs auth login` | 目前手机确认后常被要求人机验证（HTTP 471），报 `RISK_CONTROL`，见下方「已知限制」。**建议先用 cookie 导入** |
| 短信 | `catbus xhs auth login --method sms --phone <手机号>` | 终端里会提示输入验证码；非交互环境分两步，第二步用 `--code <验证码>` |
| cookie | `catbus xhs auth login --method cookie --cookie @xhs-cookie.txt` | 从 www.xiaohongshu.com 的 DevTools → Network 复制完整的 Cookie 请求头 |

- cookie 里必须有 `a1`（长度 52）和 `web_session`。`web_session` 是 HttpOnly 的，Console 里的 `document.cookie` 拿不到，一定要从请求头复制。
- **子站点 `creator`（创作者中心）**：`item list`、`item publish`、`topic search`、`poi search`、`media upload` 走创作者中心。catbus 用主站登录态自动换取创作者中心的会话，失效时自动重新换一次，一般不需要单独登录。换取失败时会报 `AUTH_REQUIRED`，`hint` 是 `catbus xhs auth login --scope creator`（支持扫码、短信，或 `--method cookie` 导入 creator.xiaohongshu.com 的 cookie）。
- 更完整的登录说明见 [登录指南](../guide/login.md)。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示小红书没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 用户资料。 |
| `user search` | ✓ | 搜索用户。 |
| `user items` | ✓ | 用户发布的笔记。 |
| `user likes` | ✓ | 用户点赞的笔记。 |
| `user collects` | ✓ | 用户收藏的笔记。 |
| `user following` | ◐ | 关注列表。只支持 me。 |
| `user followers`、`user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 笔记详情。 |
| `item search` | ✓ | 搜索笔记。取值：`--sort` general / latest / popular / comments / collects；`--type` all / video / image；`--time` all / day / week / half_year。 |
| `item list` | ✓ | 我发布的笔记，带审核状态。走创作者中心（creator 子站点）。 |
| `item media` | ✓ | 笔记的媒体地址。 |
| `item download` | ✓ | 下载笔记的媒体。 |
| `item publish` | ✓ | 发布笔记。走创作者中心；`--image` 和 `--video` 二选一，视频要同时给 `--cover`；`--poi` 要和 `--poi-name` 一起用。取值：`--visibility` public / private。不支持 `--mention`、`--category`、`--price`。私有选项 `--poi-name`。 |
| `item related`、`item like`、`item unlike`、`item collect`、`item uncollect`、`item delete` | ○ | 规划中 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 评论列表。`--product` 规划中。 |
| `comment replies` | ✓ | 评论的回复。 |
| `comment add`、`comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | 推荐 / 热门 / 关注流。following 规划中。取值：`--kind` recommend / following。 |
| `feed categories` | ✓ | 推荐流分类。 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播间信息。 |
| `live list` | ✓ | 直播列表。 |
| `live categories` | ✓ | 直播分类。 |
| `live listen` | ✓ | 监听弹幕、礼物、进场等事件。持续输出 jsonl。 |
| `live send` | ◐ | 发弹幕，或用 `--gift` 送礼。`--gift` 规划中。送礼（`--gift`）需要确认。 |
| `live gifts` | ✓ | 礼物列表。 |
| `live products` | ✓ | 直播间商品。 |
| `live search`、`live history`、`live like`、`live rank`、`live media`、`live start`、`live stop` | ○ | 规划中 |

### keyword

| 命令 | 状态 | 说明 |
|---|---|---|
| `keyword suggest` | ✓ | 搜索联想词。 |
| `keyword hot` | ✓ | 热搜词。 |

### notice

| 命令 | 状态 | 说明 |
|---|---|---|
| `notice list` | ✓ | 通知列表。 |
| `notice count` | ✓ | 未读通知数。 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg list` | ✓ | 会话列表。含群聊，群聊会话 id 为 `group:<群 id>`。 |
| `msg history` | ✓ | 会话的消息记录。单聊传对方 id，群聊传 `group:<群 id>`。 |
| `msg send` | ✓ | 发私信。只支持文本；`--to <用户>` 或 `--conversation <对方 id>`，只能单聊。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg read` | ✓ | 标记会话已读。 |
| `msg revoke` | ✓ | 撤回消息。危险操作，需要确认。 |
| `msg delete` | ✓ | 删除会话。危险操作，需要确认。 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。走创作者中心。 |

### folder

| 命令 | 状态 | 说明 |
|---|---|---|
| `folder list` | ◐ | 收藏夹列表。上游只有收藏夹列表（公开的收藏夹），没有收藏夹内容接口（`folder items` 规划中）。 |
| `folder items`、`folder create`、`folder update`、`folder delete` | ○ | 规划中 |

### topic

| 命令 | 状态 | 说明 |
|---|---|---|
| `topic search` | ✓ | 搜索话题。走创作者中心。 |

### poi

| 命令 | 状态 | 说明 |
|---|---|---|
| `poi search` | ✓ | 搜索地点。走创作者中心。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `product` | `get` |
| `series` | `list` `items` |
| `history` | `list` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item publish` | `--poi-name <名称>`，可配 `--poi <id>` | 地点。小红书的地点只能按名称搜，所以 `--poi` 要和 `--poi-name` 一起用（取 id 相同的那个）；只给 `--poi-name` 时取名称完全相同的；都找不到时报 `USAGE` 并列出相近的地点。先用 `catbus xhs poi search <名称>` 查名称和 id |

小红书没有扩展命令。定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 笔记 `<item>` | 笔记链接 `https://www.xiaohongshu.com/explore/<id>?xsec_token=...`（也认 `/discovery/item/<id>`、`/user/profile/<uid>/<id>`）、分享短链 `xhslink.com/...`，或 24 位十六进制的笔记 ID |
| 用户 `<user>` | 主页链接 `https://www.xiaohongshu.com/user/profile/<id>?xsec_token=...`、分享短链、24 位十六进制的用户 ID，或 `me` |
| 直播间 `<room>` | 房间号（数字），或直播间链接 `.../livestream/<room_id>` |
| 会话 `<conversation>` | 单聊传对方的用户 ID；群聊传 `group:<群 id>`（`msg list` 输出的 `id`） |

**优先传链接**：小红书取笔记详情、评论等要带 `xsec_token`，它只在链接里。只给纯 ID 时缺这个参数，很多接口会失败。catbus 输出的 `url` 都带 `xsec_token`，可以直接作为下一条命令的参数。

## 示例

```bash
# 导入 cookie（从文件读取，避免 cookie 出现在 shell 历史里）
catbus xhs auth login --method cookie --cookie @xhs-cookie.txt

# 搜索最新的笔记，取 20 条
catbus xhs item search 露营 --sort latest --limit 20

# 笔记详情、全部评论（jsonl，一行一条）
catbus xhs item get "<note_url>"
catbus xhs comment list "<note_url>" --all -o jsonl > comments.jsonl

# 某个用户发布的全部笔记
catbus xhs user items "<user_url>" --all -o jsonl > notes.jsonl

# 下载笔记的图片 / 视频
catbus xhs item download "<note_url>" --dir ./xhs

# 推荐流的分类，以及某个分类下的推荐
catbus xhs feed categories
catbus xhs feed list --category <category_id> --limit 30

# 发一篇仅自己可见的图文笔记（本地图片自动上传）
catbus xhs item publish --title 周末露营 --text @note.md --image 1.jpg --image 2.jpg --visibility private

# 监听直播间弹幕 10 分钟
catbus xhs live listen <room_id> --duration 10m > live.jsonl
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **扫码登录被要求人机验证**：手机确认后服务端返回 HTTP 471（`verifytype 120`），上游 Spider_XHS 同样失败。catbus 报 `RISK_CONTROL`（`detail.kind` 为 `captcha`），`hint` 提示改用 cookie 导入。cookie 导入实测可用。见 [trouble.md 第 2 节](../trouble.md#2-小红书扫码登录被要求人机验证http-471)。
- **评论接口间歇性要求人机验证**：`comment list` 偶尔返回 HTTP 461（`verifytype 124`），请求越密越容易触发，几十秒到约 4 分钟后自行恢复。报 `RISK_CONTROL`，稍等再试；批量翻页时放慢节奏。见 [trouble.md 第 3 节](../trouble.md#3-小红书评论接口间歇性要求人机验证http-461)。
- **字段恒为空**：列表里的 `stats.views`（公开接口不返回播放量）、`keyword hot` 的 `heat`（热搜接口不给热度值）。见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。
- **还没真机验证**：`msg send` / `read` / `revoke` / `delete`、`msg listen`、`live listen`、`live send`。关注列表与群聊的字段名参考了第三方代码（上游没有样本）。见 [trouble.md 6.1](../trouble.md#61-已验证平台里没测的命令)。
- **删不掉笔记**：`item delete` 上游没有（○），发出去的笔记要在 App 里手动删除。测试发布请用 `--visibility private`。
- **视频发布要给封面**：catbus 不解码视频，截不了首帧，`--video` 必须配 `--cover`。
- 蒲公英（达人）、千帆（分销）接口不提供：普通账号访问会被拒，而且被拒后评论等接口会要求人机验证。见 [AGENTS.md 4.12](../../AGENTS.md#412-不提供的能力)。
