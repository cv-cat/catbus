# 快速上手

从安装到导出第一批数据，大约 5 分钟。每一步的细节见文末链接的专题文档。

## 1. 安装

需要 Node `^22.22.2 || ^24.15.0 || >=26.0.0`。不需要 Python、编译器或其他系统依赖，支持 Windows、macOS、Linux 的 x64 与 arm64（Linux 含 glibc 和 musl）。

**从源码安装（现在）**：

```bash
git clone https://github.com/cv-cat/catbus.git
cd catbus
npm ci
npm run assets:jd     # 取回京东验证码模型（约 81 MB）
npm run assets:ocr    # 取回验证码 OCR 模型（约 34 MB，B 站极验点选在用）
npm run build
npm link              # 把 catbus 命令链接到全局
```

两个模型包的模型文件不进 git，`npm ci` 之后要用上面两条命令取回，否则 `catbus doctor` 会报模型文件缺失。只用不到京东和 B 站验证码的平台时可以先跳过，但建议都装上。

**从 npm 安装（即将发布）**：

```bash
npm i -g catbus-cli
```

npm 包发布后，模型包 `@cv-cat/catbus-assets-jd`、`@cv-cat/catbus-assets-ocr` 会作为依赖一起装上，装完即可离线使用。

## 2. 检查环境

```bash
catbus version
catbus doctor
```

`doctor` 逐项检查 Node 版本、`~/.catbus` 的权限、签名 vm、HTTP 库、canvas、onnx 和两个模型包，每项输出 `{name, ok, message}`。有一项不通过时退出码为 1，看 `message` 里的提示处理。

```bash
catbus doctor | jq -r '.data[] | select(.ok | not) | "\(.name): \(.message)"'
```

## 3. 登录

web 端不登录几乎看不到内容，所以除 `auth` 以外的命令都需要先登录。以 B 站为例：

```bash
catbus bilibili auth login
```

二维码画在终端（stderr）里，同时存了一张 PNG（路径在提示里）。用 B 站 App 扫码、在手机上确认即可。

各平台支持的登录方式不同：

| 登录方式 | 平台 |
|---|---|
| 扫码（默认） | xhs、douyin、bilibili、kuaishou、xianyu、jd |
| 只能导入浏览器 cookie | tiktok、weibo、taobao、x |

只能导入 cookie 的平台：

```bash
catbus weibo auth login --cookie "<从浏览器复制的完整 Cookie>"
```

cookie 要从 DevTools → Network 里某个请求的请求头复制，`document.cookie` 拿不到 HttpOnly 的关键 cookie。详见 [login.md](login.md)。

确认登录态：

```bash
catbus bilibili auth status
```

## 4. 第一条查询

```bash
catbus bilibili item get BV1xx411c7mD
```

stdout 上是一个 JSON 信封，`data` 是归一化的 Item：

```json
{
  "ok": true,
  "platform": "bilibili",
  "endpoint": "web",
  "resource": "item",
  "action": "get",
  "account": "default",
  "data": { "id": "BV1xx411c7mD", "kind": "video", "url": "https://www.bilibili.com/video/BV1xx411c7mD", "title": "...", "...": "..." },
  "page": null,
  "error": null
}
```

命令的规律是 `catbus <platform> <resource> <action>`，所有平台同一套词：笔记、视频、商品都叫 `item`，搜索都叫 `search`。

```bash
catbus bilibili item search 猫
catbus bilibili user get me
catbus bilibili comment list BV1xx411c7mD
```

不知道某个平台支持什么时：

```bash
catbus bilibili --help              # 该平台的全部命令，带 ○ 的是规划中
catbus bilibili item search --help  # 参数、选项、筛选取值
catbus platforms bilibili           # 同样的信息，JSON 格式
```

全部平台的能力矩阵见 [capabilities.md](../capabilities.md)。

## 5. 分页

列表命令默认只取一页，信封里带 `page`：

```json
"page": { "cursor": "2", "has_more": true }
```

```bash
catbus bilibili item search 猫 --limit 100          # 自动翻页，取满 100 条
catbus bilibili item search 猫 --cursor 2           # 从上次的 page.cursor 继续
catbus bilibili user items me --all                 # 翻到没有更多
```

翻页间隔由 catbus 按平台控制，不需要自己加延时。

## 6. 导出 jsonl

数据量大时用 `-o jsonl`：stdout 每行一条数据，边翻页边输出；结束时 stderr 最后一行是摘要信封（带 `page` 和 `error`）。

```bash
catbus bilibili item search 猫 --limit 500 -o jsonl > items.jsonl 2> run.log
wc -l items.jsonl
tail -n 1 run.log | jq '.page'           # 下一页的游标
jq -r '[.id, .title, .stats.views] | @tsv' items.jsonl
```

## 下一步

- [login.md](login.md)：各平台登录方式、cookie 导入、多账号、子站点
- [output.md](output.md)：信封、归一化类型、分页、退出码与错误处理
- [configuration.md](configuration.md)：代理、超时、数据目录
- [faq.md](faq.md)：常见问题
