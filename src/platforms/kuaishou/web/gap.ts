import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'

/**
 * 滑块缺口定位（上游 utils/captcha.py 的 find_gap_x，cv2 + numpy + Pillow）。
 * OpenCV 用 @techstark/opencv-js（与 cv2 同为 5.0）；PNG 用自带的解码器（与 Pillow 逐像素一致，
 * 半透明像素不经过预乘），其他格式交给 @napi-rs/canvas。numpy 的部分照原样用 float32 重写。
 */

const require = createRequire(import.meta.url)

let cvPromise: Promise<any> | null = null

/** 加载 opencv-js（WASM，首次约几百毫秒）。 */
function loadCv(): Promise<any> {
  cvPromise ??= (async () => {
    let cv = require('@techstark/opencv-js')
    if (cv instanceof Promise) cv = await cv
    else if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = () => r()))
    return cv
  })()
  return cvPromise
}

interface Rgba {
  width: number
  height: number
  /** RGBA8，与 Pillow 的 `convert("RGBA")` 相同（没有 alpha 的图 alpha 为 255）。 */
  data: Uint8Array
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** 非交错 PNG → RGBA8；不是 PNG 或是交错图时返回 null。 */
function decodePng(buf: Uint8Array): Rgba | null {
  const b = Buffer.from(buf)
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) return null
  let off = 8
  let width = 0
  let height = 0
  let depth = 8
  let type = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off)
    const kind = b.toString('latin1', off + 4, off + 8)
    const data = b.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      depth = data[8]!
      type = data[9]!
      interlace = data[12]!
    } else if (kind === 'PLTE') palette = data
    else if (kind === 'tRNS') trns = data
    else if (kind === 'IDAT') idat.push(data)
    else if (kind === 'IEND') break
  }
  if (!width || interlace) return null
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6]
  if (!channels) return null
  const raw = inflateSync(Buffer.concat(idat))
  const bitsPerPixel = channels * depth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  const lines = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  let p = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[p++]!
    const line = lines.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const x = raw[p++]!
      const a = i >= bpp ? line[i - bpp]! : 0
      const up = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + up : filter === 3 ? x + ((a + up) >> 1) : x + paeth(a, up, c)) & 0xff
    }
    prev = line
  }
  const out = new Uint8Array(width * height * 4)
  const sample = (line: Uint8Array, idx: number): number => {
    if (depth === 8) return line[idx]!
    if (depth === 16) return line[idx * 2]!
    const perByte = 8 / depth
    const byte = line[Math.floor(idx / perByte)]!
    const shift = 8 - depth * ((idx % perByte) + 1)
    return (byte >> shift) & ((1 << depth) - 1)
  }
  const scale = depth < 8 && type !== 3 ? 255 / ((1 << depth) - 1) : 1
  for (let y = 0; y < height; y++) {
    const line = lines.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (type === 3) {
        const i = sample(line, x)
        out[o] = palette?.[i * 3] ?? 0
        out[o + 1] = palette?.[i * 3 + 1] ?? 0
        out[o + 2] = palette?.[i * 3 + 2] ?? 0
        out[o + 3] = trns && i < trns.length ? trns[i]! : 255
      } else if (type === 0 || type === 4) {
        const g = Math.round(sample(line, x * channels) * scale)
        out[o] = out[o + 1] = out[o + 2] = g
        out[o + 3] = type === 4 ? sample(line, x * channels + 1) : 255
      } else {
        out[o] = sample(line, x * channels)
        out[o + 1] = sample(line, x * channels + 1)
        out[o + 2] = sample(line, x * channels + 2)
        out[o + 3] = type === 6 ? sample(line, x * channels + 3) : 255
      }
    }
  }
  return { width, height, data: out }
}

/** JPEG / WebP 等：@napi-rs/canvas 解码。 */
function decodeCanvas(buf: Uint8Array): Rgba {
  const { Image, createCanvas } = require('@napi-rs/canvas')
  const im = new Image()
  im.src = Buffer.from(buf)
  const c = createCanvas(im.width, im.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(im, 0, 0)
  const d = ctx.getImageData(0, 0, im.width, im.height)
  return { width: im.width, height: im.height, data: new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length) }
}

function decode(buf: Uint8Array): Rgba {
  const img = decodePng(buf) ?? decodeCanvas(buf)
  if (!img.width || !img.height) throw new Error('无法解码验证码图片')
  return img
}

/** RGBA 的一个矩形区域 → BGR 交错像素（`cv2.cvtColor(rgb, COLOR_RGB2BGR)`）。 */
function bgr(img: Rgba, x0 = 0, y0 = 0, w = img.width, h = img.height): Uint8Array {
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + x0 + x) * 4
      const d = (y * w + x) * 3
      out[d] = img.data[s + 2]!
      out[d + 1] = img.data[s + 1]!
      out[d + 2] = img.data[s]!
    }
  }
  return out
}

