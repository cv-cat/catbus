# 即梦（web 端）

| | |
|---|---|
| id / 别名 | `jimeng` / `dreamina` · 端：web |
| `item` 是 | 作品 |
| 登录 | 浏览器授权（`--method oauth`），只支持 macOS，需要先装好即梦官方 CLI `dreamina` |

catbus 不调用即梦的网页接口，只保存和切换官方 CLI `dreamina` 的登录态。出图、出视频、查任务、查积分都直接用 `dreamina`。

## 能做

- 登录一个即梦账号并保存在账号名下：`catbus jimeng auth login -a <名字>`。命令会在 stderr 打出授权链接，用户在已登录即梦的浏览器里打开并点「同意」。
- 切换 `dreamina` 当前使用的账号：`catbus jimeng auth use <名字>`，之后直接运行 `dreamina ...` 就是这个账号。
- 查看保存的账号、在线校验、登出：`catbus jimeng auth list`、`catbus jimeng auth status -a <名字>`、`catbus jimeng auth logout -a <名字>`。

## 做不到

- 生成图片和视频、查任务结果：直接用 `dreamina`，catbus 没有对应命令。
- 两个账号同时跑 `dreamina`：钥匙串里同一时间只有一个账号。
- macOS 以外的系统。

## 坑

- `dreamina` 只允许即梦会员调用生成命令；非会员账号能登录、能查积分，但不能生成。登录时会提示。
- 第一次登录某个账号，浏览器里必须已经登录了这个即梦账号（即梦网页支持抖音扫码、手机号和飞书登录）。
- `dreamina` 会自己刷新 token 并改写钥匙串。catbus 每次切换前会把钥匙串里的最新内容存回所属账号，所以不要绕过 catbus 用 `dreamina login` 换账号，否则新登录的账号没有保存，下次切换时会被覆盖。

## 示例

```bash
catbus jimeng auth login -a work        # 打开 stderr 里的链接，授权
catbus jimeng auth login -a personal
catbus jimeng auth use work
dreamina user_credit                     # work 账号的积分
catbus jimeng auth use personal
dreamina text2image --prompt "一只橘猫" --resolution_type 2k
```
