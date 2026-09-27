import { readFileSync } from 'node:fs'
import { mulberry32 } from '../../../../core/rand.js'
import { crop, type F32, fromMat, img, type Img, loadCv, toMat, type U8, withMats } from './image.js'
import { detectLines } from './lsd.js'

/**
 * JCAP 验证码的本地求解（上游 static/jcap/run/captcha_solver.py 的移植）：
 * tp=2 点选（U2Net 显著性 + 带掩码模板匹配）、tp=3 轨迹（U2Net + 骨架 + 四角几何拟合）、
 * tp=26 旋转（方向分类模型 + LSD 直线轴向）、tp=30 滑块（轮廓与纹理相关）。
 * numpy 的 float32 运算用 Math.fround 模拟；scipy 的 differential_evolution 换成同算法的本地实现（随机序列不同）。
 */

const f = Math.fround
/** CPython 的 math.degrees / math.radians 用的常量。 */
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const f32 = (v: number) => f(v)

export interface Solution {
  retry: boolean
  reason?: string
  solver?: string
  score?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------- 数值工具

/** numpy 对 float32 数组的 pairwise 求和（np.sum / np.mean 的累加顺序）。 */
export function pairwiseSum(a: ArrayLike<number>, start = 0, n = a.length): number {
  if (n < 8) {
    let res = 0
    for (let i = 0; i < n; i++) res = f(res + a[start + i]!)
    return res
  }
  if (n <= 128) {
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => f(a[start + j]!))
    let i = 8
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] = f(r[j]! + a[start + i + j]!)
    let res = f(f(f(r[0]! + r[1]!) + f(r[2]! + r[3]!)) + f(f(r[4]! + r[5]!) + f(r[6]! + r[7]!)))
    for (; i < n; i++) res = f(res + a[start + i]!)
    return res
  }
  let n2 = Math.floor(n / 2)
  n2 -= n2 % 8
  return f(pairwiseSum(a, start, n2) + pairwiseSum(a, start + n2, n - n2))
}

export const mean32 = (a: ArrayLike<number>) => f(pairwiseSum(a) / a.length)
const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Python 的 round(x, nd)：对二进制值做正确舍入，恰好一半时取偶。 */
export function pyRound(x: number, nd = 2): number {
  const s = x.toFixed(nd)
  const exact = x.toPrecision(40)
  const scaled = Number(exact) * 10 ** nd
  if (Math.abs(scaled - Math.trunc(scaled)) === 0.5 && Number.isInteger(scaled * 2)) {
    const lo = Math.floor(scaled)
    return (lo % 2 === 0 ? lo : lo + 1) / 10 ** nd
  }
  return Number(s)
}

function reflect101(p: number, len: number): number {
  if (len === 1) return 0
  while (p < 0 || p >= len) p = p < 0 ? -p : 2 * len - p - 2
  return p
}

/**
 * cv2.remap(image, x, y, INTER_LINEAR, BORDER_REFLECT_101) 对一组点采样（float32 图像）。
 * OpenCV 5 的 remap 直接用浮点坐标做两次线性插值（SIMD 下为 FMA）：t0 = a + fx·(b − a)，t1 = c + fx·(d − c)，
 * v = t0 + fy·(t1 − t0)。float 乘积在 double 里是精确的，先在 double 里算再舍入一次即模拟 FMA。
 */
export function remap(im: F32, xs: ArrayLike<number>, ys: ArrayLike<number>): Float32Array {
  const { width, height, channels: cn, data } = im
  const out = new Float32Array(xs.length * cn)
  const fma = (a: number, b: number, c: number) => f(a * b + c)
  for (let k = 0; k < xs.length; k++) {
    const x = f(xs[k]!)
    const y = f(ys[k]!)
    const sx = Math.floor(x)
    const sy = Math.floor(y)
    const fx = f(x - sx)
    const fy = f(y - sy)
    const x0 = reflect101(sx, width)
    const x1 = reflect101(sx + 1, width)
    const y0 = reflect101(sy, height)
    const y1 = reflect101(sy + 1, height)
    for (let c = 0; c < cn; c++) {
      const a = data[(y0 * width + x0) * cn + c]!
      const b = data[(y0 * width + x1) * cn + c]!
      const d0 = data[(y1 * width + x0) * cn + c]!
      const d1 = data[(y1 * width + x1) * cn + c]!
      const t0 = fma(fx, f(b - a), a)
      const t1 = fma(fx, f(d1 - d0), d0)
      out[k * cn + c] = fma(fy, f(t1 - t0), t0)
    }
  }
  return out
}

// ---------------------------------------------------------------- OpenCV 包装

