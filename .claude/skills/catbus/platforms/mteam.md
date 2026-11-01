# M-Team（web 端）

| | |
|---|---|
| id / 别名 | `mteam` / `mt` `m-team` `mantou` |
| `item` 是 | 种子资源 |
| 登录 | 官方 API Key（`apikey`）；TTY 隐藏输入，或 `--api-key-file` / `--api-key-stdin` |

## 能做

- `user get`：当前用户资料，只支持 me。
- `feed list`：浏览最新资源。
- `item search`、`get`、`categories`、`download`：搜索、详情、分类、下载 `.torrent` 文件。

## 做不到

- 发布资源、评论、收藏、签到、上传及 BT 客户端管理。
- 查询其他用户资料；app / pc 端尚未实现。

## 坑

- Key 在 MT 的“控制台 → 实验室 → 存取令牌”生成。让用户在本地隐藏输入或提供凭证文件路径，不要要求粘贴 Key，不读出或打印保存的令牌。
- 搜索 / 浏览支持 `--mode normal|movie|tvshow|music|anime|adult`、`--category <ID>`、`--free`，不提供通用排序或内容类型筛选。
- 资源返回 `Torrent`，含大小、文件数、做种人数、下载人数、完成人次和优惠信息。分页沿用 `--limit` / `--all` / `--cursor`。
- 下载只保存种子文件；可能含个人 Tracker 凭证，不展示、转发或上传种子文件。临时下载地址不会写入 JSON 或日志。
- 遇到风控或 Key 失效时读错误提示，让用户处理后重试。

## 示例

```bash
catbus mteam auth login --api-key-file /私有目录/mteam-key.txt
catbus mteam feed list --limit 5
catbus mteam item search 纪录片 --free --limit 20
catbus mteam item get https://kp.m-team.cc/detail/12345
catbus mteam item download 12345 --dir ./torrents
```
