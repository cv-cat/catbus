# 配置与数据目录

catbus 的配置很少：代理和请求超时。登录态、缓存和配置都在一个数据目录里。

规范见 [AGENTS.md 5.1、5.5](../../AGENTS.md#55-配置与代理)。

## 数据目录

默认是 `~/.catbus/`，可以用环境变量 `CATBUS_HOME` 换成别的目录：

```bash
export CATBUS_HOME=/data/catbus          # 之后所有命令都用这个目录
CATBUS_HOME=/tmp/catbus-test catbus auth list   # 只对这一条命令生效
```

目录结构：

```
~/.catbus/
├── config.toml                    # 配置，见下文
├── auth/
│   └── <platform>/                # 规范 id：xhs、douyin、bilibili……
│       └── <endpoint>/            # web | app | pc
│           ├── <account>.json     # 一个账号一个凭证文件
│           ├── guest.json         # 游客态的设备数据（只在支持游客态的端上生成，web 端没有）
│           └── _current           # 当前账号名
└── cache/<platform>/              # 可以随时删除：二维码 PNG、短信登录的中间态
```

- 权限：目录 0700、文件 0600；Windows 依赖用户目录本身的 ACL。`catbus doctor` 会检查数据目录，其他用户能访问时报错并给出 `chmod 700` 的命令。
- 所有写入都是原子的（先写临时文件再 rename），命令中途被中断不会写坏凭证。
- 凭证文件只由 catbus 自己读写，不需要手动编辑。凭证文件的格式见 [AGENTS.md 5.4](../../AGENTS.md#54-凭证文件)。
- `cache/` 可以随时删除；删掉正在进行的短信登录中间态后，需要重新发验证码。

这个目录里有你的全部登录态，**不要提交到 git、打包分享或贴到 issue 里**。

## config.toml

只有这几项：

```toml
proxy = "http://127.0.0.1:7890"   # 全局代理
timeout = 30                      # 单次请求超时（秒），默认 30

[xhs]
proxy = "socks5://127.0.0.1:1080" # 平台代理，段名用平台的规范 id
```

用 `catbus config` 读写，不需要手动编辑：

```bash
catbus config set proxy http://127.0.0.1:7890
catbus config set xhs.proxy socks5://127.0.0.1:1080   # 点号表示平台段；平台别名也可以（bili.proxy 会存成 bilibili.proxy）
catbus config set timeout 60
catbus config get xhs.proxy
catbus config unset xhs.proxy
catbus config list                                     # 只列出已设置的项，键用点号展开
```

```json
{"ok":true,"platform":null,"endpoint":null,"resource":"config","action":"list","account":null,
 "data":{"proxy":"http://127.0.0.1:7890","timeout":60,"xhs.proxy":"socks5://127.0.0.1:1080"},"page":null,"error":null}
```

- 可设置的键只有 `proxy`、`timeout`、`<platform>.proxy`，其他键报 `USAGE`。
- `timeout` 必须是大于 0 的秒数。
- 手动编辑 `config.toml` 出现格式错误时，命令报 `ERROR` 并在 `hint` 里给出文件路径。

## 代理

代理的优先级：

```
--proxy（本次命令） > <platform>.proxy > proxy
```

```bash
catbus x user get elonmusk --proxy http://127.0.0.1:7890
```

- 支持 `http`、`https`、`socks4`、`socks5`、`socks5h`，地址可以带用户名密码（`http://user:pass@host:port`），`-v` 的日志里会打码。
- **catbus 不读取 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量，也不用系统代理**，代理只能通过上面三种方式显式配置。
- 访问 TikTok、X 这类需要代理的平台，推荐按平台设置（`tiktok.proxy`、`x.proxy`），国内平台保持直连。
- 代理连不上、握手失败时报 `NETWORK`（退出码 6）。

## 环境变量

| 变量 | 说明 |
|---|---|
| `CATBUS_HOME` | 数据目录，默认 `~/.catbus` |

除此之外 catbus 不读取别的环境变量来改变行为（代理见上文）。开发时用到的环境变量（例如取回模型的 `CATBUS_DDDDOCR_WHEEL`）见 [AGENTS.md 7.2](../../AGENTS.md#72-打包与分发)。
