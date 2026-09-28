import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GUEST } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { cookieCredential, finishLogin, freshCredential, interactive, prompt, showQrcode, smsLogin, smsState } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import { cacheDir } from '../../../core/paths.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Credential, Message } from '../../../core/schemas.js'
import { reconnecting } from '../../../core/stream.js'
import { authError, isGuest, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { ChatClient, HEARTBEAT_INTERVAL, MsgType, packets, WAITER_APP } from './chat.js'
import { checkRisk, Jd } from './client.js'
import * as login from './login.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN } from './profile.js'
import { bootstrapCookies, TraceContext } from './util.js'

type Ctx = HandlerContext
const page = (ctx: Ctx) => Number(ctx.cursor ?? 1) || 1

/** `--area`：收货地区编码，`-` 写法转成接口里的 `_`；没给时由接口从 ipLoc-djd cookie 取。 */
const areaOpt = (ctx: Ctx): string | undefined => (ctx.options.area as string | undefined)?.replaceAll('-', '_')

/** 建立会话；游客先补齐游客态（埋点 cookie、设备票据）。 */
async function session(ctx: Ctx): Promise<Jd> {
  const jd = new Jd(ctx)
  if (isGuest(ctx)) await jd.ensureGuest()
  return jd
}

/** 需要登录的命令：本地就缺 thor / pin 时直接报错，不发请求。 */
async function loggedSession(ctx: Ctx): Promise<Jd> {
  const jd = await session(ctx)
  jd.requireLogin()
  return jd
}

/** 商品 SKU：纯数字、商品页 URL（PC / 移动 / 全球购），或 3.cn 等短链。 */
export async function resolveSku(jd: Jd, input: string): Promise<string> {
  const s = String(input ?? '').trim()
  if (/^\d{4,}$/.test(s)) return s
  const m = /(?:item(?:\.m)?\.jd\.(?:com|hk)|npcitem\.jd\.hk)\/(?:product\/)?(\d{4,})\.html/.exec(s) ?? /[?&](?:sku|skuId|wareId)=(\d{4,})/.exec(s)
  if (m) return m[1]!
  if (/^https?:\/\/(3\.cn|u\.jd\.com)\//i.test(s)) {
    let url = s
    for (let i = 0; i < 5; i++) {
      const res = await jd.http.request({ url, redirect: 'manual', cookies: false })
      const loc = res.headers.get('location')
      if (!loc) break
      url = new URL(loc, url).href
      const hit = /(\d{4,})\.html/.exec(url)
      if (hit) return hit[1]!
    }
  }
  throw new CatbusError('USAGE', `无法识别的商品：${input}`, { hint: '传商品 SKU（纯数字）或商品页 URL，例如 https://item.jd.com/100012043978.html' })
}

/** 业务响应的通用检查：风控、403、登录墙。游客被拒时提示登录。 */
async function check(jd: Jd, res: any): Promise<void> {
  if (res?._status === 403) {
    if (isGuest(jd.ctx)) throw authError(jd.ctx, '京东拒绝了游客访问（403），请登录后再试')
    await diagnose403(jd)
  }
  checkRisk(jd, res)
}

/**
 * 业务接口重试后仍是 403 空 body（上游 JdAPI.diagnose 的第一步）：京东对失效的会话不报「未登录」，
 * 而是直接回 403，所以先用免签名的 passport 接口（check_session）探测登录态。
 * 登录已失效 → AUTH_EXPIRED；仍登录 → 被限流或被风控标记（diagnose 的 throttled）。
 * 限流期间不再发签名接口去探测（diagnose 的 getCartNum 探针），免得加重。
 */
async function diagnose403(jd: Jd): Promise<never> {
  let alive: boolean | null = null
  try {
    alive = (await api.checkSession(jd)).alive
  } catch (err) {
    jd.ctx.log.debug(`登录态探测失败：${(err as Error).message}`)
  }
  if (alive === false) throw authError(jd.ctx, `账号 ${jd.ctx.account} 的登录态已失效（京东对失效的会话直接回 403）`)
  throw new CatbusError('RISK_CONTROL', '京东拒绝了请求（403）：登录态有效，被限流或被风控标记了，等十几分钟到几小时再试', {
    detail: { kind: 'rate_limit', status: 403, session: alive ? 'alive' : 'unknown' },
  })
}

// ================================================================ auth

function loginContext(ctx: Ctx, method: Credential['method']): Ctx {
  return { ...ctx, account: GUEST, credential: freshCredential(ctx, method) }
}

/** 新会话：passport 页的埋点 cookie 冷启动（quick.py / login_demo.py 的 bootstrap）。 */
function loginSession(ctx: Ctx, method: Credential['method']): Jd {
  const jd = new Jd(loginContext(ctx, method))
  jd.update(bootstrapCookies('passport'))
  return jd
}

async function completeLogin(ctx: Ctx, jd: Jd) {
  const s = await api.checkSession(jd)
  if (!s.alive || !jd.pin) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：登录态校验失败')
  return finishLogin(ctx, jd.ctx.credential, norm.meRef(jd.pin, s.name))
}

const QR_POLL = 3000
const QR_REFRESH = 100_000
const QR_TIMEOUT = 300_000

async function qrLogin(ctx: Ctx) {
  const jd = loginSession(ctx, 'qrcode')
  const { trace } = await login.prepareTrace(jd)
  const deadline = rand.now() + QR_TIMEOUT
  let nextRefresh = 0
  let last: unknown = null
  while (rand.now() < deadline) {
    if (rand.now() >= nextRefresh) {
      const { png, content } = await login.getQrcode(jd)
      if (content) await showQrcode(ctx, content, '请用京东 App 扫码并确认')
      else {
        const dir = cacheDir('jd')
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const file = join(dir, 'qrcode.png')
        await writeFile(file, png)
        ctx.log.info(`请用京东 App 扫描二维码并确认：${file}`)
      }
      nextRefresh = rand.now() + QR_REFRESH
      last = null
    }
    await rand.sleep(QR_POLL)
    const res = await login.checkQrcode(jd)
    if (res.code !== last) {
      if (res.code === 202) ctx.log.info('已扫码，请在手机上确认')
      else if (res.code === 203 || res.code === 205) nextRefresh = 0
      last = res.code
    }
    if (res.code === 200 && res.ticket) {
      await login.validateTicket(jd, String(res.ticket), trace)
      return completeLogin(ctx, jd)
    }
  }
  throw new CatbusError('AUTH_REQUIRED', `${QR_TIMEOUT / 1000} 秒内没有完成扫码`, { hint: '重新执行 catbus jd auth login' })
}

interface SmsSaved extends Record<string, unknown> {
  stage: 'sms' | 'safe'
  mobile: string
  cookies: Credential['scopes'][string]['cookies']
  device: Record<string, unknown>
  fields: Record<string, string>
  publicKey: string
  pageId: string
  sessionId: string
  page?: login.SafePage
  method?: Record<string, unknown>
}

/** 短信登录的中间态：会话 cookie、设备数据、登录页隐藏域与链路上下文。 */
function saveSms(jd: Jd, sms: login.SmsContext, mobile: string, extra: Partial<SmsSaved> = {}): SmsSaved {
  return {
    stage: 'sms',
    mobile,
    cookies: structuredClone(jd.ctx.credential.scopes.main!.cookies),
    device: structuredClone(jd.ctx.credential.device),
    fields: sms.fields,
    publicKey: sms.publicKey,
    pageId: sms.trace.pageId,
    sessionId: sms.trace.sessionId,
    ...extra,
  }
}

function restoreSms(ctx: Ctx, state: SmsSaved): { jd: Jd; sms: login.SmsContext } {
  const lctx = loginContext(ctx, 'sms')
  lctx.credential.scopes.main!.cookies = structuredClone(state.cookies)
  lctx.credential.device = structuredClone(state.device)
  const jd = new Jd(lctx)
  const sms: login.SmsContext = {
    trace: new TraceContext(state.pageId, state.sessionId),
    fields: state.fields,
    publicKey: state.publicKey,
    captchaStatus: 0,
    captchaSessionId: '',
    captchaJwtToken: '',
  }
  return { jd, sms }
}

/** 额外安全验证：发第二条短信；TTY 下直接输入，否则保存中间态，下一次 --code 继续。 */
async function safeVerify(ctx: Ctx, jd: Jd, sms: login.SmsContext, mobile: string, payload: any) {
  const page = await login.loadSafeVerify(jd, payload)
  const sent = await login.sendSafeCode(jd, page)
  if (!sent.success) throw new CatbusError('UPSTREAM', sent.message)
  ctx.log.info(sent.message)
  if (!interactive()) {
    await smsState.save(ctx, saveSms(jd, sms, mobile, { stage: 'safe', page, method: sent.method }))
    throw new CatbusError('AUTH_REQUIRED', '账号需要额外安全验证，验证码已发送', {
      hint: `收到后执行：catbus jd auth login --method sms${ctx.account ? ` -a ${ctx.account}` : ''} --code <验证码>`,
    })
  }
  const code = (await prompt('额外安全验证短信验证码（6位）：')).trim()
  return finishSafe(ctx, jd, page, sent.method, code)
}

async function finishSafe(ctx: Ctx, jd: Jd, page: login.SafePage, method: Record<string, unknown>, code: string) {
  const r = await login.submitSafeCode(jd, page, method, code)
  if (!r.success) throw new CatbusError('UPSTREAM', r.message)
  if (!jd.isLogin) throw new CatbusError('AUTH_REQUIRED', '额外安全验证通过，但未取得 thor/pin')
  return completeLogin(ctx, jd)
}

async function smsFlow(ctx: Ctx) {
  return smsLogin<SmsSaved>(ctx, {
    send: async (phone) => {
      const mobile = login.loginMobile(phone)
      const jd = loginSession(ctx, 'sms')
      ctx.log.info('正在初始化手机号登录')
      const sms = await login.startSms(jd)
      let token = ''
      if (sms.captchaStatus === 1) {
        ctx.log.info('正在纯程序计算人机验证')
        token = await login.solveSmsCaptcha(jd, sms, mobile)
      }
      const r = await login.sendCode(jd, sms, mobile, token)
      if (!r.success) throw new CatbusError('UPSTREAM', r.message, { detail: { code: r.payload?.code ?? null } })
      ctx.log.info(r.message)
      return saveSms(jd, sms, mobile)
    },
    verify: async (state, code) => {
      const { jd, sms } = restoreSms(ctx, state)
      if (state.stage === 'safe') return finishSafe(ctx, jd, state.page!, state.method!, code)
      const r = await login.submitCode(jd, sms, state.mobile, code.trim())
      if (r.success) return completeLogin(ctx, jd)
      if (r.payload?.newSafeVerify) return safeVerify(ctx, jd, sms, state.mobile, r.payload)
      throw new CatbusError('UPSTREAM', r.message)
    },
  })
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  if (method === 'cookie') {
    const imported = cookieCredential(ctx, COOKIE_DOMAIN)
    const lctx = { ...ctx, account: 'login', credential: freshCredential(ctx, 'cookie') }
    const jd = new Jd(lctx)
    jd.update(imported.scopes.main!.cookies.map((c) => [c.name, c.value] as [string, string]))
    if (!jd.isLogin) throw new CatbusError('USAGE', 'cookie 里缺少 thor（或 pt_key）与 pin', { hint: '从已登录的 www.jd.com 复制完整的 Cookie' })
    return completeLogin(ctx, jd)
  }
  if (method === 'sms') return smsFlow(ctx)
  if (method === 'qrcode') return qrLogin(ctx)
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const jd = new Jd(ctx)
  if (!jd.isLogin) return { logged_in: false, user: null, method: null, expires_at: null }
  const s = await api.checkSession(jd)
  return {
    logged_in: s.alive,
    user: s.alive && jd.pin ? norm.meRef(jd.pin, s.name) : null,
    method: s.alive ? ctx.credential.method : null,
    expires_at: null,
  }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const jd = await session(ctx)
  const who = ctx.args.user ?? 'me'
  if (who !== 'me' && who !== jd.pin) throw new CatbusError('UNSUPPORTED', 'jd 的 user get 只支持 me', { hint: 'catbus jd user get me' })
  if (!jd.isLogin) throw authError(ctx)
  const s = await api.checkSession(jd)
  if (!s.alive) throw authError(ctx)
  return norm.me(jd.pin!, s.data)
}

const PAGE_SIZE = 20

export async function userCollects(ctx: Ctx) {
  const who = ctx.args.user ?? 'me'
  const jd = await loggedSession(ctx)
  if (who !== 'me' && who !== jd.pin) throw new CatbusError('UNSUPPORTED', 'jd 只能查看自己关注的商品', { hint: 'catbus jd user collects' })
  const p = page(ctx)
  const d = await api.followProducts(jd, p, PAGE_SIZE, areaOpt(ctx))
  await check(jd, d)
  const list = norm.listedItems(d)
  return paged(list, p + 1, list.length >= PAGE_SIZE)
}

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const jd = await session(ctx)
  const sku = await resolveSku(jd, ctx.args.item!)
  const d = await api.productDetail(jd, sku, areaOpt(ctx))
  await check(jd, d)
  return norm.detail(sku, d)
}

