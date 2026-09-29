# 测试手册

catbus 的测试分三层：

| 层 | 命令 | 联网 | 在哪里跑 | 目的 |
|---|---|---|---|---|
| 离线：单元与对拍 | `npm test` | 禁止 | 本机、CI | 逻辑正确；请求构造和签名与上游逐字节一致 |
| 在线 | `npm run test:e2e` | 是，用本机登录态 | 只在开发者本机 | 真实平台上只读命令能跑通，归一化字段结构正确 |
| 冒烟 | `node scripts/smoke.mjs` | 否 | CI 的全部目标系统 | 打好的包在每个系统上都能安装、加载原生依赖、运行 |

规范依据是 AGENTS 7.5「移植与对拍测试」。怎么新增命令、怎么生成对拍数据，见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 1. 准备

```bash
npm ci
npm run assets:jd     # 京东验证码模型：jd.test.ts 的 JCAP 求解器要用
npm run assets:ocr    # ddddocr 模型：bilibili-geetest.test.ts 的极验点选识别要用
```

模型文件不进 git，取回一次之后就一直在 `packages/assets-*/models/` 里。

## 2. 离线测试：单元与对拍

### 2.1 运行

```bash
npm test                                   # 全部离线测试
npm run typecheck                          # 类型检查：vitest 不做类型检查，要单独跑
npx vitest run tests/bilibili.test.ts      # 只跑一个文件
npx vitest run tests/xhs.test.ts -t 对拍    # 只跑名字匹配的用例
npx vitest                                 # watch 模式
```

测试直接跑 `src/` 下的 TypeScript，不需要先 `npm run build`。

配置在 [vitest.config.ts](vitest.config.ts)：

- 只收 `tests/**/*.test.ts`；
- 预加载 [tests/setup.ts](tests/setup.ts)；
- 单个用例超时 60 秒：对拍用例要在 vm 里跑上游的签名 JS，慢的 CI 机器上会超过默认的 5 秒；
- 时区固定为 `Asia/Shanghai`：对拍数据在北京时间下生成，签名里常有按本地时间格式化的时间戳（例如京东 h5st）。

### 2.2 禁止联网

[tests/setup.ts](tests/setup.ts) 把 `core/http` 的发送器换成一个直接抛错的函数。离线测试里只要有一条请求漏到真实网络，就会报：

```
测试里不允许联网：GET https://...
```

需要请求的测试有两种办法：用 `replay()` 按对拍数据回放（2.4），或者用 `mockSender()` 临时换一个按 URL 返回假响应的发送器（2.6）。

### 2.3 目录与文件

| 路径 | 内容 |
|---|---|
| `tests/cli.test.ts` | 全局命令、四层帮助、命令判定（NOT_IMPLEMENTED / UNSUPPORTED / USAGE）、core 实现的 auth 命令 |
| `tests/core.test.ts` | errors、日志打码、选项、hints、doctor、原子写入、auth store、config、http、vm、登录轮询、cookie 罐、`jsonLoads` |
| `tests/registry.test.ts` | 注册表约束、handler 名与命令对应、`docs/capabilities.md` 是否最新、`package.json` 是否精确钉住模型包版本 |
| `tests/runtime.test.ts` | 身份与游客态、危险操作确认、分页、长连接、输出格式、发布选项 |
| `tests/golden-core.test.ts` | core 的对拍：Python 编码函数、curl_cffi 的 URL 拼接、确定性随机数与时钟 |
| `tests/<p>.test.ts` | 每个平台的对拍测试与命令测试 |
| `tests/bilibili-geetest.test.ts` | B 站极验：w 参数、验证链路、点选识别（ddddocr）、人工兜底页面 |
| `tests/golden/<p>/*.json` | 对拍数据，由 `scripts/golden/<p>/gen.py` 生成，不手改 |
| `tests/golden.ts` | 对拍工具：`loadCase`、`replay`、`expectRequests`、`makeCtx` |
| `tests/helpers.ts` | `useTempHome()`：每个测试一个临时 `CATBUS_HOME`；`cli(...argv)`：在进程内跑一次 catbus，捕获 stdout / stderr 并解析信封 |

