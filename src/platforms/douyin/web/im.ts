import { CatbusError } from '../../../core/errors.js'
import type { LocalMedia } from '../../../core/files.js'
import { compactJson, parseQsl, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type Douyin, type DyJson, riskJson } from './client.js'
import { crc32Hex, ecdsaSign, sigv4, type Sts, VOD_HOST } from './crypto.js'
import { imageSize } from './image.js'
import * as proto from './proto.js'
import { APP_VERSION, headers, Params, platformParams, PROFILE, WWW } from './profile.js'
import { md5Hex, spliceUrl } from './sign.js'

/**
 * PC 私信（上游 builder/proto.py、DouyinAPI.create_conversation / get_identity_security_token / _send_message_raw、
 * dy_apis/douyin_im_media.py、dy_apis/douyin_recv_msg.py）。
 */

const IMAPI = 'https://imapi.douyin.com'
const SDK_VERSION = '0.1.8'
const BUILD_NUMBER = '0d50935:feat/pc-im-groupB'
const IM_REFERER = `${WWW}/chat?isPopup=1`

export const IM_TEXT = 7
export const IM_STORY_PICTURE = 27
export const IM_STORY_VIDEO = 30
export const IM_FILE = 6
export const IM_SHARE_AWEME = 8
export const IM_SHARE_PHOTOS = 77
export const IM_SHARE_WEB = 26
export const IM_SHARE_USER = 25

/** 上游 ProtoBuilder.build_normal_request（proto3 的零值字段不写）。 */
function normalRequest(cmd: number): Record<string, any> {
  return {
    cmd,
    sequence_id: rand.randint(10000, 11000),
    sdk_version: SDK_VERSION,
    refer: 3,
    build_number: BUILD_NUMBER,
    device_id: '0',
    device_platform: 'douyin_pc',
    version_code: '360000',
    headers: {
      session_aid: '6383',
      session_did: '0',
      app_name: 'douyin_pc',
      priority_region: 'cn',
      user_agent: PROFILE.ua,
      cookie_enabled: 'true',
      browser_language: 'zh-CN',
      browser_platform: 'Win32',
      browser_name: 'Mozilla',
      browser_version: APP_VERSION,
      browser_online: 'true',
      screen_width: PROFILE.screenWidth,
      screen_height: PROFILE.screenHeight,
      referer: `${WWW}/jingxuan`,
      timezone_name: 'Asia/Shanghai',
      deviceId: '0',
      'is-retry': '0',
    },
    auth_type: 4,
    biz: 'douyin_web',
    access: 'web_sdk',
  }
}

function protoHeaders() {
  return headers('PROTOBUF').set('referer', `${WWW}/`)
}

export interface Conversation {
  conversationId: string
  shortId: string
  ticket: string
}

/** 建立（或取回）与某个用户的单聊会话（上游 create_conversation）。 */
export async function createConversation(d: Douyin, toUid: string): Promise<Conversation> {
  const myUid = await d.uid()
  const req = normalRequest(609)
  req.body = { create_conversation_v2_body: { conversation_type: 1, participants: [toUid, myUid] } }
  const prv = d.privateKey
  if (!prv) throw new CatbusError('AUTH_REQUIRED', '私信需要 bd-ticket-guard 私钥，请重新扫码登录')
  req.reuqest_sign = ecdsaSign(compactJson({ sign_data: `avatar_url=&idempotent_id=&name=&participants=${toUid},${myUid}`, certType: 'cookie', scene: 'web_protect' }), prv)
  const res = await d.request({ method: 'POST', url: `${IMAPI}/v2/conversation/create`, headers: protoHeaders().list(), body: proto.encode('Request', 'Request', req) })
  const body = proto.decode('Response', 'Response', new Uint8Array(await res.arrayBuffer()))
  const conv = body.body?.create_conversation_v2_body?.conversation_info_list?.[0]
  if (!conv) throw new CatbusError('UPSTREAM', `创建私信会话失败：${body.error_desc || body.message || ''}`, { detail: { cmd: body.cmd, message: body.message } })
  return { conversationId: conv.conversation_id, shortId: String(conv.conversation_short_id), ticket: conv.ticket }
}

