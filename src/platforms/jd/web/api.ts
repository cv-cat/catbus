import { parseJsonp } from '../../../core/http.js'
import { unescapeHtml } from '../../../core/normalize.js'
import { quote, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type Jd, searchReferer } from './client.js'
import { solveCaptcha } from './jcap.js'
import {
  API_URL,
  APPID_DONGDONG,
  APPID_PC_ITEM,
  APPID_PC_SEARCH,
  basic,
  CHAT_ORIGIN,
  CHAT_REFERER,
  CLIENT_IMH5,
  CLIENT_PC_ITEM,
  CLIENT_PC_ITEM_V3,
  CLIENT_PC_SEARCH,
  CLIENT_WH5,
  ITEM_ORIGIN,
  ITEM_REFERER,
  ORDER_DD_NO_TIME,
  ORDER_DD_WITH_TIME,
  ORDER_PC_API,
  ORDER_PC_ITEM,
  ORDER_PC_ITEM_RELWORDS,
  ORDER_PC_SEARCH,
  ORDER_PC_SEARCH_PLAIN,
  ORDER_PC_SEARCH_RELWORDS,
  ORDER_URL,
  orderDoc,
  RP_CLIENT_CHAT,
  RP_CLIENT_ITEM,
  RP_CLIENT_SEARCH,
  SEARCH_ORIGIN,
  xhr,
} from './profile.js'
import { areaOf, searchUuidOf, stripTags } from './util.js'
import { orderSkus } from './normalize.js'
import { buildSearchPayload } from './webm.js'

/**
 * 上游 jd_apis/jd_api.py 的 JdAPI，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）。
 * 返回平台原始 JSON。
 */

/** 免签名的纯查询接口在浏览器里不带这两个参数。 */
const UNSIGNED_DROP = ['loginType', 'x-api-eid-token']

const itemPage = (sku: string) => (sku ? `https://item.jd.com/${sku}.html` : ITEM_REFERER)

// ================================================================ 会话活性

/** passport 的免签名探测（check_session）：返回 [alive, 昵称或说明]，以及原始响应。 */
export async function checkSession(jd: Jd): Promise<{ alive: boolean; name: string | null; data: any }> {
  const h = basic('JSONP').referer('https://www.jd.com/')
  const res = await jd.send({
    url: 'https://passport.jd.com/loginservice.aspx',
    query: [
      ['method', 'Login'],
      ['callback', 'jsonpLogin'],
    ],
    headers: h.get(),
    timeout: 15,
  })
  const data = parseJsonp(await res.text()) ?? {}
  const identity = data.Identity && typeof data.Identity === 'object' ? data.Identity : null
  const alive = Boolean(identity?.IsAuthenticated)
  return { alive, name: alive ? (identity?.Name ?? jd.pin) : null, data }
}

// ================================================================ 商品

/** 商品详情（pc_detailpage_wareBusiness）。 */
export function productDetail(jd: Jd, sku: string, area?: string, num = '1', retry = 2) {
  const body = { skuId: String(sku), area: area || areaOf(jd.cookies), num: String(num), clientSource: 'PC', userAgent: 'Windows', sfTime: '1,0,0' }
  return jd.call('pc_detailpage_wareBusiness', {
    body,
    path: '/',
    client: CLIENT_PC_ITEM,
    appId: APPID_PC_ITEM,
    extra: [['scval', String(sku)]],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    contentType: 'application/x-www-form-urlencoded',
    order: ORDER_PC_ITEM,
    retry,
  })
}

/** 商品评价（getLegoWareDetailComment）。 */
export function productComments(jd: Jd, sku: string, count = 5) {
  const body = { shopType: '0', sku: Number(sku), commentNum: count, source: 'pc' }
  return jd.call('getLegoWareDetailComment', {
    body,
    path: '/',
    client: CLIENT_PC_ITEM_V3,
    appId: APPID_PC_ITEM,
    extra: [['build', '100000']],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    order: ORDER_PC_ITEM,
  })
}

