import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { plainText } from '../src/core/normalize.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/weibo/web/api.js'
import { check, riskCheck, Weibo } from '../src/platforms/weibo/web/client.js'
import * as cmd from '../src/platforms/weibo/web/commands.js'
import { resolveItem } from '../src/platforms/weibo/web/resolve.js'
import { bidToMid, fileParams, midToBid } from '../src/platforms/weibo/web/sign.js'
import { expectRequests, type GoldenCase, type GoldenRequest, loadCase, makeCtx, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

/** 与 scripts/golden/weibo/gen.py 相同的假凭证。 */
const COOKIES = 'SCF=fake-scf; SUB=_2A25fakeSUB0000; SUBP=0033fakeSUBP; ALF=02_1790259200; WBPSESS=fake-wbpsess==; XSRF-TOKEN=fakeXsrfToken0123'
const MID = '5073209014095008'
const MEDIA_ID = '5078000000000001'

function loggedCtx(init: Parameters<typeof makeCtx>[0] | object = {}) {
  return makeCtx({ platform: 'weibo', cookies: COOKIES, cookieDomain: '.weibo.com', ...init })
}

/** 单个方法的对拍：上游的 WeiboMobileApis 不带 cookie 访问 m.weibo.cn，所以跳过访客身份。 */
function logged<T>(fn: (w: Weibo) => Promise<T>): () => Promise<T> {
  return () => {
    const w = new Weibo(loggedCtx())
    w.ensure = async () => {}
    return fn(w)
  }
}

function bytes(v: { base64: string } | string): Uint8Array {
  return typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'utf8')) : new Uint8Array(Buffer.from(v.base64, 'base64'))
}

const dir = mkdtempSync(join(tmpdir(), 'catbus-weibo-'))
function tmpFile(name: string, data: Uint8Array): string {
  const path = join(dir, name)
  writeFileSync(path, data)
  return path
}

/** 用例名 → TS 侧的等价调用。 */
const CASES: Record<string, (c: GoldenCase) => Promise<unknown>> = {
  self_info: logged((w) => api.selfInfo(w)),
  user_info: logged((w) => api.userInfo(w, '1669879400')),
  user_posted_p1: logged((w) => api.userPosted(w, '1669879400', '1', '')),
  user_posted_p2: logged((w) => api.userPosted(w, '1669879400', '2', '4937540924966431kp2')),
  comments: logged((w) => api.comments(w, '5266778656', MID)),
  mobile_detail: logged((w) => api.mobileDetail(w, MID)),
  mobile_search: logged((w) => api.mobileSearch(w, '猫 咪&狗', 1)),
  mobile_search_p2: logged((w) => api.mobileSearch(w, '猫', 2)),
  video_init: (c) => logged((w) => api.videoInit(w, bytes(c.input.video)))(),
  upload_image: (c) => logged((w) => api.uploadImage(w, '10001', '测试昵称', bytes(c.input.image)))(),
  upload_video: (c) => logged((w) => api.uploadVideo(w, 'fake-upload-id', MEDIA_ID, bytes(c.input.video), 'fake-up-auth'))(),
  video_check: (c) => logged((w) => api.videoCheck(w, 'fake-upload-id', MEDIA_ID, c.input.size, 'fake-up-auth'))(),
  video_output: logged((w) => api.videoOutput(w, MEDIA_ID)),
}

describe('weibo 对拍：请求构造', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('weibo', name)
      const { requests, error } = await replay(c, () => run(c))
      if (error) throw error
      expectRequests(requests, c.requests)
    })
  }
})

// ---------------------------------------------------------------- m.weibo.cn 的访客身份（上游没有）

const VISITOR_SUB = '_2AkMfakeVisitorSUB'
const VISITOR_SUBP = '0033WrSXfakeVisitorSUBP'

/** genvisitor2 的响应：JSONP 正文 + Set-Cookie 下发访客 SUB / SUBP。 */
function visitorResponse(domain: string): GoldenCase['responses'][number] {
  return {
    status: 200,
    headers: {
      'content-type': 'text/html',
      'set-cookie': [
        `SUB=${VISITOR_SUB}; expires=Monday, 27-Sep-2027 16:42:59 GMT; path=/; domain=${domain}; secure; httponly; SameSite=None`,
        `SUBP=${VISITOR_SUBP}; expires=Monday, 27-Sep-2027 16:42:59 GMT; path=/; domain=${domain}`,
      ],
    },
    body: `window.visitor_gray_callback && visitor_gray_callback({"retcode":20000000,"msg":"succ","data":{"sub":"${VISITOR_SUB}","subp":"${VISITOR_SUBP}","next":"cross_domain","alt":"","tid":"faketid","new_tid":true}});`,
  }
}

