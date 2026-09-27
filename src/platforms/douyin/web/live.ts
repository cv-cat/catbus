import * as n from '../../../core/normalize.js'
import { urlencode } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Event, Message, Media } from '../../../core/schemas.js'
import { openSocket, reconnecting } from '../../../core/stream.js'
import * as api from './api.js'
import type { Douyin } from './client.js'
import { frontierUrl } from './im.js'
import * as norm from './normalize.js'
import * as proto from './proto.js'
import { APP_VERSION, LIVE, Params, PROFILE, WWW } from './profile.js'
import { liveSignature } from './sign.js'

/** 直播弹幕与私信的长连接（上游 dy_live/server.py、dy_apis/douyin_recv_msg.py）。 */

// ================================================================ 直播弹幕

export interface LiveSocket {
  url: string
  headers: Record<string, string>
}

/** 先 im/fetch 取 cursor / internalExt，再拼 wss 地址（上游 DouyinLive.start_ws）。 */
export async function liveSocket(d: Douyin, info: api.LiveInfo, webRid: string): Promise<LiveSocket> {
  const fetched = proto.decode('Live', 'LiveResponse', await api.webcastFetch(d, info.user_id, info.room_id, `${LIVE}/${webRid}`))
  const p = new Params()
  p.add('app_name', 'douyin_web').add('version_code', '180800').add('webcast_sdk_version', '1.0.15').add('update_version_code', '1.0.15')
  p.add('compress', 'gzip').add('device_platform', 'web').add('cookie_enabled', 'true').add('screen_width', '1707').add('screen_height', '960')
  p.add('browser_language', 'zh-CN').add('browser_platform', 'Win32').add('browser_name', 'Mozilla').add('browser_version', APP_VERSION)
  p.add('browser_online', 'true').add('tz_name', 'Etc/GMT-8').add('cursor', fetched.cursor ?? '').add('internal_ext', fetched.internalExt ?? '')
  p.add('host', LIVE).add('aid', '6383').add('live_id', '1').add('did_rule', '3').add('endpoint', 'live_pc').add('support_wrds', '1')
  p.add('user_unique_id', info.user_id).add('im_path', '/webcast/im/fetch/').add('identity', 'audience').add('need_persist_msg_count', '15')
  p.add('insert_task_id', '').add('live_reason', '').add('room_id', info.room_id).add('heartbeatDuration', '0')
  p.add('signature', liveSignature(d.xb, info.room_id, info.user_id))
  return {
    url: `wss://webcast100-ws-web-hl.douyin.com/webcast/im/push/v2/?${urlencode(p.pairs())}`,
    headers: {
      Pragma: 'no-cache',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'User-Agent': PROFILE.ua,
      'Cache-Control': 'no-cache',
      Cookie: d.cookieStr,
      Origin: LIVE,
    },
  }
}

const LIVE_TYPES: Record<string, string> = {
  WebcastChatMessage: 'ChatMessage',
  WebcastGiftMessage: 'GiftMessage',
  WebcastMemberMessage: 'MemberMessage',
  WebcastLikeMessage: 'LikeMessage',
  WebcastSocialMessage: 'SocialMessage',
  WebcastRoomStatsMessage: 'RoomStatsMessage',
}

/** 一帧推送 → 事件；需要 ack 时返回 ack 帧（上游 on_message）。 */
export function liveFrame(raw: Uint8Array): { events: Event[]; ack: Uint8Array | null } {
  const t = proto.type('Live', 'PushFrame')
  const frame = t.decode(raw) as any
  if (frame.payloadType === 'hb' || frame.payloadType === 'ack' || !frame.payload?.length) return { events: [], ack: null }
  const res = proto.decode('Live', 'LiveResponse', proto.inflate(frame.payload))
  const ack = res.needAck ? t.encode(t.fromObject({ payloadType: 'ack', payload: Buffer.from(String(res.internalExt ?? ''), 'utf8'), logId: frame.logId })).finish() : null
  const events: Event[] = []
  for (const item of res.messagesList ?? []) {
    const name = LIVE_TYPES[item.method]
    if (!name) continue
    const event = norm.liveEvent(item.method, proto.decode('Live', name, item.payload))
    if (event) events.push(event)
  }
  return { events, ack }
}

