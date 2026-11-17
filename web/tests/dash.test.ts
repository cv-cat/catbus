import { describe, expect, it } from 'vitest'
import { bestAudio, batch, codecRank, defaultQn, durlUrl, parseSidx, pickUrl, previewQuality, qualities, segmentAt, toTrack } from '@/composables/dash'
import { toDanmakuItems } from '@/composables/danmakuOverlay'

/** 拼一个 version 0 的 sidx 盒子：每段 [字节数, 时长（timescale 单位）] */
function sidx(refs: [number, number][], timescale = 1000, first = 0, ept = 0): ArrayBuffer {
  const size = 8 + 4 + 4 + 4 + 8 + 4 + refs.length * 12
  const v = new DataView(new ArrayBuffer(size))
  v.setUint32(0, size)
  ;[...'sidx'].forEach((c, i) => v.setUint8(4 + i, c.charCodeAt(0)))
  v.setUint32(12, 1) // reference_ID
  v.setUint32(16, timescale)
  v.setUint32(20, ept)
  v.setUint32(24, first)
  v.setUint16(30, refs.length)
  refs.forEach(([sz, dur], i) => {
    v.setUint32(32 + i * 12, sz)
    v.setUint32(36 + i * 12, dur)
  })
  return v.buffer
}

describe('B 站 DASH（composables/dash.ts）', () => {
  it('parseSidx：段的字节范围从 sidx 末尾算起，时间按 timescale 换成秒', () => {
    const buf = sidx([
      [100, 2000],
      [50, 1500],
    ])
    const segs = parseSidx(buf, 1009)
    const end = 1009 + buf.byteLength
    expect(segs).toEqual([
      { start: 0, end: 2, from: end, to: end + 99 },
      { start: 2, end: 3.5, from: end + 100, to: end + 149 },
    ])
    // sidx 前面有别的盒子时跳过；first_offset 计入
    const pad = new Uint8Array(16)
    new DataView(pad.buffer).setUint32(0, 16)
    pad.set([...'free'].map((c) => c.charCodeAt(0)), 4)
    const s2 = sidx([[10, 1000]], 1000, 4)
    const both = new Uint8Array(16 + s2.byteLength)
    both.set(pad)
    both.set(new Uint8Array(s2), 16)
    expect(parseSidx(both.buffer, 0)[0]).toMatchObject({ from: 16 + s2.byteLength + 4 })
    expect(() => parseSidx(pad.buffer, 0)).toThrow('sidx')
  })

  it('segmentAt / batch：按时间找段，相邻的段合并成一次请求', () => {
    const segs = Array.from({ length: 10 }, (_, i) => ({ start: i * 4, end: i * 4 + 4, from: i * 100, to: i * 100 + 99 }))
    expect(segmentAt(segs, 0)).toBe(0)
    expect(segmentAt(segs, 4)).toBe(1)
    expect(segmentAt(segs, 39.9)).toBe(9)
    expect(segmentAt(segs, 40)).toBe(10)
    expect(batch(segs, 0)).toEqual([0, 1]) // 两段 8 秒，第三段就超过 10 秒
    expect(batch(segs, 9)).toEqual([9, 9])
  })

  it('pickUrl / toTrack：跳过带端口的 PCDN 节点和白名单外的主机', () => {
    expect(pickUrl(['https://b-abc.edge.mountaintoys.cn:4483/a.m4s', 'https://x.mcdn.bilivideo.cn:4483/a.m4s', 'https://upos-sz-mirrorcos.bilivideo.com/a.m4s'])).toBe(
      'https://upos-sz-mirrorcos.bilivideo.com/a.m4s',
    )
    expect(pickUrl(['http://upos-sz-mirrorcos.bilivideo.com/a.m4s', 'https://evil.com/a'])).toBeNull()
    const raw = {
      baseUrl: 'https://b-abc.edge.mountaintoys.cn:4483/v.m4s',
      backupUrl: ['https://upos-sz-mirrorhw.bilivideo.com/v.m4s'],
      mimeType: 'video/mp4',
      codecs: 'avc1.640032',
      SegmentBase: { Initialization: '0-1008', indexRange: '1009-1544' },
    }
    expect(toTrack(raw)).toEqual({ id: 0, bandwidth: 0, height: 0, url: 'https://upos-sz-mirrorhw.bilivideo.com/v.m4s', mime: 'video/mp4', codecs: 'avc1.640032', init: [0, 1008], index: [1009, 1544] })
    expect(toTrack({ ...raw, SegmentBase: undefined })).toBeNull()
    expect(toTrack({ ...raw, backupUrl: [] })).toBeNull()
  })

  it('durlUrl：老稿件的整段只接受 mp4', () => {
    expect(durlUrl({ url: 'https://upos-sz-mirrorcos.bilivideo.com/a.mp4?x=1' })).toBe('https://upos-sz-mirrorcos.bilivideo.com/a.mp4?x=1')
    expect(durlUrl({ url: 'https://upos-sz-mirrorcos.bilivideo.com/a.flv' })).toBeNull()
  })
})