/** 商品页推荐优惠券（getRecommendCoupon）。 */
export function recommendCoupon(jd: Jd, sku: string, area?: string) {
  return jd.call('getRecommendCoupon', {
    body: { client: 'pc' },
    path: '/',
    client: CLIENT_PC_ITEM_V3,
    appId: APPID_PC_ITEM,
    extra: [['area', area || areaOf(jd.cookies)]],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    order: ORDER_PC_ITEM,
  })
}

/** 商品相关搜索词（relsearch）：不签 h5st，也不带 t。 */
export function relatedSearch(jd: Jd, sku: string, num = 6) {
  return jd.call('relsearch', {
    body: {},
    path: '/api',
    client: CLIENT_PC_ITEM_V3,
    sign: false,
    withTime: false,
    extra: [
      ['skuid', String(sku)],
      ['num', num],
      ['rettype', 'json'],
      ['type_name', 'relsearch'],
    ],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    withUuid: true,
    drop: UNSIGNED_DROP,
    contentType: 'application/x-www-form-urlencoded',
    order: ORDER_PC_ITEM_RELWORDS,
  })
}

// ================================================================ 搜索

function searchCall(jd: Jd, keyword: string, body: Record<string, unknown>, retry: number) {
  return jd.call('pc_search_searchWare', {
    body,
    path: '/api',
    client: CLIENT_PC_SEARCH,
    appId: APPID_PC_SEARCH,
    extra: [
      ['cthr', '1'],
      ['keyword', keyword],
    ],
    referer: searchReferer(jd, keyword),
    origin: SEARCH_ORIGIN,
    method: 'GET',
    retry,
    appendTime: true,
    order: ORDER_PC_SEARCH,
    uuid: searchUuidOf(jd.cookies),
    axios: true,
    contentType: 'application/x-www-form-urlencoded',
  })
}

/**
 * 商品搜索（pc_search_searchWare）：先跑 WebM 指纹；命中 605 时纯程序完成 JCAP、保存 x-rp-evtoken 后重试一次。
 * sort 为上游取值：空=综合、sort_totalsales15_desc、sort_price_asc、sort_price_desc、sort_commentcount_desc。
 */
export async function search(jd: Jd, keyword: string, page = 1, options: { area?: string; sort?: string; retry?: number; autoVerify?: boolean } = {}) {
  await ensureWebmToken(jd, keyword)
  const body: Record<string, unknown> = {
    enc: 'utf-8',
    area: options.area || areaOf(jd.cookies),
    page,
    mode: '',
    concise: false,
    hoverPictures: false,
    newAdvRepeat: false,
    mixerParam: false,
    new_interval: true,
    s: (page - 1) * 30 + 1,
    pageSize: 30,
  }
  if (options.sort) body.sort = options.sort
  jd.searchKeyword = keyword
  const retry = options.retry ?? 2
  const result = await searchCall(jd, keyword, body, retry)
  if ((options.autoVerify ?? true) && result && typeof result === 'object' && result.disposal) {
    const verified = await solveSearchRisk(jd, result, keyword)
    if (verified.code === 0) {
      const retried = await searchCall(jd, keyword, body, retry)
      if (retried && typeof retried === 'object') retried._verification = verified
      return retried
    }
    result._verification = verified
  }
  return result
}

/** 搜索热词（pc_search_hotwords）：不签 h5st。 */
export function searchHotwords(jd: Jd) {
  return jd.call('pc_search_hotwords', {
    path: '/api',
    client: CLIENT_PC_SEARCH,
    sign: false,
    referer: searchReferer(jd),
    origin: SEARCH_ORIGIN,
    refererPage: 'https://search.jd.com/Search',
    rpClient: RP_CLIENT_SEARCH,
    method: 'GET',
    contentType: 'application/x-www-form-urlencoded',
    order: ORDER_PC_SEARCH_PLAIN,
    drop: UNSIGNED_DROP,
  })
}

