# 文档

## 用户指南

从安装到日常使用，每篇讲一件事：

| 文档 | 内容 |
|---|---|
| [guide/quick-start.md](guide/quick-start.md) | 快速上手：安装、`doctor`、登录、第一条查询、分页、导出 jsonl |
| [guide/login.md](guide/login.md) | 登录：扫码 / 短信 / 账密 / cookie，从 DevTools 复制 cookie，抖音和 TikTok 的会话 JSON，多账号，子站点 `--scope`，登出 |
| [guide/output.md](guide/output.md) | 输出：信封、json / jsonl、`--raw`、归一化类型、分页与游标、退出码与错误处理（含 jq 示例） |
| [guide/configuration.md](guide/configuration.md) | 配置：`config.toml`、代理优先级、超时、`CATBUS_HOME`、数据目录结构 |
| [guide/faq.md](guide/faq.md) | 常见问题：为什么要登录、`RISK_CONTROL` 怎么办、`NOT_IMPLEMENTED` 是什么、支持哪些系统等 |

## 各平台

[platforms/](platforms/README.md)：10 个平台各一篇，写清楚登录方式、支持的命令、私有选项、参数格式、常用示例和已知限制。

[小红书](platforms/xhs.md) · [抖音](platforms/douyin.md) · [TikTok](platforms/tiktok.md) · [B 站](platforms/bilibili.md) · [快手](platforms/kuaishou.md) · [微博](platforms/weibo.md) · [闲鱼](platforms/xianyu.md) · [淘宝](platforms/taobao.md) · [京东](platforms/jd.md) · [X](platforms/x.md)

## 示例脚本

[examples/](../examples/README.md)：用 bash + jq 或 Node 组合 catbus 的脚本，例如跨平台搜索合并成 jsonl、导出全部评论（遇到风控停下、可续跑）、备份用户作品并下载媒体、录直播弹幕。

## 参考

| 文档 | 内容 |
|---|---|
| [capabilities.md](capabilities.md) | 能力矩阵：10 个平台 web 端每条命令的支持情况、登录方式、筛选取值和限制。由注册表生成，也可以运行 `catbus platforms <platform>` 查看 |
| [upstream-map.md](upstream-map.md) | 上游移植对照：每个上游仓库的鉴权、登录、API 方法、签名 JS 与 catbus 命令的对应关系，以及 Python → TypeScript 的依赖替换 |
| [trouble.md](trouble.md) | 真机验证记录：还没跑通的命令、原因与状态（待上游 / 已兜底 / 未测），各平台的验证进度 |

## 规范

[AGENTS.md](../AGENTS.md) 是 catbus 的规范本身：命令语法与词表（第 4 节）、登录态（第 5 节）、输出结构（第 6 节）、架构与测试（第 7 节）、开发约定（第 8 节）。用户指南与它冲突时以 AGENTS.md 为准。

给 AI Agent 的使用说明见 [skills/catbus/SKILL.md](../skills/catbus/SKILL.md)。
