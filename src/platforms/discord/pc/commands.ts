import { createWriteStream } from 'node:fs'
import { link, lstat, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { CatbusError } from '../../../core/errors.js'
import { redact } from '../../../core/log.js'
import { quote } from '../../../core/py.js'
import { hex, now, random } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { paged } from '../../../core/toolkit.js'
import { channelPath, createDm, MAX_UPLOAD_BYTES, messagePath, sendMessage, uploadSlot } from './api.js'
import { cdnRequest, DiscordClient, type Json, object, records, snowflake } from './client.js'
import * as norm from './normalize.js'

export { authLogin, authLogout, authStatus } from './auth.js'
export { gatewayListen, msgListen } from './gateway.js'

type Ctx = HandlerContext
const cid = (ctx: Ctx) => snowflake(ctx.args.channel ?? ctx.args.conversation, '频道 ID')
const mid = (ctx: Ctx) => snowflake(ctx.args.message ?? ctx.options.message, '消息 ID')
const gid = (ctx: Ctx) => snowflake(ctx.args.guild, '服务器 ID')
const text = (ctx: Ctx) => ctx.args.text ?? ''

function displayChannel(data: Json) {
  return { id: String(data.id ?? ''), guild_id: data.guild_id ?? null, name: data.name ?? null, type: data.type ?? null, topic: data.topic ?? null }
}

function displayGuild(data: Json) {
  return { id: String(data.id ?? ''), name: data.name ?? null, icon: data.icon ?? null }
}

export async function userGet(ctx: Ctx) {
  const client = new DiscordClient(ctx)
  const user = ctx.args.user ?? 'me'
  if (user === 'me' || user === '@me') return norm.user(object(await client.request('GET', '/users/@me')))
  const data = object(await client.request('GET', `/users/${snowflake(user, '用户 ID')}/profile`))
  return norm.user({ ...object(data.user), bio: object(data.user_profile).bio ?? object(data.user).bio }, data)
}

export async function accountSettings(ctx: Ctx) {
  return { settings: redact(await new DiscordClient(ctx).request('GET', '/users/@me/settings')) }
}

/** 24 字节 little-endian 布局，来自上游 device.py 的 ClientUUIDGenerator。 */
export function deviceUuid(id: string, randomPrefix: number, timestamp: number): string {
  const bytes = Buffer.alloc(24)
  bytes.writeBigUInt64LE(BigInt(id), 0)
  bytes.writeUInt32LE(randomPrefix >>> 0, 8)
  bytes.writeBigUInt64LE(BigInt(timestamp), 12)
  return bytes.toString('base64')
}

export async function deviceRegister(ctx: Ctx) {
  const me = object(await new DiscordClient(ctx).request('GET', '/users/@me'))
  const id = snowflake(me.id, '用户 ID')
  const old = object(ctx.credential.device.discord)
  if (old.user_id === id && typeof old.client_uuid === 'string' && /^[A-Za-z0-9+/]{32}$/.test(old.client_uuid)) {
    return { id, client_uuid: old.client_uuid }
  }
  const randomPrefix = Math.floor(random() * 2 ** 32)
  const timestamp = now()
  const clientUuid = deviceUuid(id, randomPrefix, timestamp)
  ctx.credential.device.discord = { user_id: id, client_uuid: clientUuid, random_prefix: randomPrefix | 0, creation_time: timestamp, sequence: 1 }
  return { id, client_uuid: clientUuid }
}

export async function guildList(ctx: Ctx) {
  const limit = 200
  const after = ctx.cursor ? snowflake(ctx.cursor, '服务器游标') : undefined
  const list = records(await new DiscordClient(ctx).request('GET', '/users/@me/guilds', { query: { limit, after } }))
  return paged(list.map(displayGuild), String(list.at(-1)?.id ?? '') || null, list.length === limit)
}

export async function guildGet(ctx: Ctx) {
  return displayGuild(object(await new DiscordClient(ctx).request('GET', `/guilds/${gid(ctx)}`, { query: { with_counts: 'true' } })))
}

export async function guildLeave(ctx: Ctx) {
  const id = gid(ctx)
  await new DiscordClient(ctx).request('DELETE', `/users/@me/guilds/${id}`)
  return { id }
}

export async function channelList(ctx: Ctx) {
  return records(await new DiscordClient(ctx).request('GET', `/guilds/${gid(ctx)}/channels`)).map(displayChannel)
}

export async function channelGet(ctx: Ctx) {
  return displayChannel(object(await new DiscordClient(ctx).request('GET', channelPath(cid(ctx)))))
}

function channelName(value: string | undefined): string {
  if (!value || [...value].length > 100 || value === '.' || value === '..') throw new CatbusError('USAGE', '频道名称必须为 1 至 100 字符')
  return value
}

export async function channelCreate(ctx: Ctx) {
  const json: Json = { name: channelName(ctx.args.name), type: ctx.options.channelType ?? 0 }
  if (ctx.options.channelTopic !== undefined) json.topic = ctx.options.channelTopic
  if (ctx.options.parent !== undefined) json.parent_id = snowflake(ctx.options.parent, '父频道 ID')
  if (ctx.options.channelPosition !== undefined) json.position = ctx.options.channelPosition
  return displayChannel(object(await new DiscordClient(ctx).request('POST', `/guilds/${gid(ctx)}/channels`, { json })))
}

export async function channelUpdate(ctx: Ctx) {
  const json: Json = {}
  if (typeof ctx.options.name === 'string') json.name = channelName(ctx.options.name)
  if (ctx.options.channelTopic !== undefined) json.topic = ctx.options.channelTopic
  return displayChannel(object(await new DiscordClient(ctx).request('PATCH', channelPath(cid(ctx)), { json })))
}

export async function channelDelete(ctx: Ctx) {
  const id = cid(ctx)
  await new DiscordClient(ctx).request('DELETE', channelPath(id))
  return { id }
}

export async function msgList(ctx: Ctx) {
  return records(await new DiscordClient(ctx).request('GET', '/users/@me/channels')).map(norm.conversation)
}

export async function msgHistory(ctx: Ctx) {
  const id = cid(ctx)
  const limit = 50
  const before = ctx.cursor ? snowflake(ctx.cursor, '消息游标') : undefined
  const list = records(await new DiscordClient(ctx).request('GET', `${channelPath(id)}/messages`, { query: { limit, before } }))
  return paged(list.map((item) => norm.message(item, id)), String(list.at(-1)?.id ?? '') || null, list.length === limit)
}

export async function msgGet(ctx: Ctx) {
  const channel = cid(ctx)
  return norm.message(object(await new DiscordClient(ctx).request('GET', messagePath(channel, mid(ctx)))), channel)
}

export async function msgSend(ctx: Ctx) {
  const client = new DiscordClient(ctx)
  const message = text(ctx)
  if ([...message].length > 2000) throw new CatbusError('USAGE', '消息不能超过 2000 字符')
  const reply = ctx.options.replyTo === undefined ? undefined : snowflake(ctx.options.replyTo, '回复消息 ID')
  const file = typeof ctx.options.file === 'string' ? ctx.options.file : undefined
  let bytes: Uint8Array | undefined
  if (file) {
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size > MAX_UPLOAD_BYTES) throw new CatbusError('USAGE', '附件必须是 25 MiB 以内的普通文件')
      bytes = await readFile(file)
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new CatbusError('USAGE', '附件不能超过 25 MiB')
    } catch (error) {
      if (error instanceof CatbusError) throw error
      throw new CatbusError('USAGE', '无法读取附件文件')
    }
  }
  if (!message && !bytes) throw new CatbusError('USAGE', '消息或附件至少给一个')
  const channel = ctx.options.conversation != null ? snowflake(ctx.options.conversation, '频道 ID') : await createDm(client, snowflake(ctx.options.to, '用户 ID'))
  const attachment = file && bytes ? await uploadSlot(ctx, client, channel, basename(file), bytes) : undefined
  return norm.message(await sendMessage(client, channel, message, { reply, attachment }), channel)
}

