// 像素吉祥物（AGENTS 4.13）：一只橘猫的猫巴士，颜色取自 assets/logo.svg。
// 一个终端字符画两个纵向像素：▀ 的前景色是上像素，背景色是下像素，所以 16 行像素只占 8 行终端。
// 图是用矩形和点拼出来的，不手排字符，改尺寸不会数错位。车身、车头、轮子分层绘制，颠簸、眨眼、摇尾巴各自独立。

export const COLORS = {
  o: '#f7894f', // 橘猫身体
  d: '#e0703a', // 阴影、尾巴尖
  c: '#ffe3c8', // 肚皮
  p: '#f5c2e7', // 耳朵里、肉垫、脸颊
  k: '#1e1e2e', // 眼睛、车窗、路牌
  w: '#ffffff', // 眼睛高光
  g: '#a6e3a1', // 路牌上的提示符
  y: '#f9e2af', // 车灯、路牌光标
  m: '#f38ba8', // 鼻子
  r: '#ff2442', // 乘客：小红书
  b: '#fb7299', // 乘客：B 站
  t: '#25f4ee', // 乘客：抖音
  n: '#585b70', // 路牌底板
  W: '#45475a', // 轮子
  s: '#6c7086', // 路面
  h: '#a6adc8', // 胡须
} as const

export type Key = keyof typeof COLORS
export type Pixels = (Key | null)[][]

export const SPRITE_WIDTH = 28
export const SPRITE_HEIGHT = 16

class Layer {
  readonly rows: Pixels = Array.from({ length: SPRITE_HEIGHT }, () => Array<Key | null>(SPRITE_WIDTH).fill(null))
  px(x: number, y: number, k: Key | null): this {
    if (x >= 0 && x < SPRITE_WIDTH && y >= 0 && y < SPRITE_HEIGHT) this.rows[y]![x] = k
    return this
  }
  rect(x: number, y: number, w: number, h: number, k: Key | null): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, k)
    return this
  }
  /** 把另一层盖上来，向下偏移 dy 行。 */
  over(other: Layer, dy = 0): this {
    other.rows.forEach((row, y) => row.forEach((k, x) => k && this.px(x, y + dy, k)))
    return this
  }
}

interface Pose {
  /** 车身整体下沉的像素数（颠簸）。 */
  bounce: 0 | 1
  blink: boolean
  /** 尾巴：0 竖直，1 向后倒一点。 */
  tail: 0 | 1
  /** 轮子上的肉垫位置，0..3 绕一圈。 */
  wheel: 0 | 1 | 2 | 3
  /** 路面虚线的相位。 */
  road: 0 | 1 | 2 | 3
}

function body(pose: Pose): Layer {
  const L = new Layer()
  // 路牌：终端提示符 >_
  L.rect(3, 0, 7, 3, 'k').rect(2, 0, 1, 3, 'n').rect(10, 0, 1, 3, 'n').rect(3, 0, 7, 1, 'n')
  L.px(4, 1, 'g').px(5, 2, 'g').px(6, 1, 'g').rect(8, 2, 2, 1, 'y')
  // 耳朵：长在车头顶上
  L.px(16, 0, 'o').px(22, 0, 'o')
  L.rect(15, 1, 3, 1, 'o').px(16, 1, 'p').rect(21, 1, 3, 1, 'o').px(22, 1, 'p')
  // 车身：左边是车厢，右边的头多高一行
  L.rect(14, 2, 12, 1, 'o').rect(1, 3, 25, 6, 'o')
  L.rect(1, 9, 25, 1, 'o').rect(1, 10, 25, 1, 'c').rect(2, 11, 23, 1, 'd')
  // 三扇窗，乘客是小红书红、B 站粉、抖音青三只小猫
  const seats: [number, Key][] = [[3, 'r'], [7, 'b'], [11, 't']]
  for (const [x, c] of seats) {
    L.rect(x, 4, 3, 5, 'k')
    L.px(x, 5, c).px(x + 2, 5, c) // 耳朵
    L.rect(x, 6, 3, 3, c)
    if (c === 't') L.px(x, 7, 'k').px(x + 2, 7, 'k')
    else L.px(x, 7, 'w').px(x + 2, 7, 'w')
  }
  // 车头 = 猫脸
  const eye = (x: number) => {
    if (pose.blink) L.rect(x, 6, 2, 1, 'k')
    else L.rect(x, 4, 2, 3, 'k').px(x, 4, 'w')
  }
  eye(16)
  eye(22)
  L.rect(15, 7, 1, 1, 'p').rect(24, 7, 1, 1, 'p') // 脸颊
  L.rect(19, 7, 2, 1, 'm') // 鼻子
  L.px(18, 8, 'k').px(19, 9, 'k').px(20, 9, 'k').px(21, 8, 'k') // ω 的嘴
  L.px(26, 6, 'h').px(27, 5, 'h').px(26, 9, 'h').px(27, 10, 'h') // 胡须
  L.px(25, 10, 'y') // 车灯
  // 尾巴
  if (pose.tail === 0) L.rect(0, 3, 1, 6, 'o').px(0, 2, 'o').px(0, 1, 'd')
  else L.rect(0, 4, 1, 5, 'o').px(0, 3, 'd')
  return L
}

