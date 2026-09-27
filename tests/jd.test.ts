import { readFileSync } from 'node:fs'
import { models } from '@cv-cat/catbus-assets-jd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/jd/web/api.js'
import { ChatClient } from '../src/platforms/jd/web/chat.js'
import { Jd, simpleCookie } from '../src/platforms/jd/web/client.js'
import { imdecode, img, loadCv } from '../src/platforms/jd/web/jcap/image.js'
import { detectLines, fastAtan2 } from '../src/platforms/jd/web/jcap/lsd.js'
import * as solver from '../src/platforms/jd/web/jcap/solver.js'
import { setSummerSource, summerEncrypt } from '../src/platforms/jd/web/js.js'
import * as login from '../src/platforms/jd/web/login.js'
import * as norm from '../src/platforms/jd/web/normalize.js'
import { TraceContext } from '../src/platforms/jd/web/util.js'
import { expectRequests, type GoldenCase, type GoldenRequest, loadCase, makeCtx, replay } from './golden.js'

// 搜索 605 的对拍里 JCAP 求解换成固定票据（上游对拍同样替换了 solve_graphic_captcha）
vi.mock('../src/platforms/jd/web/jcap.js', () => ({ solveCaptcha: async () => 'FAKEJCAPVERIFYTOKEN0123456789ABCDEF' }))

const COOKIES =
  '__jdu=17899999991231234567890; ' +
  '__jda=122270672.17899999991231234567890.1789999999.1789999999.1789999999.1; __jdc=122270672; ' +
  'areaId=1; ipLoc-djd=1-2800-55812-0.1234567890; ' +
  '3AB9D23F7A4B3C9B=FAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEI; ' +
  '3AB9D23F7A4B3CSS=jdd03FAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIAAAAAFAKEFAKEFAKEAAAAAAFAKEFAKEFAKEFAKX; ' +
  'thor=FAKETHOR0123456789ABCDEF; pin=fake_pin_%E6%B5%8B%E8%AF%95; unick=fake; ' +
  'shshshfpa=0f0e0d0c-0b0a-0908-0706-050403020100-1789999999; shshshfpx=0f0e0d0c-0b0a-0908-0706-050403020100-1789999999; ' +
  'shshshfpb=FAKEshshshfpb'
const FRESH = '__jdu=17899999991231234567890; areaId=1; ipLoc-djd=1-2800-55812-0'
const SKU = '100087543376'
const KEYWORD = '机械键盘'
const MOBILE = '13800000000'
const WEBM_STORAGE = { 'https://search.jd.com': { __jdapis_webm_runtime__: '6.0.0-exact-1', hf_time: '1790086400123' } }
const TOKEN_CACHE = JSON.parse(readFileSync(new URL('./golden/jd/_token_cache.json', import.meta.url), 'utf8'))

/** 与 gen.py 的 logged() 一致：假 cookie、预置的 h5st token 与 WebM 有效期。 */
function session(cookies = COOKIES, options: { tokenCache?: boolean; storage?: object; account?: string } = {}) {
  const ctx = makeCtx({ platform: 'jd', account: options.account ?? 'default', cookies, cookieDomain: '.jd.com' })
  if (options.tokenCache ?? true) ctx.credential.device.h5st = structuredClone(TOKEN_CACHE)
  ctx.credential.device.local_storage = structuredClone(options.storage ?? WEBM_STORAGE)
  return new Jd(ctx)
}

function chatSession() {
  const jd = session()
  jd.setChatInfo({ aid: 'FAKEAID0123', app_id: 'im.customer', client_type: 'comet' })
  return jd
}

const cookiesOf = (jd: Jd) => Object.fromEntries(jd.cookies)

