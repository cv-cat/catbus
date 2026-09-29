<p align="center">
  <img src="assets/logo.svg" width="160" alt="catbus logo">
</p>

<h1 align="center">catbus</h1>

<p align="center"><b>All aboard, every platform</b></p>

<p align="center">
  One CLI for Xiaohongshu (RedNote), Douyin, TikTok, Bilibili, Kuaishou, Weibo, Xianyu, Taobao, JD and X.<br>
  One set of commands, one JSON output format, for humans and AI agents alike.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-A6E3A1" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-%5E22.22.2%20%7C%20%5E24.15.0%20%7C%20%3E%3D26-339933?logo=nodedotjs&logoColor=white" alt="Node ^22.22.2 | ^24.15.0 | >=26">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/platforms-10-F38BA8" alt="10 platforms">
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · English
</p>

---

catbus (猫巴士, "cat bus") is built on the 10 open-source projects by [cv-cat](https://github.com/cv-cat), rewritten from scratch in TypeScript: no Python at runtime, Node is all you need. The web endpoints of all 10 platforms are ported; app / pc endpoints are planned.

```bash
catbus bilibili item get BV1xx411c7mD
catbus xhs item search 露营 --sort latest --limit 50
catbus douyin comment list <item> --limit 100 -o jsonl
catbus x user get elonmusk
```

> The CLI's own messages (help, error `message` / `hint`, prompts) are in Chinese. Everything machine-readable — command names, options, JSON fields, error codes — is English.

## Contents

- [Highlights](#highlights)
- [Supported platforms](#supported-platforms)
- [Quick start](#quick-start)
- [Commands at a glance](#commands-at-a-glance)
- [Output and exit codes](#output-and-exit-codes)
- [Accounts and configuration](#accounts-and-configuration)
- [For AI agents](#for-ai-agents)
- [Known limitations](#known-limitations)
- [Project layout and development](#project-layout-and-development)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Acknowledgements](#acknowledgements)
- [Disclaimer](#disclaimer)
- [License](#license)

## Highlights

- **Same meaning, same name**: notes, videos, posts, tweets and products are all `item`; searching is always `search`; liking is always `like`. A capability that means the same thing uses the same command, the same options and the same output shape on every platform — switching platforms means changing only the platform id.
- **10 platforms**: Xiaohongshu, Douyin, TikTok, Bilibili, Kuaishou, Weibo, Xianyu, Taobao, JD and X. Search, details, comments, feeds, downloads, publishing, direct messages, live-stream chat and more; see the [capability matrix](docs/capabilities.md) for what each platform supports.
- **Uniform JSON output**: stdout carries only a JSON envelope. Normalized types such as `Item`, `User`, `Comment` and `Live` have the same fields on every platform. List commands can stream with `-o jsonl`; add `--raw` when you need the platform's original objects.
- **Node only**: no Python, no C/C++ compiler, no other system dependencies. Native dependencies ship prebuilt binaries for Windows, macOS and Linux (x64 / arm64; glibc and musl on Linux).
- **Credentials stay on your machine**: sessions are stored per platform × endpoint × account under `~/.catbus/` (directories 0700, files 0600), with multi-account support. catbus collects and uploads nothing and has no telemetry.
- **Behaves like upstream**: request construction and signing are checked by golden tests — the upstream Python runs with fixed randomness and clock to record requests, and the TypeScript port must reproduce the URL, header order, cookies and body byte for byte.
- **Built for agents**: stable exit codes, a `hint` (the next command to run) on errors, and `catbus platforms` describes every command, so scripts and AI agents can drive it reliably.

## Supported platforms

| Platform | id | Aliases | `item` means | Login methods (**bold** = default) | Upstream |
|---|---|---|---|---|---|
| Xiaohongshu (RedNote) | `xhs` | `xiaohongshu` `rednote` | note | **qrcode** · sms · cookie; creator center obtained automatically | [Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| Douyin | `douyin` | `dy` | post (video or images) | **qrcode** · sms · cookie | [DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| TikTok | `tiktok` | `tt` | video | **cookie** | [TiktokApis](https://github.com/cv-cat/TiktokApis) |
| Bilibili | `bilibili` | `bili` `b` | video submission | **qrcode** · sms · password · cookie | [BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| Kuaishou | `kuaishou` | `ks` | post (video or images) | **qrcode** · sms · cookie | [KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| Weibo | `weibo` | `wb` | weibo post | **cookie** | [WeiboApis](https://github.com/cv-cat/WeiboApis) |
| Xianyu (Goofish) | `xianyu` | `goofish` `xy` | second-hand listing | **qrcode** · cookie | [XianYuApis](https://github.com/cv-cat/XianYuApis) |
| Taobao | `taobao` | `tb` | product | **cookie** | [TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| JD | `jd` | `jingdong` | product SKU | **qrcode** · sms · cookie | [JdApis](https://github.com/cv-cat/JdApis) |
| X | `x` | `twitter` | tweet | **cookie** | [XApis](https://github.com/cv-cat/XApis) |

- Commands, directory names, config keys and the `platform` field in output all use the id; aliases work on the command line only.
- Each platform also has a few extension commands, e.g. Bilibili coins, triple-like, danmaku, dynamics and articles; JD orders, cart and coupons; X long-form articles. See the [capability matrix](docs/capabilities.md) or `catbus platforms <platform>`.
- Commands marked ○ in the matrix are planned and return `NOT_IMPLEMENTED` (exit code 4).

## Quick start

### 1. Install

Requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`.

**From source (for now)**

```bash
git clone https://github.com/cv-cat/catbus.git
cd catbus
npm ci
npm run assets:jd     # fetch the JD captcha models (~81 MB)
npm run assets:ocr    # fetch the captcha OCR models (~34 MB, used for Bilibili Geetest)
npm run build
npm link              # put the catbus command on your PATH
```

**From npm (coming soon)**

```bash
npm i -g catbus-cli
```

Once published, the models are installed as the dependencies `@cv-cat/catbus-assets-jd` and `@cv-cat/catbus-assets-ocr`, so nothing is downloaded at runtime.

### 2. Check the environment

```bash
catbus doctor
```

Checks the Node version, the HTTP library, canvas, onnx, the captcha models, permissions of `~/.catbus` and the signing VM. `ok` is true when everything passes; otherwise the exit code is 1 and `data` still holds the full report.

### 3. Log in

The web endpoints show almost nothing without login, so every command except `auth` requires it. Without a session you get `AUTH_REQUIRED` (exit code 3) with the login command in `hint`.

**QR code** (default for xhs, douyin, bilibili, kuaishou, xianyu, jd): the QR code is drawn in the terminal (stderr) and saved as a PNG under `~/.catbus/cache/<platform>/`; scan and confirm it in the mobile app. Xiaohongshu QR login is currently blocked by a captcha (see [Known limitations](#known-limitations)), so import cookies there.

```bash
catbus bilibili auth login
catbus douyin auth login -a work        # log in to an account named "work"
```

**Cookie import** (the only method for tiktok, weibo, taobao, x; add `--method cookie` on the others):

1. Log in to the website in your browser;
2. open DevTools → Network, reload, and click any request to that site;
3. copy the full `Cookie` value from the Request Headers.

Do not use `document.cookie` in the Console: it cannot see HttpOnly cookies, and the cookies that carry the session (e.g. Xiaohongshu's `web_session`) are HttpOnly.

```bash
catbus x auth login --cookie "auth_token=...; ct0=...; ..."
catbus weibo auth login --cookie @weibo-cookie.txt        # read from a file
pbpaste | catbus taobao auth login --cookie -             # read from stdin (macOS clipboard)
catbus xhs auth login --method cookie --cookie "a1=...; web_session=...; ..."
```

`--cookie` also accepts a cookie JSON array exported from the browser; douyin and tiktok additionally accept a JSON object that imports device data such as tickets, certificates and private keys along with the cookies (their write operations need them). catbus verifies the imported session online once. For SMS and password login see `catbus <platform> auth login --help`.

Check the session:

```bash
catbus bilibili auth status
```

### 4. Your first commands

```bash
catbus bilibili item get BV1xx411c7mD
catbus bilibili item search 猫 --sort views --limit 20
catbus bilibili user items me --all -o jsonl > my-videos.jsonl
```

## Commands at a glance

### Syntax

```text
catbus <platform> <resource> <action> [args...] [options...]
```

- Options may appear anywhere; everything after `--` is treated as arguments (for text starting with `-`).
- Arguments accept IDs, URLs (including share short links) and natural identifiers (Bilibili BV ids, X handles); user arguments also accept `me`. Every output object has `id` and `url`, which can be passed straight to the next command. Xiaohongshu URLs carry `xsec_token`, so prefer passing URLs there.
- Choose the endpoint with `-e web|app|pc` (default `web`). app / pc are planned: `catbus xianyu item get <id> -e app` returns `NOT_IMPLEMENTED`.
- Help has four levels: `catbus --help`, `catbus xhs --help`, `catbus xhs item --help`, `catbus xhs item get --help`.

### Resources

| resource | Meaning | Common actions |
|---|---|---|
| `auth` | Sessions | `login` `status` `logout` `list` `use` |
| `user` | Users | `get` `search` `items` `likes` `collects` `followers` `following` `follow` |
| `item` | The platform's main content unit | `get` `search` `related` `list` `media` `download` `like` `collect` `repost` `publish` `delete` |
| `product` | Products attached to content | `get` |
| `comment` | Comments, including product reviews | `list` `replies` `add` `delete` `like` |
| `feed` | Recommended / hot / following feeds | `list` `categories` |
| `live` | Live streams | `get` `list` `search` `listen` `history` `send` `gifts` `products` `media` `start` `stop` |
| `keyword` | Search keywords | `suggest` `hot` |
| `notice` | Notifications | `list` `count` |
| `msg` | Direct messages / IM / customer service | `list` `history` `send` `listen` `read` `revoke` `delete` |
| `media` | Media upload | `upload` |
| `folder` | Favorites folders | `list` `items` `create` `update` `delete` |
| `series` | Series / playlists | `list` `items` |
| `history` / `topic` / `poi` | Browsing history / topics / places | `list` / `search` / `search` |

The full vocabulary and action semantics are in [AGENTS.md 4.4–4.5](AGENTS.md#44-动作语义) (Chinese).

### One command, many platforms

```bash
# Search: the same filter options (--sort / --type / --time); unsupported values report UNSUPPORTED
catbus xhs item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus douyin item search 露营 --type video --sort latest
catbus x item search camping --sort latest
catbus jd item search 机械键盘 --sort sales

# A user and their content
catbus x user get elonmusk
catbus xhs user items "<profile URL>" --limit 100
catbus bilibili user items me --sort views

# Comments
catbus douyin comment list "<video URL>" --limit 100
catbus bilibili comment list BV1xx411c7mD --sort latest

# Download media: files are named <platform>_<id>_<n>.<ext>
catbus xhs item download "<note URL>" --dir ./downloads

# Live chat: streams jsonl until Ctrl-C or --duration expires
catbus bilibili live listen <room> --duration 10m

# Direct messages / contacting a seller
catbus xianyu msg send "还在吗" --item "<listing URL>"
catbus jd msg send "请问什么时候发货" --order <order id>

# Publishing: local files are uploaded automatically
catbus xhs item publish --title 周末露营 --text @note.md --image 1.jpg --image 2.jpg --visibility private
catbus x item publish --text "hello from catbus" --image cat.png
```

More conventions:

- Platform-native names are not aliases: `catbus xhs note get <id>` reports `UNSUPPORTED` and the `hint` points to `catbus xhs item get`.
- Deletes, message revokes, Bilibili coins / triple-like and live gifts are dangerous operations: in a terminal catbus asks y/N; non-interactive callers must pass `-y`, otherwise they get `CONFIRM_REQUIRED`.
- Paging: one page by default; `--limit N` pages automatically until N results, `--all` pages to the end, `--cursor <c>` resumes from a previous `page.cursor`.

## Output and exit codes

stdout carries only results; logs, prompts, progress and QR codes go to stderr. An `item get` envelope (values are illustrative):

```json
{
  "ok": true,
  "platform": "bilibili",
  "endpoint": "web",
  "resource": "item",
  "action": "get",
  "account": "default",
  "data": {
    "id": "BV1xx411c7mD",
    "kind": "video",
    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
    "title": "示例稿件",
    "text": "稿件简介",
    "author": { "id": "123456", "name": "示例 UP 主", "url": "https://space.bilibili.com/123456" },
    "created_at": "2025-10-04T14:17:54+08:00",
    "cover": "https://i0.hdslb.com/bfs/archive/example.jpg",
    "media": [],
    "stats": { "views": 12000, "likes": 800, "comments": 56, "collects": 120, "shares": 30 },
    "price": null,
    "status": null
  },
  "page": null,
  "error": null
}
```

On failure `ok` is false and `data` is null:

```json
{"ok":false,"platform":"bilibili","endpoint":"web","resource":"item","action":"get","account":null,"data":null,"page":null,"error":{"code":"AUTH_REQUIRED","message":"item get 需要登录","hint":"catbus bilibili auth login","detail":null}}
```

- **`-o json`** (default): exactly one envelope; indented when stdout is a TTY, one compact line otherwise.
- **`-o jsonl`**: one `data` entry per line, pipe-friendly; a summary envelope (with `page` and `error`) is written to stderr at the end.
- **`--raw`**: replaces normalized objects with the platform's original objects; the envelope stays the same.
- Rules: IDs are always strings; counts are integers ("1.2万" → 12000); times are ISO 8601 with a timezone; fields are always present, `null` or `[]` when missing.

```bash
catbus bilibili item search 猫 -o jsonl | jq -r '.url'
```

| Exit | code | Meaning |
|---|---|---|
| 0 | — | Success |
| 1 | `ERROR` | Unclassified error |
| 2 | `USAGE` / `UNSUPPORTED` / `CONFIRM_REQUIRED` | Bad arguments / command not supported by the platform or endpoint / dangerous operation not confirmed |
| 3 | `AUTH_REQUIRED` / `AUTH_EXPIRED` | Not logged in, or the session expired |
| 4 | `NOT_IMPLEMENTED` | Planned endpoint or capability |
| 5 | `RISK_CONTROL` | Captcha or anti-bot control; `detail.kind` is `captcha` / `rate_limit` / `blocked` |
| 6 | `NETWORK` | Network / proxy error |
| 7 | `UPSTREAM` | Business error from the platform; the original code is in `detail` |

All normalized types and per-command outputs are in [AGENTS.md section 6](AGENTS.md#6-输出) (Chinese).

## Accounts and configuration

### Multiple accounts

```bash
catbus xhs auth login -a work     # log in to the "work" account
catbus xhs auth list              # accounts on this platform
catbus xhs auth use work          # make it the current account
catbus xhs item search 咖啡 -a work  # pick an account for one call
catbus xhs auth logout -a work    # delete local credentials (Bilibili and Kuaishou also log out server-side)
catbus auth list                  # accounts on every platform and endpoint
```

Identity is chosen as `-a <name>` > current account > not logged in (web endpoints report `AUTH_REQUIRED`). Account names match `[a-z0-9][a-z0-9_-]{0,31}`.

### Data directory

```text
~/.catbus/                     # override with CATBUS_HOME
├── config.toml
├── auth/<platform>/<endpoint>/
│   ├── <account>.json         # one file per account
│   └── _current               # name of the current account
└── cache/<platform>/          # QR code PNGs etc.; safe to delete
```

- Directories are 0700 and files 0600 (on Windows the user profile's ACL applies); all writes are atomic.
- Tokens refreshed by the platform and `Set-Cookie` headers are merged back into the credential file.
- Debug logs from `-v` redact cookies, tokens, Authorization and similar fields.

### Proxy and timeout

```bash
catbus config set proxy http://127.0.0.1:7890        # global proxy
catbus config set xhs.proxy socks5://127.0.0.1:1080  # per-platform proxy
catbus config set timeout 60                         # per-request timeout in seconds (default 30)
catbus config list
catbus bilibili item get BV1xx411c7mD --proxy http://127.0.0.1:8080   # proxy for one call
```

Precedence: `--proxy` > `<platform>.proxy` > `proxy`. catbus does **not** read `HTTP(S)_PROXY` or the system proxy; proxies must be configured explicitly.

## For AI agents

catbus is designed to be called by programs from day one:

- **stdout is JSON only**: success and failure share the same envelope, so there is no human text to parse; help output is the only exception.
- **Stable exit codes and error codes**: branch on the exit code; `error.hint` suggests the next command (e.g. the login command).
- **Self-describing**: `catbus platforms [platform]` lists every command of every platform and endpoint with its auth requirement, implementation status and upstream support; `--help` is generated from the same registry.
- **Non-interactive friendly**: `--cookie -` reads from stdin, dangerous operations are confirmed explicitly with `-y` when not on a TTY, `-q` silences prompts, and streaming commands emit jsonl.

```bash
# List the implemented web commands for Douyin
catbus platforms douyin | jq -r '.data.commands[] | select(.status == "implemented") | "\(.resource) \(.action)"'
```

Agent instructions live in [skills/catbus/SKILL.md](skills/catbus/SKILL.md); a project summary for LLMs is in [llms.txt](llms.txt). An MCP mode is planned for M4.

## Known limitations

Real-account verification is at different stages per platform (X has not started; Xianyu and Taobao have only a few commands verified), and anti-bot controls and upstream capabilities mean some commands don't work yet or return incomplete results. Details and per-platform progress are in [docs/trouble.md](docs/trouble.md) (Chinese). The main ones:

- **Douyin**: write operations (publish, like, comment, DM) are limited by the platform's device risk control (dtrait): publishing currently reports `RISK_CONTROL`, and the other writes have not passed verification yet. Read-only commands work.
- **Xiaohongshu**: QR login is challenged with a captcha after you confirm on the phone (HTTP 471), which catbus cannot pass yet — import cookies instead. The comment API occasionally demands a captcha (HTTP 461) and recovers on its own after seconds to minutes.
- **TikTok**: with only a Cookie string imported, likes, collects, comments, publishing and DMs need browser session data; catbus stops locally and explains how to import it.
- **Bilibili**: `danmaku list` currently returns only the first 2 minutes and fails on videos longer than 6 minutes (an upstream bug, pending a fix); `item delete` requires a captcha and reports `RISK_CONTROL` for now.
- **Kuaishou**: bursts of requests may trigger a slider captcha; catbus tries to solve it once, without guarantee, and reports `RISK_CONTROL` if it fails.
- **JD**: anti-bot controls are strict — the test account was banned during verification. Keep your request rate low.
- **X** has not been verified on a real account yet; on other platforms many write operations (DMs, live chat, video uploads, …) are not verified either.
- Some normalized fields are never returned by the platform APIs and are always `null` (e.g. Douyin posts have no title, Xiaohongshu trending keywords have no heat value).

## Project layout and development

```text
catbus/
├── src/
│   ├── cli/              # entry point, argv parsing, help, envelope output, confirmation
│   ├── core/             # registry, auth store, config, http, signing VM, logging
│   └── platforms/<p>/    # platform declaration index.ts, upstream baseline UPSTREAM, web/ implementation
├── static/<p>/           # upstream signing JS etc., copied verbatim
├── packages/             # @cv-cat/catbus-assets-jd, @cv-cat/catbus-assets-ocr (models)
├── scripts/golden/<p>/   # runs upstream Python to generate golden data
├── tests/                # vitest; golden/<p>/ holds the golden data
└── docs/                 # capability matrix, upstream map, real-account issues
```

The full layout is in [AGENTS.md 7.7](AGENTS.md#77-目录结构) (Chinese).

```bash
npm ci
npm run assets:jd && npm run assets:ocr   # the JD and Bilibili Geetest tests load the models
npm run typecheck
npm test                    # offline tests; network access is blocked
npm run test:e2e            # online read-only tests with your local ~/.catbus sessions; not run in CI
npm run gen:capabilities    # regenerate docs/capabilities.md after changing the registry
```

To add or change a command, update [AGENTS.md](AGENTS.md) (it is catbus's specification) first, then the code; port platforms following the structure of `src/platforms/bilibili/web/` and add golden tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [TESTING.md](TESTING.md) for testing.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Naming, specification, technical design | ✅ Done |
| M1 | Skeleton: CLI, registry, envelope, auth store, dependency choices, golden-test framework, release pipeline | ✅ Done |
| M2 | bilibili and xhs web: every upstream capability ported and golden-tested | ✅ Done |
| M3 | Web endpoints of the other 8 platforms | ✅ Done |
| — | First npm release (`catbus-cli`) | Up next |
| M4 | MCP mode, `table` output, shell completion, external providers (non-JS upstreams such as Go / Java), app / pc endpoints | Planned |

## Documentation

Most project documents are written in Chinese.

| Document | Contents |
|---|---|
| [AGENTS.md](AGENTS.md) | The specification: commands, sessions, output, architecture, conventions |
| [docs/guide/](docs/README.md) | User guides (in Chinese): quick start, login, output, configuration, FAQ |
| [docs/platforms/](docs/platforms/README.md) | Per-platform pages (in Chinese): login, commands, private options, examples, known limitations |
| [examples/](examples/README.md) | Example scripts: cross-platform search, comment export, item backup, live chat recording, a Node wrapper |
| [docs/capabilities.md](docs/capabilities.md) | Capability matrix (generated from the registry) |
| [docs/upstream-map.md](docs/upstream-map.md) | Upstream porting map: auth, signing, Python → TS replacements |
| [docs/trouble.md](docs/trouble.md) | Open issues from real-account verification and per-platform progress |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributing guide |
| [TESTING.md](TESTING.md) | Testing: offline, golden, online and smoke tests |
| [SECURITY.md](SECURITY.md) | How to report security issues |
| [CHANGELOG.md](CHANGELOG.md) | Changelog |
| [skills/catbus/SKILL.md](skills/catbus/SKILL.md) | Instructions for AI agents |
| [llms.txt](llms.txt) | Project summary for LLMs |

## Acknowledgements

Every platform capability in catbus comes from the open-source projects by [cv-cat](https://github.com/cv-cat):

| Platform | Upstream repository |
|---|---|
| Xiaohongshu | [cv-cat/Spider_XHS](https://github.com/cv-cat/Spider_XHS) |
| Douyin | [cv-cat/DouYin_Spider](https://github.com/cv-cat/DouYin_Spider) |
| TikTok | [cv-cat/TiktokApis](https://github.com/cv-cat/TiktokApis) |
| Bilibili | [cv-cat/BilibiliApis](https://github.com/cv-cat/BilibiliApis) |
| Kuaishou | [cv-cat/KuaiShou-Spider](https://github.com/cv-cat/KuaiShou-Spider) |
| Weibo | [cv-cat/WeiboApis](https://github.com/cv-cat/WeiboApis) |
| Xianyu | [cv-cat/XianYuApis](https://github.com/cv-cat/XianYuApis) |
| Taobao | [cv-cat/TaoBaoApis](https://github.com/cv-cat/TaoBaoApis) |
| JD | [cv-cat/JdApis](https://github.com/cv-cat/JdApis) |
| X | [cv-cat/XApis](https://github.com/cv-cat/XApis) |

Thanks also to the open-source projects catbus depends on, in particular [wreq-js](https://www.npmjs.com/package/wreq-js) (HTTP with browser fingerprints), [ddddocr](https://github.com/sml2h3/ddddocr) (captcha OCR models), [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web), [jsdom](https://github.com/jsdom/jsdom) and [protobuf.js](https://github.com/protobufjs/protobuf.js). The logo palette is [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha.

## Disclaimer

- This project is for learning and research only. Do not use it for commercial or any unlawful purposes.
- Follow each platform's user agreement and terms of service and the laws where you live. Do not use it to collect or spread other people's private data, and do not put excessive load on the platforms.
- Automation may trigger anti-bot controls, leading to captchas, rate limits or account bans. You bear all consequences of using this project (including account, data and legal risks); the author accepts no liability.
- This project is not affiliated with, authorized or endorsed by any of the platforms above. Platform names and trademarks belong to their respective owners.

## License

[MIT](LICENSE) © 2026 cv-cat

The models in `@cv-cat/catbus-assets-ocr` come from [ddddocr](https://github.com/sml2h3/ddddocr) 1.6.1, also MIT-licensed; its original license ships with the package.
