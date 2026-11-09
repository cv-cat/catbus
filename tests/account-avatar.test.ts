import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listAccounts, newCredential, readCredential, syncStatusUser, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import * as n from '../src/core/normalize.js'
import * as douyin from '../src/platforms/douyin/web/normalize.js'
import { authStatus as jdStatus } from '../src/platforms/jd/web/commands.js'
import { currentUser as maoyanUser } from '../src/platforms/maoyan/web/api.js'
import type { MaoyanClient } from '../src/platforms/maoyan/web/client.js'
import * as mteam from '../src/platforms/mteam/web/normalize.js'
import * as x from '../src/platforms/x/web/normalize.js'
import * as xhs from '../src/platforms/xhs/web/normalize.js'
import { makeCtx } from './golden.js'
import { cli, useTempHome } from './helpers.js'

/** 账号头像（AGENTS 6.2 AccountUser、5.3「头像」）：全部是假数据。 */

const X_COOKIES = 'auth_token=fakeauthtoken000000000000000000000000000000; ct0=fakect0000000000000000000000000000000000000000; twid=u%3D10001; lang=en'

function viewer(name: string, avatar: string) {
  return {
    data: {
      viewer: {
        user_results: {
          result: { __typename: 'User', rest_id: '10001', core: { name, screen_name: 'catbus_test' }, avatar: { image_url: avatar }, legacy: {} },
        },
      },
    },
  }
}

