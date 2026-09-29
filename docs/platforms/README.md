# 各平台说明

每个平台一篇：登录方式、支持的命令（✓ / ◐ / ○）、私有选项与扩展命令、接受的参数格式、常用示例和已知限制。所有平台共用同一套命令语法和输出结构，见 [AGENTS.md 第 4 节](../../AGENTS.md#4-命令规范) 和 [输出指南](../guide/output.md)；跨平台对比见 [能力矩阵](../capabilities.md)。

| 平台 | id | 别名 | `item` 指 | 登录（**粗体**为默认） | 已实现（✓ · ◐） | 规划中 ○ | 上游仓库 |
|---|---|---|---|---|---|---|---|
| [小红书](xhs.md) | `xhs` | `xiaohongshu` `rednote` | 笔记 | **扫码** · 短信 · cookie；子站点 `creator` | 43（38 · 5） | 28 | [Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| [抖音](douyin.md) | `douyin` | `dy` | 作品 | **扫码** · 短信 · cookie | 40（34 · 6） | 31 | [DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| [TikTok](tiktok.md) | `tiktok` | `tt` | 视频 | **cookie**（或浏览器会话 JSON） | 55（47 · 8） | 20 | [TiktokApis](https://github.com/cv-cat/TiktokApis) |
| [B 站](bilibili.md) | `bilibili` | `bili` `b` | 稿件 | **扫码** · 短信 · 账密 · cookie | 48（41 · 7） | 30 | [BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| [快手](kuaishou.md) | `kuaishou` | `ks` | 作品 | **扫码** · 短信 · cookie | 30（25 · 5） | 41 | [KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| [微博](weibo.md) | `weibo` | `wb` | 微博 | **cookie** | 12（10 · 2） | 55 | [WeiboApis](https://github.com/cv-cat/WeiboApis) |
| [闲鱼](xianyu.md) | `xianyu` | `goofish` `xy` | 闲置商品 | **扫码** · cookie | 12（11 · 1） | 18 | [XianYuApis](https://github.com/cv-cat/XianYuApis) |
| [淘宝](taobao.md) | `taobao` | `tb` | 商品 | **cookie** | 10（8 · 2） | 30 | [TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| [京东](jd.md) | `jd` | `jingdong` | 商品 SKU | **扫码** · 短信 · cookie | 21（18 · 3） | 6 | [JdApis](https://github.com/cv-cat/JdApis) |
| [X](x.md) | `x` | `twitter` | 推文 | **cookie** | 33（30 · 3） | 20 | [XApis](https://github.com/cv-cat/XApis) |

- 数字是 web 端注册表里的命令数，包含 `auth` 命令和平台扩展命令；平台没有这个概念的命令（矩阵里的 —）不计入。app / pc 端目前全部是规划中。
- ✓ 上游已有；◐ 上游部分支持，限制写在各篇的说明里；○ 规划中，执行时返回 `NOT_IMPLEMENTED`（退出码 4）。
- 命令表以注册表为准：`catbus platforms <platform>` 输出同样的数据（JSON），`catbus <platform> <resource> <action> --help` 列出每条命令的参数和选项。
- 各平台的真机验证进度和未解决的问题见 [trouble.md](../trouble.md)；各篇的「已知限制」摘自那里。

## 怎么选登录方式

- **扫码**最省事：xhs、douyin、bilibili、kuaishou、xianyu、jd 默认就是扫码，二维码画在终端（stderr）里，同时存一份 PNG 到 `~/.catbus/cache/<platform>/`。小红书扫码后常被要求人机验证，目前建议改用 cookie。
- **cookie** 是 tiktok、weibo、taobao、x 唯一的方式，其他平台加 `--method cookie` 也能用。一定要从 DevTools → Network 复制请求头里完整的 Cookie：登录态的关键 cookie 大多是 HttpOnly 的，`document.cookie` 拿不到。
- 抖音、TikTok 的写操作还需要浏览器里的设备 / 票据数据，只有 cookie 时写操作会在本地被拦下。详见各自的页面和 [登录指南](../guide/login.md)。
