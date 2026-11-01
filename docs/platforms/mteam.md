# M-Team（web 端）

| 项 | 值 |
|---|---|
| 平台 id | `mteam` |
| 别名 | `mt`、`m-team`、`mantou` |
| `item` 指 | 种子资源 |
| 登录 | 官方 API Key（`apikey`） |
| 接口 | `https://api.m-team.cc/api`，使用 `x-api-key` 请求头 |
| 端 | web ✓ · app / pc 规划中 |

直接调用 MT 官方 API；不需要导入浏览器 Cookie、运行 Python 或安装浏览器。接口来源与验证范围见 [UPSTREAM](../../src/platforms/mteam/UPSTREAM)。

## 获取令牌并登录

在已登录的 MT 网站打开 **控制台 → 实验室 → 存取令牌**，生成专用于 catbus 的访问令牌。参见 [MT 官方说明](https://wiki.m-team.cc/api)。

在终端隐藏输入（推荐）：

```bash
catbus mteam auth login
```

或者从本地文件 / stdin 导入；不要把 Key 直接写成命令行参数，也不要提交到仓库：

```bash
catbus mteam auth login --api-key-file /私有目录/mteam-key.txt
cat /私有目录/mteam-key.txt | catbus mteam auth login --api-key-stdin
catbus mteam auth status
catbus mteam auth login -a work --api-key-file /私有目录/work-key.txt
catbus mteam auth use work
```

登录先调用个人资料接口校验，再按平台 × 端 × 账号写入 `~/.catbus/auth/mteam/web/<账号>.json`。`auth logout` 清理本地凭证；如需撤销令牌，在 MT 网站操作。

## 浏览、搜索与详情

```bash
catbus mteam feed list --limit 10
catbus mteam item search 纪录片 --mode movie --free --limit 20
catbus mteam item categories
catbus mteam item search 测试 --category 419,439 --limit 20
catbus mteam item get https://kp.m-team.cc/detail/12345
catbus mteam user get me
```

`--mode` 支持 `normal`（默认综合区）、`movie`、`tvshow`、`music`、`anime`、`adult`。`--category` 支持分类 ID，多个用逗号分隔；`--free` 将搜索限定为免费资源。分类以 `item categories` 的实时输出为准。

`feed list` 浏览最新资源；`item list` 仍保留跨平台的“我发布的内容”语义，MT 首版没有实现该命令。用户资料只支持 `me`；`user get me --raw` 可查看上传量、下载量等原始账号字段。

搜索 / 浏览默认返回一页（20 条），支持 `--limit`、`--all`、`--cursor` 和 `-o jsonl`。分页间隔 2.5 秒；游标请使用上次结果中的 `page.cursor`，包括取到半页时的续读位置。

资源输出为 `Torrent`：包含通用 `Item` 字段，`kind` 为 `torrent`，另含 `size`（字节）、`file_count`、`category_id`、`seeders`、`leechers`、`completed`、`discount`。匿名发布者的 `author` 为 null。需要原始字段时使用 `--raw`。

## 下载种子文件

```bash
catbus mteam item download 12345 --dir ./torrents
catbus mteam item download 12345 --dir ./torrents --overwrite
```

只保存 `mteam_<id>_1.torrent`，不会向 BT 客户端添加任务或启动内容传输。已有文件默认跳过，不申请新的下载链接；`--overwrite` 覆盖文件。

种子文件可能包含个人 Tracker 凭证，以 0600 权限原子写入。结果里的 `url` 为 null，临时下载令牌不输出到日志或 JSON；API Key 不转发给下载地址。

## 已实现与限制

- 已实现 11 条命令：5 条账号命令、`user get`、`item get` / `search` / `categories` / `download`、`feed list`。
- 首版覆盖读取和种子文件下载；不提供发布、评论、收藏、签到、上传或 BT 客户端管理。
- API Key 无效或失效按 `AUTH_EXPIRED` 返回；未登录为 `AUTH_REQUIRED`。限流、验证码和访问拦截为 `RISK_CONTROL`，不会自动重试。
- 读取接口已在线核对；种子下载链路以假响应做离线验证，未为验收产生实际下载记录。
