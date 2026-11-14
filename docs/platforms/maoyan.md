# 猫眼演出（web 端）

| 项 | 值 |
|---|---|
| 平台 id | `maoyan`（端：web） |
| 别名 | 无 |
| `item` 指 | 演出项目（演唱会、话剧、相声、体育赛事等） |
| 上游仓库 | 无（直接对接猫眼演出的公开接口） |
| 接口来源 | 记录在 [`src/platforms/maoyan/UPSTREAM`](../../src/platforms/maoyan/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 9 条（✓ 8 · ◐ 1），规划中 ○ 1 条 |

猫眼演出平台提供城市热门演出和演出详情的只读查询，这些命令不需要登录，web 端以游客态直接运行；场次、票档和余票（`item get --tickets`）需要登录。演出详情等接口要带美团 H5guard 的 `mtgsig` 签名，catbus 在本地的 vm 里出签，不需要另起服务。

**刻意边界**：下单、抢票、预约不提供。

## 登录

查询命令不需要登录。只有 `item get --tickets` 要求登录，登录态是 `.dianping.com` 的 `dper` cookie，约七天有效。

```bash
catbus maoyan auth login                                           # 默认扫码：用大众点评 App 扫终端里的二维码，不用打开浏览器
catbus maoyan auth login --method cookie --cookie "dper=<值>"       # 导入已有的 dper
catbus maoyan auth status
```

## 支持的命令

✓ 已实现，◐ 部分支持，○ 规划中。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录：扫码（默认）或 cookie 导入。 |
| `auth status` | ✓ | 在线校验登录态。 |
| `auth list` | ✓ | 本平台、本端的账号（由 core 提供）。 |
| `auth use` | ✓ | 切换当前账号（由 core 提供）。 |
| `auth logout` | ✓ | 登出并清理凭证（由 core 提供）。 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get <item>` | ✓ | 演出详情。场次时间、城市、场馆、票价档、售卖状态没有对应的 Item 字段，按「键：值」逐行写进 `text`；`price` 是最低价；介绍里的图片在 `media`。私有选项 `--tickets`（需要登录）同时查场次和票档，逐行追加「场次：2026-11-14 周六 19:30」、「场次时间：2026-11-14T19:30:00+08:00」和每个票档一行「票档：A，票面价 1080，实售价 648，余票 3，限购 6」（售罄的末尾加「售罄」，取不到的项省略），原始字段在 `--raw` 的 `shows`。票档名是站点给的字母，不是价格；打折时实售价低于票面价。余票看起来封顶在每单限购数（实测观察），余票等于限购时表示至少还有这么多张。还没开票的演出没有场次行。 |
| `item search <kw>` | ○ | 规划中。 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ✓ | 城市热门演出（在售 / 预售）。私有选项 `--city <城市>`，默认北京；`--category` 取 `feed categories` 的 id。一次返回该城市的全部热门演出（约 26 条），没有分页；猫眼的列表接口不按分类返回，`--category` 在本地筛选。`text` 里是分类、演出者、开售状态和开售时间（ISO 8601），第一位演出者作 `author`。 |
| `feed categories` | ✓ | 演出分类（演唱会、话剧音乐剧、相声、体育赛事……）。 |

### poi

| 命令 | 状态 | 说明 |
|---|---|---|
| `poi search <kw>` | ◐ | 只搜演出城市（内置城市表），`id` 是 `feed list --city` 的取值。 |

## 参数

- **城市**（`--city`）：城市名（`北京`、`上海市`）或演出城市 ID。演出城市 ID 自成一套（1=上海、2=北京、3=杭州），和猫眼 App 城市选择器里的 ID 不同；同名城市优先取经过官方核对的 ID。
- **演出**（`<item>`）：projectId（如 `514992`），或演出详情链接：`https://show.maoyan.com/qqw#/detail/<id>`、`https://h5.dianping.com/app/myshow/#/detail/<id>`，以及 App 的 `dianping://` 跳转链接。

## 示例

```bash
# 上海的演唱会
catbus maoyan feed list --city 上海 --category 1

# 演出详情；场次和场馆在 text 里
catbus maoyan item get 514992

# 场次、票档、实售价、余票（需要登录）
catbus maoyan item get 514992 --tickets

# 要结构化的原始字段时用 --raw
catbus maoyan item get 514992 --raw

# 查城市的演出城市 ID
catbus maoyan poi search 无锡
```

## 已知限制

- 设备指纹（`WEBDFPID`，mtgsig 的 `a3`）目前是写死的，所有用户共用：服务端校验它的合法性，不能随机生成。请求里的 `uuid` 每次随机，也不带 Cookie。
- 列表接口的 `ticketStatus` 不可靠；售卖状态以 `item get` 的「状态」（详情的 `buttonContext`）为准。
- 请求太频繁会被拒（`RISK_CONTROL`），降低频率后再试。`--tickets` 每个场次多一次请求，场次之间间隔 1 秒。