/** 私信发送前要取的短时身份安全 token，缓存 240 秒（上游 get_identity_security_token）。 */
export async function identityToken(d: Douyin, force = false): Promise<{ token: string; deviceId: string }> {
  const cached = d.identity
  if (cached?.token && !force && rand.now() - cached.at < 240_000) return cached
  const api = '/passport/safe/get_identity_security_token/'
  const trace = rand.uuid4().replaceAll('-', '').slice(0, 8)
  const p = new Params()
  p.add('passport_jssdk_version', '4.2.3').add('passport_jssdk_type', 'lite').add('is_from_ttaccountsdk', '1').add('aid', '6383').add('language', 'zh')
  p.add('scene', 'web_im').add('auto_retry_req', '0').add('skip_verify', 'false').add('identity_token_force_get_tag', '0').add('biz_trace_id', trace)
  p.add('id_token_version', '1.2.10').add('msToken', await d.msToken())
  p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs())))
  const h = headers('GET').referer(IM_REFERER).set('accept', 'application/json, text/javascript')
  h.set('x-tt-passport-csrf-token', d.cookie('passport_csrf_token') || d.cookie('passport_csrf_token_default') || '')
  h.set('x-tt-passport-trace-id', trace)
  await d.withBd(h, api)
  const body = await riskJson(await d.request({ url: WWW + api, headers: h.list(), query: p.pairs() }))
  const data = body.data ?? {}
  const token = String(data.identity_security_token ?? '')
  if ((body.message != null && body.message !== 'success') || !token) {
    throw new CatbusError('RISK_CONTROL', `身份安全 token 获取失败：${data.description ?? body.message ?? ''}`, { detail: { kind: 'blocked', error_code: data.error_code ?? null } })
  }
  d.identity = { token, deviceId: String(data.device_id ?? ''), at: rand.now() }
  return d.identity
}

/** 发一条已经构造好的私信（上游 _send_message_raw），返回 client_message_id。 */
export async function sendMessage(d: Douyin, conv: Conversation, messageType: number, content: unknown): Promise<string> {
  const h = protoHeaders()
  await d.withBd(h, '/v1/message/send')
  const identity = await identityToken(d)
  const clientMessageId = rand.uuid4()
  const req = normalRequest(100)
  req.body = {
    send_message_body: {
      conversation_id: conv.conversationId,
      conversation_type: 1,
      conversation_short_id: conv.shortId,
      content: typeof content === 'string' ? content : compactJson(content),
      ext: [
        { key: 's:mentioned_users', value: '' },
        { key: 's:client_message_id', value: clientMessageId },
        { key: 's:stime', value: `${rand.now()}.${String(Math.floor(rand.random() * 100000)).padStart(5, '0')}` },
      ],
      message_type: messageType,
      ticket: conv.ticket,
      client_message_id: clientMessageId,
    },
  }
  if (identity.token) req.headers.identity_security_token = compactJson({ token: identity.token })
  if (identity.deviceId) req.headers.identity_security_device_id = identity.deviceId
  req.headers.identity_security_aid = ''
  const p = new Params().add('msToken', await d.msToken())
  p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs())))
  const fp = d.cookie('s_v_web_id') ?? ''
  p.add('verifyFp', fp).add('fp', fp)
  const res = await d.request({ method: 'POST', url: `${IMAPI}/v1/message/send`, headers: h.list(), query: p.pairs(), body: proto.encode('Request', 'Request', req) })
  const body = proto.decode('Response', 'Response', new Uint8Array(await res.arrayBuffer()))
  if (body.message !== 'OK') throw new CatbusError('UPSTREAM', `私信发送失败：${body.error_desc || body.message || ''}`, { detail: { message: body.message ?? null, error: body.error_desc ?? null } })
  return clientMessageId
}

/** 文本私信的 content（上游 send_msg）。 */
export const textContent = (text: string) => ({ aweType: 700, type: 0, richTextInfos: [], text })

// ================================================================ 富媒体上传（douyin_im_media.py）

const UPLOAD_CONFIG_PATH = '/aweme/v1/web/im/upload/config/v2'
const VOD_VERSION = '2020-11-19'
const DIRECT_LIMIT = 3 * 1024 * 1024
const MB = 1024 * 1024

interface ImSts extends Sts {
  space_name: string
  expire_at: number
}

