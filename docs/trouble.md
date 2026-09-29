# 真机验证：未解决的问题

记录 2026-09-28 起真机验证中**没能跑通**的命令、原因，以及可选的解决办法。已经修好的问题只在第 8 节列一行。

**分工**：标「待上游」的问题由上游仓库修复；上游修好后，catbus 按 AGENTS 7.5 的流程集成（前移 UPSTREAM、重新生成对拍数据、同步移植），再把状态改成「已集成」。catbus 这边不自行改上游的请求逻辑。

状态的含义：
- **待上游**：根因在上游（bug，或者缺少能力），catbus 等上游修复后集成；
- **已兜底**：catbus 这边能做的已经做了（报清楚错误、给出绕行办法），根本问题仍在；
- **不处理**：平台接口本身不提供，或者属于预期行为；
- **未测**：还没验证。

验证方式：
- `npm run test:e2e`：只读命令的在线测试，见 AGENTS 7.5；
- 手动执行写操作：发布一律用 `--visibility private`；点赞、收藏只对自己的作品做。

各平台的验证进度见 6.2。

## 0. 总览

| # | 平台 | 问题 | 性质 | 状态 | 现在 catbus 的表现 |
|---|---|---|---|---|---|
| 1 | douyin | 发布、评论、点赞、收藏需要 `dtrait_blob` | 平台风控，上游的纯算档案不被接受 | 已集成上游 fix-dtrait-blob（2026-09-29）；**发布仍失败**，上游扫码后立即发布也失败（1.6）；待上游 | 没有 blob 时按随包设备档案现算。发布：`create_v2` 仍返回 HTTP 200 空响应，报 `RISK_CONTROL`（登录态没被踢） |
| 2 | xhs | 扫码登录，手机确认后服务端要求人机验证（HTTP 471） | 平台风控，上游同样失败 | 待上游；catbus 已兜底 | 报 `RISK_CONTROL`（captcha），提示改用 cookie 导入 |
| 3 | xhs | 评论接口间歇性要求人机验证（HTTP 461） | 平台风控，概率性 | 待上游；catbus 已兜底 | 报 `RISK_CONTROL`（captcha），过几十秒到几分钟自己恢复 |
| 4 | bilibili | `danmaku list`：短视频只拿到前 2 分钟的弹幕，超过 6 分钟的视频直接失败 | 上游 bug | 待上游 | ≤ 6 分钟：结果**不完整且不报错**；> 6 分钟：报 `UPSTREAM`（HTTP 404） |
| 5 | 多个 | 部分归一化字段恒为空 | 上游接口不返回 | 不处理（要补需上游加接口） | 字段为 null |
| 6 | — | 写操作、长连接、部分平台还没测 | 未验证 | 未测（进度见第 6 节） | — |
| 7 | xhs | 测试笔记删不掉 | xhs `item delete` 上游没有（○） | 待手动删 | — |
| 8 | kuaishou | 滑块风控（400002）自动通过 | 上游指纹失效 | 已集成上游 feat/fix-slider-fingerprint-http2（2026-09-29）；真机只触发到一次、没过，原因没记下，之后 216 次请求没再触发 | 自动尝试一次，没过报 `RISK_CONTROL`（captcha），`detail.verify` 带服务端的回复 |
| 9 | kuaishou | 直播间的主播 id 不能当用户用 | 平台两套 id | 已兜底 | `Live.host` 的链接传给用户命令时报 `USAGE` 并说明 |

---

## 1. 抖音：写操作需要 `dtrait_blob`

### 1.1 dtrait_blob 是什么

抖音 web 端的高风险接口（发布、评论、点赞、私信、passport 登录）要求请求带一个 `x-tt-session-dtrait` 头，用来证明请求来自一台「真实、一致」的设备。它分两层：

**外层：`x-tt-session-dtrait` 头**，可以纯算。catbus 已经实现（`sessionDtrait`，对拍过）。

```
<pk1 版本>_<base64(RSA-PKCS1v15(公钥, aes_key_hex))>_<base64(iv + AES-128-CBC(payload))>

payload = {"dtrait":<设备特征 blob>,"timestamp":<秒>,"sdkVersion":"1.0.0.16","path":<请求的 pathname>}
```

- 公钥内置在抖音登录页的 JS 里（版本 `d0`）。AES key 和 IV 每次随机生成。
- `path` 是当前请求的路径，所以每个接口都要现算一次头。这也是为什么「抓一个完整的头复用」对发布无效。

**内层：`dtrait` 字段，也就是 dtrait_blob**：设备特征指纹，一段 base64，**必须由浏览器生成**。

```
[1 字节头][bool 位图 5 字节][34 条字符串特征，每条 5 字节 = tag + murmur3(特征串) 大端 4 字节]
```

