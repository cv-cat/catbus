import { CatbusError } from '../../../core/errors.js'
import { md5Hex } from '../../../core/hash.js'
import { quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import * as api from './api.js'
import type { TikTok } from './client.js'
import { ORIGIN } from './profile.js'
import { type ImEnvelope, type IntLike, imConversationRequest, imOuterRequest, imSendBody, imSendFrame, imUserInitRequest } from './wire.js'
import { frontierSign } from './jsrun.js'

/**
 * 私信（上游 api/tiktok_web.py 的 IM 部分）。
 *
 * 上游要求浏览器会话里的 im_headers（32 个键的有序 map）、im_sequence_id、im_config_id 等运行时字段，缺了就拒绝。
 * catbus 优先用会话 JSON 里的 browser_metrics；没有时 im_headers 按与 query 相同的浏览器画像补齐，
 * sequence_id 从 10000 起递增，config_id 缺省时不发（与上游 `None` 时不写字段一致）。
 */

export const IM_HEADER_KEYS = [
  'aid', 'app_name', 'channel', 'device_platform', 'device_id', 'region', 'priority_region', 'os', 'referer', 'root_referer', 'cookie_enabled',
  'screen_width', 'screen_height', 'browser_language', 'browser_platform', 'browser_name', 'browser_version', 'browser_online', 'verifyFp',
  'app_language', 'webcast_language', 'tz_name', 'is_page_visible', 'focus_state', 'is_fullscreen', 'history_len', 'user_is_login',
  'data_collection_enabled', 'from_appID', 'locale', 'user_agent', 'Web-Sdk-Ms-Token',
] as const

/** Request.headers 的有序 map（上游 _im_header_map）。 */
export function imHeaders(t: TikTok): [string, string][] {
  const source = t.metrics.im_headers as Record<string, unknown> | undefined
  if (source && typeof source === 'object') {
    const missing = IM_HEADER_KEYS.filter((k) => !(k in source))
    if (missing.length) throw new CatbusError('ERROR', `会话里的 im_headers 缺少字段：${missing.join(', ')}`)
    return IM_HEADER_KEYS.map((k) => [k, String(source[k])])
  }
  const values: Record<(typeof IM_HEADER_KEYS)[number], string> = {
    aid: '1988',
    app_name: 'tiktok_web',
    channel: 'tiktok_web',
    device_platform: 'web_pc',
    device_id: t.deviceId,
    region: t.region,
    priority_region: t.priorityRegion,
    os: 'windows',
    referer: api.MESSAGES_PAGE,
    root_referer: api.MESSAGES_PAGE,
    cookie_enabled: 'true',
    screen_width: '2560',
    screen_height: '1440',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Mozilla',
    browser_version: t.ua.split('Mozilla/').slice(1).join('Mozilla/'),
    browser_online: 'true',
    verifyFp: t.verifyFp,
    app_language: 'zh-Hans',
    webcast_language: 'zh-Hans',
    tz_name: 'Asia/Shanghai',
    is_page_visible: 'true',
    focus_state: 'true',
    is_fullscreen: 'false',
    history_len: '4',
    user_is_login: 'true',
    data_collection_enabled: 'true',
    from_appID: '1988',
    locale: 'zh-Hans',
    user_agent: t.ua,
    'Web-Sdk-Ms-Token': t.msToken,
  }
  return IM_HEADER_KEYS.map((k) => [k, values[k]])
}

/** 下一个 sequence_id：会话里给了就从它开始，之后每次 +1（存在凭证里）。 */
function nextSequence(t: TikTok, key: 'im_sequence_id' | 'im_ws_sequence_id'): number {
  const extra = t.ctx.credential.extra
  const stored = Number(extra[key] ?? t.metrics[key] ?? 10000)
  extra[key] = stored + 1
  return stored
}

/** 私信 HTTP 拉取请求的公共外层字段。 */
export function envelope(t: TikTok): ImEnvelope {
  const config = t.metrics.im_config_id
  return { sequenceId: nextSequence(t, 'im_sequence_id'), deviceId: t.deviceId, headers: imHeaders(t), configId: config == null ? null : Number(config) }
}

/** cmd 203：私信页初次拉取（会话与最近消息）。翻页时 cursor 用上一页回包的 next_cursor。 */
export async function pullInit(t: TikTok, cursor: IntLike = 0): Promise<Uint8Array> {
  return api.postImProtobuf(t, '/v2/message/get_by_user_init', imUserInitRequest(cursor, envelope(t)))
}

/** cmd 301：一个会话的消息。 */
export async function pullConversation(t: TikTok, c: { conversationId: string; shortId: string; type: string; anchorIndex?: string; direction?: number; limit?: number }): Promise<Uint8Array> {
  const raw = imConversationRequest(
    { conversationId: c.conversationId, shortId: c.shortId, type: c.type, anchorIndex: c.anchorIndex ?? '0', direction: c.direction ?? 1, limit: c.limit ?? 50 },
    envelope(t),
  )
  return api.postImProtobuf(t, '/v1/message/get_by_conversation', raw)
}

// ---------------------------------------------------------------- 会话缓存：conversation_id → short_id / type

export interface ConvInfo {
  short_id: string
  type: string
}

export function convCache(t: TikTok): Record<string, ConvInfo> {
  return ((t.ctx.credential.extra.im_conversations as Record<string, ConvInfo> | undefined) ??= {})
}

// ---------------------------------------------------------------- WebSocket

/** WS 的 access_key：md5("9" + app_key + wid + 盐)，wid 来自 privacy config（上游 build_im_access_key）。 */
export async function imWsUrl(t: TikTok): Promise<string> {
  let wid = String(t.metrics.im_wid ?? '')
  if (!wid) {
    const body = await api.cookiePrivacyConfig(t)
    wid = String(body?.body?.consent?.wid ?? '')
    if (!wid) throw new CatbusError('UPSTREAM', 'TikTok privacy config 缺少 body.consent.wid')
  }
  const accessKey = md5Hex(`9e1bd35ec9db7b8d846de66ed140b1ad9${wid}f8a69f1719916z`)
  const ttwid = t.ttwid
  if (!ttwid) throw new CatbusError('AUTH_REQUIRED', '私信 WebSocket 缺少 ttwid cookie', { hint: 'catbus tiktok auth login' })
  return (
    `wss://im-ws-${t.region.toLowerCase()}.tiktok.com/ws/v2?device_platform=web&version_code=fws_1.0.0&access_key=${accessKey}` +
    `&fpid=9&aid=1459&ttwid=${quote(ttwid, '|~-._')}&xsack=1&xaack=1&xsqos=0`
  )
}

export interface SendFrame {
  frame: Uint8Array
  request: Uint8Array
  body: Uint8Array
  clientMessageId: string
  sequenceId: number
}

/** cmd 100 的完整帧：Request 里带现签的 ticket-guard，帧头带 frontierSign(md5(Request))（上游 send_im_message）。 */
export async function buildSendFrame(t: TikTok, c: { conversationId: string; shortId: string; type: string; text: string }): Promise<SendFrame> {
  const normal = imHeaders(t)
  const guard = t.ticketGuard('/ws/v2')
  const requestHeaders: [string, string][] = [...normal]
  for (const [k, v] of Object.entries(guard)) {
    const i = requestHeaders.findIndex(([key]) => key === k)
    if (i >= 0) requestHeaders[i] = [k, v]
    else requestHeaders.push([k, v])
  }
  const clientMessageId = rand.uuid4()
  const body = imSendBody({ conversationId: c.conversationId, shortId: c.shortId, type: c.type, text: c.text, clientMessageId })
  const sequenceId = nextSequence(t, 'im_ws_sequence_id')
  const request = imOuterRequest(100, body, { sequenceId, deviceId: t.deviceId, devicePlatform: 'web', headers: requestHeaders, authType: 1 })
  const marker = await frontierSign({
    cookie: t.device.document_cookie || t.cookieStr,
    userAgent: t.ua,
    referer: String(t.metrics.im_page || `${ORIGIN}/messages`),
    metrics: t.metrics,
    stub: md5Hex(request),
  })
  const frame = imSendFrame({ request, sequenceId, logId: rand.now(), xBogus: marker, frameHeaders: normal })
  return { frame, request, body, clientMessageId, sequenceId }
}

