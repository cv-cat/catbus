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
| password |  |  |  | ✓ |  |  |  |  |  |  |
| cookie | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 默认 | qrcode | qrcode | cookie | qrcode | qrcode | cookie | qrcode | cookie | qrcode | cookie |
| 子站点 | creator |  |  |  |  |  |  |  |  |  |

## auth

`login` 见上表。`logout` / `list` / `use` 由 core 实现，所有平台都有；服务端登出只有 bilibili、kuaishou。

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
| user followers | ○ | ✓ | ✓ | ○ | ✓ | ○ | — | — | — | ○ |
| user following | ◐ | ✓ | ✓ | ○ | ✓ | ○ | — | — | — | ○ |
| user follow / unfollow | ○ | ○ | ✓ | ○ | ○ | ○ | ○ | — | — | ✓ |

- tiktok `user get`：me 部分支持
- xianyu `user get`：只支持 me；查询他人规划中
- taobao `user get`：参数只接受商品链接（淘宝 / 天猫商品页或 m.tb.cn 分享短链），返回这件商品的卖家；me 规划中
- jd `user get`：只支持 me
- kuaishou `user likes`：只支持 me
- kuaishou `user followers`：只支持 me
- xhs `user following`：只支持 me
- kuaishou `user following`：只支持 me
- `user search --fans`：douyin
- `user search --user-type`：douyin
- `user items --sort` 取值：bilibili latest / views / collects
- `user items --keyword`：bilibili
- `user collects --area`：jd

## item

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| item get | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ✓ | ✓ |
| item search | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ○ | ○ | ✓ | ✓ |
| item related | ○ | ○ | ✓ | ✓ | ✓ | — | ○ | ○ | ◐ | — |
| item list | ✓ | ◐ | ✓ | ✓ | ✓ | ○ | ○ | — | — | — |
| item media / download | ✓ | ✓ | ◐ | ✓ | ✓ | ○ | — | — | — | ✓ |
| item like / unlike | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | — | — | ✓ |
| item collect / uncollect | ○ | ✓ | ✓ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ |
| item repost / unrepost | — | — | ○ | — | — | ○ | — | — | — | ✓ |
| item publish | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | — | — | ✓ |
| item delete | ○ | ○ | ○ | ◐ | ○ | ○ | ○ | — | — | ✓ |
| item categories | — | — | — | ✓ | — | — | ○ | — | — | — |

- douyin `item search`：--type video 走视频频道搜索；综合频道照上游不发筛选值，--sort / --time / --length / --range 只在 --type video 时生效
- weibo `item search`：只能取第一页（m.weibo.cn 的访客从第二页起要求登录）
- x `item search`：--type video / image 走媒体搜索，按类型过滤，不能和 --sort latest 一起用
- jd `item related`：用第一个相关搜索词的搜索结果
- douyin `item list`：取发布页的作品预览（work_list）；定时未发布的作品 status 为 draft
- x `item publish`：正文超过 280 权重时自动按长推发（需要 Premium）；--thread 发 thread
- bilibili `item delete`：需要人机验证（极验点选），catbus 还不能自动通过，会报 RISK_CONTROL
- `item get --area`：jd
- `item search --sort` 取值：xhs general / latest / popular / comments / collects；douyin general / popular / latest；bilibili general / views / latest / collects；jd general / sales / price_asc / price_desc / comments；x general / latest
- `item search --type` 取值：xhs all / video / image；douyin all / video；bilibili video / article；x all / video / image
- `item search --time` 取值：xhs all / day / week / half_year；douyin all / day / week / half_year
- `item search --length`：douyin
- `item search --range`：douyin
- `item search --area`：jd
- `item related --area`：jd
- `item collect --folder`：douyin、bilibili
- `item uncollect --folder`：douyin、bilibili
- `item publish` 不支持的标准选项：xhs --mention --category --price；douyin --category --price；tiktok --title --poi --category --schedule --price；bilibili --image --topic --mention --poi --schedule --price；kuaishou --cover --mention --poi --category --price；weibo --title --cover --tag --mention --poi --category --schedule --price；xianyu --video --cover --tag --topic --mention --poi --category --schedule；x --title --cover --tag --topic --mention --poi --category --schedule --price
- `item publish --visibility` 取值：默认 public / private / friends；xhs public / private；bilibili public / private；weibo public / private / friends / fans；xianyu public；x public
- `item publish --poi-name`：xhs、douyin、weibo
- `item publish --series`：douyin
- `item publish --hotspot`：douyin
- `item publish --no-download`：douyin
- `item publish --allow-comment`：tiktok
- `item publish --allow-duet`：tiktok
- `item publish --allow-stitch`：tiktok
- `item publish --allow-content-reuse`：tiktok
- `item publish --allow-ai-remix`：tiktok
- `item publish --source`：bilibili
- `item publish --dynamic`：bilibili
- `item publish --allow-reprint`：bilibili
- `item publish --shipping`：xianyu
- `item publish --postage`：xianyu
- `item publish --pickup`：xianyu
- `item publish --original-price`：xianyu
- `item publish --quote`：x
- `item publish --thread`：x

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
- `comment list --label`：douyin
- `comment list --sort` 取值：bilibili popular / latest
- `comment add --root`：bilibili

## feed 与 keyword

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| feed list | ◐ | ◐ | ✓ | ◐ | ◐ | ○ | ○ | ○ | ○ | ◐ |
| feed categories | ✓ | — | ○ | — | — | — | — | — | — | — |
| keyword suggest | ✓ | ○ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ | ○ |
| keyword hot | ✓ | ○ | ○ | ○ | ○ | ○ | — | — | ✓ | ○ |

