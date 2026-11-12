import { describe, expect, it } from 'vitest'
import { powershellCopyArgs, osc52 } from '../src/tui/clipboard.js'
import { edit, initial, splitAtCursor } from '../src/tui/input.js'
import { COLORS, FRAMES, POSES, SPRITE_HEIGHT, SPRITE_WIDTH, toCells, toRuns } from '../src/tui/mascot.js'
import { cliLine, fields, groupCommands, quote, toInvocation } from '../src/tui/model.js'
import { splitCursor } from '../src/cli/exec.js'
import { clamp, commandVisible, filterPalette, layoutFor, paletteText, scrollTo } from '../src/tui/state.js'
import { columnsFor, flatten, kindOf, seatText, seatTone, wrap } from '../src/tui/summary.js'
import { clip, count, padEnd, padStart, width } from '../src/tui/text.js'
import { LATTE, MOCHA, pickLook } from '../src/tui/theme.js'
import { findPlatform } from '../src/platforms/index.js'

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('tui 文本宽度', () => {
  it('中文占 2 列，截断和补齐按显示宽度', () => {
    expect(width('杭州')).toBe(4)
    expect(clip('上海虹桥站', 7)).toBe('上海虹…')
    expect(width(clip('上海虹桥站', 7))).toBeLessThanOrEqual(7)
    expect(width(padEnd('北京', 8))).toBe(8)
    expect(width(padStart('北京', 8))).toBe(8)
    expect(padEnd('abc', 6, '...')).toBe('abc   ')
    expect(clip('abcdefgh', 5, '...')).toBe('ab...')
  })
  it('数字缩写', () => {
    expect([count(null), count(999), count(12000), count(1.5e8)]).toEqual(['-', '999', '1.2万', '1.5亿'])
  })
})

