import { readFileSync } from 'node:fs'
import { CatbusError } from '../../../core/errors.js'
import { decodePng, loadCv } from '../../jd/web/jcap/image.js'

/**
 * ddddocr 1.6.1 的检测与识别（`DdddOcr(det=True).detection`、`DdddOcr().classification(probability=True)`）的移植。
 * 模型来自 @cv-cat/catbus-assets-ocr（common_det.onnx、common_old.onnx 与字符集），跑在 onnxruntime-web 上。
 *
 * 预处理逐步照抄上游：
 * - 检测：cv2.imdecode 得到 BGR → cv2.resize(INTER_LINEAR) 等比缩放后贴到 114 灰底的 416×416 → CHW float32。
 *   缩放用 opencv-js（与 opencv-python 同一份 OpenCV 实现）；后处理（网格解码、NMS）按 numpy 的 float32 语义逐步取整。
 * - 识别：PIL 等比缩放到高 64（LANCZOS）→ convert('L') → /255。这里重写了 Pillow 的定点实现，逐字节一致。
 *
 * 图片统一用 RGB 交错像素（与 PIL 一致）。PNG 解码与 opencv-js 的加载复用京东验证码的 jcap/image.ts。
 */

export interface Rgb {
  width: number
  height: number
  data: Uint8Array
}

const f = Math.fround

// ---------------------------------------------------------------- 图片

/**
 * 解码题图为 RGB（alpha 丢弃，与 cv2.imdecode 的 IMREAD_COLOR 一致）。PNG 用自带的解码器，逐像素与 PIL / cv2 一致；
 * JPEG 等交给 @napi-rs/canvas 的 loadImage（要等它解码完再画，同步设 src 后立刻 drawImage 画出来是全黑的）。
 */
export async function decodeImage(bytes: Uint8Array): Promise<Rgb> {
  let png: { width: number; height: number; rgba: Uint8Array } | null = null
  try {
    png = decodePng(bytes)
    if (!png) {
      const { createCanvas, loadImage } = await import('@napi-rs/canvas')
      const im = await loadImage(Buffer.from(bytes))
      const ctx = createCanvas(im.width, im.height).getContext('2d')
      ctx.drawImage(im, 0, 0)
      const d = ctx.getImageData(0, 0, im.width, im.height)
      png = { width: im.width, height: im.height, rgba: new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.length) }
    }
  } catch {}
  if (!png?.width) throw new CatbusError('RISK_CONTROL', '极验题图无法解码', { detail: { kind: 'captcha' } })
  const data = new Uint8Array(png.width * png.height * 3)
  for (let i = 0, j = 0; j < data.length; i += 4, j += 3) data.set(png.rgba.subarray(i, i + 3), j)
  return { width: png.width, height: png.height, data }
}

/** PIL 的 `Image.crop((x1, y1, x2, y2))`：越界部分填 0。 */
export function crop(im: Rgb, x1: number, y1: number, x2: number, y2: number): Rgb {
  const w = Math.max(0, x2 - x1)
  const h = Math.max(0, y2 - y1)
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    const sy = y + y1
    if (sy < 0 || sy >= im.height) continue
    for (let x = 0; x < w; x++) {
      const sx = x + x1
      if (sx < 0 || sx >= im.width) continue
      const s = (sy * im.width + sx) * 3
      data.set(im.data.subarray(s, s + 3), (y * w + x) * 3)
    }
  }
  return { width: w, height: h, data }
}

// ---------------------------------------------------------------- Pillow：LANCZOS 缩放与转灰度

const PRECISION_BITS = 32 - 8 - 2

function sinc(x: number): number {
  if (x === 0) return 1
  x *= Math.PI
  return Math.sin(x) / x
}

const lanczos = (x: number) => (-3 <= x && x < 3 ? sinc(x) * sinc(x / 3) : 0)

