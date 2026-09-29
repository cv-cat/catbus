import { createHash, createHmac } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RequestError } from 'wreq-js'
import { z } from 'zod'
import { satisfies } from '../src/cli/commands/doctor.js'
import { nativeHint } from '../src/cli/hints.js'
import { ACCOUNT_RE, checkAccountName, getCurrent, listAccounts, newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { checkProxy, parseKey, resolveNetwork, setConfig } from '../src/core/config.js'
import { CookieJar } from '../src/core/cookies.js'
import { EXIT_CODES } from '../src/core/errors.js'
import { isoNow, writeFileAtomic } from '../src/core/fsutil.js'
import { hmacSha256Hex, md5Hex, sha256Hex } from '../src/core/hash.js'
import { toNetworkError } from '../src/core/http.js'
import { redact } from '../src/core/log.js'
import * as n from '../src/core/normalize.js'
import { describeOption, filter, flagName, parseDuration, PUBLISH } from '../src/core/options.js'
import { loadScript } from '../src/core/vm.js'
import { checkMsgSend } from '../src/core/vocab.js'
import { useTempHome } from './helpers.js'

const home = useTempHome()

describe('errors', () => {
  it('退出码（AGENTS 6.4）', () => {
    expect(EXIT_CODES).toEqual({
      ERROR: 1,
      USAGE: 2,
      UNSUPPORTED: 2,
      CONFIRM_REQUIRED: 2,
      AUTH_REQUIRED: 3,
      AUTH_EXPIRED: 3,
      NOT_IMPLEMENTED: 4,
      RISK_CONTROL: 5,
      NETWORK: 6,
      UPSTREAM: 7,
    })
  })
})

describe('log.redact', () => {
  it('按键名打码，递归处理', () => {
    expect(
      redact({ headers: { Cookie: 'a=1', 'x-token': 't', accept: '*/*' }, scopes: { main: { cookies: [{ value: 'v' }] } }, n: 1 }),
    ).toEqual({ headers: { Cookie: '***', 'x-token': '***', accept: '*/*' }, scopes: { main: { cookies: '***' } }, n: 1 })
  })

  it('字符串里的 key=value / key: value 也打码', () => {
    expect(redact('GET /a?access_token=abc&x=1')).toBe('GET /a?access_token=***&x=1')
    expect(redact('Authorization: Bearer xyz')).toBe('Authorization: Bearer ***')
    expect(redact('Cookie: a1=x; web_session=y\nAccept: */*')).toBe('Cookie: ***\nAccept: */*')
    expect(redact('SESSDATA=secret; bili_jct=1')).toBe('SESSDATA=***; bili_jct=1')
    expect(redact({ proxy: 'socks5://user:pass@127.0.0.1:1080' })).toEqual({ proxy: 'socks5://***@127.0.0.1:1080' })
  })
})

describe('options', () => {
  it('parseDuration', () => {
    expect(parseDuration('90')).toBe(90_000)
    expect(parseDuration('10m')).toBe(600_000)
    expect(parseDuration('1.5h')).toBe(5_400_000)
    expect(() => parseDuration('10x')).toThrow()
  })

  it('describeOption 读出类型、默认值、枚举', () => {
    expect(describeOption(PUBLISH.visibility)).toEqual({
      kind: 'string',
      required: false,
      default: 'public',
      values: ['public', 'private', 'friends'],
      description: '可见范围',
    })
    expect(describeOption(PUBLISH.image).kind).toBe('array')
    expect(describeOption(z.number().int()).required).toBe(true)
    expect(describeOption(filter.kind('recommend', 'hot')).default).toBe('recommend')
    expect(describeOption(filter.sort('latest')).default).toBeUndefined()
  })

  it('flagName', () => {
    expect(flagName('replyTo')).toBe('reply-to')
    expect(flagName('passwordStdin')).toBe('password-stdin')
  })
})

describe('hints', () => {
  it('不是原生叫法时返回 null', () => {
    expect(nativeHint('xhs', 'item', 'repost')).toBeNull()
    expect(nativeHint('xhs', 'auth', 'status')).toBeNull()
  })

  it('collection 按平台区分', () => {
    expect(nativeHint('kuaishou', 'collection', 'list')).toBe('用规范词：catbus kuaishou series list')
    expect(nativeHint('xhs', 'board', undefined)).toBe('用规范词：catbus xhs folder')
    expect(nativeHint('xhs', 'playurl', undefined)).toBe('用规范词：catbus xhs item media')
  })
})

describe('doctor.satisfies', () => {
  it('engines 范围', () => {
    const range = '^22.22.2 || ^24.15.0 || >=26.0.0'
    expect(satisfies('22.22.2', range)).toBe(true)
    expect(satisfies('22.23.1', range)).toBe(true)
    expect(satisfies('22.22.1', range)).toBe(false)
    expect(satisfies('23.0.0', range)).toBe(false)
    expect(satisfies('24.14.9', range)).toBe(false)
    expect(satisfies('24.15.0', range)).toBe(true)
    expect(satisfies('26.0.0', range)).toBe(true)
    expect(satisfies('27.1.0', range)).toBe(true)
  })
})

describe('fsutil', () => {
  it('isoNow 带时区偏移', () => {
    expect(isoNow()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
  })

  it('原子写入：覆盖已有文件，不留临时文件；POSIX 下文件 0600、目录 0700', async () => {
    const file = join(home.dir, 'a', 'b.json')
    await writeFileAtomic(file, '1')
    await writeFileAtomic(file, '2')
    expect(readFileSync(file, 'utf8')).toBe('2')
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(join(home.dir, 'a'))).toEqual(['b.json'])
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
      expect(statSync(join(home.dir, 'a')).mode & 0o777).toBe(0o700)
    }
  })
})