/** catbus 的 --sort → 上游 search 的 sort 取值。 */
const SORT: Record<string, string> = {
  general: '',
  sales: 'sort_totalsales15_desc',
  price_asc: 'sort_price_asc',
  price_desc: 'sort_price_desc',
  comments: 'sort_commentcount_desc',
}

async function searchItems(ctx: Ctx, jd: Jd, keyword: string, sort = '') {
  const p = page(ctx)
  const res = await api.search(jd, keyword, p, { sort, area: areaOpt(ctx) })
  if (res?._verification && res._verification.code !== 0) {
    throw new CatbusError('RISK_CONTROL', '京东要求人机验证，纯程序验证没有通过', { hint: '稍后重试，或登录后再搜索', detail: { kind: 'captcha', ...res._verification } })
  }
  await check(jd, res)
  const data = res?.data ?? {}
  const list = (Array.isArray(data.wareList) ? data.wareList : []).map(norm.ware)
  const total = Number(data.resultCount ?? 0)
  return paged(list, p + 1, list.length > 0 && p * 30 < total)
}

export async function itemSearch(ctx: Ctx) {
  const jd = await session(ctx)
  return searchItems(ctx, jd, ctx.args.keyword!, SORT[(ctx.options.sort as string) ?? 'general'] ?? '')
}