/** 用例名 → TS 侧的等价调用。 */
const CASES: Record<string, () => Promise<unknown>> = {
  product_detail: () => api.productDetail(session(), SKU),
  product_comments: () => api.productComments(session(), SKU, 10),
  recommend_coupon: () => api.recommendCoupon(session(), SKU),
  related_search: () => api.relatedSearch(session(), SKU),
  search_hotwords: () => api.searchHotwords(session()),
  search_relwords: () => api.searchRelwords(session(), KEYWORD),
  cart_num: () => api.cartNum(session()),
  browse_history: () => api.browseHistory(session(), 2, 20),
  follow_products: () => api.followProducts(session(), 1, 20),
  check_session: async () => {
    const r = await api.checkSession(session())
    return [r.alive, r.name]
  },
  search_cached_webm: () => api.search(session(), KEYWORD, 2, { sort: 'sort_totalsales15_desc' }),
  search_fresh_webm: async () => {
    const jd = session(FRESH, { storage: {} })
    const result = await api.search(jd, KEYWORD, 1)
    return { result, cookie: cookiesOf(jd), local_storage: jd.ctx.credential.device.local_storage }
  },
  order_list: () => api.orderList(session(), 2, '2025'),
  aid_info: () => api.aidInfo(session()),
  chat_info: () => api.chatInfo(chatSession(), '1000000', SKU),
  chat_session_log: () => api.chatSessionLog(chatSession()),
  query_last_logs: () => api.queryLastLogs(chatSession(), '1000000', 20),
  h5st_token_fetch: async () => {
    const jd = session(COOKIES, { tokenCache: false })
    jd.h5st.configure('pin=fake_pin', 'https://item.jd.com', 'https://item.jd.com/')
    return jd.h5st.sign({ appid: 'item-v3', functionId: 'x', body: 'ab', client: 'pc', clientVersion: '1.0.0', t: '1790000000123' }, 'fb5df')
  },
  device_fields: async () => {
    const jd = session()
    jd.device.configure('__jdu=17899999991231234567890; 3AB9D23F7A4B3C9B=OLD; pin=fake_pin')
    const first = await jd.device.get()
    const forced = await jd.device.get(true)
    return { first, forced }
  },
  summer_encrypt: () => {
    setSummerSource('')
    const c = loadCase('jd', 'summer_encrypt')
    return summerEncrypt(session().http, c.input.public_key, c.input.plaintext)
  },
  qr_login: async () => {
    const jd = session(FRESH, { storage: {} })
    const { trace } = await login.prepareTrace(jd)
    await login.getQrcode(jd)
    const r = await login.checkQrcode(jd)
    await login.validateTicket(jd, String(r.ticket), trace)
    return { ok: true, cookie: cookiesOf(jd) }
  },
  sms_login: async () => {
    const jd = session(FRESH, { storage: {} })
    const sms = await login.startSms(jd)
    const sent = await login.sendCode(jd, sms, MOBILE, 'FAKEVERIFYTOKEN0123456789012345678901')
    const submitted = await login.submitCode(jd, sms, MOBILE, '123456')
    return {
      fields: sms.fields,
      sent: [sent.success, sent.message],
      submitted: [submitted.success, submitted.message],
      cookie: cookiesOf(jd),
      captcha: [sms.captchaStatus, sms.captchaSessionId, sms.captchaJwtToken],
    }
  },
  safe_verify: async () => {
    const jd = session(FRESH, { storage: {} })
    new TraceContext('fake-page-uuid-0001')
    setSummerSource('')
    const page = await login.loadSafeVerify(jd, { safeVerifyUrl: 'https://safe.jd.com/dangerousVerify/index.action?o=QO&s=QS' })
    const sent = await login.sendSafeCode(jd, page)
    const ok = await login.submitSafeCode(jd, page, sent.method, '654321')
    return { config: page.config, params: page.requestParams, sent: [sent.success, sent.message], ok: [ok.success, ok.message], cookie: cookiesOf(jd) }
  },
  search_risk: async () => {
    const jd = session()
    jd.update([['unionwsws', '%7B%22devicefinger%22%3A%22FAKEDEVICEFINGER%22%7D']])
    const result = await api.search(jd, KEYWORD, 1)
    return { result, evtoken: jd.cookie('x-rp-evtoken') }
  },
}

