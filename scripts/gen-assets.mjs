// 生成 README 用的图：assets/ 下的 svg 和 social-preview.png。先 npm run build。
// 素材：吉祥物 assets/logo.png（透明底的贴纸），平台图标 scripts/assets/logos/（来源见其中的 SOURCES.txt）。
// 字体都是 OFL，第一次运行时下载到 .cache/fonts/；图里的字全部转成轮廓，在任何系统上看起来都一样。
// 需要走代理时：NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 npm run gen:assets
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import * as fontkit from 'fontkit'
import { PLATFORMS } from '../dist/platforms/index.js'

const here = (p) => new URL(p, import.meta.url)
const OUT = here('../assets/')

// ───────────── 配色：取自吉祥物 ─────────────
const C = { navy: '#232838', red: '#E8414F', sky: '#4C7BE8', pill: '#1B2033', pillLine: '#30384F', pillText: '#F2F4FA', pillDim: '#7D859C', chip: '#2C3452' }
const THEMES = {
  light: { ink: '#232838', sub: '#6B7280', line: '#E3E7EF', card: '#FFFFFF' },
  dark: { ink: '#F1F3F9', sub: '#9AA3B5', line: '#2E3548', card: '#161B22' },
}

// ───────────── 随语言变化的文案 ─────────────
const LANGS = {
  en: { font: 'nunito', title: 'One CLI, Every Platform', sub: 'Built for humans and AI agents.' },
  'zh-CN': { font: 'notosanssc', title: '一个 CLI，操作所有平台', sub: '人能用，AI Agent 也能用。' },
  ja: { font: 'notosansjp', title: 'ひとつの CLI で、すべてのプラットフォームを', sub: '人にも、AI エージェントにも。' },
  ko: { font: 'notosanskr', title: '하나의 CLI로 모든 플랫폼을', sub: '사람도, AI 에이전트도 쓸 수 있습니다.' },
}

// ───────────── 平台 ─────────────
// 已上车的平台：[注册表 id, 图标, 名字]
const ON_BOARD = [
  ['xhs', 'xhs', 'RedNote'], ['douyin', 'douyin', 'Douyin'], ['tiktok', 'tiktok', 'TikTok'], ['bilibili', 'bilibili', 'Bilibili'], ['kuaishou', 'kuaishou', 'Kuaishou'],
  ['weibo', 'weibo', 'Weibo'], ['x', 'x', 'X'], ['youtube', 'youtube', 'YouTube'], ['xianyu', 'xianyu', 'Xianyu'], ['taobao', 'taobao', 'Taobao'],
  ['jd', 'jd', 'JD.com'], ['12306', '12306', '12306'], ['maoyan', 'maoyan', 'Maoyan'], ['jimeng', 'jimeng', 'Jimeng'], ['mteam', 'mteam', 'M-Team'], ['discord', 'discord', 'Discord'],
]
// 在路上的平台：[图标, 名字]
const NEXT = [
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['reddit', 'Reddit'], ['telegram', 'Telegram'],
  ['whatsapp', 'WhatsApp'], ['linkedin', 'LinkedIn'], ['amazon', 'Amazon'], ['v2ex', 'V2EX'],
  ['zhihu', 'Zhihu'], ['wechat', 'WeChat'], ['toutiao', 'Toutiao'], ['hongguo', 'Hongguo'], ['feishu', 'Feishu'],
  ['pinduoduo', 'Pinduoduo'], ['poizon', 'Poizon'], ['zhuanzhuan', 'Zhuanzhuan'], ['meituan', 'Meituan'],
  ['dianping', 'Dianping'], ['trip', 'Trip.com'], ['boss', 'BOSS Zhipin'], ['maimai', 'Maimai'], ['nowcoder', 'Nowcoder'],
  ['tonghuashun', 'Tonghuashun'], ['ziroom', 'Ziroom'], ['anjuke', 'Anjuke'], ['beike', 'Beike'],
]