/** 搜索页相关搜索词（pc_search_relwords）。 */
export function searchRelwords(jd: Jd, keyword = '', num = 10) {
  return jd.call('pc_search_relwords', {
    body: { keyword },
    path: '/api',
    client: CLIENT_PC_SEARCH,
    sign: false,
    extra: [
      ['keyword', keyword],
      ['num', num],
      ['rettype', 'json'],
      ['type_name', 'relsearch'],
    ],
    referer: searchReferer(jd, keyword),
    origin: SEARCH_ORIGIN,
    refererPage: 'https://search.jd.com/Search',
    rpClient: RP_CLIENT_SEARCH,
    method: 'GET',
    contentType: 'application/x-www-form-urlencoded',
    order: ORDER_PC_SEARCH_RELWORDS,
    drop: UNSIGNED_DROP,
  })
}

// ================================================================ 账号

/** 购物车数量（pcCart_jc_getCartNum）：POST，body 留在 query。 */
export function cartNum(jd: Jd, area?: string) {
  const body = { serInfo: { area: area || areaOf(jd.cookies, true), 'user-key': '' }, cartExt: { specialId: 1 } }
  return jd.call('pcCart_jc_getCartNum', {
    body,
    path: '/api',
    client: CLIENT_PC_SEARCH,
    appId: APPID_PC_ITEM,
    referer: searchReferer(jd),
    origin: SEARCH_ORIGIN,
    refererPage: 'https://search.jd.com/Search',
    rpClient: RP_CLIENT_SEARCH,
    withUuid: false,
    bodyInQuery: true,
    order: ORDER_PC_API,
    contentType: 'application/json',
  })
}

/** 浏览历史（pc_myjd_getBrowseHistory）。 */
export function browseHistory(jd: Jd, page = 1, pageSize = 20, area?: string, retry = 2, sku = '') {
  return jd.call('pc_myjd_getBrowseHistory', {
    body: { pageNo: page, pageSize, tag: 1, source: 'pc_sx_history' },
    path: '/',
    client: CLIENT_PC_ITEM_V3,
    appId: APPID_PC_ITEM,
    extra: [['area', area || areaOf(jd.cookies)]],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    order: ORDER_PC_ITEM,
    retry,
  })
}

/** 关注的商品（pc_follow_product_new）。 */
export function followProducts(jd: Jd, page = 1, pageSize = 1, area?: string, retry = 2, sku = '') {
  return jd.call('pc_follow_product_new', {
    body: { pageNo: page, pageSize, tag: 1, source: 'pc_sx_follow_product' },
    path: '/',
    client: CLIENT_PC_ITEM_V3,
    appId: APPID_PC_ITEM,
    extra: [['area', area || areaOf(jd.cookies)]],
    referer: ITEM_REFERER,
    refererPage: itemPage(sku),
    rpClient: RP_CLIENT_ITEM,
    origin: ITEM_ORIGIN,
    method: 'GET',
    order: ORDER_PC_ITEM,
    retry,
  })
}

// ================================================================ 订单（服务端渲染的 HTML）

export interface RawOrder {
  orderId: string
  time: string
  consignee: string
  amount: string
  payType: string
  status: string
  products: string[]
  url: string
}

/** 订单列表（get_order_list）：订单中心是 HTML 页面，逐个 `<tbody id="tb-<订单号>">` 解析。 */
export async function orderList(jd: Jd, page = 1, dateRange = '1'): Promise<{ orders: RawOrder[]; count: number; page: number; _error?: string; skus?: Map<string, string[]> }> {
  const res = await jd.send({
    url: ORDER_URL,
    headers: orderDoc().get(),
    query: [
      ['search', '0'],
      ['d', dateRange],
      ['s', '4096'],
      ['page', page],
    ],
  })
  const html = (await res.text()) ?? ''
  const head = html.slice(0, 2000)
  if (head.includes('passport.jd.com') && head.includes('login')) {
    return { orders: [], count: 0, page, _error: '被跳到登录页，登录态失效了' }
  }
  const orders = parseOrders(html)
  const out = { orders, count: orders.length, page }
  // 商品链接里的 SKU 不在上游的解析结果里，单独挂上（不参与序列化）
  Object.defineProperty(out, 'skus', { value: orderSkus(html), enumerable: false })
  return out as typeof out & { skus?: Map<string, string[]> }
}