export const heartbeatFrame = () => proto.encode('Live', 'PushFrame', { payloadType: 'hb' })

export function listenLive(ctx: HandlerContext, d: Douyin, webRid: string): AsyncIterable<Event> {
  return reconnecting(ctx, async function* () {
    const info = await api.liveInfo(d, webRid)
    if (!info) throw new Error(`未能解析直播间信息：${webRid}`)
    const s = await liveSocket(d, info, webRid)
    const socket = await openSocket(s.url, { headers: s.headers, proxy: ctx.config.proxy ?? undefined, signal: ctx.signal })
    const beat = setInterval(() => void socket.send(heartbeatFrame()).catch(() => {}), 5000).unref()
    try {
      for await (const raw of socket.messages) {
        if (typeof raw === 'string') continue
        try {
          const { events, ack } = liveFrame(raw)
          if (ack) await socket.send(ack).catch(() => {})
          yield* events
        } catch (err) {
          ctx.log.debug(`解析直播消息失败：${(err as Error).message}`)
        }
      }
    } finally {
      clearInterval(beat)
      socket.close()
    }
  })
}

// ================================================================ 私信

/** frontier-im 的 wss 地址与握手头（上游 DouyinRecvMsg）。 */
export async function frontierSocket(d: Douyin): Promise<LiveSocket> {
  const deviceId = await api.deviceId(d)
  return {
    url: frontierUrl(String(deviceId), d.cookie('sessionid') ?? ''),
    headers: {
      Pragma: 'no-cache',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'User-Agent': PROFILE.ua,
      'Cache-Control': 'no-cache',
      'Sec-WebSocket-Protocol': 'binary, base64, pbbp2',
      Cookie: d.cookieStr,
      Origin: WWW,
    },
  }
}

const MSG_TYPES: Record<number, Message['type']> = { 7: 'text', 27: 'image', 30: 'video', 8: 'card', 77: 'card', 25: 'card', 26: 'card' }

/** 新消息推送 → Message；已读回执等返回 null（上游 on_message）。 */
export function imFrame(raw: Uint8Array): Message | null {
  const frame = proto.decode('Live', 'PushFrame', raw)
  if (frame.payloadType !== 'pb' || !frame.payload) return null
  const res = proto.decode('Response', 'Response', frame.payload)
  const m = res.body?.new_message_notify?.message
  if (!m) return null
  const type = Number(m.message_type)
  if (type === 50001) return null
  let content: any = {}
  try {
    content = JSON.parse(m.content ?? '{}')
  } catch {}
  const media: Media[] = []
  const url = (x: any) => n.url(x?.origin_url_list?.[0] ?? x?.url_list?.[0])
  if (type === 27 && url(content.resource_url)) media.push(n.media({ type: 'image', url: url(content.resource_url)! }))
  if (type === 5 && url(content.url)) media.push(n.media({ type: 'image', url: url(content.url)! }))
  if (type === 17 && url(content.resource_url)) media.push(n.media({ type: 'audio', url: url(content.resource_url)! }))
  return n.message(
    {
      id: n.id(m.server_message_id),
      conversation_id: String(m.conversation_id ?? ''),
      from: n.userRef({ id: m.sender }),
      type: MSG_TYPES[type] ?? 'other',
      text: type === 7 ? n.str(content.text) : type === 8 ? n.str(content.itemId) : null,
      media,
    },
    m,
  )
}

export function listenMessages(ctx: HandlerContext, d: Douyin): AsyncIterable<Message> {
  return reconnecting(ctx, async function* () {
    const s = await frontierSocket(d)
    const socket = await openSocket(s.url, { headers: s.headers, proxy: ctx.config.proxy ?? undefined, signal: ctx.signal })
    try {
      for await (const raw of socket.messages) {
        if (typeof raw === 'string') continue
        try {
          const msg = imFrame(raw)
          if (msg) yield msg
        } catch (err) {
          ctx.log.debug(`解析私信推送失败：${(err as Error).message}`)
        }
      }
    } finally {
      socket.close()
    }
  })
}