async function cvOps() {
  const cv = await loadCv()
  const run = <R>(fn: (keep: <M>(m: M) => M) => R) => withMats(fn)
  const resize = (im: Img, w: number, h: number, interp: number): Img =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.resize(keep(toMat(cv, im)), dst, new cv.Size(w, h), 0, 0, interp)
      return fromMat(cv, dst)
    })
  const cvtColor = (im: Img, code: number): Img =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.cvtColor(keep(toMat(cv, im)), dst, code)
      return fromMat(cv, dst)
    })
  const medianBlur = (im: U8, k: number): U8 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.medianBlur(keep(toMat(cv, im)), dst, k)
      return fromMat(cv, dst) as U8
    })
  const distanceTransform = (binary: U8, mask: number): F32 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.distanceTransform(keep(toMat(cv, binary)), dst, cv.DIST_L2, mask)
      return fromMat(cv, dst) as F32
    })
  const sobel = (im: Img, dx: number, dy: number, ksize = 3): F32 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.Sobel(keep(toMat(cv, im)), dst, cv.CV_32F, dx, dy, ksize)
      return fromMat(cv, dst) as F32
    })
  const canny = (im: U8, t1: number, t2: number): U8 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.Canny(keep(toMat(cv, im)), dst, t1, t2)
      return fromMat(cv, dst) as U8
    })
  const erode3 = (im: U8): U8 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      const kernel = keep(cv.Mat.ones(3, 3, cv.CV_8U))
      cv.erode(keep(toMat(cv, im)), dst, kernel, new cv.Point(-1, -1), 1)
      return fromMat(cv, dst) as U8
    })
  const gaussian = (im: F32, sigma: number): F32 =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.GaussianBlur(keep(toMat(cv, im)), dst, new cv.Size(0, 0), sigma)
      return fromMat(cv, dst) as F32
    })
  const components = (binary: U8) =>
    run((keep) => {
      const labels = keep(new cv.Mat())
      const stats = keep(new cv.Mat())
      const centroids = keep(new cv.Mat())
      const count = cv.connectedComponentsWithStats(keep(toMat(cv, binary)), labels, stats, centroids, 8, cv.CV_32S)
      return { count, labels: Int32Array.from(labels.data32S), stats: Int32Array.from(stats.data32S) }
    })
  const matchTemplate = (image: U8, templ: U8, mask: U8) =>
    run((keep) => {
      const dst = keep(new cv.Mat())
      cv.matchTemplate(keep(toMat(cv, image)), keep(toMat(cv, templ)), dst, cv.TM_CCORR_NORMED, keep(toMat(cv, mask)))
      return fromMat(cv, dst) as F32
    })
  const approxPolyDP = (points: Float32Array, eps: number): Float32Array =>
    run((keep) => {
      const src = keep(cv.matFromArray(points.length / 2, 1, cv.CV_32FC2, Array.from(points)))
      const dst = keep(new cv.Mat())
      cv.approxPolyDP(src, dst, eps, false)
      return new Float32Array(dst.data32F)
    })
  return { cv, resize, cvtColor, medianBlur, distanceTransform, sobel, canny, erode3, gaussian, components, matchTemplate, approxPolyDP }
}

type Ops = Awaited<ReturnType<typeof cvOps>>
let opsPromise: Promise<Ops> | null = null
const ops = () => (opsPromise ??= cvOps())

// ---------------------------------------------------------------- ONNX

const sessions = new Map<string, Promise<any>>()

async function session(modelPath: string): Promise<any> {
  let s = sessions.get(modelPath)
  if (!s) {
    s = (async () => {
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      return ort.InferenceSession.create(readFileSync(modelPath))
    })()
    sessions.set(modelPath, s)
  }
  return s
}

async function runModel(modelPath: string, tensor: Float32Array, dims: number[]): Promise<{ data: Float32Array; dims: readonly number[] }> {
  const ort = await import('onnxruntime-web')
  const sess = await session(modelPath)
  const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', tensor, dims) })
  const t = out[sess.outputNames[0]]
  return { data: t.data as Float32Array, dims: t.dims }
}

const MEAN = [f(0.485), f(0.456), f(0.406)]
const STD = [f(0.229), f(0.224), f(0.225)]

/** U2Net 显著性图，缩放回原图大小（_u2net_saliency）。 */
export async function u2netSaliency(image: U8, modelPath: string): Promise<F32> {
  const o = await ops()
  const rgb = o.cvtColor(image, o.cv.COLOR_BGR2RGB)
  const resized = o.resize(rgb, 320, 320, o.cv.INTER_LANCZOS4)
  let max = 0
  for (const v of resized.data) if (v > max) max = v
  const m = Math.max(max, 1e-6)
  const tensor = new Float32Array(3 * 320 * 320)
  for (let i = 0; i < 320 * 320; i++) {
    for (let c = 0; c < 3; c++) tensor[c * 320 * 320 + i] = f(f(f(f(resized.data[i * 3 + c]!) / m) - MEAN[c]!) / STD[c]!)
  }
  const { data } = await runModel(modelPath, tensor, [1, 3, 320, 320])
  const pred = new Float32Array(data.subarray(0, 320 * 320))
  let lo = Infinity
  let hi = -Infinity
  for (const v of pred) lo = Math.min(lo, v)
  for (let i = 0; i < pred.length; i++) pred[i] = f(pred[i]! - lo)
  for (const v of pred) hi = Math.max(hi, v)
  const div = Math.max(hi, 1e-6)
  for (let i = 0; i < pred.length; i++) pred[i] = f(pred[i]! / div)
  return o.resize(img(320, 320, 1, pred), image.width, image.height, o.cv.INTER_LANCZOS4) as F32
}

// ---------------------------------------------------------------- 骨架与路径

/** 2D 骨架化（scikit-image 的 _fast_skeletonize，Zhang-Suen 查表法）。 */
const SKELETON_LUT = [
  0, 0, 0, 1, 0, 0, 1, 3, 0, 0, 3, 1, 1, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 3, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 3, 0,
  2, 0, 0, 0, 3, 1, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 1, 3, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 1, 0, 0, 0, 0, 2, 2, 0, 0,
  2, 0, 0, 0,
]

export function skeletonize(mask: Uint8Array, width: number, height: number): Uint8Array {
  const W = width + 2
  const H = height + 2
  const sk = new Uint8Array(W * H)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) sk[(y + 1) * W + x + 1] = mask[y * width + x] ? 1 : 0
  const cleaned = sk.slice()
  let removed = true
  while (removed) {
    removed = false
    for (let pass = 0; pass < 2; pass++) {
      const first = pass === 0
      for (let r = 1; r < H - 1; r++) {
        for (let c = 1; c < W - 1; c++) {
          if (!sk[r * W + c]) continue
          const n = SKELETON_LUT[
            sk[(r - 1) * W + c - 1]! + 2 * sk[(r - 1) * W + c]! + 4 * sk[(r - 1) * W + c + 1]! + 8 * sk[r * W + c + 1]! +
              16 * sk[(r + 1) * W + c + 1]! + 32 * sk[(r + 1) * W + c]! + 64 * sk[(r + 1) * W + c - 1]! + 128 * sk[r * W + c - 1]!
          ]!
          if (n === 0) continue
          if (n === 3 || (n === 1 && first) || (n === 2 && !first)) {
            cleaned[r * W + c] = 0
            removed = true
          }
        }
      }
      sk.set(cleaned)
    }
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[y * width + x] = sk[(y + 1) * W + x + 1]!
  return out
}

