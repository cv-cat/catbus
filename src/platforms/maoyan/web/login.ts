import { CatbusError } from '../../../core/errors.js'
import { buildUrl, type HttpClient } from '../../../core/http.js'
import { cookieCredential, finishLogin, freshCredential, loginContext, poll, qrcodeScanned, showQrcode } from '../../../core/login.js'
import { jsonLoads } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Account, Credential } from '../../../core/schemas.js'
import { httpClient, jarOf } from '../../../core/toolkit.js'
import * as api from './api.js'
import { MaoyanClient } from './client.js'
import { PCLOGIN_UA, startGuard, type PcloginGuard } from './loginSign.js'

/**
 * 大众点评 PC 扫码登录，接口是 account.dianping.com/pclogin 页背后的两个：
 * 请求照抄网页——`accountapi.dianping.com` 的 getQrCodeImg / check 的 query 是
 * 3 个 risk 参数 + 页面缓存的 h5_fingerprint（H5guard 4.3.0 的 getfp）+ H5guard 追加的
 * yodaReady=h5、csecplatform=4、csecversion=4.3.0，并带 mtgsig 头（H5guard.sign 绑定完整 URL）；
 * 二维码本体（getQrCodeImg 返回的 jpeg）编码的就是
 * `https://m.dianping.com/mlogin/qrcodeconfirm?qruuid=<qruuid>`，qruuid 在 Set-Cookie 里。
 */
const ACCOUNT_API = 'https://accountapi.dianping.com'

/** 扫码接口的公共 query 顺序照抄网页：risk 三项在前，指纹和 H5guard 公共参数在后。 */
function riskParams(g: PcloginGuard): [string, string][] {
  const args: [string, string][] = [
    ['risk_app', '216'],
    ['risk_partner', '26'],
    ['risk_platform', '2'],
    ['h5_fingerprint', g.fingerprint],
    ['yodaReady', 'h5'],
    ['csecplatform', '4'],
    ['csecversion', '4.3.0'],
  ]
  return args
}

/** 头部顺序照抄网页的 GET：没有 Origin，mtgsig 在最后。 */
function loginHeaders(sig: string): [string, string][] {
  return [
    ['User-Agent', PCLOGIN_UA],
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Referer', 'https://account.dianping.com/'],
    ['mtgsig', sig],
  ]
}

const STATUS_SCANNED = 201
const STATUS_CONFIRMED = 202
const CODE_RISK = 101144
const CODE_EXPIRED = 101208

/** 取二维码。接口返回的是图片，qruuid 在 Set-Cookie 里；二维码内容由它拼出来，不用解码图片。 */
export async function createQrcode(http: HttpClient, g: PcloginGuard): Promise<{ qruuid: string; content: string }> {
  // mtgsig 绑定完整 URL：先 buildUrl（含 URL 编码后的指纹），再拿同一个 URL 出签
  const url = buildUrl(`${ACCOUNT_API}/mlogin/dp/api/v1/qrlogin/getQrCodeImg`, riskParams(g))
  const res = await http.request({ url, headers: loginHeaders(await g.sign(url)) })
  if (!res.ok) throw new CatbusError('UPSTREAM', `获取二维码失败（HTTP ${res.status}）`, { detail: { status: res.status } })
  const qruuid = http.jar?.get('qruuid')
  if (!qruuid) throw new CatbusError('UPSTREAM', '获取二维码失败：响应里没有 qruuid')
  return { qruuid, content: `https://m.dianping.com/mlogin/qrcodeconfirm?qruuid=${qruuid}` }
}

/** 查一次扫码状态：200 / 203 等待扫码，201 已扫码，202 已确认（dper 在这个响应的 Set-Cookie 里）。 */
export async function checkQrcode(http: HttpClient, qruuid: string, g: PcloginGuard): Promise<number> {
  const url = buildUrl(`${ACCOUNT_API}/mlogin/dp/api/v1/qrlogin/check`, [['qruuid', qruuid], ...riskParams(g)])
  const res = await http.request({ url, headers: loginHeaders(await g.sign(url)) })
  let body: any
  try {
    body = jsonLoads(await res.text())
  } catch {
    throw new CatbusError('UPSTREAM', `扫码状态接口返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status } })
  }
  const err = body?.error
  if (err?.code === CODE_EXPIRED) throw new CatbusError('AUTH_REQUIRED', '二维码已过期', { hint: '重新执行 catbus maoyan auth login' })
  if (err?.code === CODE_RISK) {
    throw new CatbusError('RISK_CONTROL', err.message || '当前扫码登录存在风险', { hint: '稍后再试，或用 --method cookie 导入', detail: { kind: 'blocked', code: err.code } })
  }
  if (err || body?.code !== 0) throw new CatbusError('UPSTREAM', err?.message || '查询扫码状态失败', { detail: { code: err?.code ?? body?.code ?? null } })
  return Number(body.data?.status)
}

/** 校验新凭证，查到账号后落盘。 */
async function finish(ctx: HandlerContext, credential: Credential): Promise<Account> {
  const token = jarOf(credential).get('dper')
  if (!token) {
    throw new CatbusError('UPSTREAM', '登录响应里没有 dper', { hint: '用 catbus maoyan auth login --method cookie 导入 .dianping.com 的 dper' })
  }
  return finishLogin(ctx, credential, await api.currentUser(new MaoyanClient(loginContext(ctx, credential)), token))
}

export async function qrcodeLogin(ctx: HandlerContext): Promise<Account> {
  const credential = freshCredential(ctx, 'qrcode')
  const http = httpClient(loginContext(ctx, credential))
  const guard = startGuard() // 一次登录一个 guard：指纹在 getQrCodeImg 和 check 之间复用，和页面一样
  try {
    const { qruuid, content } = await createQrcode(http, guard)
    await showQrcode(ctx, content, '请用大众点评 App 扫码，并在手机上确认')
    let scanned = false
    await poll(
      async () => {
        const status = await checkQrcode(http, qruuid, guard)
        if (status === STATUS_SCANNED && !scanned) {
          scanned = true
          qrcodeScanned(ctx)
        }
        return status === STATUS_CONFIRMED ? true : undefined
      },
      { what: '扫码登录' },
    )
    jarOf(credential).delete('qruuid')
    return await finish(ctx, credential)
  } finally {
    guard.stop()
  }
}

export async function cookieLogin(ctx: HandlerContext): Promise<Account> {
  const credential = cookieCredential(ctx, '.dianping.com')
  if (!jarOf(credential).get('dper')) throw new CatbusError('USAGE', '--cookie 里没有 dper', { hint: '传 .dianping.com 的 Cookie，例如 --cookie "dper=<值>"' })
  return finish(ctx, credential)
}