describe('auth-store', () => {
  it('账号名规则', () => {
    expect(ACCOUNT_RE.test('work_2-a')).toBe(true)
    expect(ACCOUNT_RE.test('-a')).toBe(false)
    expect(ACCOUNT_RE.test('A')).toBe(false)
    expect(ACCOUNT_RE.test('a'.repeat(33))).toBe(false)
    expect(() => checkAccountName('guest')).toThrow()
    expect(checkAccountName('guest', { allowGuest: true })).toBe('guest')
  })

  it('读写凭证，_current 指向已删除的账号时视为没有', async () => {
    const c = newCredential({ platform: 'xhs', endpoint: 'web', account: 'work', method: 'cookie' })
    await writeCredential(c)
    expect(await readCredential('xhs', 'web', 'work')).toEqual(c)
    expect(await readCredential('xhs', 'web', 'nobody')).toBeNull()
    await setCurrent('xhs', 'web', 'work')
    expect(await getCurrent('xhs', 'web')).toBe('work')
    await setCurrent('xhs', 'web', null)
    expect(await getCurrent('xhs', 'web')).toBeNull()
    writeFileSync(join(home.dir, 'auth', 'xhs', 'web', '_current'), 'ghost\n')
    expect(await getCurrent('xhs', 'web')).toBeNull()
  })

  it('游客文件不出现在账号列表里；损坏的凭证列出来但 user 为 null', async () => {
    await writeCredential(newCredential({ platform: 'xhs', endpoint: 'web', account: 'guest', method: 'guest' }))
    writeFileSync(join(home.dir, 'auth', 'xhs', 'web', 'broken.json'), '{')
    expect((await listAccounts('xhs', 'web')).map((a) => [a.account, a.user])).toEqual([['broken', null]])
    await expect(readCredential('xhs', 'web', 'broken')).rejects.toThrow(/损坏/)
  })
})

describe('config', () => {
  it('代理协议', () => {
    for (const ok of ['http://a:1', 'https://a:1', 'socks4://a:1', 'socks5://u:p@a:1', 'socks5h://a:1']) expect(checkProxy(ok)).toBe(ok)
    expect(() => checkProxy('ftp://a')).toThrow()
    expect(() => checkProxy('127.0.0.1:7890')).toThrow()
  })

  it('parseKey', () => {
    const resolve = (n: string) => ({ xhs: 'xhs', rednote: 'xhs' })[n]
    expect(parseKey('proxy', resolve)).toEqual(['proxy'])
    expect(parseKey('rednote.proxy', resolve)).toEqual(['xhs', 'proxy'])
    expect(() => parseKey('xhs.timeout', resolve)).toThrow()
  })

  it('代理优先级：--proxy > <platform>.proxy > proxy；不读 HTTP(S)_PROXY', async () => {
    process.env.HTTPS_PROXY = 'http://env:1'
    try {
      expect(await resolveNetwork('xhs', undefined)).toEqual({ proxy: null, timeout: 30 })
      await setConfig(['proxy'], 'http://global:1')
      expect((await resolveNetwork('xhs', undefined)).proxy).toBe('http://global:1')
      await setConfig(['xhs', 'proxy'], 'socks5://xhs:1')
      expect((await resolveNetwork('xhs', undefined)).proxy).toBe('socks5://xhs:1')
      expect((await resolveNetwork('douyin', undefined)).proxy).toBe('http://global:1')
      expect((await resolveNetwork('xhs', 'http://cli:1')).proxy).toBe('http://cli:1')
    } finally {
      delete process.env.HTTPS_PROXY
    }
  })
})

