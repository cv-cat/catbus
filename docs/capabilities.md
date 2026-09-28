# 能力矩阵

各平台 web 端能力的规划。命令规范见 [AGENTS.md](../AGENTS.md) 第 4 节，上游代码位置见 [upstream-map.md](upstream-map.md)。

- 本文件由注册表（`src/platforms/<p>/index.ts`）生成：`npm run gen:capabilities`。不要手改，测试会检查它是否最新。
- app / pc 端目前全部是 planned，不在本表列出。

| 符号 | 含义 | 注册表 status | 执行结果 |
|---|---|---|---|
| ✓ | 上游已有，M2 / M3 移植 | implemented（移植后） | 正常执行 |
| ◐ | 上游部分支持，限制写在注册表的 `note` 里 | implemented（移植后） | 正常执行 |
| ○ | 平台有这个概念，上游没有，规划中 | planned | `NOT_IMPLEMENTED`，退出码 4 |
| — | 平台没有这个概念 | 不注册 | `UNSUPPORTED`，退出码 2 |

列顺序：xhs · douyin · tiktok · bilibili · kuaishou · weibo · xianyu · taobao · jd · x。

## 登录方式

|  | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| qrcode | ✓ | ✓ |  | ✓ | ✓ |  | ✓ |  | ✓ |  |
| sms | ✓ | ✓ |  | ✓ | ✓ |  |  |  | ✓ |  |
| password |  |  |  | ✓ |  |  |  |  |  | ✓ |
| cookie | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 默认 | qrcode | qrcode | cookie | qrcode | qrcode | cookie | qrcode | cookie | qrcode | cookie |
| 子站点 | creator |  |  |  |  |  |  |  |  |  |

## auth

`login` 见上表。`logout` / `list` / `use` 由 core 实现，所有平台都有；服务端登出只有 bilibili。

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| auth status | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ |

## user

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| user get | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ |
| user search | ✓ | ✓ | ○ | ✓ | ✓ | ○ | — | — | — | ✓ |
| user items | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | — | ✓ |
| user likes | ✓ | ✓ | ○ | — | ✓ | ○ | — | — | — | ○ |
| user collects | ✓ | ○ | ✓ | ○ | ✓ | ○ | ○ | ○ | ✓ | ○ |
| user reposts | — | — | ✓ | — | — | ○ | — | — | — | ○ |
| user followers / following | ○ | ✓ | ✓ | ○ | ✓ | ○ | — | — | — | ○ |
| user follow / unfollow | ○ | ○ | ✓ | ○ | ○ | ○ | ○ | — | — | ✓ |

- tiktok `user get`：me 部分支持
- xianyu `user get`：只支持 me；查询他人规划中
- taobao `user get`：me 规划中
- jd `user get`：只支持 me
- kuaishou `user likes`：只支持 me
- kuaishou `user followers / following`：只支持 me
- `user items --sort` 取值：bilibili latest / views / collects
- `user collects --area`：jd

## item

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| item get | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ✓ | ✓ |
| item search | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ○ | ○ | ✓ | ✓ |
| item related | ○ | ○ | ✓ | ○ | ✓ | — | ○ | ○ | ◐ | — |
| item list | ✓ | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | — | — |
| item media / download | ✓ | ✓ | ◐ | ✓ | ✓ | ○ | — | — | — | ✓ |
| item like / unlike | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | — | — | ✓ |
| item collect / uncollect | ○ | ✓ | ✓ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ |
| item repost / unrepost | — | — | ○ | — | — | ○ | — | — | — | ✓ |
| item publish | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | — | — | ✓ |
| item delete | ○ | ○ | ○ | ✓ | ○ | ○ | ○ | — | — | ✓ |
| item categories | — | — | — | ✓ | — | — | ○ | — | — | — |

- weibo `item search`：只能取第一页
- jd `item related`：用第一个相关搜索词的搜索结果
- `item get --area`：jd
- `item search --sort` 取值：xhs general / latest / popular / comments / collects；bilibili general / views / latest / collects；jd general / sales / price_asc / price_desc / comments；x general / latest
- `item search --type` 取值：xhs all / video / image
- `item search --area`：jd
- `item related --area`：jd
- `item publish --shipping`：xianyu
- `item publish --postage`：xianyu
- `item publish --pickup`：xianyu
- `item publish --original-price`：xianyu

## product 与商品评价

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| product get | ○ | ◐ | ✓ | — | ○ | — | — | — | — | — |

商品评价用 `comment list <product>`（见下节）：传商品 URL 时自动识别，传纯 ID 时加 `--product`。

闲鱼、淘宝、京东的商品本身就是 item：商品详情用 `item get`，商品评价用 `comment list <item>`。