各平台的对拍数据文件数（`ls tests/golden/<p> | wc -l`，统计于 2026-09-29）：

| 平台 | 对拍数据 | 生成脚本 |
|---|---:|---|
| core | 3 | `scripts/golden/core/gen.py` |
| xhs | 56 | `scripts/golden/xhs/gen.py` |
| douyin | 82 | `scripts/golden/douyin/gen.py`（末尾再执行 `gen_more.py`、`gen_gap.py`） |
| tiktok | 100 | `scripts/golden/tiktok/gen.py` |
| bilibili | 85 | `scripts/golden/bilibili/gen.py` |
| kuaishou | 79 | `scripts/golden/kuaishou/gen.py` |
| weibo | 19 | `scripts/golden/weibo/gen.py` |
| xianyu | 20 | `scripts/golden/xianyu/gen.py` |
| taobao | 12 | `scripts/golden/taobao/gen.py` |
| jd | 46 | `scripts/golden/jd/gen.py` |
| x | 60 | `scripts/golden/x/gen.py` |
| **合计** | **562** | |

大多数文件是一条请求序列；也有一些记录的是纯计算的中间结果（例如验证码图像处理、指纹块），由对应的测试逐项比较。

### 2.4 对拍测试怎么工作

一份对拍数据（`tests/golden/<p>/<case>.json`）记录了上游 Python 代码在固定条件下的一次运行：

```json
{
  "input": { "uid": "1669879400" },
  "seed": 20260927,
  "now": 1790000000123,
  "requests": [{ "method": "GET", "url": "...", "headers": [["accept", "..."]], "cookies": [], "body": null, "multipart": null }],
  "responses": [{ "status": 200, "headers": {}, "body": {} }],
  "result": {},
  "error": null
}
```

TS 侧的测试：

```ts
const c = loadCase('bilibili', 'user_info')
const { requests, result, error } = await replay(c, () => api.userInfo(b, '2'))
if (error) throw error
expectRequests(requests, c.requests)
```

- `replay(c, run)` 用用例的 `seed` 和 `now` 打开确定性模式（`core/rand.ts` 的 `deterministic()`），把发送器换成按顺序返回 `c.responses` 的回放器，然后运行 `run`，返回 TS 实际发出的请求。二进制响应在用例里记成 `{"base64": ...}`，回放时按原字节返回。
- `expectRequests(actual, expected)` 先比较「方法 + URL」的序列，再逐个比较整个请求：header（含顺序）、cookie、body、multipart。
- `makeCtx({ platform, cookies, args, options, ... })` 造一个测试用的 `HandlerContext`，可以直接调用 `commands.ts` 里的 handler，对拍整条命令流程（例如 B 站的游客设备初始化）。

生成对拍数据的框架是 `scripts/golden/catbus_golden.py`：替换 Python 的 `random` / `secrets` / `uuid` / `os.urandom` / `time`（推导公式与 `src/core/rand.ts` 一一对应），截获 curl_cffi 与 requests 的请求（不联网，按用例给的响应回复），并通过 `NODE_OPTIONS` 给上游起的 node 子进程预加载 `node_determinism.cjs`。各平台还有自己的补丁，写在各自 `gen.py` 开头的说明里。环境搭建和运行方式见 [CONTRIBUTING.md](CONTRIBUTING.md) 第 5 节。

`scripts/golden/core/gen.py` 生成的是 core 自己的对拍数据（随机数序列、编码函数、URL 拼接）。它要用 `references/BilibiliApis` 和 curl_cffi，用任意一个装了 curl_cffi 的平台虚拟环境运行即可，例如 `.golden/bilibili`。

**对拍数据只能用假凭证。**