/** 相关推荐：上游只有商品页的相关搜索词（relsearch），取第一个相关词搜出的商品。 */
export async function itemRelated(ctx: Ctx) {
  const jd = await session(ctx)
  const sku = await resolveSku(jd, ctx.args.item!)
  const rel = await api.relatedSearch(jd, sku)
  const keyword = norm.keywordsFromRel(rel)[0]?.text
  if (!keyword) return paged([], null, false)
  return searchItems(ctx, jd, keyword)
}

// ================================================================ comment

/** 商品页一次取的评价条数；`--limit N` 映射到接口的 commentNum，一次请求取 N 条。 */
const COMMENT_NUM = 10

export async function commentList(ctx: Ctx) {
  const jd = await session(ctx)
  const sku = await resolveSku(jd, ctx.args.item!)
  const d = await api.productComments(jd, sku, (ctx.options.limit as number | undefined) ?? COMMENT_NUM)
  await check(jd, d)
  return paged(norm.comments(sku, d), null, false)
}

// ================================================================ keyword

export async function keywordSuggest(ctx: Ctx) {
  const jd = await session(ctx)
  const d = await api.searchRelwords(jd, ctx.args.prefix!)
  await check(jd, d)
  return norm.keywordsFromRel(d)
}

export async function keywordHot(ctx: Ctx) {
  const jd = await session(ctx)
  const d = await api.searchHotwords(jd)
  await check(jd, d)
  return norm.keywordsFromHot(d)
}

