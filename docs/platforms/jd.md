# 京东（jd）

| 项 | 值 |
|---|---|
| 平台 id | `jd` |
| 别名 | `jingdong` |
| `item` 指 | 商品 SKU |
| 上游仓库 | [cv-cat/JdApis](https://github.com/cv-cat/JdApis) |
| 移植基线 | master 上的 [`89b5daa`](https://github.com/cv-cat/JdApis/commit/89b5daa5597ff968f39f69e02200dcb5118b78e6)，记录在 [`src/platforms/jd/UPSTREAM`](../../src/platforms/jd/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 21 条（✓ 18 · ◐ 3），规划中 ○ 6 条 |

京东的能力偏向买家侧：商品详情与搜索、商品评价、收藏与浏览历史、订单、购物车、优惠券、咚咚客服。命令表由注册表生成，与 `catbus platforms jd` 一致；选项以 `catbus jd <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

| 方式 | 命令 | 说明 |
|---|---|---|
| 扫码（默认） | `catbus jd auth login` | 用京东 App 扫码并确认。真机验证可用 |
| 短信 | `catbus jd auth login --method sms --phone <手机号>` | `--phone` 可以带国际前缀（如 `+85291234567`）。发码前如果要求人机验证，catbus 用 JCAP 模型自动计算；账号要求额外安全验证时会再发一条验证码，非交互环境下用 `--code <验证码>` 完成 |
| cookie | `catbus jd auth login --method cookie --cookie @jd-cookie.txt` | 在浏览器登录 www.jd.com，从 DevTools → Network 复制完整的 Cookie 请求头 |

- cookie 里必须有登录票据 `thor`（PC 扫码下发，或 M 端的 `pt_key`），以及 `pin`（也认 `pt_pin`、`_pst`）；缺了报 `USAGE`。
- 收货地区默认取 cookie `ipLoc-djd`，影响价格和库存，可以用 `--area` 临时指定（见下）。
- 验证码（JCAP）的 onnx 模型在 `@cv-cat/catbus-assets-jd` 里，约 81 MB；从源码安装时先执行 `npm run assets:jd`。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示京东没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。sms 的 `--phone` 可以带国际前缀，例如 +85291234567。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth logout` | ✓ | 登出并删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ◐ | 用户资料。只支持 me。 |
| `user collects` | ✓ | 用户收藏的商品 SKU。私有选项 `--area`。 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get` | ✓ | 商品 SKU 详情。私有选项 `--area`。 |
| `item search` | ✓ | 搜索商品 SKU。取值：`--sort` general / sales / price_asc / price_desc / comments。私有选项 `--area`。 |
| `item related` | ◐ | 相关推荐。用第一个相关搜索词的搜索结果。私有选项 `--area`。 |
| `item collect`、`item uncollect` | ○ | 规划中 |

### comment

| 命令 | 状态 | 说明 |
|---|---|---|
| `comment list` | ◐ | 商品评价。只有第一页；`--limit N` 在一次请求里取 N 条。 |

### keyword

| 命令 | 状态 | 说明 |
|---|---|---|
| `keyword suggest` | ✓ | 搜索联想词。 |
| `keyword hot` | ✓ | 热搜词。 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg list` | ✓ | 会话列表。 |
| `msg history` | ✓ | 会话的消息记录。 |
| `msg send` | ✓ | 发私信；`--item` 表示联系商品的卖家或客服。只支持文本；用 `--item`、`--conversation <商家 venderId>` 或 `--order` 指定客服，不支持 `--to`。私有选项 `--order`。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### history

| 命令 | 状态 | 说明 |
|---|---|---|
| `history list` | ✓ | 浏览历史。私有选项 `--area`。 |

### order

| 命令 | 状态 | 说明 |
|---|---|---|
| `order list` | ✓ | 订单列表。平台扩展。 |

### cart

| 命令 | 状态 | 说明 |
|---|---|---|
| `cart count` | ✓ | 购物车商品数量。平台扩展。 |

### coupon

| 命令 | 状态 | 说明 |
|---|---|---|
| `coupon list` | ✓ | 商品可用的优惠券。平台扩展。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `feed` | `list` |

## 私有选项与平台扩展

| 命令 | 选项 | 说明 |
|---|---|---|
| `item get` / `item search` / `item related` / `coupon list` / `cart count` / `history list` / `user collects` | `--area <地区编码>` | 收货地区，影响价格和库存。取值是京东的地区编码 `省_市_区_镇`，用 `_` 或 `-` 分隔，例如 `1_2800_55812_0`；默认取登录态里的 `ipLoc-djd` cookie，没有时为 `1_2800_55812_0` |
| `order list` | `--range 3m\|this_year\|<年份>` | 订单的时间范围：`3m` 近三个月（默认）、`this_year` 今年内、`2025` 这样的四位年份表示那一年 |
| `msg send <text>` | `--order <订单>` | 按订单咨询客服，会话和消息都带上订单号。`<订单>` 是订单号（`order list` 输出的 id），也接受订单详情页 URL。可以和 `--item`、`--conversation` 之一一起用；单独用时联系京东自营客服 |

| 扩展命令 | 说明 | 输出 |
|---|---|---|
| `order list [--range ...]` | 订单列表，分页 | Order[]（`id status total items created_at`） |
| `cart count [--area ...]` | 购物车商品数量 | `{count}` |
| `coupon list <item> [--area ...]` | 商品可用的优惠券 | Coupon[]（`id title discount threshold start_at end_at`） |

定义见 [AGENTS.md 4.7](../../AGENTS.md#47-平台扩展)。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 商品 `<item>` / `--item` | SKU（4 位以上的纯数字）、商品页链接（`item.jd.com/<sku>.html`、`item.m.jd.com/product/<sku>.html`、全球购 `npcitem.jd.hk/<sku>.html`，或带 `sku=` / `skuId=` / `wareId=` 参数的链接），或短链（`3.cn`、`u.jd.com`） |
| 用户 `<user>` | 只支持 `me`（`user get`、`user collects` 只能看自己） |
| 会话 `<conversation>` / `--conversation` | 商家的 `venderId`（`msg list` 输出的会话 `id`）；京东自营客服是 `1` |
| 订单 `--order` | 订单号（6 位以上的纯数字，`order list` 输出的 `id`），或订单详情页 URL（带 `orderid=`） |

## 示例

```bash
# 扫码登录
catbus jd auth login

# 按销量搜索机械键盘；指定收货地区看价格
catbus jd item search 机械键盘 --sort sales --limit 30
catbus jd item get "<item_url>" --area 1_2800_55812_0

# 商品评价（一次请求取 50 条）、可用优惠券
catbus jd comment list "<item_url>" --limit 50
catbus jd coupon list "<item_url>"

# 今年的订单、购物车数量、关注的商品
catbus jd order list --range this_year --all -o jsonl > orders.jsonl
catbus jd cart count
catbus jd user collects --all

# 按订单咨询客服
catbus jd msg send "请问什么时候发货？" --order <order_id>

# 客服会话列表，监听新消息
catbus jd msg list
catbus jd msg listen --duration 30m > inbox.jsonl
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **风控较严，控制调用频率**：真机验证时测试账号在 2026-09-29 被封，之后暂停了一切真机请求。封号前 14 条只读命令通过；`item get` 与评价接口曾被 605 / 403 风控拦住。catbus 会区分风控与登录失效：风控报 `RISK_CONTROL`，登录失效报 `AUTH_EXPIRED`。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
- **还没真机确认的字段**：收藏 / 浏览历史的图片与店铺、优惠券、购物车数量、商品详情路径、私信回执匹配，都是按已知结构改的；撤回消息的 id 字段名、评价条数的服务端上限是推断的。见 [trouble.md 第 10 节](../trouble.md#10-上游有catbus-漏移植的2026-09-28-审计)。
- **商品评价只有第一页**：`--limit N` 在一次请求里取 N 条，不翻页。
- **`item related` 是近似结果**：用第一个相关搜索词的搜索结果。京东真正的相关推荐接口（diviner）需要浏览器抓包得到的参数，上游也没有调用。
- 客服私信只支持文本；不支持 `--to`（咚咚只能联系商家客服）。