## comment

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| comment list | ◐ | ✓ | ✓ | ✓ | ◐ | ◐ | — | ○ | ◐ | ✓ |
| comment replies | ✓ | ✓ | ✓ | ○ | ◐ | ○ | — | — | — | ○ |
| comment add | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | — | — | ✓ |
| comment delete | ○ | ○ | ○ | ✓ | ○ | ○ | — | — | — | ✓ |
| comment like / unlike | ○ | ○ | ○ | ○ | ○ | ○ | — | — | — | ✓ |

- xhs `comment list`：--product 规划中
- kuaishou `comment list`：--product 规划中
- weibo `comment list`：只有一级评论
- jd `comment list`：只有第一页；--limit N 在一次请求里取 N 条
- `comment list --product`：xhs、douyin、tiktok、kuaishou

## feed 与 keyword

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| feed list | ◐ | ◐ | ✓ | ◐ | ◐ | ○ | ○ | ○ | ○ | ◐ |
| feed categories | ✓ | — | ○ | — | — | — | — | — | — | — |
| keyword suggest | ○ | ○ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ | ○ |
| keyword hot | ✓ | ○ | ○ | ○ | ○ | ○ | — | — | ✓ | ○ |

- xhs `feed list`：following 规划中
- douyin `feed list`：hot、following 规划中
- bilibili `feed list`：following 规划中
- kuaishou `feed list`：recommend 规划中；hot 部分支持
- x `feed list`：following 规划中
- `feed list --kind` 取值：xhs recommend / following；douyin recommend / hot / following；tiktok recommend / following；bilibili recommend / hot / following；kuaishou recommend / hot / following；weibo recommend / hot / following；xianyu recommend；taobao recommend；jd recommend；x recommend / following
- `feed list --category`：xhs

## notice 与 msg

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| notice list | ✓ | ✓ | ✓ | ○ | ○ | ○ | — | — | — | ○ |
| notice count | ✓ | ○ | ✓ | ○ | ✓ | ○ | — | — | — | ○ |
| msg list | ✓ | ○ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ | ✓ |
| msg history | ✓ | ○ | ✓ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ◐ |
| msg send | ✓ | ✓ | ◐ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ○ |
| msg listen | ✓ | ✓ | ✓ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ○ |
| msg read / revoke / delete | ✓ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

- x `msg history`：消息端到端加密，只给出占位消息
- xianyu `msg send`：--to 不带 --item 时按上游的默认商品建会话；--to 加 --item 就这件商品联系对方（卖家可以联系买家）

## media、folder、series、history、topic、poi

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| media upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| folder list | ◐ | ✓ | ✓ | ◐ | ○ | ○ | — | — | — | ○ |
| folder items | ○ | ○ | ✓ | ◐ | ○ | ○ | — | — | — | ○ |
| folder create / update | ○ | ○ | ◐ | ○ | ○ | — | — | — | — | ○ |
| folder delete | ○ | ○ | ○ | ○ | ○ | — | — | — | — | ○ |
| series list | ○ | ○ | ✓ | ○ | ○ | — | — | — | — | — |
| series items | ○ | ○ | ○ | ○ | ○ | — | — | — | — | — |
| history list | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ✓ | — |
| topic search | ✓ | ○ | ○ | ○ | ○ | ○ | — | — | — | — |
| poi search | ✓ | ○ | ◐ | — | ○ | ○ | — | — | — | — |

- tiktok `poi search`：在推荐地点里按关键词筛选
- `history list --area`：jd

## live

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| live get | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live list | ✓ | ○ | ✓ | ○ | ✓ | ○ | — | ○ | — | — |
| live search | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | ○ | — | — |
| live categories | ✓ | ○ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live listen | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live history | ○ | ○ | ◐ | ✓ | ○ | ○ | — | ○ | — | — |
| live send | ◐ | ◐ | ◐ | ✓ | ○ | ○ | — | ○ | — | — |
| live like / rank | ○ | ✓ | ✓ | ○ | ○ | ○ | — | ○ | — | — |
| live gifts | ✓ | ○ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live products | ✓ | ✓ | ○ | — | ○ | ○ | — | ○ | — | — |
| live media | ○ | ○ | ○ | ✓ | ○ | ○ | — | ○ | — | — |
| live replays | — | ○ | — | ○ | ✓ | ○ | — | ○ | — | — |
| live start / stop | ○ | ○ | ○ | ✓ | ○ | ○ | — | ○ | — | — |

- xhs `live send`：--gift 规划中
- douyin `live send`：--gift 规划中
- tiktok `live send`：--gift 规划中
- `live list --category`：xhs
- `live start --category`：bilibili

## 平台扩展

命令定义见 AGENTS.md 4.7。

| 平台 | 命令 |
|---|---|
| bilibili | `item coin` ✓ · `item triple` ✓ · `item subtitles` ✓ · `danmaku list` ✓ · `danmaku send` ✓ · `dynamic publish` ✓ · `dynamic delete` ✓ · `article publish` ✓ |
| jd | `order list` ✓ · `cart count` ✓ · `coupon list` ✓ |