/** 先生成访客身份，再照上游发请求：上游的请求序列前面插一个 genvisitor2，后面的请求带上访客 cookie。 */
function withVisitor(c: GoldenCase, domain: string): GoldenCase {
  return { ...c, responses: [visitorResponse(domain), ...c.responses] }
}

function expectVisitor(r: GoldenRequest, host: string, returnUrl: string) {
  expect(r.method).toBe('POST')
  expect(r.url).toBe(`https://${host}/visitor/genvisitor2`)
  expect(r.cookies).toEqual([])
  expect(r.body).toBe(`cb=visitor_gray_callback&ver=20250916&request_id=&tid=&from=weibo&webdriver=false&rid=1790000000123&return_url=${encodeURIComponent(returnUrl)}`)
  expect(Object.fromEntries(r.headers)).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded', origin: `https://${host}` })
}

const visitorCookies = (expected: GoldenRequest[]): GoldenRequest[] =>
  expected.map((r) => ({
    ...r,
    cookies: [
      ['SUB', VISITOR_SUB],
      ['SUBP', VISITOR_SUBP],
    ],
  }))

describe('weibo 对拍：命令流程', () => {
  it('item get：先生成 m.weibo.cn 访客身份（登录 cookie 不发往 .weibo.cn），再取详情页的 $render_data', async () => {
    const c = loadCase('weibo', 'mobile_detail')
    const ctx = loggedCtx({ args: { item: `https://m.weibo.cn/detail/${MID}` } })
    const { requests, result, error } = await replay(withVisitor(c, '.weibo.cn'), () => cmd.itemGet(ctx))
    if (error) throw error
    expectVisitor(requests[0]!, 'visitor.passport.weibo.cn', 'https://m.weibo.cn/')
    expectRequests(requests.slice(1), visitorCookies(c.requests))
    expect((result as any)[RAW]).toEqual(c.result[2].status)
    expect(result).toMatchObject({
      id: MID,
      kind: 'image',
      url: 'https://weibo.com/5266778656/OuIv3hbiw',
      title: null,
      text: '好艰难呐~\n第二行 [老师好] & 结束',
      author: { id: '5266778656', name: '雪菜', url: 'https://weibo.com/u/5266778656' },
      media: [{ id: 'fakepid0', type: 'image', url: 'https://wx4.sinaimg.cn/mw2000/fakepid0.jpg', width: 1079, height: 442 }],
      stats: { likes: 8, comments: 10, shares: 1 },
      status: null,
    })
    expect((result as any).created_at).toMatch(/^2024-08-3\dT/)
    // 访客 cookie 留在账号凭证里，下次直接复用；登录 cookie 不受影响
    const cookies = ctx.credential.scopes.main!.cookies
    expect(cookies.filter((x) => x.domain === '.weibo.cn').map((x) => [x.name, x.value])).toEqual([
      ['SUB', VISITOR_SUB],
      ['SUBP', VISITOR_SUBP],
    ])
    expect(cookies.find((x) => x.name === 'SUB' && x.domain === '.weibo.com')?.value).toBe('_2A25fakeSUB0000')
  })

  it('item search：综合搜索，合并顶层与 card_group 里的微博；只取第一页', async () => {
    const c = loadCase('weibo', 'mobile_search')
    const ctx = loggedCtx({ args: { keyword: '猫 咪&狗' } })
    const { requests, result, error } = await replay(withVisitor(c, '.weibo.cn'), () => cmd.itemSearch(ctx))
    if (error) throw error
    expectVisitor(requests[0]!, 'visitor.passport.weibo.cn', 'https://m.weibo.cn/')
    expectRequests(requests.slice(1), visitorCookies(c.requests))
    const r = result as { data: any[]; page: unknown }
    expect(r.data.map((x) => x.id)).toEqual([MID, '5073209014095009'])
    // 响应里的 cardlistInfo.page 是 2，但访客翻不到第二页：不给游标
    expect(r.page).toEqual({ cursor: null, has_more: false })
  })

  it('登录 user get：weibo.com 用登录 cookie，不生成访客身份', async () => {
    const c = loadCase('weibo', 'user_info')
    const ctx = loggedCtx({ args: { user: 'https://weibo.com/u/1669879400' } })
    const { requests, result, error } = await replay(c, () => cmd.userGet(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({
      id: '1669879400',
      name: 'Dear-迪丽热巴',
      url: 'https://weibo.com/u/1669879400',
      bio: '简介',
      stats: { followers: 82549113, following: 294, items: 1931, likes: 3226113282 },
    })
  })

  it('登录 user items：两页，cursor 带上 page 与 since_id', async () => {
    const p1 = loadCase('weibo', 'user_posted_p1')
    const ctx = loggedCtx({ args: { user: '1669879400' } })
    const first = await replay(p1, () => cmd.userItems(ctx))
    if (first.error) throw first.error
    expectRequests(first.requests, p1.requests)
    const r1 = first.result as { data: any[]; page: { cursor: string } }
    expect(r1.page).toEqual({ cursor: '2:4937540924966431kp2', has_more: true })
    expect(r1.data[0]).toMatchObject({ id: '5079000000000001', kind: 'image', url: 'https://weibo.com/10001/OwfakeBid', text: '测试 & 正文 #雀魂#', status: null })

    const p2 = loadCase('weibo', 'user_posted_p2')
    const second = await replay(p2, () => cmd.userItems({ ...ctx, cursor: r1.page.cursor }))
    if (second.error) throw second.error
    expectRequests(second.requests, p2.requests)
  })

  it('登录 comment list：链接里带作者 uid，不用再查详情；翻页带 max_id', async () => {
    const c = loadCase('weibo', 'comments')
    const ctx = loggedCtx({ args: { item: 'https://weibo.com/5266778656/OuIv3hbiw' } })
    const { requests, result, error } = await replay(c, () => cmd.commentList(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    const r = result as { data: any[]; page: { cursor: string } }
    expect(r.page).toEqual({ cursor: '138482687134666', has_more: true })
    expect(r.data[0]).toMatchObject({
      id: '5073215159009296',
      item_id: MID,
      parent_id: null,
      author: { id: '5658282146', name: '米仔' },
      text: '都会好哒[比耶]',
      stats: { likes: 3, replies: 4 },
    })

    // 第二页：上游只取第一页，这里在 count 之前插入 max_id（与网页一致），其余不变
    const next = await replay(c, () => cmd.commentList({ ...ctx, cursor: r.page.cursor }))
    if (next.error) throw next.error
    expect(next.requests[0]!.url).toBe(c.requests[0]!.url.replace('&count=', '&max_id=138482687134666&count='))
  })

  it('登录 auth status：首页 $CONFIG，过期时间取 ALF', async () => {
    const c = loadCase('weibo', 'self_info')
    const ctx = loggedCtx()
    const { requests, result, error } = await replay(c, () => cmd.authStatus(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ logged_in: true, user: { id: '10001', name: '测试昵称', url: 'https://weibo.com/u/10001' }, method: 'cookie' })
    expect(new Date((result as any).expires_at).getTime()).toBe(1790259200_000)
  })

  it('item publish 图文：get_self_info → 逐张上传 → statuses/update（上游 post_weibo）', async () => {
    const c = loadCase('weibo', 'post_image')
    const images = (c.input.images as { base64: string }[]).map((b, i) => tmpFile(`img${i + 1}.jpg`, bytes(b)))
    const ctx = loggedCtx({ options: { text: c.input.text, poiName: c.input.poi, visibility: c.input.visibility, topic: c.input.topic, image: images } })
    const { requests, result, error } = await replay(c, () => cmd.itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any)[RAW]).toEqual(c.result.data)
    expect(result).toMatchObject({ id: '5079000000000001', kind: 'image', status: 'private', author: { id: '10001', name: '测试昵称' } })
  })

  it('item publish 视频：init → 上传 → check → 轮询转码 → statuses/update（上游 post_weibo）', async () => {
    const c = loadCase('weibo', 'post_video')
    const video = tmpFile('video.mp4', bytes(c.input.video))
    const ctx = loggedCtx({ options: { text: c.input.text, visibility: c.input.visibility, topic: c.input.topic, video } })
    const { requests, error } = await replay(c, () => cmd.itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
  })

  for (const [name, visible] of [
    ['post_text_friends', '6'],
    ['post_text_fans', '10'],
  ] as const) {
    it(`item publish 纯文字 --visibility：${name} 的 visible=${visible}`, async () => {
      const c = loadCase('weibo', name)
      const ctx = loggedCtx({ options: { text: c.input.text, visibility: c.input.visibility } })
      const { requests, error } = await replay(c, () => cmd.itemPublish(ctx))
      if (error) throw error
      expectRequests(requests, c.requests)
      expect(requests[1]!.body).toContain(`&visible=${visible}&`)
    })
  }
})

describe('weibo media upload', () => {
  it('图片：get_self_info 取 uid / 昵称 → 上传，返回 pid 与尺寸', async () => {
    const c = loadCase('weibo', 'media_upload_image')
    const file = tmpFile('upload.jpg', bytes(c.input.image))
    const { requests, result, error } = await replay(c, () => cmd.mediaUpload(loggedCtx({ args: { file } })))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ id: 'fakepid1', type: 'image', url: 'https://wx1.sinaimg.cn/large/fakepid1.jpg', width: 100, height: 80, duration: null })
  })

  it('视频：init → 上传 → check，不等转码；还没发布的视频没有播放地址，url 为空串', async () => {
    const c = loadCase('weibo', 'media_upload_video')
    const file = tmpFile('upload.mp4', bytes(c.input.video))
    const { requests, result, error } = await replay(c, () => cmd.mediaUpload(loggedCtx({ args: { file } })))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ id: MEDIA_ID, type: 'video', url: null, width: null, height: null, duration: null })
  })

  it('上传接口返回 error 时报 UPSTREAM；视频要求实名认证时给出说明', async () => {
    const c = loadCase('weibo', 'media_upload_video')
    const file = tmpFile('upload2.mp4', bytes(c.input.video))
    const denied = { ...c, responses: [{ status: 200, headers: {}, body: { error: 'user need identity authentication', error_code: 21301 } }] }
    const { error } = await replay(denied, () => cmd.mediaUpload(loggedCtx({ args: { file } })))
    expect(error).toMatchObject({ code: 'UPSTREAM', message: '上传视频需要先在微博完成实名认证', detail: { error_code: 21301 } })
  })
})

