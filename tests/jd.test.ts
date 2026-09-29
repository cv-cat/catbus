import { readFileSync } from 'node:fs'
import { models } from '@cv-cat/catbus-assets-jd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { imdecode, img, loadCv } from '../src/core/image.js'
import { pyFloatStr, pyRound } from '../src/core/py.js'
import type { HandlerContext } from '../src/core/registry.js'
import { RAW } from '../src/core/schemas.js'
import { PLATFORMS } from '../src/platforms/index.js'
import * as api from '../src/platforms/jd/web/api.js'
import { ChatClient } from '../src/platforms/jd/web/chat.js'
import { Jd, simpleCookie } from '../src/platforms/jd/web/client.js'
import * as cmd from '../src/platforms/jd/web/commands.js'
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

/** 命令 handler 的上下文：与 session() 相同的假凭证、h5st token 与 WebM 有效期。 */
function cmdCtx(init: { args?: Record<string, string>; options?: Record<string, unknown>; cursor?: string; extra?: Record<string, unknown> } = {}): HandlerContext {
  const ctx = makeCtx({ platform: 'jd', account: 'default', cookies: COOKIES, cookieDomain: '.jd.com', ...init })
  ctx.credential.device.h5st = structuredClone(TOKEN_CACHE)
  ctx.credential.device.local_storage = structuredClone(WEBM_STORAGE)
  return ctx
}

const ORDER_ID = '300000000001'
/** 对拍用的收货地区；命令行用 `-` 写法，接口里是 `_`。 */
const AREA = '2_2830_51810_0'
const areaCtx = (init: { args?: Record<string, string>; options?: Record<string, unknown> } = {}) => cmdCtx({ ...init, options: { area: AREA.replaceAll('_', '-'), ...init.options } })

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
  // 按订单咨询：getChatInfo 带 orderId
  chat_info_order: () => api.chatInfo(chatSession(), '1', '', ORDER_ID),
  chat_info_item_order: () => api.chatInfo(chatSession(), '1000000', SKU, ORDER_ID),
  // comment list --limit 30 → commentNum 30
  product_comments_30: () => cmd.commentList(cmdCtx({ args: { item: SKU }, options: { limit: 30 } })),
  // --area：显式地区覆盖 ipLoc-djd
  product_detail_area: () => cmd.itemGet(areaCtx({ args: { item: SKU } })),
  recommend_coupon_area: () => cmd.couponList(areaCtx({ args: { item: SKU } })),
  // 假响应里没有 cartNum：只比较请求
  cart_num_area: () =>
    cmd.cartCount(areaCtx()).catch((e) => {
      if (e.code !== 'UPSTREAM') throw e
    }),
  browse_history_area: () => cmd.historyList(areaCtx()),
  follow_products_area: () => cmd.userCollects(areaCtx({ args: { user: 'me' } })),
  search_area: () => cmd.itemSearch(areaCtx({ args: { keyword: KEYWORD } })),
  // 短信登录：+852 的手机号按前缀识别地区码
  sms_send_intl: async () => {
    const jd = session(FRESH, { storage: {} })
    const sms = await login.startSms(jd)
    const mobile = login.loginMobile('+85291234567')
    const sent = await login.sendCode(jd, sms, mobile, 'FAKEVERIFYTOKEN0123456789012345678901')
    return { mobile, sent: [sent.success, sent.message] }
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
  sms_send_intl: (r) => r,
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

  /** 咚咚帧：datetime 是本机时区的本地时间，单独比较。 */
  async function expectPackets(name: string, build: () => { url: string; packets: Record<string, unknown>[] }) {
    const c = loadCase('jd', name)
    const result = (await run(c, async () => build())) as { url: string; packets: Record<string, unknown>[] }
    expect(result.url).toBe(c.result.url)
    const local = (() => {
      const d = new Date(c.now)
      const p = (v: number) => String(v).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    })()
    expect(result.packets.length).toBe(c.result.packets.length)
    for (const [i, p] of result.packets.entries()) {
      expect(p.datetime).toBe(local)
      expect({ ...p, datetime: null }).toEqual({ ...c.result.packets[i], datetime: null })
    }
  }

  it('chat_packets：咚咚 WebSocket 地址与帧', () =>
    expectPackets('chat_packets', () => {
      const chat = new ChatClient(chatSession(), '1000000', 'jd.waiter')
      return { url: chat.url, packets: [chat.heartbeatPacket(), chat.helloPacket(SKU), chat.textPacket('在吗', SKU)] }
    }))

  it('chat_packets_order：按订单咨询的欢迎语与消息带 orderId', () =>
    expectPackets('chat_packets_order', () => {
      const chat = new ChatClient(chatSession(), '1', 'jd.waiter')
      return {
        url: chat.url,
        packets: [
          chat.heartbeatPacket(),
          chat.helloPacket('', ORDER_ID),
          chat.textPacket('这个订单什么时候发货', '', ORDER_ID),
          chat.helloPacket(SKU, ORDER_ID),
          chat.textPacket('在吗', SKU, ORDER_ID),
        ],
      }
    }))

  it('normalize_mobile：国家/地区码；--phone 按 + / 00 前缀识别', () => {
    const c = loadCase('jd', 'normalize_mobile')
    for (const [mobile, area, expected] of c.result as [string, string, string][]) {
      expect(login.normalizeMobile(mobile, area), `${mobile} ${area}`).toBe(expected)
      expect(login.loginMobile(mobile), mobile).toBe(expected)
    }
  })
})

