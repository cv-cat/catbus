# 小红书（xhs）

| | |
|---|---|
| id / 别名 | `xhs` · `xiaohongshu` `rednote` |
| `item` 是 | 笔记（图文或视频） |
| 登录 | **cookie 导入**（推荐）· 扫码 · 短信 |

## 能做

- **读**：`item search` / `get` / `media` / `download` / `list`（自己的，带审核状态）；`user get` / `search` / `items` / `likes` / `collects` / `following`（只 me）；`comment list` / `replies`；`feed list`（推荐，`--category` 来自 `feed categories`）；`keyword hot` / `suggest`；`live get` / `list` / `categories` / `listen` / `gifts` / `products`；`notice list` / `count`；`msg list` / `history` / `listen`；`folder list`（只列公开的）；`topic search`；`poi search`。
- **写**：`item publish`；`msg send`（文本、单聊）/ `read` / `revoke` / `delete`；`live send`（弹幕，不含送礼）；`media upload`。

## 做不到

点赞、收藏、评论、关注、删笔记都还没有（`item like` / `collect` / `delete`、`comment add`、`user follow` 为 ○）；`item related`、`folder items`、`history list`、`user followers` 也没有。

## 参数

- **一律传链接**：取详情、评论要 `xsec_token`，它只在链接里。用 `search`、`feed list`、`user items` 输出的 `url`，不要只传 24 位 ID。
- 用户：主页链接（带 `xsec_token`）或 `me`。直播间：房间号或 `.../livestream/<room_id>`。
- 私信会话：单聊传对方用户 ID，群聊传 `group:<群 id>`（`msg list` 输出的 `id`）。

## 筛选

`item search`：`--sort general|latest|popular|comments|collects`，`--type all|video|image`，`--time all|day|week|half_year`。

## 坑

- **风控最严**：命令之间间隔 4 秒以上，不要并发。评论接口会间歇性要求人机验证（HTTP 461），报 `RISK_CONTROL` 就停，把 `error.hint` 里的验证链接交给用户，让他在登录了同一账号的浏览器里完成验证，之后再重试。
- 扫码登录可能在最后一步被要求验证（HTTP 471）。短信验证时 stderr 提示「验证码已发送」，向用户要 6 位验证码，从 stdin 写入一行（非交互时 catbus 从 stdin 读）；其他验证方式报 `RISK_CONTROL`，让用户改用 cookie 导入，cookie 里要有 `a1` 和 `web_session`。
- 发布走创作者中心，catbus 自动用主站登录态换取；`--image` 与 `--video` 二选一，视频必须带 `--cover`；地点先 `poi search` 再 `--poi-name <名称>`（可配 `--poi <id>`）。`--visibility` 只有 `public` / `private`。
- **发出去删不掉**（`item delete` 未实现），测试一定用 `--visibility private`。
- 列表里的 `stats.views`、`keyword hot` 的 `heat` 恒为 null。

## 示例

```bash
catbus xhs item search 露营 --sort latest --limit 20
catbus xhs item get "<笔记 url>"
catbus xhs comment list "<笔记 url>" --limit 100 -o jsonl
catbus xhs user items "<主页 url>" --limit 50
catbus xhs item download "<笔记 url>" --dir ./xhs
catbus xhs item publish --title 周末露营 --text @note.md --image 1.jpg --visibility private
```
