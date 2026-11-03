import { CatbusError } from '../../../core/errors.js'
import type { Douyin } from './client.js'
import { PROFILE } from './profile.js'
import type { Pairs } from '../../../core/py.js'

/**
 * 2046 二次验证（API 直连，无浏览器）。
 *
 * 真机实录（2026-11-03）：扫码后 check_qrconnect 返回 error_code=2046，
 * data 带二次验证决策（verify_ways：face_verify / mobile_sms_verify / pwd_verify /
 * mobile_up_sms_verify，std_verify_token 等）。真实登录页加载 auth.zijieapi.com 的
 * second_verification_web 脚本渲染弹窗；弹窗内短信路线调用的是 passport 的
 * /passport/web/send_code/ 与 /passport/web/validate_code/（type=22，公共 query 带
 * passport_jssdk_version=5.1.2 / type=lite），请求体合并 commonParams（encrypt_uid、
 * verify_ticket）与 std_verify_way。验证成功后服务端记账，check_qrconnect 继续轮询
 * 会翻绿（QR 场景没有 isResend 重发）。
 *
 * catbus 不做浏览器壳页（AI 友好，远程扫码场景用户也打不开 localhost）：默认选短信
 * 验证，直接调 passport 接口发码；验证码由用户或 AI 传入。签名复用 catbus 的
 * sdkParams / aidSign / sign+qs，cookie 用登录会话的罐。
 */

/** verify_way 常量（组件 enumVerifyWay）。 */
export const SMS_WAY = 'mobile_sms_verify'

export interface VerifyDecision {
  verify_ways?: { verify_way?: string; mobile?: string; is_safe_mobile?: boolean }[]
  verify_ticket?: string
  encrypt_uid?: string
  event_params?: { verify_scene?: string } & Record<string, unknown>
  [k: string]: unknown
}

/** 决策里有没有短信验证可用（组件按 verify_ways 列表渲染入口）。 */
export function hasSmsWay(decision: VerifyDecision): boolean {
  return (decision.verify_ways ?? []).some((w) => w?.verify_way === SMS_WAY)
}

/** 决策里短信项的掩码手机号（提示用户发到了哪个号，可能为空）。 */
export function smsMobile(decision: VerifyDecision): string | undefined {
  return (decision.verify_ways ?? []).find((w) => w?.verify_way === SMS_WAY)?.mobile
}

/** 二次验证请求的公共 query（组件 tM 拦截器的 lite 形状）。 */
function liteQuery(d: Douyin): [string, string][] {
  return [
    ['passport_jssdk_version', '5.1.2'],
    ['passport_jssdk_type', 'lite'],
    ['is_from_ttaccountsdk', '1'],
    ['aid', '6383'],
    ['language', 'zh'],
    ['account_app_language', 'zh-CN'],
    ['ts', String(Math.floor(Date.now() / 1000))],
  ]
}

function liteHeaders(csrf: string | undefined): [string, string][] {
  const h: [string, string][] = [
    ['content-type', 'application/x-www-form-urlencoded'],
    ['accept', 'application/json, text/javascript'],
    ['x-tt-passport-csrf-token', csrf ?? ''],
    ['user-agent', PROFILE.ua],
    ['origin', 'https://www.douyin.com'],
    ['referer', 'https://www.douyin.com/'],
  ]
  return h
}

/** 公共请求体：commonParams（encrypt_uid / verify_ticket）+ std_verify_way。 */
function baseBody(decision: VerifyDecision, way: string): Pairs {
  const body: Pairs = [
    ['encrypt_uid', decision.encrypt_uid ?? ''],
    ['verify_ticket', decision.verify_ticket ?? ''],
    ['std_verify_way', way],
  ]
  const scene = decision.event_params?.verify_scene
  if (scene) body.push(['std_verify_scene', scene])
  const flow = decision.std_verify_flow_id
  if (flow) body.push(['std_verify_flow_id', String(flow)])
  return body
}

/** 发短信验证码（组件 sendCode：POST /passport/web/send_code/，type=22，300/301 按 is_safe_mobile）。 */
export async function sendSms(d: Douyin, decision: VerifyDecision): Promise<Record<string, unknown>> {
  const way = (decision.verify_ways ?? []).find((w) => w?.verify_way === SMS_WAY)
  const type = way?.is_safe_mobile ? 301 : 300
  const csrf = d.cookie('passport_csrf_token') ?? d.cookie('passport_csrf_token_default')
  const query = liteQuery(d)
  const body: Pairs = [...baseBody(decision, SMS_WAY), ['type', '22'], ['aid', '6383'], ['verify_type', String(type)]]
  const res = await d.request({
    method: 'POST',
    url: 'https://login.douyin.com/passport/web/send_code/',
    query,
    form: body,
    headers: liteHeaders(csrf),
    timeout: 20,
  })
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const code = Number((out as { error_code?: unknown }).error_code ?? 0)
  if (code !== 0) {
    const desc = String((out as { description?: unknown }).description ?? (out as { message?: unknown }).message ?? '')
    throw new CatbusError('RISK_CONTROL', `二次验证发码失败 error_code=${code}：${desc}`, { detail: { kind: 'captcha', code } })
  }
  return out
}

/** 校验短信验证码（组件 validateCode：POST /passport/web/validate_code/）。 */
export async function validateSms(d: Douyin, decision: VerifyDecision, code: string): Promise<boolean> {
  const csrf = d.cookie('passport_csrf_token') ?? d.cookie('passport_csrf_token_default')
  const query = liteQuery(d)
  const body: Pairs = [...baseBody(decision, SMS_WAY), ['type', '22'], ['aid', '6383'], ['code', code]]
  const res = await d.request({
    method: 'POST',
    url: 'https://login.douyin.com/passport/web/validate_code/',
    query,
    form: body,
    headers: liteHeaders(csrf),
    timeout: 20,
  })
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const err = Number((out as { error_code?: unknown }).error_code ?? 0)
  if (err !== 0) return false
  return Boolean((out as { data?: { ticket?: unknown } }).data?.ticket) || true
}
