import { describe, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { loadCv } from '../src/core/image.js'
import { nextSteps } from '../src/tui/follow.js'
import { availability, listenable, runnable, usable } from '../src/tui/model.js'
import { qrCells, qrSize } from '../src/tui/qr.js'
import { carX, typed } from '../src/tui/Splash.js'
import { findPlatform } from '../src/platforms/index.js'
import { SPRITE_WIDTH } from '../src/tui/mascot.js'

const cmd = (pid: string, key: string) => findPlatform(pid)!.endpoints.web !== 'planned' && (findPlatform(pid)!.endpoints.web as any).commands.get(key)

describe('tui 接着做（follow）', () => {
  const bili = findPlatform('bilibili')!
  const xhs = findPlatform('xhs')!
  const video = { id: 'BV1xx', url: 'https://www.bilibili.com/video/BV1xx', kind: 'video', stats: {}, media: [], author: { id: '7', name: 'x', url: 'https://space.bilibili.com/7' } }
  const keys = (list: ReturnType<typeof nextSteps>) => list.map((n) => n.command.key)

  it('作品：评论、详情、作者资料等，参数已填好，不含自己', () => {
    const list = nextSteps(bili, cmd('bilibili', 'item search'), video)
    expect(keys(list)).toEqual(expect.arrayContaining(['item get', 'comment list', 'user get', 'user items']))
    expect(keys(list)).not.toContain('item search')
    expect(list.find((n) => n.command.key === 'comment list')!.words).toEqual(['BV1xx'])
    expect(list.find((n) => n.command.key === 'user get')!.words).toEqual(['https://space.bilibili.com/7'])
  })
  it('xhs 优先传 URL（带 xsec_token），其余平台传 id', () => {
    const note = { id: 'n1', url: 'https://www.xiaohongshu.com/explore/n1?xsec_token=T', kind: 'image', stats: {}, media: [], author: { id: 'u1', name: 'x', url: null } }
    expect(nextSteps(xhs, cmd('xhs', 'item search'), note).find((n) => n.command.key === 'comment list')!.words).toEqual([note.url])
  })
  it('不把“可选的用户参数”当建议：user likes / collects / folder list 省略时是“我自己的”', () => {
    const list = keys(nextSteps(bili, cmd('bilibili', 'item search'), video))
    for (const k of ['user likes', 'user collects', 'user followers', 'user following', 'folder list']) expect(list).not.toContain(k)
  })
  it('直播间：可以直接监听', () => {
    const live = { id: '123', url: 'https://live.bilibili.com/123', title: 't', status: 'live', host: { id: '9', name: 'h', url: null }, stats: {} }
    const list = nextSteps(bili, cmd('bilibili', 'live list'), live)
    const listen = list.find((n) => n.command.key === 'live listen')
    expect(listen).toBeDefined()
    expect(listen!.words).toEqual(['123'])
    expect(listen!.command.stream).toBe(true)
  })
  it('12306 车次：票价的选项（--from-no 等）从车次里带出来，经停站带站名', () => {
    const p = findPlatform('12306')!
    const ticket = { id: 'G1', train_no: '240000G1', seats: {}, from: { code: 'VNP', name: '北京南', no: '01' }, to: { code: 'AOH', name: '上海虹桥', no: '07' }, date: '2026-10-10', seat_types: 'OM9' }
    const list = nextSteps(p, cmd('12306', 'ticket search'), ticket)
    expect(keys(list).sort()).toEqual(['route get', 'ticket price'])
    expect(list.find((n) => n.command.key === 'ticket price')).toMatchObject({ words: ['240000G1'], given: { fromNo: '01', toNo: '07', seatTypes: 'OM9', date: '2026-10-10' } })
    expect(list.find((n) => n.command.key === 'route get')).toMatchObject({ words: ['240000G1', '北京南', '上海虹桥'] })
  })
  it('缺必要信息就不建议（车次没有 seat_types 时没有票价）', () => {
    const p = findPlatform('12306')!
    const ticket = { id: 'G1', train_no: '1', seats: {}, from: { code: 'A', name: '甲', no: '01' }, to: { code: 'B', name: '乙', no: '02' }, date: '2026-10-10', seat_types: '' }
    expect(keys(nextSteps(p, cmd('12306', 'ticket search'), ticket))).toEqual(['route get'])
  })
  it('奇怪的输入不抛错，返回空', () => {
    for (const v of [null, 'x', 5, {}, [] as unknown]) expect(() => nextSteps(bili, cmd('bilibili', 'item search'), v)).not.toThrow()
    expect(nextSteps(bili, cmd('bilibili', 'item search'), null)).toEqual([])
  })
})

describe('tui 命令状态', () => {
  it('listen 命令是 listen，不是 run；两者都 usable', () => {
    const l = cmd('bilibili', 'live listen')
    expect(availability(l)).toBe('listen')
    expect(listenable(l)).toBe(true)
    expect(runnable(l)).toBe(false)
    expect(usable(l)).toBe(true)
  })
  it('规划中的 listen 不可用（bilibili msg listen 还没实现）', () => {
    const l = cmd('bilibili', 'msg listen')
    expect(availability(l)).toBe('planned')
    expect(usable(l)).toBe(false)
  })
  it('写入类是 cli-only，读取类是 run', () => {
    expect(availability(cmd('bilibili', 'item like'))).toBe('cli-only')
    expect(availability(cmd('bilibili', 'item search'))).toBe('run')
    expect(availability(cmd('bilibili', 'item delete'))).toBe('cli-only') // 实现了，但是危险操作，界面里不运行
    expect(availability(cmd('xhs', 'item delete'))).toBe('planned') // 没实现的就是 planned，不是 cli-only
  })
})

describe('tui 二维码', () => {
  const urls = [
    'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=0123456789abcdef0123456789abcdef&from=main',
    'https://www.xiaohongshu.com/mobile/login?qrId=abc&code=123456',
    'https://qr.m.jd.com/p?k=abcdefghij',
  ]
  it('尺寸：列数 = 模块数 + 两侧安静区，行数 = 列数的一半向上取整', () => {
    for (const u of urls) {
      const s = qrSize(u)
      const q = qrCells(u)
      expect([q.cols, q.rows]).toEqual([s.cols, s.rows])
      expect(q.rows).toBe(Math.ceil(q.cols / 2))
    }
  })
  it('固定黑码白底（不随主题），只用这两种颜色', () => {
    const q = qrCells(urls[0]!)
    const colors = new Set(q.lines.flatMap((l) => l.flatMap((r) => [r.fg, r.bg])))
    expect([...colors].sort()).toEqual(['#000000', '#ffffff'])
  })
  it('画出来的码能被解码回原文（纠错等级 M；L 对长链接会失败，所以不用）', async () => {
    const cv = await loadCv()
    for (const content of urls) {
      const q = qrCells(content)
      const S = 8
      const c = createCanvas(q.cols * S, q.rows * 2 * S)
      const g = c.getContext('2d')
      q.lines.forEach((row, y) => {
        let x = 0
        for (const r of row) {
          for (let i = 0; i < r.text.length; i++) {
            g.fillStyle = r.fg
            g.fillRect((x + i) * S, y * 2 * S, S, S)
            g.fillStyle = r.bg
            g.fillRect((x + i) * S, (y * 2 + 1) * S, S, S)
          }
          x += r.text.length
        }
      })
      const img = g.getImageData(0, 0, c.width, c.height)
      const text = new cv.QRCodeDetector().detectAndDecode(cv.matFromImageData({ data: img.data, width: img.width, height: img.height }), new cv.Mat())
      expect(text).toBe(content)
    }
  }, 60_000)
})

describe('tui 启动动画', () => {
  it('车从屏幕外开进来，停在中央；逐字打出标题', () => {
    const cols = 120
    const target = Math.floor((cols - SPRITE_WIDTH) / 2)
    expect(carX(0, cols)).toBe(-SPRITE_WIDTH)
    expect(carX(1, cols)).toBe(target)
    expect(carX(2, cols)).toBe(target) // 超过 1 也停在中央
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => carX(t, cols))
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]!)
    expect([typed(0), typed(0.59), typed(0.65), typed(0.75), typed(0.9), typed(1)]).toEqual([0, 0, 2, 4, 6, 6])
  })
  it('窄终端：车不会停在负的位置', () => {
    expect(carX(1, 20)).toBe(0)
  })
})
