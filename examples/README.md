# 示例

展示脚本和 AI Agent 怎么组合 catbus：用 `-o jsonl` 接管道、按退出码分支、用 `page.cursor` 续翻、遇到风控停下。每个脚本开头都有完整的用法说明，不带参数运行会打印出来。

| 脚本 | 做什么 | 依赖 |
|---|---|---|
| [search-to-jsonl.sh](search-to-jsonl.sh) | 跨平台搜索同一个关键词，每个平台取 N 条，合并成一个 jsonl（每行加上 `platform` 字段）。默认搜索「`item search` 已实现、并且本机登录过」的平台；某个平台失败时跳过，平台之间 sleep | bash、jq |
| [comments-export.sh](comments-export.sh) | 导出一条内容的全部评论到 jsonl。分批翻页，批与批之间把游标存到 `<输出文件>.cursor`；遇到 `RISK_CONTROL` / `NETWORK` 停下，再运行就从断点继续。`REPLIES=1` 时顺带导出评论的回复 | bash、jq |
| [user-items-backup.sh](user-items-backup.sh) | 备份一个用户发布的全部内容：`user items --all` 的元数据写成 `items.jsonl`，再逐条 `item download --dir` 下载媒体。已下载的记在 `downloaded.txt`，中断后续跑；平台还不支持下载时只备份元数据 | bash、jq |
| [live-to-file.sh](live-to-file.sh) | 把直播间的弹幕、礼物、进场等事件 `live listen --duration` 一段时间写到文件；Ctrl-C 也能正常收尾，结束时按事件类型和礼物统计 | bash（jq 可选，用于统计） |
| [node-api.mjs](node-api.mjs) | 用 Node 的 `child_process` 调 catbus 的最小封装：解析信封，按退出码把错误分成 auth / usage / risk_control / network 等，带长连接的异步迭代器和风控重试。可以直接运行，也可以 `import` 到自己的代码里 | Node |

## 运行前

1. 装好 catbus 并登录要用的平台，见 [快速上手](../docs/guide/quick-start.md) 和 [登录指南](../docs/guide/login.md)：

   ```bash
   catbus bilibili auth login
   catbus auth list        # 看看本机登录了哪些平台
   ```

2. 还没 `npm link` 时，用环境变量 `CATBUS` 指定命令，所有示例都认它：

   ```bash
   export CATBUS="node /path/to/catbus/dist/cli/main.js"
   ```

3. 脚本需要 `jq`（macOS：`brew install jq`；Debian / Ubuntu：`apt install jq`）。脚本在 macOS 自带的 bash 3.2 上也能跑。

## 例子

```bash
# 在已登录的平台上搜「露营」，每个平台 30 条
examples/search-to-jsonl.sh 露营 30 camping.jsonl
jq -r '[.platform, .title, .url] | @tsv' camping.jsonl

# 导出一条 B 站稿件的全部评论；被风控拦下后过几分钟再运行同一条命令
examples/comments-export.sh bilibili BV1xx411c7mD

# 备份自己在抖音发布的作品（元数据 + 媒体）
examples/user-items-backup.sh douyin me ./douyin-backup

# 录 30 分钟 B 站直播弹幕
examples/live-to-file.sh bilibili <room_id> 30m

# 在 Node 里调用
node examples/node-api.mjs bilibili item search 猫 --limit 5
```

```js
import { catbus, catbusStream, catbusWithRetry, CatbusError } from './examples/node-api.mjs'

try {
  const { data: items, page } = await catbusWithRetry(['xhs', 'item', 'search', '露营', '--limit', '20'])
  console.log(items.map((i) => i.title), page)
} catch (err) {
  if (err instanceof CatbusError && err.kind === 'auth') console.error('先登录：', err.hint)
  else throw err
}

for await (const event of catbusStream(['bilibili', 'live', 'listen', '<room_id>', '--duration', '5m'])) {
  if (event.type === 'chat') console.log(event.user?.name, event.text)
}
```

## 写自己的脚本时

- **只解析 stdout**：`-o json`（默认）时 stdout 恰好是一个信封；`-o jsonl` 时 stdout 每行一条 `data`，结束时的摘要信封（`page`、`error`）写在 **stderr** 的最后一行。帮助是 stdout 上唯一不是 JSON 的输出。
- **按退出码分支**：`3` 登录（`error.hint` 就是登录命令）、`5` 风控（放慢、过一会儿再试）、`6` 网络、`4` 规划中、`2` 参数或平台不支持。完整的表见 [AGENTS.md 6.4](../AGENTS.md#64-退出码)。
- **续翻用 `page.cursor`**：游标是不透明字符串，可能以 `-` 开头，传的时候写成 `--cursor=<值>`。一次 `--all` 中途失败时拿不到游标，所以长任务按批调用、批与批之间保存游标（见 `comments-export.sh`）。
- **放慢节奏**：翻页时 catbus 会在页与页之间自动等待；多条命令之间脚本自己 sleep。小红书的评论、快手的作品详情、京东的商品详情请求太密会被风控。
- **危险操作**（删除、撤回、B 站投币 / 三连、直播送礼）在非交互环境里必须加 `-y`，否则报 `CONFIRM_REQUIRED`。
- 不要把 cookie 写进脚本或提交到仓库：登录态只在 `~/.catbus/`，脚本里用 `-a <账号名>` 选择账号即可。
