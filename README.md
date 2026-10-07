<div align="center">

<img src="assets/hero.svg" width="100%" alt="catbus — 上车，开往任何平台">

<br>

**一个命令，开往 11 个平台。**<br>
小红书 · 抖音 · TikTok · B 站 · 快手 · 微博 · 闲鱼 · 淘宝 · 京东 · X · 12306
<br>
<sub>即将上车：Instagram · YouTube · Facebook · 知乎 · 微信公众号 · 今日头条 · 得物 · 拼多多 · 美团 · 大众点评</sub>

<br>

[![npm](https://img.shields.io/npm/v/catbus-cli?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/catbus-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-11-F38BA8?style=for-the-badge)](docs/platforms/README.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-ready-CBA6F7?style=for-the-badge)](.claude/skills/catbus/SKILL.md)

**简体中文** · [English](README.en.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

[快速上手](docs/guide/quick-start.md) · [能力矩阵](docs/capabilities.md) · [各平台](docs/platforms/README.md) · [示例](docs/examples/README.md) · [给 Agent 用](.claude/skills/catbus/SKILL.md)

</div>

<br>

> 每个平台都有自己的一套接口、签名、登录方式和数据格式。**catbus 把它们装进同一辆车**：同一套命令、同一种 JSON、同一个登录态目录。换平台，只需要换一个词。

## ✨ catbus 是什么

catbus（猫巴士）是一个命令行工具，用**统一的语法**调用 11 个中外主流平台的 web 端能力：搜索、详情、评论、用户、推荐流、下载、发布、私信、直播弹幕、列车余票票价……

```bash
catbus xhs      item search 露营 --sort latest
catbus douyin   item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus x        item search camping --sort latest
```

四个平台，四条几乎一样的命令，输出**同一种结构**的 JSON。笔记、作品、稿件、推文一律叫 `item`，搜索一律叫 `search`，点赞一律叫 `like`。学一次，十个平台都会用。

<p align="center">
  <img src="assets/platforms.svg" width="100%" alt="已支持的 10 个平台与正在开发的 10 个平台">
</p>

## 🚀 为什么是 catbus

<table>
<tr>
<td width="50%" valign="top">

### 🧭 同义同名
含义相同的能力，在所有平台上用**同一个命令、同一组参数、同一种输出**。用了平台原生叫法（`note`、`aweme`、`tweet`……）也没关系，catbus 会告诉你该用哪个词。

</td>
<td width="50%" valign="top">

### 📦 只需要 Node
不需要 Python、编译器或任何系统依赖。原生依赖全部带预编译包，覆盖 Windows、macOS、Linux 的 x64 / arm64（含 musl），**8 个目标系统**在 CI 上逐一冒烟。

</td>
</tr>
<tr>
<td valign="top">

### 🤖 为 AI Agent 而生
stdout 只有 JSON，退出码稳定，错误里带着下一步该执行的命令；`catbus platforms` 输出完整的能力清单。自带 [Agent 技能](.claude/skills/catbus/SKILL.md) 与 [llms.txt](llms.txt)。

</td>
<td valign="top">

### 🔐 登录态只在你的电脑上
扫码、短信、cookie 导入都支持，凭证按 **平台 × 端 × 账号** 隔离在 `~/.catbus/`（0700 / 0600），多账号随时切换。不收集、不上传任何数据，没有遥测。

</td>
</tr>
<tr>
<td valign="top">

### 🧪 与上游逐字节一致
每个请求的 URL、header 顺序、cookie、body 和签名，都在固定的随机数与时钟下和上游实现**逐字节对拍**。560+ 份对拍数据、940+ 个离线测试守住每一次改动。

</td>
<td valign="top">

### 🛡️ 浏览器级的网络栈
与真 Chrome 一致的 TLS / HTTP2 指纹，上游签名 JS 原样在沙箱里运行，滑块、点选验证码用本地的 ONNX 与 OpenCV 自动识别。

</td>
</tr>
</table>

## 📊 一些数字

<div align="center">

| 🚌 平台 | ⌨️ 已实现命令 | 🧪 对拍数据 | ✅ 离线测试 | 💻 目标系统 |
|:---:|:---:|:---:|:---:|:---:|
| **11** | **300+** | **560+** | **960+** | **8** |

</div>

## 🏗️ 架构

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="catbus 架构">
</p>

- **一个注册表驱动一切**：命令解析、四层 `--help`、`catbus platforms`、[能力矩阵](docs/capabilities.md) 都由同一份注册表生成，永远不会互相矛盾。
- **一个平台，一组文件**：`client` 管会话与签名，`api` 一一对应上游方法，`normalize` 把原始数据变成统一的类型，`resolve` 让 ID、链接、分享短链、`me` 都能当参数。
- **可扩展**：规范为 app / pc 端预留了位置；非 JS 的上游将通过 provider 协议接入。

## 🤖 为 AI Agent 而生

catbus 从第一天起就按「被程序调用」来设计：

```bash
catbus platforms douyin | jq '.data.commands[] | select(.status=="implemented") | .resource + " " + .action'
```

- **自描述**：每个平台、每条命令的登录要求、实现状态、上游支持程度，一条命令就能查到。
- **可预期**：成功和失败都是同一种信封 `{ ok, data, page, error }`；`error.hint` 直接给出下一步命令。
- **能接力**：所有输出对象都带 `id` 和 `url`，上一条命令的结果可以直接喂给下一条。
- **有分寸**：危险操作必须显式 `-y`，发布可以设为仅自己可见，遇到风控明确报 `RISK_CONTROL`，不会悄悄重试。

一条命令把 catbus 技能装进 Claude Code、Cursor、Codex 等 Agent：

```bash
npx skills add cv-cat/catbus
```

技能按需加载：总纲只有一页，涉及哪个平台、做哪类事（采集、发布、直播私信、排错）才读对应的[子文件](.claude/skills/catbus/SKILL.md)，并且内置了安全红线——登录交给你、写操作先确认、发布默认仅自己可见、遇到风控就停。

## ⚡ 30 秒上车

```bash
npm i -g catbus-cli

catbus doctor                 # 检查环境
catbus bilibili auth login    # 扫码登录
catbus bilibili item search 猫 --limit 20
```

也可以用 [Docker](docs/guide/docker.md) 或从源码安装，完整步骤见 [快速上手](docs/guide/quick-start.md)。

## 📚 文档

| | |
|---|---|
| 🚀 [快速上手](docs/guide/quick-start.md) | 从安装到导出第一批数据 |
| 🔑 [登录](docs/guide/login.md) · ⚙️ [配置](docs/guide/configuration.md) · 🐳 [Docker](docs/guide/docker.md) | 扫码 / cookie、多账号、代理、容器 |
| 📤 [输出与错误处理](docs/guide/output.md) | 信封、归一化类型、分页、退出码 |
| 🧭 [各平台说明](docs/platforms/README.md) · 🗂️ [能力矩阵](docs/capabilities.md) | 每个平台支持什么、怎么传参 |
| 🧪 [示例脚本](docs/examples/README.md) | 跨平台搜索、导出评论、备份作品、录直播弹幕 |
| 📐 [AGENTS.md](AGENTS.md) | catbus 的规范本身 |
| ❓ [常见问题](docs/guide/faq.md) | 为什么要登录、遇到风控怎么办…… |

## 🤝 参与

欢迎 issue 和 PR：新平台、新命令、平台接口变了、文档改进都可以。开始之前读一下 [CONTRIBUTING.md](.github/CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)（规范先行，请求必须有对拍）。安全问题请按 [SECURITY.md](.github/SECURITY.md) 私下报告。

## 📈 Star 趋势

<a href="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
    <img alt="Star History Chart" src="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
  </picture>
</a>

## 🍔 交流群

如果你对爬虫和 AI Agent 感兴趣，可以加入群聊一起讨论~

ps：群满或二维码过期时，请提 issue，或者通过微信 / QQ 提醒

| group-1 | group-2 | group-3 | group-4 (2000 人 QQ 群) |
|:--:|:--:|:--:|:--:|
| <img width="280" alt="group1" src="https://cvcat.site/assets/group1.jpg" /> | <img width="280" alt="group2" src="https://cvcat.site/assets/group2.jpg" /> | <img width="280" alt="group3" src="https://cvcat.site/assets/group3.jpg" /> | <img width="280" alt="group4" src="https://cvcat.site/assets/group4.jpg" /> |

<details>
<summary><b>⚠️ 免责声明</b></summary>

<br>

- 本项目仅供学习和研究使用，请勿用于商业用途或任何违法用途。
- 使用时请遵守各平台的用户协议和服务条款，以及你所在地的法律法规；不要采集、传播他人的隐私数据，不要对平台造成过大的请求压力。
- 自动化操作可能触发平台风控，导致验证码、限流乃至账号被封禁。由使用本项目产生的一切后果由使用者自行承担。
- 本项目与上述任何平台都没有关联，也未获得其授权或认可。各平台名称和商标归其所有者所有。

</details>

## 📄 License

[MIT](LICENSE) © 2026 [cv-cat](https://github.com/cv-cat)

<div align="center">
<br>
<img src="assets/logo.svg" width="64" alt="catbus">
<br>
<sub>上车，开往任何平台 · All aboard, every platform.</sub>
</div>
