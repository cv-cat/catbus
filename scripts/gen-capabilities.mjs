// 由注册表生成 docs/capabilities.md。先 npm run build。
import { writeFileSync } from 'node:fs'
import { renderCapabilities } from '../dist/core/capabilities.js'
import { PLATFORMS } from '../dist/platforms/index.js'

const file = new URL('../docs/capabilities.md', import.meta.url)
writeFileSync(file, renderCapabilities(PLATFORMS))
console.error('[gen:capabilities] 已更新 docs/capabilities.md')
