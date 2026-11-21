import { constants, createHash, createPublicKey, publicEncrypt } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrent, newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import type { HandlerContext } from '../src/core/registry.js'
import { openSocket } from '../src/core/stream.js'
import * as commands from '../src/platforms/discord/pc/commands.js'
import { DiscordClient, storeToken } from '../src/platforms/discord/pc/client.js'
import { passwordToken } from '../src/platforms/discord/pc/auth.js'
import { showQrcode } from '../src/core/login.js'
import { expectRequests, loadCase, makeCtx, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

const IDENTITY = vi.hoisted(() => ({ os: 'Mac OS X', arch: 'arm64', release: '25.0.0', locale: 'en-US', timezone: 'UTC', launchId: '0123456789abcdef0123456789abcdef' }))
vi.mock('../src/platforms/discord/pc/client.js', async (load) => {
  const actual = await load<typeof import('../src/platforms/discord/pc/client.js')>()
  return { ...actual, DiscordClient: class extends actual.DiscordClient {
    constructor(ctx: HandlerContext) { super(ctx, IDENTITY) }
  } }
})
vi.mock('../src/core/stream.js', async (load) => ({ ...await load<typeof import('../src/core/stream.js')>(), openSocket: vi.fn() }))
vi.mock('../src/core/login.js', async (load) => ({ ...await load<typeof import('../src/core/login.js')>(), showQrcode: vi.fn(async () => 'fake.png') }))

const home = useTempHome()
const TOKEN = 'synthetic-discord-token'
const U = '1001', C = '2002', M = '3003', G = '4004'
const ctx = (input: Partial<Parameters<typeof makeCtx>[0]> = {}) => {
  const result = makeCtx({ platform: 'discord', ...input })
  storeToken(result, TOKEN)
  return result
}
const ids = { conversation: C, message: M }

beforeEach(() => { vi.mocked(openSocket).mockReset(); vi.mocked(showQrcode).mockClear() })

async function golden<T>(name: string, run: () => Promise<T>) {
  const fixture = loadCase('discord', name)
  const result = await replay(fixture, run)
  expect(result.error).toBeUndefined()
  expectRequests(result.requests, fixture.requests)
  return result.result
}

describe('Discord 请求与本地 Python 上游对拍', () => {
  it('账号、频道、服务器、消息、反应和 Gateway 查询', async () => {
    const data = await golden('reads', async () => [
      await commands.userGet(ctx()), await commands.userGet(ctx({ args: { user: U } })), await commands.accountSettings(ctx()),
      await commands.msgList(ctx()), await commands.guildList(ctx()), await commands.guildGet(ctx({ args: { guild: G } })),
      await commands.channelList(ctx({ args: { guild: G } })), await commands.channelGet(ctx({ args: { channel: C } })),
      await commands.msgHistory(ctx({ args: { conversation: C }, cursor: '9000' })), await commands.msgGet(ctx({ args: ids })),
      await commands.msgPins(ctx({ args: ids })), await commands.reactionList(ctx({ args: { ...ids, emoji: '👍' } })),
      await commands.gatewayGet(ctx()),
    ])
    expect(data?.[0]).toMatchObject({ id: U, name: '测试账号' })
    expect(data?.[9]).toMatchObject({ id: M, conversation_id: C, text: '你好 Discord' })
  })

  it('写入、连续 ACK、反应、好友和登出', async () => {
    const ack = ctx({ args: ids })
    await golden('changes', async () => {
      await commands.msgUpdate(ctx({ args: { ...ids, text: '编辑' } }))
      await commands.msgRevoke(ctx({ args: ids }))
      await commands.msgPurge(ctx({ args: { conversation: C, messages: '3003,3004' } }))
      await commands.msgRead(ack); await commands.msgRead(ack)
      await commands.msgTyping(ctx({ args: ids })); await commands.msgPin(ctx({ args: ids })); await commands.msgUnpin(ctx({ args: ids }))
      await commands.reactionAdd(ctx({ args: { ...ids, emoji: 'cat:123' } })); await commands.reactionDelete(ctx({ args: { ...ids, emoji: 'cat:123' } }))
      await commands.reactionDelete(ctx({ args: { ...ids, emoji: '👍' }, options: { userId: U } }))
      await commands.reactionClear(ctx({ args: { ...ids, emoji: '👍' } })); await commands.reactionClear(ctx({ args: ids }))
      await commands.friendAdd(ctx({ args: { target: U } })); await commands.friendAdd(ctx({ args: { target: 'someone#1234' } }))
      await commands.friendDelete(ctx({ args: { user: U } })); await commands.friendAccept(ctx({ args: { user: U } }))
      await commands.friendBlock(ctx({ args: { user: U } })); await commands.friendUnblock(ctx({ args: { user: U } }))
      await commands.guildLeave(ctx({ args: { guild: G } }))
      await commands.channelCreate(ctx({ args: { guild: G, name: 'new' }, options: { channelTopic: '主题', parent: '6006', channelPosition: 2 } }))
      await commands.channelUpdate(ctx({ args: { channel: C }, options: { name: 'rename', channelTopic: '' } }))
      await commands.channelDelete(ctx({ args: { channel: C } })); await commands.authLogout(ctx())
    })
  })

  it('回复与新建私信后发送', async () => {
    await golden('reply', () => commands.msgSend(ctx({ args: { text: '你好 Discord' }, options: { conversation: C, replyTo: M } })))
    await golden('dm_send', () => commands.msgSend(ctx({ args: { text: '你好 Discord' }, options: { to: U } })))
  })

  it('申请附件槽位、PUT 原始字节、发送消息，签名上传只使用必要请求头', async () => {
    const file = join(home.dir, 'fake.txt')
    await writeFile(file, 'example')
    const fixture = loadCase('discord', 'upload')
    const result = await replay(fixture, () => commands.msgSend(ctx({ args: { text: '附件' }, options: { conversation: C, file } })))
    expect(result.error).toBeUndefined()
    expectRequests(result.requests, fixture.requests.map((req, i) => i === 1 ? { ...req, headers: req.headers.slice(0, 3) } : req))
    expect(result.requests[1]?.headers.map(([k]) => k.toLowerCase())).not.toContain('authorization')
  })

  it('下载附件保留字节', async () => {
    const file = await golden('download', () => commands.attachmentDownload(ctx({ args: { url: 'https://cdn.discordapp.com/fake.txt' }, options: { dir: home.dir } })))
    expect(await readFile(file!.path, 'utf8')).toBe('example')
  })

  it('密码登录、TOTP、清理 fingerprint 后校验凭证', async () => {
    await golden('password_mfa', async () => {
      const login = makeCtx({ platform: 'discord', options: { code: '123456' } })
      const client = new DiscordClient(login)
      const token = await passwordToken(login, client, 'synthetic@example.test', 'fake-password')
      storeToken(login, token)
      client.clearFingerprint()
      return client.request('GET', '/users/@me')
    })
  })

  it('扫码 ticket 交换请求和设备 ID 的派生字节', async () => {
    await golden('qr_exchange', () => new DiscordClient(makeCtx({ platform: 'discord' })).request('POST', '/users/@me/remote-auth/login', { auth: false, json: { ticket: 'fake-ticket' } }))
    const fixture = loadCase('discord', 'device_uuid')
    const data = await replay(fixture, () => {
      // 生成器的第一份随机数就是设备的 random_prefix。
      const me = fakeResponse({ id: U })
      const restore = mockSender(() => me)
      return commands.deviceRegister(ctx()).finally(restore)
    })
    expect(data.error).toBeUndefined()
    expect(data.result?.client_uuid).toBe(fixture.result)
  })
})

describe('Discord Catbus 命令与失败边界', () => {
  it('账号列表迁移旧桌面凭证，并保留当前账号和 REST 安装 ID', async () => {
    const legacy = newCredential({ platform: 'discord', endpoint: 'web', account: 'work', method: 'token' })
    legacy.scopes.main!.tokens.authorization = TOKEN
    legacy.device.discord_installation_id = 'fake-installation'
    await writeCredential(legacy)
    await setCurrent('discord', 'web', 'work')

    const listing = await cli('auth', 'list')
    expect(listing.env.data).toContainEqual(expect.objectContaining({ platform: 'discord', endpoint: 'pc', account: 'work', current: true }))
    expect(await getCurrent('discord', 'pc')).toBe('work')
    expect(await readCredential('discord', 'web', 'work')).toBeNull()
    const restore = mockSender((request) => {
      expect(request.headers).toContainEqual(['x-installation-id', 'fake-installation'])
      return fakeResponse({ id: U, username: 'example' })
    })
    try {
      expect((await cli('discord', 'user', 'get')).env).toMatchObject({ ok: true, endpoint: 'pc', account: 'work' })
      expect((await cli('discord', 'user', 'get', '-e', 'web')).env.error.code).toBe('NOT_IMPLEMENTED')
    } finally { restore() }
  })

  it('已有 pc 账号时保留两端的原凭证', async () => {
    const legacy = newCredential({ platform: 'discord', endpoint: 'web', account: 'default', method: 'token' })
    const desktop = newCredential({ platform: 'discord', endpoint: 'pc', account: 'default', method: 'qrcode' })
    await writeCredential(legacy)
    await writeCredential(desktop)
    await cli('discord', 'auth', 'list')
    expect(await readCredential('discord', 'pc', 'default')).toMatchObject({ endpoint: 'pc', method: 'qrcode' })
    expect(await readCredential('discord', 'web', 'default')).toMatchObject({ endpoint: 'web', method: 'token' })
  })

  it('导入凭证，经 core 写入账号，再读取与服务端登出', async () => {
    const file = join(home.dir, 'token.txt')
    await writeFile(file, TOKEN + '\n', { mode: 0o600 })
    const requests: string[] = []
    const restore = mockSender((p) => {
      expect(p.headers).toContainEqual(['Authorization', TOKEN])
      requests.push(p.url)
      return p.url.endsWith('/logout') ? fakeResponse('', { status: 204 }) : fakeResponse({ id: U, username: 'example' })
    })
    try {
      const result = await cli('discord', 'auth', 'login', '--method', 'token', '--token-file', file)
      expect(result.code).toBe(0)
      expect(result.env.data.user.id).toBe(U)
      expect(result.stdout + result.stderr).not.toContain(TOKEN)
      expect((await readCredential('discord', 'pc', 'default'))?.scopes.main?.tokens.authorization).toBe(TOKEN)
      expect((await cli('discord', 'user', 'get')).env.data.id).toBe(U)
      const denied = await cli('discord', 'channel', 'delete', C)
      expect(denied.env.error.code).toBe('CONFIRM_REQUIRED')
      expect((await cli('discord', 'auth', 'logout')).code).toBe(0)
      expect(await readCredential('discord', 'pc', 'default')).toBeNull()
      expect(requests.map((url) => new URL(url).pathname)).toEqual(['/api/v9/users/@me', '/api/v9/users/@me', '/api/v9/auth/logout'])
    } finally { restore() }
  })

  it('拒绝跨源重定向，按凭证/风控/验证码分类', async () => {
    for (const [status, data, expected] of [
      [302, '', 'UPSTREAM'], [401, {}, 'AUTH_EXPIRED'], [429, { retry_after: 2 }, 'RISK_CONTROL'],
      [400, { captcha_key: ['required'], captcha_rqtoken: 'fake-challenge-token' }, 'RISK_CONTROL'],
    ] as const) {
      const spy = vi.fn(() => fakeResponse(data, { status, headers: [['Location', 'https://other.invalid/']] }))
      const restore = mockSender(spy)
      try {
        await expect(commands.userGet(ctx())).rejects.toMatchObject({ code: expected })
        expect(spy).toHaveBeenCalledTimes(1)
      } finally { restore() }
    }
  })

  it('二维码的 nonce 证明、指纹、票据、RSA-OAEP 解密与账号保存', async () => {
    const sent: Record<string, any>[] = []
    const close = vi.fn()
    let encryptedToken: string
    vi.mocked(openSocket).mockResolvedValue({ close, send: async (raw) => { sent.push(JSON.parse(String(raw))) }, messages: {
      async *[Symbol.asyncIterator]() {
        const spki = Buffer.from(sent[0]!.encoded_public_key, 'base64')
        const key = createPublicKey({ key: spki, format: 'der', type: 'spki' })
        const encrypt = (value: string) => publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(value)).toString('base64')
        encryptedToken = encrypt(TOKEN)
        yield JSON.stringify({ op: 'hello', heartbeat_interval: 100000 })
        yield JSON.stringify({ op: 'nonce_proof', encrypted_nonce: encrypt('challenge') })
        yield JSON.stringify({ op: 'pending_remote_init', fingerprint: createHash('sha256').update(spki).digest('base64url') })
        yield JSON.stringify({ op: 'pending_login', ticket: 'fake-ticket' })
      },
    } })
    const restore = mockSender((p) => {
      if (p.url.includes('/experiments')) return fakeResponse({ fingerprint: 'fake-fingerprint' })
      if (p.url.endsWith('/remote-auth/login')) {
        expect(p.body).toBe('{"ticket":"fake-ticket"}')
        expect(p.headers.some(([k]) => k.toLowerCase() === 'authorization')).toBe(false)
        return fakeResponse({ encrypted_token: encryptedToken })
      }
      return fakeResponse({ id: U, username: 'example' })
    })
    try {
      const result = await cli('discord', 'auth', 'login')
      expect(result.code).toBe(0)
      expect(result.env.data.method).toBe('qrcode')
      expect(sent[1]).toEqual({ op: 'nonce_proof', nonce: Buffer.from('challenge').toString('base64url') })
      expect(showQrcode).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(result.stdout + result.stderr).not.toContain(TOKEN)
    } finally { restore() }
  })

  it('Gateway 维持会话，在 op9 后恢复并屏蔽 READY 凭证字段', async () => {
    const sent: Record<string, any>[] = []
    const close = vi.fn()
    vi.mocked(openSocket).mockResolvedValue({ close, send: async (raw) => { sent.push(JSON.parse(String(raw))) }, messages: {
      async *[Symbol.asyncIterator]() {
        yield '{"op":10,"d":{"heartbeat_interval":50000}}'
        yield '{"op":11}'
        yield '{"op":0,"s":7,"t":"READY","d":{"session_id":"fake-session","analytics_token":"fake-analytics","resume_gateway_url":"wss://gateway.discord.gg/"}}'
        yield '{"op":9,"d":true}'
        yield '{"op":0,"s":8,"t":"MESSAGE_CREATE","d":{"id":"3003","channel_id":"2002","content":"你好"}}'
      },
    } })
    const gatewayCtx = ctx()
    const info = vi.spyOn(gatewayCtx.log, 'info')
    gatewayCtx.credential.device.discord_installation_id = 'fake-installation'
    const stream = commands.gatewayListen(gatewayCtx)[Symbol.asyncIterator]()
    const ready = await stream.next()
    expect(ready.value).toMatchObject({ event: 'READY', data: { analytics_token: '***' } })
    expect(info.mock.calls.map(([text]) => text)).toEqual(['正在连接 Discord，等待登录验证…', 'Discord 连接已就绪，正在接收实时消息。'])
    expect(JSON.stringify(ready.value)).not.toContain('fake-session')
    expect((await stream.next()).value).toMatchObject({ event: 'MESSAGE_CREATE', data: { id: M } })
    await stream.return?.()
    expect(sent.map((p) => p.op)).toEqual([1, 2, 6])
    expect(sent[1]?.d.properties).toMatchObject({ installation_id: 'fake-installation' })
    expect(sent[2]?.d).toEqual({ token: TOKEN, session_id: 'fake-session', seq: 7 })
    expect(close).toHaveBeenCalledOnce()
  })
})