// ================================================================ history、订单、购物车、优惠券

export async function historyList(ctx: Ctx) {
  const jd = await loggedSession(ctx)
  const p = page(ctx)
  const d = await api.browseHistory(jd, p, PAGE_SIZE, areaOpt(ctx))
  await check(jd, d)
  const list = norm.listedItems(d)
  return paged(list, p + 1, list.length >= PAGE_SIZE)
}

/** `--range` → 订单中心下拉框的 `d`（get_order_list 的 date_range）：1 近三个月、2 今年内、四位年份为那一年。 */
export function orderRange(range: string | undefined): string {
  if (!range || range === '3m') return '1'
  if (range === 'this_year') return '2'
  return range
}

export async function orderList(ctx: Ctx) {
  const jd = await loggedSession(ctx)
  const p = page(ctx)
  const res = await api.orderList(jd, p, orderRange(ctx.options.range as string | undefined))
  if (res._error) throw authError(ctx, res._error)
  return paged(res.orders.map((o) => norm.order(o, res.skus?.get(o.orderId))), p + 1, res.orders.length > 0)
}

export async function cartCount(ctx: Ctx) {
  const jd = await loggedSession(ctx)
  const d = await api.cartNum(jd, areaOpt(ctx))
  await check(jd, d)
  const count = n.count(norm.find(d, ['cartNum', 'num', 'count']))
  if (count == null) throw new CatbusError('UPSTREAM', '购物车接口没有返回数量', { detail: { code: d?.code ?? null } })
  return { count }
}

