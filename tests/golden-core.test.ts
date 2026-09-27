import { describe, expect, it } from 'vitest'
import { buildUrl } from '../src/core/http.js'
import { jsonDumps, quote, quotePlus, urlencode } from '../src/core/py.js'
import * as rand from '../src/core/rand.js'
import { loadCase } from './golden.js'

describe('core 对拍：Python 编码函数', () => {
  const c = loadCase('core', 'encoding')
  const strings: string[] = c.result.strings

  it('quote / quote_plus', () => {
    expect(strings.map((s) => quote(s))).toEqual(c.result.quote)
    expect(strings.map((s) => quote(s, ':/?=&'))).toEqual(c.result.quote_safe)
    expect(strings.map((s) => quotePlus(s))).toEqual(c.result.quote_plus)
  })

  it('urlencode', () => {
    const pairs: [string, string | number | boolean | null][] = strings.map((s, i) => [`k${i}`, s])
    pairs.push(['n', 1], ['f', 1.5], ['t', true], ['none', null])
    expect(urlencode(pairs)).toBe(c.result.urlencode)
  })

  it('json.dumps', () => {
    expect(strings.map((s) => jsonDumps(s))).toEqual(c.result.dumps)
    expect(strings.map((s) => jsonDumps(s, { ensureAscii: false }))).toEqual(c.result.dumps_utf8)
    expect(jsonDumps({ a: [1, 2.5, null, true], 中: { k: '值' }, e: [] })).toBe(c.result.dumps_obj)
    expect(jsonDumps({ a: [1, 2.5, null, true], 中: { k: '值' } }, { separators: [',', ':'] })).toBe(c.result.dumps_compact)
  })
})

describe('core 对拍：curl_cffi 的 URL 拼接', () => {
  it('update_url_params + requote_uri', () => {
    const c = loadCase('core', 'curl_urls')
    const urls = c.result.cases.map(([url, params]: [string, [string, string | number | boolean][]]) => buildUrl(url, params))
    expect(urls).toEqual(c.result.urls)
  })
})

describe('core 对拍：确定性随机数与时钟', () => {
  it('与 Python 替换后的 random / secrets / uuid / time 逐项一致', () => {
    const c = loadCase('core', 'rand')
    const restore = rand.deterministic({ seed: c.seed, now: c.now })
    try {
      const shuffled = rand.shuffle
      expect({
        random: [rand.random(), rand.random(), rand.random()],
        randint: Array.from({ length: 5 }, () => rand.randint(1, 100)),
        choice: rand.string(10, 'abcdef0123'),
        sample: rand.sample(Array.from({ length: 20 }, (_, i) => i), 5),
        uniform: rand.uniform(2, 5),
        shuffle: shuffled(Array.from({ length: 8 }, (_, i) => i)),
        hex: rand.hex(8),
        uuid: rand.uuid4(),
        time: rand.now() / 1000,
        int_time: rand.nowSeconds(),
      }).toEqual(c.result)
    } finally {
      restore()
    }
  })
})
