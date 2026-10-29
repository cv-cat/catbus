---
name: catbus
description: 用 catbus CLI 读取或操作小红书（RedNote）、抖音、TikTok、B 站（Bilibili）、快手、微博、闲鱼、淘宝、京东、X（Twitter）、12306 铁路、即梦这 12 个平台：搜索、详情、评论、用户、推荐流、下载、发布、点赞关注、私信、直播弹幕、列车余票票价、即梦多账号切换，输出统一的 JSON。用户要查询、采集、导出、监听或操作这些平台上的内容和账号时使用。
---

# catbus

catbus（猫巴士）是一个命令行工具，用**同一套命令、同一种 JSON** 调用 11 个平台的 web 端接口，另外管理即梦官方 CLI（dreamina）的多账号登录态。stdout 只有 JSON，日志、提示、二维码都在 stderr。

先确认它能用：`catbus version`、`catbus doctor`。找不到 `catbus` 命令时告诉用户安装（`npm i -g catbus-cli`），不要自己去装。

## 按任务读对应的文件

这个文件只放总纲。动手前，按任务再读一两个文件，不需要全读：

| 任务 | 读 |
|---|---|
| 涉及某个平台 | `platforms/<id>.md`：能做什么、做不到什么、参数怎么传、有哪些坑 |
| 搜索、采集、导出、翻页、下载、跨平台对比 | [workflows/collect.md](workflows/collect.md) |
| 发布、评论、点赞、收藏、关注、删除等写操作 | [workflows/write.md](workflows/write.md) |
| 直播弹幕监听、私信 | [workflows/live-msg.md](workflows/live-msg.md) |
| 命令报错：未登录、风控、不支持、网络 | [workflows/errors.md](workflows/errors.md) |
| 查某条命令的参数、选项、输出字段 | [reference/commands.md](reference/commands.md) |

## 平台

| 平台 | id | 别名 | `item` 是 | 登录 | 文件 |
|---|---|---|---|---|---|
| 小红书 | `xhs` | `xiaohongshu` `rednote` | 笔记 | cookie（扫码常被拦） | [platforms/xhs.md](platforms/xhs.md) |
| 抖音 | `douyin` | `dy` | 作品 | 扫码 | [platforms/douyin.md](platforms/douyin.md) |
| TikTok | `tiktok` | `tt` | 视频 | cookie / 会话 JSON | [platforms/tiktok.md](platforms/tiktok.md) |
| B 站 | `bilibili` | `bili` `b` | 稿件 | 扫码 | [platforms/bilibili.md](platforms/bilibili.md) |
| 快手 | `kuaishou` | `ks` | 作品 | 扫码 | [platforms/kuaishou.md](platforms/kuaishou.md) |
| 微博 | `weibo` | `wb` | 微博 | cookie | [platforms/weibo.md](platforms/weibo.md) |
| 闲鱼 | `xianyu` | `goofish` `xy` | 闲置商品 | 扫码 | [platforms/xianyu.md](platforms/xianyu.md) |
| 淘宝 | `taobao` | `tb` | 商品 | cookie | [platforms/taobao.md](platforms/taobao.md) |
| 京东 | `jd` | `jingdong` | 商品 SKU | 扫码 | [platforms/jd.md](platforms/jd.md) |
| X | `x` | `twitter` | 推文 | cookie | [platforms/x.md](platforms/x.md) |
| 12306 铁路 | `12306` | — | 车次 | 免登录 | [platforms/12306.md](platforms/12306.md) |
| 即梦 | `jimeng` | `dreamina` | 作品 | 浏览器授权（只管 dreamina 的登录态） | [platforms/jimeng.md](platforms/jimeng.md) |

**还不支持**：Instagram、YouTube、Facebook、知乎、微信公众号、今日头条、得物、拼多多、美团、大众点评正在开发，现在执行会报「未知的平台」（`USAGE`）。用户问到时直接说还不支持，不要尝试调用，也不要拿别的平台凑数。

## 命令语法

```
catbus <platform> <resource> <action> [参数...] [选项...]
```

- resource / action 用规范词，**所有平台同名**：笔记、视频、推文、商品一律叫 `item`，搜索叫 `search`，收藏夹叫 `folder`，私信叫 `msg`。`note`、`video`、`tweet` 这类原生叫法会报 `UNSUPPORTED`，`hint` 里给出规范词。
- 参数接受 ID、URL（包括分享短链）、平台自然标识（B 站 BV 号、X 用户名）；用户参数还可以是 `me`。**输出对象都带 `id` 和 `url`，直接当下一条命令的参数**，小红书一定要传 `url`。
- 以 `-` 开头的位置参数放在 `--` 之后。选项可以出现在任意位置。
- `-e app|pc` 都还没实现（`NOT_IMPLEMENTED`），只用默认的 web 端。

## 先查能力，再调用

平台之间差别很大，调用前先查，不要猜：

```bash
catbus platforms xhs              # JSON：每条命令的 status（implemented / planned）、auth、note
catbus xhs item search --help     # 参数、选项、筛选取值、登录要求、输出类型
```

- `status` 为 `planned` 的命令会报 `NOT_IMPLEMENTED`，不要调用；`note` 写着限制（例如「只支持 me」），调用前看一眼。
- 筛选取值（`--sort` `--type` `--time`）每个平台不同，以 `--help` 为准。
- 平台文件里的「能做 / 做不到」是摘要，与 `catbus platforms` 冲突时以后者为准。