/**
 * 在背景图里找缺口的横坐标（原图像素，滑块左边缘该落到的 x，保证落在 `[0, W - w]`）。
 * 用滑块 alpha 裁出实际形状，在背景的边缘图上做带掩码的模板匹配；搜索范围裁掉右边界，
 * 屏蔽滑块自身所在的 `[0, w)`；得分不超过 0.25 时退回到“逐列亮度突变”。
 */
export async function findGapX(bgPng: Uint8Array, cutPng: Uint8Array): Promise<number> {
  const cv = await loadCv()
  const bgImg = decode(bgPng)
  const cut = decode(cutPng)

  let x0 = Infinity
  let x1 = -1
  let y0 = Infinity
  let y1 = -1
  for (let y = 0; y < cut.height; y++) {
    for (let x = 0; x < cut.width; x++) {
      if (cut.data[(y * cut.width + x) * 4 + 3]! > 32) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('滑块图 alpha 全空，无法定位')
  const pieceW = x1 - x0 + 1
  const pieceH = y1 - y0 + 1
  const maskData = new Uint8Array(pieceW * pieceH)
  for (let y = 0; y < pieceH; y++) for (let x = 0; x < pieceW; x++) maskData[y * pieceW + x] = cut.data[((y0 + y) * cut.width + x0 + x) * 4 + 3]! > 32 ? 255 : 0

  const bgW = bgImg.width
  const bgH = bgImg.height
  const maxX = Math.max(0, bgW - pieceW)
  const mats: { delete(): void }[] = []
  const keep = <M extends { delete(): void }>(m: M): M => (mats.push(m), m)
  try {
    const bg = keep(cv.matFromArray(bgH, bgW, cv.CV_8UC3, bgr(bgImg)))
    const piece = keep(cv.matFromArray(pieceH, pieceW, cv.CV_8UC3, bgr(cut, x0, y0, pieceW, pieceH)))
    const mask = keep(cv.matFromArray(pieceH, pieceW, cv.CV_8UC1, maskData))

    // 缺口和滑块的边缘形状一致，用边缘图匹配比灰度稳
    const edge = (src: any) => {
      const blur = keep(new cv.Mat())
      cv.GaussianBlur(src, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT)
      const out = keep(new cv.Mat())
      cv.Canny(blur, out, 60, 180, 3, false)
      return out
    }
    const bgEdge = edge(bg)
    const pieceEdge = edge(piece)
    const kernel = keep(cv.Mat.ones(3, 3, cv.CV_8U))
    const eroded = keep(new cv.Mat())
    cv.erode(mask, eroded, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue())
    const res = keep(new cv.Mat())
    cv.matchTemplate(bgEdge, pieceEdge, res, cv.TM_CCOEFF_NORMED, eroded)

    // np.nan_to_num(-1) 后按列取纵向最大（float32）
    const cols: number = res.cols
    const rows: number = res.rows
    const scores: Float32Array = res.data32F
    const byX = new Float32Array(cols)
    for (let c = 0; c < cols; c++) {
      let m = -Infinity
      for (let r = 0; r < rows; r++) {
        const v = scores[r * cols + c]!
        const s = Number.isFinite(v) ? v : -1
        if (s > m) m = s
      }
      byX[c] = m
    }
    const valid = new Float32Array(cols).fill(-1)
    const upper = Math.min(maxX, cols - 1)
    for (let c = 0; c <= upper; c++) valid[c] = byX[c]!
    for (let c = 0; c < Math.min(pieceW, cols); c++) valid[c] = -1
    const bestX = argmax(valid)
    const clamp = (x: number) => Math.min(Math.max(x, 0), maxX)
    if (valid[bestX]! > 0.25) return clamp(bestX)

    // 退路：缺口通常比周围暗，逐列找亮度突变（同样只在合法区间里找）
    const gray = keep(new cv.Mat())
    cv.cvtColor(bg, gray, cv.COLOR_BGR2GRAY)
    const g: Uint8Array = gray.data
    const col = new Float32Array(bgW)
    for (let x = 0; x < bgW; x++) {
      let sum = 0
      for (let y = 0; y < bgH; y++) sum = Math.fround(sum + g[y * bgW + x]!)
      col[x] = Math.fround(sum / bgH)
    }
    const diff = new Float32Array(Math.max(0, bgW - 1))
    for (let x = 0; x < diff.length; x++) diff[x] = Math.abs(Math.fround(col[x + 1]! - col[x]!))
    const lo = pieceW
    const hi = Math.min(maxX, diff.length - 1)
    if (hi <= lo) return clamp(bestX)
    return clamp(argmax(diff.subarray(lo, hi + 1)) + lo)
  } finally {
    for (const m of mats) m.delete()
  }
}

/** np.argmax：第一个最大值的下标（这里没有 NaN）。 */
function argmax(a: Float32Array): number {
  let best = 0
  for (let i = 1; i < a.length; i++) if (a[i]! > a[best]!) best = i
  return best
}