// 图和注册表对得上：多一个少一个都报错
const registered = new Set(PLATFORMS.map((p) => p.id))
for (const [id] of ON_BOARD) if (!registered.has(id)) throw new Error(`注册表里没有平台 ${id}`)
for (const id of registered) if (!ON_BOARD.some(([i]) => i === id)) throw new Error(`图里缺少平台 ${id}，请补到 ON_BOARD`)


// ───────────── 字体 ─────────────
const GF = 'https://github.com/google/fonts/raw/main/ofl'
const FONTS = {
  nunito: `${GF}/nunito/Nunito%5Bwght%5D.ttf`,
  geistmono: `${GF}/geistmono/GeistMono%5Bwght%5D.ttf`,
  notosanssc: `${GF}/notosanssc/NotoSansSC%5Bwght%5D.ttf`,
  notosansjp: `${GF}/notosansjp/NotoSansJP%5Bwght%5D.ttf`,
  notosanskr: `${GF}/notosanskr/NotoSansKR%5Bwght%5D.ttf`,
}
const CACHE = here('../.cache/fonts/')
mkdirSync(CACHE, { recursive: true })
for (const [key, url] of Object.entries(FONTS)) {
  const file = new URL(`${key}.ttf`, CACHE)
  if (existsSync(file)) continue
  console.error(`[gen:assets] 下载字体 ${key}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载字体失败 ${url}: ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}
const fontBase = new Map()
const fontCache = new Map()
function font(key, weight) {
  const id = `${key}@${weight ?? ''}`
  if (fontCache.has(id)) return fontCache.get(id)
  if (!fontBase.has(key)) fontBase.set(key, fontkit.create(readFileSync(new URL(`${key}.ttf`, CACHE))))
  const base = fontBase.get(key)
  const f = weight && base.variationAxes?.wght ? base.getVariation({ wght: weight }) : base
  fontCache.set(id, f)
  return f
}

// ───────────── 小工具 ─────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (n) => +n.toFixed(2)
const write = (name, text) => {
  writeFileSync(new URL(name, OUT), text)
  console.error(`[gen:assets] ${name}`)
}
const logoHref = (key) => `data:image/jpeg;base64,${readFileSync(here(`./assets/logos/${key}.jpg`)).toString('base64')}`
// 吉祥物裁到不透明的范围，缩小后转成 webp 内嵌进 svg：一张图里一百多 KB，视网膜屏上仍然清晰
const MASCOT = await (async () => {
  const img = await loadImage(readFileSync(new URL('logo.png', OUT)))
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, img.width, img.height)
  let [x0, y0, x1, y1] = [img.width, img.height, 0, 0]
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (data[(y * img.width + x) * 4 + 3] > 8) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
    }
  }
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1]
  const k = Math.min(1, 900 / Math.max(w, h))
  const out = createCanvas(Math.round(w * k), Math.round(h * k))
  const octx = out.getContext('2d')
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(img, x0, y0, w, h, 0, 0, out.width, out.height)
  return { img, crop: [x0, y0, w, h], ratio: w / h, href: `data:image/webp;base64,${(await out.encode('webp', 90)).toString('base64')}` }
})()

/** 一张图：收集用到的字形，最后一起放进 <defs>。 */
class Doc {
  glyphs = new Map()
  defs = []
  n = 0
  id(prefix) { return `${prefix}${++this.n}` }
  /** 排版一行字（带字距和连字）。返回字形和总宽，单位是 em。 */
  layout(str, { font: key = 'nunito', weight, tracking = 0 } = {}) {
    const f = font(key, weight)
    const run = f.layout(str)
    const em = f.unitsPerEm
    let x = 0
    const items = run.glyphs.map((g, i) => {
      const item = { g, x: (x + run.positions[i].xOffset) / em, y: run.positions[i].yOffset / em }
      x += run.positions[i].xAdvance + tracking * em
      return item
    })
    return { items, width: (x - tracking * em) / em, em, id: `${key}${weight ?? ''}` }
  }
  width(str, size, opts) { return this.layout(str, opts).width * size }
  /** 字的轮廓。anchor: start | middle | end。 */
  text(str, x, y, size, fill, { anchor = 'start', ...opts } = {}) {
    const { items, width, em, id } = this.layout(str, opts)
    const w = width * size
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
    const s = size / em
    let out = ''
    for (const { g, x: gx, y: gy } of items) {
      const d = g.path.toSVG().replace(/-?\d+\.\d+/g, (v) => String(Math.round(+v)))
      if (!d) continue
      const ref = `g${id}-${g.id}`
      if (!this.glyphs.has(ref)) this.glyphs.set(ref, d)
      out += `<use xlink:href="#${ref}" href="#${ref}" transform="translate(${num(x0 + gx * size)} ${num(y - gy * size)}) scale(${+s.toFixed(5)} ${-s.toFixed(5)})"/>`
    }
    return `<g fill="${fill}">${out}</g>`
  }
  /** 吉祥物：放进 (x, y, w, h) 的框里，保持比例、底边对齐。 */
  mascot(x, y, w, h) {
    return `<image x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="xMidYMax meet" xlink:href="${MASCOT.href}" href="${MASCOT.href}"/>`
  }
  /** 平台图标：圆角方块。 */
  logo(key, x, y, size) {
    const cid = this.id('clip')
    const r = num(size * 0.23)
    this.defs.push(`<clipPath id="${cid}"><rect x="${num(x)}" y="${num(y)}" width="${size}" height="${size}" rx="${r}"/></clipPath>`)
    const href = logoHref(key)
    // 细边框：白底的图标（YouTube、美团……）在亮色背景上也看得出边
    return `<image x="${num(x)}" y="${num(y)}" width="${size}" height="${size}" clip-path="url(#${cid})" xlink:href="${href}" href="${href}"/>` +
      `<rect x="${num(x + 0.5)}" y="${num(y + 0.5)}" width="${size - 1}" height="${size - 1}" rx="${r}" fill="none" stroke="#8B949E" stroke-opacity=".28"/>`
  }
  svg(w, h, title, body) {
    const paths = [...this.glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs>${paths}${this.defs.join('')}</defs>
${body}
</svg>
`
  }
}