/** WebM 写进 localStorage 的 canvas / webgl 图像哈希与本机字体有关（见 normalizeUrl 的说明），不比较。 */
function maskWebmStorage(r: any): any {
  for (const store of Object.values<Record<string, string>>(r?.local_storage ?? {})) {
    for (const k of ['__we_m_cv__', '__we_m_gl__', '__we_m_ftk__']) if (k in store) store[k] = '<masked>'
  }
  return r
}

/** 结果也要一致的用例（上游返回值是纯数据）。 */
const SAME_RESULT: Record<string, (r: any) => unknown> = {
  check_session: (r) => r,
  search_fresh_webm: (r) => maskWebmStorage(r),
  order_list: (r) => r,
  h5st_token_fetch: (r) => r,
  device_fields: (r) => r,
  summer_encrypt: (r) => r,
  qr_login: (r) => r.cookie,
  sms_login: (r) => r,
  safe_verify: (r) => r,
  search_risk: (r) => r,
}

/**
 * 比较前统一两处与实现无关的差异：
 * - 上游的 `https://api.m.jd.com?...` 在 curl 里发出去是 `/?`；wreq-js 需要显式的 `/`。
 * - WebM 指纹里 canvas / webgl 的图像哈希由 @napi-rs/canvas 用本机字体渲染得到，换一台机器（CI）就不同，上游也一样；
 *   这两项和汇总它们的 browser_info 不比较；architecture 随 CPU 架构而变，也不比较；Math 指纹按 12 位有效数字比较；
 *   其余字段照常逐字节比较。
 */