export async function couponList(ctx: Ctx) {
  const jd = await session(ctx)
  const sku = await resolveSku(jd, ctx.args.item!)
  const d = await api.recommendCoupon(jd, sku, areaOpt(ctx))
  await check(jd, d)
  return norm.coupons(d)
}

// ================================================================ msg（咚咚客服）

/** 咚咚会话需要 aid：没有时先 getAidInfo。 */
async function chatSession(ctx: Ctx): Promise<Jd> {
  const jd = await loggedSession(ctx)
  if (!jd.chat.aid) {
    const r = await api.aidInfo(jd)
    await check(jd, r)
    if (!r?.aid) throw new CatbusError('UPSTREAM', '咚咚没有下发 aid', { detail: { code: r?.code ?? null } })
  }
  return jd
}

export async function msgList(ctx: Ctx) {
  const jd = await chatSession(ctx)
  const d = await api.chatSessionLog(jd)
  await check(jd, d)
  return paged(norm.conversations(d), null, false)
}

const HISTORY_SIZE = 20

export async function msgHistory(ctx: Ctx) {
  const jd = await chatSession(ctx)
  const venderId = ctx.args.conversation!
  const before = Number(ctx.cursor ?? 0) || 0
  const d = await api.queryLastLogs(jd, venderId, HISTORY_SIZE, before)
  await check(jd, d)
  const list = norm.findList(d, ['body', 'mid', 'from']).map((m: any) => norm.message(m, venderId))
  const oldest = list.reduce<number | null>((min, m) => {
    const t = Date.parse(m.created_at ?? '')
    return Number.isFinite(t) && (min == null || t < min) ? t : min
  }, null)
  return paged(list, oldest, list.length >= HISTORY_SIZE && oldest != null)
}

/** 商家侧 appId：咚咚消息信封的 to.app（get_vender_app），京东自营是 jd.waiter。 */
async function venderApp(jd: Jd, venderId: string, pid = '', orderId = ''): Promise<string> {
  const r = await api.chatInfo(jd, venderId, pid, orderId)
  return String(r?.body?.cache?.vender?.appId || WAITER_APP)
}

/** 京东自营客服的 venderId（上游 get_chat_info / JdChatWS 的默认值）。 */
const SELF_VENDER = '1'

/** 订单号：纯数字（order list 输出的 id），或订单详情页 URL 里的 orderid。 */
export function resolveOrderId(input: string): string {
  const s = String(input ?? '').trim()
  if (/^\d{6,}$/.test(s)) return s
  const m = /[?&]orderid=(\d{6,})/i.exec(s)
  if (m) return m[1]!
  throw new CatbusError('USAGE', `无法识别的订单：${input}`, { hint: '传订单号（catbus jd order list 输出的 id），或订单详情页 URL' })
}