它由字节的混淆 SDK `@byted/uc-secure-dtrait-core`（一个字节码虚拟机）在页面里采集生成。34 条特征分两类：
- **15 条可以纯算**：UA、语言、屏幕尺寸、时区、CPU 核数、内存、若干 `Math` 函数的结果等。上游 `utils/dtrait_features.py` 已经逆向出了算法。
- **19 条只能真实渲染得到**：canvas、WebGL、音频指纹、字体像素、CSS / DOMRect / SVGRect 的测量值等。浏览器实际画一遍才能拿到，Python 和 Node 都算不出来。

几个关键性质：
- **跟设备绑定，不跟登录会话绑定**：上游注释说，重新登录、换账号，这个 blob 照样有效。所以抓一次就能长期用。
- 上游的取法是从环境变量 `DY_DTRAIT_BLOB` 读。`.env.example` 和 README 都**没写这一项、也没写怎么抓**，只在代码注释里提了一句「暂时没法纯算复现」。
- 上游还支持 `dtrait_profile`：用一次抓到的 blob 反解出 19 条渲染类特征的哈希，再配上可纯算的字段，每次现算 blob（`profile_from_blob` + `build_blob`）。前提仍然是先抓到一次。

### 1.2 实测结果

| 操作 | 是否带 dtrait | 结果 |
|---|---|---|
| 扫码登录 | 不带 | 成功（passport 在没有 dtrait 时也放行了） |
| 只读命令（搜索、详情、评论、推荐流……） | 不带 | 全部正常 |
| `item like`（自己的作品） | 不带（catbus 对点赞不强制要求，缺了就不发这个头） | **HTTP 403，空响应**。之后 `auth status` 变成未登录，`item get` 报「用户未登录」，只能重新扫码 |
| `item publish`（仅自己可见的图文） | 不带（实验时临时去掉了本地拦截） | 前面 9 个请求都是 200：进创作者中心、上传凭证、上传图片、换客户端证书……最后的 `create_v2` 返回 **HTTP 200 空响应**，作品没发出去。这次会话没被踢 |
| `comment add` | — | 没测：catbus 在本地就拦下了（`requireCommentSecurity`） |
| `msg send`、`live send` | — | 没测。这两个接口会带 bd-ticket-guard 头，但不强制要求 dtrait，风险同点赞 |

结论：**不带 dtrait_blob，发布和点赞都不行，点赞还会连累登录态。** 上游作者对发布也写了硬性要求：`_require_publish_security` 在缺少时直接不发请求，注释写的是「禁止发送请求」。这和实测结果对得上。

实测只证明了「不带就不行」，没证明「带上就一定行」。后者要等抓到 blob 后再测。

### 1.3 为什么 catbus 自己拿不到

- 扫码 / 短信登录是纯 HTTP 流程，不运行抖音页面里的 JS，也就不会执行那个 SDK。
- 就算在 catbus 里用 jsdom 跑 SDK，jsdom 没有真实的 canvas、WebGL 和音频栈，采出来的是一台「不存在的设备」，大概率比不带更糟。
- 对比小红书：小红书的设备指纹 `b1` 上游随包带了一份采集模板，所以能纯算；抖音上游没有带类似的模板。

### 1.4 可选的解决办法

**A. 用户在浏览器里抓一次（上游设计的用法）**

1. 在 douyin.com 登录后，打开 DevTools → Console，贴下面这段，然后给任意作品点个赞（点完可以取消）：

   ```js
   (() => {
     const orig = JSON.stringify
     JSON.stringify = function (v, ...rest) {
       if (v && typeof v === 'object' && typeof v.dtrait === 'string' && !window.__catbus_dtrait) {
         window.__catbus_dtrait = v.dtrait
         console.log('[catbus] 抓到了，执行 copy(window.__catbus_dtrait) 复制')
       }
       return orig.apply(this, [v, ...rest])
     }
     console.log('[catbus] 已挂上：现在去点个赞')
   })()
   ```

   原理：SDK 加密前要用 `JSON.stringify` 组装 `{"dtrait":…,"path":…}`。**这段脚本还没实际验证过**，SDK 如果自带序列化或者缓存了原生函数，就抓不到，需要换别的办法（例如在 Sources 里给 `encryptData` 下断点）。

2. 导入。现在 catbus 只能通过 cookie JSON 导入，而且必须连 cookie 一起：

   ```bash
   catbus douyin auth login --method cookie --cookie @dy.json
   ```

   `dy.json` 的格式是 `{"cookie": "<浏览器的完整 Cookie>", "dtrait_blob": "<抓到的 blob>"}`。

