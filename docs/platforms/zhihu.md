# 知乎（web 端）

| | |
|---|---|
| id / 别名 | `zhihu` · `zh` |
| `item` 指 | 内容 |
| 登录 | **cookie** |
| 移植基线 | master 上的 [`0c5ce8e`](https://github.com/cv-cat/ZhihuApis/commit/0c5ce8e2a5f9d7108d34a525a6fb782309818652)，记录在 [`src/platforms/zhihu/UPSTREAM`](../../src/platforms/zhihu/UPSTREAM) |

当前是登录能力的最小切片：只确认浏览器 Cookie 能否被 CatBus 安全导入、在线校验和读取当前账号；内容、评论与发布尚未移植。

## 登录

知乎只支持从已经登录的 `www.zhihu.com` 浏览器会话导入 Cookie。Cookie 必须同时包含：

- `d_c0`：上游 `x-zse-96` 签名需要；
- `z_c0`：登录会话。

从 DevTools → Network 里选择一个 `www.zhihu.com` 请求，复制请求头中的完整 `Cookie`。不要用 `document.cookie`，它拿不到 HttpOnly Cookie。优先通过文件或 stdin 导入，避免留在 shell 历史：

```bash
catbus zhihu auth login --cookie @zhihu-cookie.txt
# 或
cat zhihu-cookie.txt | catbus zhihu auth login --cookie -
```

登录时会请求知乎网页自身使用的 `GET /api/v4/me` 在线校验；无效或过期时返回 `AUTH_REQUIRED`，不会保存凭证。导入成功后可检查：

```bash
catbus zhihu auth status
catbus zhihu user get me
```

Cookie、在线测试输出和 `~/.catbus/` 下的凭证都只应留在本机，不要贴到 issue、PR 或日志里。

## 已实现

- `auth login`：Cookie 导入并在线校验；
- `auth status`：在线确认当前 Cookie 是否仍然有效；
- `user get me`：读取当前账号并输出统一 `User` 结构。

## 已知限制

- `user get` 当前只支持 `me`；查询其他用户返回 `UNSUPPORTED`。
- 上游 ZhihuApis 的文章 / 回答评论和 `x-zse-96` 签名尚未移植；本切片不声明对应命令。
- 不支持扫码、短信或账密登录，也不读取浏览器配置；Cookie 由用户本人导入。
- `auth status.expires_at` 当前为 `null`；以在线校验结果为准。
