import { CatbusError } from './errors.js'

/**
 * MP4 / MOV 的视频轨信息：只读 moov 里的盒子，不解码（替代上游的 ffmpeg / opencv 探测）。
 * 各平台按上游的算法从这些原始值算出尺寸、时长、帧率。
 */
export interface Mp4VideoTrack {
  /** tkhd 的显示尺寸（16.16 定点数取整）。 */
  displayWidth: number
  displayHeight: number
  /** stsd 视觉样本项里的编码尺寸；没有样本项时为 0。 */
  codedWidth: number
  codedHeight: number
  /** tkhd 矩阵的旋转角（度，0–359），与 ffmpeg 的 display matrix 一致。 */
  rotation: number
  /** mdhd 的时间刻度与时长。 */
  timescale: number
  duration: number
  /** stts：样本数之和、样本时长之和（ffmpeg 的 nb_frames_for_fps / duration_for_fps）。 */
  sttsSamples: number
  sttsDuration: number
  /** stsz 的样本数（ffmpeg 的 nb_frames）；没有 stsz 时取 stts 的样本数。 */
  sampleCount: number
}

interface Box {
  type: string
  start: number
  end: number
}

/** 第一条视频轨（hdlr 为 vide）。不是 MP4 / MOV 时报 USAGE。 */
export function mp4VideoTrack(data: Uint8Array): Mp4VideoTrack {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const boxes = (start: number, end: number): Box[] => {
    const out: Box[] = []
    let p = start
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      let header = 8
      if (size === 1) {
        if (p + 16 > end) break
        size = Number(buf.readBigUInt64BE(p + 8))
        header = 16
      } else if (size === 0) size = end - p
      if (size < header || p + size > end) break
      out.push({ type, start: p + header, end: p + size })
      p += size
    }
    return out
  }
  const find = (list: Box[], type: string) => list.find((b) => b.type === type)
  const moov = find(boxes(0, buf.length), 'moov')
  if (!moov) throw new CatbusError('USAGE', '只支持 MP4 / MOV 视频（找不到 moov）')
  for (const trak of boxes(moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const inner = boxes(trak.start, trak.end)
    const mdia = find(inner, 'mdia')
    const tkhd = find(inner, 'tkhd')
    if (!mdia || !tkhd) continue
    const mdiaBoxes = boxes(mdia.start, mdia.end)
    const hdlr = find(mdiaBoxes, 'hdlr')
    if (!hdlr || buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue

    // tkhd 末尾：矩阵 9 × int32，然后宽、高（16.16）
    const displayWidth = Math.round(buf.readUInt32BE(tkhd.end - 8) / 65536)
    const displayHeight = Math.round(buf.readUInt32BE(tkhd.end - 4) / 65536)
    const matrix = tkhd.end - 8 - 36
    const a = buf.readInt32BE(matrix) / 65536
    const b = buf.readInt32BE(matrix + 4) / 65536
    const rotation = (((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360) || 0

    const mdhd = find(mdiaBoxes, 'mdhd')
    let timescale = 0
    let duration = 0
    if (mdhd) {
      const v1 = buf[mdhd.start] === 1
      timescale = buf.readUInt32BE(mdhd.start + (v1 ? 20 : 12))
      duration = v1 ? Number(buf.readBigUInt64BE(mdhd.start + 24)) : buf.readUInt32BE(mdhd.start + 16)
    }

    const minf = find(mdiaBoxes, 'minf')
    const stbl = minf && find(boxes(minf.start, minf.end), 'stbl')
    const stblBoxes = stbl ? boxes(stbl.start, stbl.end) : []
    let sttsSamples = 0
    let sttsDuration = 0
    const stts = find(stblBoxes, 'stts')
    if (stts) {
      const n = buf.readUInt32BE(stts.start + 4)
      for (let i = 0; i < n && stts.start + 16 + i * 8 <= stts.end; i++) {
        const count = buf.readUInt32BE(stts.start + 8 + i * 8)
        sttsSamples += count
        sttsDuration += count * buf.readUInt32BE(stts.start + 12 + i * 8)
      }
    }
    const stsz = find(stblBoxes, 'stsz')
    const sampleCount = stsz ? buf.readUInt32BE(stsz.start + 8) : sttsSamples

    // stsd：版本 / 标志 4 + 条目数 4，第一个样本项的头 8 + 保留 6 + 引用索引 2 + 预定义 / 保留 16，然后宽、高（uint16）
    let codedWidth = 0
    let codedHeight = 0
    const stsd = find(stblBoxes, 'stsd')
    if (stsd && stsd.start + 8 + 36 <= stsd.end) {
      codedWidth = buf.readUInt16BE(stsd.start + 8 + 32)
      codedHeight = buf.readUInt16BE(stsd.start + 8 + 34)
    }
    return { displayWidth, displayHeight, codedWidth, codedHeight, rotation, timescale, duration, sttsSamples, sttsDuration, sampleCount }
  }
  throw new CatbusError('USAGE', '视频里没有可识别的视频轨（尺寸 / 时长）')
}

/** libavutil 的 av_reduce：约分，超过 max 时用连分数逼近。 */
export function avReduce(num: bigint, den: bigint, max: bigint): [bigint, bigint] {
  const abs = (x: bigint) => (x < 0n ? -x : x)
  const gcd = (x: bigint, y: bigint): bigint => (y === 0n ? x : gcd(y, x % y))
  const sign = num < 0n !== den < 0n
  const g = gcd(abs(num), abs(den))
  if (g) {
    num = abs(num) / g
    den = abs(den) / g
  }
  let a0: [bigint, bigint] = [0n, 1n]
  let a1: [bigint, bigint] = [1n, 0n]
  if (num <= max && den <= max) {
    a1 = [num, den]
    den = 0n
  }
  while (den) {
    let x = num / den
    const next = num - den * x
    const a2n = x * a1[0] + a0[0]
    const a2d = x * a1[1] + a0[1]
    if (a2n > max || a2d > max) {
      if (a1[0]) x = (max - a0[0]) / a1[0]
      if (a1[1]) {
        const y = (max - a0[1]) / a1[1]
        if (y < x) x = y
      }
      if (den * (2n * x * a1[1] + a0[1]) > num * a1[1]) a1 = [x * a1[0] + a0[0], x * a1[1] + a0[1]]
      break
    }
    a0 = a1
    a1 = [a2n, a2d]
    num = den
    den = next
  }
  return [sign ? -a1[0] : a1[0], a1[1]]
}

/** ffmpeg mov 解复用器的 avg_frame_rate：time_scale × 帧数 / 帧时长之和（opencv 的 CAP_PROP_FPS 取它）。 */
export function mp4AvgFrameRate(t: Mp4VideoTrack): number {
  if (!(t.sttsDuration > 0 && t.sttsSamples > 0 && t.timescale > 0)) return 0
  const [num, den] = avReduce(BigInt(t.timescale) * BigInt(t.sttsSamples), BigInt(t.sttsDuration), 0x7fffffffn)
  return Number(num) / Number(den)
}
