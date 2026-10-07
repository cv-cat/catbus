<div align="center">

<img src="assets/hero.svg" width="100%" alt="catbus — 上車，開往任何平台">

<br>

**一個指令，開往 11 個平台。**<br>
小紅書 · 抖音 · TikTok · 嗶哩嗶哩 · 快手 · 微博 · 閒魚 · 淘寶 · 京東 · X · 12306
<br>
<sub>即將上車：Instagram · YouTube · Facebook · 知乎 · 微信公眾號 · 今日頭條 · 得物 · 拼多多 · 美團 · 大眾點評</sub>

<br>

[![npm](https://img.shields.io/npm/v/catbus-cli?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/catbus-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-11-F38BA8?style=for-the-badge)](docs/platforms/README.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-ready-CBA6F7?style=for-the-badge)](.claude/skills/catbus/SKILL.md)

[简体中文](README.md) · [English](README.en.md) · **繁體中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

[快速上手](docs/guide/quick-start.md) · [能力矩陣](docs/capabilities.md) · [各平台](docs/platforms/README.md) · [範例](docs/examples/README.md) · [給 Agent 用](.claude/skills/catbus/SKILL.md)

</div>

<br>

> 每個平台都有自己的一套 API、簽章、登入方式和資料格式。**catbus 把它們裝進同一輛車**：同一套指令、同一種 JSON、同一個登入狀態目錄。換平台，只需要換一個詞。

## ✨ catbus 是什麼

catbus（貓巴士）是一個命令列工具，用**統一的語法**呼叫 11 個中國大陸及國際主流平台的 web 端功能：搜尋、詳細資料、留言、使用者、推薦動態、下載、發佈、私訊、直播彈幕、列車餘票票價……

```bash
catbus xhs      item search 露营 --sort latest
catbus douyin   item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus x        item search camping --sort latest
```

四個平台，四條幾乎一樣的指令，輸出**同一種結構**的 JSON。筆記、作品、影片、推文一律叫 `item`，搜尋一律叫 `search`，按讚一律叫 `like`。學一次，11 個平台都會用。

<p align="center">
  <img src="assets/platforms.svg" width="100%" alt="已支援的 10 個平台與開發中的 10 個平台">
</p>

## 🚀 為什麼選 catbus

<table>
<tr>
<td width="50%" valign="top">

### 🧭 同義同名
意義相同的功能，在所有平台上都用**同一個指令、同一組參數、同一種輸出**。就算用了平台原生的叫法（`note`、`aweme`、`tweet`……）也沒關係，catbus 會告訴你該用哪個詞。

</td>
<td width="50%" valign="top">

### 📦 只需要 Node
不需要 Python、編譯器或任何系統相依套件。原生相依套件全部附有預先編譯的版本，涵蓋 Windows、macOS、Linux 的 x64 / arm64（含 musl），**8 個目標系統**都在 CI 上逐一進行冒煙測試。

</td>
</tr>
<tr>
<td valign="top">

### 🤖 為 AI Agent 而生
stdout 只有 JSON，結束代碼穩定，錯誤訊息裡直接附上下一步該執行的指令；`catbus platforms` 會輸出完整的功能清單。內建 [Agent 技能](.claude/skills/catbus/SKILL.md) 與 [llms.txt](llms.txt)。

</td>
<td valign="top">

### 🔐 登入狀態只留在你的電腦上
QR Code 掃描、簡訊、cookie 匯入都支援，憑證依 **平台 × 端 × 帳號** 隔離存放在 `~/.catbus/`（0700 / 0600），多帳號隨時切換。不蒐集、不上傳任何資料，也沒有遙測。

</td>
</tr>
<tr>
<td valign="top">

### 🧪 與上游逐位元組一致
每個請求的 URL、header 順序、cookie、body 和簽章，都在固定的亂數與時鐘下和上游實作**逐位元組比對**。560+ 份比對資料、940+ 個離線測試，守住每一次修改。

</td>
<td valign="top">

### 🛡️ 瀏覽器等級的網路堆疊
與真正的 Chrome 一致的 TLS / HTTP2 指紋，上游簽章 JS 原封不動地在沙盒中執行，滑塊、點選驗證碼則用本機的 ONNX 與 OpenCV 自動辨識。

</td>
</tr>
</table>

## 📊 一些數字

<div align="center">

| 🚌 平台 | ⌨️ 已實作指令 | 🧪 比對資料 | ✅ 離線測試 | 💻 目標系統 |
|:---:|:---:|:---:|:---:|:---:|
| **11** | **300+** | **560+** | **960+** | **8** |

</div>

## 🏗️ 架構

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="catbus 架構">
</p>

- **一個註冊表驅動一切**：指令解析、四層 `--help`、`catbus platforms`、[能力矩陣](docs/capabilities.md) 都由同一份註冊表產生，永遠不會互相矛盾。
- **一個平台，一組檔案**：`client` 負責工作階段與簽章，`api` 與上游方法一一對應，`normalize` 把原始資料轉成統一的型別，`resolve` 讓 ID、連結、分享短網址、`me` 都能當作參數。
- **可擴充**：規範為 app / pc 端預留了位置；非 JS 的上游將透過 provider 協定接入。

## 🤖 為 AI Agent 而生

catbus 從第一天起，就是依照「被程式呼叫」來設計的：

```bash
catbus platforms douyin | jq '.data.commands[] | select(.status=="implemented") | .resource + " " + .action'
```

- **自我描述**：每個平台、每條指令的登入需求、實作狀態、上游支援程度，一條指令就能查到。
- **可預期**：成功和失敗都是同一種信封 `{ ok, data, page, error }`；`error.hint` 直接給出下一步的指令。
- **能接力**：所有輸出物件都帶有 `id` 和 `url`，上一條指令的結果可以直接餵給下一條。
- **有分寸**：危險操作必須明確加上 `-y`，發佈時可以設為僅自己可見，遇到風控會明確回報 `RISK_CONTROL`，不會偷偷重試。

一行指令把 catbus 技能裝進 Claude Code、Cursor、Codex 等 Agent：

```bash
npx skills add cv-cat/catbus
```

技能按需載入：總綱只有一頁，碰到哪個平台、做哪類事（採集、發布、直播私訊、排錯）才讀對應的[子檔案](.claude/skills/catbus/SKILL.md)，並且內建安全紅線——登入交給你、寫入操作先確認、發布預設僅自己可見、遇到風控就停。

## ⚡ 30 秒上車

```bash
npm i -g catbus-cli

catbus doctor                 # 檢查環境
catbus bilibili auth login    # 掃描 QR Code 登入
catbus bilibili item search 猫 --limit 20
```

也可以用 [Docker](docs/guide/docker.md) 或從原始碼安裝，完整步驟請見 [快速上手](docs/guide/quick-start.md)。

## 📚 文件

以下文件目前僅提供簡體中文版。

| | |
|---|---|
| 🚀 [快速上手](docs/guide/quick-start.md) | 從安裝到匯出第一批資料 |
| 🔑 [登入](docs/guide/login.md) · ⚙️ [設定](docs/guide/configuration.md) · 🐳 [Docker](docs/guide/docker.md) | 掃碼 / cookie、多帳號、代理伺服器、容器 |
| 📤 [輸出與錯誤處理](docs/guide/output.md) | 信封、正規化型別、分頁、結束代碼 |
| 🧭 [各平台說明](docs/platforms/README.md) · 🗂️ [能力矩陣](docs/capabilities.md) | 每個平台支援什麼、參數怎麼傳 |
| 🧪 [範例腳本](docs/examples/README.md) | 跨平台搜尋、匯出留言、備份作品、錄製直播彈幕 |
| 📐 [AGENTS.md](AGENTS.md) | catbus 的規範本身 |
| ❓ [常見問題](docs/guide/faq.md) | 為什麼要登入、遇到風控怎麼辦…… |

## 🤝 參與貢獻

歡迎 issue 和 PR：新平台、新指令、平台 API 變動、文件改進都可以。開始之前請先讀一下 [CONTRIBUTING.md](.github/CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)（規範先行，請求必須有比對測試）。安全性問題請依照 [SECURITY.md](.github/SECURITY.md) 私下回報。

## 📈 Star 趨勢

<a href="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
    <img alt="Star History Chart" src="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
  </picture>
</a>

## 🍔 交流群

如果你對爬蟲和 AI Agent 感興趣，歡迎加入群聊一起討論～

ps：群滿或 QR code 過期時，請開 issue，或透過微信 / QQ 提醒

| group-1 | group-2 | group-3 | group-4 (2000 人 QQ 群) |
|:--:|:--:|:--:|:--:|
| <img width="280" alt="group1" src="https://cvcat.site/assets/group1.jpg" /> | <img width="280" alt="group2" src="https://cvcat.site/assets/group2.jpg" /> | <img width="280" alt="group3" src="https://cvcat.site/assets/group3.jpg" /> | <img width="280" alt="group4" src="https://cvcat.site/assets/group4.jpg" /> |

<details>
<summary><b>⚠️ 免責聲明</b></summary>

<br>

- 本專案僅供學習與研究使用，請勿用於商業用途或任何違法用途。
- 使用時請遵守各平台的使用者協議與服務條款，以及你所在地的法律規範；不要蒐集、散布他人的隱私資料，不要對平台造成過大的請求壓力。
- 自動化操作可能觸發平台風控，導致驗證碼、流量限制，甚至帳號遭到停權。因使用本專案而產生的一切後果，均由使用者自行承擔。
- 本專案與上述任何平台均無關聯，也未獲得其授權或認可。各平台名稱與商標歸其各自所有者所有。

</details>

## 📄 License

[MIT](LICENSE) © 2026 [cv-cat](https://github.com/cv-cat)

<div align="center">
<br>
<img src="assets/logo.svg" width="64" alt="catbus">
<br>
<sub>上車，開往任何平台 · All aboard, every platform.</sub>
</div>