type Node = [number, number]
const key = (y: number, x: number) => y * 65536 + x

/** 最小堆，按 (distance, y, x) 字典序（与 heapq 的元组比较一致）。 */
class Heap {
  items: [number, number, number][] = []
  private less(a: [number, number, number], b: [number, number, number]) {
    return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))
  }
  push(v: [number, number, number]) {
    const h = this.items
    h.push(v)
    let i = h.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(h[i]!, h[p]!)) break
      ;[h[i], h[p]] = [h[p]!, h[i]!]
      i = p
    }
  }
  pop(): [number, number, number] {
    const h = this.items
    const top = h[0]!
    const last = h.pop()!
    if (h.length) {
      h[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r
        if (m === i) break
        ;[h[i], h[m]] = [h[m]!, h[i]!]
        i = m
      }
    }
    return top
  }
}

function farthest(graph: Map<number, [number, number][]>, nodes: Map<number, Node>, start: number) {
  const distances = new Map<number, number>([[start, 0]])
  const parents = new Map<number, number>()
  const heap = new Heap()
  const [sy, sx] = nodes.get(start)!
  heap.push([0, sy, sx])
  while (heap.items.length) {
    const [d, y, x] = heap.pop()
    const k = key(y, x)
    if (d !== distances.get(k)) continue
    for (const [nb, w] of graph.get(k)!) {
      const cand = d + w
      if (cand < (distances.get(nb) ?? Infinity)) {
        distances.set(nb, cand)
        parents.set(nb, k)
        const [ny, nx] = nodes.get(nb)!
        heap.push([cand, ny, nx])
      }
    }
  }
  let best = start
  let bestD = -Infinity
  for (const [k, d] of distances) if (d > bestD) (best = k), (bestD = d)
  return { node: best, distances, parents }
}

/** 骨架上最长的测地线路径（_longest_skeleton_path），点为 (y, x)。 */
export function longestSkeletonPath(skel: Uint8Array, width: number, height: number): { path: Node[]; metrics: Record<string, number> } {
  const nodes = new Map<number, Node>()
  const order: number[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (skel[y * width + x]) {
        nodes.set(key(y, x), [y, x])
        order.push(key(y, x))
      }
  const graph = new Map<number, [number, number][]>()
  for (const k of order) {
    const [y, x] = nodes.get(k)!
    const nbs: [number, number][] = []
    for (const dy of [-1, 0, 1])
      for (const dx of [-1, 0, 1]) {
        if (!(dx || dy)) continue
        const nk = key(y + dy, x + dx)
        if (y + dy < 0 || x + dx < 0 || !nodes.has(nk)) continue
        nbs.push([nk, Math.sqrt(dx * dx + dy * dy)])
      }
    graph.set(k, nbs)
  }
  if (!graph.size) return { path: [], metrics: {} }
  const endpoints = order.filter((k) => graph.get(k)!.length === 1)
  const firstStart = endpoints[0] ?? order[0]!
  const first = farthest(graph, nodes, firstStart).node
  const { node: second, distances, parents } = farthest(graph, nodes, first)
  const path = [second]
  while (path[path.length - 1] !== first) {
    const p = parents.get(path[path.length - 1]!)
    if (p === undefined) break
    path.push(p)
  }
  path.reverse()
  let branches = 0
  for (const k of order) if (graph.get(k)!.length >= 4) branches++
  return {
    path: path.map((k) => nodes.get(k)!),
    metrics: { pixels: order.length, endpoints: endpoints.length, branches, length: distances.get(second) ?? 0 },
  }
}

/** 沿路径重采样 count 个点（_resample_path），点为 [x, y]，保留两位小数。 */
export async function resamplePath(path: Node[], count = 64): Promise<number[][]> {
  const o = await ops()
  const pts = new Float32Array(path.length * 2)
  path.forEach(([y, x], i) => {
    pts[i * 2] = x
    pts[i * 2 + 1] = y
  })
  let simp = o.approxPolyDP(pts, 1.6)
  if (simp.length < 4) simp = pts
  const n = simp.length / 2
  const dists: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = f(simp[(i + 1) * 2]! - simp[i * 2]!)
    const dy = f(simp[(i + 1) * 2 + 1]! - simp[i * 2 + 1]!)
    dists.push(f(Math.sqrt(f(f(dx * dx) + f(dy * dy)))))
  }
  const cum = [0]
  let acc = 0
  for (const d of dists) cum.push((acc = f(acc + d)))
  const total = cum[cum.length - 1]!
  if (total <= 0) return Array.from({ length: n }, (_, i) => [pyRound(simp[i * 2]!), pyRound(simp[i * 2 + 1]!)])
  const step = total / (count - 1)
  const out: number[][] = []
  let seg = 0
  for (let t = 0; t < count; t++) {
    const target = t === count - 1 ? total : t * step
    while (seg + 1 < cum.length - 1 && cum[seg + 1]! < target) seg++
    const span = Math.max(cum[seg + 1]! - cum[seg]!, 1e-6)
    const ratio = (target - cum[seg]!) / span
    const px = simp[seg * 2]! + ratio * f(simp[(seg + 1) * 2]! - simp[seg * 2]!)
    const py = simp[seg * 2 + 1]! + ratio * f(simp[(seg + 1) * 2 + 1]! - simp[seg * 2 + 1]!)
    out.push([pyRound(px), pyRound(py)])
  }
  return out
}