describe('jd 403：探测登录态，分清登录失效与限流（diagnose）', () => {
  afterEach(() => void vi.useRealTimers())

  async function failWith(name: string): Promise<CatbusError> {
    const c = loadCase('jd', name)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(c.now)
    const out = await replay(c, () => cmd.cartCount(cmdCtx()))
    // 业务接口 3 次 403（重签重试）后，发一次免签名的 check_session
    expectRequests(out.requests.map(normalizeUrl), c.requests.map(normalizeUrl))
    expect(out.error).toBeInstanceOf(CatbusError)
    return out.error as CatbusError
  }

  it('登录态已失效 → AUTH_EXPIRED，提示重新登录', async () => {
    const err = await failWith('diagnose_no_session')
    expect(loadCase('jd', 'diagnose_no_session').result.diagnose[0]).toBe('no_session')
    expect(err.code).toBe('AUTH_EXPIRED')
    expect(err.hint).toBe('catbus jd auth login -a default')
  })

  it('仍登录 → RISK_CONTROL（rate_limit），不再发签名探针', async () => {
    const err = await failWith('diagnose_alive')
    expect(loadCase('jd', 'diagnose_alive').result.session[0]).toBe(true)
    expect(err.code).toBe('RISK_CONTROL')
    expect(err.detail).toMatchObject({ kind: 'rate_limit', status: 403, session: 'alive' })
  })
})