3. 然后再扫码登录一次。扫码登录会继承同名账号已有的 `dtrait_blob`，同时拿到 catbus 自己的 ticket / 私钥（发布必须和 cookie 同一次登录）。

**缺口**：没有单独「给现有账号补一个 blob」的命令，这个流程很绕。建议新增，例如 `catbus douyin auth login --method cookie` 接受只含 `dtrait_blob` 的 JSON，只补设备素材、保留现有会话。改之前要先在 AGENTS 5.3 登记。

**B. 纯算生成 blob**

用上游已经逆向出来的 `build_blob`：15 条可算特征现算，19 条渲染类特征用**一份固定的设备档案**（从某一台真实设备抓一次，随包分发，类似小红书的 b1 模板）。
- 好处：用户完全不用抓。
- 风险：所有 catbus 用户共用同一份渲染指纹，平台可能据此识别并批量封禁；而且要拿真实账号验证服务端认不认。
- 工作量：移植 `dtrait_features.py`（约 220 行），加上对拍。

**C. 暂时只读**：抖音停在只读，写操作文档标明需要 blob。

### 1.5 建议

1. **先加保护**，不管选哪个方案：没有 `dtrait_blob` 时，抖音的点赞、收藏、私信、直播发言也在本地拦下，报 `AUTH_REQUIRED` 并说明怎么导入，不发请求，避免用户一试就被踢下线。现在只有发布和评论会拦。这会偏离上游的行为（上游对点赞不强制要求），需要确认。
2. 先试方案 A 抓一次，验证「带上 blob 能发」；再决定要不要做方案 B。

---

### 1.6 集成上游 fix-dtrait-blob 后（2026-09-29）

上游在 `fix-dtrait-blob` 分支（94c744b，尚未合进上游 master）采用了 1.4 的方案 B：随包带一份从 Chrome 153 取证的设备档案（`utils/dtrait_profile.json`），没有 `DY_DTRAIT_BLOB` 时用 `build_blob` 现算内层 blob。catbus 已同步（`static/douyin/dtrait_profile.json`、`web/dtrait.ts`），对拍逐字节一致；凭证里的 `dtrait_blob` 仍然优先，也可以导入自己的 `dtrait_profile`。

移植时发现的一个细节：档案里的 Math 指纹（`str_11` / `str_12`）要和浏览器逐位一致，而 macOS 的 `tan(-1e300)` 与 Chrome 差 1 ULP，Node 24 自带的 V8 在 `atanh` / `log` / `expm1` 上也和 Chrome 153 各差 1 ULP。所以上游测试在 macOS 上会失败；catbus 把这 7 个结果写成 Chrome 的常量（入参本来就是字面常量）。建议上游同样改成常量。

真机结果（同一个账号，扫码登录后第二天）：

| 做法 | 结果 |
|---|---|
| catbus，默认档案，`item publish --visibility private`（图文） | 上传图片成功，`create_v2` 仍返回 **HTTP 200 空响应**，登录态没被踢 |
| catbus，档案的 UA 改成与请求一致的 Chrome 151（档案是 153） | 同上，所以不是 UA 不一致导致的 |
| **上游 Python（fix-dtrait-blob）**，用同一份 cookie / ticket / ts_sign / 私钥构造 `DouyinAuth.from_cookie`，`post_images(visibility=1)` | **同样失败**：「发布接口返回非 JSON（HTTP 200）」 |

| **上游 Python（fix-dtrait-blob），扫码登录后在同一进程里立即发布**（照 `quick_publish.py`：`DouyinAuth.from_qrcode_login(bootstrap_creator=True)` → `post_images(visibility=1)`） | **同样失败**：扫码成功，图片上传成功，`create_v2` 返回 HTTP 200 空响应。发布前的安全检查（ticket / ts_sign / 私钥齐全、与 Cookie 同一次登录）都通过了 |

扫码时上游还打了两条警告，可能相关：「未捕获当前浏览器 fpk1，已使用项目内 FingerprintJS fixture 纯算」「challenge template 没产出 p_in，沿用伪造值」。

结论：**不是会话过期，也不是 catbus 移植的问题**。上游这个分支在新登录的会话上也发布不了，随包的设备档案（或 fpk1 / p_in 等其他伪造值）没被服务端接受。已反馈上游，状态仍为待上游。

## 2. 小红书：扫码登录被要求人机验证（HTTP 471）

**现象**：扫码、在手机上确认之后，最后一步 `GET /api/sns/web/v1/login/qrcode/status` 返回：

```
HTTP 471
verifytype: 120
verifyuuid: <uuid>
access-control-expose-headers: VerifyType, VerifyUuid
body: {"code":0,"success":true,"msg":"成功","data":{}}
```

