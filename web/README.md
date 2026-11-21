# catbus WebUI（开发中）

catbus 的本地图形界面：左侧选渠道，右侧搜索结果瀑布流，亮色 / 暗色主题。架构说明见 [AGENTS.md 7.9](../AGENTS.md)。

用户直接运行 `catbus web`（`--demo` 演示数据、`--headless` 不开浏览器、`--detach` 后台运行、`--port` / `--host`，见 `catbus web --help`）：npm 包里带着构建好的前端。

开发：

```bash
npm run build       # 在仓库根目录：编译 catbus 和 bridge（src/webui/），dev server 从 dist/webui/ 加载 bridge
cd web && npm install
npm run dev         # http://127.0.0.1:5174；改了 src/webui/ 要在根目录重新 npm run build

npm run build:web   # 在仓库根目录：构建前端到 dist/webui/app/，之后 node dist/cli/main.js web 就能用
```

- 没有编译好的 catbus、也找不到 PATH 里的 `catbus` 时，自动用演示数据；地址加 `?demo` 可强制使用演示数据。
- 主题跟随系统，右上角可以切换，选择保存在浏览器里。