describe('jd 命令流程', () => {
  afterEach(() => void vi.useRealTimers())

  it('keyword hot：走免签名接口并归一化；没有词的条目去掉，--raw 的原始对象与输出一一对应', async () => {
    const c = loadCase('jd', 'search_hotwords')
    const data = [{ n: '', ext_columns: { text: '' } }, { n: '机械键盘', ext_columns: { text: '机械键盘' } }, { n: '显示器', gid: 'g2' }]
    const hot = { ...c, responses: [{ status: 200, headers: {}, body: { abBuriedTagMap: null, code: 0, data, msg: 'Success' } }] }
    const result = (await run(hot, () => cmd.keywordHot(cmdCtx()))) as any[]
    expect(result).toEqual([
      { text: '机械键盘', heat: null },
      { text: '显示器', heat: null },
    ])
    expect(result.map((k) => k[RAW])).toEqual([data[1], data[2]])
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

/** 与 gen.py 的 chat_logged() 一致的咚咚会话参数。 */
const CHAT = { chat: { aid: 'FAKEAID0123', app_id: 'im.customer', dvc: null, client_type: 'comet' } }

/**
 * 用某个对拍用例的请求、换上别的响应跑命令：发出的请求仍要与上游一致（请求只取决于输入），返回命令的结果或错误。
 * compare 为 false 时只按响应顺序回放，不比较请求（多个接口串起来、上游没有对应用例的流程）。
 */
async function runWith(name: string, responses: GoldenCase['responses'], fn: () => Promise<unknown>, compare = true) {
  const c = loadCase('jd', name)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(c.now)
  const out = await replay({ ...c, responses }, fn)
  if (compare) expectRequests(out.requests.map(normalizeUrl), c.requests.map(normalizeUrl))
  return out
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, headers, body })
/** 只在响应头里的风控处置：`x-rp-content` 是 base64url 的 JSON，body 为空、状态码 200。 */
const disposalHeader = (api: string) =>
  Buffer.from(JSON.stringify({ code: '605', disposal: { rpId: 'FAKERPID', evContent: JSON.stringify({ evType: '3', evApi: api, title: '京东验证' }) } })).toString('base64url')

async function expectError(p: Promise<{ error?: unknown; result?: unknown }>, code: string): Promise<CatbusError> {
  const out = await p
  expect(out.error, JSON.stringify(out.result ?? null)).toBeInstanceOf(CatbusError)
  expect((out.error as CatbusError).code).toBe(code)
  return out.error as CatbusError
}

describe('jd 风控处置与业务错误', () => {
  afterEach(() => void vi.useRealTimers())

  it('处置只在 x-rp-content 头里（body 为空、200）：item get / coupon list / comment list 报 RISK_CONTROL，不重试', async () => {
    const cases: [string, string, () => Promise<unknown>][] = [
      ['product_detail', 'color_pc_detailpage_wareBusiness', () => cmd.itemGet(cmdCtx({ args: { item: SKU } }))],
      ['recommend_coupon', 'color_getRecommendCoupon', () => cmd.couponList(cmdCtx({ args: { item: SKU } }))],
      ['product_comments_30', 'color_getLegoWareDetailComment', () => cmd.commentList(cmdCtx({ args: { item: SKU }, options: { limit: 30 } }))],
    ]
    for (const [name, evApi, fn] of cases) {
      const err = await expectError(runWith(name, [json('', 200, { 'x-rp-content': disposalHeader(evApi) })], fn), 'RISK_CONTROL')
      expect(err.detail, name).toEqual({ kind: 'captcha', code: '605', api: evApi })
    }
    // 403 带处置：已经知道原因，不再重签重试、也不探测登录态
    const err = await expectError(runWith('product_detail', [json('', 403, { 'x-rp-content': disposalHeader('color_x') })], () => cmd.itemGet(cmdCtx({ args: { item: SKU } }))), 'RISK_CONTROL')
    expect(err.detail).toMatchObject({ kind: 'captcha', api: 'color_x' })
    // 解不开的头也按风控处理
    await expectError(runWith('product_detail', [json({ code: 0 }, 200, { 'x-rp-content': '%%%' })], () => cmd.itemGet(cmdCtx({ args: { item: SKU } }))), 'RISK_CONTROL')
  })

  it('网关业务错误 {code, echo} 与非 JSON 响应报 UPSTREAM，原始错误码放 detail', async () => {
    const itemGet = () => cmd.itemGet(cmdCtx({ args: { item: SKU } }))
    const e601 = await expectError(runWith('product_detail', [json({ code: '601', echo: 'request is not valid' })], itemGet), 'UPSTREAM')
    expect(e601.detail).toMatchObject({ code: '601', echo: 'request is not valid' })
    const html = await expectError(runWith('product_detail', [json('<html>busy</html>')], itemGet), 'UPSTREAM')
    expect(html.detail).toMatchObject({ status: 200, body: '<html>busy</html>' })
    // item related：relsearch 的中间结果也要检查
    await expectError(runWith('related_search', [json({ code: '601', echo: 'x' })], () => cmd.itemRelated(cmdCtx({ args: { item: SKU } }))), 'UPSTREAM')
  })

  it('item related：取 relsearch 的第一个相关词去搜索；没有相关词时返回空列表', async () => {
    const ware = { wareId: '100000000021', wareName: '<font>蓝莓</font>礼盒', jdPrice: '46.50', shopId: 12105625, shopName: '假店铺', comment: '1万+' }
    const rel = json({ code: 0, data: [{ keyword: '进口蓝莓' }, { keyword: '蓝莓' }] })
    const out = await runWith('related_search', [rel, json({ code: 0, data: { resultCount: 31, wareList: [ware] } })], () => cmd.itemRelated(cmdCtx({ args: { item: SKU } })), false)
    expect(out.error).toBeUndefined()
    expect(out.requests.map((r) => new URL(r.url).searchParams.get('functionId'))).toEqual(['relsearch', 'pc_search_searchWare'])
    expect(new URL(out.requests[1]!.url).searchParams.get('keyword')).toBe('进口蓝莓')
    const r = out.result as any
    expect(r.data.map((i: any) => [i.id, i.title, i.price?.amount])).toEqual([['100000000021', '蓝莓礼盒', 46.5]])
    expect(r.page).toEqual({ cursor: '2', has_more: true })
    const empty = await runWith('related_search', [json({ code: 0, data: [] })], () => cmd.itemRelated(cmdCtx({ args: { item: SKU } })))
    expect(empty.result).toEqual({ data: [], page: { cursor: null, has_more: false } })
  })

  it('登录墙：购物车 pin is null、浏览历史 resultCode -100（2026-09-29 真机）报 AUTH_EXPIRED', async () => {
    const cart = { success: false, code: 1, message: 'pin is null', url: 'https://passport.jd.com/new/login.aspx' }
    const e1 = await expectError(runWith('cart_num', [json(cart)], () => cmd.cartCount(cmdCtx())), 'AUTH_EXPIRED')
    expect(e1.hint).toBe('catbus jd auth login -a default')
    const history = { resultCode: -100, resultMsg: '用户未登录', success: false }
    await expectError(runWith('browse_history', [json(history)], () => cmd.historyList(cmdCtx({ cursor: '2' }))), 'AUTH_EXPIRED')
    // success:false 但不是登录墙 → UPSTREAM
    const e3 = await expectError(runWith('browse_history', [json({ resultCode: 500, resultMsg: '系统繁忙', success: false })], () => cmd.historyList(cmdCtx({ cursor: '2' }))), 'UPSTREAM')
    expect(e3.detail).toMatchObject({ result_code: 500, message: '系统繁忙' })
  })

  it('code 只对核对过正常值的接口判：hotwords / getChatSessionLog 非 0 报 UPSTREAM；getRecommendCoupon 的 {"code":"1"} 仍是空列表', async () => {
    await expectError(runWith('search_hotwords', [json({ code: 1, msg: 'fail' })], () => cmd.keywordHot(cmdCtx())), 'UPSTREAM')
    await expectError(runWith('chat_session_log', [json({ code: '1', msg: '失败', subCode: '1' })], () => cmd.msgList(cmdCtx({ extra: CHAT }))), 'UPSTREAM')
    const coupons = await runWith('recommend_coupon', [json({ code: '1' })], () => cmd.couponList(cmdCtx({ args: { item: SKU } })))
    expect(coupons.error).toBeUndefined()
    expect(coupons.result).toEqual([])
  })

  it('咚咚 aid：会话里没有时先 getAidInfo 并记下；没下发 aid 报 UPSTREAM，code 3 报登录失效', async () => {
    const sessions = { code: '0', chatSessions: [{ venderId: '1', venderName: '京东客服', time: 1790000000123 }], msg: '请求成功', subCode: '0' }
    const ctx = cmdCtx()
    const ok = await runWith('aid_info', [json({ code: '0', pin: 'fake_pin', aid: 'NEWAID', subCode: '0' }), json(sessions)], () => cmd.msgList(ctx), false)
    expect(ok.requests.map((r) => new URL(r.url).searchParams.get('functionId'))).toEqual(['getAidInfo', 'getChatSessionLog'])
    expect((ok.result as any).data.map((c: any) => c.id)).toEqual(['1'])
    expect(ctx.credential.extra.chat).toMatchObject({ aid: 'NEWAID', app_id: 'im.customer', client_type: 'comet' })
    const none = await expectError(runWith('aid_info', [json({ code: '0', subCode: '0' })], () => cmd.msgList(cmdCtx()), false), 'UPSTREAM')
    expect(none.message).toMatch(/aid/)
    await expectError(runWith('aid_info', [json({ code: '3', echo: 'not login' })], () => cmd.msgList(cmdCtx()), false), 'AUTH_EXPIRED')
  })
})

describe('jd 咚咚历史与发送回执', () => {
  afterEach(() => void vi.useRealTimers())

  const msg = (i: number, timestamp: number) => ({ id: `m${i}`, from: { pin: 'waiter_1' }, body: { type: 'text', content: `第 ${i} 条` }, timestamp })

  it('msg history：游标是最早一条的毫秒 timestamp（同一秒的多条不会被跳过），满一页才有下一页', async () => {
    // 20 条，最早的两条在同一秒里（…123 与 …456 毫秒）
    const list = [...Array.from({ length: 18 }, (_, i) => msg(i, 1790000100000 + i * 1000)), msg(18, 1790000000456), msg(19, 1790000000123)]
    const full = await runWith('query_last_logs', [json({ code: '0', data: list })], () => cmd.msgHistory(cmdCtx({ args: { conversation: '1000000' }, extra: CHAT })))
    expect(full.error).toBeUndefined()
    const r = full.result as any
    expect(r.data).toHaveLength(20)
    expect(r.page).toEqual({ cursor: '1790000000123', has_more: true })
    expect(r.data[19]).toMatchObject({ id: 'm19', conversation_id: '1000000', text: '第 19 条', created_at: '2026-09-21T22:13:20+08:00' })
    const last = await runWith('query_last_logs', [json({ code: '0', data: list.slice(0, 3) })], () => cmd.msgHistory(cmdCtx({ args: { conversation: '1000000' }, extra: CHAT })))
    expect((last.result as any).page).toEqual({ cursor: null, has_more: false })
  })

  /** 按顺序吐出帧的消息流；hang 之后一直不来新帧。记录迭代器有没有被关掉。 */
  function stream(frames: unknown[], hang = true) {
    const state = { closed: false }
    const messages: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        try {
          for (const f of frames) yield JSON.stringify(f)
          if (hang) await new Promise(() => {})
        } finally {
          state.closed = true
        }
      },
    }
    return { messages, state }
  }

  it('回执按 id 对上刚发的消息：欢迎语的回执不算；对上的 failure 报 UPSTREAM', async () => {
    const ctx = cmdCtx()
    const s1 = stream([{ type: 'chat_message_result', id: 'hello' }, [{ type: 'ack' }, { type: 'chat_message_result', id: 'mine' }]])
    await expect(cmd.waitReceipt(ctx, s1.messages, 'mine', 1000)).resolves.toBeUndefined()
    expect(s1.state.closed).toBe(true)
    const s2 = stream([{ type: 'chat_message_result', id: 'hello' }, { type: 'failure', id: 'mine', body: { code: 111, msg: '授权过期' } }])
    const err = await cmd.waitReceipt(ctx, s2.messages, 'mine', 1000).catch((e) => e)
    expect(err).toBeInstanceOf(CatbusError)
    expect(err).toMatchObject({ code: 'UPSTREAM', detail: { code: 111, msg: '授权过期' } })
  })

  it('等不到回执：途中有没对上 id 的 failure 报 UPSTREAM；什么都没有只提示，按已发送返回', async () => {
    const ctx = cmdCtx()
    const warn = vi.spyOn(ctx.log, 'warn')
    const s1 = stream([{ type: 'chat_message_result', id: 'hello' }])
    await expect(cmd.waitReceipt(ctx, s1.messages, 'mine', 50)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/没有回执/))
    const s2 = stream([{ type: 'failure', body: { code: 5, msg: '发送太频繁' } }])
    await expect(cmd.waitReceipt(ctx, s2.messages, 'mine', 50)).rejects.toMatchObject({ code: 'UPSTREAM', detail: { code: 5 } })
    // 连接先断了：同样按没有回执处理
    const s3 = stream([], false)
    await expect(cmd.waitReceipt(ctx, s3.messages, 'mine', 1000)).resolves.toBeUndefined()
  })
})