/** Resample.c 的 precompute_coeffs + normalize_coeffs_8bpc。 */
function coeffs(inSize: number, outSize: number): { ksize: number; bounds: Int32Array; kk: Int32Array } {
  const scale = inSize / outSize
  const filterscale = scale < 1 ? 1 : scale
  const support = 3 * filterscale
  const ksize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const kk = new Int32Array(outSize * ksize)
  const k = new Float64Array(ksize)
  const inv = 1 / filterscale
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale
    let ww = 0
    const xmin = Math.max(0, Math.trunc(center - support + 0.5))
    const xmax = Math.min(inSize, Math.trunc(center + support + 0.5)) - xmin
    k.fill(0)
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * inv)
      k[x] = w
      ww += w
    }
    if (ww !== 0) for (let x = 0; x < xmax; x++) k[x]! /= ww
    for (let x = 0; x < ksize; x++) {
      const v = k[x]! * (1 << PRECISION_BITS)
      kk[xx * ksize + x] = Math.trunc(v < 0 ? v - 0.5 : v + 0.5)
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = xmax
  }
  return { ksize, bounds, kk }
}

const clip8 = (ss: number) => Math.min(255, Math.max(0, Math.floor(ss / (1 << PRECISION_BITS))))

/** `Image.resize((w, h), Image.LANCZOS)`（ImagingResampleInner：先水平、后垂直，水平只处理垂直方向用得到的行）。 */
export function resizeLanczos(im: Rgb, width: number, height: number): Rgb {
  if (width === im.width && height === im.height) return { width, height, data: im.data.slice() }
  const needH = width !== im.width
  const needV = height !== im.height
  const vert = coeffs(im.height, height)
  let src = im
  if (needH) {
    const first = vert.bounds[0]!
    const last = vert.bounds[height * 2 - 2]! + vert.bounds[height * 2 - 1]!
    for (let i = 0; i < height; i++) vert.bounds[i * 2]! -= first
    const { ksize, bounds, kk } = coeffs(im.width, width)
    const rows = last - first
    const out = new Uint8Array(width * rows * 3)
    for (let yy = 0; yy < rows; yy++) {
      const line = (yy + first) * im.width * 3
      for (let xx = 0; xx < width; xx++) {
        const xmin = bounds[xx * 2]!
        const xmax = bounds[xx * 2 + 1]!
        const k = xx * ksize
        let s0 = 1 << (PRECISION_BITS - 1)
        let s1 = s0
        let s2 = s0
        for (let x = 0; x < xmax; x++) {
          const p = line + (x + xmin) * 3
          const c = kk[k + x]!
          s0 += im.data[p]! * c
          s1 += im.data[p + 1]! * c
          s2 += im.data[p + 2]! * c
        }
        const o = (yy * width + xx) * 3
        out[o] = clip8(s0)
        out[o + 1] = clip8(s1)
        out[o + 2] = clip8(s2)
      }
    }
    src = { width, height: rows, data: out }
  }
  if (!needV) return src
  const { ksize, bounds, kk } = vert
  const out = new Uint8Array(src.width * height * 3)
  for (let yy = 0; yy < height; yy++) {
    const ymin = bounds[yy * 2]!
    const ymax = bounds[yy * 2 + 1]!
    const k = yy * ksize
    for (let xx = 0; xx < src.width; xx++) {
      let s0 = 1 << (PRECISION_BITS - 1)
      let s1 = s0
      let s2 = s0
      for (let y = 0; y < ymax; y++) {
        const p = ((y + ymin) * src.width + xx) * 3
        const c = kk[k + y]!
        s0 += src.data[p]! * c
        s1 += src.data[p + 1]! * c
        s2 += src.data[p + 2]! * c
      }
      const o = (yy * src.width + xx) * 3
      out[o] = clip8(s0)
      out[o + 1] = clip8(s1)
      out[o + 2] = clip8(s2)
    }
  }
  return { width: src.width, height, data: out }
}

/** `convert('L')`：ITU-R 601-2，Pillow 的定点写法 L24。 */
export function toGray(im: Rgb): Uint8Array {
  const out = new Uint8Array(im.width * im.height)
  for (let i = 0; i < out.length; i++) {
    const p = i * 3
    out[i] = (im.data[p]! * 19595 + im.data[p + 1]! * 38470 + im.data[p + 2]! * 7471 + 0x8000) >> 16
  }
  return out
}

/** 识别模型的输入：等比缩放到高 64 后转灰度（OCREngine._preprocess_image）。 */
export function ocrInput(im: Rgb): { width: number; height: number; gray: Uint8Array } {
  const width = Math.trunc(im.width * (64 / im.height))
  return { width, height: 64, gray: toGray(resizeLanczos(im, width, 64)) }
}