function normalizeSts(cfg: any): ImSts {
  const pick = (...names: string[]) => String(names.map((n) => cfg?.[n]).find((v) => v) ?? '')
  const out = {
    AccessKeyID: pick('access_key_id', 'AccessKeyID', 'AccessKeyId'),
    SecretAccessKey: pick('secret_access_key', 'SecretAccessKey'),
    SessionToken: pick('session_token', 'SessionToken'),
    space_name: pick('space_name', 'SpaceName'),
    expire_at: Number(cfg?.expire_at ?? cfg?.ExpiredTime ?? 0) || 0,
  }
  if (!out.AccessKeyID || !out.SecretAccessKey || !out.SessionToken || !out.space_name) throw new CatbusError('UPSTREAM', 'IM 上传凭证字段不完整')
  return out
}

/** 取四组 IM 上传 STS（上游 get_upload_config）。 */
export async function uploadConfig(d: Douyin): Promise<Record<string, ImSts>> {
  const h = headers('GET').referer(IM_REFERER)
  await d.withBd(h, UPLOAD_CONFIG_PATH)
  const p = new Params().update(platformParams())
  p.add('webid', await d.webid())
  const uifid = d.cookie('UIFID')
  if (uifid) p.add('uifid', uifid)
  const fp = d.cookie('s_v_web_id')
  if (fp) p.add('verifyFp', fp).add('fp', fp)
  p.add('msToken', await d.msToken())
  p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs())))
  const body = await riskJson(await d.request({ url: WWW + UPLOAD_CONFIG_PATH, headers: h.list(), query: p.pairs() }))
  if (body.status_code != null && body.status_code !== 0) throw new CatbusError('UPSTREAM', `获取 IM 上传配置失败：${body.status_msg ?? body.status_code}`)
  const out: Record<string, ImSts> = {}
  for (const name of ['public_image_config', 'inner_image_config', 'public_file_config', 'public_image_config_v2']) if (body[name]) out[name] = normalizeSts(body[name])
  if (!out.public_image_config || !out.inner_image_config || !out.public_file_config) throw new CatbusError('UPSTREAM', '获取 IM 上传配置字段缺失')
  return out
}

function gatewayHeaders(sign: Record<string, string>, contentType?: string): [string, string][] {
  const h: Record<string, string> = {
    accept: '*/*',
    'accept-language': PROFILE.acceptLanguage,
    origin: WWW,
    referer: `${WWW}/`,
    'user-agent': PROFILE.ua,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
    ...sign,
  }
  if (contentType) h['content-type'] = contentType
  return Object.entries(h)
}

interface Node {
  store_uri: string
  auth: string
  upload_id: string
  upload_host: string
  session_key: string
  upload_header: Record<string, string>
}

async function applyUpload(d: Douyin, sts: ImSts, fileType: string, size: number, gcm = false): Promise<Node> {
  const query: [string, string | number][] = [
    ['Action', 'ApplyUploadInner'],
    ['Version', VOD_VERSION],
    ['SpaceName', sts.space_name],
    ['FileType', fileType],
    ['IsInner', 1],
    ['NeedFallback', 'true'],
    ['FileSize', size],
  ]
  if (gcm) query.push(['OpenGcmEnc', 'true'])
  const res = await d.plain({ url: `https://${VOD_HOST}/`, headers: gatewayHeaders(sigv4(sts, 'GET', query, '', 'vod')), query })
  const body = JSON.parse(await res.text())
  const node = body.Result?.InnerUploadAddress?.UploadNodes?.[0]
  const store = node?.StoreInfos?.[0]
  if (!store) throw new CatbusError('UPSTREAM', `ApplyUploadInner(${fileType}) 失败`, { detail: { error: body.ResponseMetadata?.Error ?? null } })
  return { store_uri: store.StoreUri ?? '', auth: store.Auth ?? '', upload_id: store.UploadID ?? '', upload_host: node.UploadHost ?? '', session_key: node.SessionKey ?? '', upload_header: node.UploadHeader ?? {} }
}

function tosHeaders(node: Node, userId: string, crc?: string): [string, string][] {
  const h: Record<string, string> = {
    authorization: node.auth,
    referer: `${WWW}/`,
    'user-agent': PROFILE.ua,
    'x-storage-u': encodeURIComponent(userId),
    'content-type': 'application/octet-stream',
    accept: '*/*',
    'accept-language': PROFILE.acceptLanguage,
    origin: WWW,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  }
  if (crc != null) h['content-crc32'] = crc
  return Object.entries({ ...h, ...node.upload_header })
}