/** 安装命令：深色胶囊里一行 `$ npm i -g catbus-cli`。 */
function installLine(doc, x, y) {
  const mono = { font: 'geistmono', weight: 500 }
  const SIZE = 28
  const H = 76
  const adv = doc.width('m', SIZE, mono)
  const cmd = 'npm i -g catbus-cli'
  const W = 36 + (2 + cmd.length) * adv + 40
  const base = y + H / 2 + SIZE * 0.36
  return `<rect x="${x}" y="${y}" width="${num(W)}" height="${H}" rx="${H / 2}" fill="${C.pill}" stroke="${C.pillLine}" stroke-width="1.5"/>` +
    doc.text('$', x + 36, base, SIZE, C.pillDim, mono) +
    doc.text(cmd, x + 36 + 2 * adv, base, SIZE, C.pillText, mono)
}

/** 首屏左栏：字标、标题、副标题、安装命令。 */
function heroText(doc, L, t, x, top, colW) {
  let b = doc.text('catbus', x - 4, top + 112, 128, t.ink, { font: 'nunito', weight: 900, tracking: -0.02 })
  const titleFont = { font: L.font, weight: L.font === 'nunito' ? 800 : 700 }
  const ts = Math.min(44, (44 * colW) / doc.width(L.title, 44, titleFont))
  b += doc.text(L.title, x, top + 184, ts, t.ink, titleFont)
  const sw = { font: L.font, weight: L.font === 'nunito' ? 500 : 400 }
  const ss = Math.min(25, (25 * colW) / doc.width(L.sub, 25, sw))
  b += doc.text(L.sub, x, top + 228, ss, t.sub, sw)
  return b + installLine(doc, x, top + 270)
}