describe('B 站画质挑选（composables/dash.ts）', () => {
  const tr = (id: number, codecs: string, bandwidth: number, mime = 'video/mp4') => ({
    id,
    bandwidth,
    height: id >= 120 ? 2160 : 1080,
    url: `https://upos-sz-mirrorcos.bilivideo.com/${id}-${codecs}`,
    mime,
    codecs,
    init: [0, 1] as [number, number],
    index: [2, 3] as [number, number],
  })
  const all = [
    tr(126, 'dvh1.08.07', 9000),
    tr(120, 'hev1.1.6.L153.90', 8000),
    tr(120, 'av01.0.12M.08', 6000),
    tr(80, 'av01.0.08M.08', 1000),
    tr(80, 'hev1.1.6.L150.90', 1200),
    tr(80, 'avc1.640032', 2600),
    tr(30280, 'mp4a.40.2', 190, 'audio/mp4'),
    tr(30250, 'ec-3', 700, 'audio/mp4'),
    tr(30216, 'mp4a.40.5', 60, 'audio/mp4'),
  ]
  // 模拟一个解不了杜比视界、杜比全景声和 HEVC 的浏览器
  const ok = (t: { codecs: string }) => !/^(dvh1|ec-3|hev1)/.test(t.codecs)

  it('qualities：各画质挑一路能解的，AVC 优先，画质从高到低', () => {
    const list = qualities(all, ok)
    expect(list.map((q) => [q.qn, q.video.codecs])).toEqual([
      [120, 'av01.0.12M.08'],
      [80, 'avc1.640032'],
    ])
    expect(qualities(all, () => true)[0]).toMatchObject({ qn: 126 })
    expect(codecRank('avc1.64001F')).toBeLessThan(codecRank('hev1.1'))
    expect(codecRank('hvc1.1')).toBeLessThan(codecRank('av01.0'))
  })

  it('bestAudio：能解的里码率最高的', () => {
    expect(bestAudio(all, ok)?.id).toBe(30280)
    expect(bestAudio(all, () => true)?.id).toBe(30250)
  })

  it('defaultQn：不超过上次所选的最高一档；没选过时避开 HDR、杜比视界', () => {
    const list = qualities(all, () => true)
    expect(defaultQn(list, 0)).toBe(120)
    expect(defaultQn(list, 80)).toBe(80)
    expect(defaultQn(list, 116)).toBe(80)
    expect(defaultQn(list, 32)).toBe(80) // 都比所选的高：取最低一档
    expect(defaultQn(list, 126)).toBe(126)
    expect(defaultQn([], 0)).toBeNull()
  })

  it('previewQuality：480P 及以下最高的一档，都更高时取最低一档', () => {
    const q = (qn: number) => ({ qn, height: 0, video: all[0]! })
    expect(previewQuality([q(80), q(64), q(32), q(16)])?.qn).toBe(32)
    expect(previewQuality([q(80), q(16)])?.qn).toBe(16)
    expect(previewQuality([q(120), q(80)])?.qn).toBe(80)
    expect(previewQuality([])).toBeNull()
  })
})

describe('叠加弹幕的数据（composables/danmakuOverlay.ts）', () => {
  it('toDanmakuItems：按 mode 分滚动 / 顶部 / 底部，高级弹幕丢掉；兼容旧版 CLI 只有 offset / text', () => {
    const list = toDanmakuItems([
      { progress: 5000, mode: 5, color: 16711680, fontsize: 25, content: '顶部红字' },
      { progress: null, mode: 1, color: 16777215, fontsize: 18, content: '开头' },
      { progress: 3000, mode: 4, color: 65280, fontsize: 36, content: '底部' },
      { progress: 4000, mode: 7, content: '[高级]' },
      { progress: 4500, mode: 1, content: '   ' },
      { offset: 2.5, text: '旧版\n换行' },
    ])
    expect(list).toEqual([
      { t: 0, kind: 'scroll', color: '#ffffff', size: 18, text: '开头' },
      { t: 2.5, kind: 'scroll', color: '#ffffff', size: 25, text: '旧版 换行' },
      { t: 3, kind: 'bottom', color: '#00ff00', size: 36, text: '底部' },
      { t: 5, kind: 'top', color: '#ff0000', size: 25, text: '顶部红字' },
    ])
  })
})