**已确认是上游本身的问题，不是移植问题**：用上游 Spider_XHS（基线 `ebb6c4f`）的 `qrcode_login()` 走同样的流程，在同一步拿到同样的 471，上游报错「二维码状态检查失败: 成功」。catbus 的请求与上游逐字节一致（有对拍）。

**原因**：小红书在扫码确认后要求这次登录做一次人机验证。`verifytype 120` 对应哪种验证（滑块、旋转，还是短信二次验证）还没查。多半是「新设备登录」触发的风控：catbus 和上游每次登录都生成一个全新的匿名设备（新的 `a1` / `webId`）。浏览器遇到 471 会弹验证页，验证通过后再重试；上游和 catbus 都没有实现这一步。

**现在的处理**：
- 报 `RISK_CONTROL`，`detail = {kind: 'captcha', status: 471, verify_type: '120', verify_uuid}`；
- `hint` 提示改用 cookie 导入：`catbus xhs auth login --method cookie --cookie "<Cookie>"`（要从 Network 面板复制完整的 Cookie 请求头，`web_session` 是 HttpOnly 的，`document.cookie` 里没有）。
- cookie 导入实测可用，创作者中心也能从主站登录态自动换出来（见第 8 节）。

**要彻底解决**：抓一次浏览器遇到 471 时的完整验证流程（验证页的接口、`verifytype 120` 对应的验证码类型），看能不能自动通过。按约定要先修到上游 Spider_XHS。

---

## 3. 小红书：评论接口间歇性要求人机验证（HTTP 461）

**现象**：`comment list` 有时返回 `HTTP 461`，`verifytype: 124`，其余接口不受影响。

**实测规律**：
- 请求模式「紧凑」时容易触发。例如 `live list` 之后 5 秒请求评论，被拦；等 26 秒、66 秒再请求，正常。
- 用没开通蒲公英的账号访问蒲公英接口、被拒之后，评论接口必然触发。蒲公英 / 千帆已经从 catbus 删除，见 AGENTS 4.12。
- 标记持续时间从二十几秒到约 4 分钟不等，到时间自己恢复。
- 不是 catbus 的进程内状态问题：换独立进程、换 HTTP 连接，结果都一样。同样的操作序列时好时坏，所以是服务端按近期请求模式打分的概率性风控，找不到一个确定的触发条件。

**现在的处理**：报 `RISK_CONTROL`（captcha），带 `verify_uuid`。在线测试把风控记为跳过，小红书的命令间隔 4 秒。

**可能的改进**（都还没做）：
- 小红书的列表类命令翻页时（`--limit` / `--all`）适当拉长间隔；
- 和第 2 节一起研究验证码能否自动通过。

---

## 4. B 站：弹幕只取到前 2 分钟，超过 6 分钟直接失败（上游 bug）

**现象**：`danmaku list` 对超过 6 分钟的视频报 `UPSTREAM`（HTTP 404）；对 6 分钟以内的视频**只返回前 2 分钟的弹幕，而且不报错**。

**原因**：上游 BilibiliApis 的 `get_danmaku_seg`（`apis/bili_apis.py`）不论取第几段，都固定带着 `pull_mode=1&ps=0&pe=120000`。这组参数是播放器首屏按毫秒区间分批拉第 1 段用的：
- 第 1 段带上它，只返回 0～120 秒；
- 第 2 段起带上它，服务端返回 404。

catbus 忠实移植了这个请求。catbus 原来还有一个问题：没检查二进制响应的状态码，把 404 页面当 protobuf 解，报了看不懂的「wire type 4」。这个已经修了，现在报 `UPSTREAM`（HTTP 404）。

**实测对比**（同一个 12 分钟的视频）：

| 请求 | 结果 |
|---|---|
| 第 1 段，带 `ps=0&pe=120000` | 51 条，0～117 秒 |
| 第 1 段，不带 | 101 条，0～356 秒 |
| 第 2 段，带 | **404** |
| 第 2 段，不带 | 33 条，366～716 秒 |
| catbus 去掉这组参数后（登录态） | 526 条，0～737 秒，完整 |

**修复**：删掉这组参数。上游的修复已经在本机准备好了，在 `/tmp/upstream/BilibiliApis` 的 `fix/danmaku-seg-range` 分支上（commit `48d1d02`），**还没推送**。`/tmp` 重启会被清空，补丁内容如下：

