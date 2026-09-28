import { CatbusError } from '../../../core/errors.js'
import { classify, crop, decodeImage, detect, type Rgb } from './ddddocr.js'

/**
 * 极验点选识别（上游 utils/geetest_ocr.py、geetest_metric.py、geetest_hybrid.py）：
 * 1. 题图切成拼图（上面）和提示条（底部 40px），ddddocr 检测模型分别找字框，合并同一个字的重叠框；
 * 2. 每个字框抠出来过 ddddocr 识别模型，取 CTC 各时间步的字符概率最大值作为向量（不需要认对字）；
 * 3. 提示字与候选字两两算余弦相似度，匈牙利算法求一一对应，按提示条从左到右的顺序输出点击坐标。
 */

export const HINT_HEIGHT = 40
const PAD = 4

export type Box = [number, number, number, number]

/** 切成拼图和提示条（split_sprite）。 */
export function splitSprite(sprite: Rgb): { puzzle: Rgb; hint: Rgb } {
  const { width, height } = sprite
  return { puzzle: crop(sprite, 0, 0, width, height - HINT_HEIGHT), hint: crop(sprite, 0, height - HINT_HEIGHT, width, height) }
}

/** 检测字符框，按 x1 从左到右（detect_boxes，稳定排序）。 */
export async function detectBoxes(im: Rgb): Promise<Box[]> {
  return ((await detect(im)) as Box[]).map((b, i) => [b, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([b]) => b)
}

function intersectionRatio(a: Box, b: Box): number {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const areaA = Math.max(1, (a[2] - a[0]) * (a[3] - a[1]))
  const areaB = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]))
  return inter / Math.min(areaA, areaB)
}

const byX = (list: Box[]) =>
  list
    .map((b, i) => [b, i] as const)
    .sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1])
    .map(([b]) => b)

/** 合并同一个彩色字的重叠框（merge_duplicate_boxes）：交集占较小框的比例 ≥ threshold 的连成一组取并集。 */
export function mergeDuplicateBoxes(boxes: Box[], threshold = 0.25): Box[] {
  const groups: Box[][] = []
  for (const box of byX(boxes.map((b) => b.map((v) => Math.trunc(v)) as Box))) {
    const hits = groups.map((g, i) => (g.some((old) => intersectionRatio(box, old) >= threshold) ? i : -1)).filter((i) => i >= 0)
    if (!hits.length) {
      groups.push([box])
      continue
    }
    const target = groups[hits[0]!]!
    target.push(box)
    for (const index of hits.slice(1).reverse()) target.push(...groups.splice(index, 1)[0]!)
  }
  return byX(
    groups.map((g) => [Math.min(...g.map((b) => b[0])), Math.min(...g.map((b) => b[1])), Math.max(...g.map((b) => b[2])), Math.max(...g.map((b) => b[3]))] as Box),
  )
}

/** 提示条相邻字框重叠时，从两框交界的中点切开（_split_overlaps）。 */
export function splitOverlaps(boxes: Box[]): Box[] {
  const fixed = boxes.map((b) => [...b] as Box)
  for (let i = 0; i < fixed.length - 1; i++) {
    const right = fixed[i]![2]
    const left = fixed[i + 1]![0]
    if (right > left) {
      const mid = Math.floor((right + left) / 2)
      fixed[i]![2] = mid
      fixed[i + 1]![0] = mid
    }
  }
  return fixed
}

function cropPad(im: Rgb, [x1, y1, x2, y2]: Box, pad: number): Rgb {
  return crop(im, Math.max(0, x1 - pad), Math.max(0, y1 - pad), Math.min(im.width, x2 + pad), Math.min(im.height, y2 + pad))
}

/** CTC 概率压成单位向量：各时间步取最大值，去掉 blank（下标 0），再归一化（probability_vector）。 */
export function probabilityVector(probabilities: Float32Array, steps: number, classes: number): Float64Array {
  const v = new Float64Array(classes)
  for (let t = 0; t < steps; t++) for (let c = 0; c < classes; c++) v[c] = Math.max(v[c]!, probabilities[t * classes + c]!)
  v[0] = 0
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) + 1e-9
  for (let c = 0; c < classes; c++) v[c]! /= norm
  return v
}

async function signature(im: Rgb): Promise<{ text: string; vector: Float64Array }> {
  const r = await classify(im)
  return { text: r.text, vector: probabilityVector(r.probabilities, r.steps, r.classes) }
}

/**
 * 矩形指派问题（scipy.optimize.linear_sum_assignment，最小化），照抄 scipy 的 rectangular_lsap.cpp
 * （Crouse 的最短增广路），平局时的取法也一致。返回 [行下标, 列下标]。
 */