describe('tui 配色', () => {
  it('两套配色的文字对三种底色都不低于 4.5:1', () => {
    for (const p of [MOCHA, LATTE]) {
      for (const bg of [p.bg, p.sel, p.bar]) {
        for (const k of ['fg', 'sub', 'dim', 'accent', 'mauve', 'green', 'yellow', 'red', 'blue', 'teal', 'pink', 'sky'] as const) {
          expect(contrast(p[k], bg), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
  it('环境变量：NO_COLOR、ASCII、强制主题、COLORFGBG', () => {
    expect(pickLook({}).palette).toBe(MOCHA)
    expect(pickLook({ NO_COLOR: '1' }).mono).toBe(true)
    expect(pickLook({ NO_COLOR: '' }).mono).toBe(false)
    expect(pickLook({ CATBUS_TUI_ASCII: '1' }).ascii).toBe(true)
    expect(pickLook({ CATBUS_TUI_ASCII: '0' }).ascii).toBe(false)
    expect(pickLook({ CATBUS_TUI_THEME: 'light' }).palette).toBe(LATTE)
    expect(pickLook({ COLORFGBG: '0;15' }).palette).toBe(LATTE)
    expect(pickLook({ COLORFGBG: '15;0' }).palette).toBe(MOCHA)
    expect(pickLook({ COLORFGBG: '0;15', CATBUS_TUI_THEME: 'dark' }).palette).toBe(MOCHA)
    // 动画：Windows 默认关，其余系统默认开，CATBUS_TUI_ANIMATE 可以覆盖
    expect([pickLook({}, 'darwin').animate, pickLook({}, 'linux').animate, pickLook({}, 'win32').animate]).toEqual([true, true, false])
    // 转圈字形：老的 Windows 控制台没有盲文字形；Windows Terminal（WT_SESSION）有
    expect([pickLook({}, 'darwin').plainSpinner, pickLook({}, 'win32').plainSpinner, pickLook({ WT_SESSION: 'x' }, 'win32').plainSpinner, pickLook({ CATBUS_TUI_ASCII: '1' }, 'linux').plainSpinner]).toEqual([false, true, false, true])
    expect([pickLook({ CATBUS_TUI_ANIMATE: '1' }, 'win32').animate, pickLook({ CATBUS_TUI_ANIMATE: '0' }, 'darwin').animate]).toEqual([true, false])
  })
})

describe('tui 输入编辑', () => {
  it('中文和 emoji 按字素移动与删除', () => {
    let s = initial('')
    for (const ch of ['杭', '州', '👨‍👩‍👧']) s = edit(s, ch, {})!
    expect(s.value).toBe('杭州👨‍👩‍👧')
    s = edit(s, '', { backspace: true })!
    expect(s.value).toBe('杭州')
    s = edit(s, '', { leftArrow: true })!
    expect(splitAtCursor(s)).toEqual(['杭', '州', ''])
  })
  it('Windows 终端的退格报成 delete 时也是向前删一个', () => {
    expect(edit(initial('abc'), '', { delete: true })!.value).toBe('ab')
  })
  it('Ctrl 组合键；Enter、Tab、上下键不处理', () => {
    expect(edit(initial('hello world'), 'w', { ctrl: true })!.value).toBe('hello ')
    expect(edit(initial('abc'), 'u', { ctrl: true })!.value).toBe('')
    expect(edit(initial('abc'), '', { return: true })).toBeNull()
    expect(edit(initial('abc'), '', { tab: true })).toBeNull()
    expect(edit(initial('abc'), '', { upArrow: true })).toBeNull()
  })
  it('粘贴的多行压成一行', () => {
    expect(edit(initial(''), 'a\r\nb\nc', {})!.value).toBe('a b c')
  })
})

describe('tui 表单与等价命令', () => {
  const xhs = findPlatform('xhs')!
  const train = findPlatform('12306')!
  const cmd = (p: typeof xhs, key: string) => groupCommands(p).flatMap((g) => g.commands).find((c) => c.key === key)!

  it('位置参数在前、选项在后，分页选项不进表单', () => {
    const f = fields(cmd(train, 'ticket search'))
    expect(f.map((x) => x.label)).toEqual(['<from>', '<to>', '--date', '--type', '--available'])
    expect(f.filter((x) => x.kind === 'arg').every((x) => x.required)).toBe(true)
  })
  it('等价命令：未填的参数写占位，默认值不写出', () => {
    const c = cmd(train, 'ticket search')
    expect(cliLine(train, c, {})).toBe('catbus 12306 ticket search <from> <to>')
    expect(cliLine(train, c, { '<from>': '北京', '<to>': '上海', '--date': '2026-11-02', '--available': true })).toBe(
      'catbus 12306 ticket search 北京 上海 --date 2026-11-02 --available',
    )
  })
  it('引号：安全字符不加，空格和 shell 特殊字符加；Windows 用双引号', () => {
    expect(quote('机械键盘', 'posix')).toBe('机械键盘')
    expect(quote('a b', 'posix')).toBe("'a b'")
    expect(quote("it's", 'posix')).toBe("'it'\\''s'")
    expect(quote('a&b|c', 'posix')).toBe("'a&b|c'")
    expect(quote('a b', 'win')).toBe('"a b"')
    expect(quote('say "hi"', 'win')).toBe('"say \\"hi\\""')
    expect(quote('https://x.com/a?b=1', 'posix')).toBe("'https://x.com/a?b=1'")
  })
  it('表单值 → 位置参数和选项', () => {
    const { words, given } = toInvocation(cmd(train, 'ticket search'), { '<from>': '北京', '<to>': '上海', '--available': true, '--type': 'G,D' })
    expect(words).toEqual(['北京', '上海'])
    expect(given).toEqual({ available: true, type: 'G,D' })
  })
  it('xhs item search 的 --sort 是枚举，值来自注册表', () => {
    const f = fields(cmd(xhs, 'item search')).find((x) => x.label === '--sort')!
    expect(f.kind).toBe('enum')
    expect(f.values).toContain('general')
  })
})

describe('tui 导航状态', () => {
  it('滚动窗口始终包含选中行', () => {
    expect(scrollTo(0, 0, 10, 50)).toBe(0)
    expect(scrollTo(12, 0, 10, 50)).toBe(3)
    expect(scrollTo(2, 5, 10, 50)).toBe(2)
    expect(scrollTo(3, 9, 10, 8)).toBe(0)
    expect(clamp(-1, 0, 3)).toBe(0)
  })
  it('命令栏多于一屏时留一行给页码', () => {
    expect(commandVisible(10, 20)).toBe(18)
    expect(commandVisible(40, 20)).toBe(17)
  })
  it('布局：<80 列或 <24 行提示放大，≥110 三栏', () => {
    expect([layoutFor(79, 30), layoutFor(100, 23), layoutFor(80, 24), layoutFor(109, 30), layoutFor(110, 30)]).toEqual(['tiny', 'tiny', 'narrow', 'narrow', 'wide'])
  })
  it('cursor 的 #skip 后缀', () => {
    expect(splitCursor('abc#skip=3')).toEqual({ cursor: 'abc', skip: 3 })
    expect(splitCursor('#skip=2')).toEqual({ cursor: null, skip: 2 })
    expect(splitCursor(null)).toEqual({ cursor: null, skip: 0 })
  })
  it('命令面板：每个词都要命中（平台名、别名、说明、命令名）', () => {
    const p = findPlatform('12306')!
    const c = groupCommands(p).flatMap((g) => g.commands).find((x) => x.key === 'ticket search')!
    const entries = [{ platform: p, command: c, text: paletteText(p, c) }]
    expect(filterPalette(entries, '12306 ticket')).toHaveLength(1)
    expect(filterPalette(entries, '铁路 余票')).toHaveLength(1)
    expect(filterPalette(entries, 'ticket nope')).toHaveLength(0)
    expect(filterPalette(entries, '')).toHaveLength(1)
  })
})

describe('tui 结果摘要', () => {
  const ticket = {
    id: 'G1', url: 'https://x', train_no: '24', type: 'G', from: { code: 'VNP', name: '北京南', no: '01' }, to: { code: 'AOH', name: '上海虹桥', no: '07' },
    depart: '06:30', arrive: '11:24', duration: '04:54', date: '2026-10-10', bookable: true, has_ticket: true, seat_types: 'OM9',
    seats: { 二等座: '有', 一等座: '有', 商务座: '无', 无座: '无' },
    remaining: { 二等座: { min: 21 }, 一等座: 6, 商务座: 0, 无座: 46 },
    prices: { 二等座: { amount: 661, currency: 'CNY' }, 一等座: { amount: 1058, currency: 'CNY' } },
  }
  it('按字段形状认类型', () => {
    expect(kindOf(ticket)).toBe('ticket')
    expect(kindOf({ id: '1', kind: 'video', stats: {}, media: [] })).toBe('item')
    expect(kindOf({ id: '1', name: 'x' })).toBe('named')
    expect(kindOf('x')).toBe('generic')
  })
  it('余票：≤20 精确，≥21 写 21+，无座不封顶；颜色按张数', () => {
    expect(seatText(ticket, '二等座')).toBe('21+')
    expect(seatText(ticket, '一等座')).toBe('6')
    expect(seatText(ticket, '无座')).toBe('46')
    expect(seatText(ticket, '软卧')).toBe('—')
    expect([seatTone(ticket, '二等座'), seatTone(ticket, '一等座'), seatTone(ticket, '商务座'), seatTone(ticket, '无座')]).toEqual(['ok', 'warn', 'dim', 'ok'])
  })
  it('余票表：窗口窄时二等座一定在，宽时最多 4 个席别', () => {
    const heads = (room: number) => columnsFor([ticket], room).map((c) => c.head)
    expect(heads(60)).toContain('二等座')
    expect(heads(60).length).toBeLessThan(heads(140).length)
    expect(heads(140)).toEqual(['车次', '出发 → 到达', '历时', '商务座', '一等座', '二等座', '无座'])
  })
  it('余票详情：席别合并成一行，不重复 seats / remaining / prices', () => {
    const keys = flatten(ticket).map((l) => l.key)
    expect(keys).toContain('二等座')
    expect(keys.some((k) => k.startsWith('seats') || k.startsWith('remaining') || k.startsWith('prices'))).toBe(false)
    expect(flatten(ticket).find((l) => l.key === '二等座')!.value).toBe('21+  ¥661')
  })
  it('通用摊平：价格、用户引用、数组个数', () => {
    const lines = flatten({ price: { amount: 12.5, currency: 'CNY' }, author: { id: 'u1', name: '阿柴', url: null }, media: [{}, {}], tags: ['a', 'b'] })
    expect(lines).toEqual([
      { key: 'price', value: '¥12.5' },
      { key: 'author', value: '阿柴（u1）' },
      { key: 'media', value: '2 个' },
      { key: 'tags', value: 'a、b' },
    ])
  })
  it('折行按显示宽度，不拆中文', () => {
    expect(wrap('一二三四五', 6, width)).toEqual(['一二三', '四五'])
    expect(wrap('abcdef', 4, width)).toEqual(['abcd', 'ef'])
  })
})

describe('tui 吉祥物', () => {
  it('每帧大小一致，只用调色板里的颜色', () => {
    for (const f of FRAMES) {
      expect(f).toHaveLength(SPRITE_HEIGHT)
      for (const row of f) {
        expect(row).toHaveLength(SPRITE_WIDTH)
        for (const k of row) if (k) expect(COLORS).toHaveProperty(k)
      }
    }
    expect(FRAMES).toHaveLength(POSES.length)
  })
  it('帧之间确实不同（颠簸、眨眼、转轮）', () => {
    expect(new Set(FRAMES.map((f) => JSON.stringify(f))).size).toBe(FRAMES.length)
  })
  it('压成终端单元格：高度减半，宽度不变；连续同色合并', () => {
    const cells = toCells(FRAMES[0]!)
    expect(cells).toHaveLength(SPRITE_HEIGHT / 2)
    for (const line of cells) expect(line).toHaveLength(SPRITE_WIDTH)
    for (const runs of toRuns(cells)) expect(runs.reduce((n, r) => n + r.text.length, 0)).toBe(SPRITE_WIDTH)
    expect(FRAMES[0]!.flat().filter(Boolean).length).toBeGreaterThan(150)
  })
})

describe('tui 剪贴板', () => {
  it('PowerShell 命令用 base64 传文字，避开引号和代码页', () => {
    const args = powershellCopyArgs("catbus xhs item search '键盘' $x")
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    const b64 = /FromBase64String\('([^']+)'\)/.exec(args[3]!)![1]!
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe("catbus xhs item search '键盘' $x")
    expect(args[3]).not.toContain('键盘')
  })
  it('OSC 52 序列', () => {
    expect(osc52('hi')).toBe('\x1b]52;c;aGk=\x07')
  })
})
