<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { prefersReducedMotion, reducedMotion } from '@/composables/motion'
import { MQ } from '@/composables/useBreakpoint'

/**
 * 方块像素背景。
 * 像素本身是静止的：每格的浓淡由一层遮罩决定（右上角搜索框一带最完整，往下、往左淡出），
 * 再叠一点固定的随机深浅，看起来像像素画。只有交互时才动，静止后不重绘：
 * - 鼠标附近的像素变亮，正中心转成强调色；
 * - 人浪：`catbus:wave` 起一浪（点击），`catbus:wave-loading` 为 true 时每隔一会儿起一浪（搜索加载中）。
 *   波前从右上角斜着扫到左下角，经过的像素依次「站起来」（变大、变亮），每格先后略有错落；
 *   颜色从强调色起，越往左下越浅。
 */

const props = withDefaults(defineProps<{ radius?: number }>(), { radius: 180 })

const canvas = ref<HTMLCanvasElement>()
const { theme } = useTheme()

type RGB = [number, number, number]
let palette = { bg: [0, 0, 0] as RGB, pixel: [0, 0, 0] as RGB, accent: [0, 0, 0] as RGB, size: 20, base: 0.16 }
let raf = 0
let ctx: CanvasRenderingContext2D | null = null
let w = 0
let h = 0
let dpr = 1
const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 }

/** 人浪：扫完全屏的时长（秒）、波带宽度（占对角线的比例）、加载中的间隔（秒） */
const WAVE = { life: 1.5, band: 0.14, period: 1.1 }
const waves: number[] = []
let loading = false
let lastWave = -Infinity

/** 手机 / 触屏：像素加大、不跟随指针、约 30fps，降低绘制成本 */
let lite = false
let last = 0
const checkLite = () => (lite = matchMedia(MQ.phone).matches || matchMedia(MQ.touch).matches)

/** 每格的静止浓淡（遮罩 × 随机深浅）与错落用的随机数，随窗口大小预先算好 */
let rest = new Float32Array(0)
let seeds = new Float32Array(0)
let cols = 0
let rows = 0
let step = 20