describe('core：AccountUser', () => {
  const home = useTempHome()

  it('n.avatar：// 与 http:// 统一成 https，不是绝对地址时为 null', () => {
    expect(n.avatar('//i0.hdslb.com/face.jpg')).toBe('https://i0.hdslb.com/face.jpg')
    expect(n.avatar('http://tva1.sinaimg.cn/a.jpg')).toBe('https://tva1.sinaimg.cn/a.jpg')
    expect(n.avatar(' https://a.example/x.png ')).toBe('https://a.example/x.png')
    expect(n.avatar('/static/default.png')).toBeNull()
    expect(n.avatar('')).toBeNull()
    expect(n.avatar(null)).toBeNull()
    expect(n.avatar({ url: 'https://a' })).toBeNull()
  })

  it('n.accountUser：补齐 avatar，第二个参数优先于 ref 里的 avatar', () => {
    expect(n.accountUser({ id: '1', name: 'a', url: null })).toEqual({ id: '1', name: 'a', url: null, avatar: null })
    expect(n.accountUser({ id: '1', name: 'a', url: null }, '//cdn/x.jpg')).toEqual({ id: '1', name: 'a', url: null, avatar: 'https://cdn/x.jpg' })
    expect(n.accountUser(null, 'https://cdn/x.jpg')).toBeNull()
  })

  it('旧凭证文件的 user 没有 avatar：读成 null，auth list / use 照常输出', async () => {
    const c = newCredential({ platform: 'x', endpoint: 'web', account: 'old', method: 'cookie' })
    await writeCredential(c)
    const file = join(home.dir, 'auth', 'x', 'web', 'old.json')
    const legacy = JSON.parse(readFileSync(file, 'utf8'))
    legacy.user = { id: '10001', name: '老账号', url: 'https://x.com/old' }
    writeFileSync(file, JSON.stringify(legacy))

    expect((await readCredential('x', 'web', 'old'))!.user).toEqual({ id: '10001', name: '老账号', url: 'https://x.com/old', avatar: null })
    expect((await listAccounts('x', 'web'))[0]!.user).toEqual({ id: '10001', name: '老账号', url: 'https://x.com/old', avatar: null })
    const list = await cli('x', 'auth', 'list')
    expect(list.env.data[0].user).toEqual({ id: '10001', name: '老账号', url: 'https://x.com/old', avatar: null })
    const use = await cli('x', 'auth', 'use', 'old')
    expect(use.env.data.user.avatar).toBeNull()
    // 只读不写：文件里仍然没有 avatar（不需要迁移）
    expect('avatar' in JSON.parse(readFileSync(file, 'utf8')).user).toBe(false)
  })

  it('syncStatusUser：同一用户才合并，平台没给的字段保留原值；游客与其他用户不动凭证', () => {
    const c = newCredential({ platform: 'x', endpoint: 'web', account: 'a', method: 'cookie', user: { id: '1', name: '旧名', url: 'https://u/1', avatar: 'https://old.png' } })
    const status = syncStatusUser(c, { logged_in: true, user: { id: '1', name: '新名', url: null } as any, method: 'cookie', expires_at: null })
    expect(status.user).toEqual({ id: '1', name: '新名', url: null, avatar: null })
    expect(c.user).toEqual({ id: '1', name: '新名', url: 'https://u/1', avatar: 'https://old.png' })

    syncStatusUser(c, { logged_in: true, user: { id: '1', name: '新名', url: null, avatar: '//new.png' }, method: 'cookie', expires_at: null })
    expect(c.user!.avatar).toBe('https://new.png')

    syncStatusUser(c, { logged_in: true, user: { id: '2', name: '别人', url: null, avatar: 'https://other.png' }, method: 'cookie', expires_at: null })
    expect(c.user).toEqual({ id: '1', name: '新名', url: 'https://u/1', avatar: 'https://new.png' })

    const g = newCredential({ platform: 'x', endpoint: 'web', account: 'guest', method: 'guest', user: { id: '1', name: 'g', url: null, avatar: null } })
    syncStatusUser(g, { logged_in: true, user: { id: '1', name: 'x', url: null, avatar: 'https://g.png' }, method: 'guest', expires_at: null })
    expect(g.user!.avatar).toBeNull()
  })

  it('auth login 存头像；auth status 拿到新昵称 / 头像时回写凭证；auth list / logout 带头像', async () => {
    let res = viewer('测试账号', 'http://pbs.twimg.com/profile_images/1/a_normal.jpg')
    const restore = mockSender(() => fakeResponse(res))
    try {
      const login = await cli('x', 'auth', 'login', '--cookie', X_COOKIES)
      expect(login.env.data.user).toEqual({ id: '10001', name: '测试账号', url: 'https://x.com/catbus_test', avatar: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' })
      const file = join(home.dir, 'auth', 'x', 'web', 'default.json')
      expect(JSON.parse(readFileSync(file, 'utf8')).user.avatar).toBe('https://pbs.twimg.com/profile_images/1/a_normal.jpg')

      res = viewer('改过的名字', 'https://pbs.twimg.com/profile_images/2/b_normal.jpg')
      const status = await cli('x', 'auth', 'status')
      expect(status.env.data).toMatchObject({ logged_in: true, user: { id: '10001', name: '改过的名字', avatar: 'https://pbs.twimg.com/profile_images/2/b_normal.jpg' } })
      expect(JSON.parse(readFileSync(file, 'utf8')).user).toEqual({
        id: '10001',
        name: '改过的名字',
        url: 'https://x.com/catbus_test',
        avatar: 'https://pbs.twimg.com/profile_images/2/b_normal.jpg',
      })
      expect((await cli('x', 'auth', 'list')).env.data[0].user.avatar).toBe('https://pbs.twimg.com/profile_images/2/b_normal.jpg')
      expect((await cli('x', 'auth', 'logout', '-y')).env.data.user.avatar).toBe('https://pbs.twimg.com/profile_images/2/b_normal.jpg')
    } finally {
      restore()
    }
  })

  it('重新登录同一用户、这次没拿到头像时沿用之前存的', async () => {
    let res: any = viewer('测试账号', 'https://pbs.twimg.com/a.jpg')
    const restore = mockSender(() => fakeResponse(res))
    try {
      await cli('x', 'auth', 'login', '--cookie', X_COOKIES)
      res = viewer('测试账号', '')
      const again = await cli('x', 'auth', 'login', '--cookie', X_COOKIES)
      expect(again.env.data.user.avatar).toBe('https://pbs.twimg.com/a.jpg')
    } finally {
      restore()
    }
  })
})

describe('平台：当前账号的头像字段', () => {
  it('xhs user/me：images（大图）优先，没有时 imageb', () => {
    expect(xhs.account({ user_id: 'u1', nickname: '小红', images: 'http://sns-avatar-qc.xhscdn.com/avatar/1.jpg', imageb: 'https://b.jpg' })).toEqual({
      id: 'u1',
      name: '小红',
      url: 'https://www.xiaohongshu.com/user/profile/u1',
      avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/1.jpg',
    })
    expect(xhs.account({ user_id: 'u1', nickname: '小红', imageb: 'https://b.jpg' })!.avatar).toBe('https://b.jpg')
    expect(xhs.account({ user_id: 'u1', nickname: '小红' })!.avatar).toBeNull()
  })

  it('douyin 创作者中心 user/info：avatar_larger > avatar_medium > avatar_thumb，也兼容 avatar_url', () => {
    const u = { nickname: '抖音号', avatar_thumb: { url_list: ['https://t.jpg'] }, avatar_larger: { url_list: ['https://l.jpg'] } }
    expect(douyin.account('MS4w', u)).toEqual({ id: 'MS4w', name: '抖音号', url: 'https://www.douyin.com/user/MS4w', avatar: 'https://l.jpg' })
    expect(douyin.account('MS4w', { avatar_url: '//a.jpg' }, '旧名')).toMatchObject({ name: '旧名', avatar: 'https://a.jpg' })
    expect(douyin.account('MS4w', null, '旧名')).toMatchObject({ name: '旧名', avatar: null })
  })

  it('x Viewer：新版 avatar.image_url，老版 legacy.profile_image_url_https', () => {
    expect(x.account({ rest_id: '1', core: { name: 'n', screen_name: 's' }, avatar: { image_url: 'https://new.jpg' } })!.avatar).toBe('https://new.jpg')
    expect(x.account({ rest_id: '1', legacy: { name: 'n', screen_name: 's', profile_image_url_https: 'https://old.jpg' } })!.avatar).toBe('https://old.jpg')
  })

  it('mteam member/profile：avatarUrl', () => {
    expect(mteam.account({ id: 7, username: 'tester', avatarUrl: 'https://img.m-team.cc/a.png' })).toEqual({
      id: '7',
      name: 'tester',
      url: 'https://kp.m-team.cc/profile/7',
      avatar: 'https://img.m-team.cc/a.png',
    })
    expect(mteam.account({ id: 7, username: 'tester' }).avatar).toBeNull()
  })

  it('maoyan getUserInfoByToken：有头像字段时取出，没有时为 null', async () => {
    const client = (u: object) => ({ userInfo: async () => u }) as unknown as MaoyanClient
    expect(await maoyanUser(client({ userId: 1, nickName: '猫', avatarUrl: 'http://p0.meituan.net/a.jpg' }), 't')).toEqual({ id: '1', name: '猫', url: null, avatar: 'https://p0.meituan.net/a.jpg' })
    expect((await maoyanUser(client({ userId: 1, nickName: '猫' }), 't')).avatar).toBeNull()
  })

  it('jd loginservice 只给昵称：auth status 的 avatar 为 null，不为头像额外请求', async () => {
    const urls: string[] = []
    const restore = mockSender((p) => (urls.push(p.url), fakeResponse('jsonpLogin({"Identity":{"Unick":"测试","Name":"测试","IsAuthenticated":true}})')))
    try {
      const ctx = makeCtx({ platform: 'jd', cookies: 'thor=fake; pin=jd_fake', cookieDomain: '.jd.com' })
      expect(await jdStatus(ctx)).toMatchObject({ logged_in: true, user: { id: 'jd_fake', name: '测试', avatar: null } })
      expect(urls.map((u) => new URL(u).pathname)).toEqual(['/loginservice.aspx'])
    } finally {
      restore()
    }
  })
})