/** 从显著性图里找一条可信的轨迹（_extract_confident_path）。 */
export async function extractConfidentPath(saliency: F32): Promise<Solution> {
  const o = await ops()
  const { width, height, data } = saliency
  let best: { path: Node[]; c: Record<string, any> } | null = null
  for (const threshold of [0.88, 0.82, 0.76, 0.7, 0.64]) {
    const t = f(threshold)
    const binary = new Uint8Array(width * height)
    for (let i = 0; i < binary.length; i++) binary[i] = data[i]! >= t ? 1 : 0
    const { count, labels, stats } = o.components(img(width, height, 1, binary))
    for (let label = 1; label < count; label++) {
      const [x, y, bw, bh, area] = [0, 1, 2, 3, 4].map((j) => stats[label * 5 + j]!) as [number, number, number, number, number]
      if (area < 250 || bw < width * 0.35 || bh < height * 0.18) continue
      const comp = new Uint8Array(width * height)
      for (let i = 0; i < comp.length; i++) comp[i] = labels[i] === label ? 1 : 0
      const { path, metrics } = longestSkeletonPath(skeletonize(comp, width, height), width, height)
      if (!path.length) continue
      const thickness = area / Math.max(metrics.length!, 1)
      const coverage = metrics.length! / Math.max(Math.hypot(bw, bh), 1)
      const confidence = metrics.length! - 7 * metrics.endpoints! - 2 * metrics.branches! - 12 * Math.max(0, thickness - 18)
      const cx = x + bw / 2
      const cy = y + bh / 2
      const c = {
        ...metrics,
        threshold,
        area,
        width: bw,
        height: bh,
        thickness,
        coverage,
        confidence,
        center_ok: width * 0.22 <= cx && cx <= width * 0.78 && height * 0.15 <= cy && cy <= height * 0.85,
      }
      if (!best || c.confidence > best.c.confidence) best = { path, c }
    }
  }
  if (!best) return { retry: true, reason: 'no-path', score: 0 }
  const m = best.c
  const accepted = m.confidence >= 100 && m.length >= 150 && m.thickness <= 22 && m.coverage >= 1.05 && m.endpoints <= 5 && m.center_ok
  if (!accepted) return { retry: true, reason: 'low-confidence', score: pyRound(m.confidence) }
  return { retry: false, score: pyRound(m.confidence), points: await resamplePath(best.path) }
}

// ---------------------------------------------------------------- tp=2 点选

/** 在主图里找提示图中的那个物体（solve_click）。 */
export async function solveClick(image: U8, tip: U8, modelPath: string): Promise<Solution> {
  const o = await ops()
  const sal = await u2netSaliency(tip, modelPath)
  for (let i = 0; i < sal.data.length; i++) sal.data[i] = clip(sal.data[i]!, 0, 1)
  let max = 0
  for (const v of sal.data) if (v > max) max = v
  const threshold = Math.max(0.25, max * 0.35)
  const t32 = f(threshold)
  const binary = new Uint8Array(sal.data.length)
  for (let i = 0; i < binary.length; i++) binary[i] = sal.data[i]! >= t32 ? 1 : 0
  const { count, labels, stats } = o.components(img(tip.width, tip.height, 1, binary))
  const candidates: [number, number, number, number, number][] = []
  for (let idx = 1; idx < count; idx++) {
    const [x, y, w, h, area] = [0, 1, 2, 3, 4].map((j) => stats[idx * 5 + j]!) as [number, number, number, number, number]
    if (area < 12 || w < 3 || h < 3) continue
    const vals: number[] = []
    for (let i = 0; i < labels.length; i++) if (labels[i] === idx) vals.push(sal.data[i]!)
    candidates.push([pairwiseSum(vals), x, y, w, h])
  }
  if (!candidates.length) return { retry: true, reason: 'tip-object-not-found', score: 0 }
  candidates.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || b[4] - a[4])
  let [, x, y, width, height] = candidates[0]!
  const pad = 2
  x = Math.max(0, x - pad)
  y = Math.max(0, y - pad)
  width = Math.min(tip.width - x, width + 2 * pad)
  height = Math.min(tip.height - y, height + 2 * pad)
  const template = crop(tip, x, y, width, height) as U8
  const tmask = new Uint8Array(width * height)
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) tmask[r * width + c] = sal.data[(y + r) * tip.width + x + c]! >= t32 ? 255 : 0
  let best: [number, [number, number], [number, number]] | null = null
  for (let i = 0; i < 15; i++) {
    const scale = i === 14 ? 1.4 : i * ((1.4 - 0.7) / 14) + 0.7
    const sw = Math.max(4, pyRoundInt(width * scale))
    const sh = Math.max(4, pyRoundInt(height * scale))
    if (sw >= image.width || sh >= image.height) continue
    const scaled = o.resize(template, sw, sh, o.cv.INTER_CUBIC) as U8
    const mask = o.resize(img(width, height, 1, tmask), sw, sh, o.cv.INTER_NEAREST) as U8
    const scores = o.matchTemplate(image, scaled, mask)
    let score = -Infinity
    let loc: [number, number] = [0, 0]
    for (let r = 0; r < scores.height; r++)
      for (let c = 0; c < scores.width; c++) {
        let v = scores.data[r * scores.width + c]!
        if (!Number.isFinite(v)) v = -1
        if (v > score) (score = v), (loc = [c, r])
      }
    if (!best || score > best[0]) best = [score, loc, [sw, sh]]
  }
  if (!best || best[0] < 0.72) return { retry: true, reason: 'click-match-low-confidence', score: pyRound(best ? best[0] : 0, 4) }
  const [score, loc, size] = best
  return { retry: false, solver: 'u2net-masked-template', x: pyRound(loc[0] + size[0] / 2), y: pyRound(loc[1] + size[1] / 2), score: pyRound(score, 4) }
}