export async function msgUpdate(ctx: Ctx) {
  const id = cid(ctx)
  const content = text(ctx)
  if ([...content].length > 2000) throw new CatbusError('USAGE', '消息不能超过 2000 字符')
  return norm.message(object(await new DiscordClient(ctx).request('PATCH', messagePath(id, mid(ctx)), { json: { content } })), id)
}

export async function msgRevoke(ctx: Ctx) {
  const id = mid(ctx)
  await new DiscordClient(ctx).request('DELETE', messagePath(cid(ctx), id))
  return { id }
}

export async function msgPurge(ctx: Ctx) {
  const ids = (ctx.args.messages ?? '').split(',').map((id) => snowflake(id.trim(), '消息 ID'))
  if (ids.length < 2 || ids.length > 100 || new Set(ids).size !== ids.length) throw new CatbusError('USAGE', '批量删除需要 2 至 100 个不同的消息 ID')
  await new DiscordClient(ctx).request('POST', `${channelPath(cid(ctx))}/messages/bulk-delete`, { json: { messages: ids } })
  return { ids }
}

export async function msgTyping(ctx: Ctx) {
  const id = cid(ctx)
  await new DiscordClient(ctx).request('POST', `${channelPath(id)}/typing`)
  return { id }
}

export async function msgRead(ctx: Ctx) {
  const id = mid(ctx)
  const device = ctx.credential.device
  const ackToken = typeof device.discord_ack_token === 'string' ? device.discord_ack_token : null
  const data = object(await new DiscordClient(ctx).request('POST', `${messagePath(cid(ctx), id)}/ack`, {
    json: { token: ackToken, last_viewed: null },
  }))
  if (typeof data.token === 'string') device.discord_ack_token = data.token
  return { id }
}

export async function msgPins(ctx: Ctx) {
  const id = cid(ctx)
  const result = await new DiscordClient(ctx).request('GET', `${channelPath(id)}/messages/pins`, { query: { limit: 25 } })
  const data = Array.isArray(result) ? result : object(result).items
  return records(data).map((entry) => norm.message(entry.message ? object(entry.message) : entry, id))
}

