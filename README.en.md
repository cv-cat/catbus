<div align="center">

<img src="assets/hero.svg" width="100%" alt="catbus — All aboard, every platform.">

<br>

**One command. Eleven platforms.**<br>
RedNote (Xiaohongshu) · Douyin · TikTok · Bilibili · Kuaishou · Weibo · Xianyu · Taobao · JD.com · X · 12306
<br>
<sub>Coming soon: Instagram · YouTube · Facebook · Zhihu · WeChat Official Accounts · Toutiao · Poizon (Dewu) · Pinduoduo · Meituan · Dianping</sub>

<br>

[![npm](https://img.shields.io/npm/v/catbus-cli?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/catbus-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-11-F38BA8?style=for-the-badge)](docs/platforms/README.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-ready-CBA6F7?style=for-the-badge)](.claude/skills/catbus/SKILL.md)

[简体中文](README.md) · **English** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

[Quick start](docs/guide/quick-start.md) · [Capabilities](docs/capabilities.md) · [Platforms](docs/platforms/README.md) · [Examples](docs/examples/README.md) · [For agents](.claude/skills/catbus/SKILL.md)

</div>

<br>

> Every platform has its own APIs, its own request signing, its own login flow and its own data format. **catbus puts them all on one bus**: one set of commands, one JSON shape, one home for your logins. To switch platforms, you change a single word.

## ✨ What is catbus

catbus (猫巴士) is a command-line tool that drives the web endpoints of 11 major Chinese and global platforms through **one unified syntax**: search, details, comments, users, feeds, downloads, publishing, direct messages, live-stream chat, train tickets and more.

```bash
catbus xhs      item search 露营 --sort latest
catbus douyin   item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus x        item search camping --sort latest
```

Four platforms, four nearly identical commands, and JSON output with **the same structure**. Notes, posts, videos and tweets are all just `item`; searching is always `search`; liking is always `like`. Learn it once, and you can use all 11 platforms.

<p align="center">
  <img src="assets/platforms.svg" width="100%" alt="10 supported platforms and 10 more in progress">
</p>

## 🚀 Why catbus

<table>
<tr>
<td width="50%" valign="top">

### 🧭 Same meaning, same name
A capability that means the same thing uses **the same command, the same options and the same output** on every platform. Reach for a platform's native term (`note`, `aweme`, `tweet`…) and catbus will tell you which word to use instead.

</td>
<td width="50%" valign="top">

### 📦 Node is all you need
No Python, no compiler, no system dependencies. Every native dependency ships prebuilt binaries covering x64 / arm64 on Windows, macOS and Linux (musl included), and all **8 target systems** are smoke-tested one by one in CI.

</td>
</tr>
<tr>
<td valign="top">

### 🤖 Built for AI agents
stdout carries nothing but JSON, exit codes are stable, and errors come with the next command to run. `catbus platforms` prints the complete list of capabilities. Ships with an [agent skill](.claude/skills/catbus/SKILL.md) and [llms.txt](llms.txt).

</td>
<td valign="top">

### 🔐 Your logins never leave your machine
QR code, SMS and cookie import are all supported. Credentials are isolated per **platform × endpoint × account** under `~/.catbus/` (0700 / 0600), and you can switch between accounts at any time. No data is collected or uploaded, and there is no telemetry.

</td>
</tr>
<tr>
<td valign="top">

### 🧪 Byte-for-byte faithful to upstream
The URL, header order, cookies, body and signature of every request are **compared byte for byte** against the upstream implementation, with randomness and the clock pinned. 560+ golden files and 940+ offline tests guard every change.

</td>
<td valign="top">

### 🛡️ A browser-grade network stack
TLS / HTTP2 fingerprints that match real Chrome, upstream signing JS running unmodified in a sandbox, and slider and click-to-select CAPTCHAs solved automatically with local ONNX and OpenCV.

</td>
</tr>
</table>

## 📊 By the numbers

<div align="center">

| 🚌 Platforms | ⌨️ Implemented commands | 🧪 Golden files | ✅ Offline tests | 💻 Target systems |
|:---:|:---:|:---:|:---:|:---:|
| **11** | **300+** | **560+** | **960+** | **8** |

</div>

## 🏗️ Architecture

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="catbus architecture">
</p>

- **One registry drives everything**: command parsing, the four levels of `--help`, `catbus platforms` and the [capability matrix](docs/capabilities.md) are all generated from the same registry, so they can never contradict each other.
- **One platform, one set of files**: `client` handles sessions and signing, `api` maps one-to-one onto upstream methods, `normalize` turns raw data into the unified types, and `resolve` lets IDs, links, share short links and `me` all work as arguments.
- **Extensible**: the spec reserves room for app / pc endpoints; non-JS upstreams will plug in through the provider protocol.

## 🤖 Built for AI agents

catbus was designed from day one to be called by programs:

```bash
catbus platforms douyin | jq '.data.commands[] | select(.status=="implemented") | .resource + " " + .action'
```

- **Self-describing**: the login requirements, implementation status and upstream support of every platform and every command are one command away.
- **Predictable**: success and failure share the same envelope, `{ ok, data, page, error }`; `error.hint` spells out the next command to run.
- **Chainable**: every output object carries an `id` and a `url`, so one command's result can be fed straight into the next.
- **Well-behaved**: dangerous operations require an explicit `-y`, posts can be published as visible only to you, and risk control is reported plainly as `RISK_CONTROL` — never silently retried.

Install the catbus skill into Claude Code, Cursor, Codex and other agents with one command:

```bash
npx skills add cv-cat/catbus
```

The skill loads on demand: a one-page overview, plus [sub-files](.claude/skills/catbus/SKILL.md) that are read only when a task touches a given platform or kind of work (collecting, publishing, live & DMs, troubleshooting). Safety rules are built in — logins stay with you, writes need confirmation, posts default to private, and it stops on risk control.

## ⚡ On board in 30 seconds

```bash
npm i -g catbus-cli

catbus doctor                 # check your environment
catbus bilibili auth login    # log in by scanning a QR code
catbus bilibili item search 猫 --limit 20
```

You can also use [Docker](docs/guide/docker.md) or install from source; see [Quick start](docs/guide/quick-start.md) for the full steps.

## 📚 Documentation

The guides below are in Chinese.

| | |
|---|---|
| 🚀 [Quick start](docs/guide/quick-start.md) | From installation to your first data export |
| 🔑 [Login](docs/guide/login.md) · ⚙️ [Configuration](docs/guide/configuration.md) · 🐳 [Docker](docs/guide/docker.md) | QR code / cookies, multiple accounts, proxies, containers |
| 📤 [Output and errors](docs/guide/output.md) | Envelope, normalized types, pagination, exit codes |
| 🧭 [Platform guides](docs/platforms/README.md) · 🗂️ [Capability matrix](docs/capabilities.md) | What each platform supports and how to pass arguments |
| 🧪 [Example scripts](docs/examples/README.md) | Cross-platform search, exporting comments, backing up posts, recording live chat |
| 📐 [AGENTS.md](AGENTS.md) | The catbus spec itself |
| ❓ [FAQ](docs/guide/faq.md) | Why log in? What to do about risk control… |

## 🤝 Contributing

Issues and PRs are welcome — new platforms, new commands, fixes for platform API changes, documentation improvements, all of it. Before you start, please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) (spec first; every request needs a golden test). Please report security issues privately as described in [SECURITY.md](.github/SECURITY.md).

## 📈 Star history

<a href="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
    <img alt="Star History Chart" src="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
  </picture>
</a>

## 🍔 Community groups

If you're into scraping and AI agents, come join the group chats (in Chinese).

If a group is full or a QR code has expired, open an issue or let the author know on WeChat / QQ.

| group-1 | group-2 | group-3 | group-4 (2,000-member QQ group) |
|:--:|:--:|:--:|:--:|
| <img width="280" alt="group1" src="https://cvcat.site/assets/group1.jpg" /> | <img width="280" alt="group2" src="https://cvcat.site/assets/group2.jpg" /> | <img width="280" alt="group3" src="https://cvcat.site/assets/group3.jpg" /> | <img width="280" alt="group4" src="https://cvcat.site/assets/group4.jpg" /> |

<details>
<summary><b>⚠️ Disclaimer</b></summary>

<br>

- This project is intended solely for learning and research. Do not use it for commercial purposes or for any unlawful purpose.
- When using it, comply with each platform's user agreement and terms of service, as well as the laws and regulations of your jurisdiction. Do not collect or disseminate other people's private data, and do not place excessive request load on the platforms.
- Automated operations may trigger the platforms' risk controls, resulting in CAPTCHAs, rate limiting or even account bans. Users bear sole responsibility for any and all consequences arising from their use of this project.
- This project is not affiliated with any of the platforms mentioned above, nor has it been authorized or endorsed by them. All platform names and trademarks are the property of their respective owners.

</details>

## 📄 License

[MIT](LICENSE) © 2026 [cv-cat](https://github.com/cv-cat)

<div align="center">
<br>
<img src="assets/logo.svg" width="64" alt="catbus">
<br>
<sub>All aboard, every platform. · 上车，开往任何平台</sub>
</div>
