# 输出与错误处理

catbus 的输出同时面向人和程序（脚本、Agent）：**stdout 只输出 JSON**，日志、提示、进度、二维码一律在 stderr。唯一的例外是 `--help`，它把帮助文字写到 stdout。

规范见 [AGENTS.md 第 6 节](../../AGENTS.md#6-输出)。

## 信封

默认 `-o json` 时，stdout 恰好输出一个信封，成功和失败都是：

```json
{
  "ok": true,
  "platform": "bilibili",
  "endpoint": "web",
  "resource": "item",
  "action": "search",
  "account": "default",
  "data": [ { "id": "BV1...", "kind": "video", "...": "..." } ],
  "page": { "cursor": "2", "has_more": true },
  "error": null
}
```

| 字段 | 说明 |
|---|---|
| `ok` | 是否成功 |
| `platform` / `endpoint` / `resource` / `action` | 执行的命令，平台用规范 id（别名也会归一成规范 id） |
| `account` | 使用的账号名 |
| `data` | 结果：单个对象、数组，失败时为 null |
| `page` | 分页命令为 `{cursor, has_more}`，其他命令为 null |
| `error` | 失败时为 `{code, message, hint, detail}`，成功时为 null |

- stdout 是终端时缩进输出，重定向到文件或管道时输出紧凑的一行。
- 全局命令（`platforms`、`doctor`、`auth list`、`config`、`version`）的 `platform`、`endpoint`、`account` 为 null，`resource` 是命令名，`action` 是子命令（没有时为 null）。

## json 与 jsonl

`-o jsonl` 时 stdout 每行一个 `data` 条目：

- 列表命令一行一条，翻页时边翻边输出，适合大批量导出；
- 非列表命令只有一行；
- 结束时在 **stderr** 写一行摘要信封，`data` 为 null，带 `page` 和 `error`，用来取下一页游标或错误信息。

```bash
catbus xhs user items <user-url> --all -o jsonl > items.jsonl 2> run.log
tail -n 1 run.log | jq '{ok, page, error}'
```

`live listen`、`msg listen` 这类长连接命令总是输出 jsonl（一行一个事件），直到 Ctrl-C 或 `--duration` 到期，退出码 0。

## --raw

归一化会丢掉平台私有字段。需要原始数据时加 `--raw`：每个归一化对象换成平台返回的原始对象，信封结构不变。

```bash
catbus bilibili item get BV1xx411c7mD --raw | jq '.data | keys'
```

原始对象的结构随平台和接口变化，不保证稳定；写脚本时优先用归一化字段。

## 归一化类型

同一种对象在所有平台上结构相同。常用类型：

| 类型 | 字段 |
|---|---|
| UserRef | `id name url` |
| User | `id name handle avatar url bio stats{followers following items likes}` |
| Item | `id kind url title text author:UserRef created_at cover media:Media[] stats{views likes comments collects shares} price:Price\|null status\|null` |
| Media | `id type url width height duration` |
| Price | `amount currency`（`amount` 以元等主单位计） |
| Comment | `id item_id parent_id author:UserRef text created_at stats{likes replies}` |
| Live | `id url title status host:UserRef cover stats{viewers}` |
| Event | `type time user:UserRef text gift{name count}\|null` |
| Conversation | `id peer:UserRef unread last_message updated_at` |
| Message | `id conversation_id from:UserRef type text media:Media[] created_at` |
| Notice | `id type user:UserRef target{id url}\|null text created_at` |
| AuthStatus | `logged_in user:UserRef\|null method expires_at` |
| Account | `platform endpoint account current user:UserRef\|null method updated_at` |
| File | `path type url size` |

完整的类型（Folder、Category、Keyword、Topic、Poi、Gift、Rank、Subtitle、Danmaku、Order、Coupon……）、枚举值和每条命令的输出类型见 [AGENTS.md 6.2](../../AGENTS.md#62-归一化类型)、[6.3](../../AGENTS.md#63-各命令的输出)。每条命令的输出类型也写在 `--help` 的「输出」一行里。

约定：
- ID 一律是字符串（包括 64 位整数 ID，不会丢精度）。
- 计数是整数或 null，「1.2万」会换算成 12000。
- 时间是带时区的 ISO 8601。
- 字段总是存在，取不到时为 null 或 `[]`。有些字段因为上游接口不返回而恒为 null，例如抖音作品的 `title`、抖音和小红书列表的 `stats.views`，见 [trouble.md 第 5 节](../trouble.md#5-数据缺口字段恒为空)。
- 所有对象都带 `id` 和 `url`，可以直接作为下一条命令的参数。

写操作的返回：成对动作（`like/unlike` 等）、`delete`、`live send` 等返回 `{id}`（目标对象的 id）；`item publish` 返回 Item；`comment add` 返回 Comment；`msg send` 返回 Message；`item download` 返回 File[]。

## 分页与游标

列表命令默认只取一页：

| 选项 | 说明 |
|---|---|
| （不加） | 只取一页 |
| `--limit N` | 自动翻页，直到取满 N 条 |
| `--cursor <c>` | 从上次返回的 `page.cursor` 继续 |
| `--all` | 一直翻到没有更多 |

- 游标是**不透明字符串**，原样传回即可，不要自己解析或构造。各平台的游标格式不同（页码、offset、时间戳、base64……）。
- `--limit` 截在一页中间时，返回的游标会带 `#skip=N` 后缀：续翻时 catbus 会重取这一页、跳过已输出的 N 条，剩下的不会丢。
- `has_more` 为 false 时已经到底。服务端返回和上次相同的游标时，catbus 会停止翻页并在 stderr 警告，`--all` 不会死循环。
- 翻页间隔用平台的默认值，不需要自己加 sleep。

分批导出、断点续翻：

```bash
cursor=""
while :; do
  out=$(catbus bilibili user items <user> --limit 100 ${cursor:+--cursor "$cursor"})
  echo "$out" | jq -c '.data[]' >> items.jsonl
  [ "$(echo "$out" | jq -r '.page.has_more')" = "true" ] || break
  cursor=$(echo "$out" | jq -r '.page.cursor')
  sleep 60
done
```

## 退出码

| 退出码 | code | 含义 | 建议 |
|---|---|---|---|
| 0 | — | 成功 | |
| 1 | `ERROR` | 未分类错误 | 看 `message`；可以带 `-v` 重跑看调试日志 |
| 2 | `USAGE` | 参数或选项错误 | 看 `hint` 和 `--help` |
| 2 | `UNSUPPORTED` | 平台 / 端没有这个命令，或不支持这个取值 | `hint` 会给出规范词、可选值或 `-e <端>` |
| 2 | `CONFIRM_REQUIRED` | 危险操作未确认 | 非交互环境加 `-y` |
| 3 | `AUTH_REQUIRED` | 未登录、账号不存在，或平台返回登录墙 | 执行 `hint` 里的登录命令 |
| 3 | `AUTH_EXPIRED` | 登录态失效 | 重新登录 |
| 4 | `NOT_IMPLEMENTED` | 规划中的能力（矩阵里的 ○）或端（app / pc） | 目前不支持，不必重试 |
| 5 | `RISK_CONTROL` | 验证码或风控，`detail.kind` 为 `captcha` / `rate_limit` / `blocked` | 停一停，不要连续重试，见 [faq.md](faq.md#遇到-risk_control-怎么办) |
| 6 | `NETWORK` | 网络 / 代理错误 | 检查网络和代理设置 |
| 7 | `UPSTREAM` | 平台返回业务错误 | 原始错误码在 `detail` 里 |

命令无法执行时的判断顺序：参数和选项先校验（写错的先报 `USAGE`）；然后是规划中的端或能力（`NOT_IMPLEMENTED`）；平台没有的概念或不在词表里的命令报 `UNSUPPORTED`。用了平台原生叫法（如 `note`、`video`）时，`hint` 会给出规范词：

```json
{"ok":false,"platform":"xhs","endpoint":"web","resource":"note","action":"get","account":null,"data":null,"page":null,
 "error":{"code":"UNSUPPORTED","message":"xhs (web) 不支持 note get","hint":"用规范词：catbus xhs item get","detail":null}}
```

## 在脚本里处理错误

按退出码分支：

```bash
out=$(catbus xhs item get "$url")
case $? in
  0) echo "$out" | jq '.data.title' ;;
  3) echo "需要登录：$(echo "$out" | jq -r '.error.hint')" >&2; exit 1 ;;
  5) echo "被风控了，稍后再试" >&2; exit 1 ;;
  *) echo "$out" | jq -r '.error | "\(.code): \(.message)"' >&2; exit 1 ;;
esac
```

只取需要的字段：

```bash
# 搜索结果转成 TSV
catbus bilibili item search 猫 --limit 50 | jq -r '.data[] | [.id, .title, .author.name, .stats.views] | @tsv'

# 失败时打印错误码和建议
catbus douyin item get "$url" | jq -r 'if .ok then .data.url else "\(.error.code) \(.error.hint // "")" end'

# jsonl 逐行处理
catbus xhs comment list "$url" --all -o jsonl | jq -r '.text'

# 列出某个平台已实现的命令
catbus platforms kuaishou | jq -r '.data.commands[] | select(.status=="implemented") | "\(.resource) \(.action)"'
```

## 日志与提示

- `-v` 在 stderr 输出调试日志，cookie、token、Authorization、密码等字段已打码。贴到 issue 之前请再检查一遍。
- `-q` 只保留错误，不输出提示和进度。
- 提示、警告以 `[catbus]` 开头，不会混进 stdout。
