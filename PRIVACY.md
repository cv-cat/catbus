# 隐私说明

**最后更新**：2026-09-29

本文说明 catbus（猫巴士）命令行工具在你的电脑上做什么、不做什么，以及数据怎么流动。catbus 是开源的，下面每一条都可以对照 [源码](https://github.com/cv-cat/catbus) 核实。

## catbus 做什么

catbus 是一个运行在你本机的命令行工具。你执行一条命令，例如 `catbus bilibili item get BV1xx411c7mD`，它会：

1. 从本机的 `~/.catbus/` 读取你登录过的该平台账号的凭证；
2. 按平台网页端的方式构造请求并签名，直接发给**该平台自己的接口**；
3. 把平台返回的数据整理成统一的 JSON，输出到你的终端。

它相当于一个不带界面的浏览器客户端：你能在平台网页上看到、做到的，catbus 用你自己的账号替你请求。

## catbus 不做什么

- **不收集数据**：不收集你的账号、浏览内容、命令记录或任何使用数据。
- **没有遥测**：没有统计、埋点、崩溃上报，也不检查更新。
- **没有 catbus 的服务器**：catbus 没有自己的后端，不存在把数据上传到「catbus 服务器」这回事。
- **不转发给第三方**：除了你调用的那个平台，数据不会发给任何人。
- **不读取你的浏览器**：catbus 不读浏览器的 cookie 数据库、密码或历史。凭证只来自你主动执行的 `auth login`（扫码、短信、账密，或者你自己粘贴的 cookie）。
- **不在后台运行**：命令执行完进程就退出；只有 `live listen`、`msg listen` 这类长连接命令会一直运行，直到你按 Ctrl-C 或 `--duration` 到期。

## 数据流

```
你的终端
   │  catbus <platform> <resource> <action>
   ▼
catbus（本机进程）
   │  读写凭证 ─────────► ~/.catbus/（只在本机，目录 0700、文件 0600）
   │  签名 JS 在本机的 node:vm 里执行；验证码模型在本机推理
   ▼
平台自己的接口（HTTPS / WSS）
   例如 api.bilibili.com、edith.xiaohongshu.com、www.douyin.com……
   可选：经过你显式配置的代理
```

说明：

- **请求只发往平台。** 除了平台的业务接口，catbus 还会按平台网页本身的做法，请求平台登录和风控所依赖的服务，例如设备注册、验证码（B 站用的极验等）。这些请求与你在浏览器里打开平台网页时发生的一致，不涉及平台以外的服务。
- **代理只在你配置时使用。** catbus 不读取 `HTTP(S)_PROXY` 环境变量，也不使用系统代理。只有你用 `--proxy`、`catbus config set proxy ...` 或 `<platform>.proxy` 显式配置了代理，请求才会经过它。
- **平台会看到什么。** 平台会像处理浏览器请求一样看到你的账号、IP 地址、请求内容和设备指纹。catbus 无法、也不会替你隐藏这些；平台如何处理这些数据，由各平台的隐私政策决定。
- **本地验证页面。** B 站自动识别验证码失败时，catbus 可能在 `127.0.0.1` 上临时起一个页面，让你在浏览器里手动完成极验验证。这个页面只监听本机，验证完成或超时后关闭。

## 本机存了什么

所有数据都在 `~/.catbus/`（可用环境变量 `CATBUS_HOME` 换到别的目录）：

| 路径 | 内容 |
|---|---|
| `auth/<platform>/<endpoint>/<account>.json` | 账号凭证：cookie、token、设备数据，以及账号的 id、昵称、主页链接 |
| `auth/<platform>/<endpoint>/_current` | 当前使用的账号名 |
| `auth/<platform>/<endpoint>/guest.json` | 游客态的设备数据（只在支持游客态的端上有；目前的 web 端都不支持） |
| `config.toml` | 你的配置：代理、超时 |
| `cache/<platform>/` | 登录用的二维码 PNG、短信登录的中间态（10 分钟有效）等临时文件，可以随时删除 |

- 目录权限 0700、文件权限 0600，写入是原子的（先写临时文件再 rename）。Windows 上依赖用户目录本身的 ACL。
- 你用 `item download` 下载的文件保存在你用 `--dir` 指定的目录（默认当前目录），不在 `~/.catbus/` 里。
- 凭证文件的格式见 [AGENTS.md](AGENTS.md) 5.4。

## 第三方依赖

catbus 用到的依赖都**在本机运行**，不会把你的数据发给依赖的作者：

| 依赖 | 用途 | 说明 |
|---|---|---|
| [wreq-js](https://www.npmjs.com/package/wreq-js) | 带浏览器 TLS / HTTP2 指纹的 HTTP 与 WebSocket | 只连接 catbus 请求的平台地址 |
| [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) | 验证码识别模型推理（WASM） | 纯本地计算 |
| `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` | 京东验证码模型、ddddocr 的 OCR 模型 | 随 npm 安装到本机，从本地加载，运行时不下载 |
| jsdom、crypto-js、@napi-rs/canvas、@techstark/opencv-js | 运行上游签名 JS、图像处理 | 纯本地计算 |
| protobufjs、zod、smol-toml、qrcode | 编解码、校验、配置、终端二维码 | 纯本地计算 |

上游平台的签名 JS 原样放在包里的 `static/` 目录，在本机的 `node:vm` 沙箱里执行。

## 如何删除数据

- 登出一个账号（删除本地凭证文件；B 站、快手会同时在服务端登出）：

  ```bash
  catbus <platform> auth logout -a <account>
  ```

- 查看本机存了哪些账号：

  ```bash
  catbus auth list
  ```

- 删除 catbus 的全部本地数据：

  ```bash
  rm -rf ~/.catbus          # 设置过 CATBUS_HOME 的话，删那个目录
  ```

  Windows 上删除 `%USERPROFILE%\.catbus`。

- 卸载：`npm uninstall -g catbus-cli`。卸载不会自动删除 `~/.catbus/`，需要的话按上一步手动删除。
- 删除本地凭证不会让平台那边的登录会话失效（B 站、快手的 `auth logout` 除外）。需要的话，到平台的账号安全设置里退出其他设备的登录。

## 开源

catbus 以 MIT 许可证开源，你可以审阅全部源码：https://github.com/cv-cat/catbus

## 联系

隐私相关的问题请在 [GitHub Issues](https://github.com/cv-cat/catbus/issues) 提出。涉及安全漏洞的，请按 [SECURITY.md](SECURITY.md) 私下报告。