// ---------------------------------------------------------------- 模型

interface Models {
  det: string
  ocr: string
  charset: string
}

let modelPaths: Promise<Models> | null = null

function models(): Promise<Models> {
  modelPaths ??= import('@cv-cat/catbus-assets-ocr').then(
    (m) => m.models,
    () => {
      modelPaths = null
      throw new CatbusError('ERROR', '没有安装 OCR 模型包 @cv-cat/catbus-assets-ocr', { hint: '重新安装 catbus-cli；catbus doctor 可以检查' })
    },
  )
  return modelPaths
}

const sessions = new Map<string, Promise<any>>()

async function session(which: 'det' | 'ocr'): Promise<any> {
  let s = sessions.get(which)
  if (!s) {
    s = (async () => {
      const path = (await models())[which]
      let bytes: Buffer
      try {
        bytes = readFileSync(path)
      } catch {
        throw new CatbusError('ERROR', `OCR 模型文件缺失：${path}`, { hint: '重新安装 catbus-cli（@cv-cat/catbus-assets-ocr）' })
      }
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      // 识别模型声明的输出形状不对，每次推理都会警告；与上游 set_default_logger_severity(3) 一样只报错误
      ort.env.logLevel = 'error'
      return ort.InferenceSession.create(bytes, { logSeverityLevel: 3 })
    })()
    s.catch(() => sessions.delete(which))
    sessions.set(which, s)
  }
  return s
}

let charsetCache: Promise<string[]> | null = null

async function charset(): Promise<string[]> {
  charsetCache ??= models().then((m) => JSON.parse(readFileSync(m.charset, 'utf8')) as string[])
  return charsetCache
}

async function run(which: 'det' | 'ocr', data: Float32Array, dims: number[]): Promise<{ data: Float32Array; dims: readonly number[] }> {
  const ort = await import('onnxruntime-web')
  const sess = await session(which)
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', data, dims) })
  const t = out[sess.outputNames[0]]
  return { data: t.data as Float32Array, dims: t.dims }
}

// ---------------------------------------------------------------- 检测

const DET_SIZE = 416

/** DetectionEngine.preproc：BGR 等比缩放贴到 114 灰底的 416×416（HWC uint8）。 */
export async function detInput(im: Rgb): Promise<{ ratio: number; padded: Uint8Array }> {
  const cv = await loadCv()
  const r = Math.min(DET_SIZE / im.height, DET_SIZE / im.width)
  const w = Math.trunc(im.width * r)
  const h = Math.trunc(im.height * r)
  const bgr = new Uint8Array(im.data.length)
  for (let i = 0; i < bgr.length; i += 3) {
    bgr[i] = im.data[i + 2]!
    bgr[i + 1] = im.data[i + 1]!
    bgr[i + 2] = im.data[i]!
  }
  const src = new cv.Mat(im.height, im.width, cv.CV_8UC3)
  const dst = new cv.Mat()
  let resized: Uint8Array
  try {
    src.data.set(bgr)
    cv.resize(src, dst, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR)
    resized = new Uint8Array(dst.data)
  } finally {
    src.delete()
    dst.delete()
  }
  const padded = new Uint8Array(DET_SIZE * DET_SIZE * 3).fill(114)
  for (let y = 0; y < h; y++) padded.set(resized.subarray(y * w * 3, (y + 1) * w * 3), y * DET_SIZE * 3)
  return { ratio: r, padded }
}

