# 12306 铁路（train）

| 项 | 值 |
|---|---|
| 平台 id | `train` |
| 别名 | `12306` |
| `item` 指 | 车次 |
| 上游仓库 | 无（直接对接 12306 官方公开接口） |
| 接口来源 | 记录在 [`src/platforms/train/UPSTREAM`](../../src/platforms/train/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 8 条（✓ 8 · ◐ 0），规划中 ○ 0 条 |

12306 铁路平台提供车站、余票、票价、经停和中转的只读查询能力。所有查询接口均为无需登录的公开接口，web 端以游客态直接运行。

**刻意边界**：不提供登录、下单、支付、改签、退票、候补等写操作。购票及后续操作由用户本人在 12306 官方 APP 或网站完成。

## 登录

12306 为**免登录平台**，无需执行 `auth login`。直接执行查询命令即可，会话 cookie 和动态接口路径在查询过程中自动协商并维持。

## 支持的命令

✓ 已实现，○ 规划中。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth list` | ✓ | 本平台、本端的账号（由 core 提供）。 |
| `auth use` | ✓ | 切换当前账号（由 core 提供）。 |
| `auth logout` | ✓ | 登出并清理凭证（由 core 提供）。 |

### 扩展命令

| 命令 | 状态 | 说明 |
|---|---|---|
| `station search` | ✓ | 车站搜索。支持中文名、拼音全拼或首字母前缀、电报码。 |
| `ticket search` | ✓ | 直达车次与余票。`--date` 默认今天；`--type` 过滤车型（如 G,D）；`--available` 只看有票车次。 |
| `ticket price` | ✓ | 票价详情。参数取自 `ticket search` 输出中的 `train_no`、`from.no`、`to.no`、`seat_types`。 |
| `route get` | ✓ | 经停站与时刻。`<train>` 为 `train_no`。 |
| `transfer search` | ✓ | 中转方案搜索。支持 `--via` 指定中转站、`--limit` 限制方案数量。同车分段有座标记为「同车换座」。 |

## 示例

```bash
# 车站搜索
catbus train station search 杭州

# 余票查询
catbus train ticket search 北京 上海 --date 2026-10-10 --available

# 票价查询
catbus train ticket price 240000G53106 --from-no 01 --to-no 13 --seat-types 9MOO --date 2026-10-10

# 经停时刻
catbus train route get 240000G53106 北京南 上海虹桥 --date 2026-10-10

# 中转方案
catbus train transfer search 北京 杭州 --via 南京南 --limit 3 --date 2026-10-10
```
