import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keyringUser, sys } from '../src/platforms/jimeng/web/dreamina.js'
import { cli, useTempHome } from './helpers.js'

// 即梦只封装 dreamina 的登录态（AGENTS 5.6）。这里用内存里的「钥匙串」和假的 dreamina 代替真实环境。

/** dreamina 存进钥匙串的值：go-keyring-base64 + 登录态 JSON。gen 区分刷新前后的 token。 */
const blob = (uid: string, gen = 0) =>
  'go-keyring-base64:' + Buffer.from(`{"access_token":"t${gen}","user_info":{"user_id":${uid}}}`).toString('base64')

const home = useTempHome()

let keyring: string | null
/** 用户在浏览器里授权后，dreamina 会写进钥匙串的登录态；null 表示用户没有授权。 */
let authorized: string | null
/** 为 true 时 user_credit 会像真实 dreamina 一样刷新 token、改写钥匙串。 */
let refresh: boolean
let checkloginOutput: string
let calls: string[][]

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })

beforeEach(() => {
  keyring = null
  authorized = null
  refresh = false
  checkloginOutput = 'OAuth 登录成功。\n'
  calls = []
  vi.spyOn(sys, 'readKeyring').mockImplementation(async () => keyring)
  vi.spyOn(sys, 'writeKeyring').mockImplementation(async (value) => {
    keyring = value
  })
  vi.spyOn(sys, 'dreamina').mockImplementation(async (args) => {
    calls.push(args)
    switch (args[0]) {
      case 'relogin':
        keyring = null
        return ok(
          'verification_uri: https://jimeng.example/cli-auth?code=1\nuser_code: u1\ndevice_code: dev1\npoll_interval: 1s\n' +
            `expires_at: ${new Date(Date.now() + 600_000).toISOString()}\n`,
        )
      case 'login':
        keyring = authorized
        return authorized ? ok(checkloginOutput) : { code: 1, stdout: '', stderr: '等待登录超时，请重试\n' }
      case 'user_credit': {
        const uid = keyring && keyringUser(keyring)
        if (!uid) return ok('未检测到有效登录态，请先执行 dreamina login\n')
        if (refresh) keyring = blob(uid, 9)
        return ok(`{"total_credit":10,"user_id":${uid},"user_name":"","vip_level":""}\n`)
      }
      case 'logout':
        keyring = null
        return ok('')
      default:
        throw new Error(`没有模拟 dreamina ${args.join(' ')}`)
    }
  })
})

const saved = (account: string) =>
  JSON.parse(readFileSync(join(home.dir, 'auth/jimeng/web', `${account}.json`), 'utf8')).scopes.main.tokens.keyring

async function login(account: string, uid: string) {
  authorized = blob(uid)
  const r = await cli('jimeng', 'auth', 'login', '-a', account)
  expect(r.code, r.stderr).toBe(0)
  return r
}

describe('jimeng：dreamina 登录态', () => {
  it('keyringUser 取出用户 ID，超出安全整数也不丢精度', () => {
    expect(keyringUser(blob('9007199254740993123'))).toBe('9007199254740993123')
    expect(keyringUser('not-a-keyring-value')).toBeNull()
  })

  it('auth login：打出授权链接，保存登录态；第一个账号成为当前账号', async () => {
    const r = await login('a', '1001')
    expect(r.stderr).toContain('https://jimeng.example/cli-auth?code=1')
    expect(r.env.data).toMatchObject({ platform: 'jimeng', account: 'a', current: true, method: 'oauth', user: { id: '1001' } })
    expect(calls).toContainEqual(['login', 'checklogin', '--device_code=dev1', expect.stringMatching(/^--poll=\d+$/)])
    expect(saved('a')).toBe(blob('1001'))
    expect(keyring).toBe(blob('1001'))
  })

  it('登录第二个账号后，钥匙串切回当前账号', async () => {
    await login('a', '1001')
    const r = await login('b', '1002')
    expect(r.env.data).toMatchObject({ account: 'b', current: false, user: { id: '1002' } })
    expect(saved('b')).toBe(blob('1002'))
    expect(keyring).toBe(blob('1001'))
  })

  it('没有授权：AUTH_REQUIRED，钥匙串恢复成当前账号', async () => {
    await login('a', '1001')
    authorized = null
    const r = await cli('jimeng', 'auth', 'login', '-a', 'b')
    expect(r.env.error.code).toBe('AUTH_REQUIRED')
    expect(keyring).toBe(blob('1001'))
  })

  it('非会员账号登录时提示不能生成', async () => {
    checkloginOutput = 'OAuth 登录成功。\n登录成功，但当前账号没有 dreamina_cli 使用权限: 仅限会员用户使用\n'
    const r = await login('a', '1001')
    expect(r.stderr).toContain('不是会员')
  })

  it('auth use：把账号写进钥匙串，之前的账号被 dreamina 刷新过的 token 先存回去', async () => {
    await login('a', '1001')
    await login('b', '1002')
    keyring = blob('1001', 5) // 期间直接用 dreamina，token 被刷新了
    const r = await cli('jimeng', 'auth', 'use', 'b')
    expect(r.env.data).toMatchObject({ account: 'b', current: true })
    expect(keyring).toBe(blob('1002'))
    expect(saved('a')).toBe(blob('1001', 5))
  })

  it('钥匙串里是没保存过的账号时，切换前提示会被覆盖', async () => {
    await login('a', '1001')
    keyring = blob('9999')
    const r = await cli('jimeng', 'auth', 'use', 'a')
    expect(r.stderr).toContain('没有保存在 catbus 的账号里')
    expect(keyring).toBe(blob('1001'))
  })

  it('auth status：校验另一个账号后切回当前账号，刷新的 token 存进那个账号', async () => {
    await login('a', '1001')
    await login('b', '1002')
    refresh = true
    const r = await cli('jimeng', 'auth', 'status', '-a', 'b')
    expect(r.env.data).toMatchObject({ logged_in: true, user: { id: '1002' }, method: 'oauth' })
    expect(saved('b')).toBe(blob('1002', 9))
    expect(keyring).toBe(blob('1001'))
  })

  it('auth status：登录态失效时 logged_in 为 false', async () => {
    await login('a', '1001')
    vi.mocked(sys.dreamina).mockImplementation(async () => ok('未检测到有效登录态，请先执行 dreamina login\n'))
    const r = await cli('jimeng', 'auth', 'status')
    expect(r.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
  })

  it('auth logout：只有钥匙串里正是这个账号时才让 dreamina 登出', async () => {
    await login('a', '1001')
    await login('b', '1002')
    await cli('jimeng', 'auth', 'logout', '-a', 'b', '-y')
    expect(calls.some((c) => c[0] === 'logout')).toBe(false)
    expect(keyring).toBe(blob('1001'))
    await cli('jimeng', 'auth', 'logout', '-a', 'a', '-y')
    expect(calls.some((c) => c[0] === 'logout')).toBe(true)
    expect(keyring).toBeNull()
  })
})
