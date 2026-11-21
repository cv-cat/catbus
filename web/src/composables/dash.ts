/**
 * B 站的原生播放（AGENTS.md 7.9「详情卡片」的「媒体」）：音视频分离的 DASH，
 * 每一轨是一个 fMP4 文件，`SegmentBase` 给出 init 段和 `sidx` 索引的字节范围。
 * 这里不用 dash.js：读 `sidx` 把文件切成段，按 Range 经媒体代理取回，分别喂给两个 SourceBuffer。
 */

import { mediaSrc } from '@/api/client'

/** 一轨：地址（已经过白名单筛选）、MIME、编码、init 段与 sidx 的字节范围 */
export interface DashTrack {
  /** B 站的轨道 id：视频是画质 qn（80 = 1080P、120 = 4K……），音频是音质 id */
  id: number
  bandwidth: number
  height: number
  url: string
  mime: string
  codecs: string
  init: [number, number]
  index: [number, number]
}

/** `sidx` 里的一段：时间（秒）和文件里的字节范围（含两端） */
export interface Segment {
  start: number
  end: number
  from: number
  to: number
}

/** B 站的点播 CDN：与媒体代理（src/webui/media.ts）的白名单一致；PCDN 节点带非 443 端口，代理不收 */
const HOSTS = ['bilivideo.com', 'bilivideo.cn']
export function pickUrl(urls: (string | null | undefined)[]): string | null {
  for (const raw of urls) {
    if (!raw) continue
    try {
      const u = new URL(raw)
      const host = u.hostname.toLowerCase()
      if (u.protocol !== 'https:' || (u.port && u.port !== '443')) continue
      if (HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return raw
    } catch {
      /* 跳过不合法的地址 */
    }
  }
  return null
}

function range(s: unknown): [number, number] | null {
  const m = typeof s === 'string' ? /^(\d+)-(\d+)$/.exec(s) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

/** `item media --raw` 的一条（B 站 playurl 里 dash.video / dash.audio 的原始对象）→ DashTrack；不是 DASH 轨时 null */
export function toTrack(raw: Record<string, any>): DashTrack | null {
  const sb = raw.SegmentBase ?? raw.segment_base
  const init = range(sb?.Initialization ?? sb?.initialization)
  const index = range(sb?.indexRange ?? sb?.index_range)
  const mime = raw.mimeType ?? raw.mime_type
  const url = pickUrl([raw.baseUrl ?? raw.base_url, ...(raw.backupUrl ?? raw.backup_url ?? [])])
  if (!init || !index || typeof mime !== 'string' || typeof raw.codecs !== 'string' || !url) return null
  return { id: Number(raw.id) || 0, bandwidth: Number(raw.bandwidth) || 0, height: Number(raw.height) || 0, url, mime, codecs: raw.codecs, init, index }
}

/** 老稿件没有 DASH，只有整段（durl）：取一个能经代理播的 mp4 地址 */
export function durlUrl(raw: Record<string, any>): string | null {
  const url = pickUrl([raw.url, ...(raw.backup_url ?? raw.backupUrl ?? [])])
  if (!url) return null
  return /\.mp4$/i.test(new URL(url).pathname) ? url : null
}

type MS = typeof MediaSource
function mediaSourceClass(): MS | null {
  const w = globalThis as unknown as { ManagedMediaSource?: MS; MediaSource?: MS }
  return w.ManagedMediaSource ?? w.MediaSource ?? null
}
const typeOf = (t: DashTrack) => `${t.mime}; codecs="${t.codecs}"`
/** 浏览器有 MSE、并且能解这一轨的编码 */
export function supported(t: DashTrack): boolean {
  const M = mediaSourceClass()
  return !!M && M.isTypeSupported(typeOf(t))
}

/** 一档画质：qn 和这一档挑出来的视频轨 */
export interface Quality {
  qn: number
  height: number
  video: DashTrack
}
/** 同一画质有几种编码时的先后：AVC（硬解最普遍）、HEVC、AV1，其余（杜比视界等）最后 */
export function codecRank(codecs: string): number {
  const c = codecs.toLowerCase()
  if (c.startsWith('avc1') || c.startsWith('avc3')) return 0
  if (c.startsWith('hev1') || c.startsWith('hvc1')) return 1
  if (c.startsWith('av01')) return 2
  return 3
}
/** 各画质挑一路能解的视频轨，画质从高到低 */
export function qualities(tracks: DashTrack[], ok: (t: DashTrack) => boolean = supported): Quality[] {
  const best = new Map<number, DashTrack>()
  for (const t of tracks) {
    if (!t.mime.startsWith('video/') || !ok(t)) continue
    const cur = best.get(t.id)
    if (!cur || codecRank(t.codecs) < codecRank(cur.codecs) || (codecRank(t.codecs) === codecRank(cur.codecs) && t.bandwidth > cur.bandwidth)) best.set(t.id, t)
  }
  return [...best.values()].sort((a, b) => b.id - a.id).map((v) => ({ qn: v.id, height: v.height, video: v }))
}
/** 能解的音频轨里码率最高的一路 */
export function bestAudio(tracks: DashTrack[], ok: (t: DashTrack) => boolean = supported): DashTrack | null {
  return tracks.filter((t) => t.mime.startsWith('audio/') && ok(t)).sort((a, b) => b.bandwidth - a.bandwidth)[0] ?? null
}
/** HDR、杜比视界：没选过画质时不默认用 */
const HDR = [125, 126]
/** 默认画质：不超过上次所选的最高一档；没选过时取 HDR、杜比视界以外的最高一档 */
export function defaultQn(list: Quality[], preferred: number): number | null {
  if (!list.length) return null
  if (preferred > 0) return (list.find((q) => q.qn <= preferred) ?? list.at(-1)!).qn
  return (list.find((q) => !HDR.includes(q.qn)) ?? list[0]!).qn
}

/** 悬停预览用的画质：480P 及以下里最高的一档，都比 480P 高时取最低一档（预览浮层小，省流量） */
export function previewQuality(list: Quality[]): Quality | null {
  return list.find((q) => q.qn <= 32) ?? list.at(-1) ?? null
}

/** 经媒体代理（/api/media，加 Referer）按 Range 取一段字节 */
export function rangeFetcher(platform: string) {
  return async (url: string, from: number, to: number, signal: AbortSignal): Promise<ArrayBuffer> => {
    const res = await fetch(mediaSrc(platform, url), { headers: { range: `bytes=${from}-${to}` }, signal })
    if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const buf = await res.arrayBuffer()
    // 不支持 Range 的节点回了整个文件：截出要的那段
    if (res.status === 200 && buf.byteLength > to - from + 1) return buf.slice(from, to + 1)
    if (buf.byteLength !== to - from + 1) throw new Error('返回的字节数不对')
    return buf
  }
}

/** 在 init + sidx 这段字节里找 `sidx` 盒子，算出每一段；`base` 是这段字节在文件里的起点 */
export function parseSidx(buf: ArrayBuffer, base: number): Segment[] {
  const v = new DataView(buf)
  let p = 0
  while (p + 8 <= v.byteLength) {
    let size = v.getUint32(p)
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7))
    let head = 8
    if (size === 1) {
      size = Number(v.getBigUint64(p + 8))
      head = 16
    } else if (size === 0) size = v.byteLength - p
    if (size < head) break
    if (type === 'sidx') {
      let q = p + head
      const version = v.getUint8(q)
      q += 4 + 4 // version + flags, reference_ID
      const timescale = v.getUint32(q)
      q += 4
      let ept: number
      let first: number
      if (version === 0) {
        ept = v.getUint32(q)
        first = v.getUint32(q + 4)
        q += 8
      } else {
        ept = Number(v.getBigUint64(q))
        first = Number(v.getBigUint64(q + 8))
        q += 16
      }
      q += 2 // reserved
      const count = v.getUint16(q)
      q += 2
      // 段的偏移从 sidx 盒子的末尾算起
      let offset = base + p + size + first
      let time = ept
      const out: Segment[] = []
      for (let i = 0; i < count; i++) {
        const sz = v.getUint32(q) & 0x7fffffff
        const dur = v.getUint32(q + 4)
        q += 12
        out.push({ start: time / timescale, end: (time + dur) / timescale, from: offset, to: offset + sz - 1 })
        offset += sz
        time += dur
      }
      return out
    }
    p += size
  }
  throw new Error('没有找到 sidx 索引')
}

