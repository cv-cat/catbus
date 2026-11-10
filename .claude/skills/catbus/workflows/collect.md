# 采集与导出

搜索、取详情、翻页、导出、下载、跨平台对比。平台能做什么先看 `platforms/<id>.md`。

## 选对命令

| 用户想要 | 命令 |
|---|---|
| 按关键词找内容 | `item search <kw>` |
| 一条内容的详情 | `item get <item>` |
| 某人发过的内容 | `user items <user>` |
| 评论（含商品评价） | `comment list <item>`，楼中楼 `comment replies <item> <comment>` |
| 推荐 / 热门流 | `feed list [--kind recommend\|hot\|following] [--category <id>]` |
| 热搜、联想词 | `keyword hot`、`keyword suggest <前缀>` |
| 可播放 / 下载的地址 | `item media <item>` |
| 把媒体存到本地 | `item download <item> --dir <目录>` |
| 自己发布的内容（带审核状态） | `item list` |

不是每个平台都有全部命令，例如淘宝、闲鱼没有商品搜索，微博没有推荐流。调用前查 `catbus platforms <p>`。

## 分页

列表命令默认只取**一页**，信封带 `page: {cursor, has_more}`。

- `--limit N`：自动翻页直到 N 条。**用户说「几条」「一些」时优先用它**，一般 20～100。
- `--all`：翻到没有更多。量可能很大、请求很多，只在用户明确要全部时用。
- `--cursor <c>`：从上次的 `page.cursor` 继续。游标是不透明字符串，**原样传回**，不要解析、拼接或修改（它可能带 `#skip=N` 之类的后缀）。
- 翻页间隔由平台默认值控制，不需要自己 sleep。

## 大量数据用 jsonl

`-o jsonl` 边翻边输出，每行一条 `data`；结束时 stderr 最后一行是摘要信封，下一页游标和错误都在那里。

```bash
catbus bilibili user items <user> --limit 500 -o jsonl > items.jsonl 2> run.log
tail -n 1 run.log | jq -r '.page.cursor // empty'      # 中途停了，用它 --cursor 续跑
tail -n 1 run.log | jq -r '.error.code // empty'       # RISK_CONTROL 等就停下
```

中途遇到 `RISK_CONTROL` 时，已经输出的数据是有效的；把游标记下来，告诉用户过一段时间再续。

## 取字段

对象结构所有平台相同，字段总是存在（取不到为 null 或 `[]`）：

```bash
catbus xhs item search 露营 --limit 20 | jq -r '.data[] | [.title, .author.name, .stats.likes, .url] | @tsv'
catbus douyin comment list <item> --limit 100 -o jsonl | jq -r '.text'
```

- Item：`id kind url title text author{id name url} created_at cover media[] stats{views likes comments collects shares} price status`
- Comment：`id item_id parent_id author text media created_at stats{likes replies}`（`media` 是评论里附带的图片 / 表情包，没有时为 `[]`）
- User：`id name handle avatar url bio stats{followers following items likes}`

有些字段因为平台不返回而恒为 null（例如抖音作品的 `title`、抖音和小红书列表的 `stats.views`），平台文件里有写。需要平台原始字段时加 `--raw`。完整类型见 [../reference/commands.md](../reference/commands.md)。

## 下载

```bash
catbus bilibili item media BV1xx411c7mD            # 只要地址
catbus xhs item download "<笔记 url>" --dir ./xhs   # 存到本地，文件名 <platform>_<id>_<序号>.<ext>
```

已有文件默认跳过，`--overwrite` 覆盖。批量下载时逐条执行，不要并发。

`--subdir title` 让每条内容放进以标题命名的子目录（如 `./xhs/<标题>/xhs_<id>_1.jpg`），目录名已清洗成各系统都能用的形式；`--subdir id` 按 ID 分目录。

## 跨平台

同一个关键词在几个平台上搜，把结果合在一起，每条加上 `platform`：

```bash
for p in xhs douyin bilibili; do
  catbus $p item search 露营 --limit 20 -o jsonl 2>/dev/null | jq -c --arg p $p '. + {platform: $p}'
  sleep 3
done > camping.jsonl
```

- 某个平台失败（没登录、风控）时跳过它继续，最后告诉用户哪些平台没取到、为什么。
- 各平台的 `stats` 口径不同（例如有的没有播放量），对比前先说明。

## 节奏

- 同一平台的命令之间留出间隔：小红书 4 秒以上，京东也要慢，其他平台 1～2 秒。
- 不并发请求同一个平台。
- 用户要的量很大（几千条以上）时，先说明会发很多请求、可能触发风控，确认后再跑。