async function tosPost(d: Douyin, url: string, h: [string, string][], data?: Uint8Array): Promise<any> {
  const res = await d.plain({ method: 'POST', url, headers: h, body: data ?? '', timeout: 300 })
  let body: any
  try {
    body = JSON.parse(await res.text())
  } catch {
    throw new CatbusError('UPSTREAM', `IM TOS 返回的不是 JSON（HTTP ${res.status}）`)
  }
  if (![undefined, null, 2000, '2000'].includes(body.code)) throw new CatbusError('UPSTREAM', `IM TOS 上传失败：${body.message ?? body.code}`)
  return body
}

async function uploadSource(d: Douyin, node: Node, data: Uint8Array, userId: string): Promise<void> {
  const base = `https://${node.upload_host}/upload/v1/${node.store_uri}`
  if (data.length <= DIRECT_LIMIT) {
    await tosPost(d, base, tosHeaders(node, userId, crc32Hex(data)), data)
    return
  }
  let uploadId = node.upload_id
  if (!uploadId) {
    const init = await tosPost(d, `${base}?uploadmode=part&phase=init`, tosHeaders(node, userId))
    uploadId = init.data?.uploadid
    if (!uploadId) throw new CatbusError('UPSTREAM', 'IM 分片初始化失败')
  }
  const partSize = Math.max(data.length >= 500 * MB ? 10 * MB : data.length >= 100 * MB ? 5 * MB : 3 * MB, 5 * MB)
  const crcs: string[] = []
  for (let offset = 0, part = 1; offset < data.length; offset += partSize, part++) {
    const chunk = data.subarray(offset, offset + partSize)
    const crc = crc32Hex(chunk)
    await tosPost(d, `${base}?uploadid=${encodeURIComponent(uploadId)}&part_number=${part}&phase=transfer&part_offset=${offset}`, tosHeaders(node, userId, crc), chunk)
    crcs.push(crc)
  }
  await tosPost(
    d,
    `${base}?uploadmode=part&phase=finish&uploadid=${encodeURIComponent(uploadId)}`,
    tosHeaders(node, userId),
    Buffer.from(crcs.map((c, i) => `${i + 1}:${c}`).join(',')),
  )
}

async function commitUpload(d: Douyin, sts: ImSts, node: Node, functions: unknown[] = []): Promise<any> {
  const body = compactJson({ SessionKey: node.session_key, Functions: functions })
  const query: [string, string][] = [
    ['Action', 'CommitUploadInner'],
    ['Version', VOD_VERSION],
    ['SpaceName', sts.space_name],
  ]
  const res = await d.plain({ method: 'POST', url: `https://${VOD_HOST}/`, headers: gatewayHeaders(sigv4(sts, 'POST', query, body, 'vod'), 'text/plain;charset=UTF-8'), query, body })
  const payload = JSON.parse(await res.text())
  const item = payload.Result?.Results?.[0] ?? payload.Result
  if (!item) throw new CatbusError('UPSTREAM', 'CommitUploadInner 失败', { detail: { error: payload.ResponseMetadata?.Error ?? null } })
  return item
}

/** 上传一张图并返回 type 27 的 content（上游 upload_image）。 */
export async function uploadImage(d: Douyin, file: LocalMedia, config?: Record<string, ImSts>): Promise<Record<string, unknown>> {
  const userId = await d.uid().catch(() => '')
  const gif = file.filename.toLowerCase().endsWith('.gif')
  const cfg = config ?? (await uploadConfig(d))
  const sts = cfg.public_image_config!
  const policy = gif ? { 'policy-set': 'still', 'still-width': '480', 'still-height': '480' } : { 'policy-set': 'check,thumb,medium,large' }
  const action = [{ name: 'Encryption', input: { Config: { copies: 'cipher_v2' } }, PolicyParams: policy }]
  const node = await applyUpload(d, sts, 'image', file.data.length)
  await uploadSource(d, node, file.data, userId)
  const item = await commitUpload(d, sts, node, action)
  const enc = item.Encryption ?? {}
  const extra = enc.Extra ?? {}
  const size = imageSize(file.data)
  const md5 = enc.SourceMd5 ?? item.SourceMd5 ?? ''
  return {
    resource_url: { oid: enc.Uri ?? item.Uri ?? '', skey: enc.SecretKey ?? item.SecretKey ?? '', data_size: Number(extra.img_size ?? file.data.length) || file.data.length, md5 },
    cover_height: Number(extra.img_height ?? size.height) || size.height,
    cover_width: Number(extra.img_width ?? size.width) || size.width,
    check_pics: [],
    md5,
    from_gallery: 1,
    aweType: gif ? 2703 : 2702,
  }
}

