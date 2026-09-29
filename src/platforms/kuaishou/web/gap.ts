import { decodeImage, loadCv, type Rgba } from '../../../core/image.js'

/**
 * 滑块缺口定位（上游 utils/captcha.py 的 find_gap_x，cv2 + numpy + Pillow）。
 * 图片解码与 OpenCV 用 core/image.ts（PNG 与 Pillow 逐像素一致，半透明像素不经过预乘）。
 * numpy 的部分照原样用 float32 重写。
 */

/** 解码验证码图片（RGBA，与 Pillow 的 `convert("RGBA")` 相同）。 */
async function decode(buf: Uint8Array): Promise<Rgba> {
  const img = await decodeImage(buf)
  if (!img) throw new Error('无法解码验证码图片')
  return img
}

/** RGBA 的一个矩形区域 → BGR 交错像素（`cv2.cvtColor(rgb, COLOR_RGB2BGR)`）。 */
function bgr(img: Rgba, x0 = 0, y0 = 0, w = img.width, h = img.height): Uint8Array {
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.width + x0 + x) * 4
      const d = (y * w + x) * 3
      out[d] = img.rgba[s + 2]!
      out[d + 1] = img.rgba[s + 1]!
      out[d + 2] = img.rgba[s]!
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
  const bgImg = await decode(bgPng)
  const cut = await decode(cutPng)

  let x0 = Infinity
  let x1 = -1
  let y0 = Infinity
  let y1 = -1
  for (let y = 0; y < cut.height; y++) {
    for (let x = 0; x < cut.width; x++) {
      if (cut.rgba[(y * cut.width + x) * 4 + 3]! > 32) {
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
  for (let y = 0; y < pieceH; y++) for (let x = 0; x < pieceW; x++) maskData[y * pieceW + x] = cut.rgba[((y0 + y) * cut.width + x0 + x) * 4 + 3]! > 32 ? 255 : 0

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