describe('http', () => {
  it('网络错误映射成 NETWORK，detail.kind 区分原因', () => {
    const kind = (m: string) => toNetworkError(new RequestError(m))
    expect(kind('error sending request: operation timed out').detail).toEqual({ kind: 'timeout' })
    expect(kind('client error (ProxyConnect): tunnel error').detail).toEqual({ kind: 'proxy' })
    expect(kind('client error (Connect): tcp connect error').detail).toEqual({ kind: 'connect' })
    expect(kind('dns error: failed to lookup address information').detail).toEqual({ kind: 'dns' })
    expect(kind('invalid peer certificate: UnknownIssuer').detail).toEqual({ kind: 'tls' })
    expect(kind('x').code).toBe('NETWORK')
    expect(toNetworkError(new Error('bug')).code).toBe('ERROR')
  })
})

describe('vm', () => {
  it('脚本在独立 context 里执行，可以 require，结果复用', () => {
    const file = join(home.dir, 'sign.js')
    writeFileSync(file, `var calls = 0; function sign(s) { calls++; return require('node:crypto').createHash('md5').update(s).digest('hex') }`)
    const ctx = loadScript(file)
    expect(ctx.sign('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(loadScript(file)).toBe(ctx)
    expect((globalThis as any).sign).toBeUndefined()
  })
})

describe('HttpClient', () => {
  it('逐跳跟随跳转：中间跳转的 Set-Cookie 进 cookie 罐，下一跳带上；POST 302 改成 GET', async () => {
    const { CookieJar } = await import('../src/core/cookies.js')
    const { HttpClient, mockSender, fakeResponse } = await import('../src/core/http.js')
    const seen: { method: string; url: string; cookies: [string, string][]; headers: [string, string][] }[] = []
    const restore = mockSender((p) => {
      seen.push({ method: p.method, url: p.url, cookies: p.cookies, headers: p.headers })
      if (seen.length === 1) return fakeResponse('', { status: 302, headers: [['location', '/next?x=1'], ['set-cookie', 'a=1; Domain=example.com; Path=/']] })
      return fakeResponse('ok', { headers: [['set-cookie', 'evil=1; Domain=other.com']] })
    })
    try {
      const jar = new CookieJar()
      const res = await new HttpClient({ jar }).request({ method: 'POST', url: 'https://www.example.com/login', form: { u: 'x' } })
      expect(await res.text()).toBe('ok')
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['POST https://www.example.com/login', 'GET https://www.example.com/next?x=1'])
      expect(seen[1]!.cookies).toEqual([['a', '1']])
      expect(seen[1]!.headers.some(([k]) => k.toLowerCase() === 'content-type')).toBe(false)
      // 跨域的 Set-Cookie 被丢弃
      expect(jar.cookies.map((c) => c.name)).toEqual(['a'])
    } finally {
      restore()
    }
  })
})

describe('vm.callScript', () => {
  it('能调用顶层 const 声明的函数', async () => {
    const { callScript } = await import('../src/core/vm.js')
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(process.env.CATBUS_HOME!, 'const.js')
    writeFileSync(file, 'const add = (a, b) => a + b; function mul(a, b) { return a * b }')
    expect(callScript(file, 'add', [1, 2])).toBe(3)
    expect(callScript(file, 'mul', [2, 3])).toBe(6)
    expect(() => callScript(file, 'nope', [])).toThrow(/没有函数/)
  })
})

describe('login.poll', () => {
  it('偶发的网络错误不中断轮询；连续失败才放弃；其他错误照常抛出', async () => {
    const { poll } = await import('../src/core/login.js')
    const { CatbusError } = await import('../src/core/errors.js')
    const net = () => new CatbusError('NETWORK', '网络错误', { detail: { kind: 'connect' } })
    const err = process.stderr.write
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      let n = 0
      expect(await poll(async () => (++n === 1 ? Promise.reject(net()) : n < 3 ? undefined : 'ok'), { interval: 1 })).toBe('ok')
      await expect(poll(async () => Promise.reject(net()), { interval: 1 })).rejects.toMatchObject({ code: 'NETWORK' })
      await expect(poll(async () => Promise.reject(new CatbusError('UPSTREAM', 'x')), { interval: 1 })).rejects.toMatchObject({ code: 'UPSTREAM' })
    } finally {
      process.stderr.write = err
    }
  })
})