describe('weibo 行为', () => {
  it('登录墙：weibo.com → AUTH_EXPIRED（重新登录），m.weibo.cn → AUTH_REQUIRED（登录也解决不了）', () => {
    const wall = { ok: -100, url: 'https://weibo.com/login.php' }
    expect(() => check(loggedCtx(), wall)).toThrow(expect.objectContaining({ code: 'AUTH_EXPIRED', hint: 'catbus weibo auth login -a default' }))
    expect(() => check(loggedCtx(), wall, 'cn')).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }))
    expect(() => check(loggedCtx(), { ok: 0, message: '前方有点拥堵，请登录后使用' })).toThrow(expect.objectContaining({ code: 'AUTH_EXPIRED' }))
    expect(() => check(loggedCtx(), { ok: 1 })).not.toThrow()
    expect(() => check(loggedCtx(), {})).not.toThrow()
  })

  it('业务错误：拥堵 / 频繁 / 稍后 → RISK_CONTROL（rate_limit），其余 → UPSTREAM，带 ok / errno', () => {
    for (const message of ['前方拥堵', '操作过于频繁', '请稍后再试']) {
      expect(() => check(loggedCtx(), { ok: 0, msg: message })).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: { kind: 'rate_limit', ok: 0, message } }))
    }
    expect(() => check(loggedCtx(), { ok: 0, msg: '内容违规', errno: 20019 })).toThrow(
      expect.objectContaining({ code: 'UPSTREAM', message: '内容违规', detail: { ok: 0, errno: 20019, message: '内容违规' } }),
    )
    expect(() => check(loggedCtx(), { ok: -1 })).toThrow(expect.objectContaining({ code: 'UPSTREAM', message: '微博返回错误 ok=-1' }))
  })

  it('没有正文的拦截状态码：432 / 418 → RISK_CONTROL blocked，429 → rate_limit；接口返回的不是 JSON 时先看状态码', async () => {
    expect(() => riskCheck(432)).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: { kind: 'blocked', status: 432 } }))
    expect(() => riskCheck(418)).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: { kind: 'blocked', status: 418 } }))
    expect(() => riskCheck(429)).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: { kind: 'rate_limit', status: 429 } }))
    expect(() => riskCheck(200)).not.toThrow()
    const c = loadCase('weibo', 'user_info')
    for (const [status, code] of [
      [432, 'RISK_CONTROL'],
      [502, 'UPSTREAM'],
    ] as const) {
      const blocked = { ...c, responses: [{ status, headers: {}, body: '<html>blocked</html>' }] }
      const { error } = await replay(blocked, () => cmd.userGet(loggedCtx({ args: { user: '1669879400' } })))
      expect(error).toMatchObject({ code })
    }
  })

  it('m.weibo.cn：缓存的访客 cookie 遇到登录墙时重新生成一次访客身份再试；新生成的也被拒就报 AUTH_REQUIRED，不再重试', async () => {
    const c = loadCase('weibo', 'mobile_search')
    const wall = { status: 200, headers: {}, body: { ok: -100, url: 'https://passport.weibo.com/sso/signin' } }
    const ctx = loggedCtx({ args: { keyword: '猫 咪&狗' } })
    ctx.credential.scopes.main!.cookies.push({ name: 'SUB', value: 'stale', domain: '.weibo.cn', path: '/', expires: null })
    const renewed = await replay({ ...c, responses: [wall, visitorResponse('.weibo.cn'), ...c.responses] }, () => cmd.itemSearch(ctx))
    if (renewed.error) throw renewed.error
    expect(renewed.requests.map((r) => r.url.split('?')[0])).toEqual([
      'https://m.weibo.cn/api/container/getIndex',
      'https://visitor.passport.weibo.cn/visitor/genvisitor2',
      'https://m.weibo.cn/api/container/getIndex',
    ])
    expect(renewed.requests[0]!.cookies).toEqual([['SUB', 'stale']])
    expect(renewed.requests[2]!.cookies).toEqual([
      ['SUB', VISITOR_SUB],
      ['SUBP', VISITOR_SUBP],
    ])
    expect((renewed.result as any).data).toHaveLength(2)

    const fresh = await replay({ ...c, responses: [visitorResponse('.weibo.cn'), wall] }, () => cmd.itemSearch(loggedCtx({ args: { keyword: '猫' } })))
    expect(fresh.requests).toHaveLength(2)
    expect(fresh.error).toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('genvisitor2 失败（retcode 不对、没有下发 SUB、被拦截）→ RISK_CONTROL', async () => {
    const c = loadCase('weibo', 'mobile_detail')
    const ok = visitorResponse('.weibo.cn')
    for (const [response, detail] of [
      [{ ...ok, body: 'visitor_gray_callback({"retcode":50000000,"msg":"fail"});' }, { kind: 'blocked', status: 200, retcode: 50000000 }],
      [{ ...ok, headers: {} }, { kind: 'blocked', status: 200, retcode: 20000000 }],
      [{ status: 432, headers: {}, body: '' }, { kind: 'blocked', status: 432 }],
    ] as const) {
      const { requests, error } = await replay({ ...c, responses: [response] }, () => cmd.itemGet(loggedCtx({ args: { item: MID } })))
      expect(requests).toHaveLength(1)
      expect(error).toMatchObject({ code: 'RISK_CONTROL', detail })
    }
  })

  it('auth status：没有账号时凭证是空的，不发请求，logged_in 为 false', async () => {
    const restore = mockSender(() => {
      throw new Error('不应请求')
    })
    try {
      expect(await cmd.authStatus(makeCtx({ platform: 'weibo', account: 'guest' }))).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
    } finally {
      restore()
    }
  })

  it('auth status：cookie 失效（首页没有 $CONFIG.user）时 logged_in 为 false', async () => {
    const restore = mockSender(() => fakeResponse('<html><script>window.$CONFIG = {};</script></html>', { headers: [['content-type', 'text/html']] }))
    try {
      expect(await cmd.authStatus(loggedCtx())).toMatchObject({ logged_in: false, user: null })
    } finally {
      restore()
    }
  })

})