const MASKS = [/(canvas%20fp%3A)[0-9a-f]{32}/, /^(fp%3A)[0-9a-f]{32}/]
/** wsgw_getinfo 的正文按字段展开比较，出错时能直接看出是哪个字段。 */
function expandWebm(body: string): unknown {
  const form = Object.fromEntries(new URLSearchParams(body))
  const inner = JSON.parse(form.body!)
  const fields = inner.body as Record<string, unknown>
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string') fields[k] = MASKS.reduce((x, re) => x.replace(re, '$1<masked>'), v)
  fields.browser_info = '<masked>'
  // architecture 取自 Infinity - Infinity 得到的 NaN 的符号位：x86 上是 255，ARM 上是 127，随运行测试的机器而变
  fields.architecture = '<masked>'
  // Math 指纹（如 Math.pow(Math.PI, -100)）在不同 V8 版本 / 系统上可能差 1 ulp，按 12 位有效数字比较
  const math = fields.math as Record<string, number> | undefined
  if (math) for (const k of Object.keys(math)) math[k] = Number(math[k]!.toPrecision(12))
  return { ...form, body: inner }
}
const normalizeUrl = (r: GoldenRequest): GoldenRequest => ({
  ...r,
  url: r.url.replace(/^(https:\/\/[^/?#]+)(\?|$)/, '$1/$2'),
  body: typeof r.body === 'string' && r.body.includes('functionId=wsgw_getinfo') ? (expandWebm(r.body) as string) : r.body,
})

async function run(c: GoldenCase, fn: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(c.now)
  const out = await replay(c, fn)
  if (out.error) throw out.error
  expectRequests(out.requests.map(normalizeUrl), c.requests.map(normalizeUrl))
  return out.result
}

describe('jd 对拍：请求构造与签名', () => {
  // 上游对拍时整个 node 进程的时钟都是固定的（jsdom 的 cookie 过期判断也用它）
  afterEach(() => void vi.useRealTimers())
  for (const [name, fn] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('jd', name)
      const result = await run(c, fn)
      const pick = SAME_RESULT[name]
      const expected = name === 'qr_login' ? c.result.cookie : name === 'search_fresh_webm' ? maskWebmStorage(structuredClone(c.result)) : c.result
      if (pick) expect(pick(JSON.parse(JSON.stringify(result)))).toEqual(expected)
    }, 60_000)
  }

  it('chat_packets：咚咚 WebSocket 地址与帧', async () => {
    const c = loadCase('jd', 'chat_packets')
    const result = (await run(c, async () => {
      const chat = new ChatClient(chatSession(), '1000000', 'jd.waiter')
      return { url: chat.url, packets: [chat.heartbeatPacket(), chat.helloPacket(SKU), chat.textPacket('在吗', SKU)] }
    })) as { url: string; packets: Record<string, unknown>[] }
    expect(result.url).toBe(c.result.url)
    // datetime 是本机时区的本地时间：单独比较
    const local = (() => {
      const d = new Date(c.now)
      const p = (v: number) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    })()
    for (const [i, p] of result.packets.entries()) {
      expect(p.datetime).toBe(local)
      expect({ ...p, datetime: null }).toEqual({ ...c.result.packets[i], datetime: null })
    }
  })
})

describe('jd 命令流程', () => {
  afterEach(() => void vi.useRealTimers())

  it('游客 keyword hot：按 guest.json 走免签名接口并归一化', async () => {
    const c = loadCase('jd', 'search_hotwords')
    const { keywordHot } = await import('../src/platforms/jd/web/commands.js')
    const ctx = makeCtx({ platform: 'jd', account: 'guest', cookies: COOKIES, cookieDomain: '.jd.com' })
    const hot = { ...c, responses: [{ status: 200, headers: {}, body: { code: 0, data: [{ n: '机械键盘', ext_columns: { text: '机械键盘' } }, { n: '显示器' }] } }] }
    const result = (await run(hot, () => keywordHot(ctx))) as any[]
    expect(result).toEqual([
      { text: '机械键盘', heat: null },
      { text: '显示器', heat: null },
    ])
  })

  it('搜索命中 605：纯程序验证后重试，商品归一化', async () => {
    const c = loadCase('jd', 'search_risk')
    const { itemSearch } = await import('../src/platforms/jd/web/commands.js')
    const ctx = makeCtx({ platform: 'jd', account: 'default', cookies: COOKIES + '; unionwsws=%7B%22devicefinger%22%3A%22FAKEDEVICEFINGER%22%7D', cookieDomain: '.jd.com' })
    ctx.credential.device.h5st = structuredClone(TOKEN_CACHE)
    ctx.credential.device.local_storage = structuredClone(WEBM_STORAGE)
    ctx.args.keyword = KEYWORD
    const result = (await run(c, () => itemSearch(ctx))) as any
    expect(result.page).toEqual({ cursor: null, has_more: false })
    expect(result.data).toEqual([
      {
        id: SKU,
        kind: 'goods',
        url: `https://item.jd.com/${SKU}.html`,
        title: '机械键盘',
        text: null,
        author: { id: '1000', name: '假店铺', url: 'https://mall.jd.com/index-1000.html' },
        created_at: null,
        cover: null,
        media: [],
        stats: { views: null, likes: null, comments: 20000, collects: null, shares: null },
        price: { amount: 299, currency: 'CNY' },
        status: null,
      },
    ])
    expect(ctx.credential.scopes.main!.cookies.find((x) => x.name === 'x-rp-evtoken')?.value).toBe('FAKEEVTOKEN')
  })
})

describe('jd 归一化与解析', () => {
  it('订单：金额、时间、商品 SKU', () => {
    const html = readFileSync(new URL('../scripts/golden/jd/order_list.html', import.meta.url), 'utf8')
    const orders = api.parseOrders(html)
    const skus = norm.orderSkus(html)
    const o = norm.order(orders[0]!, skus.get(orders[0]!.orderId))
    expect(o).toMatchObject({ id: '300000000001', status: '已完成', total: { amount: 23.28, currency: 'CNY' }, created_at: '2025-08-01T12:00:00+08:00' })
    expect(o.items.map((i) => [i.id, i.title])).toEqual([
      [SKU, '假商品 A & 配件 键盘'],
      ['100000000002', '假商品 B'],
    ])
    expect(norm.order(orders[1]!).total).toEqual({ amount: 1099, currency: 'CNY' })
    expect((o as any)[RAW].consignee).toBe('张*')
  })

  it('SimpleCookie：未知属性当新 cookie，非法行整体忽略', () => {
    expect(simpleCookie('thor=abc; Domain=.jd.com; Path=/; HttpOnly')).toEqual([['thor', 'abc']])
    expect(simpleCookie('a=1; Priority=High')).toEqual([
      ['a', '1'],
      ['Priority', 'High'],
    ])
    expect(simpleCookie('a=1; Partitioned')).toEqual([])
    expect(simpleCookie('q="x\\"y"; Path=/')).toEqual([['q', 'x"y']])
  })

  it('评价、优惠券、关注商品按字段名提取', () => {
    const cs = norm.comments(SKU, { result: { commentInfoList: [{ commentId: 9, userNickName: 'j***n', commentData: '好用', commentDate: '2025-08-01 10:00:00', praiseCnt: '3' }] } })
    expect(cs[0]).toMatchObject({ id: '9', item_id: SKU, text: '好用', created_at: '2025-08-01T10:00:00+08:00', stats: { likes: 3, replies: null } })
    const cp = norm.coupons({ couponList: [{ couponId: 'c1', name: '满100减10', discount: 10, quota: 100, beginTime: '2025-08-01 00:00:00', endTime: 1790000000000 }] })
    expect(cp[0]).toMatchObject({ id: 'c1', title: '满100减10', discount: { amount: 10 }, threshold: { amount: 100 }, start_at: '2025-08-01T00:00:00+08:00' })
    expect(norm.listedItems({ data: { list: [{ skuId: 1, wname: '<b>商品</b>', imgUrl: 'jfs/t1/a.jpg', jdPrice: '9.90' }] } })[0]).toMatchObject({
      id: '1',
      title: '商品',
      cover: 'https://img14.360buyimg.com/n1/jfs/t1/a.jpg',
      price: { amount: 9.9 },
    })
  })

  it('pyRepr 与 Python 的 str(float) 一致', () => {
    expect(login.pyRepr(0.5939828956034034)).toBe('0.5939828956034034')
    expect(login.pyRepr(5.123e-5)).toBe('5.123e-05')
    expect(login.pyRepr(0)).toBe('0.0')
  })
})

// ================================================================ JCAP 求解器（纯算部分）

const b64png = (s: string) => imdecode(Buffer.from(s, 'base64'), 'color')!
const f32 = (s: string) => new Float32Array(new Uint8Array(Buffer.from(s, 'base64')).buffer)
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol)