/** Python 的 int(round(x))（银行家舍入）。 */
function pyRoundInt(x: number): number {
  const r = Math.round(x)
  return Math.abs(x - Math.trunc(x)) === 0.5 ? 2 * Math.round(x / 2) : r
}

// ---------------------------------------------------------------- tp=26 旋转

const circularDistance = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(d, 360 - d)
}

/** 旋转图的纠正角度（solve_rotation）：方向分类得到粗角度，LSD 直线的四倍角加权均值给出精确轴向。 */
export async function solveRotation(image: U8, modelPath: string): Promise<Solution> {
  const o = await ops()
  const resized = o.resize(image, 416, 416, o.cv.INTER_CUBIC) as U8
  const tensor = new Float32Array(3 * 384 * 384)
  for (let yy = 0; yy < 384; yy++)
    for (let xx = 0; xx < 384; xx++) {
      const s = ((yy + 16) * 416 + xx + 16) * 3
      for (let c = 0; c < 3; c++) tensor[c * 384 * 384 + yy * 384 + xx] = f(f(f(resized.data[s + 2 - c]!) / 255) - MEAN[c]!) / STD[c]!
    }
  for (let i = 0; i < tensor.length; i++) tensor[i] = f(tensor[i]!)
  const { data } = await runModel(modelPath, tensor, [1, 3, 384, 384])
  const logits = Array.from(data.subarray(0, 4), f32)
  const lmax = Math.max(...logits)
  const probs = logits.map((v) => f(Math.exp(f(v - lmax))))
  const psum = Math.max(pairwiseSum(probs), 1e-6)
  const p = probs.map((v) => f(v / psum))
  let cls = 0
  for (let i = 1; i < p.length; i++) if (p[i]! > p[cls]!) cls = i
  const coarse = ({ 0: 0, 1: 270, 2: 180, 3: 90 } as Record<number, number>)[cls]!
  const gray = o.cvtColor(image, o.cv.COLOR_BGR2GRAY) as U8
  const lines = detectLines(o.cv, gray)
  let re = 0
  let im = 0
  let total = 0
  for (const [x1, y1, x2, y2] of lines) {
    const dx = f(x2 - x1)
    const dy = f(y2 - y1)
    const length = Math.hypot(dx, dy)
    if (length < 12) continue
    const theta = Math.atan2(dy, dx)
    const w = length * length
    re += w * Math.cos(4 * theta)
    im += w * Math.sin(4 * theta)
    total += w
  }
  let cvAngle: number
  let strength: number
  if (total <= 0) {
    cvAngle = coarse
    strength = 0
  } else {
    const axis = (((Math.atan2(im, re) * RAD_TO_DEG) / 4) % 90 + 90) % 90
    const cands = [0, 1, 2, 3].map((i) => (axis + 90 * i) % 360)
    cvAngle = cands.reduce((a, b) => (circularDistance(b, coarse) < circularDistance(a, coarse) ? b : a))
    strength = Math.hypot(re, im) / total
  }
  const css = (((360 - cvAngle) % 360) + 360) % 360
  return {
    retry: false,
    solver: 'orientation-classifier-axis',
    angle: pyRound(css),
    cvAngle: pyRound(cvAngle),
    orientationClass: cls,
    score: pyRound(p[cls]!, 4),
    axisStrength: pyRound(strength, 4),
  }
}

// ---------------------------------------------------------------- tp=30 滑块