/** 上传视频（封面走 inner 空间，不加密）并返回 type 30 的 content（上游 upload_video）。 */
export async function uploadVideo(d: Douyin, video: LocalMedia, cover: LocalMedia): Promise<Record<string, unknown>> {
  const userId = await d.uid().catch(() => '')
  const cfg = await uploadConfig(d)
  const publicSts = cfg.public_image_config!
  const innerSts = { ...publicSts, space_name: cfg.inner_image_config!.space_name }
  const coverNode = await applyUpload(d, innerSts, 'image', cover.data.length)
  await uploadSource(d, coverNode, cover.data, userId)
  const coverItem = await commitUpload(d, innerSts, coverNode)
  const coverUri = coverItem.Encryption?.Uri ?? coverItem.Uri ?? coverItem.uri ?? ''
  const action = [{ name: 'Encryption', input: { Config: { copies: 'cipher_v2', aes_chunk_size: '524288' } }, PolicyParams: { 'policy-set': 'medium' } }]
  const node = await applyUpload(d, publicSts, 'video', video.data.length)
  await uploadSource(d, node, video.data, userId)
  const item = await commitUpload(d, publicSts, node, action)
  const enc = item.Encryption ?? {}
  const extra = enc.Extra ?? {}
  const meta = item.VideoMeta ?? item.SourceInfo ?? {}
  return {
    video: { tkey: enc.Uri ?? item.Uri ?? '', md5: enc.SourceMd5 ?? item.SourceMd5 ?? '', skey: enc.SecretKey ?? item.SecretKey ?? '' },
    poster: { oid: extra.thumb_uri || coverUri, md5: extra.thumb_md5 ?? '', skey: extra.thumb_secret ?? '' },
    height: Number(meta.Height ?? 0) || 0,
    width: Number(meta.Width ?? 0) || 0,
    check_pics: coverUri ? [coverUri] : [],
  }
}

/** 私信文件附件的上限（上游 MAX_IM_FILE_SIZE）。 */
export const MAX_IM_FILE = 10 * 1024 * 1024

/** 上传一个文件附件并返回 type 6 的 content（上游 upload_file：public_file_config、object 类型、GCM 加密）。 */
export async function uploadFile(d: Douyin, file: LocalMedia): Promise<Record<string, unknown>> {
  const userId = await d.uid().catch(() => '')
  if (file.data.length > MAX_IM_FILE) throw new CatbusError('USAGE', '抖音私信的文件附件不能超过 10MB')
  const cfg = await uploadConfig(d)
  const sts = cfg.public_file_config!
  const node = await applyUpload(d, sts, 'object', file.data.length, true)
  await uploadSource(d, node, file.data, userId)
  const item = await commitUpload(d, sts, node)
  const enc = item.Encryption ?? {}
  const dot = file.filename.lastIndexOf('.')
  return {
    aweType: 15001,
    name: file.filename,
    data_size: file.data.length,
    md5: enc.SourceMd5 || item.SourceMd5 || '',
    skey: enc.SecretKey || item.SecretKey || '',
    uri: enc.Uri || item.Uri || '',
    format: dot > 0 ? file.filename.slice(dot + 1).toLowerCase() : '',
  }
}

// ================================================================ 分享卡片（douyin_im_media.py 的 build_*_content）

type Obj = Record<string, any>

