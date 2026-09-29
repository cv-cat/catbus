# 闲鱼（xianyu）

| 项 | 值 |
|---|---|
| 平台 id | `xianyu` |
| 别名 | `goofish`、`xy` |
| `item` 指 | 闲置商品 |
| 上游仓库 | [cv-cat/XianYuApis](https://github.com/cv-cat/XianYuApis) |
| 移植基线 | master 上的 [`c6c87e6`](https://github.com/cv-cat/XianYuApis/commit/c6c87e6ce20002fc15450790226b70e78adb60b6)，记录在 [`src/platforms/xianyu/UPSTREAM`](../../src/platforms/xianyu/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 12 条（✓ 11 · ◐ 1），规划中 ○ 18 条 |

闲鱼的上游以「商品详情 + 发布 + 私信」为主，适合做卖家侧的自动化：查商品、上架、联系买家 / 卖家、监听新消息。命令表由注册表生成，与 `catbus platforms xianyu` 一致；选项以 `catbus xianyu <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus xianyu auth login` | 用闲鱼 App 扫码（首页左上角 → 扫一扫）并确认。真机验证可用 |
| cookie | `catbus xianyu auth login --method cookie --cookie @goofish-cookie.txt` | 在浏览器登录 www.goofish.com，从 DevTools → Network 复制完整的 Cookie 请求头 |

- cookie 里必须有 `unb`（用户 ID），以及 mtop 签名要用的 `_m_h5_tk` 和 `cookie2`。缺 `unb` 时报 `USAGE`；导入后 catbus 调一次登录用户接口校验。
- 登录流程会先生成初始 cookie（`cna`、`_m_h5_tk`、`cookie2`、`tfstk`），这与游客态无关：web 端所有命令都需要登录。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示闲鱼没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

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
| `user get` | ◐ | 用户资料。只支持 me；查询他人规划中。 |
| `user items`、`user collects`、`user follow`、`user unfollow` | ○ | 规划中 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 闲置商品详情。 |
| `item publish` | ✓ | 发布闲置商品。`--text` 是商品描述（没有时用 `--title`），两者至少给一个；只支持图片。取值：`--visibility` public。不支持 `--video`、`--cover`、`--tag`、`--topic`、`--mention`、`--poi`、`--category`、`--schedule`。私有选项 `--shipping`、`--postage`、`--pickup`、`--original-price`。 |
| `item search`、`item related`、`item list`、`item collect`、`item uncollect`、`item delete`、`item categories` | ○ | 规划中 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg history` | ✓ | 会话的消息记录。 |
| `msg send` | ✓ | 发私信；`--item` 表示联系商品的卖家或客服。`--to` 不带 `--item` 时按上游的默认商品建会话；`--to` 加 `--item` 就这件商品联系对方（卖家可以联系买家）。只支持文字和图片。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg list`、`msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。只支持图片。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `feed` | `list` |
| `keyword` | `suggest` |
| `history` | `list` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item publish` | `--shipping free\|distance\|fixed\|none` | 运费方式：`free` 包邮（默认）、`distance` 按距离计费、`fixed` 一口价、`none` 无需邮寄 |
| `item publish` | `--postage <金额>` | 一口价运费（元），配合 `--shipping fixed` |
| `item publish` | `--pickup` | 支持自提 |
| `item publish` | `--original-price <金额>` | 原价（元），要和 `--price` 一起用 |

标准选项 `--price <金额>` 是售价（元）。发布时类目由闲鱼按描述和图片自动推荐，发布地点取账号的第一个常用地址（照上游）。

闲鱼没有扩展命令。定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 商品 `<item>` / `--item` | 纯数字的商品 ID、商品链接 `https://www.goofish.com/item?id=<id>`（其他带 `?id=` / `itemId=` 的链接也行）、分享短链（如 `m.tb.cn`），或整段分享文本（会从里面找出链接） |
| 用户 `<user>` / `--to` | `me`、纯数字的用户 ID（可带 `@goofish` 后缀）、主页链接 `https://www.goofish.com/personal?userId=<id>`、分享短链，或整段分享文本 |
| 会话 `<conversation>` / `--conversation` | 纯数字的会话 ID（可带 `@goofish` 后缀），来自 `msg listen` / `msg send` 输出的 `conversation_id` |

## 私信怎么发

| 写法 | 效果 |
|---|---|
| `msg send <text> --item <商品>` | 买家联系卖家：取商品详情里的卖家，就这件商品建会话再发 |
| `msg send <text> --to <用户> --item <商品>` | 就这件商品联系指定用户，**卖家可以借此主动联系买家** |
| `msg send <text> --to <用户>` | 按上游写死的默认商品建会话再发 |
| `msg send <text> --conversation <会话 ID>` | 发到已有会话，对方从消息记录里找 |

文字和 `--image` 可以一起给，依次发送，返回最后一条。不支持发视频。

## 示例

```bash
# 扫码登录，确认登录态
catbus xianyu auth login
catbus xianyu auth status

# 商品详情（分享链接、整段分享文本都行）
catbus xianyu item get "<item_url>"

# 上架一件闲置：包邮，原价 199，现价 88
catbus xianyu item publish --text "九成新机械键盘，青轴" --image kb1.jpg --image kb2.jpg --price 88 --original-price 199

# 一口价运费 10 元，支持自提
catbus xianyu item publish --text "旧书一箱" --image books.jpg --price 30 --shipping fixed --postage 10 --pickup

# 联系卖家
catbus xianyu msg send "还在吗？" --item "<item_url>"

# 某个会话的全部消息（从旧到新）
catbus xianyu msg history <conversation_id> --all -o jsonl

# 监听新消息 1 小时
catbus xianyu msg listen --duration 1h > inbox.jsonl
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **只验证了少数命令**：`auth status`、`user get me`、`media upload` 已真机通过。`item get`、`msg history` 需要手动给商品和会话 id，在线测试拿不到；`msg send` 会打扰真人、`item publish` 会上架真实商品，都还没有真机验证。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
- **`user get` 只支持 `me`**，而且接口实测只返回用户 ID，昵称等字段可能为 null；查询他人规划中。
- **没有商品搜索和推荐流**：`item search`、`feed list` 上游没有（○）。
- **`msg history` 的游标**：同一条长连上按 `nextCursor` 翻页，结果从旧到新排列。`--limit` 截在一页中间时，游标是 `<这一页的起始游标>+<已输出条数>`，续翻时重取这一页、跳过已输出的；这个游标格式是推断的，待真机确认。
- 上游的自动回复示例不提供，见 [AGENTS.md 4.12](../../AGENTS.md#412-不提供的能力)。
