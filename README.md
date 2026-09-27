# catbus（猫巴士）

```
  /\_/\
 ( >ω_ )   catbus · 上车，开往任何平台
  /   \    catbus <platform> <resource> <action> [-e web|app|pc]
```

一个命令操作小红书、抖音、TikTok、B 站、快手、微博、闲鱼、淘宝、京东、X。能力来自 [cv-cat](https://github.com/cv-cat) 的开源项目，用 TypeScript 重写。

> **开发中（M1 骨架）**：命令解析、帮助、登录态管理、配置、`doctor` 已经可用；各平台的具体能力在 M2 / M3 移植，目前执行时返回 `NOT_IMPLEMENTED`（退出码 4）。各平台的规划见 [能力矩阵](docs/capabilities.md)。

## 安装

```bash
npm i -g catbus-cli
```

只需要 Node（`^22.22.2 || ^24.15.0 || >=26.0.0`），不需要 Python 或编译器。支持 Windows、macOS、Linux 的 x64 和 arm64（Linux 含 glibc 与 musl）。

```bash
catbus doctor
```

## 用法

```
catbus <platform> <resource> <action> [参数...] [选项...]
```

```bash
catbus xhs item get "https://www.xiaohongshu.com/explore/<id>?xsec_token=..."
catbus bilibili item get BV1xx411c7mD
catbus douyin comment list <item> --limit 100
catbus jd item search 机械键盘 --sort sales
catbus xhs auth login
catbus xianyu item get <id> -e app
```

- 同义同名：商品、笔记、视频一律叫 `item`，搜索一律叫 `search`，所有平台同一套参数和输出结构。
- 端用 `-e web|app|pc` 指定，默认 `web`。
- 帮助：`catbus --help`、`catbus xhs --help`、`catbus xhs item --help`、`catbus xhs item get --help`。
- 能力矩阵：`catbus platforms [platform]`。

## 输出

stdout 只输出 JSON，日志和提示在 stderr：

```json
{ "ok": true, "platform": "xhs", "endpoint": "web", "resource": "item", "action": "get",
  "account": "default", "data": {}, "page": null, "error": null }
```

`-o jsonl` 时每行一条数据。退出码：0 成功，1 未分类错误，2 用法 / 不支持 / 未确认，3 未登录，4 未实现，5 风控，6 网络，7 平台业务错误。

## 登录态与配置

- 登录态保存在 `~/.catbus/`（可用 `CATBUS_HOME` 覆盖），按 平台 × 端 × 账号 隔离；`-a <name>` 选择账号，`catbus auth list` 列出全部账号。
- 未登录时以游客身份访问，并在 stderr 提示登录。
- 代理：`catbus config set proxy http://127.0.0.1:7890`，或按平台设置 `xhs.proxy`，或单次用 `--proxy`。不读取 `HTTP(S)_PROXY`。

## 开发

```bash
npm ci
npm test
npm run gen:capabilities   # 改了注册表后重新生成 docs/capabilities.md
npm run assets:jd          # 取回京东验证码模型（@cv-cat/catbus-assets-jd）
```

完整规范见 [AGENTS.md](AGENTS.md)。

## License

[MIT](LICENSE)