/**
 * 咨询对象（chat_demo.py 的 VENDER_ID / SKU_ID，加上 get_chat_info 的 order_id）：
 * --conversation 直接给商家 venderId；--item 从商品详情取 venderId；只有 --order 时是京东自营客服。
 */
export async function chatTarget(ctx: Ctx, jd: Jd): Promise<{ venderId: string; pid: string; orderId: string }> {
  const o = ctx.options as Record<string, any>
  const orderId = o.order != null ? resolveOrderId(o.order) : ''
  let venderId = (o.conversation as string | undefined) ?? SELF_VENDER
  let pid = ''
  if (o.item) {
    pid = await resolveSku(jd, o.item)
    const d = await api.productDetail(jd, pid)
    await check(jd, d)
    venderId = n.str(norm.find(d, ['venderId'])) ?? ''
    if (!venderId) throw new CatbusError('UPSTREAM', '商品详情里没有商家 venderId')
  }
  return { venderId, pid, orderId }
}

export async function msgSend(ctx: Ctx): Promise<Message> {
  const o = ctx.options as Record<string, any>
  if (o.to) throw new CatbusError('UNSUPPORTED', '京东咚咚只能联系商家客服', { hint: '用 --item <商品>、--conversation <商家 venderId> 或 --order <订单>' })
  if (o.image || o.video) throw new CatbusError('UNSUPPORTED', '京东咚咚暂只支持发文本')
  const text = ctx.args.text
  if (!text) throw new CatbusError('USAGE', '需要消息内容')
  if (o.order != null) resolveOrderId(o.order)
  const jd = await chatSession(ctx)
  const { venderId, pid, orderId } = await chatTarget(ctx, jd)
  const app = await venderApp(jd, venderId, pid, orderId)
  const chat = new ChatClient(jd, venderId, app)
  const socket = await chat.connect(ctx.signal)
  try {
    await chat.send(chat.heartbeatPacket())
    await chat.send(chat.helloPacket(pid, orderId))
    const packet = chat.textPacket(text, pid, orderId)
    await chat.send(packet)
    // 等服务端的 chat_message_result 回执，最多 5 秒
    const ack = await waitFor(socket.messages, (p) => p.type === MsgType.CHAT_MESSAGE_RESULT || p.type === MsgType.FAILURE, 5000)
    if (ack?.type === MsgType.FAILURE) throw new CatbusError('UPSTREAM', `咚咚发送失败：${ack.body?.msg ?? ack.body?.code ?? ''}`, { detail: ack.body ?? null })
    return norm.message(packet, venderId)
  } finally {
    chat.close()
  }
}

async function waitFor(messages: AsyncIterable<string | Buffer>, match: (p: any) => boolean, timeout: number): Promise<any> {
  const it = messages[Symbol.asyncIterator]()
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const next = await Promise.race([it.next(), new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now())))])
    if (!next || next.done) return null
    for (const p of packets(next.value)) if (match(p)) return p
  }
  return null
}

/** 监听咚咚消息：只发心跳，不像上游示例那样自动向京东自营发起咨询。 */
export function msgListen(ctx: Ctx) {
  return (async function* () {
    const jd = await chatSession(ctx)
    yield* reconnecting(ctx, async function* () {
      const chat = new ChatClient(jd)
      const socket = await chat.connect(ctx.signal)
      const beat = () => chat.send(chat.heartbeatPacket()).catch(() => {})
      void beat()
      const timer = setInterval(beat, HEARTBEAT_INTERVAL).unref()
      try {
        for await (const raw of socket.messages) {
          for (const p of packets(raw)) {
            ctx.log.debug(`ws ${p?.type}`)
            if (p?.type === MsgType.FAILURE) ctx.log.warn(`咚咚错误 code=${p.body?.code} ${p.body?.msg ?? ''}`)
            const m = norm.chatEvent(p)
            if (m) yield m
          }
        }
      } finally {
        clearInterval(timer)
        chat.close()
      }
    })
  })()
}