### 2.5 加一个对拍用例

1. 在 `scripts/golden/<p>/gen.py` 里加用例：`case('<名字>', <调用上游的函数>, **input)`，需要的话在 `respond(req)` 里按 URL 给出假响应。
2. 运行 `.golden/<p>/bin/python scripts/golden/<p>/gen.py`（Windows 为 `.golden\<p>\Scripts\python`），生成 `tests/golden/<p>/<名字>.json`。
3. 在 `tests/<p>.test.ts` 的用例表里加上同名的 TS 调用。多数平台有一张 `CASES` 表（用例名 → TS 侧的等价调用，值的具体形状各平台略有不同，照同文件里已有的写），循环里对每个用例做 `replay` + `expectRequests`。
4. `npx vitest run tests/<p>.test.ts`。
5. 用 `git diff tests/golden/<p>` 确认只有预期的用例变了。

### 2.6 命令测试（非对拍）

上游没有对应方法、catbus 自己补的逻辑（参数解析、归一化、分页、错误映射、上游没有的请求），用命令测试覆盖：`mockSender` 按 URL 回假响应，`deterministic()` 固定时钟，直接调用 handler。例子见 `tests/bilibili.test.ts` 的 `runCommand`：

```ts
const restoreRand = deterministic({ now: NOW })
const restore = mockSender((p) => fakeResponse(route(p.url, p.body), { headers: [['content-type', 'application/json']], url: p.url }))
try {
  const result = await commands.itemRelated(ctx)
  // 断言 result 与发出的请求
} finally {
  restore()
  restoreRand()
}
```

测 CLI 层的行为（退出码、信封、帮助、确认）用 `tests/helpers.ts` 的 `useTempHome()` 和 `cli()`：

```ts
useTempHome()
it('planned 端报 NOT_IMPLEMENTED', async () => {
  const r = await cli('xianyu', 'item', 'get', 'x', '-e', 'app')
  expect(r.code).toBe(4)
  expect(r.env.error.code).toBe('NOT_IMPLEMENTED')
})
```

### 2.7 常见失败

| 现象 | 原因与处理 |
|---|---|
| `测试里不允许联网：<方法> <URL>` | 有请求没被回放或 mock。检查测试有没有包在 `replay()` / `mockSender()` 里，以及 handler 有没有在 `replay` 返回之后还在发请求（漏了 `await`） |
| `TS 实现多发了请求：<方法> <URL>` | TS 比上游多发了请求。对照上游看是多了一步初始化、重试，还是本该复用的缓存（签名密钥、token）没复用 |
| `expectRequests` 第一条断言失败（URL 序列不同） | 请求的顺序或数量与上游不同。先让序列一致，再看单个请求的差异 |
| `第 N 个请求：...` 的 diff | header 顺序、cookie、body 或签名不一致。header 要按上游顺序显式给出；编码用 `core/py.ts`；需要键序的 JSON 用 `Map` |
| 从某个请求起签名、随机串全都不对 | 随机数的消耗顺序和上游错位了：只能经 `core/rand.ts` 取随机数和时间，调用次数、顺序要和上游一致 |
| 只有时间相关的字段不对 | 时区不是北京时间。测试要经 `vitest.config.ts` 运行；生成对拍数据时框架会自己设 `TZ` |
| `ENOENT ... packages/assets-jd/models/...`（或 `assets-ocr`） | 没取回模型：`npm run assets:jd`、`npm run assets:ocr` |
| `docs/capabilities.md 与注册表一致` 失败 | 改了注册表没有重新生成：`npm run gen:capabilities` |
| `handler 名是 <resource><Action>` 失败 | 注册表里的 handler 名接错了，例如 `draft delete` 必须对应 `draftDelete` |
| 用例超时 | 签名 JS 在 vm 里跑得慢。先确认不是死循环（例如翻页游标没变化）；机器确实慢时只对那个用例单独放宽超时 |
| 只在某台机器上失败的指纹字段 | 依赖本机字体渲染、CPU 架构或 V8 版本的值（京东 WebM 的 canvas / webgl 哈希、`architecture`、Math 指纹的末位）不能逐字节比较。现有做法是把这类字段排除在比较之外，或者按有效数字比较，照 `tests/jd.test.ts` 处理 |
| 重新生成后大量无关用例变了 | `references/<repo>` 不在 `UPSTREAM` 记录的 commit 上，或者虚拟环境里的依赖版本不对 |