export function linearSumAssignment(cost: number[][]): [number[], number[]] {
  let nr = cost.length
  let nc = nr ? cost[0]!.length : 0
  if (!nr || !nc) return [[], []]
  const transpose = nc < nr
  let c: number[]
  if (transpose) {
    c = new Array(nr * nc)
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) c[j * nr + i] = cost[i]![j]!
    ;[nr, nc] = [nc, nr]
  } else c = cost.flat()
  if (c.some((x) => Number.isNaN(x) || x === -Infinity)) throw new Error('指派矩阵含 NaN 或 -inf')

  const u = new Array<number>(nr).fill(0)
  const v = new Array<number>(nc).fill(0)
  const shortest = new Array<number>(nc)
  const path = new Array<number>(nc).fill(-1)
  const col4row = new Array<number>(nr).fill(-1)
  const row4col = new Array<number>(nc).fill(-1)
  const SR = new Array<boolean>(nr)
  const SC = new Array<boolean>(nc)
  const remaining = new Array<number>(nc)

  for (let cur = 0; cur < nr; cur++) {
    let minVal = 0
    let i = cur
    let num = nc
    for (let it = 0; it < nc; it++) remaining[it] = nc - it - 1
    SR.fill(false)
    SC.fill(false)
    shortest.fill(Infinity)
    let sink = -1
    while (sink === -1) {
      let index = -1
      let lowest = Infinity
      SR[i] = true
      for (let it = 0; it < num; it++) {
        const j = remaining[it]!
        const r = minVal + c[i * nc + j]! - u[i]! - v[j]!
        if (r < shortest[j]!) {
          path[j] = i
          shortest[j] = r
        }
        if (shortest[j]! < lowest || (shortest[j] === lowest && row4col[j] === -1)) {
          lowest = shortest[j]!
          index = it
        }
      }
      minVal = lowest
      if (minVal === Infinity) throw new Error('指派问题无可行解')
      const j = remaining[index]!
      if (row4col[j] === -1) sink = j
      else i = row4col[j]!
      SC[j] = true
      remaining[index] = remaining[--num]!
    }
    u[cur]! += minVal
    for (let r = 0; r < nr; r++) if (SR[r] && r !== cur) u[r]! += minVal - shortest[col4row[r]!]!
    for (let j = 0; j < nc; j++) if (SC[j]) v[j]! -= minVal - shortest[j]!
    let j = sink
    for (;;) {
      const r = path[j]!
      row4col[j] = r
      ;[col4row[r], j] = [j, col4row[r]!]
      if (r === cur) break
    }
  }

  if (transpose) {
    const order = col4row.map((col, row) => [col, row] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    return [order.map(([col]) => col), order.map(([, row]) => row)]
  }
  return [col4row.map((_, i) => i), col4row]
}

export interface ClickSolution {
  /** 按提示顺序排列的点击坐标（拼图内的像素坐标）。 */
  order: [number, number][]
  match: { hint: number; puzzle: number; score: number }[]
  scoreMatrix: number[][]
  hintText: string[]
  candChars: string[]
  orderedChars: string[]
  warnings: string[]
  hintBoxes: Box[]
  puzzleBoxes: Box[]
  rawPuzzleBoxes: Box[]
  puzzleSize: [number, number]
}

const pyList = (xs: (string | number)[]) => `[${xs.map((x) => (typeof x === 'string' ? `'${x}'` : String(x))).join(', ')}]`
const round4 = (x: number) => Math.round(x * 1e4) / 1e4

/** 点选识别：geetest_metric.solve，再加上 geetest_hybrid.solve 的旁证告警。 */
export async function solveClick(spriteBytes: Uint8Array): Promise<ClickSolution> {
  const sprite = await decodeImage(spriteBytes)
  const { puzzle, hint } = splitSprite(sprite)
  const rawPuzzleBoxes = await detectBoxes(puzzle)
  const puzzleBoxes = mergeDuplicateBoxes(rawPuzzleBoxes)
  // 提示条相邻字会轻微相交，只合并高度嵌套的重复框，再切开相邻边界
  const hintBoxes = splitOverlaps(mergeDuplicateBoxes(await detectBoxes(hint), 0.75))

  const hints: { text: string; vector: Float64Array }[] = []
  for (const box of hintBoxes) hints.push(await signature(cropPad(hint, box, 2)))
  const cands: { text: string; vector: Float64Array }[] = []
  for (const box of puzzleBoxes) cands.push(await signature(cropPad(puzzle, box, PAD)))
  if (!hints.length || cands.length < hints.length) {
    throw new CatbusError('RISK_CONTROL', `点选识别的检测框不足：提示 ${hints.length}，候选 ${cands.length}`, { detail: { kind: 'captcha' } })
  }

  const score = hints.map((h) =>
    cands.map((p) => {
      let dot = 0
      for (let i = 0; i < h.vector.length; i++) dot += h.vector[i]! * p.vector[i]!
      return Math.fround(dot)
    }),
  )
  const [rows, cols] = linearSumAssignment(score.map((r) => r.map((x) => -x)))
  const pairs = rows.map((r, i) => [r, cols[i]!] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const order: [number, number][] = []
  const match: ClickSolution['match'] = []
  for (const [h, p] of pairs) {
    const box = puzzleBoxes[p]!
    order.push([Math.floor((box[0] + box[2]) / 2), Math.floor((box[1] + box[3]) / 2)])
    match.push({ hint: h, puzzle: p, score: round4(score[h]![p]!) })
  }

  const candChars = cands.map((c) => c.text)
  const orderedChars = match.map((m) => candChars[m.puzzle]!)
  const warnings: string[] = []
  const low = match.filter((m) => m.score < 0.2)
  if (low.length) warnings.push(`${low.length} 个模型匹配低于 0.20，建议刷新题面`)
  const blank = candChars.flatMap((c, i) => (c ? [] : [i + 1]))
  if (blank.length) warnings.push(`候选 ${pyList(blank)} ddddocr 认不出，字形匹配无旁证`)
  const dupes = [...new Set(orderedChars.filter((c) => c && orderedChars.indexOf(c) !== orderedChars.lastIndexOf(c)))].sort()
  if (dupes.length) warnings.push(`点击序列里出现重复字 ${pyList(dupes)}，可能有两个提示位指到了同一类字形`)

  return {
    order,
    match,
    scoreMatrix: score.map((r) => r.map(round4)),
    hintText: hints.map((h) => h.text),
    candChars,
    orderedChars,
    warnings: [...new Set(warnings)],
    hintBoxes,
    puzzleBoxes,
    rawPuzzleBoxes,
    puzzleSize: [puzzle.width, puzzle.height],
  }
}
