# 抖音（douyin）

| 项 | 值 |
|---|---|
| 平台 id | `douyin` |
| 别名 | `dy` |
| `item` 指 | 作品（视频或图文） |
| 上游仓库 | [cv-cat/DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| 移植基线 | `fix-dtrait-blob` 分支的 [`94c744b`](https://github.com/cv-cat/DouYin_Spider/commit/94c744b9b8bea550aed0c9bfe759446ab73bde44)（还没合进上游 master），记录在 [`src/platforms/douyin/UPSTREAM`](../../src/platforms/douyin/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 40 条（✓ 34 · ◐ 6），规划中 ○ 31 条 |

命令表由注册表生成，与 `catbus platforms douyin` 一致；选项以 `catbus douyin <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus douyin auth login` | 真机验证可用。写操作需要的 bd-ticket-guard 凭证（ticket、ts_sign、私钥）扫码时自动拿到，**要做写操作请用扫码** |
| 短信 | `catbus douyin auth login --method sms --phone <手机号>` | 默认走 passport-web；加 `--sso` 改走 `login.douyin.com` 页的 SSO 链（上游的显式开关，不是失败后的退路） |
| cookie | `catbus douyin auth login --method cookie --cookie @dy-cookie.txt` | 从 www.douyin.com 的 DevTools → Network 复制完整的 Cookie 请求头 |

- cookie 里要有登录态的 `sessionid`（或 `sessionid_ss`），导入后 catbus 在线校验一次。缺 `UIFID` 时会自动请求一次推荐流取回，不用自己找。
- 只导入 cookie 时，只读命令正常；发布、评论、私信等写操作还需要与 cookie **同一次登录**的 ticket / ts_sign / 私钥，缺了会在本地拦下并报 `AUTH_REQUIRED`。已经有这些凭证时，`--cookie` 也接受一个 JSON 对象一并导入：`{"cookie": "...", "ticket": "...", "ts_sign": "...", "client_cert": "...", "private_key": "...", "dtrait_blob": "..."}`，字段说明见 [登录指南：抖音](../guide/login.md#抖音连同-ticket-与设备素材一起导入)。
- 没有子站点：创作者中心（发布、`item list`）用主站登录态。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示抖音没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。私有选项 `--sso`。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ✓ | 用户资料。 |
| `user search` | ✓ | 搜索用户。私有选项 `--fans`、`--user-type`。 |
| `user items` | ✓ | 用户发布的作品。 |
| `user likes` | ✓ | 用户点赞的作品。 |
| `user followers` | ✓ | 粉丝列表。 |
| `user following` | ✓ | 关注列表。 |
| `user collects`、`user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 作品详情。 |
| `item search` | ✓ | 搜索作品。`--type video` 走视频频道搜索；综合频道照上游不发筛选值，`--sort` / `--time` / `--length` / `--range` 只在 `--type video` 时生效。取值：`--sort` general / popular / latest；`--time` all / day / week / half_year；`--type` all / video。私有选项 `--length`、`--range`。 |
| `item list` | ◐ | 我发布的作品，带审核状态。取发布页的作品预览（work_list）；定时未发布的作品 status 为 draft。 |
| `item media` | ✓ | 作品的媒体地址。 |
| `item download` | ✓ | 下载作品的媒体。 |
| `item like` | ✓ | 点赞。 |
| `item unlike` | ✓ | 取消点赞。 |
| `item collect` | ✓ | 收藏。私有选项 `--folder`。 |
| `item uncollect` | ✓ | 取消收藏。私有选项 `--folder`。 |
| `item publish` | ✓ | 发布作品。`--image`（图文）和 `--video` 二选一；图文的 `--cover` 要是 `--image` 里的一张。取值：`--visibility` public / private / friends。不支持 `--category`、`--price`。私有选项 `--poi-name`、`--series`、`--hotspot`、`--no-download`。 |
| `item related`、`item delete` | ○ | 规划中 |

### product

| 命令 | 状态 | 说明 |
|---|---|---|
| `product get` | ◐ | 商品详情。上游的商品详情接口只给详情图、规格和跳转链接，归一化后主要是标题、图片和价格，其余字段可能为空。 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ✓ | 评论列表；传商品 URL 或加 `--product` 时列出商品评价。商品评价要传 `live products` 输出的商品 url（带 `product_id` 和 `shop_id`）。私有选项 `--label`。 |
| `comment replies` | ✓ | 评论的回复。 |
| `comment add` | ✓ | 发表评论。 |
| `comment delete`、`comment like`、`comment unlike` | ○ | 规划中 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ◐ | 推荐 / 热门 / 关注流。hot、following 规划中。取值：`--kind` recommend / hot / following。 |

### live

| 命令 | 状态 | 说明 |
|---|---|---|
| `live get` | ✓ | 直播间信息。 |
| `live search` | ✓ | 搜索直播。 |
| `live listen` | ✓ | 监听弹幕、礼物、进场等事件。持续输出 jsonl。 |
| `live history` | ◐ | 最近的弹幕。只有进房时 im/fetch 带回的最近 15 条。 |
| `live send` | ◐ | 发弹幕，或用 `--gift` 送礼。`--gift` 规划中。送礼（`--gift`）需要确认。 |
| `live like` | ✓ | 直播间点赞。私有选项 `--count`。 |
| `live rank` | ✓ | 直播间排行榜。私有选项 `--ranking`。 |
| `live products` | ✓ | 直播间商品。 |
| `live media` | ◐ | 直播流地址。拉流地址取自房间资料（room/web/enter）。 |
| `live list`、`live categories`、`live gifts`、`live replays`、`live start`、`live stop` | ○ | 规划中 |

### notice

| 命令 | 状态 | 说明 |
|---|---|---|
| `notice list` | ✓ | 通知列表。私有选项 `--group`。 |
| `notice count` | ○ | 规划中 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg send` | ✓ | 发私信。`--to <用户>` 或 `--conversation`（形如 `0:1:<uid>:<uid>`）；发视频时要用 `--image` 给一张封面；需要 bd-ticket-guard 私钥（扫码登录时自动生成，cookie 导入时要在 JSON 里一并给出）。私有选项 `--file`、`--share`。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg list`、`msg history`、`msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。 |

### folder

| 命令 | 状态 | 说明 |
|---|---|---|
| `folder list` | ✓ | 收藏夹列表。 |
| `folder items`、`folder create`、`folder update`、`folder delete` | ○ | 规划中 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `keyword` | `suggest` `hot` |
| `series` | `list` `items` |
| `history` | `list` |
| `topic` | `search` |
| `poi` | `search` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `auth login` | `--sso` | 短信登录改走 `login.douyin.com` 页的 SSO 链，只和 `--method sms` 一起用 |
| `item search` | `--length all\|short\|medium\|long` | 视频时长：不限 / 1 分钟内 / 1–5 分钟 / 5 分钟以上 |
| `item search` | `--range all\|seen\|unseen\|following` | 搜索范围：不限 / 看过 / 没看过 / 关注的人 |
| `user search` | `--fans 0_1k\|1k_1w\|1w_10w\|10w_100w\|100w_` | 粉丝数区间 |
| `user search` | `--user-type common\|enterprise\|personal` | 用户类型：普通 / 企业 / 个人认证 |
| `item publish` | `--poi-name <名称>`、`--series <合集 id>`、`--hotspot <热点词>`、`--no-download` | 地点名称（配合 `--poi`）、加入合集、关联热点、不允许别人下载 |
| `item collect` / `uncollect` | `--folder <收藏夹 ID 或名字>` | 收藏后移进这个收藏夹 / 只从这个收藏夹移出（仍保留收藏） |
| `msg send` | `--file <路径或 URL>`、`--share <作品、用户或网页>` | 发文件（≤10MB）；分享作品 / 用户名片 / 网页卡片 |
| `live rank` | `--ranking contribution\|thousand` | 榜单：贡献榜（默认） / 千票榜 |
| `live like` | `--count N` | 一次点赞的次数，默认 1 |
| `comment list` | `--label <标签名或 id>` | 商品评价按标签筛选（好评、差评、有图等），只用于商品评价 |
| `notice list` | `--group all\|fans\|mention\|comment\|like\|danmaku` | 通知分组，不带时为默认分组 |

**搜索筛选只在视频频道生效**：`item search` 默认走综合频道，照上游只发「已筛选」标记、不发筛选值，所以 `--sort` / `--time` / `--length` / `--range` 只在 `--type video` 时生效。

抖音没有扩展命令。定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 作品 `<item>` | `aweme_id`（纯数字）、作品页链接 `https://www.douyin.com/video/<id>`（也认 `/note/`、`/slides/`、`?modal_id=<id>`）、分享短链 `https://v.douyin.com/...`，或整段分享文案（会从里面找出短链） |
| 用户 `<user>` | `sec_uid`（`MS4wLjAB` 开头）、主页链接 `https://www.douyin.com/user/<sec_uid>`、分享短链，或 `me` |
| 直播间 `<room>` | 直播间号（web_rid，数字），或 `https://live.douyin.com/<直播间号>` |
| 商品 `<product>` | `promotion_id`（数字），或 `live products` 输出的商品 url（带 `id`、`promotion_id`、`shop_id`） |
| 会话 `--conversation` | 单聊会话 ID，形如 `0:1:<uid>:<uid>` |
| 分享目标 `--share` | 作品（ID 或链接）、用户（`sec_uid`、主页链接或 `me`），其余 http(s) 链接当作网页卡片 |

**商品评价**：`comment list` 的参数是 jinritemai / haohuo 链接，或带 `product_id=` / `promotion_id=` 时自动按商品处理；纯 ID 要加 `--product`。商品评价需要 `product_id` 和 `shop_id`，所以要传 `live products` 输出的商品 url。

## 示例

```bash
# 扫码登录
catbus douyin auth login

# 视频频道搜索：最新、一周内、1–5 分钟的视频
catbus douyin item search 露营 --type video --sort latest --time week --length medium

# 作品详情、评论前 100 条
catbus douyin item get "<video_url>"
catbus douyin comment list "<video_url>" --limit 100 -o jsonl > comments.jsonl

# 某个用户的全部作品
catbus douyin user items "<user_url>" --all -o jsonl > works.jsonl

# 下载作品（视频或图文里的全部图片）
catbus douyin item download "<video_url>" --dir ./douyin

# 直播间：信息、商品、弹幕
catbus douyin live get <web_rid>
catbus douyin live products <web_rid>
catbus douyin live listen <web_rid> --duration 30m > live.jsonl

# 商品评价里的差评
catbus douyin comment list "<product_url>" --label 差评
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **写操作受设备风控（dtrait）限制**：发布、评论、点赞、私信等高风险接口要求带 `x-tt-session-dtrait` 头，内层的设备特征 blob 原本只能由浏览器生成。catbus 已集成上游 `fix-dtrait-blob` 分支的做法（用随包的设备档案现算），但**发布仍然失败**：`create_v2` 返回 HTTP 200 空响应，catbus 报 `RISK_CONTROL`；上游在扫码后立即发布也同样失败。见 [trouble.md 第 1 节](../trouble.md#1-抖音写操作需要-dtrait_blob) 和 [1.6](../trouble.md#16-集成上游-fix-dtrait-blob-后2026-09-29)。
- **点赞可能连累登录态**：实测不带 dtrait 点赞返回 HTTP 403，之后登录态被踢，只能重新扫码。点赞、收藏、评论、私信、直播发言都还没有真机验证通过，请谨慎在常用账号上尝试。见 [trouble.md 1.2](../trouble.md#12-实测结果)。
- **综合搜索的筛选不生效**：上游综合频道不发筛选值，catbus 照抄，并在 stderr 提示改用 `--type video`。见 [trouble.md 第 9 节](../trouble.md#9-待上游修复后集成)。
- **字段恒为空**：作品的 `title`（抖音作品只有描述，放在 `text`）、列表里的 `stats.views`。见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。
- **还没真机验证**：上面的写操作，以及 `msg listen`、`live listen` / `like`、`product get`、`item download`、`media upload`。见 [trouble.md 6.1](../trouble.md#61-已验证平台里没测的命令)。
- 抖音的 PK、连麦、评论标签不提供，见 [AGENTS.md 4.12](../../AGENTS.md#412-不提供的能力)。