/** 单类 NMS（DetectionEngine.nms），float32 语义。 */
function nms(boxes: number[][], scores: number[], thr: number): number[] {
  const area = boxes.map(([x1, y1, x2, y2]) => f(f(f(x2! - x1!) + 1) * f(f(y2! - y1!) + 1)))
  // scores.argsort()[::-1]：升序后倒过来
  let order = scores
    .map((s, i) => [s, i] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map(([, i]) => i)
    .reverse()
  const keep: number[] = []
  const t = f(thr)
  while (order.length) {
    const i = order[0]!
    keep.push(i)
    const [ax1, ay1, ax2, ay2] = boxes[i]!
    order = order.slice(1).filter((j) => {
      const [bx1, by1, bx2, by2] = boxes[j]!
      const w = Math.max(0, f(f(Math.min(ax2!, bx2!) - Math.max(ax1!, bx1!)) + 1))
      const h = Math.max(0, f(f(Math.min(ay2!, by2!) - Math.max(ay1!, by1!)) + 1))
      const inter = f(w * h)
      return f(inter / f(f(area[i]! + area[j]!) - inter)) <= t
    })
  }
  return keep
}

/** 检测字符框（DetectionEngine.get_bbox），返回 [x1, y1, x2, y2] 整数框，顺序同上游（按分数）。 */
export async function detect(im: Rgb): Promise<number[][]> {
  const { ratio, padded } = await detInput(im)
  const plane = DET_SIZE * DET_SIZE
  const tensor = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) tensor[c * plane + i] = padded[i * 3 + c]!
  const { data, dims } = await run('det', tensor, [1, 3, DET_SIZE, DET_SIZE])
  const n = dims[1]!
  const width = dims[2]!
  const boxes: number[][] = []
  const scores: number[] = []
  const thr = f(0.1)
  const r = f(ratio)
  let a = 0
  for (const stride of [8, 16, 32]) {
    const size = DET_SIZE / stride
    for (let gy = 0; gy < size; gy++) {
      for (let gx = 0; gx < size; gx++, a++) {
        if (a >= n) break
        const o = a * width
        const cx = f((data[o]! + gx) * stride)
        const cy = f((data[o + 1]! + gy) * stride)
        const w = f(f(Math.exp(data[o + 2]!)) * stride)
        const h = f(f(Math.exp(data[o + 3]!)) * stride)
        const score = f(data[o + 4]! * data[o + 5]!)
        if (!(score > thr)) continue
        const hw = f(w / 2)
        const hh = f(h / 2)
        boxes.push([f(f(cx - hw) / r), f(f(cy - hh) / r), f(f(cx + hw) / r), f(f(cy + hh) / r)])
        scores.push(score)
      }
    }
  }
  if (!boxes.length) return []
  return nms(boxes, scores, 0.45).map((i) => {
    const [x1, y1, x2, y2] = boxes[i]!
    return [
      x1! < 0 ? 0 : Math.trunc(x1!),
      y1! < 0 ? 0 : Math.trunc(y1!),
      x2! > im.width ? im.width : Math.trunc(x2!),
      y2! > im.height ? im.height : Math.trunc(y2!),
    ]
  })
}

// ---------------------------------------------------------------- 识别

export interface Classification {
  /** CTC 解码后的文字。 */
  text: string
  /** softmax 后的概率，steps × classes（上游 probabilities 的 [T, 1, C] 去掉 batch 维）。 */
  probabilities: Float32Array
  steps: number
  classes: number
}

/** `classification(img, probability=True)`：灰度识别，返回文字和每一步的字符概率。 */
export async function classify(im: Rgb): Promise<Classification> {
  const { width, height, gray } = ocrInput(im)
  const input = new Float32Array(gray.length)
  for (let i = 0; i < gray.length; i++) input[i] = f(gray[i]! / 255)
  const { data, dims } = await run('ocr', input, [1, 1, height, width])
  // 输出是 [T, 1, C]（模型里声明的形状不对，按实际的来）
  const classes = dims[dims.length - 1]!
  const steps = data.length / classes
  const cs = await charset()
  const probabilities = new Float32Array(data.length)
  let text = ''
  let prev = -1
  for (let t = 0; t < steps; t++) {
    const row = data.subarray(t * classes, (t + 1) * classes)
    let max = -Infinity
    let arg = 0
    for (let c = 0; c < classes; c++) {
      if (row[c]! > max) {
        max = row[c]!
        arg = c
      }
    }
    let sum = 0
    for (let c = 0; c < classes; c++) sum += Math.exp(row[c]! - max)
    for (let c = 0; c < classes; c++) probabilities[t * classes + c] = f(Math.exp(row[c]! - max) / sum)
    if (arg !== prev && arg !== 0 && arg < cs.length) text += cs[arg]
    prev = arg
  }
  return { text, probabilities, steps, classes }
}