```diff
--- a/apis/bili_apis.py
+++ b/apis/bili_apis.py
@@ -237,9 +237,10 @@ class BiliApi:
         headers = HeaderBuilder.build(HeaderType.GET, accept='*/*').set_referer(
             f'{BiliApi.main}/').get()
+        # 不带 pull_mode / ps / pe：那是播放器首屏按毫秒区间分批拉第 1 段用的，
+        # 带上 ps=0&pe=120000 时第 1 段只返回前 2 分钟，第 2 段起返回 404
         params = Params({
             'type': 1, 'oid': cid, 'pid': aid, 'segment_index': segment_index,
-            'pull_mode': 1, 'ps': 0, 'pe': 120000,
         }).with_web_location('1315873').with_wbi(auth)
```

**状态**：待上游。上游修好后 catbus 集成：前移 UPSTREAM、重新生成对拍数据、改 `src/platforms/bilibili/web/api.ts` 的 `danmakuSeg`。

---

## 4a. 快手：滑块风控没有自动通过（catbus 漏移植）

**现象**：连续请求作品详情、评论等接口时，快手返回 `result: 400002`，要求过滑块（`captcha.zt.kuaishou.com`，`bizName=ANTICRAWL_COMMON`）。在线测试里命令间隔 1.5 秒时，`item get`、`item media`、`comment list` 都触发了。等 30 秒以上仍未恢复。

**原因**：**上游能自动过这个滑块，catbus 移植时漏了**。上游 `KuaishouAPI._pass_captcha` 在 REST（`_post` / `_get`）和 GraphQL 三处遇到 400002 时自动过一次滑块，然后重发原请求。整条链是：
1. 拉滑块配置、下载背景图和滑块图；
2. 找缺口（图像处理，上游用 numpy + Pillow）；
3. 生成拟人的滑动轨迹；
4. gdfp manMachine 预检（人机指纹）；
5. `$encrypt` 加密，提交 `kSecretApiVerify`。

涉及 `utils/captcha.py`、`utils/captcha_fp.py`、`utils/gdfp_manmachine.py`、`utils/sign/captcha_crypto.py`（合计约 1700 行），以及 `builder/auth.py` 的 `prepare_captcha_context`。upstream-map 当初没列这部分，所以漏了。

**现在的处理**：报 `RISK_CONTROL`（captcha），`detail.url` 是滑块页地址。

**状态**：已补（2026-09-28），整条链有对拍；直播站、创作者中心的请求不自动过，与上游一致。

**真机结果（2026-09-28）：过不了，原因在上游。**
1. catbus 自己的 bug（已修）：真实下发的背景图是 **JPEG**，解码没等 `loadImage` 完成，画成全黑，缺口位置全错（服务端回 `350002 verify err`）。修好后缺口位置与上游一致（同一张图都是 490）。
2. 修好后服务端回 **`350014 anti check err`**：答案位置对了，但人机检查不认。用上游 Python 在同一个账号上跑，结果完全一样，所以不是移植问题。多半是上游随包的浏览器指纹（`captcha_fp.py` 的 gpuInfo / captchaExtraParam、gdfp 遥测里的 canvas / WebGL 哈希等，作者 2026-08-16 在自己机器上采的）已经不被接受，或者遥测里还缺什么。
3. ~~上游另有一个 bug：`is_http2` 把 HTTP/2 判错~~——**这条记录是错的**。curl_cffi 的 `http_version` 取自 libcurl 的 `CURLINFO_HTTP_VERSION`：`2` 是 HTTP/1.1，`3` 才是 HTTP/2。上游的判断是对的，报错说明那次 gdfp 请求实际协商的是 HTTP/1.1，而上游当时只接受 HTTP/2。catbus 没有做这项检查（wreq-js 拿不到协商出的协议版本）。

**集成上游 feat/fix-slider-fingerprint-http2（552cf60，2026-09-29，尚未合进上游 master）**：
- 滑块指纹换成新采的值（canvas / 音频哈希、窗口几何），key35 / key36 从每次随机改成稳定的浏览器哈希；UA、几何、WebGL 等统一取自一份浏览器档案，header、gdfp、captchaExtraParam 不再互相矛盾；
- gdfp 默认接受 HTTP/1.1（设 `KS_STRICT_GDFP_HTTP2=1` 才只认 HTTP/2），上游的流程不会再在提交前失败；
- 上游新增的 `set_captcha_fingerprint`（用浏览器现抓的指纹）只有 Python API，catbus 没有命令行入口，没移植。

catbus 已同步，对拍变化的 4 个用例逐字节一致。

**真机（2026-09-29）**：连续请求时触发过一次滑块，自动验证没过，但服务端的回复被后面的日志覆盖了，没能确定是不是 350014；之后连续 216 次请求（作品详情、评论）都没再触发，暂时无法复现。catbus 现在把服务端对 verify 的回复放进 `RISK_CONTROL` 的 `detail.verify`，下次触发时能直接看到原因。

