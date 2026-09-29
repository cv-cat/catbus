# 贡献指南

感谢你愿意帮 catbus（猫巴士）变得更好。本文说明怎么搭开发环境、怎么新增或修改平台命令、怎么写对拍测试，以及提交和 PR 的约定。

项目的规范本身在 [AGENTS.md](AGENTS.md)：命令语法（第 4 节）、登录态（第 5 节）、输出（第 6 节）、架构（第 7 节）、开发约定（第 8 节）。本文与它冲突时以 AGENTS.md 为准。**改规范时先改 AGENTS.md，再改代码。**

测试的细节见 [TESTING.md](TESTING.md)，安全问题的报告方式见 [SECURITY.md](SECURITY.md)。

## 1. 开发环境

| 工具 | 版本 | 用途 |
|---|---|---|
| Node | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | 构建、测试、运行（见 AGENTS 7.1） |
| npm | 随 Node 附带 | 依赖与 workspace |
| git | 任意较新版本 | |
| Python 3.13 + [uv](https://docs.astral.sh/uv/) | 3.13 | **只用于生成对拍数据**（见第 5 节）。只改文档、CLI、core 或者不涉及请求构造的代码时不需要 |

用户侧只需要 Node。不要引入需要 Python、C/C++ 编译器、node-gyp 或 install 脚本的依赖（AGENTS 7.3、8）。

## 2. 拉代码与构建

```bash
git clone https://github.com/cv-cat/catbus.git
cd catbus
npm ci
npm run assets:jd      # 取回京东验证码模型（约 81 MB），放到 packages/assets-jd/models/
npm run assets:ocr     # 取回 ddddocr 的 OCR 模型（约 34 MB），放到 packages/assets-ocr/models/
npm run build          # tsc 编译到 dist/
npm link               # 可选：把 catbus 命令链到全局，之后可以直接运行 catbus
npm run typecheck      # 类型检查（vitest 不做类型检查，要单独跑）
npm test               # 离线测试：单元测试 + 对拍测试
```

- 模型文件不进 git。离线测试里的京东验证码求解和 B 站极验点选识别要用到它们，所以跑 `npm test` 之前先取回。`assets:jd` 在有 `references/JdApis` 时从本地复制，否则从 GitHub 下载；`assets:ocr` 从 PyPI 上固定版本的 ddddocr wheel 里取出。两者都校验 sha256。
- 不想 `npm link` 时，也可以直接运行 `node dist/cli/main.js <参数>`。
- 改了 `src/` 之后要重新 `npm run build`，`npm link` 出来的 `catbus` 才会生效。测试直接跑 TypeScript 源码，不需要先构建。

常用 npm scripts（见 [package.json](package.json)）：

| 命令 | 作用 |
|---|---|
| `npm run build` | 清理 `dist/` 后编译 |
| `npm run typecheck` | `tsc --noEmit`，包括 `tests/` |
| `npm test` | 离线测试（vitest） |
| `npm run test:e2e` | 在线测试，用本机 `~/.catbus` 的登录态，只跑只读命令（见 TESTING.md） |
| `npm run gen:capabilities` | 由注册表重新生成 [docs/capabilities.md](docs/capabilities.md) |
| `npm run assets:jd` / `assets:ocr` | 取回模型文件 |

## 3. 项目结构

```
catbus/
├── AGENTS.md                       # 规范（CLAUDE.md 通过 @AGENTS.md 引用它）
├── docs/
│   ├── capabilities.md             # 能力矩阵，由注册表生成，不手改
│   ├── upstream-map.md             # 上游移植对照
│   └── trouble.md                  # 真机验证中没跑通的问题与各平台进度
├── src/
│   ├── cli/                        # 入口 main.ts、argv 解析、帮助、信封输出、危险操作确认、全局命令
│   ├── core/                       # 注册表、词表、auth store、config、errors、http、vm、rand、py、log……
│   └── platforms/
│       ├── <p>/index.ts            # 平台声明与命令注册
│       ├── <p>/UPSTREAM            # 移植所基于的上游仓库与 commit
│       ├── <p>/web/                # web 端实现
│       └── _shared/                # 几个平台共用的实现（例如闲鱼、淘宝共用的钉钉 IMPaaS 私信长连）
├── static/<p>/                     # 上游签名 JS、proto 等，按字节原样复制
├── packages/assets-jd/             # @cv-cat/catbus-assets-jd（京东验证码模型）
├── packages/assets-ocr/            # @cv-cat/catbus-assets-ocr（ddddocr 模型）
├── scripts/
│   ├── golden/                     # 调用上游 Python 生成对拍数据
│   ├── smoke.mjs                   # CI 冒烟测试
│   └── fetch-*-models.mjs          # 取回模型
├── tests/                          # vitest；golden/<p>/ 放对拍数据，e2e/ 放在线测试
└── references/                     # 上游仓库的只读副本，不进版本控制
```

### references/：上游仓库，只读

`references/` 里是作者 [cv-cat](https://github.com/cv-cat) 的 10 个上游仓库（平台 id 与仓库名的对应见 AGENTS 第 3 节）。它不进本仓库的版本控制，需要时自己克隆，并切到 `src/platforms/<p>/UPSTREAM` 记录的 commit（记有 `branch` 的，就在那个分支上）：

```bash
git clone https://github.com/cv-cat/BilibiliApis references/BilibiliApis
git -C references/BilibiliApis checkout 7d80150893b429651deee76929af760ea642b844   # 取自 src/platforms/bilibili/UPSTREAM
```

规则（AGENTS 3、8）：

- 可以读，也可以运行（用来生成对拍数据）；
- 可以在上游 gitignore 的位置装依赖，例如 `node_modules/`；
- **不能修改其中任何受版本控制的文件**。发现上游 bug 时，修到对应的上游仓库，再按新 commit 重新同步（第 6 节）。

只跑 `npm test` 不需要 `references/`：对拍数据已经生成好、放在 `tests/golden/` 里。

## 4. 新增或修改平台命令

### 4.1 三步走（AGENTS 8「新增命令」）

1. **先查词表。** 看 AGENTS 第 4 节：通用词表（4.5）、原生叫法对照（4.6）、参数（4.8）、标准选项（4.9）。含义相同的能力在所有平台上用同一个命令、同一组参数、同一种输出结构（「同义同名」）。
   - 词表不够用时，**先改 AGENTS.md**：平台特有的命令或私有选项登记到 4.7「平台扩展」；新的筛选取值加到 4.9；新的输出类型或字段加到 6.2。
   - 私有选项不能与标准选项重名。平台原生叫法（`note`、`video`……）不做别名。
2. **在注册表里声明。** 编辑 `src/platforms/<p>/index.ts`。词表里的命令只写与默认不同的部分，扩展命令把字段写全：

   ```ts
   'item related': impl('full', 'itemRelated'),
   'danmaku list': { upstream: 'full', summary: '视频弹幕', args: [item], auth: 'required', output: 'Danmaku[]', handler: h('danmakuList') },
   ```

   - `upstream` 取 `full` / `partial` / `none`，即矩阵里的 ✓ / ◐ / ○；上游只部分支持时在 `note` 里写清限制。
   - handler 名必须是 `<resource><Action>`（例如 `draft delete` → `draftDelete`），测试会检查。
   - 改完运行 `npm run gen:capabilities`，把重新生成的 `docs/capabilities.md` 一起提交。它不手改，测试会检查它是否最新。
3. **再实现。** 见下一节。

### 4.2 平台实现的约定（AGENTS 7.5）

参考实现是 [src/platforms/bilibili/web/](src/platforms/bilibili/web/)，新平台或新命令照它的结构写：

| 文件 | 内容 |
|---|---|
| `client.ts` | 会话：设备初始化、签名密钥、带重试的请求、业务码 → 错误 |
| `api.ts` | 一个函数对应一个上游方法，字段与顺序照抄上游 |
| `commands.ts` | 命令 handler，导出名与注册表里的 handler 名一致 |
| `normalize.ts` | 原始对象 → AGENTS 6.2 的归一化类型，挂上原始对象供 `--raw` |
| `resolve.ts` | 参数归一化：ID、URL、分享短链、自然标识、`me` |

写代码时：

- **行为以上游为准**：同样的输入，产出同样的请求（URL、query、header 顺序、cookie、body、签名）。
- 随机数和当前时间只经 `core/rand.ts`，等待用 `rand.sleep`。否则对拍时随机数序列会错位。
- 与 Python 对应的编码（`urlencode`、`quote`、`json.dumps`）用 `core/py.ts`；需要精确键序的 JSON 用 `Map`。
- 解析平台响应用 `core/py.ts` 的 `jsonLoads`，不直接用 `JSON.parse`（它和 Python 的 `json.loads` 一样保留 64 位整数 ID）。
- HTTP 用 `toolkit.httpClient(ctx)` 拿到的 `HttpClient`，请求头按上游顺序显式给出。cookie 在凭证的 cookie 罐里，Set-Cookie 自动写回，命令结束时由 core 落盘。平台代码不直接读写 `~/.catbus/`。
- 上游的签名 JS 原样复制到 `static/<p>/`，不手改（`.gitattributes` 让它按字节保存），用 `core/vm.ts` 的 `loadScript` / `callScript` 执行，需要适配的地方在 TS 一侧包装。
- 业务错误映射到 AGENTS 6.4 的错误码：登录墙用 `toolkit.authError`，验证码或风控报 `RISK_CONTROL`（`detail.kind` 为 `captcha` / `rate_limit` / `blocked`），其余报 `UPSTREAM`，原始错误码放进 `detail`。
- stdout 只输出信封，调试信息走 `ctx.log`（stderr，已打码）。面向用户的文字（`message`、`hint`、提示）用中文。
- 上游没有对应方法、catbus 自己补的请求，也放进 `api.ts` 并在注释里注明「非上游」。这类请求没法对拍，要用命令测试覆盖（见 TESTING.md）。
- 上游方法与 catbus 命令、选项的对应关系变了，同步更新 [docs/upstream-map.md](docs/upstream-map.md)。

## 5. 对拍测试

请求构造和签名**必须**有对拍测试（AGENTS 7.5）：先用上游 Python 代码在固定的随机数与时钟下生成请求序列，再让 TS 实现在同样的条件下运行，逐字节比较。

### 5.1 准备对拍环境

每个平台一个不进 git 的虚拟环境 `.golden/<p>/`：

```bash
uv venv .golden/<p> --python 3.13
VIRTUAL_ENV=.golden/<p> uv pip install -r references/<repo>/requirements.txt
```

各平台还要装哪些额外依赖，写在 `scripts/golden/<p>/gen.py` 开头的说明里。例如 douyin 的 blackboxprotobuf 要单独 `--no-deps` 安装；xhs、jd 还要在 `references/<repo>/` 下 `npm install`（装在上游 gitignore 的 `node_modules/` 里）。

### 5.2 生成对拍数据

在仓库根目录运行（macOS / Linux 是 `bin/python`，Windows 是 `Scripts\python`）：

```bash
.golden/bilibili/bin/python scripts/golden/bilibili/gen.py
```

框架 `scripts/golden/catbus_golden.py` 会：

- 把 Python 的 `random` / `secrets` / `uuid` / `os.urandom` / `time` 换成与 `src/core/rand.ts` 一一对应的确定性序列，时区固定为北京时间；
- 截获 curl_cffi 与 requests 的请求，不联网，按用例给的响应回复；
- 上游起的 node 子进程通过 `NODE_OPTIONS` 预加载 `node_determinism.cjs`，同样固定 `Math.random` 与 `Date`；
- 每个用例写成 `tests/golden/<p>/<case>.json`，内容包括 `input`、`seed`、`now`、`requests`、`responses`、`result`、`error`。

在 `gen.py` 里加一个用例，例如：

```python
case('user_info', logged(lambda a: BiliApi.get_user_info(a, '2')), mid='2')
```

`respond(req)` 按请求的 URL 返回假响应，不写时默认回 `{"code": 0, "data": {}}`。

**只能用假凭证。** cookie、token、私钥、账号 ID 一律写成 `fake-sessdata`、`10001` 这样的假值，不要从浏览器复制真实值，哪怕「只是临时试一下」。对拍数据会进版本控制。

### 5.3 在 TS 侧对拍

在 `tests/<p>.test.ts` 里给用例加上 TS 侧的等价调用，由 `tests/golden.ts` 的 `replay()` 在同样的随机数与时钟下运行，`expectRequests()` 比较请求序列：

```ts
const CASES: Record<string, () => Promise<unknown>> = {
  user_info: () => logged((b) => api.userInfo(b, '2')),
  // ...
}

describe('bilibili 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('bilibili', name)
      const { requests, error } = await replay(c, run)
      if (error) throw error
      expectRequests(requests, c.requests)
    })
  }
})
```

对拍数据由 `gen.py` 生成，**不要手改 `tests/golden/` 里的 JSON**。重新生成后用 `git diff tests/golden/<p>` 检查：只应该有你打算改的用例变化。大量无关用例一起变了，通常是随机数的消耗顺序变了，或者 `references/` 不在 UPSTREAM 记录的 commit 上。

对拍失败时怎么排查，见 [TESTING.md](TESTING.md) 第 2.5 节。

## 6. 上游更新时的同步流程

上游仓库更新后，按 AGENTS 7.5 的四步同步：

1. **查看变更**：

   ```bash
   git -C references/<repo> pull
   git -C references/<repo> log <UPSTREAM 里的 commit>..
   git -C references/<repo> diff <UPSTREAM 里的 commit>.. -- <关心的目录>
   ```

2. **同步移植**：改 `api.ts` / `client.ts` 等；签名 JS 变了就把新文件原样复制到 `static/<p>/`。
3. **重新生成对拍数据**：运行 `scripts/golden/<p>/gen.py`，检查 `git diff tests/golden/<p>`，再跑 `npm test`。
4. **更新 `src/platforms/<p>/UPSTREAM`**：改成新的 commit（跟的是分支的，同时更新 `branch`）。

提交信息写成 `<p>：同步上游 <commit 或分支>，<改了什么>`，例如 `x：同步上游 3fe6ea7——正文超过 280 权重自动发长推……`。

## 7. 提交规范

看 `git log` 就能看出现有风格，请保持一致：

- **用中文写**，标题格式为 `<范围>：<改了什么>`，冒号用全角「：」。不用 `feat:` / `fix:` 之类的前缀。
- **范围**：
  - 平台 id：`xhs：`、`douyin：`；多个平台用顿号：`xianyu、taobao：`；
  - 模块或文件：`core：`、`core/http：`、`core/vm：`、`docs/trouble.md：`；
  - 规范小节：`AGENTS 7.5：`；
  - 其他：`在线测试：`、`对拍框架：`、`release：`。
- **把原因写进去**：修了什么现象、为什么这样改，引用上游时注明方法名或 commit，例如 `（上游 get_following）`。
- 标题里有几件事时用「；」分开。改动大时，正文用 `- ` 列要点。

真实的例子：

```
core/http：响应头声明了非 UTF-8 的 charset（如京东的 gbk）时按它解码，与上游 resp.text 一致；修京东登录后用户名乱码
xhs：user following（上游 XHSLiveAPI.get_following，私信页的关注列表），只支持 me，查别人报 UNSUPPORTED
AGENTS 7.5：解析平台响应用 jsonLoads
在线测试：平台风控（RISK_CONTROL）记为跳过
```

提交信息、PR 描述里不要出现 cookie、token 或真实账号数据。

## 8. PR 检查清单

提交 PR 前逐项确认：

- [ ] `npm run typecheck` 和 `npm test` 都通过（本地已取回模型）。
- [ ] 改了规范（命令、选项、输出字段、错误码）时，已经先改了 AGENTS.md。
- [ ] 新命令已在注册表里声明，`npm run gen:capabilities` 已重新生成 `docs/capabilities.md`。
- [ ] 请求构造和签名有对拍测试；对拍数据由 `gen.py` 生成，没有手改。非上游的请求有命令测试。
- [ ] 代码、测试 fixture、对拍数据、日志、提交信息里**只有假凭证**。
- [ ] 没有修改 `references/` 里受版本控制的文件；`static/` 里的上游 JS 是原样复制的。
- [ ] stdout 只输出信封；面向用户的文字是中文。
- [ ] 同步上游时，已更新 `src/platforms/<p>/UPSTREAM`；映射有变化时，已更新 `docs/upstream-map.md`。
- [ ] 新增依赖在全部目标系统（AGENTS 7.2）上都有预编译包，没有 install 脚本，也不需要 node-gyp。
- [ ] 做过真机验证的，写明验证了哪些命令、结果如何；新发现的限制记进 `docs/trouble.md`。

## 9. 凭证安全红线

以下几条没有例外（AGENTS 8）：

- **严禁**把真实 cookie、token、私钥、证书写进代码、测试 fixture、对拍数据、日志、issue、PR 或提交记录。
- 凭证只存在本机的 `~/.catbus/`，只由 core 读写。平台实现从 core 拿凭证，更新后交回 core 落盘。
- 日志一律走 logger，它会给 cookie、token、Authorization、密码等字段打码。不要用 `console.log` 或 `process.stdout.write` 输出调试信息。
- 在线测试的报告 `.e2e/<p>.json` 里有真实账号返回的数据，不进版本控制，也不要贴到 issue 里。
- 贴 `-v` 的调试日志之前，自己再检查一遍有没有漏掉的敏感信息。

发现安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开发 issue。

## 10. 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。