function wheels(pose: Pose): Layer {
  const L = new Layer()
  for (const cx of [4, 20]) {
    L.rect(cx - 1, 11, 3, 1, 'W').rect(cx - 2, 12, 5, 2, 'W').rect(cx - 1, 14, 3, 1, 'W')
    // 肉垫在轮毂上绕圈：4 个位置
    const spots: [number, number][] = [[0, 12], [1, 13], [0, 14], [-1, 13]]
    const [dx, y] = spots[pose.wheel]!
    L.px(cx + dx, y, 'p')
  }
  return L
}

function road(pose: Pose): Layer {
  const L = new Layer()
  for (let x = 0; x < SPRITE_WIDTH; x++) if ((x + pose.road) % 4 < 2) L.px(x, 15, 's')
  return L
}

export function drawPose(pose: Pose): Pixels {
  const L = new Layer()
  L.over(road(pose)).over(wheels(pose)).over(body(pose), pose.bounce)
  return L.rows
}

/** 动画帧：车身颠簸、轮子转、路面后退；眨眼和摇尾巴各隔几帧出现一次。 */
export const POSES: Pose[] = [
  { bounce: 0, blink: false, tail: 0, wheel: 0, road: 0 },
  { bounce: 1, blink: false, tail: 0, wheel: 1, road: 1 },
  { bounce: 0, blink: false, tail: 1, wheel: 2, road: 2 },
  { bounce: 1, blink: false, tail: 1, wheel: 3, road: 3 },
  { bounce: 0, blink: false, tail: 1, wheel: 0, road: 0 },
  { bounce: 1, blink: true, tail: 0, wheel: 1, road: 1 },
  { bounce: 0, blink: false, tail: 0, wheel: 2, road: 2 },
  { bounce: 1, blink: false, tail: 0, wheel: 3, road: 3 },
]

export const FRAMES: Pixels[] = POSES.map(drawPose)

export interface Cell {
  ch: string
  fg: string | null
  bg: string | null
}

/** 压成终端单元格：每两行像素一行。 */
export function toCells(pixels: Pixels): Cell[][] {
  const out: Cell[][] = []
  for (let y = 0; y < pixels.length; y += 2) {
    out.push(
      pixels[y]!.map((_, x) => {
        const top = pixels[y]![x] ? COLORS[pixels[y]![x]!] : null
        const bottom = pixels[y + 1]?.[x] ? COLORS[pixels[y + 1]![x]!] : null
        if (top && bottom) return { ch: '▀', fg: top, bg: bottom }
        if (top) return { ch: '▀', fg: top, bg: null }
        if (bottom) return { ch: '▄', fg: bottom, bg: null }
        return { ch: ' ', fg: null, bg: null }
      }),
    )
  }
  return out
}

/** 同一行里颜色相同的相邻单元格合并，Ink 少生成一些 Text 节点。 */
export function toRuns(cells: Cell[][]): { text: string; fg: string | null; bg: string | null }[][] {
  return cells.map((line) => {
    const runs: { text: string; fg: string | null; bg: string | null }[] = []
    for (const c of line) {
      const last = runs.at(-1)
      if (last && last.fg === c.fg && last.bg === c.bg) last.text += c.ch
      else runs.push({ text: c.ch, fg: c.fg, bg: c.bg })
    }
    return runs
  })
}

/** 不支持真彩色、NO_COLOR 或 ASCII 模式时用的文字版。 */
export const TEXT_MASCOT = ['  /\\_/\\', ' ( >w_ )', '  /   \\']