## 信封与退出码

stdout 恰好一个信封（`-o jsonl` 时每行一条 `data`，摘要信封在 stderr 最后一行）：

```json
{ "ok": true, "platform": "bilibili", "resource": "item", "action": "get", "account": "default",
  "data": {}, "page": null, "error": null }
```

失败时 `ok` 为 false、`error` 为 `{code, message, hint, detail}`。**先读 `error.hint`**，它是下一步该执行的命令或做法。

| 退出码 | code | 一句话 |
|---|---|---|
| 0 | — | 成功 |
| 2 | `USAGE` / `UNSUPPORTED` / `CONFIRM_REQUIRED` | 参数错 / 平台没有 / 危险操作没确认 |
| 3 | `AUTH_REQUIRED` / `AUTH_EXPIRED` | 让用户登录 |
| 4 | `NOT_IMPLEMENTED` | 规划中，别重试 |
| 5 | `RISK_CONTROL` | 风控，停下，别重试 |
| 6 | `NETWORK` | 网络 / 代理 |
| 7 | `UPSTREAM` | 平台业务错误，原始码在 `detail` |
| 1 | `ERROR` | 其他 |

每种错误怎么处理见 [workflows/errors.md](workflows/errors.md)。

## 红线

这些规则在任何任务里都成立：

1. **登录交给用户**。扫码要用户的手机，短信、密码、cookie 要用户本人提供。把 `hint` 里的登录命令给用户，让他在自己的终端执行；不要索要或保存密码、验证码、cookie，不要读取、打印或修改 `~/.catbus/` 里的凭证文件。
2. **写操作先确认**。发布、评论、点赞、关注、私信、删除会真实改变用户的账号。用户没有明确要求就不做；危险操作只在用户同意**这一次**之后才加 `-y`。
3. **发布默认仅自己可见**（`--visibility private`），除非用户明确要公开。平台只支持公开时（闲鱼、X、B 站动态），先告诉用户会公开发出去。
4. **不主动联系真人**：不给别人发私信、评论、@、关注，除非用户给出了对象和内容。不批量发送。
5. **风控就停**：`RISK_CONTROL` 不要循环重试，连续请求同一平台时留出间隔，不并发。
6. **照实汇报**：结果为空、字段为 null、命令不支持，都照实告诉用户，不编造数据。

## xhs 461/471 风控验证（verifytype 124）移植注意（2026-10-17）

- `redcaptcha/v2/qr/init` **只认刚出炉的安全引导**：必须先用 XHSLoginApi 对当前会话重跑
  `scripting/seccallback→activate→webprofile`（websectiga 换新、fe-login 上下文）再 init，
  用登录时的旧引导态会被 40001「为了保护账号安全」拒。**b1 没失效**，服务端校验的是引导
  动作的时效（防重放）。上游 `risk_qr_verify`（xhs_pc_apis.py）已内置该重引导。
- 状态机：`qr/status/query` 的 data.status：1=INIT 2=SCAN 3=CANCEL 4=CONFIRM 5=EXPIRE 6=FAIL；
  4 之后重试原请求即可。
- verifyBiz：461=antiSpider（业务接口）、471=antiSpam（登录链），验证机制完全共用。
- 二维码内容：`https://www.xiaohongshu.com/web-login/qrcode-transfer?rid=<rid>&verifyUuid=<uuid>&verifyType=124`，约 1 分钟过期，过期重 init 换码即可。

## douyin 发布链风控层级（2026-10-17 实测逆向，上游 DouYin_Spider）

发布 `create_v2` 可能遇到三层风控，逐层递进（`x-tt-verify-passport-decision` 响应头判断）：

1. **`verify_reason=gateway_biz_verify`**（会话信任不足）→ verify_ways 含 `qr_code_verify`。
   修复：`get_qrcode?aid=6383&scene=secondary_verify&verify_scene=creator` → App 扫码 →
   `check_qrconnect` status=confirmed。**aid 必须 6383**（2906 回 4031）。
2. **`verify_reason=gateway_web_authlv_check`**（认证等级不足）→ 要求短信/人脸/密码。
   QR 不够；SMS 发码（POST /passport/web/send_code/ type=22）在纯 HTTP 会话下回
   error_code=16「该应用无权限」——authlv 需要浏览器上下文或 App 内提升。
3. Cookie 集合差异：浏览器有 13 个信任 cookie（`__security_mc_*` 系列、`d_ticket`、
   `store-region` 等）是长期使用积累，fresh QR 会话结构性无法获得 → cookie 导入
   （catbus `auth login --method cookie`）是绕开 1/2 的实际路径。

其他已固化对齐项（勿回退）：
- dtrait 内层 blob 与真实设备逐字节一致（176B）；指纹/UA 全 Chrome 155。
- Cookie 头顺序按浏览器 wire 序（上游 DouyinAuth.BROWSER_COOKIE_ORDER）。
- creator 域 msToken 独立通道（ms_appid=2906；184 长度版本由 TLS/JA3 决定，
  curl_cffi chrome150 拿到 164——服务端按 ClientHello 版本发不同长度 token）。