describe('jd JCAP 求解器对拍', () => {
  it('滑块：缺口位置与各项得分', async () => {
    const c = loadCase('jd', 'jcap_slider').result
    const main = b64png(c.main)
    const slot = imdecode(Buffer.from(c.slot, 'base64'), 'unchanged')!
    const s = await solver.solveSlider(main, slot)
    expect(s).toMatchObject({ retry: c.solution.retry, reason: c.solution.reason, solver: c.solution.solver, offset: c.solution.offset })
    close(s.score!, c.solution.score, 2e-4)
    close(s.margin as number, c.solution.margin, 2e-4)
    close(s.correlation as number, c.solution.correlation, 2e-4)
  })

  it('骨架化、最长路径、重采样、可信轨迹', async () => {
    const c = loadCase('jd', 'jcap_skeleton').result
    const mask = imdecode(Buffer.from(c.mask, 'base64'), 'color')!
    const w = mask.width
    const h = mask.height
    const bin = new Uint8Array(w * h).map((_, i) => (mask.data[i * 3]! > 0 ? 1 : 0))
    const skel = solver.skeletonize(bin, w, h)
    const bits = Buffer.from(c.skeleton, 'base64')
    const expected = new Uint8Array(w * h).map((_, i) => (bits[i >> 3]! >> (7 - (i & 7))) & 1)
    expect(Array.from(skel)).toEqual(Array.from(expected))
    const { path, metrics } = solver.longestSkeletonPath(skel, w, h)
    expect(path).toEqual(c.path)
    expect(metrics).toEqual(c.metrics)
    expect(await solver.resamplePath(path)).toEqual(c.resampled)
    const confident = await solver.extractConfidentPath(img(w, h, 1, f32(c.saliency)))
    expect(confident).toEqual(c.confident)
  })

  it('轨迹：LAB 残差、笔画似然、四角几何与打分', async () => {
    const c = loadCase('jd', 'jcap_trace').result
    const image = b64png(c.image)
    const maps = await solver.traceMaps(image, img(image.width, image.height, 1, f32(c.saliency)))
    close(solver.mean32(maps.residual.data), c.residual_mean, 1e-3)
    close(solver.mean32(maps.stroke!.data), c.stroke_mean, 1e-5)
    const samples = [
      [50, 80],
      [47, 140],
      [80, 150],
      [10, 10],
    ].map(([y, x]) => maps.stroke!.data[y! * image.width + x!]!)
    samples.forEach((v, i) => close(v, c.stroke_sample[i], 1e-6))
    c.params.forEach((p: number[], i: number) => {
      expect(solver.corners(p)).toEqual(c.corners[i])
      expect(solver.traceChain(p, [0, 2, 1, 3])).toEqual(c.chains[i])
      ;[
        [0, 1, 2, 3],
        [0, 2, 1, 3],
      ].forEach((t, j) => close(solver.traceScore(maps, p, t), c.scores[i][j], Math.max(1e-3, Math.abs(c.scores[i][j]) * 1e-4)))
    })
  })

  it('LSD：OpenCV 5 的直线检测', async () => {
    const c = loadCase('jd', 'jcap_lsd').result
    const gray = imdecode(Buffer.from(c.image, 'base64'), 'color')!
    const g1 = img(gray.width, gray.height, 1, new Uint8Array(gray.width * gray.height).map((_, i) => gray.data[i * 3]!))
    const lines = detectLines(await loadCv(), g1)
    expect(lines.length).toBe(c.lines.length)
    lines.forEach((l, i) => l.forEach((v, j) => close(v, c.lines[i][j], 1e-3)))
    // OpenCV 的 fastAtan2 是多项式近似（约 0.01°）
    expect(fastAtan2(1, 1)).toBeCloseTo(44.99045, 4)
  })

  it('旋转：方向分类 + 直线轴向', async () => {
    const c = loadCase('jd', 'jcap_rotation').result
    const s = await solver.solveRotation(b64png(c.image), models.orientation)
    expect(s.orientationClass).toBe(c.solution.orientationClass)
    close(s.angle as number, c.solution.angle, 0.05)
    close(s.score!, c.solution.score, 2e-3)
    close(s.axisStrength as number, c.solution.axisStrength, 2e-3)
  }, 120_000)

  it('点选：U2Net 显著性与带掩码模板匹配', async () => {
    const c = loadCase('jd', 'jcap_click').result
    const tip = b64png(c.tip)
    const sal = await solver.u2netSaliency(tip, models.u2netp)
    close(solver.mean32(sal.data), c.saliency_mean, 1e-3)
    ;[
      [20, 30],
      [5, 5],
      [30, 20],
    ].forEach(([y, x], i) => close(sal.data[y! * tip.width + x!]!, c.saliency_sample[i], 2e-3))
    const s = await solver.solveClick(b64png(c.image), tip, models.u2netp)
    expect(s.retry).toBe(c.solution.retry)
    close(s.x as number, c.solution.x, 1)
    close(s.y as number, c.solution.y, 1)
    close(s.score!, c.solution.score, 5e-3)
  }, 120_000)
})
