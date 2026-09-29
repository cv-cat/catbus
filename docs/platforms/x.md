# X（x）

| 项 | 值 |
|---|---|
| 平台 id | `x` |
| 别名 | `twitter` |
| `item` 指 | 推文 |
| 上游仓库 | [cv-cat/XApis](https://github.com/cv-cat/XApis) |
| 移植基线 | master 上的 [`3fe6ea7`](https://github.com/cv-cat/XApis/commit/3fe6ea7d9700a415c14919e267d5826fc9be3e34)，记录在 [`src/platforms/x/UPSTREAM`](../../src/platforms/x/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 33 条（✓ 30 · ◐ 3），规划中 ○ 20 条 |

命令表由注册表生成，与 `catbus platforms x` 一致；选项以 `catbus x <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

X **只支持导入 cookie**：

```bash
catbus x auth login --cookie @x-cookie.txt
```

- 在浏览器登录 x.com，从 DevTools → Network 复制发往 x.com 的请求里完整的 Cookie 请求头。必须有 `auth_token`（HttpOnly，`document.cookie` 拿不到）和 `ct0`，缺了报 `USAGE`；导入后 catbus 调一次 Viewer 接口校验。
- 上游的账号密码登录依赖 Castle 反自动化令牌，catbus 没有移植，所以没有 `--method password`。
- `auth status` 的 `expires_at` 取自 `auth_token` 的过期时间。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示 X 没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

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
| `user items` | ✓ | 用户发布的推文。 |
| `user follow` | ✓ | 关注。 |
| `user unfollow` | ✓ | 取消关注。 |
| `user likes`、`user collects`、`user reposts`、`user followers`、`user following` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 推文详情。 |
| `item search` | ✓ | 搜索推文。`--type video / image` 走媒体搜索，按类型过滤，不能和 `--sort latest` 一起用。取值：`--sort` general / latest；`--type` all / video / image。 |
| `item media` | ✓ | 推文的媒体地址。 |
| `item download` | ✓ | 下载推文的媒体。 |
| `item like` | ✓ | 点赞。 |
| `item unlike` | ✓ | 取消点赞。 |
| `item collect` | ✓ | 收藏。 |
| `item uncollect` | ✓ | 取消收藏。 |
| `item repost` | ✓ | 转发。 |
| `item unrepost` | ✓ | 取消转发。 |
| `item publish` | ✓ | 发布推文。正文超过 280 权重时自动按长推发（需要 Premium）；`--thread` 发 thread。最多 4 张图片，图片和视频不能同时用。取值：`--visibility` public。不支持 `--title`、`--cover`、`--tag`、`--topic`、`--mention`、`--poi`、`--category`、`--schedule`、`--price`。私有选项 `--thread`。 |
| `item delete` | ✓ | 删除推文。危险操作，需要确认。 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ✓ | 评论列表。 |
| `comment add` | ✓ | 发表评论。按回复推文发出。 |
| `comment delete` | ✓ | 删除评论。危险操作，需要确认。 |
| `comment like` | ✓ | 点赞评论。 |
| `comment unlike` | ✓ | 取消点赞评论。 |
| `comment replies` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | 推荐 / 热门 / 关注流。following 规划中。取值：`--kind` recommend / following。 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg list` | ◐ | 会话列表。只取收件箱首页（最近 20 个会话），上游没有翻页。 |
| `msg history` | ◐ | 会话的消息记录。消息端到端加密，只给出占位消息。 |
| `msg send`、`msg listen`、`msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### article

| 命令 | 状态 | 说明 |
|---|---|---|
| `article publish` | ✓ | 发文章（Premium 长文）：建草稿，写标题、正文、封面，再发布。平台扩展。 |
| `article delete` | ✓ | 删文章（草稿或已发布的）。平台扩展。危险操作，需要确认。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `keyword` | `suggest` `hot` |
| `notice` | `list` `count` |
| `folder` | `list` `items` `create` `update` `delete` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item publish` | `--thread <text>`，可重复 | 发 thread：`--text` 是第一条，每个 `--thread` 是后面的一条，依次回复上一条；`--image` / `--video` / `--quote` 只作用于第一条。返回第一条 |
| `item publish` | `--quote <推文>` | 引用一条推文（ID 或 URL），发成引用。这是标准发布选项，目前只有 X 支持 |

- 正文超过 280 权重（按 twitter-text v3 计算，中文等宽字符算 2）时自动按长推发，需要 Premium。
- `item search --type video|image` 走媒体搜索，按 `Item.kind` 过滤，不能和 `--sort latest` 一起用。

| 扩展命令 | 说明 | 输出 |
|---|---|---|
| `article publish --text <Markdown> [--title] [--cover]` | 发文章（Premium 长文）：依次建草稿、写标题、正文、封面，再发布。不给 `--title` 时取正文第一行的 `# 标题`。独占一行的 `![](图片)` 上传成插图，相对路径按 `--text @file` 的文件所在目录解析（直接给正文时按当前目录） | `{id url}` |
| `article delete <article>` | 删文章：草稿或已发布的都可以，已发布的连同文章推文一起删。需要确认 | `{id}` |

定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 推文 `<item>` / `--quote` | 纯数字的推文 ID，或推文链接 `https://x.com/<用户名>/status/<id>`（`twitter.com` 也可以） |
| 用户 `<user>` | 用户名（`<username>` 或 `@<username>`）、主页链接 `https://x.com/<用户名>`、纯数字的用户 ID（rest_id），或 `me` |
| 评论 `<comment>` | 回复推文的 ID（`comment list` 输出的 `id`） |
| 文章 `<article>` | 文章 ID，或 `https://x.com/i/article/<id>`、编辑页 `https://x.com/compose/articles/edit/<id>` |
| 会话 `<conversation>` | `msg list` 输出的会话 `id` |

**纯数字按用户 ID 处理**：这样输出里的 `id` 可以直接作为下一条命令的参数。全数字的用户名要写成 `@123` 或主页链接。

## 示例

```bash
# 导入 cookie
catbus x auth login --cookie @x-cookie.txt

# 用户资料与最近的推文
catbus x user get @<username>
catbus x user items @<username> --limit 100 -o jsonl > tweets.jsonl

# 搜索最新推文；只看带视频的
catbus x item search "open source" --sort latest --limit 50
catbus x item search "open source" --type video

# 推文详情、回复、下载媒体
catbus x item get "<tweet_url>"
catbus x comment list "<tweet_url>" --all -o jsonl
catbus x item download "<tweet_url>" --dir ./x

# 发一个 3 条的 thread，第一条带图
catbus x item publish --text "第一条" --image cat.png --thread "第二条" --thread "第三条"

# 用 Markdown 文件发文章（需要 Premium）
catbus x article publish --text @post.md --cover cover.png
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **还没有做真机验证**：X 的只读命令和写操作都还没开始验证（见 [trouble.md 6.2](../trouble.md#62-各平台进度)）。对拍测试保证请求与上游一致，但字段取值、风控表现还没在真账号上确认。长推和文章需要 Premium 账号。
- **私信是端到端加密的**：`msg history` 只给出占位消息，原始事件用 `--raw` 查看；`msg send` / `listen` 规划中。
- **`msg list` 只有收件箱首页**：最近 20 个会话，上游没有翻页接口。
- **`feed list --kind following`** 规划中，目前只有推荐流。
- 一条推文最多 4 张图片，图片和视频不能同时用。
