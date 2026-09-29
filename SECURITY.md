# 安全策略

## 支持的版本

| 版本 | 是否提供安全修复 |
|---|---|
| 0.1.x | 是 |
| < 0.1 | 否 |

catbus 目前处于 0.1.x。npm 包 `catbus-cli` 即将发布，在此之前从源码安装的用户请跟随 `master` 分支的最新提交。

## 报告漏洞

**请不要在公开的 issue、PR 或讨论里报告安全问题。**

请通过 GitHub Security Advisories 私下报告：

**https://github.com/cv-cat/catbus/security/advisories/new**

报告里请尽量写清楚：

- 受影响的版本或 commit，以及系统、Node 版本（`catbus version` 的输出）；
- 问题的类型和影响，例如凭证泄露、凭证文件权限不当、日志没有打码、任意文件写入、命令注入；
- 复现步骤或概念验证；
- 你建议的修复方式（如果有）。

**附带日志、截图或 `~/.catbus/` 里的文件之前，请先去掉所有 cookie、token、私钥和账号信息。** 我们永远不会向你索要真实凭证。

维护者会在 Security Advisory 里跟你沟通确认、修复和公开的时间。修复发布之前，请不要公开细节。

## 范围

属于本项目的安全问题，例如：

- 凭证被写到 `~/.catbus/` 以外的地方，或者出现在 stdout、日志、错误信息、对拍数据里；
- `~/.catbus/` 下的目录或文件权限比规定的宽（见下文）；
- `-v` 的调试日志没有给凭证打码；
- 请求被发到平台接口以外的地方，或者代理设置被绕过；
- 下载、上传、文件名处理导致写出指定目录（路径穿越）；
- 签名 vm、子进程或本地验证页面可以被外部利用。

不属于本项目的问题：

- 各平台自身接口的安全问题，请报告给对应平台；
- 上游仓库（`references/` 里的 cv-cat 系列项目）的问题，请报告给对应的上游仓库；如果 catbus 继承了这个问题，也欢迎在这里私下报告；
- 平台的风控、封号、验证码：这属于使用风险，不是 catbus 的漏洞（见 [docs/trouble.md](docs/trouble.md)）；
- 需要攻击者已经能以你的用户身份读写本机文件的场景。

## catbus 怎么保护你的凭证

规范见 [AGENTS.md](AGENTS.md) 第 5 节「登录态」和第 8 节「开发约定」。

### 只存在本机

- 登录态只保存在本机的 `~/.catbus/`（可用环境变量 `CATBUS_HOME` 覆盖），按 平台 × 端 × 账号 分文件存放：`auth/<platform>/<endpoint>/<account>.json`。
- 凭证文件只由 core 读写。平台实现从 core 拿凭证，更新后交回 core 落盘；将来的 external provider 也不直接读写 `~/.catbus/`（AGENTS 7.8）。

### 文件权限与原子写入

- 目录权限 0700，文件权限 0600，包括凭证文件、`config.toml`、二维码 PNG 和短信登录的中间态。Windows 上依赖用户目录本身的 ACL。
- `catbus doctor` 会检查数据目录的权限；其他用户可以访问时，这一项不通过，并提示执行 `chmod 700 ~/.catbus`。
- 所有写入都是原子的：先写同目录下权限 0600 的临时文件，再 rename 覆盖，写到一半中断也不会留下损坏或权限过宽的凭证文件。

### 日志打码

- stdout 只输出 JSON 信封；日志、提示、二维码一律写到 stderr。
- `-v` 输出的调试日志经过打码：键名含 cookie、token、authorization、password、secret、ticket 等的值换成 `***`；字符串里的 Cookie / Set-Cookie 头整行打码，`token=...` 这类键值对只打码值；代理地址里的用户名和密码也会打码。
- 即便如此，公开贴日志前也请自己再检查一遍。

### 网络

- catbus 只向各平台自身的接口（以及平台页面本身会调用的验证码、设备注册等服务）发请求，不向 catbus 自己或任何第三方服务器发送数据，没有遥测。详见 [PRIVACY.md](PRIVACY.md)。
- 代理只能显式配置（`--proxy`、`<platform>.proxy`、`proxy`），catbus 不读取 `HTTP(S)_PROXY` 环境变量，也不使用系统代理，避免请求在你不知情时经过别的代理。
- 收到的 Set-Cookie 只接受属于请求域名的，跨域的 cookie 会被拒收。

### 开发侧的红线

- 严禁把真实 cookie、token、私钥写进代码、测试 fixture、对拍数据、日志或提交记录；对拍数据只能用假凭证。
- 在线测试的报告 `.e2e/` 含有真实账号的数据，不进版本控制。

## 给用户的建议

- 不要把 `~/.catbus/` 放进同步盘、备份到公开位置，或者提交进 git 仓库。
- 在多人共用的机器上，确认 `catbus doctor` 的 `home` 一项通过。
- 用 `--cookie` 导入 cookie 时，优先用 `--cookie @file` 或 `--cookie -`（从 stdin 读取），避免 cookie 留在 shell 历史里；导入后删掉那个临时文件。
- 不再使用的账号执行 `catbus <platform> auth logout -a <name>`（B 站、快手会同时在服务端登出）；怀疑凭证泄露时，到平台上退出所有设备的登录。
