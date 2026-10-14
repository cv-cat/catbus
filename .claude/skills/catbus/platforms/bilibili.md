# B 站（bilibili）

| | |
|---|---|
| id / 别名 | `bilibili` · `bili` `b` |
| `item` 是 | 稿件（视频投稿） |
| 登录 | **扫码**（默认，自动续期）· 短信 · 账密 · cookie |

## 能做

- **读**：`item search` / `get` / `related` / `media` / `download` / `list` / `categories` / `subtitles`（字幕，带时间轴）；`user get` / `search` / `items`（`--keyword` 过滤）；`comment list`（稿件、专栏、动态）；`feed list`；`live get` / `search` / `categories` / `listen` / `history` / `gifts` / `media`；`folder list` / `items`；`danmaku list`；`draft get`。
- **写**：`item like` / `unlike` / `collect` / `uncollect`（`--folder`）/ `publish` / `delete`；`item coin`、`item triple`；`comment add` / `delete`；`danmaku send`；`dynamic publish` / `delete`；`article publish`（专栏）/ `draft delete`；`live send` / `start` / `stop`；`media upload`。

B 站写操作是内容平台里验证最充分的：点赞、收藏、评论增删、发弹幕、专栏草稿都已真机通过。

## 做不到

私信（`msg` 全部）、通知（`notice`）、`keyword`、`user followers` / `following` / `follow`、`comment replies`、`live list`。

## 参数

- 稿件：BV 号、av 号、纯数字 aid、视频链接，或 `b23.tv` 短链。
- 评论区的 `<item>` 还可以是专栏（`cv<id>`）或动态（动态链接、`dyn:<id>`）。
- 用户：mid（数字）、空间链接 `space.bilibili.com/<mid>` 或 `me`。
- 直播间：房间号（短号自动换真实号）、直播间链接，或主播（空间链接、`me`）。
- 收藏夹：`folder list` 输出的 id 或 url。

## 筛选

`item search`：`--sort general|views|latest|collects`，`--type video|article`。

## 坑

- **`danmaku list` 不完整**：6 分钟以内的视频只返回前 2 分钟的弹幕且不报错，更长的报 `UPSTREAM`。不要用它做完整统计，要告诉用户。
- `item delete` 需要极验点选，catbus 过不了，会报 `RISK_CONTROL`：让用户在网页端撤稿。
- `item coin` 会真的花掉硬币、`item triple` 包含投币，都是危险操作，要用户同意后才加 `-y`。
- `dynamic publish` 没有仅自己可见，发出去就公开。
- `item publish` 只能发视频；`--category` 取自 `item categories`；`--visibility` 只有 `public` / `private`。
- `user get` 的 `stats` 恒为 null（接口不给计数）。
- 图文动态（带图）的评论区不支持，纯文字和转发动态可以。

## 示例

```bash
catbus bilibili item search 猫 --sort views --limit 20
catbus bilibili item get BV1xx411c7mD
catbus bilibili item subtitles BV1xx411c7mD
catbus bilibili comment list BV1xx411c7mD --limit 200 -o jsonl
catbus bilibili user items https://space.bilibili.com/<mid> --keyword 教程
catbus bilibili live listen <房间号> --duration 10m
```