function hex(v: string): RGB {
  const s = v.trim().replace('#', '')
  const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function readPalette() {
  const cs = getComputedStyle(document.documentElement)
  palette = {
    bg: hex(cs.getPropertyValue('--bg')),
    pixel: hex(cs.getPropertyValue('--pixel')),
    accent: hex(cs.getPropertyValue('--pixel-accent')),
    size: Number(cs.getPropertyValue('--pixel-size')) || 20,
    base: Number(cs.getPropertyValue('--pixel-base')) || 0.16,
  }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** 网格从右上角排起，右上角恰好是一整格；格子 (i, j) 的左上角 */
const cellX = (i: number) => w - (i + 1) * step
const cellY = (j: number) => j * step

/** 遮罩：以右上角为原点，往左衰减得快、往下衰减得慢，左下大片留空 */
function buildGrid() {
  step = lite ? Math.round(palette.size * 1.4) : palette.size
  cols = Math.ceil(w / step)
  rows = Math.ceil(h / step)
  rest = new Float32Array(cols * rows)
  seeds = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    const cy = cellY(j) + step / 2
    for (let i = 0; i < cols; i++) {
      const cx = cellX(i) + step / 2
      const k = j * cols + i
      const seed = Math.random()
      seeds[k] = seed
      const m = 1 - smooth(0.05, 1, Math.hypot((w - cx) / (w * 0.7), cy / (h * 0.95)))
      // 少数格子留空或很淡，避免整块平铺
      rest[k] = m * (seed < 0.18 ? 0.25 : 0.45 + 0.55 * Math.random())
    }
  }
}

function resize() {
  const el = canvas.value!
  dpr = Math.min(devicePixelRatio || 1, 2)
  w = innerWidth
  h = innerHeight
  el.width = w * dpr
  el.height = h * dpr
  ctx = el.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildGrid()
}

function launch(t: number) {
  // 点击搜索紧接着开始加载时只起一浪
  if (t - lastWave < 0.25) return
  lastWave = t
  waves.push(t)
}

function draw(time: number) {
  if (!ctx) return
  const t = time / 1000
  pointer.x += (pointer.tx - pointer.x) * 0.16
  pointer.y += (pointer.ty - pointer.y) * 0.16
  if (loading && t - lastWave >= WAVE.period) launch(t)
  const live = waves.filter((t0) => t - t0 < WAVE.life)
  waves.splice(0, waves.length, ...live)

  const { bg, pixel, accent, base } = palette
  const s = step
  const gap = Math.max(1, Math.round(s * 0.14))
  const cell = s - gap
  const R = props.radius
  const diag = w + h
  ctx.clearRect(0, 0, w, h)

  for (let j = 0; j < rows; j++) {
    const y = cellY(j)
    const cy = y + s / 2
    for (let i = 0; i < cols; i++) {
      const x = cellX(i)
      const cx = x + s / 2
      const k = j * cols + i

      // 人浪：沿右上 → 左下的对角线位置 p ∈ [0,1]，波前经过时像素站起来
      const p = (w - cx + cy) / diag
      let up = 0
      for (const t0 of live) {
        const front = ((t - t0) / WAVE.life) * (1 + 2 * WAVE.band) - WAVE.band
        const q = (front - p + seeds[k]! * 0.035) / WAVE.band
        if (q > 0 && q < 1) up = Math.max(up, Math.sin(Math.PI * q))
      }
      const wave = up * (1 - 0.55 * p)

      // 交互的亮度不乘遮罩：在像素淡出的地方，鼠标会把像素「照」出来
      const hover = 1 - smooth(0, R, Math.hypot(cx - pointer.x, cy - pointer.y))
      const a = Math.min(1, base * rest[k]! + 0.4 * hover + 0.85 * wave)
      if (a < 0.008) continue

      // 颜色：静止用前景色；人浪用强调色，越往左下越浅；鼠标正中心转成强调色
      let col = pixel
      if (wave > 0.02 && wave >= hover * 0.5) col = mix(accent, bg, 0.08 + 0.62 * p)
      else if (hover > 0) col = mix(pixel, accent, hover * hover * hover)
      const sz = cell * (0.8 + 0.2 * Math.max(up, hover * 0.5))
      const off = (cell - sz) / 2
      ctx.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a.toFixed(3)})`
      ctx.fillRect(x + gap / 2 + off, y + gap / 2 + off, sz, sz)
    }
  }
}

/** 还有没有需要动的：鼠标还在追目标、还有人浪、或者还在加载 */
function busy() {
  if (loading || waves.length > 0) return true
  const dx = pointer.tx - pointer.x
  const dy = pointer.ty - pointer.y
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
    pointer.x = pointer.tx
    pointer.y = pointer.ty
    return false
  }
  return true
}

function loop(time: number) {
  raf = 0
  // 轻量模式下隔帧绘制（约 30fps）
  if (!lite || time - last >= 32) {
    last = time
    draw(time)
  }
  if (busy()) raf = requestAnimationFrame(loop)
  else draw(time) // 停下前补画一帧终态
}

/** 有交互时才开始逐帧绘制，静止后自动停 */
function kick() {
  if (raf || document.hidden || prefersReducedMotion()) return
  raf = requestAnimationFrame(loop)
}

function redraw() {
  draw(performance.now())
}

const onMove = (e: PointerEvent) => {
  // 手指没有悬停，跟随只会在点击处留下一团亮点
  if (lite || e.pointerType === 'touch' || prefersReducedMotion()) return
  pointer.tx = e.clientX
  pointer.ty = e.clientY
  if (pointer.x < -1000) Object.assign(pointer, { x: e.clientX, y: e.clientY })
  kick()
}
const onLeave = () => {
  Object.assign(pointer, { tx: -9999, ty: -9999 })
  kick()
}
const onVisibility = () => {
  if (document.hidden) {
    cancelAnimationFrame(raf)
    raf = 0
  } else {
    redraw()
    kick()
  }
}
const onResize = () => {
  checkLite()
  if (lite) Object.assign(pointer, { x: -9999, y: -9999, tx: -9999, ty: -9999 })
  resize()
  redraw()
}

/** 起一浪（点击的反馈） */
function wave() {
  if (prefersReducedMotion()) return
  launch(performance.now() / 1000)
  kick()
}
const onWave = () => wave()
const onWaveLoading = (e: Event) => {
  loading = Boolean((e as CustomEvent<boolean>).detail) && !prefersReducedMotion()
  if (loading) {
    launch(performance.now() / 1000)
    kick()
  }
}

onMounted(() => {
  checkLite()
  readPalette()
  resize()
  redraw()
  addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  addEventListener('resize', onResize)
  addEventListener('catbus:wave', onWave)
  addEventListener('catbus:wave-loading', onWaveLoading)
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  removeEventListener('pointermove', onMove)
  document.documentElement.removeEventListener('pointerleave', onLeave)
  removeEventListener('resize', onResize)
  removeEventListener('catbus:wave', onWave)
  removeEventListener('catbus:wave-loading', onWaveLoading)
  document.removeEventListener('visibilitychange', onVisibility)
})

// 主题切换后 CSS 变量已更新，重新取色（像素尺寸可能不同，网格一并重算）
watch(theme, () => requestAnimationFrame(() => {
  readPalette()
  buildGrid()
  redraw()
}))

// 设置或系统切到「减少动效」：立即停掉逐帧绘制和人浪，只留静止的像素
watch(reducedMotion, (r) => {
  if (!r) return
  cancelAnimationFrame(raf)
  raf = 0
  waves.length = 0
  loading = false
  Object.assign(pointer, { x: -9999, y: -9999, tx: -9999, ty: -9999 })
  redraw()
})

defineExpose({ wave })
</script>

<template>
  <canvas ref="canvas" class="pixels" aria-hidden="true" />
</template>

<style scoped>
.pixels {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