/** 用拼图块的透明轮廓定位缺口（solve_slider）。 */
export async function solveSlider(image: U8, slot: U8): Promise<Solution> {
  if (slot.channels !== 4) return { retry: true, reason: 'slot-alpha-missing', score: 0 }
  if (slot.height !== image.height || slot.width >= image.width) return { retry: true, reason: 'slot-size-mismatch', score: 0 }
  const o = await ops()
  const W = slot.width
  const H = slot.height
  const mask = new Uint8Array(W * H)
  let maskSum = 0
  for (let i = 0; i < mask.length; i++) maskSum += mask[i] = slot.data[i * 4 + 3]! >= 48 ? 1 : 0
  if (maskSum < 200) return { retry: true, reason: 'slot-mask-empty', score: 0 }
  const mask255 = img(W, H, 1, mask.map((v) => v * 255))
  const contour = o.canny(mask255, 50, 150)
  const ys: number[] = []
  const xs: number[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (contour.data[y * W + x]! > 0) ys.push(y), xs.push(x)
  const interior = o.erode3(img(W, H, 1, mask))
  const iy: number[] = []
  const ix: number[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (interior.data[y * W + x]! > 0) iy.push(y), ix.push(x)

  const gray = o.cvtColor(image, o.cv.COLOR_BGR2GRAY) as U8
  const gx = o.sobel(gray, 1, 0)
  const gy = o.sobel(gray, 0, 1)
  const IW = image.width
  const gradient = new Float32Array(gx.data.length)
  for (let i = 0; i < gradient.length; i++) gradient[i] = f(Math.sqrt(f(f(gx.data[i]! * gx.data[i]!) + f(gy.data[i]! * gy.data[i]!))))
  const edges = o.canny(gray, 45, 120)
  const distance = o.distanceTransform(img(IW, H, 1, edges.data.map((v) => (v === 0 ? 1 : 0))), 3)
  const inside = o.distanceTransform(img(W, H, 1, mask), 3)
  const outside = o.distanceTransform(img(W, H, 1, mask.map((v) => 1 - v)), 3)
  const signed = img(W, H, 1, inside.data.map((v, i) => f(v - outside.data[i]!)))
  const sx = o.sobel(signed, 1, 0)
  const sy = o.sobel(signed, 0, 1)
  const nx = new Float32Array(ys.length)
  const ny = new Float32Array(ys.length)
  for (let k = 0; k < ys.length; k++) {
    const a = sx.data[ys[k]! * W + xs[k]!]!
    const b = sy.data[ys[k]! * W + xs[k]!]!
    const len = f(Math.max(f(Math.hypot(a, b)), 1e-6))
    nx[k] = f(a / len)
    ny[k] = f(b / len)
  }
  const slotGrayImg = o.cvtColor(img(W, H, 3, Uint8Array.from({ length: W * H * 3 }, (_, i) => slot.data[Math.floor(i / 3) * 4 + (i % 3)]!)), o.cv.COLOR_BGR2GRAY)
  const slotGray = new Float32Array(iy.length)
  for (let k = 0; k < iy.length; k++) slotGray[k] = slotGrayImg.data[iy[k]! * W + ix[k]!]!
  const slotMean = mean32(slotGray)
  for (let k = 0; k < slotGray.length; k++) slotGray[k] = f(slotGray[k]! - slotMean)
  const slotScale = Math.max(normF32(slotGray), 1e-6)

  const scores: number[] = []
  const corrs: number[] = []
  const a1 = new Float32Array(ys.length)
  const a3 = new Float32Array(ys.length)
  const cand = new Float32Array(iy.length)
  for (let off = 0; off <= IW - W; off++) {
    let covered = 0
    for (let k = 0; k < ys.length; k++) {
      const idx = ys[k]! * IW + xs[k]! + off
      const cd = distance.data[idx]!
      const cg = gradient[idx]!
      const align = f(f(Math.abs(f(f(gx.data[idx]! * nx[k]!) + f(gy.data[idx]! * ny[k]!)))) / f(Math.max(cg, 1e-6)))
      a1[k] = f(Math.exp(f(f(-cd) / f(1.7))))
      if (cd <= f(2.2)) covered++
      a3[k] = f(clip(f(cg / 500), 0, 1) * align)
    }
    const chamfer = mean32(a1)
    const coverage = covered / ys.length
    const oriented = mean32(a3)
    for (let k = 0; k < iy.length; k++) cand[k] = gray.data[iy[k]! * IW + ix[k]! + off]!
    const cm = mean32(cand)
    for (let k = 0; k < cand.length; k++) cand[k] = f(cand[k]! - cm)
    const corr = f(dotF32(slotGray, cand) / f(slotScale * Math.max(normF32(cand), 1e-6)))
    scores.push(1.2 * chamfer + 0.9 * coverage + 0.55 * oriented + 0.9 * Math.max(corr, 0))
    corrs.push(corr)
  }
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, i]) => i).reverse()
  const bestIndex = order[0]!
  const separated = order.filter((i) => Math.abs(i - bestIndex) >= 8)
  const runnerUp = separated.length ? scores[separated[0]!]! : 0
  const accepted = scores[bestIndex]! >= 1.9 && corrs[bestIndex]! >= 0.6
  return {
    retry: !accepted,
    reason: accepted ? '' : 'low-slider-confidence',
    solver: 'slider-contour-texture',
    offset: pyRound(bestIndex),
    score: pyRound(scores[bestIndex]!, 4),
    margin: pyRound(scores[bestIndex]! - runnerUp, 4),
    correlation: pyRound(corrs[bestIndex]!, 4),
  }
}

function normF32(a: Float32Array): number {
  const sq = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) sq[i] = f(a[i]! * a[i]!)
  return f(Math.sqrt(pairwiseSum(sq)))
}

function dotF32(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s = f(s + f(a[i]! * b[i]!))
  return s
}

// ---------------------------------------------------------------- tp=3 轨迹

/** 宽笔画中心的似然（_stroke_likelihood）。 */
export async function strokeLikelihood(lab: F32, background: U8): Promise<{ residual: Float32Array; likelihood: Float32Array }> {
  const o = await ops()
  const n = lab.width * lab.height
  const residual = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let c = 0; c < 3; c++) {
      const d = f(lab.data[i * 3 + c]! - background.data[i * 3 + c]!)
      s = f(s + f(d * d))
    }
    residual[i] = f(Math.sqrt(s))
  }
  const likelihood = new Float32Array(n)
  for (const t of [10, 15, 20, 25]) {
    const binary = new Uint8Array(n)
    for (let i = 0; i < n; i++) binary[i] = residual[i]! >= t ? 1 : 0
    const dist = o.distanceTransform(img(lab.width, lab.height, 1, binary), 5)
    for (let i = 0; i < n; i++) likelihood[i] = f(likelihood[i]! + clip(f(dist.data[i]! / 8), 0, 1))
  }
  for (let i = 0; i < n; i++) likelihood[i] = f(likelihood[i]! / 4)
  return { residual, likelihood }
}

/** 四个角点（_corners）：两条带角度的短边，返回 [左上, 右上, 左下, 右下]。 */
export function corners(p: number[]): [number, number][] {
  const end = (cx: number, cy: number, hw: number, deg: number): [[number, number], [number, number]] => {
    const a = deg * DEG_TO_RAD
    const vx = hw * Math.cos(a)
    const vy = hw * Math.sin(a)
    return [
      [cx - vx, cy - vy],
      [cx + vx, cy + vy],
    ]
  }
  const [tl, tr] = end(p[0]!, p[1]!, p[2]!, p[3]!)
  const [bl, br] = end(p[4]!, p[5]!, p[6]!, p[7]!)
  return [tl, tr, bl, br]
}

export const traceChain = (p: number[], topology: number[]): [number, number][] => {
  const c = corners(p)
  return topology.map((i) => [f(c[i]![0]), f(c[i]![1])])
}

export interface TraceMaps {
  lab: F32
  residual: F32
  texture: F32
  /** 几何显著性：0.25 × U2Net + 0.75 × 笔画似然。 */
  saliency: F32
  stroke?: F32
}