**状态**：已集成，待复现确认。

## 4b. 快手：直播间的主播 id 不能当用户用

**现象**：`live get` 返回的 `host` 是 `https://live.kuaishou.com/u/<id>`，把它传给 `live replays`、`user get` 等用户命令会失败（「用户不存在」「参数格式错误」）。

**原因**：快手直播用的主播 id（快手号 / principalId）和主页用的 eid 是两套，主页接口查不到直播 id；直播间数据里也没有主页 eid。上游没有互查的接口。这与 AGENTS 4.8「输出对象的 url 可以直接作为下一条命令的参数」不符，但属于平台限制。

**现在的处理**：用户参数传直播间链接时报 `USAGE`，说明两套 id 的区别，提示改传主页链接。

**状态**：已兜底。要彻底解决，需要上游找到直播 id → eid 的接口。

## 5. 数据缺口：字段恒为空

不影响命令执行，但对应字段一直是 null。都是上游接口本来就不返回，不是归一化漏取。

| 平台 | 命令 | 空字段 | 原因 |
|---|---|---|---|
| bilibili | `user get` | `stats.followers / following / items / likes` | 上游只有 `get_user_info`（`/x/space/wbi/acc/info`），不含计数。计数在 `/x/relation/stat`、`/x/space/upstat`，上游没有 |
| bilibili | `item list` | `author.name` | 创作者中心的稿件列表只有 `mid`，`author` 字段是空字符串 |
| douyin | `item get` / `search` / 推荐流 | `title` | 抖音作品只有描述（`desc` → `text`），没有单独的标题 |
| douyin、xhs | 各列表 | `stats.views` | 公开接口不返回播放量 |
| xhs | `keyword hot` | `heat` | 热搜接口不给热度值 |
| kuaishou | `notice count` | 各分类计数 | 接口只返回总数 `unReadCount` |
| kuaishou | `user get` / `search` | `stats.*` | 资料接口不返回计数 |

可以考虑给 bilibili `user get` 补一个 `relation/stat` 请求，但这是上游没有的能力，要先改上游。

---

## 6. 还没测的

### 6.1 已验证平台里没测的命令

| 平台 | 没测 | 说明 |
|---|---|---|
| xhs | `msg send` / `read` / `revoke` / `delete`、`msg listen`、`live listen` / `send` | 私信需要指定一个收件账号；长连接要单独测 |
| douyin | `item like` / `unlike` / `collect` / `uncollect`（见第 1 节）、`item publish`（见第 1 节）、`comment add`、`msg send` / `listen`、`live send` / `like` / `listen`、`product get`、`item download`、`media upload` | 写操作都卡在 dtrait。`product get` 需要一个真实商品 id |
| bilibili | 全部写操作：`item like` / `collect` / `coin` / `triple` / `publish`、`comment add`、`danmaku send`、`dynamic publish` / `delete`、`article publish`、`live send` / `start` / `stop`、`media upload`；`live listen`、`item download` | 投币、三连会真的花掉硬币 |

### 6.2 各平台进度

| 平台 | 登录 | 只读命令 | 写操作 | 备注 |
|---|---|---|---|---|
| bilibili | 扫码 ✓ | ✓ 21 条通过 | 未测 | `danmaku list` 见第 4 节 |
| xhs | 扫码 ✗（第 2 节），cookie ✓ | ✓ 27 条通过（含创作者中心） | 发布 ✓（仅自己可见）、上传 ✓；私信未测 | 评论偶发 461，见第 3 节 |
| douyin | 扫码 ✓ | ✓ 20 条通过 | ✗ 缺 dtrait_blob（第 1 节） | |
| kuaishou | 扫码 ✓ | ✓ 18 条通过；`item get` / `media` / `comment list` 被滑块风控时跳过（第 4a 节） | 未测 | `feed list` 默认的 recommend 上游没有；hot ✓、following ✓ |
| xianyu | 扫码 ✓ | ✓ `auth status`、`user get me`、`media upload`（在线测试拿不到商品和会话 id，其余命令需要手动给参数） | 未测：私信会打扰真人，发布会上架真实商品 | `user get me` 的接口只返回 userId |
| jd | 扫码 ✓ | ✓ 14 条通过 | 未测 | 修了：登录后用户名乱码（响应是 GBK，core 改为按 charset 解码）、`comment list` 取成了问答、会话更新时间。`item get` 与评价接口被 605 / 403 风控拦住（新的 403 探测正确区分了风控与登录失效） |
| weibo、taobao、tiktok、x | cookie | 未开始 | 未测 | 需要从浏览器复制 cookie |

---

## 7. 测试留下的痕迹