/** Python 的真值：None、''、0、False、空列表、空字典为假。 */
function truthy(v: unknown): boolean {
  if (v == null || v === '' || v === 0 || v === false) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

/** Python 的 `a or b or c`。 */
function or(...values: unknown[]): any {
  for (const v of values) if (truthy(v)) return v
  return values.at(-1)
}

const isDict = (v: unknown): v is Obj => v != null && typeof v === 'object' && !Array.isArray(v)
const pyInt = (v: unknown) => Math.trunc(Number(v)) || 0
const pyStr = (v: unknown) => (v == null ? '' : String(v))

/** 图片 / 封面值归一成卡片用的 {uri, url_list, width, height}（上游 _url_object）。 */
export function urlObject(value: unknown, width: unknown = 0, height: unknown = 0): Obj {
  if (isDict(value)) {
    const obj: Obj = { ...value }
    let urls = or(obj.url_list, obj.urlList, obj.urls, [])
    urls = typeof urls === 'string' ? [urls] : [...urls]
    const uri = or(obj.uri, obj.url, urls.length ? urls[0] : '')
    obj.uri = or(uri, '')
    obj.url_list = urls.length ? urls : truthy(uri) ? [uri] : []
    if (truthy(width) && !truthy(obj.width)) obj.width = pyInt(width)
    if (truthy(height) && !truthy(obj.height)) obj.height = pyInt(height)
    return obj
  }
  if (Array.isArray(value)) value = value.length ? value[0] : ''
  const s = pyStr(value)
  const obj: Obj = { uri: s, url_list: s ? [s] : [] }
  if (truthy(width)) obj.width = pyInt(width)
  if (truthy(height)) obj.height = pyInt(height)
  return obj
}

function authorValues(detail: Obj): [string, string, string] {
  const author: Obj = isDict(or(detail.author, detail.user, {})) ? or(detail.author, detail.user, {}) : {}
  return [
    pyStr(or(author.uid, author.user_id, detail.uid, detail.profile_uid, '')),
    pyStr(or(author.sec_uid, author.sec_user_id, detail.secUID, detail.sec_uid, '')),
    pyStr(or(author.nickname, author.name, detail.content_name, '')),
  ]
}

/** 卡片封面（上游 _detail_cover）：视频取 video.cover，图文取第一张图。 */
function detailCover(detail: Obj, photos: boolean): [Obj, number, number] {
  const video: Obj = isDict(detail.video) ? detail.video : {}
  let value: unknown
  let width: unknown
  let height: unknown
  if (photos) {
    const images = or(detail.images, detail.image_list, detail.image_infos, [])
    let first: unknown = Array.isArray(images) ? (images.length ? images[0] : {}) : (images ?? {})
    if (!isDict(first)) first = { url_list: first }
    const f = first as Obj
    value = or(f.display_image, f.cover, f)
    width = or(f.width, detail.cover_width, 0)
    height = or(f.height, detail.cover_height, 0)
  } else {
    const cover = or(video.cover, video.origin_cover, {})
    value = or(cover, detail.cover_url, detail.cover, '')
    width = or(video.width, isDict(cover) ? cover.width : 0, detail.cover_width, 0)
    height = or(video.height, isDict(cover) ? cover.height : 0, detail.cover_height, 0)
  }
  if (!truthy(width) && isDict(value)) width = or(value.width, 0)
  if (!truthy(height) && isDict(value)) height = or(value.height, 0)
  return [urlObject(value, width, height), pyInt(or(width, 0)), pyInt(or(height, 0))]
}

const TRACK_KEYS = ['profile_uid', 'profile_sec_uid', 'scene_type', 'send_source', 'publish_way', 'hot_spot_create_time', 'ecom_share_track_params']

function shareCommon(detail: Obj, uid: string, photos: boolean) {
  const [authorUid, authorSecUid, authorName] = authorValues(detail)
  const u = pyStr(or(uid, authorUid, ''))
  const itemId = pyStr(or(detail.aweme_id, detail.itemId, detail.item_id, ''))
  const [cover, width, height] = detailCover(detail, photos)
  const title = pyStr(or(detail.desc, detail.title, detail.content_title, ''))
  const shareId = u && itemId ? `${u}_${Math.trunc(rand.now())}_${itemId}` : ''
  let aiExt = or(detail.ai_ext, '{}')
  if (typeof aiExt === 'object') aiExt = compactJson(aiExt)
  return { uid: u, secUid: pyStr(or(authorSecUid, '')), name: pyStr(or(authorName, '')), itemId, cover, width, height, title, shareId, aiExt }
}

function flags(detail: Obj): Obj {
  return {
    is_aigc: truthy(detail.is_aigc ?? false),
    is_hot_spot_video: truthy(detail.is_hot_spot_video ?? false),
    is_live_photo: pyInt(or(detail.is_live_photo ?? 0, 0)),
    is_slides: truthy(detail.is_slides ?? false),
    is_story: truthy(detail.is_story ?? false),
    is_text: pyInt(or(detail.is_text ?? 0, 0)),
  }
}

function withTrack(payload: Obj, detail: Obj): Obj {
  for (const key of TRACK_KEYS) if (detail[key] != null) payload[key] = detail[key]
  return payload
}

/** 视频分享卡片，type 8（上游 build_share_aweme_content，传作品详情；uid 是分享者自己）。 */
export function shareAwemeContent(detail: Obj, uid: string): Obj {
  const c = shareCommon(detail, uid, false)
  return withTrack(
    {
      aweType: 800,
      awemeType: 0,
      content_name: c.name,
      content_title: c.title,
      content_thumb: { ...c.cover },
      cover_height: c.height,
      cover_url: { ...c.cover },
      cover_width: c.width,
      itemId: c.itemId,
      secUID: c.secUid,
      uid: c.uid,
      share_id: c.shareId,
      share_with_timestamp: 0,
      ...flags(detail),
      create_id: pyStr(or(detail.create_id, '')),
      share_info: or(detail.share_info, []),
      anchor_info: or(detail.anchor_info, {}),
      poi_track_params: or(detail.poi_track_params, {}),
      ai_ext: c.aiExt,
    },
    detail,
  )
}

/** 图文分享卡片，type 77（上游 build_share_photos_content）。 */
export function sharePhotosContent(detail: Obj, uid: string): Obj {
  const c = shareCommon(detail, uid, true)
  const images = or(detail.images, detail.image_list, detail.image_infos, [])
  const imageCount = or(detail.image_count, Array.isArray(images) ? images.length : 0, 1)
  return withTrack(
    {
      aweType: 0,
      awemeType: 68,
      content_name: c.name,
      content_title: c.title,
      content_thumb: { ...c.cover },
      cover_height: c.height,
      cover_url: { ...c.cover },
      cover_url_v2: { ...c.cover },
      cover_width: c.width,
      image_count: pyInt(or(imageCount, 1)),
      image_index: 0,
      itemId: c.itemId,
      secUID: c.secUid,
      uid: c.uid,
      share_id: c.shareId,
      share_with_timestamp: 0,
      ...flags(detail),
      share_info: or(detail.share_info, []),
      anchor_info: or(detail.anchor_info, {}),
      poi_track_params: or(detail.poi_track_params, {}),
      ai_ext: c.aiExt,
    },
    detail,
  )
}

/** 网页卡片，type 26（上游 build_share_web_content）：PC 端只渲染带 pc_iframe_src 的链接，没有就把原链接补进去。 */
export function shareWebContent(url: string): Obj {
  let target = url
  const m = /^([^:/?#]+):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(target)
  if (m) {
    const query = parseQsl(m[4] ?? '')
    if (!query.some(([k, v]) => k === 'pc_iframe_src' && v)) {
      query.push(['pc_iframe_src', target])
      const q = urlencode(query)
      target = `${m[1]}://${m[2]}${m[3]}${q ? `?${q}` : ''}${m[5] ? `#${m[5]}` : ''}`
    }
  }
  return { link_url: target, cover_url: '', title: '', desc: '' }
}

/** 用户名片，type 25（上游 build_user_card_content，content 为空、字段显式给出）。 */
export function userCardContent(u: { uid: string; secUid: string; name: string; avatar: unknown }): Obj {
  return { uid: u.uid, secUID: u.secUid, name: u.name, avatar: urlObject(u.avatar), cover_items: [], cover_url: [] }
}

// ================================================================ 私信长连（douyin_recv_msg.py）

const APP_KEY = 'e1bd35ec9db7b8d846de66ed140b1ad9'
const FP_ID = '9'

/** frontier-im 的 wss 地址：access_key = md5(fpId + appKey + deviceId + 盐)。 */
export function frontierUrl(deviceId: string, sessionid: string): string {
  const accessKey = md5Hex(`${FP_ID}${APP_KEY}${deviceId}f8a69f1719916z`)
  const p = new Params().add('aid', '6383').add('device_platform', 'douyin_pc').add('fpid', FP_ID).add('device_id', deviceId).add('token', sessionid).add('access_key', accessKey)
  return `wss://frontier-im.douyin.com/ws/v2?${p.raw()}`
}

export type { DyJson }