/** 一组四角参数的得分（_trace_score）；不合法的几何返回 -1000。 */
export function traceScore(maps: TraceMaps, params: number[], topology: number[]): number {
  const { width, height } = maps.lab
  const chain = traceChain(params, topology)
  const cxs = chain.map((c) => c[0])
  const cys = chain.map((c) => c[1])
  if (Math.min(...cxs) < 4 || Math.min(...cys) < 4 || Math.max(...cxs) >= width - 4 || Math.max(...cys) >= height - 4) return -1e3
  const sc = corners(params)
  const topMax = Math.max(sc[0]![1], sc[1]![1])
  const bottomMin = Math.min(sc[2]![1], sc[3]![1])
  if (topMax + 18 >= bottomMin) return -1e3
  if (topMax > height * 0.43 || bottomMin < height * 0.45 || sc[3]![1] > height * 0.72) return -1e3
  if (Math.max(sc[0]![0], sc[2]![0]) > width * 0.45 || Math.min(sc[1]![0], sc[3]![0]) < width * 0.65) return -1e3
  if (Math.abs(sc[1]![0] - sc[3]![0]) > width * 0.12) return -1e3

  const vectors = [0, 1, 2].map((i) => [f(chain[i + 1]![0] - chain[i]![0]), f(chain[i + 1]![1] - chain[i]![1])] as [number, number])
  const norms = vectors.map(([x, y]) => f(Math.sqrt(f(f(x * x) + f(y * y)))))
  if (f(f(norms[0]! + norms[1]!) + norms[2]!) < width * 0.98) return -1e3
  let turnPenalty = 0
  for (let i = 0; i < 2; i++) {
    const [a, b] = [vectors[i]!, vectors[i + 1]!]
    const denom = Math.max(f(norms[i]! * norms[i + 1]!), 1e-6)
    const cosine = clip(f(f(f(a[0] * b[0]) + f(a[1] * b[1])) / f(denom)), -1, 1)
    const angle = Math.acos(cosine) * RAD_TO_DEG
    if (angle < 28) turnPenalty += (28 - angle) * 4
    else if (angle > 152) turnPenalty += (angle - 152) * 4
  }

  const segScores: number[] = []
  for (let s = 0; s < 3; s++) {
    const start = chain[s]!
    const vec = vectors[s]!
    const length = norms[s]!
    if (length < 35) return -1e3
    const unit = [f(vec[0] / length), f(vec[1] / length)]
    const normal = [f(-unit[1]!), unit[0]!]
    const num = Math.max(12, Math.trunc(f(length / f(2.5))))
    const cx = new Float64Array(num)
    const cy = new Float64Array(num)
    const step = (0.98 - 0.02) / (num - 1)
    for (let i = 0; i < num; i++) {
      const r = i === num - 1 ? 0.98 : i * step + 0.02
      cx[i] = start[0] + r * vec[0]
      cy[i] = start[1] + r * vec[1]
    }
    const shifted = (k: number) => {
      const nxk = f(normal[0]! * f(k))
      const nyk = f(normal[1]! * f(k))
      return [Array.from(cx, (v) => v + nxk), Array.from(cy, (v) => v + nyk)] as const
    }
    const sample = (m: F32, k: number) => {
      const [xs, ys] = shifted(k)
      return remap(m, xs, ys)
    }
    let bestEdge = -1e3
    for (const radius of [5, 7, 9, 11, 13]) {
      const inner = Math.max(1, radius - 2)
      const outer = radius + 4
      const li = sample(maps.lab, inner)
      const lo = sample(maps.lab, outer)
      const ri = sample(maps.lab, -inner)
      const ro = sample(maps.lab, -outer)
      const vals = new Float32Array(num)
      for (let i = 0; i < num; i++) {
        const nrm = (a: Float32Array, b: Float32Array) => {
          let q = 0
          for (let c = 0; c < 3; c++) {
            const d = f(a[i * 3 + c]! - b[i * 3 + c]!)
            q = f(q + f(d * d))
          }
          return f(Math.sqrt(q))
        }
        vals[i] = clip(Math.min(nrm(li, lo), nrm(ri, ro)), 0, 45)
      }
      bestEdge = Math.max(bestEdge, mean32(vals))
    }
    const r1 = sample(maps.residual, -4)
    const r2 = sample(maps.residual, 0)
    const r3 = sample(maps.residual, 4)
    const resid = new Float32Array(num).map((_, i) => clip(Math.max(r1[i]!, r2[i]!, r3[i]!), 0, 45))
    const residualScore = mean32(resid)
    const ct = sample(maps.texture, 0)
    const t1 = sample(maps.texture, 15)
    const t2 = sample(maps.texture, -15)
    const tex = new Float32Array(num).map((_, i) => clip(f(f(0.5 * f(t1[i]! + t2[i]!)) - ct[i]!), -30, 30))
    const textureScore = mean32(tex)
    const cs = sample(maps.saliency, 0)
    const s1 = sample(maps.saliency, 16)
    const s2 = sample(maps.saliency, -16)
    const sal = new Float32Array(num).map((_, i) => clip(f(cs[i]! - f(0.5 * f(s1[i]! + s2[i]!))), f(-0.45), 1))
    const saliencyScore = mean32(sal) * 45
    segScores.push(bestEdge + 1.15 * residualScore + 0.75 * textureScore + 1.35 * saliencyScore)
  }
  return (segScores[0]! + segScores[1]! + segScores[2]!) / 3 - turnPenalty
}