describe('http：按响应头的 charset 解码', () => {
  it('charset=gbk 的响应按 GBK 解码（京东 loginservice）；没声明或 UTF-8 时不变', async () => {
    const { HttpClient, mockSender, fakeResponse } = await import('../src/core/http.js')
    // 「晨曦」的 GBK 编码
    const gbk = new Uint8Array([0xb3, 0xbf, 0xea, 0xd8])
    const bodies: Record<string, [Uint8Array | string, string]> = {
      'https://a.test/gbk': [Uint8Array.from([...Buffer.from('{"n":"'), ...gbk, ...Buffer.from('"}')]), 'text/json;charset=gbk'],
      'https://a.test/utf8': ['{"n":"晨曦"}', 'application/json; charset=utf-8'],
      'https://a.test/none': ['{"n":"晨曦"}', 'application/json'],
    }
    const restore = mockSender((p) => {
      const [body, type] = bodies[p.url]!
      return fakeResponse(body, { headers: [['content-type', type]], url: p.url })
    })
    try {
      const h = new HttpClient({ timeout: 5 })
      for (const url of Object.keys(bodies)) expect(await h.json(({ url }) as any), url).toEqual({ n: '晨曦' })
      expect(await (await h.request({ url: 'https://a.test/gbk' })).clone().text()).toBe('{"n":"晨曦"}')
    } finally {
      restore()
    }
  })
})

describe('normalize 工具', () => {
  it('time：秒、毫秒、微秒；不带时区的日期时间按北京时间', () => {
    expect(n.time(1790000000)).toBe(n.time(1790000000000))
    expect(n.time(1790000000123456)).toBe(n.time(1790000000123))
    expect(n.time('2025-08-01 12:00')).toBe(n.time('2025-08-01T04:00:00Z'))
    expect(n.time('2025-08-01 12:00:05')).toBe(n.time('2025-08-01T12:00:05+08:00'))
    expect(n.time('Wed Oct 10 20:19:24 +0000 2018')).toBe(n.time('2018-10-10T20:19:24Z'))
    expect(n.time('')).toBeNull()
  })

  it('price：带货币符号、千分位、负号的字符串', () => {
    expect(n.price('¥1,099.00')).toEqual({ amount: 1099, currency: 'CNY' })
    expect(n.price('总额 -23.28', 'USD')).toEqual({ amount: -23.28, currency: 'USD' })
    expect(n.price(12)).toEqual({ amount: 12, currency: 'CNY' })
    expect(n.price('面议')).toBeNull()
  })

  it('plainText / unescapeHtml：标签、换行、表情 alt、命名与数字实体', () => {
    expect(n.plainText('<em class="keyword">猫</em>&amp;&#39;狗&#x27;&nbsp;')).toBe("猫&'狗' ")
    expect(n.plainText('a<br/>b<img alt="[笑]" src="x">')).toBe('a\nb[笑]')
    expect(n.plainText('')).toBeNull()
    expect(n.unescapeHtml('&lt;&yen;&unknown;')).toBe('<¥&unknown;')
  })
})

describe('checkMsgSend', () => {
  it('目标三选一（--to 与 --item 可以同时用），平台可追加目标与内容', () => {
    expect(checkMsgSend({ text: 'hi' }, { to: 'u', item: 'i' })).toBeUndefined()
    expect(checkMsgSend({ text: 'hi' }, { conversation: 'c', item: 'i' })).toMatch(/需要用一个/)
    expect(checkMsgSend({}, { to: 'u' })).toBe('需要 <text>、--image 或 --video')
    expect(checkMsgSend({ text: 'hi' }, { order: 'o' }, { targets: ['order'] })).toBeUndefined()
    expect(checkMsgSend({}, { to: 'u', share: 's' }, { content: ['file', 'share'] })).toBeUndefined()
  })
})

describe('CookieJar.header / hash', () => {
  it('header 按 url 过滤、按存入顺序拼接', () => {
    const jar = new CookieJar([
      { name: 'a', value: '1', domain: '.x.com', path: '/', expires: null },
      { name: 'b', value: '2', domain: 'other.com', path: '/', expires: null },
      { name: 'c', value: '3', domain: 'www.x.com', path: '/', expires: null },
    ])
    expect(jar.header('https://www.x.com/')).toBe('a=1; c=3')
    expect(jar.header()).toBe('a=1; b=2; c=3')
  })

  it('md5 / sha256 / hmac', () => {
    expect(md5Hex('catbus')).toBe(createHash('md5').update('catbus').digest('hex'))
    expect(sha256Hex(new Uint8Array([1, 2]))).toBe(createHash('sha256').update(Buffer.from([1, 2])).digest('hex'))
    expect(hmacSha256Hex('k', 'v')).toBe(createHmac('sha256', 'k').update('v').digest('hex'))
  })
})
