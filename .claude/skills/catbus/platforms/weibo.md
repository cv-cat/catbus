# 微博（weibo）

| | |
|---|---|
| id / 别名 | `weibo` · `wb` |
| `item` 是 | 微博 |
| 登录 | **只能 cookie 导入**（weibo.com 的 Cookie，关键是 `SUB`） |

## 能做

- **读**：`item search`（只有第一页）/ `get`；`user get` / `items`；`comment list`（只有一级评论）；`feed list`（推荐流 `--kind recommend`、关注流 `--kind following`，都要登录）。
- **写**：`item publish`（仅自己可见的发布已真机验证）；`media upload`。

能力比较少，用户要的东西多半在「做不到」里，先查 `catbus platforms weibo`。

## 做不到

热搜、用户搜索、关注、点赞、转发、发评论、删微博、私信、通知、直播都还没有；`item media` / `download` 也没有，要媒体地址时看详情里的 `media[].url`。

## 参数

- 微博：mid（16 位数字）、mblogid（如 `OuIv3hbiw`），或 `weibo.com/<uid>/<mblogid>`、`m.weibo.cn/detail/<mid>` 等链接。
- 用户：uid、`weibo.com/u/<uid>`、`m.weibo.cn/u/<uid>` 或 `me`。

## 坑

- **搜索只有第一页**：`--limit` / `--all` 也只返回第一页，告诉用户数量有限。
- **发出去删不掉**（`item delete` 未实现），测试用 `--visibility private`。
- `--visibility` 支持全部四个值：`public`、`private`（仅自己）、`friends`（好友圈）、`fans`（粉丝）。
- 地点用 `--poi-name <名称>`，发成地点标签；没有 `--poi`。

## 示例

```bash
catbus weibo item search 露营
catbus weibo item get "https://weibo.com/<uid>/<mblogid>"
catbus weibo user items <uid> --limit 50
catbus weibo comment list <微博> --limit 100
catbus weibo item publish --text "测试" --image a.jpg --visibility private
```