| 平台 | 内容 | 处理 |
|---|---|---|
| xhs | 一篇仅自己可见的测试笔记「catbus 接口测试」，id `6aba1e6b000000001303e71a` | xhs 的 `item delete` 上游没有（○），需要在 App 里手动删，或者留着（只有自己能看到） |
| xhs | 通过 `media upload` 上传过一张测试图片（没有发布） | 无需处理 |
| douyin | 无：发布被拦截，没有作品生成；点赞没成功，不用取消 | — |

---

## 8. 本轮已修复（参考）

- bilibili：二进制接口检查 HTTP 状态，不再把错误页当 protobuf 解。
- xhs：
  - 创作者中心用主站登录态自动初始化，不用再扫码。这段移植时漏了上游的 `XHSCreatorAuth.from_pc_auth`。
  - 私信的会话 id、对方、消息列表、消息类型取错了字段。
  - 视频编码名混淆（`EF4` / `EF5`），同步自上游。
  - 471 / 461 报 `RISK_CONTROL`。
  - 蒲公英 / 千帆删除。
- douyin：
  - 通知类型取错：把请求时的分组号当成了通知类型。
  - 缺 `UIFID` 时自动请求推荐流取回再重试。上游 README 要求用户自己复制带 `UIFID` 的 cookie，实际它由推荐流的响应下发。
- kuaishou：
  - `item list`：`startTime: 0` 被服务端拒绝（「时间范围不能大于1年」），改为最近 365 天；翻页游标改用 `nextCursor`（原来会把最后一条重复返回、`--all` 死循环）。
  - 作品管理的列表：图集靠 `showAtlasIcon` 判断，补上作者。
- core：
  - `auth login` 信封的 `account` 为 null；
  - 二维码 PNG 权限改成 0600。

## 9. 待上游修复后集成

| 上游仓库 | 内容 | 对应章节 | 集成时 catbus 要做的 |
|---|---|---|---|
| DouYin_Spider | `dtrait_blob` 的获取方式：fix-dtrait-blob 分支已改为随包档案纯算，catbus **已集成**；但发布仍返回空响应，上游扫码后立即发布同样失败（见 1.6，扫码时上游警告 fpk1、p_in 用了伪造值）；另建议把 Math 指纹写成 Chrome 的常量（macOS 上上游测试会失败）；README 补上 `DY_DTRAIT_BLOB`、`UIFID` 由推荐流下发 | 1 | 等发布跑通后改状态 |
| Spider_XHS | 扫码后 471（verifytype 120）的验证流程 | 2 | 移植验证流程，去掉「改用 cookie」的兜底提示 |
| Spider_XHS | 评论 461（verifytype 124）的验证码 | 3 | 同上 |
| BilibiliApis | 弹幕分段去掉 `ps` / `pe` | 4 | 改 `danmakuSeg`，重新生成对拍数据 |
| KuaiShou-Spider | 滑块验证 `350014 anti check err`：feat/fix-slider-fingerprint-http2 分支刷新了指纹、放宽 HTTP 版本，catbus **已集成**；真机待复现确认（4a） | 4a | 复现确认后改状态 |
| DouYin_Spider | 综合搜索只发「已筛选」标记、不发筛选值（commit fe3eb24 删掉了），排序 / 时间筛选对综合频道不生效；catbus 照抄并在 stderr 提示改用 `--type video` | 10 | 移植修正后的请求 |
| BilibiliApis | 极验点选：下载第一张题图时把 B 站会话 cookie 也发给了 static.geetest.com（登录时只是匿名设备 cookie，已登录账号复用时会带出 SESSDATA） | 10 | 移植修正后的请求 |

## 10. 上游有、catbus 漏移植的（2026-09-28 审计）

逐个平台对照了上游的公开方法和自动机制（验证码、刷新、桥接）。下表是审计找到的缺口和处理状态；「移植中」的由各平台的实现分支补齐，合并后改成「已补」。

