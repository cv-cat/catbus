import { fromMat, toMat, type U8, withMats } from '../../../../core/image.js'

/**
 * OpenCV 5.0 的 LineSegmentDetector（modules/imgproc/src/lsd.cpp，LSD_REFINE_STD，默认参数）移植。
 * opencv-js 没有编译进 LSD；这里逐行照搬，C++ 里的 float 运算用 Math.fround 模拟。
 * 返回 float32 的线段 (x1, y1, x2, y2)。
 */

const f = Math.fround
const PI = Math.PI
const M_3_2_PI = (3 * PI) / 2
const M_2__PI = 2 * PI
const NOTDEF = -1024.0
const DEG_TO_RADS = PI / 180

const P1 = f(f(0.9997878412794807) * f(180 / PI))
const P3 = f(f(-0.3258083974640975) * f(180 / PI))
const P5 = f(f(0.1555786518463281) * f(180 / PI))
const P7 = f(f(-0.04432655554792128) * f(180 / PI))
const EPS = f(2.220446049250313e-16)

/** cv::fastAtan2（桌面版多项式近似，单位度）。 */
export function fastAtan2(y: number, x: number): number {
  y = f(y)
  x = f(x)
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const poly = (c: number) => {
    const c2 = f(c * c)
    let t = f(P7 * c2)
    t = f(t + P5)
    t = f(t * c2)
    t = f(t + P3)
    t = f(t * c2)
    t = f(t + P1)
    return f(t * c)
  }
  let a: number
  if (ax >= ay) a = poly(f(ay / f(ax + EPS)))
  else a = f(90 - poly(f(ax / f(ay + EPS))))
  if (x < 0) a = f(180 - a)
  if (y < 0) a = f(360 - a)
  return a
}

function angleDiffSigned(a: number, b: number): number {
  let diff = a - b
  while (diff <= -PI) diff += M_2__PI
  while (diff > PI) diff -= M_2__PI
  return diff
}

const angleDiff = (a: number, b: number) => Math.abs(angleDiffSigned(a, b))
const distSq = (x1: number, y1: number, x2: number, y2: number) => (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)
const dist = (x1: number, y1: number, x2: number, y2: number) => Math.sqrt(distSq(x1, y1, x2, y2))

function doubleEqual(a: number, b: number): boolean {
  if (a === b) return true
  const absDiff = Math.abs(a - b)
  let absMax = Math.max(Math.abs(a), Math.abs(b))
  if (absMax < 2.2250738585072014e-308) absMax = 2.2250738585072014e-308
  return absDiff / absMax <= 100.0 * 2.220446049250313e-16
}

interface RegionPoint {
  x: number
  y: number
  angle: number
  modgrad: number
}

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  x: number
  y: number
  theta: number
  dx: number
  dy: number
  prec: number
  p: number
}

export type Segment = [number, number, number, number]

/** cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD).detect(gray)[0]。gray 是 8 位单通道。 */
export function detectLines(cv: any, gray: U8): Segment[] {
  const SCALE = 0.8
  const SIGMA_SCALE = 0.6
  const QUANT = 2.0
  const ANG_TH = 22.5
  const DENSITY_TH = 0.7
  const N_BINS = 1024
  const prec = (PI * ANG_TH) / 180
  const p = ANG_TH / 180
  const rho = QUANT / Math.sin(prec)

  // GaussianBlur + resize(INTER_LINEAR_EXACT)
  const scaled = withMats((keep) => {
    const src = keep(toMat(cv, gray))
    const blurred = keep(new cv.Mat())
    const sigma = SIGMA_SCALE / SCALE
    const h = Math.ceil(sigma * Math.sqrt(2 * 3 * Math.log(10.0))) >>> 0
    cv.GaussianBlur(src, blurred, new cv.Size(1 + 2 * h, 1 + 2 * h), sigma)
    const out = keep(new cv.Mat())
    cv.resize(blurred, out, new cv.Size(0, 0), SCALE, SCALE, cv.INTER_LINEAR_EXACT)
    return fromMat(cv, out) as U8
  })

  const W = scaled.width
  const H = scaled.height
  const px = scaled.data
  const angles = new Float64Array(W * H)
  const modgrad = new Float64Array(W * H)
  for (let x = 0; x < W; x++) angles[(H - 1) * W + x] = NOTDEF
  for (let y = 0; y < H; y++) angles[y * W + W - 1] = NOTDEF

  // ll_angle
  let maxGrad = -1
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const DA = px[(y + 1) * W + x + 1]! - px[y * W + x]!
      const BC = px[y * W + x + 1]! - px[(y + 1) * W + x]!
      const gx = DA + BC
      const gy = DA - BC
      const norm = Math.sqrt((gx * gx + gy * gy) / 4.0)
      modgrad[y * W + x] = norm
      if (norm <= rho) angles[y * W + x] = NOTDEF
      else {
        angles[y * W + x] = fastAtan2(gx, -gy) * DEG_TO_RADS
        if (norm > maxGrad) maxGrad = norm
      }
    }
  }
  const binCoef = maxGrad > 0 ? (N_BINS - 1) / maxGrad : 0
  const ordered: { x: number; y: number; norm: number }[] = []
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) ordered.push({ x, y, norm: Math.trunc(modgrad[y * W + x]! * binCoef) })
  ordered.sort((a, b) => b.norm - a.norm)

  const LOG_NT = (5 * (Math.log10(W) + Math.log10(H))) / 2 + Math.log10(11.0)
  const minRegSize = Math.trunc(-LOG_NT / Math.log10(p))
  const used = new Uint8Array(W * H)

  const isAligned = (x: number, y: number, theta: number, pr: number): boolean => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false
    const a = angles[y * W + x]!
    if (a === NOTDEF) return false
    let n = theta - a
    if (n < 0) n = -n
    if (n > M_3_2_PI) {
      n -= M_2__PI
      if (n < 0) n = -n
    }
    return n <= pr
  }

  const regionGrow = (sx: number, sy: number, reg: RegionPoint[], pr: number): number => {
    reg.length = 0
    let regAngle = angles[sy * W + sx]!
    reg.push({ x: sx, y: sy, angle: regAngle, modgrad: modgrad[sy * W + sx]! })
    let sumdx = f(Math.cos(regAngle))
    let sumdy = f(Math.sin(regAngle))
    used[sy * W + sx] = 1
    for (let i = 0; i < reg.length; i++) {
      const r = reg[i]!
      const xxMin = Math.max(r.x - 1, 0)
      const xxMax = Math.min(r.x + 1, W - 1)
      const yyMin = Math.max(r.y - 1, 0)
      const yyMax = Math.min(r.y + 1, H - 1)
      for (let yy = yyMin; yy <= yyMax; yy++) {
        for (let xx = xxMin; xx <= xxMax; xx++) {
          const k = yy * W + xx
          if (used[k] !== 1 && isAligned(xx, yy, regAngle, pr)) {
            const angle = angles[k]!
            used[k] = 1
            reg.push({ x: xx, y: yy, angle, modgrad: modgrad[k]! })
            sumdx = f(sumdx + f(Math.cos(f(angle))))
            sumdy = f(sumdy + f(Math.sin(f(angle))))
            regAngle = fastAtan2(sumdy, sumdx) * DEG_TO_RADS
          }
        }
      }
    }
    return regAngle
  }

  const getTheta = (reg: RegionPoint[], x: number, y: number, regAngle: number, pr: number): number => {
    let Ixx = 0
    let Iyy = 0
    let Ixy = 0
    for (const r of reg) {
      const dx = r.x - x
      const dy = r.y - y
      Ixx += dy * dy * r.modgrad
      Iyy += dx * dx * r.modgrad
      Ixy -= dx * dy * r.modgrad
    }
    if (doubleEqual(Ixx, 0) && doubleEqual(Iyy, 0) && doubleEqual(Ixy, 0)) throw new Error('LSD: 惯性矩阵为零')
    const lambda = 0.5 * (Ixx + Iyy - Math.sqrt((Ixx - Iyy) * (Ixx - Iyy) + 4.0 * Ixy * Ixy))
    let theta = Math.abs(Ixx) > Math.abs(Iyy) ? fastAtan2(lambda - Ixx, Ixy) : fastAtan2(Ixy, lambda - Iyy)
    theta *= DEG_TO_RADS
    if (angleDiff(theta, regAngle) > pr) theta += PI
    return theta
  }

  const region2rect = (reg: RegionPoint[], regAngle: number, pr: number, pp: number): Rect => {
    let x = 0
    let y = 0
    let sum = 0
    for (const r of reg) {
      x += r.x * r.modgrad
      y += r.y * r.modgrad
      sum += r.modgrad
    }
    if (!(sum > 0)) throw new Error('LSD: 权重和为零')
    x /= sum
    y /= sum
    const theta = getTheta(reg, x, y, regAngle, pr)
    const dx = Math.cos(theta)
    const dy = Math.sin(theta)
    let lMin = 0
    let lMax = 0
    let wMin = 0
    let wMax = 0
    for (const r of reg) {
      const rdx = r.x - x
      const rdy = r.y - y
      const l = rdx * dx + rdy * dy
      const w = -rdx * dy + rdy * dx
      if (l > lMax) lMax = l
      else if (l < lMin) lMin = l
      if (w > wMax) wMax = w
      else if (w < wMin) wMin = w
    }
    const rec: Rect = { x1: x + lMin * dx, y1: y + lMin * dy, x2: x + lMax * dx, y2: y + lMax * dy, width: wMax - wMin, x, y, theta, dx, dy, prec: pr, p: pp }
    if (rec.width < 1.0) rec.width = 1.0
    return rec
  }

  const reduceRegionRadius = (reg: RegionPoint[], regAngle: number, pr: number, pp: number, rec: Rect, density: number): Rect | null => {
    const xc = reg[0]!.x
    const yc = reg[0]!.y
    const r1 = distSq(xc, yc, rec.x1, rec.y1)
    const r2 = distSq(xc, yc, rec.x2, rec.y2)
    let radSq = r1 > r2 ? r1 : r2
    while (density < DENSITY_TH) {
      radSq *= 0.75 * 0.75
      for (let i = 0; i < reg.length; i++) {
        if (distSq(xc, yc, reg[i]!.x, reg[i]!.y) > radSq) {
          used[reg[i]!.y * W + reg[i]!.x] = 0
          const last = reg.length - 1
          ;[reg[i], reg[last]] = [reg[last]!, reg[i]!]
          reg.pop()
          i--
        }
      }
      if (reg.length < 2) return null
      rec = region2rect(reg, regAngle, pr, pp)
      density = reg.length / (dist(rec.x1, rec.y1, rec.x2, rec.y2) * rec.width)
    }
    return rec
  }

  const refine = (reg: RegionPoint[], regAngle: number, pr: number, pp: number, rec: Rect): Rect | null => {
    let density = reg.length / (dist(rec.x1, rec.y1, rec.x2, rec.y2) * rec.width)
    if (density >= DENSITY_TH) return rec
    const xc = reg[0]!.x
    const yc = reg[0]!.y
    const angC = reg[0]!.angle
    let sum = 0
    let sSum = 0
    let n = 0
    for (const r of reg) {
      used[r.y * W + r.x] = 0
      if (dist(xc, yc, r.x, r.y) < rec.width) {
        const d = angleDiffSigned(r.angle, angC)
        sum += d
        sSum += d * d
        n++
      }
    }
    if (n <= 0) throw new Error('LSD: refine 没有点')
    const mean = sum / n
    const tau = 2.0 * Math.sqrt((sSum - 2.0 * mean * sum) / n + mean * mean)
    regAngle = regionGrow(xc, yc, reg, tau)
    if (reg.length < 2) return null
    rec = region2rect(reg, regAngle, pr, pp)
    density = reg.length / (dist(rec.x1, rec.y1, rec.x2, rec.y2) * rec.width)
    if (density < DENSITY_TH) return reduceRegionRadius(reg, regAngle, pr, pp, rec, density)
    return rec
  }

  const lines: Segment[] = []
  const reg: RegionPoint[] = []
  for (const pt of ordered) {
    const k = pt.y * W + pt.x
    if (used[k] !== 0 || angles[k] === NOTDEF) continue
    const regAngle = regionGrow(pt.x, pt.y, reg, prec)
    if (reg.length < minRegSize) continue
    let rec: Rect | null = region2rect(reg, regAngle, prec, p)
    rec = refine(reg, regAngle, prec, p, rec)
    if (!rec) continue
    lines.push([f((rec.x1 + 0.5) / SCALE), f((rec.y1 + 0.5) / SCALE), f((rec.x2 + 0.5) / SCALE), f((rec.y2 + 0.5) / SCALE)])
  }
  return lines
}

