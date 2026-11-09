# 即梦（web 端）

| 项 | 值 |
|---|---|
| 平台 id | `jimeng`（端：web） |
| 别名 | `dreamina` |
| `item` 指 | 作品（目前没有 item 命令） |
| 上游仓库 | 无（封装即梦官方 CLI `dreamina` 的登录态） |
| 接口来源 | 记录在 [`src/platforms/jimeng/UPSTREAM`](../../src/platforms/jimeng/UPSTREAM) |
| 端 | web ✓ · app ○ 规划中 · pc ○ 规划中 |
| 命令（web） | 已实现 5 条（✓ 5 · ◐ 0），规划中 ○ 0 条 |
| 系统 | 只支持 macOS；需要先装好 `dreamina`，`dreamina -h` 能运行 |

即梦官方 CLI `dreamina` 能出图、出视频、查任务和积分，但同一时间只能登录一个账号，换账号要重新在浏览器里授权。catbus 给它补上多账号：每个账号登录一次，之后用 `auth use` 切换。

**刻意边界**：catbus 不调用即梦的网页接口，也不注册生成、查询类命令。出图、出视频、查任务、查积分都直接运行 `dreamina`，用的是 catbus 当前账号的登录态。规范见 [AGENTS.md 5.6](../../AGENTS.md#56-代管外部-cli-的登录态)。

## 登录

```bash
catbus jimeng auth login -a work
```

- 只有浏览器授权一种方式（`--method oauth`，默认）。命令在 stderr 打出授权链接，在**已登录要保存的那个即梦账号**的浏览器里打开，点「同意」。授权链接约 10 分钟有效，命令会一直等到授权完成或链接过期。
- 登录哪个账号由浏览器里当前登录的即梦账号决定。要保存第二个账号，先在浏览器里换成第二个账号再打开新的链接。
- `dreamina` 只允许会员调用生成命令。非会员账号能登录、能查积分，登录时 stderr 会提示。
- 登录会先清掉 `dreamina` 原来的登录态。如果那个登录态还没有保存到 catbus 的任何账号下，stderr 会警告它将被覆盖；想保留它，就先用 `auth login` 把那个账号也登录一遍。

## 切换与使用

```bash
catbus jimeng auth login -a work        # 打开 stderr 里的链接，用 work 账号授权
catbus jimeng auth login -a personal    # 浏览器换成 personal 账号后，再打开新的链接授权
catbus jimeng auth use work
dreamina user_credit                    # work 账号的积分
catbus jimeng auth use personal
dreamina text2image --prompt "一只橘猫" --resolution_type 2k   # 用 personal 账号的积分
```

- `auth use <账号>` 把这个账号的登录态写进 `dreamina` 的存储（macOS 钥匙串），之后直接运行 `dreamina` 就是这个账号。
- `auth status -a <账号>` 用 `dreamina user_credit` 在线校验这个账号，结束后切回当前账号。
- `auth list` 只读本地记录，不联网。即梦账号没设昵称时 `user.name` 为 `null`，按 `user.id` 区分。
- `dreamina` 会自己刷新 token 并改写钥匙串。catbus 每次切换前，先把钥匙串里的最新内容存回它所属的账号，所以切换不会丢掉刷新后的 token。

## 支持的命令

✓ 已实现。

| 命令 | 状态 | 说明 |
|---|---|---|
| `auth login` | ✓ | 浏览器授权（`oauth`），保存 `dreamina` 的登录态。 |
| `auth status` | ✓ | 用 `dreamina user_credit` 在线校验。 |
| `auth list` | ✓ | 本平台、本端的账号（由 core 提供）。 |
| `auth use` | ✓ | 切换当前账号，同时把登录态写进钥匙串（由 core 提供，平台钩子写钥匙串）。 |
| `auth logout` | ✓ | 删除本地凭证；钥匙串里正是这个账号时，同时运行 `dreamina logout`。 |

## 已知限制

- 同一时间只有一个账号生效，不能两个账号同时运行 `dreamina`。定时任务和手动操作共用同一个当前账号，切换后记得切回。
- 不要绕过 catbus 用 `dreamina login` / `relogin` 换账号：新登录的账号没有保存在 catbus 里，下次 `auth use` 时会被覆盖。
- 只支持 macOS。其他系统上 `dreamina` 的凭据存储还没有适配，执行报 `UNSUPPORTED`。
- 找不到 `dreamina` 命令时报 `ERROR`，提示先安装即梦官方 CLI。
