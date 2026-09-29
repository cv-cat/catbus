# 淘宝（taobao）

| 项 | 值 |
|---|---|
| 平台 id | `taobao` |
| 别名 | `tb` |
| `item` 指 | 商品 |
| 上游仓库 | [cv-cat/TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| 移植基线 | master 上的 [`db37194`](https://github.com/cv-cat/TaoBaoApis/commit/db37194b5cbdbe98b1722944e71cc04d82a69dcd)，记录在 [`src/platforms/taobao/UPSTREAM`](../../src/platforms/taobao/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 10 条（✓ 8 · ◐ 2），规划中 ○ 30 条 |

上游 TaoBaoApis 只有**私信**（联系卖家、收发消息）和图片上传，没有商品详情和商品搜索接口，所以淘宝在 catbus 里主要用来做客服 / 买家私信自动化。命令表由注册表生成，与 `catbus platforms taobao` 一致；选项以 `catbus taobao <resource> <action> --help` 为准。通用的命令语法、输出结构见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范)。

## 登录

淘宝**只支持导入 cookie**（上游没有登录接口）：

```bash
catbus taobao auth login --cookie @taobao-cookie.txt
```

- 在浏览器登录 www.taobao.com，从 DevTools → Network 复制完整的 Cookie 请求头。必须有 `unb`（用户 ID），以及 mtop 签名要用的 `_m_h5_tk` 和 `cookie2`；缺 `unb` 时报 `USAGE`。
- 上游没有取当前用户的接口：导入和 `auth status` 时，catbus 换一次私信 token 来校验登录态，账号信息取自 cookie 里的 `unb` 和昵称（`_nk_`）。
- 没有子站点。

## 支持的命令

✓ 上游已有，◐ 上游部分支持（限制写在说明里），○ 规划中（执行时返回 `NOT_IMPLEMENTED`，退出码 4）。表里没有的命令表示淘宝没有这个概念，执行时报 `UNSUPPORTED`（退出码 2）。

### auth

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 登录，方式见上文「登录」。 |
| `auth status` | ◐ | 在线校验登录态。上游没有取当前用户的接口：校验时换一次私信 token，账号信息取自 cookie 里的 `unb` 和昵称。 |
| `auth logout` | ✓ | 登出并删除本地凭证。 |
| `auth list` | ✓ | 本平台、本端的账号。 |
| `auth use` | ✓ | 切换当前账号。 |

### user

| 命令 | 状态 | 说明 |
|---|---|---|
| `user get` | ◐ | 用户资料。参数只接受商品链接（淘宝 / 天猫商品页或 m.tb.cn 分享短链），返回这件商品的卖家；me 规划中。 |
| `user items`、`user collects` | ○ | 规划中 |

### msg

| 命令 | 状态 | 说明 |
|---|---|---|
| `msg history` | ✓ | 会话的消息记录。 |
| `msg send` | ✓ | 发私信；`--item` 表示联系商品的卖家或客服。`--item` 联系商品卖家，`--conversation` 回复已有会话；不支持 `--to`（没有按用户发起会话的接口）。只支持文字和图片。 |
| `msg listen` | ✓ | 监听新消息。持续输出 jsonl。 |
| `msg list`、`msg read`、`msg revoke`、`msg delete` | ○ | 规划中 |

### media

| 命令 | 状态 | 说明 |
|---|---|---|
| `media upload` | ✓ | 上传媒体。只支持图片。 |

### 整组规划中

下面这些 resource 在本平台还没有已实现的命令，执行时都返回 `NOT_IMPLEMENTED`（退出码 4）。

| resource | 命令 |
|---|---|
| `item` | `get` `search` `related` `collect` `uncollect` |
| `comment` | `list` |
| `feed` | `list` |
| `live` | `get` `list` `search` `categories` `listen` `history` `send` `like` `rank` `gifts` `products` `media` `replays` `start` `stop` |
| `keyword` | `suggest` |
| `history` | `list` |

## 私有选项与平台扩展

淘宝没有私有选项，也没有扩展命令。

## 参数格式

| 参数 | 接受的形式 |
|---|---|
| 商品 `--item` | 纯数字的商品 ID、淘宝 / 天猫商品链接（`item.taobao.com/item.htm?id=<id>`、`detail.tmall.com/...`），或分享短链 `m.tb.cn/...` |
| 用户 `<user>`（`user get`） | **只接受商品链接**（淘宝 / 天猫商品页或 `m.tb.cn` 短链），返回这件商品的卖家。淘宝没有按用户 ID 查询的接口，`me` 规划中 |
| 会话 `<conversation>` / `--conversation` | 形如 `<我的用户 id>.1-<对方用户 id>.1#11001` 的会话 ID（可带 `@cntaobao` 后缀），来自 `msg listen` 或 `msg history` 的 `conversation_id`；必须属于当前账号 |

## 私信怎么发

| 写法 | 效果 |
|---|---|
| `msg send <text> --item <商品>` | 打开商品页取卖家，建会话再发 |
| `msg send <text> --conversation <会话 ID>` | 回复已有会话 |
| `msg send <text> --to <用户>` | **不支持**：淘宝没有按用户发起会话的接口，报 `UNSUPPORTED` |

文字和 `--image` 可以一起给，依次发送，返回最后一条。不支持发视频。

## 示例

```bash
# 导入 cookie（macOS 可以直接从剪贴板读）
pbpaste | catbus taobao auth login --cookie -
catbus taobao auth status

# 查一件商品的卖家
catbus taobao user get "<item_url>"

# 联系卖家，带一张图
catbus taobao msg send "请问有现货吗？" --item "<item_url>" --image photo.jpg

# 回复已有会话
catbus taobao msg send "好的，谢谢" --conversation "<conversation_id>"

# 会话的全部消息（从旧到新）
catbus taobao msg history "<conversation_id>" --all -o jsonl > history.jsonl

# 监听新消息 30 分钟
catbus taobao msg listen --duration 30m > inbox.jsonl
```

## 已知限制

来自 [docs/trouble.md](../trouble.md) 的真机验证记录（截至 2026-09-29）：

- **没有商品详情、搜索、评价**：上游没有这些接口，`item get`、`item search`、`comment list` 都是 ○。上游代码里的 `item_detail_url` 字段是从闲鱼带过来的，没有使用。
- **验证进度**：cookie 登录、`auth status`、`msg listen`（长连正常）、图片上传已真机通过；`msg send` 还没测。`user get` 要商品链接、`msg history` 要会话 id，在线测试拿不到，没有自动验证。见 [trouble.md 6.2](../trouble.md#62-各平台进度)。
- **中文昵称发消息**：照上游，消息的 `sender_nick` 用 cookie `_nk_` 的原值、不解码；测试账号的昵称是 ASCII，中文昵称的情况还没验证。
- **`msg history` 的游标**：同一条长连上翻页，结果从旧到新排列；`--limit` 截在一页中间时的游标格式是推断的（同闲鱼），待真机确认。