## 3. 在线测试

在线测试用真实账号请求真实平台，**不在 `npm test` 和 CI 里跑**，只在开发者本机手动运行。

### 3.1 运行

```bash
catbus bilibili auth login          # 先登录要测的平台（各平台的登录方式见 docs/capabilities.md）
npm run test:e2e                    # 所有平台；没登录的平台整组跳过
npm run test:e2e -- -t bilibili     # 只跑一个平台
npm run test:e2e -- -t '^x '        # X 的平台 id 太短，-t x 会连 xhs、xianyu 一起匹配，要锚定开头
```

- `-t` 按「平台 id + 命令」的完整用例名做匹配（例如 `bilibili item get`），所以也可以只跑一条命令：`-t 'bilibili item get'`。不过后面的命令要用前面命令的结果当参数，单独跑时多半会因为缺参数而跳过。
- 登录态来自 `~/.catbus`。想用单独的测试账号，把它们登录到另一个目录，再用 `CATBUS_HOME` 指过去：`CATBUS_HOME=~/catbus-test npm run test:e2e`。
- 配置在 [vitest.e2e.config.ts](vitest.e2e.config.ts)：只收 `tests/e2e/**/*.e2e.ts`，**不加载** `tests/setup.ts`（请求会真的发出去），单个用例超时 180 秒。

### 3.2 跑什么、怎么判定

入口是 [tests/e2e/live.e2e.ts](tests/e2e/live.e2e.ts)，完全由注册表驱动：

1. 对每个平台，从注册表里取出 web 端已实现（`implemented`）、非长连接、action 属于只读集合（`get`、`search`、`list`、`items`、`replies`、`media`、`categories`……）的命令。写操作、`item download`、`listen` 都不跑；`auth login` / `use` / `logout` 也不跑。
2. 按四个阶段执行：`auth status` → 不需要对象参数的命令（搜索、列表、推荐流、热词……）→ 需要 item / 用户 / 直播间 / 会话 / 收藏夹的命令 → 需要评论的命令。前面命令返回的对象收进一个池子，它们的 `url` 或 `id` 当作后面命令的参数。
3. 搜索词默认是「猫」；tiktok、x 用 `cat`，xianyu、taobao、jd 用「键盘」。
4. 命令之间间隔 1.5 秒，小红书 4 秒（1.5 秒间隔下评论接口触发过 461 人机验证）。

每条命令的判定：

| 情况 | 结果 |
|---|---|
| `auth status` 返回 `logged_in: false` | 这个平台后面的命令全部跳过（「没有登录 <p>」） |
| 前面的命令没拿到需要的对象 | 跳过（「前面的命令没有拿到 <参数名>」） |
| `AUTH_REQUIRED` | 跳过：主站已经登录，这是子站点（`--scope`）没登录 |
| `RISK_CONTROL` | 跳过：风控取决于账号和近期的请求，不是代码问题 |
| `NOT_IMPLEMENTED` | 跳过：默认参数落在了注册表 note 写明「规划中」的取值上 |
| `UNSUPPORTED`，且命令有 note | 跳过：参数不在 note 写明的支持范围内 |
| 其他错误 | 失败 |
| 成功 | 校验：`ok`、`platform`、`account`；`data` 符合 AGENTS 6.2 的结构（[tests/e2e/shapes.ts](tests/e2e/shapes.ts)，zod strict 对象，多一个字段、少一个字段都算错）；分页命令的 `page` 带 `has_more`，其他命令的 `page` 为 null；`item search`、`user search`、`feed list`、`keyword hot` / `suggest`、`live list` / `search` 不能返回空列表（TikTok 的 `live list` 是「关注的人在播」，允许为空） |