describe('jd 私有选项', () => {
  afterEach(() => void vi.useRealTimers())

  it('order list --range：3m / this_year / 年份 → 订单中心的 d', async () => {
    expect([undefined, '3m', 'this_year', '2025'].map(cmd.orderRange)).toEqual(['1', '1', '2', '2025'])
    // 与上游 get_order_list(page=2, date_range='2025') 的请求一致
    const c = loadCase('jd', 'order_list')
    const result = (await run(c, () => cmd.orderList(cmdCtx({ options: { range: '2025' }, cursor: '2' })))) as any
    expect(result.data.map((o: any) => o.id)).toEqual(c.result.orders.map((o: any) => o.orderId))
    expect(result.page).toEqual({ cursor: '3', has_more: true })
  })

  it('--range、--area 的取值校验', () => {
    const jd = PLATFORMS.find((p) => p.id === 'jd')!
    const web = jd.endpoints.web as Exclude<typeof jd.endpoints.web, 'planned'>
    const range = web.commands.get('order list')!.options.range!
    expect(range.safeParse(undefined).data).toBe('3m')
    for (const ok of ['3m', 'this_year', '2024']) expect(range.safeParse(ok).success).toBe(true)
    for (const bad of ['1', '2', 'year', '20245']) expect(range.safeParse(bad).success).toBe(false)
    const area = web.commands.get('item get')!.options.area!
    for (const ok of ['1_2800_55812_0', '1-2800-55812-0']) expect(area.safeParse(ok).success).toBe(true)
    for (const bad of ['1_2800', 'beijing', '1-2800-55812-0.123']) expect(area.safeParse(bad).success).toBe(false)
    for (const key of ['item search', 'item related', 'coupon list', 'cart count', 'history list', 'user collects']) {
      expect(web.commands.get(key)!.options.area, key).toBeDefined()
    }
  })

  it('msg send --order：与 --item / --conversation 之一合用，或单独使用', async () => {
    const jd = PLATFORMS.find((p) => p.id === 'jd')!
    const web = jd.endpoints.web as Exclude<typeof jd.endpoints.web, 'planned'>
    const check = web.commands.get('msg send')!.check!
    const text = { text: '在吗' }
    expect(check(text, { order: ORDER_ID })).toBeUndefined()
    expect(check(text, { order: ORDER_ID, item: SKU })).toBeUndefined()
    expect(check(text, { order: ORDER_ID, conversation: '1000000' })).toBeUndefined()
    expect(check(text, { conversation: '1000000' })).toBeUndefined()
    expect(check(text, {})).toMatch(/--order/)
    expect(check(text, { item: SKU, conversation: '1000000' })).toMatch(/只有 --to 与 --item 可以同时用/)
    // --to 与 --item 按通用规则放行，由 handler 报 UNSUPPORTED（京东只能联系商家客服）
    expect(check(text, { to: 'u', item: SKU })).toBeUndefined()
    expect(check({}, { order: ORDER_ID })).toMatch(/text/)

    expect(cmd.resolveOrderId(ORDER_ID)).toBe(ORDER_ID)
    expect(cmd.resolveOrderId(`https://details.jd.com/normal/item.action?orderid=${ORDER_ID}`)).toBe(ORDER_ID)
    expect(() => cmd.resolveOrderId('abc')).toThrow(CatbusError)

    // 只有 --order：京东自营客服（venderId 1），不发请求
    expect(await cmd.chatTarget(cmdCtx({ options: { order: ORDER_ID } }), session())).toEqual({ venderId: '1', pid: '', orderId: ORDER_ID })
    expect(await cmd.chatTarget(cmdCtx({ options: { order: ORDER_ID, conversation: '1000000' } }), session())).toEqual({
      venderId: '1000000',
      pid: '',
      orderId: ORDER_ID,
    })
    // --item + --order：venderId 取自商品详情（与 product_detail 对拍的请求相同）
    const c = loadCase('jd', 'product_detail')
    const detail = { ...c, responses: [{ status: 200, headers: {}, body: { code: 0, shopInfo: { shop: { venderId: 1000000 } } } }] }
    const ctx = cmdCtx({ options: { order: ORDER_ID, item: SKU } })
    const target = await run(detail, async () => cmd.chatTarget(ctx, new Jd(ctx)))
    expect(target).toEqual({ venderId: '1000000', pid: SKU, orderId: ORDER_ID })
  })
})

