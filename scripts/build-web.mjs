// 构建 WebUI 前端到 dist/webui/app/（AGENTS.md 7.9），随 catbus-cli 发布。
// web/ 是独立的 npm 包：没有 node_modules 时先 npm ci。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../web/', import.meta.url))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(args) {
  const r = spawnSync(npm, args, { cwd: web, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!existsSync(new URL('../web/node_modules/', import.meta.url))) run(['ci'])
run(['run', 'build'])