### 3.3 报告

每个平台跑完写一份 `.e2e/<p>.json`（不进版本控制）。每条命令一项：

| 字段 | 内容 |
|---|---|
| `command`、`argv` | 命令与实际用的参数 |
| `code`、`error` | 退出码与错误 |
| `count` | 列表的条数 |
| `empty_fields` | 在**所有**元素里都是 null 或 `[]` 的字段，用来发现归一化漏取的字段 |
| `page` | 分页信息 |
| `data` | 返回的数据（列表只留前 3 条） |

`empty_fields` 里出现的字段，先对照 [docs/trouble.md](docs/trouble.md) 第 5 节「数据缺口」：上游接口本来就不返回的字段属于已知情况，其余的多半是 `normalize.ts` 取错了键。

报告里是真实账号返回的数据（昵称、ID、私信会话等），**不要提交，也不要整份贴到 issue 里**。

### 3.4 加用例

在线测试没有手写的用例表：新实现的只读命令会自动加入。只有下面几种情况要改 `tests/e2e/`：

- 新的只读 action（例如扩展命令 `item subtitles` 的 `subtitles`）：加进 `live.e2e.ts` 的 `READ_ACTIONS`；
- 新的位置参数名：在 `argValue()` 里说明从池子里取什么；
- 新的输出类型：在 `shapes.ts` 的 `SHAPES` 里加校验器（否则报「没有 <类型> 的校验器」）；想让它的结果给后面的命令用，在 `harvest()` 里收进池子；
- 某条命令在真实平台上不该为空，或者允许为空：改 `NON_EMPTY` / `MAY_BE_EMPTY`。

### 3.5 注意与常见失败

- 在线测试会用你的账号发大量请求，可能触发风控。真机验证期间京东的测试账号被封过（见 [docs/trouble.md](docs/trouble.md) 6.2），建议用专门的测试账号，不要频繁连续跑。
- 某个平台的全部命令都跳过：先确认 `catbus <p> auth status` 返回 `logged_in: true`。
- 结构校验失败：错误信息里是 zod 的前 5 条 issue，常见的是时间不是带时区的 ISO 8601、计数是字符串、多了平台私有字段。对照 `.e2e/<p>.json` 里的 `data` 修 `normalize.ts`。
- 「真实平台上不该是空列表」：先手动跑一次同样的命令，看是搜索词不合适、账号本身没有数据，还是接口换了字段。
- 各平台目前的真机验证进度和已知问题见 [docs/trouble.md](docs/trouble.md)。

## 4. CI 与冒烟测试

### 4.1 CI 做了什么

[.github/workflows/ci.yml](.github/workflows/ci.yml) 在推送到 `master`、提交 PR 时触发；推送 `v*` tag 时，[release.yml](.github/workflows/release.yml) 也会先调用它跑完整 CI，再发布 CI 里打好、测过的同一份 tarball。

| job | 环境 | 步骤 |
|---|---|---|
| `test` | ubuntu / windows / macos × Node 22 / 24 / 26 | `npm ci` → `assets:jd` → `assets:ocr`（模型按 key 缓存）→ `typecheck` → `npm test` |
| `pack` | ubuntu，Node 24 | `npm pack` 打出 `catbus-cli`、`@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` 三个 tarball（prepack 会先构建、先取回并校验模型），连同 `scripts/smoke.mjs` 上传为 artifact |
| `smoke` | 8 个目标系统 × Node 22 / 24 | 全局安装三个 tarball，运行 `node scripts/smoke.mjs` |

CI 只跑离线测试，不跑在线测试。

