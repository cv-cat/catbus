import { describe, expect, it } from 'vitest'
import { fakeResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { cli, useTempHome } from './helpers.js'

const COOKIES = '_zap=fake-zap; d_c0=fake-d-c0; z_c0=fake-z-c0'
const ME = {
  id: 'fake-user-id',
  url_token: 'fake-user',
  name: '示例用户',
  avatar_url: 'https://example.invalid/avatar.png',
  headline: '示例简介',
  creation_count: 7,
  voteup_count: 11,
}

function mockZhihu() {
  const calls: PreparedRequest[] = []
  const restore = mockSender((request) => {
    calls.push(request)
    if (request.url !== 'https://www.zhihu.com/api/v4/me') throw new Error(`未录制的请求：${request.url}`)
    return fakeResponse(JSON.stringify(ME), { headers: [['content-type', 'application/json']] })
  })
  return { calls, restore }
}

describe('知乎平台（web）', () => {
  useTempHome()

  it('cookie 登录会在线校验当前账号并保存统一的 UserRef', async () => {
    const { calls, restore } = mockZhihu()
    try {
      const result = await cli('zhihu', 'auth', 'login', '--method', 'cookie', '--cookie', COOKIES)
      expect(result.code).toBe(0)
      expect(result.env).toMatchObject({
        ok: true,
        platform: 'zhihu',
        resource: 'auth',
        action: 'login',
        account: 'default',
        data: {
          platform: 'zhihu',
          endpoint: 'web',
          account: 'default',
          user: { id: 'fake-user-id', name: '示例用户', url: 'https://www.zhihu.com/people/fake-user' },
          method: 'cookie',
        },
      })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.method).toBe('GET')
      expect(calls[0]?.url).toBe('https://www.zhihu.com/api/v4/me')
      expect(calls[0]?.headers).toEqual([
        ['accept', 'application/json, text/plain, */*'],
        ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8'],
        ['referer', 'https://www.zhihu.com/'],
        ['sec-ch-ua', '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"'],
        ['sec-ch-ua-mobile', '?0'],
        ['sec-ch-ua-platform', '"Windows"'],
        ['sec-fetch-dest', 'empty'],
        ['sec-fetch-mode', 'cors'],
        ['sec-fetch-site', 'same-origin'],
        ['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'],
      ])
      expect(calls[0]?.cookies).toEqual([
        ['_zap', 'fake-zap'],
        ['d_c0', 'fake-d-c0'],
        ['z_c0', 'fake-z-c0'],
      ])
    } finally {
      restore()
    }
  })

  it('缺少 d_c0 或 z_c0 时在联网前拒绝导入', async () => {
    for (const cookie of ['d_c0=fake-d-c0', 'z_c0=fake-z-c0']) {
      const result = await cli('zhihu', 'auth', 'login', '--cookie', cookie)
      expect([result.env.error?.code, result.code]).toEqual(['USAGE', 2])
      expect(result.env.error?.message).toContain('d_c0 和 z_c0')
    }
  })

  it('无效 cookie 返回 AUTH_REQUIRED，不保存账号', async () => {
    const restore = mockSender(() => fakeResponse('{"error":{"code":100}}', { status: 401, headers: [['content-type', 'application/json']] }))
    try {
      const result = await cli('zhihu', 'auth', 'login', '--cookie', COOKIES)
      expect([result.env.error?.code, result.code]).toEqual(['AUTH_REQUIRED', 3])
      expect((await cli('zhihu', 'auth', 'list')).env.data).toEqual([])
    } finally {
      restore()
    }
  })

  it('auth status 会重新在线校验已经保存的 cookie', async () => {
    const { calls, restore } = mockZhihu()
    try {
      expect((await cli('zhihu', 'auth', 'login', '--cookie', COOKIES)).code).toBe(0)
      const result = await cli('zhihu', 'auth', 'status')
      expect(result.code).toBe(0)
      expect(result.env.data).toEqual({
        logged_in: true,
        user: { id: 'fake-user-id', name: '示例用户', url: 'https://www.zhihu.com/people/fake-user' },
        method: 'cookie',
        expires_at: null,
      })
      expect(calls).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it('未登录时 auth status 不联网并返回 logged_in false', async () => {
    const calls: PreparedRequest[] = []
    const restore = mockSender((request) => {
      calls.push(request)
      throw new Error('不应联网')
    })
    try {
      const result = await cli('zhihu', 'auth', 'status')
      expect(result.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
      expect(calls).toEqual([])
    } finally {
      restore()
    }
  })

  it('user get me 返回统一 User，且不泄露登录响应里的其他账号字段', async () => {
    const { calls, restore } = mockZhihu()
    try {
      expect((await cli('zhihu', 'auth', 'login', '--cookie', COOKIES)).code).toBe(0)
      const result = await cli('zhihu', 'user', 'get', 'me')
      expect(result.code).toBe(0)
      expect(result.env.data).toEqual({
        id: 'fake-user-id',
        name: '示例用户',
        handle: 'fake-user',
        avatar: 'https://example.invalid/avatar.png',
        url: 'https://www.zhihu.com/people/fake-user',
        bio: '示例简介',
        stats: { followers: null, following: null, items: 7, likes: 11 },
      })
      expect(calls).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it('user get 只接受 me', async () => {
    const { restore } = mockZhihu()
    try {
      expect((await cli('zhihu', 'auth', 'login', '--cookie', COOKIES)).code).toBe(0)
      const result = await cli('zhihu', 'user', 'get', 'someone')
      expect([result.env.error?.code, result.code]).toEqual(['UNSUPPORTED', 2])
    } finally {
      restore()
    }
  })
})
