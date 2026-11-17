import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { validateArgv } from '../src/webui/bridge.js'
import { MAX_SESSIONS, buildListen, handleLive, liveSessions, setLiveSpawner, startLive, stopLive } from '../src/webui/live.js'

describe('详情卡片的字幕、弹幕、媒体链接与直播间头部（AGENTS 7.9）', () => {
  it('item media / subtitles、danmaku list、live get：<item> 放在 -- 之后，不带别的选项', () => {
    expect(validateArgv(['bilibili', 'item', 'subtitles', 'BV1xx', '-a', 'work'])).toEqual(['bilibili', 'item', 'subtitles', '-a', 'work', '--', 'BV1xx'])
    expect(validateArgv(['bilibili', 'danmaku', 'list', 'BV1xx'])).toEqual(['bilibili', 'danmaku', 'list', '--', 'BV1xx'])
    expect(validateArgv(['x', 'item', 'media', 'https://x.com/a/status/1'])).toEqual(['x', 'item', 'media', '--', 'https://x.com/a/status/1'])
    expect(validateArgv(['douyin', 'live', 'get', '123'])).toEqual(['douyin', 'live', 'get', '--', '123'])
    expect(() => validateArgv(['bilibili', 'danmaku', 'send', 'BV1', 'hi'])).toThrow('暂不开放')
    expect(() => validateArgv(['bilibili', 'item', 'media', 'BV1', '--limit', '3'])).toThrow('不允许的选项')
    // B 站原生播放器：item media 带 --raw 取原始 DASH 轨道
    expect(validateArgv(['bilibili', 'item', 'media', 'BV1xx', '-a', 'work', '--raw'])).toEqual(['bilibili', 'item', 'media', '-a', 'work', '--raw', '--', 'BV1xx'])
    expect(() => validateArgv(['bilibili', 'item', 'subtitles', 'BV1xx', '--raw'])).toThrow('不允许的选项')
    // --all-tracks 只对 B 站放行；danmaku list 可带 --raw（弹幕的类型、颜色）
    expect(validateArgv(['bilibili', 'item', 'media', 'BV1xx', '-a', 'work', '--all-tracks', '--raw'])).toEqual(['bilibili', 'item', 'media', '-a', 'work', '--all-tracks', '--raw', '--', 'BV1xx'])
    expect(() => validateArgv(['douyin', 'item', 'media', '1', '--all-tracks'])).toThrow('不允许的选项')
    expect(validateArgv(['bilibili', 'danmaku', 'list', 'BV1xx', '--raw'])).toEqual(['bilibili', 'danmaku', 'list', '--raw', '--', 'BV1xx'])
    expect(() => validateArgv(['bilibili', 'live', 'listen', '1'])).toThrow('暂不开放')
  })

  it('live media（直播页的播放器）：只带 <room>；B 站、抖音的直播 CDN 走媒体代理', async () => {
    expect(validateArgv(['douyin', 'live', 'media', 'https://v.douyin.com/abc/', '-a', 'work'])).toEqual(['douyin', 'live', 'media', '-a', 'work', '--', 'https://v.douyin.com/abc/'])
    expect(() => validateArgv(['bilibili', 'live', 'media', '1', '--limit', '3'])).toThrow('不允许的选项')
    const { checkMediaUrl } = await import('../src/webui/media.js')
    expect(checkMediaUrl('bilibili', 'https://d1--cn-gotcha07.bilivideo.com/live-bvc/1/a.flv').hostname).toBe('d1--cn-gotcha07.bilivideo.com')
    expect(checkMediaUrl('douyin', 'https://pull-flv-l11.douyincdn.com/stage/stream-1_sd.flv').hostname).toBe('pull-flv-l11.douyincdn.com')
    expect(() => checkMediaUrl('bilibili', 'https://evil.example.com/a.flv')).toThrow('白名单')
    // 抖音直播 CDN 302 到的腾讯云边缘节点：只在重定向时接受
    expect(() => checkMediaUrl('douyin', 'https://abc.v.smtcdns.net/pull-flv-l11.douyincdn.com/a.flv')).toThrow('白名单')
    expect(checkMediaUrl('douyin', 'https://abc.v.smtcdns.net/pull-flv-l11.douyincdn.com/a.flv', true).hostname).toBe('abc.v.smtcdns.net')
    expect(() => checkMediaUrl('douyin', 'https://113-240-88-90-ne8905a1.ksyungslb.com/third/a.flv')).toThrow('白名单')
    expect(checkMediaUrl('douyin', 'https://113-240-88-90-ne8905a1.ksyungslb.com/third/a.flv', true).hostname).toBe('113-240-88-90-ne8905a1.ksyungslb.com')
    expect(() => checkMediaUrl('douyin', 'https://abc123.mobgslb.tbcache.com/pull-flv-l11.douyincdn.com/a.flv')).toThrow('白名单')
    expect(checkMediaUrl('douyin', 'https://abc123.mobgslb.tbcache.com/pull-flv-l11.douyincdn.com/a.flv', true).hostname).toBe('abc123.mobgslb.tbcache.com')
    expect(() => checkMediaUrl('douyin', 'https://evil.tbcache.com/a.flv', true)).toThrow('白名单')
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.bilibili!.liveMedia).toBe(true)
    expect(all.douyin!.liveMedia).toBe(true)
    expect(all.xhs!.liveMedia).toBe(false)
  })

  it('/api/filters 给出 subtitles / danmaku / media / live', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.bilibili).toMatchObject({ subtitles: true, danmaku: true, media: true, live: true, liveGet: true })
    expect(all.weibo).toMatchObject({ subtitles: false, danmaku: false, live: false })
    expect(all.x!.media).toBe(true)
  })
})

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: string | null = null
  killed: string[] = []
  kill(sig: string) {
    this.killed.push(sig)
    this.close(null, sig)
    return true
  }
  close(code: number | null, sig: string | null = null) {
    this.exitCode = code
    this.signalCode = sig
    setImmediate(() => this.emit('close', code))
  }
}

