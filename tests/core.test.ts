import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RequestError } from 'wreq-js'
import { z } from 'zod'
import { satisfies } from '../src/cli/commands/doctor.js'
import { nativeHint } from '../src/cli/hints.js'
import { ACCOUNT_RE, checkAccountName, getCurrent, listAccounts, newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { checkProxy, parseKey, resolveNetwork, setConfig } from '../src/core/config.js'
import { EXIT_CODES } from '../src/core/errors.js'
import { isoNow, writeFileAtomic } from '../src/core/fsutil.js'
import { toNetworkError } from '../src/core/http.js'
import { redact } from '../src/core/log.js'
import { describeOption, filter, flagName, parseDuration, PUBLISH } from '../src/core/options.js'
import { loadScript } from '../src/core/vm.js'
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
