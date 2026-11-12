import QRCode from 'qrcode'

// 终端二维码（AGENTS 4.13）。扫码要求“深色模块在浅色底上”，而且四周要有安静区，
// 所以固定画成黑码白底，不随主题变色（深色主题下用反色的码，部分 App 识别不了）。
// 一个字符单元画两个纵向模块：▀ 的前景是上模块、背景是下模块，这样 21 × 21 的码只占 11 行。

export interface QrCells {
  /** 每行是一串 { text, fg, bg }，颜色固定为黑白。 */
  lines: { text: string; fg: string; bg: string }[][]
  /** 画出来占多少列、多少行。 */
  cols: number
  rows: number
}

const BLACK = '#000000'
const WHITE = '#ffffff'
/**
 * 纠错等级 L：屏幕显示不会有污损，用 L 能少约 1/3 的模块，窗口小的时候才放得下。
 * 安静区：二维码规范要求 4 个模块，终端里 2 个已经够多数 App 识别。
 */
const QUIET = 2

/** 把二维码内容压成终端单元格。窗口放不下时调用方应改用图片文件，见 {@link qrSize}。 */
export function qrCells(content: string): QrCells {
  const qr = QRCode.create(content, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const total = n + QUIET * 2
  const dark = (x: number, y: number): boolean => {
    const i = x - QUIET
    const j = y - QUIET
    return i >= 0 && j >= 0 && i < n && j < n && qr.modules.get(j, i) === 1
  }
  const lines: QrCells['lines'] = []
  for (let y = 0; y < total; y += 2) {
    const row: QrCells['lines'][number] = []
    for (let x = 0; x < total; x++) {
      const top = dark(x, y)
      const bottom = y + 1 < total ? dark(x, y + 1) : false
      // 上半块 ▀：前景 = 上模块，背景 = 下模块
      const cell = { text: '▀', fg: top ? BLACK : WHITE, bg: bottom ? BLACK : WHITE }
      const last = row.at(-1)
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text
      else row.push(cell)
    }
    lines.push(row)
  }
  return { lines, cols: total, rows: lines.length }
}

/** 二维码要占多大（列 × 行），用来判断窗口放不放得下。 */
export function qrSize(content: string): { cols: number; rows: number } {
  const n = QRCode.create(content, { errorCorrectionLevel: 'M' }).modules.size + QUIET * 2
  return { cols: n, rows: Math.ceil(n / 2) }
}