/** 与 scipy differential_evolution 同算法（best1bin、拉丁超立方初始化、抖动变异、tol 收敛、局部精修）。 */
export function differentialEvolution(
  fn: (x: number[]) => number,
  bounds: [number, number][],
  options: { seed: number; popsize: number; maxiter: number; tol?: number; recombination?: number; mutation?: [number, number] },
): { x: number[]; fun: number } {
  const rng = mulberry32(options.seed)
  const N = bounds.length
  const NP = options.popsize * N
  const tol = options.tol ?? 0.01
  const CR = options.recombination ?? 0.7
  const [mLo, mHi] = options.mutation ?? [0.5, 1]
  const scale = (u: number[]) => u.map((v, i) => bounds[i]![0] + v * (bounds[i]![1] - bounds[i]![0]))
  // 拉丁超立方
  const pop: number[][] = Array.from({ length: NP }, (_, i) => Array.from({ length: N }, () => (rng() + i) / NP))
  for (let j = 0; j < N; j++) {
    for (let i = NP - 1; i > 0; i--) {
      const k = Math.floor(rng() * (i + 1))
      ;[pop[i]![j], pop[k]![j]] = [pop[k]![j]!, pop[i]![j]!]
    }
  }
  const energies = pop.map((u) => fn(scale(u)))
  let best = energies.indexOf(Math.min(...energies))
  for (let gen = 0; gen < options.maxiter; gen++) {
    const F = mLo + rng() * (mHi - mLo)
    for (let i = 0; i < NP; i++) {
      const pick = () => {
        let r: number
        do r = Math.floor(rng() * NP)
        while (r === i)
        return r
      }
      let r0 = pick()
      let r1 = pick()
      while (r1 === r0) r1 = pick()
      const b = pop[best]!
      const trial = pop[i]!.slice()
      const fill = Math.floor(rng() * N)
      for (let j = 0; j < N; j++) {
        if (j === fill || rng() < CR) trial[j] = b[j]! + F * (pop[r0]![j]! - pop[r1]![j]!)
        if (trial[j]! < 0 || trial[j]! > 1) trial[j] = rng()
      }
      const e = fn(scale(trial))
      if (e <= energies[i]!) {
        pop[i] = trial
        energies[i] = e
        if (e <= energies[best]!) best = i
      }
    }
    const m = energies.reduce((a, b) => a + b, 0) / NP
    const sd = Math.sqrt(energies.reduce((a, b) => a + (b - m) ** 2, 0) / NP)
    if (sd <= tol * Math.abs(m)) break
  }
  // 局部精修：有界的坐标搜索（代替 L-BFGS-B）
  let x = pop[best]!.slice()
  let fx = energies[best]!
  let stepSize = 0.02
  for (let iter = 0; iter < 60 && stepSize > 1e-4; iter++) {
    let improved = false
    for (let j = 0; j < N; j++) {
      for (const dir of [1, -1]) {
        const y = x.slice()
        y[j] = Math.min(1, Math.max(0, y[j]! + dir * stepSize))
        const fy = fn(scale(y))
        if (fy < fx) {
          x = y
          fx = fy
          improved = true
        }
      }
    }
    if (!improved) stepSize /= 2
  }
  return { x: scale(x), fun: fx }
}

/** 轨迹打分用的几张图（solve_trace 的前半段）：LAB、残差、纹理、几何显著性。 */
export async function traceMaps(image: U8, saliency: F32): Promise<TraceMaps> {
  const o = await ops()
  const labU8 = o.cvtColor(image, o.cv.COLOR_BGR2Lab) as U8
  const lab = img(image.width, image.height, 3, Float32Array.from(labU8.data))
  const background = o.medianBlur(labU8, 31)
  const { residual, likelihood } = await strokeLikelihood(lab, background)
  const geo = new Float32Array(likelihood.length)
  for (let i = 0; i < geo.length; i++) geo[i] = f(f(0.25 * saliency.data[i]!) + f(0.75 * likelihood[i]!))
  const gray = o.cvtColor(image, o.cv.COLOR_BGR2GRAY)
  const grayF = img(gray.width, gray.height, 1, Float32Array.from(gray.data))
  const gx = o.sobel(grayF, 1, 0)
  const gy = o.sobel(grayF, 0, 1)
  const mag = img(gray.width, gray.height, 1, gx.data.map((v, i) => f(Math.sqrt(f(f(v * v) + f(gy.data[i]! * gy.data[i]!))))))
  return {
    lab,
    residual: img(image.width, image.height, 1, residual),
    texture: o.gaussian(mag, 3),
    saliency: img(image.width, image.height, 1, geo),
    stroke: img(image.width, image.height, 1, likelihood),
  }
}

/** 四角轨迹（solve_trace）：显著性 + 笔画似然 + 纹理，拟合完整的四顶点形状。 */
export async function solveTrace(image: U8, modelPath: string): Promise<Solution> {
  const saliency = await u2netSaliency(image, modelPath)
  const skeletonSolution = await extractConfidentPath(saliency)
  const maps = await traceMaps(image, saliency)
  const { width, height } = image
  const bounds: [number, number][] = [
    [width * 0.32, width * 0.68],
    [height * 0.1, height * 0.48],
    [width * 0.12, width * 0.43],
    [-35, 35],
    [width * 0.32, width * 0.68],
    [height * 0.45, height * 0.9],
    [width * 0.12, width * 0.43],
    [-35, 35],
  ]
  let best: { score: number; chain: [number, number][] } | null = null
  for (const topology of [
    [0, 1, 2, 3],
    [0, 2, 1, 3],
  ]) {
    const r = differentialEvolution((p) => -traceScore(maps, p, topology), bounds, { seed: 17, popsize: 8, maxiter: 32 })
    const cand = { score: -r.fun, chain: traceChain(r.x, topology) }
    if (!best || cand.score > best.score) best = cand
  }
  if (!best || best.score < 55) {
    return { retry: true, reason: 'low-geometric-confidence', score: pyRound(best?.score ?? 0), saliencyScore: skeletonSolution.score ?? 0 }
  }
  const path = best.chain.map(([x, y]) => [pyRoundInt(y), pyRoundInt(x)] as Node)
  return { retry: false, solver: 'four-corner-geometric', score: pyRound(best.score), points: await resamplePath(path) }
}

