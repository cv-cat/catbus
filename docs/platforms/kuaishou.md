# 快手（kuaishou）

| 项 | 值 |
|---|---|
| 平台 id | `kuaishou` |
| 别名 | `ks` |
| `item` 指 | 作品（短视频或图集） |
| 上游仓库 | [cv-cat/KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| 移植基线 | `feat/fix-slider-fingerprint-http2` 分支的 [`552cf60`](https://github.com/cv-cat/KuaiShou-Spider/commit/552cf60e59f6e97c759956b229f3f5563fb152bc)（还没合进上游 master），记录在 [`src/platforms/kuaishou/UPSTREAM`](../../src/platforms/kuaishou/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 30 条（✓ 25 · ◐ 5），规划中 ○ 41 条 |

命令表由注册表生成，与 `catbus platforms kuaishou` 一致；选项以 `catbus kuaishou <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus kuaishou auth login` | 真机验证可用 |
| 短信 | `catbus kuaishou auth login --method sms --phone <手机号>` | 终端里会提示输入验证码；非交互环境分两步，第二步用 `--code <验证码>` |
| cookie | `catbus kuaishou auth login --method cookie --cookie @ks-cookie.txt` | 从 www.kuaishou.com 的 DevTools → Network 复制完整的 Cookie 请求头 |

- 快手的凭证分三个站点：主站 www、创作者中心 cp、直播站 live。**登录时 catbus 一并换取三个站点的票据**，不需要分别登录，也没有 `--scope`。
  - cookie 导入时 catbus 在线校验一次；cookie 里有 `passToken` 时，缺的创作者中心票据（`kuaishou.web.cp.api_st` / `api_ph`）和直播站票据（`kuaishou.live.web_st` / `web_ph`）会用它自动换取，换不到只提示、不报错。
  - 创作者中心：`item list`、`item publish`、`media upload`、`notice count`；直播站：`live get` / `list` / `categories` / `gifts` / `listen`。
- **服务端登出**：`auth logout` 会同时在快手服务端登出，再删除本地凭证。
- 签名用的 `kwscode` / `kwssectoken` 只有 6 分钟有效期，每条命令现算，不落盘。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示快手没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证，同时在服务端登出。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 用户资料。 |
| `user search` | ✓ | 搜索用户。 |
| `user items` | ✓ | 用户发布的作品。 |
| `user likes` | ✓ | 用户点赞的作品。只支持 me。 |
| `user collects` | ✓ | 用户收藏的作品。 |
| `user followers` | ✓ | 粉丝列表。只支持 me。 |
| `user following` | ✓ | 关注列表。只支持 me。 |
| `user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 作品详情。 |
| `item search` | ◐ | 搜索作品。没有筛选（不支持 `--sort` / `--type` / `--time`），只按关键词搜。 |
| `item related` | ✓ | 相关推荐。 |
| `item list` | ✓ | 我发布的作品，带审核状态。 |
| `item media` | ✓ | 作品的媒体地址。 |
| `item download` | ✓ | 下载作品的媒体。 |
| `item publish` | ◐ | 发布作品。只支持部分发布选项（见下面的「不支持」）。`--image`（1～31 张，每张不超过 15MB）和 `--video` 二选一。取值：`--visibility` public / private / friends。不支持 `--cover`、`--mention`、`--poi`、`--category`、`--price`。 |
| `item like`、`item unlike`、`item collect`、`item uncollect`、`item delete` | ○ | 规划中 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 评论列表。`--product` 规划中。 |
| `comment replies` | ◐ | 评论的回复。上游的二级评论接口只对一组抓包核对过的参数放行；catbus 按同样的请求格式对任意评论发送，其余参数的结果没有经过上游核对。 |
| `comment add`、`comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | 推荐 / 热门 / 关注流。following 只有首屏。取值：`--kind` recommend / following。 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播间信息。 |
| `live list` | ✓ | 直播列表。 |
| `live categories` | ✓ | 直播分类。 |
| `live listen` | ✓ | 监听弹幕、礼物、进场等事件。持续输出 jsonl。 |
| `live gifts` | ✓ | 礼物列表。 |
| `live replays` | ✓ | 直播回放。 |
| `live search`、`live history`、`live send`、`live like`、`live rank`、`live products`、`live media`、`live start`、`live stop` | ○ | 规划中 |

### notice

| 命令 | 状态 | 说明 |
|---|---|---|
| `notice count` | ✓ | 未读通知数。 |
| `notice list` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `product` | `get` |
| `keyword` | `suggest` `hot` |
| `msg` | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `folder` | `list` `items` `create` `update` `delete` |
| `series` | `list` `items` |
| `history` | `list` |
| `topic` | `search` |
| `poi` | `search` |

## 私有选项与平台扩展

快手没有私有选项，也没有扩展命令。需要注意的标准选项：

- `feed list --kind recommend|following`：`recommend` 是精彩推荐流，`following` 只有首屏。快手没有单独的热门流，所以不支持 `hot`。
- `user likes` / `followers` / `following` 只支持自己（省略参数或传 `me`），传别人时报 `UNSUPPORTED`。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 作品 `<item>` | photoId（如 `3x...`），作品链接 `https://www.kuaishou.com/short-video/<id>`（也认 `/fw/photo/<id>`、`?photoId=`、`live.kuaishou.com/u/<eid>/<id>`），或分享短链（`v.kuaishou.com`、`v.m.chenzhongtech.com`、`kuaishou.cn`、`c.kuaishou.com`） |
| 用户 `<user>` | 用户 ID（eid，如 `3x...`）、主页链接 `https://www.kuaishou.com/profile/<id>`、分享短链，或 `me` |
| 直播间 `<room>` | 主播 ID，或直播间链接 `https://live.kuaishou.com/u/<id>` |

**直播间的主播 id 和主页 id 是两套**：`live get` 返回的 `host` 链接（`live.kuaishou.com/u/<id>`）不能当用户参数用，传给 `user get`、`live replays` 等会报 `USAGE` 并说明原因；请改传主页链接 `https://www.kuaishou.com/profile/<id>`。快手没有互查的接口。

## 示例

```bash
# 扫码登录（一并换取创作者中心和直播站的票据）
catbus kuaishou auth login

# 搜索作品，取 30 条
catbus kuaishou item search 美食 --limit 30

# 作品详情、评论、评论的回复
catbus kuaishou item get "<video_url>"
catbus kuaishou comment list "<video_url>" --limit 100 -o jsonl
catbus kuaishou comment replies "<video_url>" <comment_id>

# 某个用户的全部作品；下载一个作品
catbus kuaishou user items "<profile_url>" --all -o jsonl > works.jsonl
catbus kuaishou item download "<video_url>" --dir ./ks

# 我发布的作品（带审核状态）
catbus kuaishou item list --all

# 直播：在播列表、监听弹幕、某个用户的回放
catbus kuaishou live list --limit 20
catbus kuaishou live listen <host_id> --duration 10m > live.jsonl
catbus kuaishou live replays "<profile_url>"

# 发一条仅自己可见的图集
catbus kuaishou item publish --image 1.jpg --image 2.jpg --text "周末" --visibility private
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **滑块风控**：连续请求作品详情、评论等接口时，快手可能返回 `400002` 要求过滑块。catbus 会自动尝试一次（已集成上游刷新过的指纹），没过时报 `RISK_CONTROL`（`detail.kind` 为 `captcha`，`detail.verify` 带服务端的回复）。真机上触发过一次、没过，之后 216 次请求没再触发，暂时无法复现。被拦住时放慢请求，或者先在浏览器里过一次滑块。见 [trouble.md 4a](../trouble.md#4a-快手滑块风控没有自动通过catbus-漏移植)。
- **直播间主播 id 不能当用户用**：见上面「参数格式」。见 [trouble.md 4b](../trouble.md#4b-快手直播间的主播-id-不能当用户用)。
- **字段恒为空**：`notice count` 只有总数（接口只返回 `unReadCount`），`user get` / `user search` 的 `stats.*` 都是 null。见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。
- **`item list` 按年翻页**：作品管理接口的时间范围服务端限一年，catbus 在一年的窗口里翻页，翻完再把窗口前移一年，某个窗口没有作品时停止。
- **还没真机验证**：视频发布、直播相关的写操作；服务端登出、发布状态刷新、礼物全量的响应结构是推断的。已验证：仅自己可见的图集发布。见 [trouble.md 6.1](../trouble.md#61-已验证平台里没测的命令) 与 [第 10 节](../trouble.md#10-上游有catbus-漏移植的2026-09-28-审计)。
- **删不掉作品**：`item delete` 上游没有（○），发出去的作品要在创作者中心手动删除。测试发布请用 `--visibility private`。
- 上游对部分直播接口（评论、点赞等）运行时直接拒绝发请求，这些命令没有移植，标为 ○。