| 平台 | 缺口 | 状态 |
|---|---|---|
| kuaishou | 滑块自动通过（`_pass_captcha` 整条链：webweapon 验证码引导、缺口识别、轨迹、gdfp 预检、加密提交、重发原请求） | 已补，待真机验证 |
| kuaishou | `feed list --kind recommend`：上游 `get_feed_hot` 就是推荐流，catbus 错标成上游没有 | 已补（`hot` 取值去掉） |
| kuaishou | 服务端登出；发布后刷新发布状态；直播礼物全量 | 已补，待真机验证（发布状态与礼物字典的响应结构是推断的） |
| xhs | `keyword suggest`、`item search --time`、`user following`（只支持 me）、群聊会话与记录（id 为 `group:<群id>`）、视频发布填时长 / 宽高 / 帧率（MP4 解析抽到 `core/mp4.ts`）、创作者会话失效自动重新桥接、`live send` HTTP 报业务错误时改走长连、`msg read` 匹配会话的 bug | 已补，待真机验证（关注列表与群聊的字段名参考第三方代码，上游没有样本）。视频自动截首帧当封面不做（需要解码器，`--cover` 仍必填） |
| bilibili | 极验点选题自动识别（短信 / 密码登录降级时用；含人工兜底页面） | 已补，待真机验证通过率。模型在新包 `@cv-cat/catbus-assets-ocr`（ddddocr 1.6.1，MIT，25.5 MB），发布顺序在 catbus-cli 之前 |
| bilibili | `item related`、专栏搜索（`--type article`）、专栏 / 动态评论与按时间排序、楼中楼 `--root`、收藏到指定收藏夹（`--folder`）、投币同时点赞（`--like`）、投稿转载 / 动态文案 / 允许转载、专栏标签 / 摘要 / 只存草稿与 `draft get` / `delete`、弹幕样式、直播弹幕回复、按用户查直播间、直播全部事件与人气值、`user items --keyword`、推荐流翻页去重 | 已补，待真机验证（`draft/view`、`Related` 的响应结构与部分直播消息字段按文档写）。`item delete` 改 ◐：撤稿需要人机验证，验证码参数的来源上游没写，还没接上人工兜底 |
| douyin | 搜索筛选（`--sort` / `--time` / `--type`，`--type video` 走视频频道；私有 `--length` / `--range`）、用户搜索筛选、`item list`、发布参数（`--poi-name` / `--series` / `--hotspot` / `--no-download` / 图文 `--cover`）、收藏夹移动（`--folder`）、私信 `--file` / `--share`、`live history` / `live media`、千票榜、`live like --count`、商品评价 `--label`、通知 `--group`、短信 `--sso` | 已补，待真机验证（写操作仍受第 1 节 dtrait 限制）。不做：商品评价排序（上游没给取值）、表情包（上游没有表情列表接口） |
| tiktok | 收藏夹加内容（`folder add`）与公开 / 私密（顺带修了改名会把公开收藏夹变私密的 bug）、发布互动开关（`--allow-*`）、`item related` 与私信翻页、按房间号操作直播、`live media`、系统通知（group 661）并入 `notice list` | 已补，待真机验证。**私信翻页的游标字段位置是按字节 IM 协议推断的，上游没有解析**；`live media` 的流地址结构也是推断的 |
| x | 同步上游 3fe6ea7：长推（超 280 权重自动走 CreateNoteTweet）、`--thread`、`article publish` / `delete`；搜索媒体（`--type video\|image`）、引用（`--quote`，新的通用发布选项）、私信补对方资料 | 已补，待真机验证（长推和文章需要 Premium 账号）。**不做**：账号密码登录（依赖 Castle 反自动化令牌，登录方式只保留 cookie）；`msg list` 翻页（上游没有收件箱翻页接口，只取首页，标 ◐） |
| jd | 403 时区分登录失效与风控、订单时间范围（`--range`）、按订单咨询客服（`--order`）、评价条数（`--limit` → commentNum）、收货地区（`--area`）、国际手机号、`msg listen` 其余消息类型 | 已补，待真机验证（撤回消息的 id 字段名是推断的；评价条数的服务端上限未知）。`item related` 保持 ◐：diviner 的 `p` 只能从浏览器抓包得到 |
| xianyu | 主动给指定用户发私信（`--to`，可配 `--item`）、发布原价（`--original-price`）、`msg history` 同一条长连翻页并按从旧到新排列 | 已补，待真机验证。`--limit` 截在页中间时，游标是 `<这一页的起始游标>+<已输出条数>`，续翻时重取这一页、跳过已输出的（输出按从旧到新排列，不能用 core 的 `#skip=N`） |
| taobao | `msg history` 同一条长连翻页并按从旧到新排列 | 已补，待真机验证（游标推断同闲鱼） |
| weibo | 发布「粉丝可见」（新增 `--visibility fans` 标准取值）、`item search` 改标 ◐ | 已补。PC 端详情不移植：weibo.com 是单页应用，上游取的 `$CONFIG` 里没有正文 |
| core | 翻页游标重复时停止（`--all` 防死循环） | 已补 |

审计确认**不做**的（上游本身运行时拒绝发包、需要浏览器抓包的参数、需要视频解码器的自动截帧、词表里没有对应物的能力等），在各实现分支的报告里逐项说明，合并时汇总到这里。

## 11. 其他待办

- 首发：仓库还没有 `NPM_TOKEN` secret，npm 上的 `@cv-cat` org 状态未知。
- 本地提交还没推到 origin。
