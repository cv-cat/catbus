import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'

/**
 * 验证码图片的解码与 OpenCV（@techstark/opencv-js）辅助。
 * PNG 用自带的解码器（与 cv2.imdecode 逐像素一致）；JPEG / WebP 交给 @napi-rs/canvas。
 * 图片统一是 BGR / BGRA 的交错像素（与 cv2 一致）。
 */

const require = createRequire(import.meta.url)

export interface Img<T extends Uint8Array | Float32Array = Uint8Array | Float32Array> {
  width: number
  height: number
  channels: number
  data: T
}

export type U8 = Img<Uint8Array>
export type F32 = Img<Float32Array>

let cvPromise: Promise<any> | null = null

/** 加载 opencv-js（WASM，首次约几百毫秒）。 */
export function loadCv(): Promise<any> {
  cvPromise ??= (async () => {
    let cv = require('@techstark/opencv-js')
    if (cv instanceof Promise) cv = await cv
    else if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = () => r()))
    return cv
  })()
  return cvPromise
}

export const img = <T extends Uint8Array | Float32Array>(width: number, height: number, channels: number, data: T): Img<T> => ({ width, height, channels, data })

// ---------------------------------------------------------------- PNG

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

interface Png {
  width: number
  height: number
  rgba: Uint8Array
  hasAlpha: boolean
}

/** 非交错 PNG → RGBA8。交错图返回 null（交给 canvas）。 */
export function decodePng(buf: Uint8Array): Png | null {
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
  const rgba = new Uint8Array(width * height * 4)
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
        rgba[o] = palette?.[i * 3] ?? 0
        rgba[o + 1] = palette?.[i * 3 + 1] ?? 0
        rgba[o + 2] = palette?.[i * 3 + 2] ?? 0
        rgba[o + 3] = trns && i < trns.length ? trns[i]! : 255
      } else if (type === 0 || type === 4) {
        const g = Math.round(sample(line, x * channels) * scale)
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g
        rgba[o + 3] = type === 4 ? sample(line, x * channels + 1) : 255
      } else {
        rgba[o] = sample(line, x * channels)
        rgba[o + 1] = sample(line, x * channels + 1)
        rgba[o + 2] = sample(line, x * channels + 2)
        rgba[o + 3] = type === 6 ? sample(line, x * channels + 3) : 255
      }
    }
  }
  return { width, height, rgba, hasAlpha: type === 4 || type === 6 || (type === 3 && trns != null) }
}

/** 其他格式：@napi-rs/canvas 解码。 */
/** PNG 以外（JPEG、WebP 等）交给 @napi-rs/canvas 解码。解码是异步的：直接设 `Image.src` 再 drawImage 只会画出全黑。 */
async function decodeCanvas(buf: Uint8Array): Promise<Png> {
  const { loadImage, createCanvas } = require('@napi-rs/canvas')
  const im = await loadImage(Buffer.from(buf))
  const c = createCanvas(im.width, im.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(im, 0, 0)
  const d = ctx.getImageData(0, 0, im.width, im.height)
  return { width: im.width, height: im.height, rgba: new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length), hasAlpha: true }
}

/**
 * cv2.imdecode：color 模式输出 BGR；unchanged 模式在有 alpha 时输出 BGRA、否则 BGR。
 */
export async function imdecode(buf: Uint8Array, mode: 'color' | 'unchanged' = 'color'): Promise<U8 | null> {
  let png: Png | null
  try {
    png = decodePng(buf) ?? (await decodeCanvas(buf))
  } catch {
    return null
  }
  if (!png?.width) return null
  const alpha = mode === 'unchanged' && png.hasAlpha
  const ch = alpha ? 4 : 3
  const out = new Uint8Array(png.width * png.height * ch)
  for (let i = 0, j = 0; i < png.rgba.length; i += 4, j += ch) {
    out[j] = png.rgba[i + 2]!
    out[j + 1] = png.rgba[i + 1]!
    out[j + 2] = png.rgba[i]!
    if (alpha) out[j + 3] = png.rgba[i + 3]!
  }
  return img(png.width, png.height, ch, out)
}

// ---------------------------------------------------------------- 与 cv.Mat 互转

export function toMat(cv: any, im: Img): any {
  const depth = im.data instanceof Float32Array ? cv.CV_32F : cv.CV_8U
  const type = depth === cv.CV_32F ? [cv.CV_32FC1, cv.CV_32FC2, cv.CV_32FC3, cv.CV_32FC4][im.channels - 1] : [cv.CV_8UC1, cv.CV_8UC2, cv.CV_8UC3, cv.CV_8UC4][im.channels - 1]
  const mat = new cv.Mat(im.height, im.width, type)
  ;(depth === cv.CV_32F ? mat.data32F : mat.data).set(im.data)
  return mat
}

export function fromMat(cv: any, mat: any): Img {
  const depth = mat.depth()
  const channels = mat.channels()
  const data = depth === cv.CV_32F ? new Float32Array(mat.data32F) : depth === cv.CV_8U ? new Uint8Array(mat.data) : depth === cv.CV_32S ? Float32Array.from(mat.data32S) : new Float32Array(mat.data32F)
  return img(mat.cols, mat.rows, channels, data)
}

/** 在一组 Mat 上跑 fn，结束后统一释放。 */
export function withMats<R>(fn: (keep: <M>(m: M) => M) => R): R {
  const mats: { delete(): void }[] = []
  try {
    return fn((m) => (mats.push(m as unknown as { delete(): void }), m))
  } finally {
    for (const m of mats) m.delete()
  }
}

/** 单通道视图。 */
export function channel(im: Img, c: number): Img {
  const out = im.data instanceof Float32Array ? new Float32Array(im.width * im.height) : new Uint8Array(im.width * im.height)
  for (let i = 0; i < out.length; i++) out[i] = im.data[i * im.channels + c]!
  return img(im.width, im.height, 1, out)
}

export function toFloat(im: Img): F32 {
  return img(im.width, im.height, im.channels, Float32Array.from(im.data))
}

export function crop(im: Img, x: number, y: number, w: number, h: number): Img {
  const out = im.data instanceof Float32Array ? new Float32Array(w * h * im.channels) : new Uint8Array(w * h * im.channels)
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * im.width + x) * im.channels
    out.set(im.data.subarray(s, s + w * im.channels), r * w * im.channels)
  }
  return img(w, h, im.channels, out)
}