// ───────────── 2. 首屏：每种语言、每个主题一张 ─────────────
const HERO_W = 1280
const HERO_H = 560
function hero(doc, L, t) {
  const left = heroText(doc, L, t, 40, 96, 660)
  const h = HERO_H - 24
  const w = Math.min(560, h * MASCOT.ratio)
  return doc.mascot(1010 - w / 2, 12, w, h) + left
}
for (const [lang, L] of Object.entries(LANGS)) {
  for (const [name, t] of Object.entries(THEMES)) {
    const doc = new Doc()
    const body = hero(doc, L, t)
    write(`hero-${lang}-${name}.svg`, doc.svg(HERO_W, HERO_H, `catbus: ${L.title}`, body))
  }
}

// ───────────── 3. 平台：上面是已上车的卡片，下面是挂着 soon 的 ─────────────
for (const [name, t] of Object.entries(THEMES)) {
  const doc = new Doc()
  const W = 1280
  const GAP = 14
  const COLS = 5
  const TW = (W - (COLS - 1) * GAP) / COLS
  const TH = 92
  let b = ''
  ON_BOARD.forEach(([id, key, label], i) => {
    const x = (i % COLS) * (TW + GAP)
    const y = 2 + Math.floor(i / COLS) * (TH + GAP)
    b += `<rect x="${num(x + 1)}" y="${y}" width="${num(TW - 2)}" height="${TH}" rx="18" fill="${t.card}" stroke="${t.line}" stroke-width="2"/>`
    b += doc.logo(key, x + 18, y + 18, 56)
    b += doc.text(label, x + 90, y + 42, 23, t.ink, { font: 'nunito', weight: 800 })
    b += doc.text(id, x + 90, y + 70, 17, t.sub, { font: 'geistmono' })
  })
  let y = 2 + Math.ceil(ON_BOARD.length / COLS) * (TH + GAP) + 34
  const ICON = 60
  const PER = 9
  const PITCH = W / PER
  const ROW = 118
  NEXT.forEach(([key, label], i) => {
    const row = Math.floor(i / PER)
    const cx = (i % PER) * PITCH + PITCH / 2
    const iy = y + row * ROW
    b += doc.logo(key, cx - ICON / 2, iy, ICON)
    b += `<rect x="${num(cx + ICON / 2 - 28)}" y="${iy - 8}" width="42" height="20" rx="10" fill="${C.red}"/>`
    b += doc.text('soon', cx + ICON / 2 - 7, iy + 6.5, 12, '#FFFFFF', { anchor: 'middle', font: 'geistmono', weight: 600 })
    b += doc.text(label, cx, iy + ICON + 25, 16, t.sub, { anchor: 'middle', font: 'nunito', weight: 600 })
  })
  const H = y + Math.ceil(NEXT.length / PER) * ROW
  write(`platforms-${name}.svg`, doc.svg(W, H, 'catbus platforms: the ones on board, and the ones tagged soon', b))
}

// ───────────── 4. social preview（1280 × 640，GitHub 分享卡）─────────────
// canvas 画不出 svg 里内嵌的位图：吉祥物单独画
{
  const t = THEMES.light
  const doc = new Doc()
  const W = 1280
  const H = 640
  const left = heroText(doc, LANGS.en, t, 64, 130, 640)
  const body = `<rect width="${W}" height="${H}" fill="#FFFFFF"/>${left}`
  const img = await loadImage(Buffer.from(doc.svg(W, H, 'catbus', body)))
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, W, H)
  const [cx, cy, cw, ch] = MASCOT.crop
  const scale = Math.min(560 / cw, 590 / ch)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(MASCOT.img, cx, cy, cw, ch, 1000 - (cw * scale) / 2, 25 + 590 - ch * scale, cw * scale, ch * scale)
  writeFileSync(new URL('social-preview.png', OUT), canvas.toBuffer('image/png'))
  console.error('[gen:assets] social-preview.png')
}
