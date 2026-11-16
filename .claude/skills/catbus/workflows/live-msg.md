# 直播与私信

## 谁支持什么

| | xhs | douyin | tiktok | bilibili | kuaishou | xianyu | taobao | jd |
|---|---|---|---|---|---|---|---|---|
| `live listen` 弹幕流 | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| `live get` 直播间信息 | ✓ | ✓ | ✓ | ✓ | ✓ | | | |
| `live media` 拉流地址 | | ✓ | ✓ | ✓ | | | | |
| `live send` 发弹幕 | ✓ | ✓ | ✓ | ✓ | | | | |
| `msg list` 会话列表 | ✓ | | ✓ | | | | | ✓ |
| `msg history` | ✓ | | ✓ | | | ✓ | ✓ | ✓ |
| `msg send` | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ |
| `msg listen` | ✓ | ✓ | ✓ | | | ✓ | ✓ | ✓ |

微博、X 的直播和私信基本没有（X 只有 `msg list` 和加密的 `msg history`）。以 `catbus platforms <p>` 为准。

## 监听直播

```bash
catbus bilibili live listen <room> --duration 10m > live.jsonl
catbus douyin live listen "https://live.douyin.com/<直播间号>" --duration 1h -o jsonl
```

- **总是带 `--duration`**（`60`、`10m`、`1h`），不然进程会一直挂着。到期或 Ctrl-C 退出码都是 0。
- 输出总是 jsonl，每行一个 Event：`{type, time, user{id name url}, text, gift{name count}|null, stats{viewers likes}|null}`，`type` 为 `chat` `gift` `like` `enter` `follow` `other`。`stats` 是直播间实时的在线人数、累计点赞（抖音、B 站），只更新这些数字的消息 `type` 为 `other`，统计弹幕时可以按 `stats` 不为 null 跳过。
- 断线自动重连；连续失败才会退出并报错。
- 统计礼物、高频词这类需求，先落文件再用 jq 处理：

  ```bash
  jq -r 'select(.type=="chat") | .text' live.jsonl | sort | uniq -c | sort -rn | head
  jq -r 'select(.type=="gift") | "\(.gift.name) \(.gift.count)"' live.jsonl
  ```

- 直播没开时 `live get` 的 `status` 为 `offline`，这时 listen 收不到东西，先查一下。
- 发弹幕（`live send`）是公开的写操作，按 [write.md](write.md) 的规则；送礼 `--gift` 花钱，是危险操作。

## 私信

读：

```bash
catbus xhs msg list
catbus xhs msg history <conversation> --limit 50
catbus xianyu msg listen --duration 30m        # 实时收新消息，jsonl
```

发：`msg send <text>` 加一个目标，三选一（只有 `--to` 与 `--item` 可以同时用）：

| 目标 | 含义 |
|---|---|
| `--to <user>` | 发给某个用户 |
| `--conversation <id>` | 回复已有会话（`msg list` / `history` 输出的会话 id） |
| `--item <item>` | 联系商品的卖家或客服（闲鱼、淘宝、京东） |

- **私信是发给真人的**。只在用户给出了对象和内容时发，不批量，不代替用户和陌生人聊天。
- 平台限制：TikTok 只能发文本、只能发给已有会话的人；淘宝不支持 `--to`；京东只能联系商家客服，可加 `--order <订单号>` 按订单咨询；闲鱼 `--to` 加 `--item` 表示就这件商品联系对方。
- `msg revoke`、`msg delete` 是危险操作。
- 需要持续值守（例如「有新消息告诉我」）时用 `msg listen --duration`，不要轮询 `msg history`。
