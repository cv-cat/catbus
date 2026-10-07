<div align="center">

<img src="assets/hero.svg" width="100%" alt="catbus — ご乗車ください、行き先はあらゆるプラットフォーム">

<br>

**ひとつのコマンドで、11 のプラットフォームへ。**<br>
小紅書（RED） · 抖音 · TikTok · ビリビリ · 快手 · 微博 · 閑魚 · タオバオ · 京東 · X · 12306
<br>
<sub>まもなく対応：Instagram · YouTube · Facebook · 知乎 · WeChat 公式アカウント · 今日頭条 · 得物 · 拼多多 · 美団 · 大衆点評</sub>

<br>

[![npm](https://img.shields.io/npm/v/catbus-cli?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/catbus-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-11-F38BA8?style=for-the-badge)](docs/platforms/README.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-ready-CBA6F7?style=for-the-badge)](.claude/skills/catbus/SKILL.md)

[简体中文](README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · **日本語** · [한국어](README.ko.md)

[クイックスタート](docs/guide/quick-start.md) · [機能マトリクス](docs/capabilities.md) · [プラットフォーム別](docs/platforms/README.md) · [サンプル](docs/examples/README.md) · [エージェント向け](.claude/skills/catbus/SKILL.md)

</div>

<br>

> プラットフォームごとに、API も署名方式も、ログイン方法もデータ形式もバラバラ。**catbus はそれらをまとめて 1 台のバスに乗せます**。同じコマンド、同じ JSON、同じログイン情報ディレクトリ。プラットフォームを乗り換えるときは、単語をひとつ変えるだけです。

## ❤️ Sponsor

<div align="center">

<a href="https://api.openai-next.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sponsors/vectrust-dark.png">
    <img src="assets/sponsors/vectrust.png" alt="Vectrust" height="72">
  </picture>
</a>

**Sponsored by [Vectrust](https://api.openai-next.com) @ OpenDev Org & NextRouter Alliance**

<sub>[ここに掲載しませんか？](mailto:992822653@qq.com)</sub>

</div>

## ✨ catbus とは

catbus（猫巴士）は、中国内外の主要 11 プラットフォームの web エンドポイントを**統一された構文**で操作できるコマンドラインツールです。検索、詳細、コメント、ユーザー、おすすめフィード、ダウンロード、投稿、DM、ライブ配信の弾幕コメント、列車の空席照会・運賃……。

```bash
catbus xhs      item search 露营 --sort latest
catbus douyin   item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus x        item search camping --sort latest
```

4 つのプラットフォームに、ほぼ同じ 4 つのコマンド。出力される JSON は**すべて同じ構造**です。ノートも作品も動画もポストも、すべて `item`。検索は必ず `search`、いいねは必ず `like`。一度覚えれば、11 のプラットフォームすべてで使えます。

<p align="center">
  <img src="assets/platforms.svg" width="100%" alt="対応済みの 10 プラットフォームと開発中の 10 プラットフォーム">
</p>

## 🚀 catbus を選ぶ理由

<table>
<tr>
<td width="50%" valign="top">

### 🧭 同じ意味には、同じ名前
意味が同じ機能は、どのプラットフォームでも**同じコマンド、同じパラメータ、同じ出力**。プラットフォーム固有の呼び名（`note`、`aweme`、`tweet`……）を使ってしまっても大丈夫。どの単語を使えばいいか、catbus が教えてくれます。

</td>
<td width="50%" valign="top">

### 📦 必要なのは Node だけ
Python もコンパイラも、システム依存のパッケージも不要です。ネイティブ依存はすべてビルド済みバイナリ付きで、Windows・macOS・Linux の x64 / arm64（musl を含む）をカバー。**8 つのターゲット環境**すべてで、CI がひとつずつスモークテストしています。

</td>
</tr>
<tr>
<td valign="top">

### 🤖 AI エージェントのために生まれた
stdout には JSON だけ。終了コードは安定していて、エラーには次に実行すべきコマンドが添えられます。`catbus platforms` は全機能の一覧を出力します。[エージェント用スキル](.claude/skills/catbus/SKILL.md) と [llms.txt](llms.txt) を同梱しています。

</td>
<td valign="top">

### 🔐 ログイン情報はあなたの PC の中だけに
QR コード、SMS、cookie のインポートに対応。認証情報は **プラットフォーム × エンドポイント × アカウント** ごとに `~/.catbus/`（0700 / 0600）に分けて保存され、複数のアカウントもいつでも切り替えられます。データの収集・送信は一切なく、テレメトリもありません。

</td>
</tr>
<tr>
<td valign="top">

### 🧪 上流とバイト単位で一致
すべてのリクエストの URL、ヘッダー順、cookie、body、署名を、乱数と時刻を固定したうえで上流の実装と**1 バイトずつ突き合わせて**います。560+ 件のゴールデンデータと 940+ 件のオフラインテストが、あらゆる変更を見守ります。

</td>
<td valign="top">

### 🛡️ ブラウザ級のネットワークスタック
本物の Chrome と一致する TLS / HTTP2 フィンガープリント。上流の署名 JS は手を加えずにサンドボックスで実行し、スライダー型・クリック選択型の CAPTCHA はローカルの ONNX と OpenCV で自動認識します。

</td>
</tr>
</table>

## 📊 数字で見る catbus

<div align="center">

| 🚌 プラットフォーム | ⌨️ 実装済みコマンド | 🧪 ゴールデンデータ | ✅ オフラインテスト | 💻 ターゲット環境 |
|:---:|:---:|:---:|:---:|:---:|
| **11** | **300+** | **560+** | **960+** | **8** |

</div>

## 🏗️ アーキテクチャ

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="catbus のアーキテクチャ">
</p>

- **ひとつのレジストリがすべてを動かす**：コマンド解析、4 階層の `--help`、`catbus platforms`、[機能マトリクス](docs/capabilities.md) はすべて同じレジストリから生成されるため、互いに食い違うことはありません。
- **1 プラットフォームに、1 セットのファイル**：`client` はセッションと署名を担当し、`api` は上流のメソッドと 1 対 1 で対応、`normalize` は生データを統一された型に変換し、`resolve` は ID・リンク・共有用短縮 URL・`me` のどれでも引数として使えるようにします。
- **拡張可能**：仕様には app / pc エンドポイントの枠があらかじめ用意されており、JS 以外の上流は provider プロトコルで接続する予定です。

## 🤖 AI エージェントのために生まれた

catbus は最初の日から「プログラムに呼び出される」ことを前提に設計されています。

```bash
catbus platforms douyin | jq '.data.commands[] | select(.status=="implemented") | .resource + " " + .action'
```

- **自己記述的**：各プラットフォーム・各コマンドのログイン要否、実装状況、上流での対応度合いが、コマンドひとつで分かります。
- **予測可能**：成功も失敗も同じエンベロープ `{ ok, data, page, error }`。`error.hint` が次に実行すべきコマンドをそのまま示します。
- **つなげられる**：出力されるオブジェクトはすべて `id` と `url` を持つので、前のコマンドの結果をそのまま次のコマンドに渡せます。
- **節度がある**：危険な操作には明示的な `-y` が必須。投稿は自分だけに公開することもでき、リスク制御に引っかかったときは `RISK_CONTROL` とはっきり報告して、黙ってリトライすることはありません。

コマンドひとつで、catbus スキルを Claude Code・Cursor・Codex などのエージェントに入れられます：

```bash
npx skills add cv-cat/catbus
```

スキルは必要な分だけ読み込まれます。概要は 1 ページだけで、扱うプラットフォームや作業の種類（収集、投稿、ライブと DM、トラブル対応）に応じて[サブファイル](.claude/skills/catbus/SKILL.md)を読みます。安全のルールも組み込み済みです：ログインはあなたに任せる、書き込みは必ず確認、投稿は既定で非公開、リスク制御に当たったら止まる。

## ⚡ 30 秒で乗車

```bash
npm i -g catbus-cli

catbus doctor                 # 環境をチェック
catbus bilibili auth login    # QR コードでログイン
catbus bilibili item search 猫 --limit 20
```

[Docker](docs/guide/docker.md) やソースからのインストールも可能です。詳しい手順は [クイックスタート](docs/guide/quick-start.md) をご覧ください。

## 📚 ドキュメント

以下のドキュメントは中国語（簡体字）で書かれています。

| | |
|---|---|
| 🚀 [クイックスタート](docs/guide/quick-start.md) | インストールから最初のデータのエクスポートまで |
| 🔑 [ログイン](docs/guide/login.md) · ⚙️ [設定](docs/guide/configuration.md) · 🐳 [Docker](docs/guide/docker.md) | QR コード / cookie、複数アカウント、プロキシ、コンテナ |
| 📤 [出力とエラー処理](docs/guide/output.md) | エンベロープ、正規化された型、ページング、終了コード |
| 🧭 [プラットフォーム別ガイド](docs/platforms/README.md) · 🗂️ [機能マトリクス](docs/capabilities.md) | 各プラットフォームの対応状況と引数の渡し方 |
| 🧪 [サンプルスクリプト](docs/examples/README.md) | 横断検索、コメントのエクスポート、投稿のバックアップ、ライブ弾幕の記録 |
| 📐 [AGENTS.md](AGENTS.md) | catbus の仕様そのもの |
| ❓ [よくある質問](docs/guide/faq.md) | なぜログインが必要？リスク制御に引っかかったら？…… |

## 🤝 コントリビュート

issue も PR も歓迎します。新しいプラットフォーム、新しいコマンド、プラットフォーム側の API 変更への対応、ドキュメントの改善、なんでもどうぞ。始める前に [CONTRIBUTING.md](.github/CONTRIBUTING.md) と [AGENTS.md](AGENTS.md) に目を通してください（仕様が先、リクエストには必ずゴールデンテストを）。セキュリティ上の問題は [SECURITY.md](.github/SECURITY.md) に従って非公開で報告してください。

## 📈 Star の推移

<a href="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
    <img alt="Star History Chart" src="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
  </picture>
</a>

## 🍔 コミュニティ

スクレイピングや AI エージェントに興味があれば、グループチャット（中国語）にぜひご参加ください。

グループが満員のときや QR コードの期限が切れているときは、issue を立てるか WeChat / QQ でお知らせください。

| group-1 | group-2 | group-3 | group-4 (2000 人の QQ グループ) |
|:--:|:--:|:--:|:--:|
| <img width="280" alt="group1" src="https://cvcat.site/assets/group1.jpg" /> | <img width="280" alt="group2" src="https://cvcat.site/assets/group2.jpg" /> | <img width="280" alt="group3" src="https://cvcat.site/assets/group3.jpg" /> | <img width="280" alt="group4" src="https://cvcat.site/assets/group4.jpg" /> |

<details>
<summary><b>⚠️ 免責事項</b></summary>

<br>

- 本プロジェクトは学習および研究のみを目的としています。商用目的、その他いかなる違法な目的にも使用しないでください。
- 使用にあたっては、各プラットフォームのユーザー規約およびサービス利用規約、ならびにお住まいの地域の法令を遵守してください。他人のプライバシーに関わるデータを収集・拡散したり、プラットフォームに過大なリクエスト負荷をかけたりしないでください。
- 自動化された操作はプラットフォームのリスク制御を作動させ、CAPTCHA、レート制限、さらにはアカウントの凍結につながるおそれがあります。本プロジェクトの使用によって生じる一切の結果については、使用者が自らの責任で負うものとします。
- 本プロジェクトは上記のいずれのプラットフォームとも関係がなく、その許可や承認も受けていません。各プラットフォームの名称および商標は、それぞれの所有者に帰属します。

</details>

## 📄 License

[MIT](LICENSE) © 2026 [cv-cat](https://github.com/cv-cat)

<div align="center">
<br>
<img src="assets/logo.svg" width="64" alt="catbus">
<br>
<sub>ご乗車ください、行き先はあらゆるプラットフォーム · All aboard, every platform.</sub>
</div>
