# 微博（weibo）

| 项 | 值 |
|---|---|
| 平台 id | `weibo` |
| 别名 | `wb` |
| `item` 指 | 微博 |
| 上游仓库 | [cv-cat/WeiboApis](https://github.com/cv-cat/WeiboApis) |
| 移植基线 | master 上的 [`757582c`](https://github.com/cv-cat/WeiboApis/commit/757582c41831cda3723c41b4544b93d4f47fe179)，记录在 [`src/platforms/weibo/UPSTREAM`](../../src/platforms/weibo/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 12 条（✓ 10 · ◐ 2），规划中 ○ 55 条 |

上游 WeiboApis 的能力不多（用户、微博详情、评论、搜索、发布），所以微博的大部分命令还是规划中。命令表由注册表生成，与 `catbus platforms weibo` 一致；选项以 `catbus weibo <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

微博**只支持导入 cookie**（上游没有登录接口）：

```bash
catbus weibo auth login --cookie @weibo-cookie.txt
```

- 在浏览器登录 weibo.com，从 DevTools → Network 复制发往 weibo.com 的请求里完整的 Cookie 请求头。登录态的关键 cookie 是 `SUB`，导入后 catbus 取一次当前账号校验。
- 登录态的过期时间取自 cookie `ALF`（或 `SUB` 的过期时间），`auth status` 的 `expires_at` 就是它。
- 微博详情和搜索走 m.weibo.cn：登录 cookie 属于 .weibo.com，不会发往 m.weibo.cn，catbus 在那边自动生成新浪访客 cookie。这只是 m.weibo.cn 的访问方式，web 端没有游客态，其余命令都需要登录。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示微博没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

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
| `user items` | ✓ | 用户发布的微博。 |
| `user search`、`user likes`、`user collects`、`user reposts`、`user followers`、`user following`、`user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 微博详情。 |
| `item search` | ◐ | 搜索微博。只能取第一页（m.weibo.cn 的访客从第二页起要求登录）。 |
| `item publish` | ✓ | 发布微博。`--image`（最多 15 张）和 `--video` 不能同时用。取值：`--visibility` public / private / friends / fans。不支持 `--title`、`--cover`、`--tag`、`--mention`、`--poi`、`--category`、`--schedule`、`--price`。私有选项 `--poi-name`。 |
| `item list`、`item media`、`item download`、`item like`、`item unlike`、`item collect`、`item uncollect`、`item repost`、`item unrepost`、`item delete` | ○ | 规划中 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 评论列表。只有一级评论。 |
| `comment replies`、`comment add`、`comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `feed` | `list` |
| `live` | `get` `list` `search` `categories` `listen` `history` `send` `like` `rank` `gifts` `products` `media` `replays` `start` `stop` |
| `keyword` | `suggest` `hot` |
| `notice` | `list` `count` |
| `msg` | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `folder` | `list` `items` |
| `history` | `list` |
| `topic` | `search` |
| `poi` | `search` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item publish` | `--poi-name <名称>` | 地点名称，发成「#名称[地点]#」的地点标签。微博发布没有地点 id，所以不支持 `--poi` |

`item publish --visibility` 支持全部四个标准取值：`public` 公开、`private` 仅自己、`friends` 好友圈（互相关注）、`fans` 粉丝可见。

微博没有扩展命令。定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 微博 `<item>` | mid（16 位数字）、mblogid（9 位左右的字母数字，如 `OuIv3hbiw`），或链接 `https://weibo.com/<uid>/<mblogid>`、`weibo.com/detail/<mid>`、`m.weibo.cn/detail/<mid>`、`m.weibo.cn/status/<mblogid>`、`m.weibo.cn/<uid>/<mid>` |
| 用户 `<user>` | uid（数字）、主页链接 `https://weibo.com/u/<uid>`、`weibo.com/<uid>`、`m.weibo.cn/u/<uid>`、`m.weibo.cn/profile/<uid>`，或 `me` |

## 示例

```bash
# 导入 cookie
catbus weibo auth login --cookie @weibo-cookie.txt
catbus weibo auth status

# 用户资料与发布的微博
catbus weibo user get <uid>
catbus weibo user items "https://weibo.com/u/<uid>" --limit 50 -o jsonl

# 微博详情与评论
catbus weibo item get "<weibo_url>"
catbus weibo comment list "<weibo_url>" --all -o jsonl > comments.jsonl

# 搜索（只有第一页）
catbus weibo item search 咖啡

# 发一条仅自己可见的微博，带图和地点标签
catbus weibo item publish --text "今天的咖啡" --image latte.jpg --poi-name 上海 --visibility private
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **搜索只能取第一页**：m.weibo.cn 的访客从第二页起要求登录，`--limit` / `--all` 也只会返回第一页。
- **只有一级评论**：`comment list` 不含楼中楼；`comment replies` 规划中。
- **删不掉微博**：`item delete` 上游没有（○），发出去的微博要在网页或 App 里手动删除。测试发布请用 `--visibility private`。
- **PC 端详情不移植**：上游的 `WeiboApis.getWorkInfo` 取的是 weibo.com 页面里的 `$CONFIG`，现在的 weibo.com 是单页应用，那里没有正文；catbus 的 `item get` 走 m.weibo.cn。
- 验证进度：cookie 登录和全部 7 条已实现的只读命令都已真机通过，仅自己可见的发布和图片上传也已验证。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