describe('jd 归一化与解析', () => {
  it('msg listen：系统消息、撤回、会话建立输出为 other；协议帧不输出', () => {
    const base = { from: { app: 'jd.waiter', pin: 'waiter_1', clientType: 'comet' }, datetime: '2025-08-01 12:00:00', timestamp: 1754020800000, ver: '4.2', lang: 'zh_CN', aid: 'x' }
    const text = norm.chatEvent({ ...base, id: 'm1', type: 'chat_message', body: { type: 'text', content: '您好', chatinfo: { venderId: '1000000' } } })
    expect(text).toMatchObject({ id: 'm1', conversation_id: '1000000', type: 'text', text: '您好', from: { id: 'waiter_1' } })
    const sys = norm.chatEvent({ ...base, id: 's1', type: 'sys_msg', body: { data: { tplData: { title: '客服已接入' } }, chatinfo: { venderId: '1000000' } } })
    expect(sys).toMatchObject({ id: 's1', conversation_id: '1000000', type: 'other', text: '客服已接入', from: null, created_at: '2025-08-01T12:00:00+08:00' })
    const revoke = norm.chatEvent({ ...base, id: 'r1', type: 'revoke_message', body: { revokeContentToC: '客服撤回了一条消息', revokeMsgId: 'm0', venderId: '1000000' } })
    expect(revoke).toMatchObject({ id: 'r1', conversation_id: '1000000', type: 'other', text: '客服撤回了一条消息（被撤回的消息：m0）', from: { id: 'waiter_1' } })
    expect(norm.chatEvent({ ...base, id: 'r2', type: 'revoke_message', body: {} })?.text).toBe('对方撤回了一条消息')
    const open = norm.chatEvent({ ...base, id: 'o1', type: 'chat_session_open', body: { venderId: '1000000', waiter: { pin: 'waiter_1' }, code: 1 } })
    expect(open).toMatchObject({ type: 'other', conversation_id: '1000000', text: '会话建立：商家 1000000，客服 waiter_1', from: { id: 'waiter_1' } })
    expect(norm.chatEvent({ ...base, id: 'c1', type: 'chat_session_close', body: {} })).toMatchObject({ type: 'other', text: '会话结束' })
    for (const type of ['client_heartbeat', 'ack', 'chat_message_result', 'failure', 'msg_read_ack']) expect(norm.chatEvent({ ...base, type })).toBeNull()
    expect(norm.chatEvent({ ...base, type: 'chat_message', body: { type: 'template2', data: {} } })).toBeNull()
  })

  it('订单：金额、时间、商品 SKU', () => {
    const html = readFileSync(new URL('../scripts/golden/jd/order_list.html', import.meta.url), 'utf8')
    const orders = api.parseOrders(html)
    const o = norm.order(orders[0]!)
    expect(o).toMatchObject({ id: '300000000001', status: '已完成', total: { amount: 23.28, currency: 'CNY' }, created_at: '2025-08-01T12:00:00+08:00' })
    expect(o.items.map((i) => [i.id, i.title])).toEqual([
      [SKU, '假商品 A & 配件 键盘'],
      ['100000000002', '假商品 B'],
    ])
    expect(norm.order(orders[1]!).total).toEqual({ amount: 1099, currency: 'CNY' })
    expect((o as any)[RAW].consignee).toBe('张*')
    // SKU 不进上游的解析结果（对拍比较 orders 时不出现）
    expect(JSON.parse(JSON.stringify(orders[0]))).not.toHaveProperty('skus')
  })

  it('订单：商品名与 SKU 取自同一个链接，全球购链接、空名链接、认不出的链接都不会让后面的商品错位', () => {
    const name = (href: string, text: string) => `<div class="p-name"><a href="${href}" target="_blank">${text}</a></div>`
    const html =
      '<tbody id="tb-300000000009">' +
      name('//npcitem.jd.hk/100000000011.html', '全球购商品') +
      name('//item.jd.com/100000000012.html', '') +
      name('//item.jd.hk/100000000013.html', '海外商品') +
      name('//item.m.jd.com/product/100000000014.html', '移动端链接') +
      name('javascript:void(0)', '礼品卡') +
      name('//item.jd.com/100000000015.html', '普通商品') +
      '<span class="dealtime">2025-08-01 12:00:00</span></tbody>'
    const [raw] = api.parseOrders(html)
    expect(raw!.products).toEqual(['全球购商品', '海外商品', '移动端链接', '礼品卡', '普通商品'])
    expect(norm.order(raw!).items.map((i) => [i.id, i.title, i.url])).toEqual([
      ['100000000011', '全球购商品', 'https://item.jd.com/100000000011.html'],
      ['100000000013', '海外商品', 'https://item.jd.com/100000000013.html'],
      ['100000000014', '移动端链接', 'https://item.jd.com/100000000014.html'],
      ['', '礼品卡', null],
      ['100000000015', '普通商品', 'https://item.jd.com/100000000015.html'],
    ])
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

  it('会话列表：列表在 chatSessions，条目只有 time（毫秒），没有最后一条消息与未读数（2026-09-29 真机的字段结构）', () => {
    const session = { groupId: 10000002, venderId: '1', pid: '', label: '官方', type: 3, venderName: '京东客服', appId: 'jd.waiter', time: 1790598767492 }
    const cs = norm.conversations({ code: '0', chatSessions: [session], msg: '请求成功', subCode: '0' })
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ id: '1', peer: { id: '1', name: '京东客服' }, last_message: null, unread: null, updated_at: '2026-09-28T20:32:47+08:00' })
    expect((cs[0] as any)[RAW]).toBe(session)
  })

  it('商品详情：按 wareInfo / price.p / shopInfo.shop / 主图列表取，浅层的 name、url 不会压过真正的字段', () => {
    const d = {
      name: '活动名',
      url: '//pro.jd.com/activity.html',
      p: '1',
      price: { p: '299.00', op: '399.00', id: SKU },
      wareInfo: { wname: '假商品 键盘', venderId: 1000000, imageList: ['jfs/t1/a.jpg', 'jfs/t1/b.jpg'] },
      shopInfo: { customerService: { name: '客服' }, shop: { shopId: 1000001, name: '假店铺', venderId: 1000000, url: '//mall.jd.com/index-1000001.html' } },
    }
    const item = norm.detail(SKU, d)
    expect(item).toMatchObject({
      id: SKU,
      url: `https://item.jd.com/${SKU}.html`,
      title: '假商品 键盘',
      author: { id: '1000001', name: '假店铺', url: 'https://mall.jd.com/index-1000001.html' },
      cover: 'https://img14.360buyimg.com/n1/jfs/t1/a.jpg',
      price: { amount: 299, currency: 'CNY' },
    })
    expect(item.media.map((m) => m.url)).toEqual(['https://img14.360buyimg.com/n1/jfs/t1/a.jpg', 'https://img14.360buyimg.com/n1/jfs/t1/b.jpg'])
    expect(norm.detailVenderId(d)).toBe('1000000')
    // 没有 wareInfo 时按专有键名兜底；图片列表的元素也可以是对象
    const other = norm.detail(SKU, { name: '活动名', data: { skuName: '兜底名', imgs: [{ big: '//img10.360buyimg.com/n1/x.jpg' }] }, price: { finalPrice: { price: '9.90' } } })
    expect(other).toMatchObject({ title: '兜底名', cover: 'https://img10.360buyimg.com/n1/x.jpg', price: { amount: 9.9 } })
    // venderId 为 0 不是商家
    expect(norm.detailVenderId({ shopInfo: { shop: { venderId: 0 } } })).toBeNull()
    expect(norm.detailVenderId({})).toBeNull()
  })

  it('购物车数量取 cartNum', () => {
    expect(norm.cartCount({ cartNum: 2 })).toBe(2)
    expect(norm.cartCount({ code: 0, data: { num: 5 } })).toBeNull()
  })

  it('评价、优惠券、关注商品按字段名提取', () => {
    // 真实响应里问答 questionList 排在评价 commentInfoList 前面，问答条目也有 content（2026-09-28 真机）
    const cs = norm.comments(SKU, {
      result: {
        questionList: [{ id: '69405999', content: '能打fps游戏吗', answerList: [] }],
        commentInfoList: [{ commentId: 9, userNickName: 'j***n', commentData: '好用', commentDate: '2025-08-01 10:00:00', praiseCnt: '3' }],
      },
    })
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

  it('pyFloatStr 与 Python 的 str(float) 一致', () => {
    expect(pyFloatStr(0.5939828956034034)).toBe('0.5939828956034034')
    expect(pyFloatStr(5.123e-5)).toBe('5.123e-05')
    expect(pyFloatStr(0)).toBe('0.0')
    // round(773.915, 2)：773.915 的二进制值略小于 773.915，Python 得 773.91
    expect(pyRound(773.915, 2)).toBe(773.91)
  })
})

// ================================================================ JCAP 求解器（纯算部分）

const b64png = async (s: string) => (await imdecode(Buffer.from(s, 'base64'), 'color'))!

describe('jd JCAP 图片解码', () => {
  it('JPEG / WebP 与 PNG 解出同样的像素（@napi-rs/canvas 的解码是异步的，没等就会得到全黑）', async () => {
    const { createCanvas } = await import('@napi-rs/canvas')
    const c = createCanvas(40, 30)
    const g = c.getContext('2d')
    g.fillStyle = '#c08040'
    g.fillRect(0, 0, 40, 30)
    const mean = (m: { data: ArrayLike<number> }) => Array.from(m.data).reduce((a, b) => a + b, 0) / m.data.length
    const png = (await imdecode(c.toBuffer('image/png')))!
    for (const mime of ['image/jpeg', 'image/webp'] as const) {
      const m = (await imdecode(c.toBuffer(mime)))!
      expect([m.width, m.height, m.channels], mime).toEqual([40, 30, 3])
      expect(Math.abs(mean(m) - mean(png)), mime).toBeLessThan(3)
    }
  })
})
const f32 = (s: string) => new Float32Array(new Uint8Array(Buffer.from(s, 'base64')).buffer)
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol)

describe('jd JCAP 求解器对拍', () => {
  it('滑块：缺口位置与各项得分', async () => {
    const c = loadCase('jd', 'jcap_slider').result
    const main = await b64png(c.main)
    const slot = (await imdecode(Buffer.from(c.slot, 'base64'), 'unchanged'))!
    const s = await solver.solveSlider(main, slot)
    expect(s).toMatchObject({ retry: c.solution.retry, reason: c.solution.reason, solver: c.solution.solver, offset: c.solution.offset })
    close(s.score!, c.solution.score, 2e-4)
    close(s.margin as number, c.solution.margin, 2e-4)
    close(s.correlation as number, c.solution.correlation, 2e-4)
  })

  it('骨架化、最长路径、重采样、可信轨迹', async () => {
    const c = loadCase('jd', 'jcap_skeleton').result
    const mask = (await imdecode(Buffer.from(c.mask, 'base64'), 'color'))!
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
    const image = await b64png(c.image)
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
    const gray = (await imdecode(Buffer.from(c.image, 'base64'), 'color'))!
    const g1 = img(gray.width, gray.height, 1, new Uint8Array(gray.width * gray.height).map((_, i) => gray.data[i * 3]!))
    const lines = detectLines(await loadCv(), g1)
    expect(lines.length).toBe(c.lines.length)
    lines.forEach((l, i) => l.forEach((v, j) => close(v, c.lines[i][j], 1e-3)))
    // OpenCV 的 fastAtan2 是多项式近似（约 0.01°）
    expect(fastAtan2(1, 1)).toBeCloseTo(44.99045, 4)
  })

  it('旋转：方向分类 + 直线轴向', async () => {
    const c = loadCase('jd', 'jcap_rotation').result
    const s = await solver.solveRotation(await b64png(c.image), models.orientation)
    expect(s.orientationClass).toBe(c.solution.orientationClass)
    close(s.angle as number, c.solution.angle, 0.05)
    close(s.score!, c.solution.score, 2e-3)
    close(s.axisStrength as number, c.solution.axisStrength, 2e-3)
  }, 120_000)

  it('点选：U2Net 显著性与带掩码模板匹配', async () => {
    const c = loadCase('jd', 'jcap_click').result
    const tip = await b64png(c.tip)
    const sal = await solver.u2netSaliency(tip, models.u2netp)
    close(solver.mean32(sal.data), c.saliency_mean, 1e-3)
    ;[
      [20, 30],
      [5, 5],
      [30, 20],
    ].forEach(([y, x], i) => close(sal.data[y! * tip.width + x!]!, c.saliency_sample[i], 2e-3))
    const s = await solver.solveClick(await b64png(c.image), tip, models.u2netp)
    expect(s.retry).toBe(c.solution.retry)
    close(s.x as number, c.solution.x, 1)
    close(s.y as number, c.solution.y, 1)
    close(s.score!, c.solution.score, 5e-3)
  }, 120_000)
})
