# CLAUDE.md

@AGENTS.md

## Claude Code 补充

- 在项目根目录 `D:/works/git_projs/All-In-One` 下工作。Bash 里不要 `cd`，它会改变会话的工作目录；改用绝对路径或 `git -C <dir>`。
- `references/` 是上游的只读副本：可以读，也可以运行（生成对拍数据），但不能修改其中受版本控制的文件。
- 当前阶段见 AGENTS.md 第 2 节。改规范时先改 AGENTS.md，再改代码。
- 移植或修改平台时，照 `src/platforms/bilibili/web/` 的结构写，并补对拍（AGENTS.md 7.5）。测试默认禁止联网（`tests/setup.ts`）。
