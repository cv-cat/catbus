import * as norm from '../../../core/normalize.js'
import type { Media, UserRef } from '../../../core/schemas.js'
import { type Json, object, ORIGIN } from './client.js'

export function userRef(data: Json): UserRef | null {
  if (data.id == null || !/^\d+$/.test(String(data.id))) return null
  return norm.userRef({ id: data.id, name: data.global_name ?? data.username, url: `${ORIGIN}/users/${String(data.id)}` })
}

export function user(data: Json, raw: unknown = data) {
  const ref = userRef(data)
  const avatar = typeof data.avatar === 'string' && /^[\w-]+$/.test(data.avatar) && ref
    ? `https://cdn.discordapp.com/avatars/${ref.id}/${data.avatar}.${data.avatar.startsWith('a_') ? 'gif' : 'png'}` : null
  return norm.user({ id: ref?.id ?? '', name: ref?.name, handle: norm.str(data.username), avatar, url: ref?.url,
    bio: norm.str(data.bio) }, raw)
}

export function message(data: Json, fallbackChannel?: string, raw: unknown = data) {
  const media: Media[] = []
  for (const entry of Array.isArray(data.attachments) ? data.attachments : []) {
    const a = object(entry)
    const type = typeof a.content_type === 'string' ? a.content_type.split('/')[0] : ''
    if (type !== 'image' && type !== 'video' && type !== 'audio') continue
    media.push({ id: norm.idOrNull(a.id), type, url: norm.str(a.url), width: norm.count(a.width), height: norm.count(a.height), duration: norm.seconds(a.duration_secs) })
  }
  return norm.message({ id: norm.id(data.id), conversation_id: norm.id(data.channel_id ?? fallbackChannel), from: userRef(object(data.author)),
    type: media[0]?.type === 'image' || media[0]?.type === 'video' ? media[0].type : typeof data.content === 'string' && data.content ? 'text' : 'other',
    text: typeof data.content === 'string' ? data.content : null, media, created_at: norm.time(data.timestamp) }, raw)
}

export function conversation(data: Json) {
  const recipients = Array.isArray(data.recipients) ? data.recipients : []
  const last = norm.idOrNull(data.last_message_id)
  return norm.conversation({ id: norm.id(data.id), peer: recipients.length === 1 ? userRef(object(recipients[0])) : null,
    updated_at: last && /^\d{1,20}$/.test(last) ? norm.time(Number((BigInt(last) >> 22n) + 1420070400000n)) : null }, data)
}