/** 从 `at` 所在的段开始；超过最后一段时返回段数 */
export function segmentAt(segs: Segment[], at: number): number {
  for (let i = 0; i < segs.length; i++) if (at < segs[i]!.end) return i
  return segs.length
}

/** 一次请求合并几个相邻的段：凑够约 10 秒或 4 MB 为止，少发请求 */
export function batch(segs: Segment[], i: number): [number, number] {
  let j = i
  while (j + 1 < segs.length && segs[j + 1]!.end - segs[i]!.start <= 10 && segs[j + 1]!.to - segs[i]!.from < 4 << 20) j++
  return [i, j]
}

const AHEAD = 30
const BEHIND = 30
const FETCH_RETRY = 2

export interface DashPlayer {
  destroy(): void
}

/**
 * 把几轨接到 <video> 上。`fetchRange(url, from, to, signal)` 负责经媒体代理取字节；
 * 取不到（重试过后仍失败）、解码出错时调 `onError`，由调用方重新取地址再来一次。
 */
export function attachDash(
  video: HTMLVideoElement,
  tracks: DashTrack[],
  fetchRange: (url: string, from: number, to: number, signal: AbortSignal) => Promise<ArrayBuffer>,
  onError: (e: unknown) => void,
): DashPlayer {
  const M = mediaSourceClass()
  if (!M) throw new Error('浏览器不支持 Media Source Extensions')
  const ms = new M()
  const managed = M !== (globalThis as { MediaSource?: MS }).MediaSource
  // ManagedMediaSource（iOS Safari）要求关掉远程播放，或者给一个备用的普通地址
  if (managed) video.disableRemotePlayback = true
  const objectUrl = URL.createObjectURL(ms)
  video.src = objectUrl

  let dead = false
  let failed = false
  const lanes: {
    t: DashTrack
    sb: SourceBuffer | null
    segs: Segment[]
    next: number
    busy: boolean
    abort: AbortController | null
  }[] = tracks.map((t) => ({ t, sb: null, segs: [], next: 0, busy: false, abort: null }))

  const fail = (e: unknown) => {
    if (dead || failed) return
    failed = true
    onError(e)
  }

  async function get(url: string, from: number, to: number, signal: AbortSignal): Promise<ArrayBuffer> {
    for (let n = 0; ; n++) {
      try {
        return await fetchRange(url, from, to, signal)
      } catch (e) {
        if (signal.aborted || n >= FETCH_RETRY) throw e
        await new Promise((r) => setTimeout(r, 500 * (n + 1)))
      }
    }
  }

  function append(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = () => {
        sb.removeEventListener('updateend', done)
        sb.removeEventListener('error', bad)
        resolve()
      }
      const bad = () => {
        sb.removeEventListener('updateend', done)
        sb.removeEventListener('error', bad)
        reject(new Error('SourceBuffer 出错'))
      }
      sb.addEventListener('updateend', done)
      sb.addEventListener('error', bad)
      sb.appendBuffer(data)
    })
  }
  function remove(sb: SourceBuffer, from: number, to: number): Promise<void> {
    return new Promise((resolve) => {
      if (to <= from) return resolve()
      sb.addEventListener('updateend', () => resolve(), { once: true })
      sb.remove(from, to)
    })
  }

  /** 当前位置往后已经缓冲到哪里（当前位置不在缓冲区里时为 null） */
  function bufferedEnd(sb: SourceBuffer, at: number): number | null {
    const b = sb.buffered
    for (let i = 0; i < b.length; i++) if (b.start(i) <= at + 0.3 && at < b.end(i)) return b.end(i)
    return null
  }

  async function pump(lane: (typeof lanes)[number]) {
    const sb = lane.sb
    if (dead || failed || !sb || lane.busy || sb.updating) return
    if (managed && (ms as MediaSource & { streaming?: boolean }).streaming === false) return
    const at = video.currentTime
    const end = bufferedEnd(sb, at)
    if (end === null) lane.next = segmentAt(lane.segs, at)
    else if (end - at >= AHEAD) return
    // 回到了以前缓冲过的一块：接着这块的末尾取，不跳过中间
    else if ((lane.segs[lane.next]?.start ?? Infinity) > end + 0.5) lane.next = segmentAt(lane.segs, end + 0.1)
    if (lane.next >= lane.segs.length) return void maybeEnd()
    lane.busy = true
    const ac = new AbortController()
    lane.abort = ac
    try {
      // 往前太久的丢掉，给后面的留地方
      const b = sb.buffered
      if (b.length && b.start(0) < at - BEHIND) await remove(sb, 0, at - BEHIND / 2)
      const [i, j] = batch(lane.segs, lane.next)
      const data = await get(lane.t.url, lane.segs[i]!.from, lane.segs[j]!.to, ac.signal)
      if (dead || ac.signal.aborted) return
      try {
        await append(sb, data)
      } catch (e) {
        if ((e as DOMException).name !== 'QuotaExceededError') throw e
        // 缓冲满了：把当前位置之前的都丢掉再试一次
        await remove(sb, 0, Math.max(0, video.currentTime - 2))
        await append(sb, data)
      }
      lane.next = j + 1
    } catch (e) {
      if (!dead && !ac.signal.aborted) fail(e)
    } finally {
      lane.busy = false
      if (lane.abort === ac) lane.abort = null
    }
    // 拖动时被打断的也接着来：pump 会按新的位置重新算从哪一段取
    void pump(lane)
  }

  function maybeEnd() {
    if (ms.readyState !== 'open') return
    if (lanes.every((l) => l.next >= l.segs.length && !l.busy && !l.sb?.updating)) {
      try {
        ms.endOfStream()
      } catch {
        /* 有一轨正在更新：下一次 pump 再来 */
      }
    }
  }

  const tick = () => lanes.forEach((l) => void pump(l))
  /** 拖动到没缓冲的地方：丢掉在途的请求，从目标所在的段重新取 */
  const onSeeking = () => {
    for (const l of lanes) {
      if (!l.sb || bufferedEnd(l.sb, video.currentTime) !== null) continue
      l.abort?.abort()
      l.next = segmentAt(l.segs, video.currentTime)
    }
    tick()
  }

  async function open() {
    try {
      // 先取齐各轨的 init 段和 sidx，再一起建 SourceBuffer：
      // 一轨的 init 段先喂进去时浏览器就认为轨道齐了，之后再建 SourceBuffer 会被拒（QuotaExceededError）
      const heads = await Promise.all(
        lanes.map(async (l) => {
          const ac = new AbortController()
          l.abort = ac
          const from = l.t.init[0]
          const head = await get(l.t.url, from, l.t.index[1], ac.signal)
          l.segs = parseSidx(head.slice(l.t.index[0] - from), l.t.index[0])
          l.abort = null
          return head.slice(0, l.t.init[1] - from + 1)
        }),
      )
      if (dead) return
      for (const l of lanes) l.sb = ms.addSourceBuffer(typeOf(l.t))
      await Promise.all(lanes.map((l, i) => append(l.sb!, heads[i]!)))
      if (dead) return
      const total = Math.max(...lanes.map((l) => l.segs.at(-1)?.end ?? 0))
      if (total > 0 && ms.readyState === 'open') ms.duration = total
      tick()
    } catch (e) {
      fail(e)
    }
  }

  ms.addEventListener('sourceopen', () => void open(), { once: true })
  ms.addEventListener('startstreaming', tick)
  video.addEventListener('timeupdate', tick)
  video.addEventListener('seeking', onSeeking)
  video.addEventListener('waiting', tick)

  return {
    destroy() {
      dead = true
      for (const l of lanes) l.abort?.abort()
      ms.removeEventListener('startstreaming', tick)
      video.removeEventListener('timeupdate', tick)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('waiting', tick)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
    },
  }
}