- xhs `feed list`：following 规划中
- douyin `feed list`：hot、following 规划中
- bilibili `feed list`：following 规划中
- kuaishou `feed list`：following 只有首屏
- x `feed list`：following 规划中
- `feed list --kind` 取值：xhs recommend / following；douyin recommend / hot / following；tiktok recommend / following；bilibili recommend / hot / following；kuaishou recommend / following；weibo recommend / hot / following；xianyu recommend；taobao recommend；jd recommend；x recommend / following
- `feed list --category`：xhs

## notice 与 msg

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| notice list | ✓ | ✓ | ✓ | ○ | ○ | ○ | — | — | — | ○ |
| notice count | ✓ | ○ | ✓ | ○ | ✓ | ○ | — | — | — | ○ |
| msg list | ✓ | ○ | ✓ | ○ | ○ | ○ | ○ | ○ | ✓ | ◐ |
| msg history | ✓ | ○ | ✓ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ◐ |
| msg send | ✓ | ✓ | ◐ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ○ |
| msg listen | ✓ | ✓ | ✓ | ○ | ○ | ○ | ✓ | ✓ | ✓ | ○ |
| msg read / revoke / delete | ✓ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

- xhs `msg list`：含群聊，群聊会话 id 为 group:<群 id>
- x `msg list`：只取收件箱首页（最近 20 个会话），上游没有翻页
- xhs `msg history`：单聊传对方 id，群聊传 group:<群 id>
- x `msg history`：消息端到端加密，只给出占位消息
- xianyu `msg send`：--to 不带 --item 时按上游的默认商品建会话；--to 加 --item 就这件商品联系对方（卖家可以联系买家）
- taobao `msg send`：--item 联系商品卖家，--conversation 回复已有会话；不支持 --to（没有按用户发起会话的接口）
- `notice list --group`：douyin
- `msg send --file`：douyin
- `msg send --share`：douyin
- `msg send --order`：jd

## media、folder、series、history、topic、poi

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| media upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| folder list | ◐ | ✓ | ✓ | ◐ | ○ | ○ | — | — | — | ○ |
| folder items | ○ | ○ | ✓ | ◐ | ○ | ○ | — | — | — | ○ |
| folder create / update | ○ | ○ | ✓ | ○ | ○ | — | — | — | — | ○ |
| folder delete | ○ | ○ | ○ | ○ | ○ | — | — | — | — | ○ |
| series list | ○ | ○ | ✓ | ○ | ○ | — | — | — | — | — |
| series items | ○ | ○ | ○ | ○ | ○ | — | — | — | — | — |
| history list | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ✓ | — |
| topic search | ✓ | ○ | ○ | ○ | ○ | ○ | — | — | — | — |
| poi search | ✓ | ○ | ◐ | — | ○ | ○ | — | — | — | — |

- tiktok `poi search`：在推荐地点里按关键词筛选
- `folder create --visibility` 取值：tiktok public / private
- `folder update --visibility` 取值：tiktok public / private
- `history list --area`：jd

## live

| 命令 | xhs | douyin | tiktok | bilibili | kuaishou | weibo | xianyu | taobao | jd | x |
|---|---|---|---|---|---|---|---|---|---|---|
| live get | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live list | ✓ | ○ | ✓ | ○ | ✓ | ○ | — | ○ | — | — |
| live search | ○ | ✓ | ✓ | ✓ | ○ | ○ | — | ○ | — | — |
| live categories | ✓ | ○ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live listen | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live history | ○ | ◐ | ◐ | ✓ | ○ | ○ | — | ○ | — | — |
| live send | ◐ | ◐ | ◐ | ✓ | ○ | ○ | — | ○ | — | — |
| live like / rank | ○ | ✓ | ✓ | ○ | ○ | ○ | — | ○ | — | — |
| live gifts | ✓ | ○ | ✓ | ✓ | ✓ | ○ | — | ○ | — | — |
| live products | ✓ | ✓ | ○ | — | ○ | ○ | — | ○ | — | — |
| live media | ○ | ◐ | ◐ | ✓ | ○ | ○ | — | ○ | — | — |
| live replays | — | ○ | — | ○ | ✓ | ○ | — | ○ | — | — |
| live start / stop | ○ | ○ | ○ | ✓ | ○ | ○ | — | ○ | — | — |

- douyin `live history`：只有进房时 im/fetch 带回的最近 15 条
- xhs `live send`：--gift 规划中
- douyin `live send`：--gift 规划中
- tiktok `live send`：--gift 规划中
- douyin `live media`：拉流地址取自房间资料（room/web/enter）
- tiktok `live media`：上游没有解析拉流地址：取自 /api-live/user/room 的 liveRoom.streamData，或 room/enter 的 stream_url
- `live list --category`：xhs
- `live send --color`：bilibili
- `live send --font-size`：bilibili
- `live send --position`：bilibili
- `live send --reply-user`：bilibili
- `live like --count`：douyin
- `live rank --ranking`：douyin
- `live start --category`：bilibili

## 平台扩展

命令定义见 AGENTS.md 4.7。

| 平台 | 命令 |
|---|---|
| tiktok | `folder add` ✓ |
| bilibili | `item coin` ✓ · `item triple` ✓ · `item subtitles` ✓ · `danmaku list` ✓ · `danmaku send` ✓ · `dynamic publish` ✓ · `dynamic delete` ✓ · `article publish` ✓ · `draft get` ✓ · `draft delete` ✓ |
| jd | `order list` ✓ · `cart count` ✓ · `coupon list` ✓ |
| x | `article publish` ✓ · `article delete` ✓ |
