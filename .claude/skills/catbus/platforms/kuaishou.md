# 快手（kuaishou）

| | |
|---|---|
| id / 别名 | `kuaishou` · `ks` |
| `item` 是 | 作品（短视频或图集） |
| 登录 | **扫码**（默认）· 短信 · cookie；主站、创作者中心、直播站的票据一次换齐 |

## 能做

- **读**：`item search`（没有筛选）/ `get` / `related` / `media` / `download` / `list`；`user get` / `search` / `items` / `collects`；`user likes` / `followers` / `following`（只 me）；`comment list` / `replies`；`feed list`（推荐；关注流只有首屏）；`live get` / `list` / `categories` / `listen` / `gifts` / `media` / `replays`（任何直播间都能查，不限于直播首页里的）；`notice count`。
- **写**：`item publish`（仅自己可见的图集发布已真机验证）；`media upload`。

## 做不到

点赞、收藏、评论、关注、删作品；私信（`msg` 全部）；`live send` / `search`；`keyword`；`notice list`。

## 参数

- 作品：photoId（`3x...`）、`kuaishou.com/short-video/<id>`，或分享短链（`v.kuaishou.com` 等）。
- 用户：用户 ID（eid）、主页链接 `kuaishou.com/profile/<id>`、分享短链或 `me`。
- 直播间：主播 ID，或 `live.kuaishou.com/u/<id>`。

## 坑

- **直播间的主播 id 和主页 id 是两套**：`live get` 返回的 `host` 链接不能当用户参数，传给 `user get` 会报 `USAGE`。要查主播资料，让用户给主页链接。
- 连续请求详情、评论时可能要求过滑块（`400002`），catbus 试一次，没过报 `RISK_CONTROL`：放慢，或让用户先在浏览器里过一次。
- `item publish`：图集 1～31 张（每张 ≤15MB）或一个视频；没有 `--cover` / `--mention` / `--poi` / `--category`；`--visibility` 支持 `public` / `private` / `friends`。
- **发出去删不掉**（`item delete` 未实现），测试用 `--visibility private`。
- `user get` / `search` 的 `stats` 恒为 null；`notice count` 只有总数。

## 示例

```bash
catbus kuaishou item search 美食 --limit 20
catbus kuaishou item get "https://www.kuaishou.com/short-video/<id>"
catbus kuaishou comment list <作品> --limit 100 -o jsonl
catbus kuaishou user items "https://www.kuaishou.com/profile/<id>" --limit 50
catbus kuaishou live listen <主播 ID> --duration 10m
```