describe('item publish 不支持的标准选项（AGENTS 4.9）', () => {
  useTempHome()

  it('注册表没声明支持的选项报 UNSUPPORTED，hint 列出可用的选项；帮助里不出现', async () => {
    for (const flag of ['--title', '--poi']) {
      const r = await cli('weibo', 'item', 'publish', '--text', 'x', flag, 'v')
      expect(r.env.error, flag).toMatchObject({ code: 'UNSUPPORTED', message: `weibo 的 item publish 不支持 ${flag}` })
      expect(r.env.error.hint).toContain('--poi-name')
      expect(r.code).toBe(2)
    }
    const help = (await cli('weibo', 'item', 'publish', '--help')).stdout
    expect(help).not.toContain('--title')
    expect(help).toContain('--poi-name')
  })

  it('闲鱼的商品发布即上架：--visibility private 报 UNSUPPORTED，不会公开上架', async () => {
    const r = await cli('xianyu', 'item', 'publish', '--text', 'x', '--price', '1', '--visibility', 'private')
    expect(r.env.error).toMatchObject({ code: 'UNSUPPORTED', hint: '可选：public' })
  })
})

describe('--visibility fans（AGENTS 4.9）', () => {
  useTempHome()

  it('微博接受 fans：通过取值校验，进入登录检查', async () => {
    const r = await cli('weibo', 'item', 'publish', '--text', 'x', '--visibility', 'fans')
    expect(r.env.error.code).toBe('AUTH_REQUIRED')
    expect((await cli('weibo', 'item', 'publish', '--help')).stdout).toContain('public|private|friends|fans')
  })

  it('没有声明 fans 的平台报 UNSUPPORTED，不是标准值报 USAGE', async () => {
    const supported: Record<string, string> = {
      xhs: 'public、private',
      douyin: 'public、private、friends',
      tiktok: 'public、private、friends',
      bilibili: 'public、private',
      kuaishou: 'public、private、friends',
      xianyu: 'public',
      x: 'public',
    }
    for (const [p, values] of Object.entries(supported)) {
      const r = await cli(p, 'item', 'publish', '--text', 'x', '--visibility', 'fans')
      expect(r.env.error, p).toMatchObject({ code: 'UNSUPPORTED', hint: `可选：${values}` })
      expect(r.code).toBe(2)
    }
    expect((await cli('weibo', 'item', 'publish', '--text', 'x', '--visibility', 'nope')).env.error.code).toBe('USAGE')
  })
})