function fakeRes() {
  const r = new EventEmitter() as EventEmitter & { chunks: string[]; statusCode: number; headers: Record<string, string>; writableEnded: boolean }
  Object.assign(r, { chunks: [], statusCode: 0, headers: {}, writableEnded: false })
  const res = r as unknown as ServerResponse & typeof r
  res.setHeader = ((k: string, v: string) => ((r.headers[k] = v), res)) as never
  res.write = ((s: string) => (r.chunks.push(s), true)) as never
  res.end = ((s?: string) => {
    if (s) r.chunks.push(s)
    r.writableEnded = true
    return res
  }) as never
  return res
}

const flush = () => new Promise((r) => setImmediate(r))

describe('直播弹幕 /api/live/*（AGENTS 7.9「直播弹幕」）', () => {
  const children: FakeChild[] = []
  let lastArgs: string[] = []
  setLiveSpawner((_file, args) => {
    lastArgs = args
    const c = new FakeChild()
    children.push(c)
    return c as unknown as ChildProcess
  })
  afterEach(async () => {
    for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.close(0)
    await flush()
  })

  it('校验平台、直播间、账号和时长，拼成 live listen -o jsonl', () => {
    expect(buildListen({ platform: 'bilibili', room: '123', account: 'work', duration: 600 })).toEqual(['bilibili', 'live', 'listen', '-a', 'work', '--duration', '600', '--', '123'])
    expect(() => buildListen({ platform: 'Bili', room: '1' })).toThrow('未知平台')
    expect(() => buildListen({ platform: 'bilibili', room: 'javascript:1' })).toThrow('直播间')
    expect(() => buildListen({ platform: 'bilibili', room: '1', account: 'guest' })).toThrow('账号名')
    expect(() => buildListen({ platform: 'bilibili', room: '1', duration: '5' })).toThrow('时长')
  })

  it('SSE 转发每行 Event，断开期间的补发；结束时发 end', async () => {
    const id = startLive({ platform: 'douyin', room: '42' })
    expect(lastArgs.slice(-8)).toEqual(['-o', 'jsonl', '-q', 'douyin', 'live', 'listen', '--', '42'])
    const child = children.at(-1)!
    child.stdout.write('{"type":"chat","text":"早"}\n{"type":"gift"')
    await flush()
    const res = fakeRes()
    await handleLive({ method: 'GET', url: `/${id}/events` } as never, res)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.chunks.join('')).toContain('data: {"type":"chat","text":"早"}')
    child.stdout.write(',"text":"花"}\n')
    await flush()
    expect(res.chunks.join('')).toContain('data: {"type":"gift","text":"花"}')
    child.close(0)
    await flush()
    expect(res.chunks.join('')).toContain('event: end\ndata: {"reason":"done","error":null}')
    expect(res.writableEnded).toBe(true)
  })

  it('stderr 的摘要信封带出错误；主动停止为 stopped', async () => {
    const a = startLive({ platform: 'douyin', room: '1' })
    const ca = children.at(-1)!
    const ra = fakeRes()
    await handleLive({ method: 'GET', url: `/${a}/events` } as never, ra)
    ca.stderr.write('{"ok":false,"data":null,"page":null,"error":{"code":"AUTH_EXPIRED","message":"x","hint":null,"detail":null}}\n')
    await flush()
    ca.close(3)
    await flush()
    expect(ra.chunks.join('')).toContain('"reason":"error","error":{"code":"AUTH_EXPIRED"')

    const b = startLive({ platform: 'douyin', room: '2' })
    const rb = fakeRes()
    await handleLive({ method: 'GET', url: `/${b}/events` } as never, rb)
    expect(stopLive(b)).toBe(true)
    await flush()
    expect(children.at(-1)!.killed).toContain('SIGTERM')
    expect(rb.chunks.join('')).toContain('"reason":"stopped"')
  })

  it(`同时最多 ${MAX_SESSIONS} 个会话，第 ${MAX_SESSIONS + 1} 个报 429`, async () => {
    const ids = Array.from({ length: MAX_SESSIONS }, (_, i) => startLive({ platform: 'douyin', room: String(i) }))
    expect(liveSessions()).toBeGreaterThanOrEqual(MAX_SESSIONS)
    const res = fakeRes()
    const body = JSON.stringify({ platform: 'douyin', room: '9' })
    const req = Object.assign(new PassThrough(), { method: 'POST', url: '/start' })
    req.end(body)
    await handleLive(req as never, res)
    expect(res.statusCode).toBe(429)
    for (const id of ids) stopLive(id)
    await flush()
  })
})
