# B 站（bilibili）

| | |
|---|---|
| id / 别名 | `bilibili` · `bili` `b` |
| `item` 是 | 稿件（视频投稿） |
| 登录 | **扫码**（默认，自动续期）· 短信 · 账密 · cookie |

## 能做

- **读**：`item search` / `get` / `related` / `media` / `download` / `list` / `categories` / `subtitles`（字幕，带时间轴）；`user get` / `search` / `items`（`--keyword` 过滤）；`comment list`（稿件、专栏、纯文字 / 转发 / 图文动态）；`comment replies`（视频、专栏、图文动态根评论下的可见楼中楼）；`feed list`（`--kind recommend|hot|following`，following 只列关注的人的视频投稿，需要登录）；`live get` / `search` / `categories` / `listen` / `history` / `gifts` / `media`；`folder list` / `items`；`danmaku list`；`draft get`。
- **写**：`item like` / `unlike` / `collect` / `uncollect`（`--folder`）/ `publish` / `delete`；`item coin`、`item triple`；`comment add` / `delete`；`danmaku send`；`dynamic publish` / `delete`；`article publish`（专栏）/ `draft delete`；`live send` / `start` / `stop`；`media upload`；`user update`（`--name` / `--avatar` / `--bio`，改当前账号资料）。

B 站写操作是 10 个平台里验证最充分的：点赞、收藏、评论增删、发弹幕、专栏草稿都已真机通过。

## 做不到

私信（`msg` 全部）、通知（`notice`）、`keyword`、`user followers` / `following` / `follow`、`live list`。

## 参数

- 稿件：BV 号、av 号、纯数字 aid、视频链接，或 `b23.tv` 短链。
- `comment list` 的 `<item>` 还可以是专栏（`cv<id>`）或动态（动态链接、`dyn:<id>`），动态包括纯文字、转发和图文。`comment replies <item> <comment>` 支持视频、专栏及图文动态，`<comment>` 取 `comment list` 返回的根评论 ID。
- 用户：mid（数字）、空间链接 `space.bilibili.com/<mid>` 或 `me`。
- 直播间：房间号（短号自动换真实号）、直播间链接，或主播（空间链接、`me`）。
- 收藏夹：`folder list` 输出的 id 或 url。

## 筛选

`item search`：`--sort general|views|latest|collects`，`--type video|article`。

## 坑

- `comment replies` 是非上游接口，读取视频、专栏及图文动态指定根评论下可见的楼中楼；纯文字和转发动态的楼中楼尚未验证，不支持。默认每页 10 条，用 `--limit` / `--all` 自动翻页，续读时原样传回 `page.cursor`。`parent_id` 是直接父评论 ID，可能指向另一条子回复；原始 `root` / `parent` 用 `--raw` 取。`comment list --raw` 的 `replies` 只是预览。
- 图文动态先请求非上游动态详情接口，用 `basic.comment_type=11`、`comment_id_str` 定位相簿评论区；输出 `item_id` 仍为动态 ID。翻页复用本次解析结果，不写入凭证。
- **`danmaku list` 不完整**：6 分钟以内的视频只返回前 2 分钟的弹幕且不报错，更长的报 `UPSTREAM`。不要用它做完整统计，要告诉用户。
- `item delete` 需要极验点选，catbus 过不了，会报 `RISK_CONTROL`：让用户在网页端撤稿。
- `item coin` 会真的花掉硬币、`item triple` 包含投币，都是危险操作，要用户同意后才加 `-y`。
- `user update --name` 每次扣 6 个硬币（从没设过昵称的账号免费一次），要用户同意后才加 `-y`；`--bio` 最多 70 字，改完要审核，返回的资料里可能还是旧签名；`--avatar` 只收 png / jpg，不超过 2MB。
- `dynamic publish` 没有仅自己可见，发出去就公开。
- `item publish` 只能发视频；`--category` 取自 `item categories`；`--visibility` 只有 `public` / `private`。
- `user get` 的 `stats` 恒为 null（接口不给计数）。
- `comment add` / `delete` 的动态目标仍只支持纯文字和转发；图文动态只开放读取。视频 / 专栏动态请直接传 BV / cv 号。

## 示例

```bash
catbus bilibili item search 猫 --sort views --limit 20
catbus bilibili item get BV1xx411c7mD
catbus bilibili item subtitles BV1xx411c7mD
catbus bilibili comment list BV1xx411c7mD --limit 200 -o jsonl
catbus bilibili comment replies BV1xx411c7mD <根评论ID> --all -o jsonl
catbus bilibili comment replies cv<专栏ID> <根评论ID> --all -o jsonl
catbus bilibili comment replies 'https://www.bilibili.com/opus/<图文动态ID>' <根评论ID> --all -o jsonl
catbus bilibili user items https://space.bilibili.com/<mid> --keyword 教程
catbus bilibili live listen <房间号> --duration 10m
```
