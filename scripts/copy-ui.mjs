import { cpSync, existsSync, mkdirSync } from 'node:fs'

// Web 面板（AGENTS 4.13、7.1）：tsc 只编译 TS，页面、样式、吉祥物和平台图标在这里复制到 dist/ui/app/。
const root = new URL('../', import.meta.url)
const out = new URL('dist/ui/app/', root)
mkdirSync(new URL('img/platforms/', out), { recursive: true })

for (const file of ['index.html', 'style.css']) cpSync(new URL(`src/ui/app/${file}`, root), new URL(file, out))

const MASCOT = { 'mascot.png': 'assets/logo.png', 'bus.png': 'assets/stickers/bus.png', 'plane.png': 'assets/stickers/plane.png' }
for (const [name, source] of Object.entries(MASCOT)) cpSync(new URL(source, root), new URL(`img/${name}`, out))

// 平台图标与注册表对账：注册表里的每个平台都要有图标（来源见 scripts/assets/logos/SOURCES.txt）
const { PLATFORMS } = await import(new URL('dist/platforms/index.js', root).href)
for (const { id } of PLATFORMS) {
  const source = new URL(`scripts/assets/logos/${id}.jpg`, root)
  if (!existsSync(source)) throw new Error(`缺少平台图标：scripts/assets/logos/${id}.jpg`)
  cpSync(source, new URL(`img/platforms/${id}.jpg`, out))
}