describe('weibo 纯算', () => {
  it('mid ↔ mblogid', () => {
    expect(midToBid('5073209014095008')).toBe('OuIv3hbiw')
    expect(bidToMid('OuIv3hbiw')).toBe('5073209014095008')
    expect(midToBid('5347399807533369')).toBe('RjT5ivBLX')
    expect(bidToMid('RjT5ivBLX')).toBe('5347399807533369')
  })

  it('参数归一化：mid、mblogid、各种链接', () => {
    expect(resolveItem(MID)).toEqual({ mid: MID, uid: null })
    expect(resolveItem('OuIv3hbiw')).toEqual({ mid: MID, uid: null })
    expect(resolveItem('https://weibo.com/5266778656/OuIv3hbiw?refer=x')).toEqual({ mid: MID, uid: '5266778656' })
    expect(resolveItem(`https://m.weibo.cn/detail/${MID}`)).toEqual({ mid: MID, uid: null })
    expect(resolveItem('https://m.weibo.cn/status/OuIv3hbiw')).toEqual({ mid: MID, uid: null })
    expect(resolveItem(`https://weibo.com/detail/${MID}`)).toEqual({ mid: MID, uid: null })
    expect(() => resolveItem('https://weibo.com/u/5266778656')).toThrow(expect.objectContaining({ code: 'USAGE' }))
  })

  it('CRC32 / MD5 与上游的查表实现一致', () => {
    const c = loadCase('weibo', 'upload_image')
    const p = fileParams(bytes(c.input.image))
    expect(c.requests[0]!.url).toContain(`cs=${p.cs}&`)
    expect(c.requests[0]!.url).toContain(`raw_md5=${p.md5}&`)
  })

  it('正文 HTML → 纯文本', () => {
    expect(plainText('a<br />b <a href="x"><span class="surl-text">#话题#</span></a><img alt="[笑]" src="y"/> &lt;&amp;&gt;')).toBe('a\nb #话题#[笑] <&>')
  })
})
