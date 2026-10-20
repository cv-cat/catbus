# 知乎（zhihu）

| | |
|---|---|
| id / 别名 | `zhihu` · `zh` |
| `item` 是 | 回答 / 文章 / 想法（问题不是 item，另有 `question` 命令） |
| 登录 | **只能 cookie 导入**（www.zhihu.com 请求头里的完整 Cookie，关键是 `z_c0`，最好带上 `d_c0`、`_xsrf`） |

## 能做

- **读**：`item search` / `get`；`question get` / `answers`；`comment list` / `replies`；`user get` / `search` / `items` / `followers` / `following`；`feed list`（推荐、热榜、关注）；`keyword suggest` / `hot`；`folder list` / `items`；`topic search`。
- **写**：`item like` / `unlike`（赞同，回答、文章、想法都可以）；`user follow` / `unfollow`。

## 做不到

发回答、发文章、发想法、写评论、收藏、私信、通知、浏览历史、专栏都还没有；`item media` / `download` 也没有，要图片地址时看详情里的 `media[].url`。

## 参数

- item：回答 ID（纯数字），文章 `article:<id>`，想法 `pin:<id>`，或者链接：`zhihu.com/question/<问题>/answer/<回答>`、`zhuanlan.zhihu.com/p/<id>`、`zhihu.com/pin/<id>`。**输出的 `id` 就是这种形式，直接拿来用**。
- 问题：问题 ID、`question:<id>` 或 `zhihu.com/question/<id>`，只用于 `question get` / `question answers`。
- 用户：url_token（主页地址 `zhihu.com/people/<url_token>` 里的那段）、主页链接或 `me`。
- 收藏夹：收藏夹 ID 或 `zhihu.com/collection/<id>`。

## 坑

- **热榜的条目是问题**：`feed list --kind hot` 返回的 `id` 是 `question:<id>`，接着用 `question get` / `question answers`，不要传给 `item get`（会报 `USAGE`）。
- **搜索只出回答、文章、想法**：结果里的问题、视频、专题被过滤掉，所以一页可能不满 20 条。`--type text` 只要回答，`--type article` 只要文章。同一关键词知乎最多给约 200 条。
- **要全部评论加 `--sort latest`**：默认按热度只能翻到前两百条左右。
- **风控**：请求太密会被要求人机验证（`RISK_CONTROL`，`detail.kind` 为 `captcha`，`detail.verify_url` 是验证页）。在登录了同一账号的浏览器里打开验证链接完成验证再重试；批量翻页时放慢。机房 IP 很容易直接被拦。
- `user items` 默认是回答，`--type article` 是文章；`--sort popular` 按赞同数。
- `--time` 由知乎判定（按最近更新），`--time day` 也会出现很久以前发布的内容。批量采集时按 `id` 去重，知乎偶尔会在相邻两页返回同一条。
- 赞同后马上 `item get` 可能还是旧计数（知乎缓存 15–30 秒），不要因此重复赞同：再执行一次 `like` 不会多赞，但没必要。
- 扫码登录还不支持，只能导入 cookie。

## 示例

```bash
catbus zhihu item search 机械键盘 --sort popular --time month
catbus zhihu item get "https://www.zhihu.com/question/<问题>/answer/<回答>"
catbus zhihu question answers <问题> --limit 20
catbus zhihu comment list <回答> --all -o jsonl > comments.jsonl
catbus zhihu feed list --kind hot
catbus zhihu user items <url_token> --type article --limit 50
```
