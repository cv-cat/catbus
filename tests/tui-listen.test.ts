import { describe, expect, it } from 'vitest'
import { newCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { CatbusError } from '../src/core/errors.js'
import { definePlatform, type Handler } from '../src/core/registry.js'
import { EVENT_TYPES, perMinute, pushLine, startListen, toLine, visible } from '../src/tui/listen.js'
import { bufferLogger, LogBuffer } from '../src/tui/logs.js'
import { listenable } from '../src/tui/model.js'
import { useTempHome } from './helpers.js'

// 监听的执行与整理。用一个假平台的假 listen 命令，离线。

function fake(handler: Handler) {
  return definePlatform({
    id: 'fake',
    name: '假平台',
    aliases: [],
    item: '东西',
    endpoints: {
      web: {
        login: { methods: ['cookie'], default: 'cookie' },
        commands: { 'live listen': { upstream: 'full', handler: async () => handler, options: {} } },
      },
      app: 'planned',
      pc: 'planned',
    },
  })
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('tui 监听', () => {
  useTempHome()
  const log = bufferLogger(new LogBuffer())
  async function login() {
    const c = newCredential({ platform: 'fake', endpoint: 'web', account: 'a', method: 'cookie' })
    await writeCredential(c)
    await setCurrent('fake', 'web', 'a')
  }
  const cmd = (p: ReturnType<typeof fake>) => (p.endpoints.web as any).commands.get('live listen')

  it('收到事件、stop() 后结束，且不报错', async () => {
    await login()
    const p = fake(async function* (ctx) {
      let i = 0
      while (!ctx.signal.aborted) {
        yield { type: 'chat', time: '2026-10-10T21:30:08+08:00', user: { id: '1', name: '夜猫子', url: null }, text: `第${++i}条` }
        await wait(5)
      }
    })
    const got: any[] = []
    const h = await startListen({ platform: p, command: cmd(p), words: ['r1'], given: {}, log }, (v) => got.push(v))
    await wait(60)
    h.stop()
    expect(await h.done).toEqual({ error: null })
    expect(got.length).toBeGreaterThan(3)
    const n = got.length
    await wait(30)
    expect(got.length).toBe(n)
  })

  it('--duration 到点自动停止，endsAt 是到点的时刻', async () => {
    await login()
    const p = fake(async function* (ctx) {
      while (!ctx.signal.aborted) {
        yield { type: 'chat', text: 'x' }
        await wait(5)
      }
    })
    const t0 = Date.now()
    const h = await startListen({ platform: p, command: cmd(p), words: ['r1'], given: { duration: '0.1' }, log }, () => {})
    expect(h.endsAt! - t0).toBeGreaterThanOrEqual(90)
    expect(await h.done).toEqual({ error: null })
    expect(Date.now() - t0).toBeLessThan(1500)
  })

  it('handler 抛 CatbusError：done 带 error，退出码信息保留', async () => {
    await login()
    const p = fake(async function* () {
      yield { type: 'chat', text: 'a' }
      throw new CatbusError('RISK_CONTROL', '触发风控', { detail: { kind: 'rate_limit' } })
    })
    const h = await startListen({ platform: p, command: cmd(p), words: ['r1'], given: {}, log }, () => {})
    const { error } = await h.done
    expect(error).toMatchObject({ code: 'RISK_CONTROL', exitCode: 5 })
  })

  it('生成器卡在 await 上时 stop() 也能立刻结束（不等它）', async () => {
    await login()
    const p = fake(async function* () {
      yield { type: 'chat', text: 'a' }
      await new Promise(() => {}) // 永远不返回
    })
    const h = await startListen({ platform: p, command: cmd(p), words: ['r1'], given: {}, log }, () => {})
    await wait(20)
    const t0 = Date.now()
    h.stop()
    expect(await h.done).toEqual({ error: null })
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('未登录：校验阶段就报 AUTH_REQUIRED，不会开始监听', async () => {
    const p = fake(async function* () {
      yield { type: 'chat', text: 'never' }
    })
    await expect(startListen({ platform: p, command: cmd(p), words: ['r1'], given: {}, log }, () => {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('listenable 只认已实现的流式 listen', () => {
    const p = fake(async function* () {})
    expect(listenable(cmd(p))).toBe(true)
    expect(listenable({ ...cmd(p), stream: false })).toBe(false)
    expect(listenable({ ...cmd(p), status: 'planned' })).toBe(false)
  })
})

describe('tui 事件整理', () => {
  it('Event：弹幕、礼物（名称 × 数量）、关注、进场', () => {
    expect(toLine({ type: 'chat', time: '2026-10-10T21:30:08+08:00', user: { name: '夜猫子' }, text: '好听\n真的' }, 1)).toMatchObject({ kind: '弹幕', who: '夜猫子', text: '好听 真的' })
    // 时间带秒；事件没带时间（或解析不了）时用收到的时间
    const at = new Date(2026, 9, 10, 21, 30, 9)
    expect(toLine({ type: 'chat', text: 'x' }, 1, at).time).toBe('21:30:09')
    expect(toLine({ type: 'chat', time: '不是时间', text: 'x' }, 1, at).time).toBe('21:30:09')
    expect(toLine({ type: 'chat', time: '2026-10-10T13:30:08Z', text: 'x' }, 1, at).time).toMatch(/^\d\d:\d\d:08$/)
    expect(toLine({ type: 'gift', user: { name: '阿柴' }, gift: { name: '小花花', count: 3 }, text: null }, 2)).toMatchObject({ kind: '礼物', text: '小花花 ×3' })
    expect(toLine({ type: 'follow', user: { name: '听雨眠' } }, 3).text).toBe('关注了主播')
    expect(toLine({ type: 'enter', user: { id: '9' } }, 4)).toMatchObject({ who: '9', text: '进入直播间' })
  })
  it('Message（私信）：有 conversation_id，文本为空时用媒体类型', () => {
    expect(toLine({ id: '1', conversation_id: 'c', from: { name: '买家' }, type: 'text', text: '在吗', media: [] }, 1)).toMatchObject({ kind: '消息', who: '买家', text: '在吗' })
    expect(toLine({ id: '2', conversation_id: 'c', from: { name: '买家' }, type: 'image', text: null, media: [{ type: 'image' }] }, 2).text).toBe('[image]')
  })
  it('奇怪的输入不抛错', () => {
    expect(() => [toLine(null, 1), toLine('x', 2), toLine(42, 3), toLine({}, 4), toLine({ type: 'chat', user: 5 }, 5)]).not.toThrow()
  })
  it('环形缓冲：超过上限丢最旧的，不改原数组', () => {
    let lines = [] as ReturnType<typeof toLine>[]
    const orig = lines
    for (let i = 0; i < 7; i++) lines = pushLine(lines, toLine({ type: 'chat', text: String(i) }, i), 5)
    expect(lines.map((l) => l.text)).toEqual(['2', '3', '4', '5', '6'])
    expect(orig).toHaveLength(0)
  })
  it('过滤：隐藏的类型不显示；私信不受影响', () => {
    const lines = [toLine({ type: 'chat', text: 'a' }, 1), toLine({ type: 'enter' }, 2), toLine({ id: '1', conversation_id: 'c', type: 'text', text: 'm', media: [] }, 3)]
    expect(visible(lines, new Set(['enter'])).map((l) => l.seq)).toEqual([1, 3])
    expect(visible(lines, new Set()).length).toBe(3)
    expect(EVENT_TYPES).toEqual(['chat', 'gift', 'follow', 'enter', 'like'])
  })
  it('每分钟事件数', () => {
    const now = 10 * 60_000
    expect(perMinute([now - 1000, now - 61_000, now - 62_000, now - 7 * 60_000], now, 4)).toEqual([0, 0, 2, 1])
    // 时间戳比 now 新几十毫秒（界面的 now 隔几百毫秒才更新）也算最近一分钟，不会被丢掉
    expect(perMinute([now + 80, now + 200], now, 4)).toEqual([0, 0, 0, 2])
  })
})
