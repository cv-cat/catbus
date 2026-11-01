# 猫眼演出（web 端）

| | |
|---|---|
| id / 别名 | `maoyan`（无别名） · 端：web |
| `item` 是 | 演出项目（演唱会、话剧、相声、体育赛事等） |
| 登录 | **无需登录**（公开只读查询接口，游客态直接可用） |

## 能做

- 城市热门演出（在售 / 预售）：`feed list`，用 `--city` 选城市、`--category` 选分类
- 演出分类：`feed categories`
- 演出详情：`item get <item>`
- 演出城市检索：`poi search <keyword>`

## 做不到

- 按关键词搜演出：`item search` 规划中（`NOT_IMPLEMENTED`）。要找某个演出，先 `feed list --city <城市>` 再按标题筛。
- 场次、票档、余票：要 App 登录态，不提供。
- 下单、抢票、预约：不提供。

## 参数

- 城市（`--city`）：城市名（`北京`、`上海市`）或演出城市 ID（`poi search` 输出的 `id`，如北京是 `2`、上海是 `1`）。默认北京。演出城市 ID 和猫眼 App 城市选择器里的 ID 不是一套。
- 演出（`<item>`）：projectId（如 `514992`），或演出详情链接（`https://show.maoyan.com/qqw#/detail/514992`、`h5.dianping.com/app/myshow/#/detail/...`）。

## 坑

- **场次和场馆在 `text` 里**：Item 没有这些字段，`item get` 把「时间、城市、场馆、票价、状态」逐行写进 `text`（`feed list` 是「分类、演出者、开售」）；要结构化的原始字段用 `--raw`（如 `baseProjectVO.showTimeRange`、`shopVO.shopName`）。
- **没有分页**：`feed list` 一次返回该城市的全部热门演出（约 26 条），`--limit` / `--cursor` 没有意义。
- **`--category` 在本地筛选**：猫眼的列表接口不按分类返回，筛完可能一条都没有。
- **`price` 是最低价**：票价档在 `item get` 的 `text`（「票价：380、1680」）。
- **风控**：频繁请求会被拒（`RISK_CONTROL`），降低频率稍后再试。

## 示例

```bash
catbus maoyan feed list --city 上海 --category 1        # 上海的演唱会
catbus maoyan feed categories
catbus maoyan item get 514992
catbus maoyan item get 514992 --raw
catbus maoyan poi search 无锡
```