`smoke` 覆盖 AGENTS 7.2 的全部目标系统：

| target | runner |
|---|---|
| win32-x64 | `windows-latest` |
| win32-arm64 | `windows-11-arm` |
| darwin-arm64 | `macos-latest` |
| darwin-x64 | `macos-15-intel` |
| linux-x64-gnu | `ubuntu-latest` |
| linux-arm64-gnu | `ubuntu-24.04-arm` |
| linux-x64-musl | `ubuntu-latest` 上的 `node:<版本>-alpine` 容器 |
| linux-arm64-musl | `ubuntu-24.04-arm` 上的 `node:<版本>-alpine` 容器 |

Alpine 容器里跑不了 JS action（arm64 尤其如此），所以 musl 两项直接用 `docker run`。

### 4.2 冒烟测试查什么

[scripts/smoke.mjs](scripts/smoke.mjs) 对**已经全局安装**的 `catbus` 运行下面几项，数据目录用一个临时的 `CATBUS_HOME`：

| 检查项 | 通过条件 |
|---|---|
| `version` | 退出码 0，报告的 Node 版本就是当前的 Node |
| `doctor` | 全部检查项通过：Node 版本、数据目录可写且权限正确、签名 vm 能执行、wreq-js / @napi-rs/canvas / onnxruntime-web 能加载、两个模型包就位 |
| 模型包 | `doctor` 的 `assets-jd`、`assets-ocr` 两项通过 |
| `platforms` | 返回 10 个平台 |
| `--help` | 输出里有 `catbus <platform> <resource> <action>` |
| planned 端 | `catbus xianyu item get x -e app` 报 `NOT_IMPLEMENTED`，退出码 4 |
| `auth list` | 返回数组 |

### 4.3 在本机跑冒烟测试

```bash
npm pack
npm pack -w packages/assets-jd
npm pack -w packages/assets-ocr
npm install -g ./cv-cat-catbus-assets-jd-*.tgz ./cv-cat-catbus-assets-ocr-*.tgz ./catbus-cli-*.tgz
node scripts/smoke.mjs
```

全局安装会覆盖 `npm link` 出来的 `catbus`，测完需要的话重新 `npm link`。在 macOS / Windows 上测 musl：

```bash
docker run --rm -v "$PWD:/w" -w /w node:24-alpine \
  sh -c 'npm install -g ./cv-cat-catbus-assets-jd-*.tgz ./cv-cat-catbus-assets-ocr-*.tgz ./catbus-cli-*.tgz && node scripts/smoke.mjs'
```

### 4.4 CI 常见失败

| 现象 | 原因与处理 |
|---|---|
| `pack` 在 tsc 这一步失败，本地 `typecheck` 却是好的 | `typecheck` 用 `tsconfig.json`（包括 `tests/`），`build` 用 `tsconfig.build.json`（只有 `src/`），两者看到的类型不完全一样。例如 `TextDecoder` 要从 `node:util` 引入，不能依赖 DOM 类型。推送前本地也跑一次 `npm run build` |
| 只在 Windows 上失败 | 路径分隔符、`rename` 被占用（`writeFileAtomic` 已经重试）、换行符（仓库按 `.gitattributes` 统一 LF，`static/` 按字节保存） |
| 某个目标系统的 `smoke` 失败，`doctor` 里 `http` / `canvas` / `onnx` 不通过 | 这个原生依赖在该系统上没有预编译包。按 AGENTS 7.2，任何一个目标系统缺预编译包的依赖都不能用，换依赖或去掉 |
| `smoke` 的 `assets-jd` / `assets-ocr` 不通过 | 模型没有打进 tarball。检查 `pack` job 里 prepack 取回模型的日志（sha256 校验失败会直接报错） |
| 模型下载失败 | `assets:jd` 从 GitHub 下载、`assets:ocr` 从 PyPI 下载，偶发网络错误时重跑 job；缓存命中后不再下载 |
