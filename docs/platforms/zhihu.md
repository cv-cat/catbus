# 知乎（zhihu）

| 项 | 值 |
|---|---|
| 平台 id | `zhihu` |
| 别名 | `zh` |
| `item` 指 | 回答 / 文章 / 想法（问题不是 item，见下方扩展命令 `question`） |
| 上游仓库 | 无，直接对接知乎 web 端接口，端点记录在 [`src/platforms/zhihu/UPSTREAM`](../../src/platforms/zhihu/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 26 条（✓ 22 · ◐ 4），规划中 ○ 27 条 |

命令表与 `catbus platforms zhihu` 一致；选项以 `catbus zhihu <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| cookie（默认，也是唯一方式） | `catbus zhihu auth login --cookie @zhihu-cookie.txt` | 从 www.zhihu.com 的 DevTools → Network 复制任意请求的完整 Cookie 请求头 |

- cookie 里必须有登录态 `z_c0`。`d_c0`（设备标识，参与请求签名）和 `_xsrf`（写操作要带）最好一起复制；缺了 catbus 会按网页的做法补一个。
- `z_c0` 是 HttpOnly 的，Console 里的 `document.cookie` 拿不到，一定要从请求头复制。
- 扫码登录还没有支持：在服务器等环境轮询扫码状态时，知乎经常要求人机验证。
- 更完整的登录说明见 [登录指南](../guide/login.md)。

## 支持的命令

✓ 已实现，◐ 部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示知乎没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | cookie 导入，调 `/api/v4/me` 校验。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` / `list` / `use` | ✓ | 由 core 实现。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 用户资料。`stats.items` 是回答数加文章数，`stats.likes` 是获得的赞同数。 |
| `user search` | ✓ | 搜索用户。 |
| `user items` | ◐ | 回答（默认）或文章，不含想法和视频。取值：`--type` text（回答）/ article；`--sort` latest（默认）/ popular（按赞同）。 |
| `user followers`、`user following` | ✓ | 粉丝、关注的人。省略用户时为 `me`。 |
| `user follow`、`user unfollow` | ✓ | 关注、取消关注。 |
| `user likes` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 回答、文章或想法的详情，按参数形态区分。正文转成纯文本，图片在 `media` 里。 |
| `item search` | ◐ | 综合搜索，只输出回答、文章和想法；同一关键词知乎最多给约 200 条。取值：`--sort` general / popular（最多赞同）/ latest；`--type` all / text（回答）/ article；`--time` all / day / week / month / half_year / year。 |
| `item like`、`item unlike` | ✓ | 赞同、取消赞同，回答、文章、想法都可以。 |
| `item related`、`item list`、`item media`、`item download`、`item collect`、`item uncollect`、`item publish`、`item delete` | ○ | 规划中 |

### question（扩展）

| 命令 | 状态 | 说明 |
|---|---|---|
| `question get <question>` | ✓ | 问题详情，输出 `Question`：`stats` 里有浏览、回答、关注、评论数。 |
| `question answers <question>` | ✓ | 问题下的回答。`--sort general`（默认排序）/ `latest`（按时间）。 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 一级评论，回答、文章、想法都可以。`--sort popular`（默认，同网页）按热度，知乎只给前两百条左右；要全部一级评论用 `--sort latest`（按时间）。 |
| `comment replies` | ✓ | 某条一级评论下的回复，`parent_id` 是被回复的那条。 |
| `comment add`、`comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | `--kind` recommend（默认，首页推荐）/ hot（热榜）/ following（关注动态）。热榜的条目是问题，`id` 为 `question:<id>`。 |

### keyword / topic / folder

| 命令 | 状态 | 说明 |
|---|---|---|
| `keyword suggest` | ✓ | 搜索联想词。知乎的联想会忽略符号：`c++` 按 `c` 联想。 |
| `keyword hot` | ✓ | 搜索框的热搜词（`heat` 为 null，接口不给热度）。 |
| `topic search` | ✓ | 搜索话题，`stats.items` 是话题下的问题数。 |
| `folder list` | ✓ | 收藏夹列表，省略用户时为 `me`。 |
| `folder items` | ✓ | 收藏夹里的回答、文章、想法。 |
| `folder create`、`folder update`、`folder delete` | ○ | 规划中 |

### 整组规划中

| resource | 命令 |
|---|---|
| `notice` | `list` `count` |
| `msg` | `list` `history` `send` `read` `delete` |
| `media` | `upload` |
| `series`（专栏） | `list` `items` |
| `history` | `list` |

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 内容 `<item>` | 回答 ID（纯数字）、`article:<id>`、`pin:<id>`，或链接 `https://www.zhihu.com/question/<问题>/answer/<回答>`、`https://www.zhihu.com/answer/<回答>`、`https://zhuanlan.zhihu.com/p/<id>`、`https://www.zhihu.com/pin/<id>` |
| 问题 `<question>` | 问题 ID、`question:<id>`、`https://www.zhihu.com/question/<id>`（也认回答链接里的问题） |
| 用户 `<user>` | url_token（主页地址 `zhihu.com/people/<url_token>` 里的那段）、主页链接，或 `me` |
| 收藏夹 `<folder>` | 收藏夹 ID，或 `https://www.zhihu.com/collection/<id>` |

输出的 `id` 都是上表的形式（回答是纯数字，文章、想法、问题带前缀），可以直接作为下一条命令的参数。

## 示例

```bash
# 导入 cookie（从文件读取，避免 cookie 出现在 shell 历史里）
catbus zhihu auth login --cookie @zhihu-cookie.txt

# 搜索最近一个月赞同最多的内容
catbus zhihu item search 机械键盘 --sort popular --time month

# 热榜，然后看第一个问题下的回答
catbus zhihu feed list --kind hot
catbus zhihu question answers question:<问题 ID> --limit 20

# 回答详情和全部评论（jsonl，一行一条）
catbus zhihu item get "https://www.zhihu.com/question/<问题>/answer/<回答>"
catbus zhihu comment list <回答 ID> --sort latest --all -o jsonl > comments.jsonl

# 某个用户的全部文章
catbus zhihu user items <url_token> --type article --all -o jsonl > articles.jsonl
```

## 已知限制

- **风控**：请求太密，或者从机房 IP 访问时，知乎会要求人机验证（HTTP 403，业务码 40352），catbus 报 `RISK_CONTROL`（`detail.kind` 为 `captcha`），`detail.verify_url` 和 `hint` 里是验证页，在登录了同一账号的浏览器里打开、完成验证后再重试。业务码 40362（请求异常）报 `RISK_CONTROL`（`blocked`）。
- **签名**：`/api` 下的请求都带 `x-zse-96` 签名（`src/platforms/zhihu/web/sign.ts`）。知乎更新签名后会返回业务码 10003（「请求参数异常」），catbus 报 `UPSTREAM`，需要升级。
- **真机验证**：全部命令都用真实账号跑过，读命令含筛选、多页翻页、`--all`；写操作（回答、文章、想法的赞同与取消，关注与取消关注）都确认生效并撤销过。
- **写完立刻读可能是旧数据**：知乎的详情接口有缓存，赞同后马上 `item get` 可能还是赞同前的计数，要过 15–30 秒才更新；写操作本身已经生效。
- `--time` 由知乎判定，看起来按内容最近的更新算，不是发布时间：`--time day` 也会出现几年前发布、最近被编辑过的内容。
- 知乎的搜索偶尔在相邻两页返回同一条内容；同一页里的重复会去掉，跨页的极少，批量采集时按 `id` 去重即可。
- `stats.views` 只有搜索结果里的回答有；`stats.collects` 在搜索结果和详情里有，用户回答 / 文章列表里没有。粉丝、关注列表里的用户没有关注数和获赞数（接口不给）。
- 搜索结果里的问题、视频、专题等不输出，一页可能不满 20 条；同一关键词最多约 200 条（知乎的上限），`--limit` 再大也取不到更多。
- 评论按热度（默认）只能翻到前两百条左右，`--all` 要拿全部一级评论时加 `--sort latest`。
- 视频（`zhihu.com/zvideo/...`）还不支持，传给 `item get` 报 `UNSUPPORTED`。回答里的视频以链接形式留在正文里，不进 `media`。
- 不存在的回答、文章、想法、问题、用户报 `UPSTREAM`（退出码 7）；不存在的评论、楼中楼、收藏夹，知乎直接返回空列表，catbus 也输出空列表。
- 粉丝列表按 offset 翻页，翻的过程中有人新关注会让后面的条目整体后移，大量翻页时会有极少数重复（2000 条里约 2 条），按 `id` 去重。
- 热榜的热度值（「1234 万热度」）没有对应的字段，不输出。
