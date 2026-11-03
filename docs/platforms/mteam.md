# M-Team（web 端）

| 项 | 值 |
|---|---|
| 平台 id | `mteam` |
| 别名 | `mt`、`m-team`、`mantou` |
| `item` 指 | 种子资源 |
| 登录 | 官方 API Key（`apikey`，默认）或网页账密（`password`） |
| 接口 | `https://api.m-team.cc/api`：API Key 用 `x-api-key` 请求头；账密登录用网页的 `authorization` 令牌并带网页签名 |
| 端 | web ✓ · app / pc 规划中 |

直接调用 MT 的 API；不需要导入浏览器 Cookie、运行 Python 或安装浏览器。接口来源与验证范围见 [UPSTREAM](../../src/platforms/mteam/UPSTREAM)。

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

## 账密登录

站内信接口不接受 API Key，要用网页账密登录。密码只从 stdin 读：

```bash
catbus mteam auth login --method password --username <用户名> --password-stdin
```

在新设备上登录时站点要求两步验证：

- 账号开了 TOTP：加 `--code <动态码>`。
- 邮箱验证：TTY 下按提示输入绑定邮箱和收到的验证码。非 TTY 下分两次执行，两次都从 stdin 读密码：

```bash
echo "$PASSWORD" | catbus mteam auth login --method password --username <用户名> --password-stdin --email <绑定邮箱>
# 邮箱收到验证码后（10 分钟内）
echo "$PASSWORD" | catbus mteam auth login --method password --username <用户名> --password-stdin --code <验证码>
```

第一次执行时站点发送验证码，catbus 保存中间态（设备标识和验证方式，不含密码）并返回 `{"sent": true, "verify": "email"}`。登录成功后凭证里保存网页令牌（约 30 天有效，`auth status` 的 `expires_at`）和设备标识；令牌过期后报 `AUTH_EXPIRED`，重新登录即可。站点要求先验证账号邮箱（1002）时报 `RISK_CONTROL`，需要在浏览器里完成。

## 浏览、搜索与详情

```bash
catbus mteam feed list --limit 10
catbus mteam item search 纪录片 --mode movie --free --limit 20
catbus mteam item categories
catbus mteam item search 测试 --category 419,439 --limit 20
catbus mteam item get https://kp.m-team.cc/detail/12345
catbus mteam user get me
```

`--mode` 支持 `normal`（默认综合区）、`movie`、`tvshow`、`music`、`anime`、`adult`。`--category` 支持分类 ID，多个用逗号分隔；`--free` 将搜索限定为免费资源。`--order-by` 按 `date`、`size`、`seeders`、`leechers`、`name` 排序，默认降序，加 `--asc` 升序；站点置顶的资源总排在最前。分类以 `item categories` 的实时输出为准。

`feed list` 浏览最新资源；`item list` 仍保留跨平台的“我发布的内容”语义，MT 首版没有实现该命令。用户资料只支持 `me`；`user get me --raw` 可查看上传量、下载量等原始账号字段。

搜索 / 浏览默认返回一页（20 条），支持 `--limit`、`--all`、`--cursor` 和 `-o jsonl`。分页间隔 2.5 秒；游标请使用上次结果中的 `page.cursor`，包括取到半页时的续读位置。

资源输出为 `Torrent`：包含通用 `Item` 字段，`kind` 为 `torrent`，另含 `size`（字节）、`file_count`、`category_id`、`seeders`、`leechers`、`completed`、`discount`。匿名发布者的 `author` 为 null。需要原始字段时使用 `--raw`。

## 收藏、做种列表、魔力值记录、站内信

```bash
catbus mteam item collect 12345
catbus mteam item uncollect 12345
catbus mteam user collects --mode movie
catbus mteam seed list --status seeding
catbus mteam bonus history --limit 50
catbus mteam exam get
catbus mteam bonus get
catbus mteam seed stats
catbus mteam msg list --box system
catbus mteam msg history <id>
```

- `item collect` / `uncollect` 按目标状态设置，重复执行不报错。`user collects` 按分区列出收藏（`--mode`，默认 normal）。
- `seed list --status` 取 `seeding`（默认）、`leeching`、`completed`、`incomplete`、`uploaded`。输出 `Torrent[]`，本账号在该种子上的上传量、下载量、分享率写在 `text` 开头；种子已删除时 `title` 为 null。
- `bonus history` 输出 `BonusRecord[]`：`type` 为站点的记录类型（如 `TRACKER`、`TORRENT`），`change` 为魔力值变化，上传量、下载量的变化写进 `note`；站点不提供变动前后的余额，`before` / `after` 为 null。
- `exam get` 列出进行中的考核（新人考核等）：`items` 依次为 `download`、`upload`（字节）和 `bonus`（魔力值），各带 `current`、`target`、`done`；没有考核时为空数组。
- `bonus get` 给出时魔：`per_hour` 每小时魔力值、`a` A 值、`seeding_count` / `seeding_size_gb` 计入时魔的做种数和体积（GB）、`two_factor` 是否开启两步验证。`seed stats` 给出 tracker 上当前的做种数和下载数。
- `msg list --box` 取 `inbox`（默认，收件箱）、`system`（系统通知）、`sent`（发件箱），每条站内信作为一个会话；系统消息的 `peer` 为 `{id: "0", name: "系统"}`。`msg history` 读取一条，不会标记已读。站内信只支持账密登录的会话，API Key 会话报 `UNSUPPORTED`。

## 下载种子文件

```bash
catbus mteam item download 12345 --dir ./torrents
catbus mteam item download 12345 --dir ./torrents --overwrite
catbus mteam item download 12345 --dir ./torrents --qbit --qbit-category movie --qbit-paused
```

保存 `mteam_<id>_1.torrent`。已有文件默认跳过，不申请新的下载链接；`--overwrite` 覆盖文件。`--qbit` 把种子推送到本机 qBittorrent Web UI（地址用 `CATBUS_MTEAM_QBIT_URL` 指定，默认 `http://127.0.0.1:25254`，直连、不走代理；Web UI 需要对本机地址免认证），默认分类 `mteam`，分类不存在时自动创建；`--qbit-paused` 推送后先暂停。qBittorrent 里已有同一个种子时只在 stderr 警告。

下载链接由 `api.m-team.cc` 跳转到下载节点 `*.halomt.com`；catbus 只跟随这两类 HTTPS 地址。

种子文件可能包含个人 Tracker 凭证，以 0600 权限原子写入。结果里的 `url` 为 null，临时下载令牌不输出到日志或 JSON；API Key 不转发给下载地址。

## 已实现与限制

- 已实现 22 条命令：5 条账号命令、`user get` / `collects`、`item get` / `search` / `categories` / `download` / `collect` / `uncollect`、`feed list`、`seed list` / `stats`、`exam get`、`bonus get` / `history`、`msg list` / `history`。
- 不提供发布、评论、签到、上传，以及发送、删除站内信。
- 令牌无效或失效按 `AUTH_EXPIRED` 返回；未登录为 `AUTH_REQUIRED`。限流、验证码和访问拦截为 `RISK_CONTROL`，不会自动重试。
- 下载大文件或非免费种前先看大小、优惠和做种人数：实际下载会影响分享率和新人考核。
