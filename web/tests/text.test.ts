import { describe, expect, it } from 'vitest'
import { bbcodeBlocks } from '@/composables/bbcode'
import { linkLabel, linkSegments } from '@/composables/linkify'
import { emojiSegments } from '@/composables/emoji'
import xhs from '@/data/emoji/xhs.json'

describe('bbcode（7.9「种子详情」）', () => {
  it('空输入', () => {
    expect(bbcodeBlocks(null)).toEqual([])
    expect(bbcodeBlocks('')).toEqual([])
  })

  it('样式标记去掉、只留文字', () => {
    expect(bbcodeBlocks('[b]粗[/b] [color=red]红[/color] [size=4][font=宋体]字[/font][/size]')).toEqual([{ type: 'text', text: '粗 红 字' }])
  })

  it('[img] 与 Markdown 图片拆成图片块，只接受 http(s)', () => {
    const out = bbcodeBlocks('前[img]https://a.com/1.jpg[/img]中![](https://a.com/2.png)后[img=https://a.com/3.gif]')
    expect(out).toEqual([
      { type: 'text', text: '前' },
      { type: 'img', url: 'https://a.com/1.jpg' },
      { type: 'text', text: '中' },
      { type: 'img', url: 'https://a.com/2.png' },
      { type: 'text', text: '后' },
      { type: 'img', url: 'https://a.com/3.gif' },
    ])
    // 非 http(s) 的图片不成块，标记被去掉
    expect(bbcodeBlocks('[img]javascript:alert(1)[/img]')).toEqual([{ type: 'text', text: 'javascript:alert(1)' }])
  })

  it('[quote] 成引用块，[code] 成代码块且保留原样空白', () => {
    expect(bbcodeBlocks('[quote=某人][b]引用[/b][/quote]')).toEqual([{ type: 'quote', text: '引用' }])
    expect(bbcodeBlocks('[code]a  b\n  c[/code]')).toEqual([{ type: 'code', text: 'a  b\n  c' }])
  })

  it('[url=地址]文字[/url] 留文字和地址', () => {
    expect(bbcodeBlocks('[url=https://a.com]看这里[/url]')).toEqual([{ type: 'text', text: '看这里 https://a.com' }])
    expect(bbcodeBlocks('[url=https://a.com]https://a.com[/url]')).toEqual([{ type: 'text', text: 'https://a.com' }])
  })

  it('连续空行合并、去首尾空白、统一换行', () => {
    expect(bbcodeBlocks('\r\n\r\na  \r\n\r\n\r\n\r\nb  ')).toEqual([{ type: 'text', text: 'a\n\nb' }])
  })

  it('生成的只是文本，不含 HTML', () => {
    const out = bbcodeBlocks('<script>x</script>')
    expect(out).toEqual([{ type: 'text', text: '<script>x</script>' }])
  })
})

describe('linkify', () => {
  it('没有链接时原样一段', () => {
    expect(linkSegments('你好')).toEqual([{ t: '你好' }])
  })

  it('结尾标点、中文标点不算进链接', () => {
    expect(linkSegments('看 https://a.com/x。好的')).toEqual([{ t: '看 ' }, { t: 'https://a.com/x', href: 'https://a.com/x' }, { t: '。好的' }])
    expect(linkSegments('(https://a.com/x).')).toEqual([{ t: '(' }, { t: 'https://a.com/x', href: 'https://a.com/x' }, { t: ').' }])
  })

  it('配对的右括号留在链接里', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)'
    expect(linkSegments(`见 ${url}`)).toEqual([{ t: '见 ' }, { t: url, href: url }])
  })

  it('只有协议的不算链接', () => {
    expect(linkSegments('https://')).toEqual([{ t: 'https://' }])
  })

  it('显示文字去掉协议、www 和末尾斜杠，太长截断中间', () => {
    expect(linkLabel('https://www.a.com/')).toBe('a.com')
    const long = linkLabel(`https://a.com/${'x'.repeat(100)}`)
    expect([...long].length).toBe(46)
    expect(long).toContain('…')
    expect(long.startsWith('a.com/')).toBe(true)
  })
})

describe('emoji', () => {
  it('不认识的平台、没有方括号时原样', () => {
    expect(emojiSegments('jd', '[微笑R]')).toEqual([{ t: '[微笑R]' }])
    expect(emojiSegments('xhs', '你好')).toEqual([{ t: '你好' }])
  })

  it('小红书表情码换成图片，相对路径补全 CDN 和 .png', () => {
    const v = (xhs as Record<string, string>)['微笑R']!
    const out = emojiSegments('xhs', '早[微笑R]安')
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ t: '早' })
    expect(out[1]!.t).toBe('[微笑R]')
    expect(out[1]!.img).toMatch(/^https:\/\//)
    if (!v.startsWith('https://')) expect(out[1]!.img).toContain(v)
    expect(out[2]).toEqual({ t: '安' })
  })

  it('不认识的码与相邻文字合并成一段', () => {
    expect(emojiSegments('xhs', 'a[不存在的码]b')).toEqual([{ t: 'a[不存在的码]b' }])
  })

  it('抖音、微博的表都在', () => {
    expect(emojiSegments('douyin', '[捂脸]').some((s) => s.img)).toBe(true)
    expect(emojiSegments('weibo', '[心]').some((s) => s.img)).toBe(true)
  })
})
