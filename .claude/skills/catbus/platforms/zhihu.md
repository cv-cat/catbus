# 知乎（zhihu）

| | |
|---|---|
| id / 别名 | `zhihu` · `zh` |
| `item` 是 | 内容 |
| 登录 | **cookie 导入**，必须含 `d_c0` 与 `z_c0` |

## 能做

- **读**：`user get`（目前参数只支持 me），读取当前登录账号。
- **登录检查**：可以导入浏览器 Cookie，并在线确认登录态是否有效。

## 做不到

- 查询其他用户；读取内容、回答、文章、视频或评论；发布、点赞、关注、收藏、私信等都尚未移植。
- 不支持扫码、短信或账密登录。

## 登录

让用户本人在已经登录知乎的浏览器中，从 DevTools → Network 复制 `www.zhihu.com` 请求头里的完整 Cookie。优先使用文件或 stdin：

```bash
catbus zhihu auth login --cookie @zhihu-cookie.txt
catbus zhihu auth status
```

不要索要、读取或回显用户的 Cookie；不要把在线测试输出贴进 issue / PR。

## 坑

- `document.cookie` 拿不到全部 HttpOnly Cookie，必须复制 Network 请求头。
- 缺少 `d_c0` 或 `z_c0` 会在联网前报 `USAGE`。
- 当前用户以外的参数会报 `UNSUPPORTED`；不要换别的平台或网页抓取来凑结果。