async function setPin(ctx: Ctx, method: 'PUT' | 'DELETE') {
  const id = mid(ctx)
  await new DiscordClient(ctx).request(method, `${channelPath(cid(ctx))}/messages/pins/${id}`)
  return { id }
}

export const msgPin = (ctx: Ctx) => setPin(ctx, 'PUT')
export const msgUnpin = (ctx: Ctx) => setPin(ctx, 'DELETE')

function reactionBase(ctx: Ctx): string {
  return `${messagePath(cid(ctx), mid(ctx))}/reactions`
}

function emoji(ctx: Ctx, safe = ''): string {
  const value = ctx.args.emoji
  if (!value || value === '.' || value === '..' || /[\/\\\x00-\x1f]/.test(value)) throw new CatbusError('USAGE', 'Emoji 无效')
  return quote(value, safe)
}

export async function reactionList(ctx: Ctx) {
  const limit = 25
  const after = ctx.cursor ? snowflake(ctx.cursor, '反应用户游标') : undefined
  const data = records(await new DiscordClient(ctx).request('GET', `${reactionBase(ctx)}/${emoji(ctx)}`, { query: { limit, after } }))
  return paged(data.map((u) => norm.user(u)), String(data.at(-1)?.id ?? '') || null, data.length === limit)
}

export async function reactionAdd(ctx: Ctx) {
  await new DiscordClient(ctx).request('PUT', `${reactionBase(ctx)}/${emoji(ctx, ':')}/@me`, { query: { location: 'Message', type: 0 } })
  return { id: mid(ctx) }
}

export async function reactionDelete(ctx: Ctx) {
  const target = ctx.options.userId === undefined ? '@me' : snowflake(ctx.options.userId, '用户 ID')
  await new DiscordClient(ctx).request('DELETE', `${reactionBase(ctx)}/${emoji(ctx, target === '@me' ? ':' : '')}/${target}`)
  return { id: mid(ctx) }
}

export async function reactionClear(ctx: Ctx) {
  const path = `${reactionBase(ctx)}${ctx.args.emoji === undefined ? '' : `/${emoji(ctx)}`}`
  await new DiscordClient(ctx).request('DELETE', path)
  return { id: mid(ctx) }
}

export async function friendAdd(ctx: Ctx) {
  const target = ctx.args.target ?? ''
  const client = new DiscordClient(ctx)
  if (/^\d+$/.test(target)) {
    const id = snowflake(target, '用户 ID')
    await client.request('PUT', `/users/@me/relationships/${id}`, { captcha: true })
    return { id }
  }
  const [username, discriminator, ...extra] = target.split('#')
  if (!username || extra.length || (discriminator !== undefined && !/^\d{4}$/.test(discriminator))) throw new CatbusError('USAGE', 'Discord 用户名格式无效')
  await client.request('POST', '/users/@me/relationships', { captcha: true, json: { username, ...(discriminator ? { discriminator } : {}) } })
  return { id: null, target }
}

async function friendMutation(ctx: Ctx, method: 'PUT' | 'DELETE', suffix = '') {
  const id = snowflake(ctx.args.user, '用户 ID')
  await new DiscordClient(ctx).request(method, `/users/@me/relationships/${id}${suffix}`)
  return { id }
}

export const friendDelete = (ctx: Ctx) => friendMutation(ctx, 'DELETE')
export const friendAccept = (ctx: Ctx) => friendMutation(ctx, 'PUT', '/accept')
export const friendBlock = (ctx: Ctx) => friendMutation(ctx, 'PUT', '/block')
export const friendUnblock = (ctx: Ctx) => friendMutation(ctx, 'DELETE', '/block')

export async function attachmentDownload(ctx: Ctx) {
  const input = ctx.args.url ?? ''
  let filename: string
  try {
    filename = basename(decodeURIComponent(new URL(input).pathname)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/, '')
  } catch { throw new CatbusError('USAGE', '附件地址无效') }
  if (!filename || filename === '.' || filename === '..') filename = 'attachment'
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(filename)) filename = `_${filename}`
  const dir = resolve(String(ctx.options.dir ?? '.'))
  const path = join(dir, filename)
  const existing = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (existing && !ctx.options.overwrite) {
    if (!existing.isFile()) throw new CatbusError('USAGE', '附件目标不是普通文件')
    return { path, filename, size: existing.size }
  }
  await mkdir(dir, { recursive: true })
  const response = await cdnRequest(ctx, 'GET', input)
  const temp = join(dir, `.discord-${hex(12)}.part`)
  try {
    const source = response.body ? Readable.fromWeb(response.body as unknown as NodeReadableStream) : Readable.from([Buffer.from(await response.arrayBuffer())])
    await pipeline(source, createWriteStream(temp, { flags: 'wx', mode: 0o600 }))
    if (ctx.options.overwrite) await rename(temp, path)
    else await link(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
  return { path, filename, size: (await stat(path)).size }
}

export async function gatewayGet(ctx: Ctx) {
  const data = object(await new DiscordClient(ctx).request('GET', '/gateway', { auth: false }))
  return { url: typeof data.url === 'string' ? data.url : null }
}
