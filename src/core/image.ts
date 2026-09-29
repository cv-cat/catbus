import { createRequire } from 'node:module'
import { inflateSync } from 'node:zlib'

/**
 * 图片解码与 OpenCV（@techstark/opencv-js）辅助，给各平台的验证码识别用（京东 JCAP、快手滑块、B 站极验）。
 * PNG 用自带的解码器（与 cv2.imdecode / Pillow 逐像素一致，半透明像素不经过预乘）；JPEG / WebP 等交给 @napi-rs/canvas。
 * imdecode 输出 BGR / BGRA 的交错像素（与 cv2 一致）。
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

/** 解码后的图片：RGBA8（没有 alpha 的图 alpha 为 255，与 Pillow 的 `convert("RGBA")` 相同）。 */
export interface Rgba {
  width: number
  height: number
  rgba: Uint8Array
  /** 原图是否带 alpha（cv2 的 IMREAD_UNCHANGED 据此输出 4 通道还是 3 通道）。 */
  hasAlpha: boolean
}

/** 非交错 PNG → RGBA8。不是 PNG、或是交错图时返回 null（交给 canvas）。 */
export function decodePng(buf: Uint8Array): Rgba | null {
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

/** WebP / JPEG 是否带 alpha（与 libwebp 的 WebPGetFeatures 一致）；其他格式为 null（按像素判断）。 */
function formatAlpha(b: Buffer): boolean | null {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return false
  if (b.length >= 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16)
    if (kind === 'VP8X' && b.length > 20) return (b[20]! & 0x10) !== 0
    if (kind === 'VP8L' && b.length >= 25) return ((b.readUInt32LE(21) >>> 28) & 1) === 1
    return false
  }
  return null
}

/**
 * PNG 以外（JPEG、WebP 等）交给 @napi-rs/canvas 解码。解码是异步的：要等 loadImage 完成再画，
 * 同步设 `Image.src` 后立刻 drawImage 画出来是全黑的。
 */
async function decodeCanvas(buf: Uint8Array): Promise<Rgba> {
  const { loadImage, createCanvas } = require('@napi-rs/canvas')
  const b = Buffer.from(buf)
  const im = await loadImage(b)
  const c = createCanvas(im.width, im.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(im, 0, 0)
  const d = ctx.getImageData(0, 0, im.width, im.height)
  const rgba = new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length)
  let hasAlpha = formatAlpha(b)
  if (hasAlpha == null) {
    hasAlpha = false
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 255) {
        hasAlpha = true
        break
      }
    }
  }
  return { width: im.width, height: im.height, rgba, hasAlpha }
}

/** 任意格式 → RGBA8；解码不了（或宽高为 0）时为 null。 */
export async function decodeImage(buf: Uint8Array): Promise<Rgba | null> {
  try {
    const im = decodePng(buf) ?? (await decodeCanvas(buf))
    return im.width && im.height ? im : null
  } catch {
    return null
  }
}

/**
 * cv2.imdecode：color 模式输出 BGR；unchanged 模式在有 alpha 时输出 BGRA、否则 BGR。
 */
export async function imdecode(buf: Uint8Array, mode: 'color' | 'unchanged' = 'color'): Promise<U8 | null> {
  const png = await decodeImage(buf)
  if (!png) return null
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

/**
 * 只读文件头取图片宽高：PNG / JPEG / GIF / WebP / BMP（上游用 opencv / Pillow 解码后取尺寸）。读不出来时为 null。
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const d = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  try {
    if (d.length >= 24 && d.readUInt32BE(0) === 0x89504e47) return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) }
    if (d.length >= 10 && d.toString('latin1', 0, 3) === 'GIF') return { width: d.readUInt16LE(6), height: d.readUInt16LE(8) }
    if (d.length >= 26 && d.toString('latin1', 0, 2) === 'BM') return { width: d.readInt32LE(18), height: Math.abs(d.readInt32LE(22)) }
    if (d.length >= 30 && d.toString('latin1', 0, 4) === 'RIFF' && d.toString('latin1', 8, 12) === 'WEBP') {
      const kind = d.toString('latin1', 12, 16)
      if (kind === 'VP8X') return { width: d.readUIntLE(24, 3) + 1, height: d.readUIntLE(27, 3) + 1 }
      if (kind === 'VP8L') {
        const bits = d.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      return { width: d.readUInt16LE(26) & 0x3fff, height: d.readUInt16LE(28) & 0x3fff }
    }
    if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) {
      let o = 2
      while (o + 9 < d.length) {
        // 段之间可能有填充字节 0xff
        if (d[o] !== 0xff) {
          o++
          continue
        }
        const marker = d[o + 1]!
        if (marker === 0xff) {
          o++
          continue
        }
        const len = d.readUInt16BE(o + 2)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: d.readUInt16BE(o + 7), height: d.readUInt16BE(o + 5) }
        o += 2 + len
      }
    }
  } catch {}
  return null
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

export function crop(im: Img, x: number, y: number, w: number, h: number): Img {
  const out = im.data instanceof Float32Array ? new Float32Array(w * h * im.channels) : new Uint8Array(w * h * im.channels)
  for (let r = 0; r < h; r++) {
    const s = ((y + r) * im.width + x) * im.channels
    out.set(im.data.subarray(s, s + w * im.channels), r * w * im.channels)
  }
  return img(w, h, im.channels, out)
}
