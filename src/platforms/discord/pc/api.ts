import { CatbusError } from '../../../core/errors.js'
import { uuid4 } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { cdnRequest, DiscordClient, type Json, object, snowflake } from './client.js'

export function channelPath(id: unknown): string {
  return `/channels/${snowflake(id, '频道 ID')}`
}

export function messagePath(channel: unknown, message: unknown): string {
  return `${channelPath(channel)}/messages/${snowflake(message, '消息 ID')}`
}

export async function createDm(client: DiscordClient, user: string): Promise<string> {
  const data = object(await client.request('POST', '/users/@me/channels', { json: { recipients: [snowflake(user, '用户 ID')] } }))
  if (typeof data.id !== 'string') throw new CatbusError('UPSTREAM', 'Discord 未返回私信频道 ID')
  return snowflake(data.id)
}

export async function sendMessage(client: DiscordClient, channel: string, text: string,
  options: { reply?: string; attachment?: Json } = {}): Promise<Json> {
  const path = channelPath(channel)
  if ([...text].length > 2000) throw new CatbusError('USAGE', '消息不能超过 2000 字符')
  let reference: Json | undefined
  if (options.reply) {
    const messageId = snowflake(options.reply, '回复消息 ID')
    const data = object(await client.request('GET', path))
    reference = { ...(typeof data.guild_id === 'string' ? { guild_id: data.guild_id } : {}), channel_id: channel, message_id: messageId }
  }
  const json: Json = { mobile_network_type: 'unknown', content: text, nonce: client.nonce(), tts: false }
  if (reference) json.message_reference = reference
  json.flags = 0
  if (options.attachment) json.attachments = [options.attachment]
  return object(await client.request('POST', `${path}/messages`, { json, context: { location: 'chat_input' } }))
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export async function uploadSlot(ctx: HandlerContext, client: DiscordClient, channel: string,
  filename: string, data: Uint8Array): Promise<Json> {
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new CatbusError('USAGE', '附件不能超过 25 MiB')
  const result = object(await client.request('POST', `${channelPath(channel)}/attachments`, {
    json: { files: [{ filename, file_size: data.byteLength, id: uuid4().replaceAll('-', '').slice(0, 16), description: null }] },
  }))
  const slot = object(Array.isArray(result.attachments) ? result.attachments[0] : null)
  if (typeof slot.upload_url !== 'string' || typeof slot.upload_filename !== 'string') {
    throw new CatbusError('UPSTREAM', 'Discord 未返回完整的附件上传槽位')
  }
  await cdnRequest(ctx, 'PUT', slot.upload_url, data)
  return { id: String(slot.id ?? ''), filename, uploaded_filename: slot.upload_filename }
}