export function parseOrders(html: string): RawOrder[] {
  const clean = (s: string | undefined) => (s ? unescapeHtml(stripTags(s)).trim() : '')
  const orders: RawOrder[] = []
  for (const match of html.matchAll(/<tbody id="tb-(\d+)"[^>]*>([\s\S]*?)<\/tbody>/g)) {
    const [, orderId, chunk] = match as unknown as [string, string, string]
    const pick = (re: RegExp) => clean(re.exec(chunk)?.[1])
    let names = [...chunk.matchAll(/<div class="p-name">\s*<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => clean(m[1]))
    if (!names.length) names = [...chunk.matchAll(/class="p-name"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => clean(m[1]))
    const amountRaw = pick(/<div class="amount"[^>]*>([\s\S]*?)<\/div>/)
    const lines = amountRaw.split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean)
    orders.push({
      orderId,
      time: pick(/<span class="dealtime"[^>]*>([\s\S]*?)<\/span>/),
      consignee: pick(/<div class="consignee[^"]*"[^>]*>\s*<span class="txt">([\s\S]*?)<\/span>/),
      amount: lines[0] ?? amountRaw,
      payType: lines[1] ?? '',
      status: pick(/<span class="order-status[^"]*"[^>]*>([\s\S]*?)<\/span>/),
      products: names.filter(Boolean).slice(0, 10),
      url: `https://details.jd.com/normal/item.action?orderid=${orderId}`,
    })
  }
  return orders
}

// ================================================================ 咚咚

const CHAT = { referer: CHAT_REFERER, origin: CHAT_ORIGIN, refererPage: CHAT_REFERER, rpClient: RP_CLIENT_CHAT, withUuid: false }

/** 咚咚 aid（getAidInfo），拿到后记进会话。 */
export async function aidInfo(jd: Jd) {
  const body = {
    aidClientType: 'comet',
    aidClientVersion: 'comet -v1.0.0',
    appId: 'im.customer',
    os: 'comet',
    entry: '',
    reqSrc: 's_comet',
    siteId: -1,
    customerAppId: 'im.customer',
  }
  const res = await jd.call('getAidInfo', { body, client: CLIENT_IMH5, appId: APPID_DONGDONG, ...CHAT, withTime: true, order: ORDER_DD_WITH_TIME })
  if (res && typeof res === 'object' && res.aid) jd.setChatInfo({ aid: res.aid, app_id: 'im.customer', client_type: 'comet' })
  else jd.ctx.log.debug('getAidInfo 未返回 aid')
  return res
}

/** 咚咚会话初始化（getChatInfo）：商家信息、会话类型、客服身份。 */
export function chatInfo(jd: Jd, venderId = '1', pid = '', orderId = '', shopId = '', groupId = '', entry = '') {
  const body = {
    lang: 'zh_CN',
    venderId: String(venderId),
    groupId,
    pid,
    ppid: '',
    shopId,
    siteId: -1,
    entry,
    orderId,
    reqSrc: 's_comet',
    cAppId: '',
    bbtf: '',
    uniformBizInfo: {},
    customerAppId: 'im.customer',
  }
  return jd.call('getChatInfo', { body, client: CLIENT_WH5, appId: APPID_DONGDONG, ...CHAT, withTime: false, order: ORDER_DD_NO_TIME })
}

/** 历史会话（getChatSessionLog）。 */
export function chatSessionLog(jd: Jd) {
  const body = { reqSrc: 's_comet', appId: 'im.customer', showMsg: 1, lastMsg: 1, uniformBizInfo: {}, siteId: -1, customerAppId: 'im.customer' }
  return jd.call('getChatSessionLog', { body, client: CLIENT_IMH5, appId: APPID_DONGDONG, ...CHAT, withTime: true, order: ORDER_DD_WITH_TIME })
}

/** 咚咚历史消息（queryLastLogs）。 */
export function queryLastLogs(jd: Jd, venderId = '1', num = 10, startTimestamp = 0, reverse = true) {
  const pin = jd.pin ?? ''
  const chat = jd.chat
  const body = {
    terminal: { version: 'wh5', pullType: 1 },
    aid: chat.aid ?? '',
    uid: { app: 'im.customer', pin, clientType: chat.client_type || 'comet', art: '' },
    customer: pin,
    venderId: String(venderId),
    startTimeStamp: startTimestamp,
    reverse: Boolean(reverse),
    num,
    siteId: -1,
    customerAppId: 'im.customer',
  }
  return jd.call('queryLastLogs', { body, path: '/api', client: CLIENT_IMH5, appId: APPID_DONGDONG, ...CHAT, withTime: true, order: ORDER_DD_WITH_TIME })
}

// ================================================================ WebM 指纹与搜索风控（605）

const WEBM_VERSION = '6.0.0-exact-1'

/**
 * 跑官方 jdwebm.js 生成 `shshshfpb`（ensure_webm_token）：先取加密的采集配置，再把采集结果交给 wsgw_getinfo。
 * 有效期内直接复用。
 */
export async function ensureWebmToken(jd: Jd, keyword = '', force = false): Promise<Record<string, unknown>> {
  let fpa = String(jd.cookie('shshshfpa') ?? '')
  const fpx = String(jd.cookie('shshshfpx') ?? '')
  if (!fpa) {
    const raw = rand.hex(16)
    fpa = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}-${rand.nowSeconds()}`
    jd.update([['shshshfpa', fpa]])
  }
  if (!fpx) jd.update([['shshshfpx', fpa]])

  const pageUrl = searchReferer(jd, keyword)
  const storage = jd.localStorageFor(pageUrl)
  const validUntil = Number.parseInt(storage.hf_time ?? '0', 10) || 0
  const current = String(jd.cookie('shshshfpb') ?? '')
  if (current && !force && storage.__jdapis_webm_runtime__ === WEBM_VERSION && validUntil > rand.now()) {
    return { code: 0, cached: true, token_length: current.length }
  }

  const now = rand.now()
  let configData = ''
  try {
    const h = xhr({ accept: 'application/json' }).referer(pageUrl).origin(SEARCH_ORIGIN)
    const res = await jd.send({
      url: `${API_URL}/`,
      headers: h.get(),
      query: [
        ['appid', 'risk_h5_info'],
        ['functionId', 'getCustomCtrl'],
        ['t', String(now)],
        ['body', '{"domain":".jd.com"}'],
      ],
    })
    const r = (await res.json()) as any
    if (r?.code === 0) configData = String(r.data ?? '')
  } catch (err) {
    jd.ctx.log.warn(`WebM 控制配置获取失败：${(err as Error).name}`)
  }

  let result: any
  try {
    const runtimeStorage = { ...storage }
    if (force) {
      delete runtimeStorage.hf_time
      delete runtimeStorage.__jdapis_webm_runtime__
    }
    const payload = await buildSearchPayload(jd, pageUrl, configData, runtimeStorage)
    const h = xhr({ form: true, accept: 'application/json' }).referer(pageUrl).origin(SEARCH_ORIGIN)
    const res = await jd.send({
      method: 'POST',
      url: `${API_URL}/`,
      headers: h.get(),
      form: [
        ['appid', 'risk_h5'],
        ['functionId', 'wsgw_getinfo'],
        ['t', String(rand.now())],
        ['body', JSON.stringify(payload)],
      ],
    })
    result = await res.json()
  } catch (err) {
    jd.ctx.log.warn(`WebM 指纹初始化失败：${(err as Error).message}`)
    return { code: -1, error: (err as Error).name }
  }

  const token = String(result?.whwswswws ?? '')
  if (result?.code === 0 && token) {
    jd.update([['shshshfpb', token]])
    const runtimeStorage = jd.localStorageFor(pageUrl)
    runtimeStorage.__jdapis_webm_runtime__ = WEBM_VERSION
    let interval = Number.parseInt(String(result.interval ?? ''), 10)
    interval = Number.isFinite(interval) && interval ? Math.max(1, interval) : 24 * 60
    runtimeStorage.hf_time = String(rand.now() + interval * 60_000)
    jd.replaceLocalStorage(pageUrl, runtimeStorage)
    return { code: 0, cached: false, token_length: token.length }
  }
  jd.ctx.log.warn(`WebM 指纹初始化未返回令牌：code=${result?.code}`)
  return { code: result?.code ?? null, cached: false, token_length: 0 }
}

/** 605 处置里的风险页上下文 URL（verification_url）。 */
export function verificationUrl(res: any, referer: string): string {
  const disposal = res?.disposal ?? {}
  let ev: any
  try {
    ev = JSON.parse(disposal.evContent || '{}')
  } catch {
    return ''
  }
  if (!ev.evUrl) return ''
  return (
    ev.evUrl +
    '?' +
    urlencode([
      ['returnurl', referer],
      ['rqhost', API_URL],
      ['rpid', disposal.rpId ?? ''],
      ['evtype', ev.evType ?? '2'],
      ['evapi', ev.evApi ?? ''],
      ['source', '1'],
      ['forceCurrentView', '1'],
      ['evsid', ev.evSid || ''],
    ])
  )
}

/** 风险页 eid 取自 unionwsws（_risk_page_eid）。 */
function riskPageEid(jd: Jd): string {
  const value = String(jd.cookie('unionwsws') ?? '')
  if (!value) return ''
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? String(parsed.devicefinger ?? '') : ''
  } catch {
    return ''
  }
}

const JS_SAFE = "~()*!.'-"

/** 搜索 605：createSid → JCAP → checkToken，成功后保存 x-rp-evtoken（solve_search_risk）。 */
export async function solveSearchRisk(jd: Jd, response: any, keyword = '', attempts = 3): Promise<{ code: number | null; stage: string; [k: string]: unknown }> {
  const disposal = response?.disposal
  if (!disposal || typeof disposal !== 'object') return { code: -1, stage: 'disposal' }
  let event: any
  try {
    event = JSON.parse(disposal.evContent || '{}')
  } catch {
    return { code: -1, stage: 'disposal' }
  }
  const pageUrl = verificationUrl(response, searchReferer(jd, keyword))
  if (!pageUrl || !disposal.rpId) return { code: -1, stage: 'disposal' }

  await ensureWebmToken(jd, keyword)
  const common = {
    requestId: disposal.rpId || '',
    evApi: quote(String(event.evApi ?? ''), JS_SAFE),
    evType: String(event.evType || '2'),
    shshshfpx: jd.cookie('shshshfpx') || '',
    eid: riskPageEid(jd),
    evSid: event.evSid || '',
  }
  try {
    const created = await jd.riskPost(pageUrl, 'createSid', common)
    const sid = String(created?.data ?? '')
    if (created?.code !== 0 || !sid) return { code: created?.code ?? null, stage: 'createSid' }
    const token = await solveCaptcha(jd, { sessionId: sid, account: '', pageUrl, attempts })
    let pin = jd.cookie('pwdt_id') || jd.cookie('pin') || jd.cookie('pt_pin') || ''
    if (pin.includes('*')) pin = ''
    const checked = await jd.riskPost(pageUrl, 'checkToken', { sid, token: quote(token, JS_SAFE), ...common, pin })
    const evToken = String(checked?.data ?? '')
    if (checked?.code !== 0 || !evToken) return { code: checked?.code ?? null, stage: 'checkToken' }
    jd.update([['x-rp-evtoken', evToken]])
    return { code: 0, stage: 'complete', token_length: evToken.length }
  } catch (err) {
    const out: { code: number; stage: string; [k: string]: unknown } = { code: -1, stage: 'jcap', error: (err as Error).name, message: (err as Error).message }
    const m = /"sCode":(\d+)/.exec(String((err as Error).message))
    if (m) out.service_subcode = Number(m[1])
    jd.ctx.log.warn(`纯程序搜索验证未通过：${(err as Error).message}`)
    return out
  }
}

