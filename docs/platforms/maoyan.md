# 猫眼演出（web 端）

| 项 | 值 |
|---|---|
| 平台 id | `maoyan`（端：web） |
| 别名 | 无 |
| `item` 指 | 演出项目（演唱会、话剧、相声、体育赛事等） |
| 上游仓库 | 无（直接对接猫眼演出的公开接口） |
| 接口来源 | 记录在 [`src/platforms/maoyan/UPSTREAM`](../../src/platforms/maoyan/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 7 条（✓ 6 · ◐ 1），规划中 ○ 1 条 |

猫眼演出平台提供城市热门演出和演出详情的只读查询。用到的接口都不需要登录，web 端以游客态直接运行。演出详情接口要带美团 H5guard 的 `mtgsig` 签名，catbus 在本地的 vm 里出签，不需要另起服务。

**刻意边界**：场次、票档、余票要猫眼 App 的登录态，不提供；下单、抢票、预约也不提供。

## 登录

猫眼演出为**免登录平台**，没有 `auth login`，直接执行查询命令即可。

## 支持的命令

✓ 已实现，◐ 部分支持，○ 规划中。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth list` | ✓ | 本平台、本端的账号（由 core 提供）。 |
| `auth use` | ✓ | 切换当前账号（由 core 提供）。 |
| `auth logout` | ✓ | 登出并清理凭证（由 core 提供）。 |

### item

| 命令 | 状态 | 说明 |
|---|---|---|
| `item get <item>` | ✓ | 演出详情。场次时间、城市、场馆、票价档、售卖状态没有对应的 Item 字段，按「键：值」逐行写进 `text`；`price` 是最低价；介绍里的图片在 `media`。 |
| `item search <kw>` | ○ | 规划中。 |

### feed

| 命令 | 状态 | 说明 |
|---|---|---|
| `feed list` | ✓ | 城市热门演出（在售 / 预售）。私有选项 `--city <城市>`，默认北京；`--category` 取 `feed categories` 的 id。一次返回该城市的全部热门演出（约 26 条），没有分页；猫眼的列表接口不按分类返回，`--category` 在本地筛选。`text` 里是分类、演出者、开售状态，第一位演出者作 `author`。 |
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

# 要结构化的原始字段时用 --raw
catbus maoyan item get 514992 --raw

# 查城市的演出城市 ID
catbus maoyan poi search 无锡
```

## 已知限制

- 设备指纹（`WEBDFPID`，mtgsig 的 `a3`）目前是写死的，所有用户共用：服务端校验它的合法性，不能随机生成。请求里的 `uuid` 每次随机，也不带 Cookie。
- 列表接口的 `ticketStatus` 不可靠；售卖状态以 `item get` 的「状态」（详情的 `buttonContext`）为准。
- 请求太频繁会被拒（`RISK_CONTROL`），降低频率后再试。
