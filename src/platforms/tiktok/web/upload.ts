import { crc32, deflateRawSync } from 'node:zlib'
import { CatbusError } from '../../../core/errors.js'
import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { UPLOAD_REFERER } from './api.js'
import type { TikTok } from './client.js'
import { Headers, ORIGIN, Params } from './profile.js'
import { signAwsV4, ticketTimestamp } from './sign.js'

/**
 * TikTok Studio 的上传与发布（上游 api/tiktok_web.py 的 get_upload_auth … post_project）。
 * 媒体元数据：上游用 ffmpeg / Pillow，catbus 只依赖 Node——MP4 头在本地解析，封面图由调用方给出，
 * 图片编解码用 @napi-rs/canvas。
 */

const AXIOS_ACCEPT = 'application/json, text/plain, */*'
const PHOTO_REFERER = `${ORIGIN}/tiktokstudio/upload/post/photo`
export const PROJECT_POST_PATH = '/tiktok/web/project/post/v1/'
const LOWER_DIGITS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const LETTERS_DIGITS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

type Json = Record<string, any>

/** 浏览器 11 位上传随机串（上游 _upload_random_s）。 */
export const uploadRandomS = () => rand.string(11, LOWER_DIGITS)
export const creationId = () => 'ROO_' + rand.string(17, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_')
export const photoCreationId = () => rand.string(21, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_')
/** `secrets.randbelow(n)`。 */
const randbelow = (n: number) => Math.floor(rand.random() * n)


// ================================================================ STS 凭证

export function uploadAuth(t: TikTok, o: { signed?: boolean; referer?: string } = {}): Promise<Json> {
  const signed = o.signed ?? true
  return t.requestJson({
    method: 'GET',
    path: '/api/v1/video/upload/auth/',
    params: new Params([['aid', '1988']]),
    referer: o.referer ?? `${ORIGIN}/tiktokstudio/upload?from=webapp&tab=video`,
    signed,
    accept: AXIOS_ACCEPT,
    headerOrder: ['sec-ch-ua-platform', 'referer', 'user-agent', 'accept', 'sec-ch-ua', 'sec-ch-ua-mobile', 'accept-encoding', 'accept-language', 'cookie', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'],
  })
}

interface Credentials {
  access_key_id: string
  secret_acess_key: string
  session_token: string
  space_name: string
}

function credentials(auth: Json, tokenName: string): Credentials {
  const c = auth?.[tokenName]
  const missing = ['access_key_id', 'secret_acess_key', 'session_token', 'space_name'].filter((k) => !c?.[k])
  if (missing.length) throw new CatbusError('UPSTREAM', `upload/auth 的 ${tokenName} 缺少字段：${missing.join(', ')}`)
  return c
}

const tokenName = (space: string) => (space === 'tiktok-ai-frame' ? 'vframe_token_v5' : 'video_token_v5')

/** /top/v1 的请求头：AWS V4 签名字段插在浏览器的固定位置（上游 _vod_headers）。 */
function vodHeaders(
  t: TikTok,
  o: { method: string; params: Params; creds: Credentials; referer: string; body?: Uint8Array; service?: string; contentType?: string },
): [string, string][] {
  const body = o.body ?? new Uint8Array()
  const post = o.method.toUpperCase() === 'POST'
  const aws = signAwsV4({
    method: o.method,
    path: '/top/v1',
    query: o.params.pairs,
    accessKeyId: o.creds.access_key_id,
    secretAccessKey: o.creds.secret_acess_key,
    sessionToken: o.creds.session_token,
    body,
    service: o.service ?? 'vod',
    amzDate: undefined,
  })
  const base = t.headers(post ? 'POST' : 'GET', { referer: o.referer, origin: post ? ORIGIN : '', contentLength: post ? String(body.length) : null, secFetchSite: 'same-origin' })
  if (post) base.set('content-type', o.contentType ?? 'text/plain;charset=UTF-8')
  base.set('accept', '*/*')
  const h = new Headers()
  if (body.length) h.set('x-amz-content-sha256', aws['x-amz-content-sha256'])
  h.set('sec-ch-ua-platform', base.get('sec-ch-ua-platform'))
  h.set('authorization', aws.authorization)
  h.set('referer', base.get('referer'))
  h.set('sec-ch-ua', base.get('sec-ch-ua'))
  h.set('sec-ch-ua-mobile', base.get('sec-ch-ua-mobile'))
  h.set('x-amz-security-token', aws['x-amz-security-token'])
  h.set('x-amz-date', aws['x-amz-date'])
  h.set('user-agent', base.get('user-agent'))
  if (post) h.set('content-type', base.get('content-type'))
  h.set('accept', base.get('accept'))
  for (const k of ['accept-encoding', 'accept-language', 'content-length', 'cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site']) {
    if (base.has(k)) h.set(k, base.get(k))
  }
  return h.pairs()
}

async function topV1(t: TikTok, o: { method: string; params: Params; creds: Credentials; referer: string; body?: Uint8Array; service?: string; contentType?: string }): Promise<Json> {
  const headers = vodHeaders(t, o)
  const res = await t.send({ method: o.method, url: `${ORIGIN}/top/v1?${o.params.toQuery()}`, headers, body: o.body })
  return t.json(res, { path: '/top/v1' })
}

// ================================================================ 图文（ImageX）

export function applyImageUpload(t: TikTok, fileSize: number, auth: Json, o: { s?: string; referer?: string } = {}): Promise<Json> {
  if (fileSize <= 0) throw new CatbusError('USAGE', '图片不能为空')
  const s = o.s ?? uploadRandomS()
  const params = new Params([
    ['Action', 'ApplyImageUpload'],
    ['Version', '2018-08-01'],
    ['ServiceId', 'photomode'],
    ['FileSize', String(fileSize)],
    ['s', s],
    ['device_platform', 'web'],
  ])
  return topV1(t, { method: 'GET', params, creds: credentials(auth, 'video_token_v5'), referer: o.referer ?? PHOTO_REFERER, service: 'imagex' })
}

export function commitImageUpload(t: TikTok, sessionKey: string, auth: Json, referer = PHOTO_REFERER): Promise<Json> {
  const body = new TextEncoder().encode(compactJson({ SessionKey: sessionKey }))
  const params = new Params([
    ['Action', 'CommitImageUpload'],
    ['Version', '2018-08-01'],
    ['ServiceId', 'photomode'],
  ])
  return topV1(t, { method: 'POST', params, creds: credentials(auth, 'video_token_v5'), referer, body, service: 'imagex', contentType: 'application/json' })
}

export interface UploadedPhoto {
  apply: Json
  upload: Json
  commit: Json
  uri: string
  width: number
  height: number
}

/** ApplyImageUpload → TOS 原样上传 → CommitImageUpload。 */
export async function uploadPhotoBytes(t: TikTok, data: Uint8Array, auth: Json, o: { referer?: string; userId?: string } = {}): Promise<UploadedPhoto> {
  const referer = o.referer ?? PHOTO_REFERER
  const applied = await applyImageUpload(t, data.length, auth, { referer })
  const uploaded = await uploadTosBytes(t, applied, data, { userId: o.userId, filename: 'undefined' })
  const sessionKey = applied?.Result?.InnerUploadAddress?.UploadNodes?.[0]?.SessionKey
  if (!sessionKey) throw new CatbusError('UPSTREAM', 'ApplyImageUpload 缺少 SessionKey')
  const committed = await commitImageUpload(t, String(sessionKey), auth, referer)
  const plugin = committed?.Result?.PluginResult?.[0] ?? {}
  const uri = String(plugin.ImageUri ?? '')
  const width = Number(plugin.ImageWidth)
  const height = Number(plugin.ImageHeight)
  if (!uri || !(width > 0) || !(height > 0)) throw new CatbusError('UPSTREAM', 'CommitImageUpload 没有返回图片 URI / 尺寸')
  return { apply: applied, upload: uploaded, commit: committed, uri, width, height }
}

// ================================================================ 视频（VOD）

export function uploadCandidates(t: TikTok, auth: Json, referer = UPLOAD_REFERER): Promise<Json> {
  const params = new Params([
    ['Action', 'GetUploadCandidates'],
    ['Version', '2020-11-19'],
    ['SpaceName', 'tiktok'],
    ['X-Amz-Expires', '604800'],
  ])
  return topV1(t, { method: 'GET', params, creds: credentials(auth, 'video_token_v5'), referer })
}

/** 四个 1 MiB 测速请求，返回按耗时排序的上传节点（上游 probe_upload_candidates）。 */
export async function probeUploadCandidates(t: TikTok, candidates: Json): Promise<string[]> {
  const domains: any[] = candidates?.Result?.Domains ?? []
  if (!domains.length) throw new CatbusError('UPSTREAM', 'GetUploadCandidates 返回空 Domains')
  const payload = new Uint8Array(1048576)
  const probe = async (d: any): Promise<[number, string]> => {
    const host = String(d.Name ?? '')
    const store = String(d.StoreID ?? '')
    const ticket = String(d.Sign ?? '')
    if (!host || !store || !ticket) throw new CatbusError('UPSTREAM', 'GetUploadCandidates Domain 字段为空')
    const headers: [string, string][] = [
      ['sec-ch-ua-platform', t.browser.secChUaPlatform],
      ['authorization', ticket],
      ['referer', `${ORIGIN}/`],
      ['sec-ch-ua', t.browser.secChUa],
      ['content-crc32', 'ignore'],
      ['sec-ch-ua-mobile', '?0'],
      ['user-agent', t.ua],
      ['content-type', 'application/octet-stream'],
      ['content-disposition', 'attachment; filename="undefined"'],
      ['accept', '*/*'],
      ['accept-encoding', 'gzip, deflate, br, zstd'],
      ['accept-language', t.browser.acceptLanguage],
      ['content-length', String(payload.length)],
      ['origin', ORIGIN],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'cross-site'],
    ]
    const started = performance.now()
    const res = await t.send({ method: 'POST', url: `https://${host}/upload/v1/${store}?speedtest`, headers, body: payload, cookies: false })
    if (res.status >= 400) throw new CatbusError('UPSTREAM', `上传节点测速失败：HTTP ${res.status}`, { detail: { host } })
    await res.arrayBuffer()
    return [performance.now() - started, host]
  }
  const ranked = await Promise.all(domains.slice(0, 4).map(probe))
  return ranked.sort((a, b) => a[0] - b[0]).map(([, h]) => h)
}

export async function applyUploadInner(
  t: TikTok,
  fileSize: number,
  o: {
    fileType?: string
    spaceName?: string
    isInner?: string
    s?: string
    scene?: string
    businessTag?: string
    auth: Json
    clientBestHosts?: string[] | string
    xAmzExpires?: string
    includeFileSize?: boolean
    referer?: string
  },
): Promise<Json> {
  const fileType = o.fileType ?? 'video'
  const space = o.spaceName ?? 'tiktok'
  const referer = o.referer ?? UPLOAD_REFERER
  const creds = credentials(o.auth, tokenName(space))
  if (creds.space_name !== space) throw new CatbusError('UPSTREAM', `${tokenName(space)}.space_name 与 SpaceName 不一致`)
  const s = o.s ?? uploadRandomS()
  let hosts = o.clientBestHosts
  if (fileType === 'video' && hosts == null) hosts = await probeUploadCandidates(t, await uploadCandidates(t, o.auth, referer))
  const pairs: [string, string][] = [
    ['Action', 'ApplyUploadInner'],
    ['Version', '2020-11-19'],
    ['SpaceName', space],
    ['FileType', fileType],
    ['IsInner', o.isInner ?? '1'],
  ]
  if (hosts != null) {
    const joined = typeof hosts === 'string' ? hosts : hosts.join(',')
    if (!joined) throw new CatbusError('UPSTREAM', 'ApplyUploadInner 的 ClientBestHosts 不能为空')
    pairs.push(['ClientBestHosts', joined])
  }
  if (o.includeFileSize ?? true) pairs.push(['FileSize', String(fileSize)])
  if (fileType === 'video') pairs.push(['X-Amz-Expires', o.xAmzExpires ?? '604800'])
  pairs.push(['s', s])
  if (o.scene != null) pairs.push(['Scene', o.scene])
  pairs.push(['device_platform', 'web'])
  const tag = o.businessTag ?? (fileType === 'video' ? 'tiktok_video_submission_web' : undefined)
  if (tag != null) pairs.push(['business_tag', tag])
  return topV1(t, { method: 'GET', params: new Params(pairs), creds, referer })
}

function storeInfo(applied: Json): { host: string; node: any } {
  const node = applied?.Result?.InnerUploadAddress?.UploadNodes?.[0]
  const store = node?.StoreInfos?.[0]
  if (!node?.UploadHost || !store?.StoreUri || !store?.Auth) throw new CatbusError('UPSTREAM', 'ApplyUploadInner 缺少 InnerUploadAddress.UploadNodes/StoreInfos')
  return { host: String(node.UploadHost), node }
}

/** 按 ApplyUploadInner 给的节点直传；视频走带 post_upload_req 的 multipart。 */
export async function uploadTosBytes(
  t: TikTok,
  applied: Json,
  data: Uint8Array,
  o: { userId?: string; filename?: string; auth?: Json; postUpload?: boolean; functions?: unknown[]; boundary?: string } = {},
): Promise<Json> {
  const { host, node } = storeInfo(applied)
  const store = node.StoreInfos[0]
  const userId = String(o.userId || t.odinId)
  if (!userId) throw new CatbusError('UPSTREAM', 'TOS 上传缺少 x-storage-u')
  let payload: Uint8Array = data
  let contentType = 'application/octet-stream'
  if (o.postUpload) {
    if (!o.auth) throw new CatbusError('ERROR', '视频 post-upload multipart 缺少本次 upload/auth')
    const creds = credentials(o.auth, 'video_token_v5')
    const sessionKey = String(node.SessionKey ?? '')
    if (!sessionKey) throw new CatbusError('UPSTREAM', '视频 post-upload 缺少 UploadNode.SessionKey')
    const boundary = o.boundary ?? '----WebKitFormBoundary' + rand.string(16, LETTERS_DIGITS)
    const postBody = compactJson(
      new Map<string, unknown>([
        ['sts2_token', creds.session_token],
        ['sts2_secret', creds.secret_acess_key],
        ['session_key', sessionKey],
        ['functions', o.functions ?? []],
      ]),
    )
    payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'ascii'),
      data,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="post_upload_req"\r\n\r\n`, 'ascii'),
      Buffer.from(postBody, 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii'),
    ])
    contentType = `multipart/form-data; boundary=${boundary}`
  }
  const headers: [string, string][] = [
    ['sec-ch-ua-platform', t.browser.secChUaPlatform],
    ['authorization', String(store.Auth)],
    ['referer', `${ORIGIN}/`],
    ['sec-ch-ua', t.browser.secChUa],
    ['content-crc32', (crc32(data) >>> 0).toString(16).padStart(8, '0')],
    ['sec-ch-ua-mobile', '?0'],
    ...(o.postUpload ? [['x-upload-with-postupload', '1'] as [string, string]] : []),
    ['user-agent', t.ua],
    ['x-storage-u', userId],
    ['content-type', contentType],
    ...(!o.postUpload ? [['content-disposition', `attachment; filename="${o.filename ?? 'undefined'}"`] as [string, string]] : []),
    ['accept', '*/*'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', t.browser.acceptLanguage],
    ['content-length', String(payload.length)],
    ['origin', ORIGIN],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'cross-site'],
  ]
  const res = await t.send({ method: 'POST', url: `https://${host}/upload/v1/${store.StoreUri}`, headers, body: payload, cookies: false })
  return t.json(res, { path: '/upload/v1' })
}

export function commitUploadInner(t: TikTok, sessionKey: string, o: { functions?: unknown[]; spaceName?: string; auth: Json; referer?: string }): Promise<Json> {
  const body = new TextEncoder().encode(compactJson(new Map<string, unknown>([['SessionKey', sessionKey], ['Functions', o.functions ?? []]])))
  const space = o.spaceName ?? 'tiktok'
  const params = new Params([
    ['Action', 'CommitUploadInner'],
    ['Version', '2020-11-19'],
    ['SpaceName', space],
  ])
  return topV1(t, { method: 'POST', params, creds: credentials(o.auth, tokenName(space)), referer: o.referer ?? UPLOAD_REFERER, body })
}

export interface UploadedMedia {
  apply: Json
  upload: Json
  commit?: Json
  video_id: string
}

/** 视频：Apply → multipart post-upload（一步提交）；图片：Apply → 直传 → CommitUploadInner。 */
export async function uploadMediaBytes(
  t: TikTok,
  data: Uint8Array,
  o: { fileType?: string; spaceName?: string; scene?: string; businessTag?: string; functions?: unknown[]; userId?: string; filename?: string; auth: Json; clientBestHosts?: string[]; referer?: string },
): Promise<UploadedMedia> {
  const fileType = o.fileType ?? 'video'
  const applied = await applyUploadInner(t, data.length, {
    fileType,
    spaceName: o.spaceName,
    scene: o.scene,
    businessTag: o.businessTag,
    auth: o.auth,
    clientBestHosts: o.clientBestHosts,
    referer: o.referer,
  })
  const uploaded = await uploadTosBytes(t, applied, data, { userId: o.userId, filename: o.filename, auth: o.auth, postUpload: fileType === 'video', functions: o.functions })
  const node = applied?.Result?.InnerUploadAddress?.UploadNodes?.[0]
  const videoId = String(node?.Vid ?? '')
  if (!videoId) throw new CatbusError('UPSTREAM', 'ApplyUploadInner 缺少 UploadNode.Vid')
  if (fileType === 'video') return { apply: applied, upload: uploaded, video_id: videoId }
  const sessionKey = String(node?.SessionKey ?? '')
  if (!sessionKey) throw new CatbusError('UPSTREAM', '图片 ApplyUploadInner 缺少 SessionKey')
  const committed = await commitUploadInner(t, sessionKey, { functions: o.functions, spaceName: o.spaceName, auth: o.auth, referer: o.referer })
  return { apply: applied, upload: uploaded, commit: committed, video_id: videoId }
}

// ================================================================ 转码

/** SecSDK 的 HEAD 引导：拿 x-ware-csrf-token 的第 2 段作为 x-secsdk-csrf-token。 */
export async function bootstrapTranscodeCsrf(t: TikTok, referer = UPLOAD_REFERER): Promise<void> {
  const base = t.headers('GET', { referer, secFetchSite: 'same-origin' })
  const h = new Headers()
  h.set('x-secsdk-csrf-request', '1')
  h.set('sec-ch-ua-platform', base.get('sec-ch-ua-platform'))
  h.set('referer', base.get('referer'))
  h.set('user-agent', base.get('user-agent'))
  h.set('x-secsdk-csrf-version', '1.2.22')
  h.set('sec-ch-ua', base.get('sec-ch-ua'))
  h.set('sec-ch-ua-mobile', base.get('sec-ch-ua-mobile'))
  h.set('accept', '*/*')
  for (const k of ['accept-encoding', 'accept-language', 'cookie', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site']) h.set(k, base.get(k))
  const res = await t.send({ method: 'HEAD', url: `${ORIGIN}/api/v1/video/transcode/enable/`, headers: h.pairs() })
  if (res.status >= 400) throw new CatbusError('UPSTREAM', `transcode HEAD 返回 HTTP ${res.status}`)
  const parts = String(res.headers.get('x-ware-csrf-token') ?? '').split(',')
  if (parts.length !== 5 || !parts[1]) throw new CatbusError('UPSTREAM', 'transcode HEAD 缺少五段 x-ware-csrf-token')
  t.device.secsdk_csrf_token = parts[1]
  if (!t.ttCsrfToken) throw new CatbusError('UPSTREAM', 'transcode HEAD 没有写入 tt_csrf_token Cookie')
}

export async function enableVideoTranscode(t: TikTok, videoId: string, referer = UPLOAD_REFERER): Promise<Json> {
  if (!t.ttCsrfToken || !t.secsdkCsrfToken) await bootstrapTranscodeCsrf(t, referer)
  const base = t.headers('GET', { referer, origin: ORIGIN, contentLength: '0', secFetchSite: 'same-origin' })
  const h = new Headers()
  h.set('sec-ch-ua-platform', base.get('sec-ch-ua-platform'))
  h.set('referer', base.get('referer'))
  h.set('sec-ch-ua', base.get('sec-ch-ua'))
  h.set('sec-ch-ua-mobile', base.get('sec-ch-ua-mobile'))
  h.set('tt-csrf-token', t.ttCsrfToken)
  h.set('user-agent', base.get('user-agent'))
  h.set('accept', AXIOS_ACCEPT)
  h.set('x-secsdk-csrf-token', t.secsdkCsrfToken)
  h.set('accept-encoding', base.get('accept-encoding'))
  h.set('accept-language', base.get('accept-language'))
  h.set('content-length', '0')
  for (const k of ['cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site']) h.set(k, base.get(k))
  const p = new Params([
    ['video_id', videoId],
    ['aid', '1988'],
  ])
  const res = await t.send({ method: 'POST', url: `${ORIGIN}/api/v1/video/transcode/enable/?${p.toQuery()}`, headers: h.pairs() })
  return t.json(res, { path: '/api/v1/video/transcode/enable/' })
}

export async function videoTranscodeResult(t: TikTok, videoId: string, o: { width: number; height: number; durationMs: number; fileKey: string; scene?: number; referer?: string }): Promise<Json> {
  const body = compactJson(
    new Map<string, unknown>([
      ['scene', o.scene ?? 0],
      [
        'video_info',
        [
          new Map<string, unknown>([
            ['file_key', o.fileKey],
            ['video_id', videoId],
            ['original_width', o.width],
            ['original_height', o.height],
            ['original_duration_ms', o.durationMs],
          ]),
        ],
      ],
    ]),
  )
  const len = String(Buffer.byteLength(body))
  const base = t.headers('POST', { referer: o.referer ?? UPLOAD_REFERER, origin: ORIGIN, contentLength: len, secFetchSite: 'same-origin' })
  const h = new Headers()
  h.set('sec-ch-ua-platform', base.get('sec-ch-ua-platform'))
  h.set('referer', base.get('referer'))
  h.set('user-agent', base.get('user-agent'))
  h.set('accept', AXIOS_ACCEPT)
  h.set('sec-ch-ua', base.get('sec-ch-ua'))
  h.set('content-type', 'application/json')
  h.set('sec-ch-ua-mobile', base.get('sec-ch-ua-mobile'))
  h.set('accept-encoding', base.get('accept-encoding'))
  h.set('accept-language', base.get('accept-language'))
  h.set('content-length', len)
  for (const k of ['cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site']) h.set(k, base.get(k))
  const res = await t.send({ method: 'POST', url: `${ORIGIN}/api/v1/video/transcode/result/?aid=1988`, headers: h.pairs(), body })
  return t.json(res, { path: '/api/v1/video/transcode/result/' })
}

/** 轮询到 transcode_status == 3。 */
export async function waitVideoTranscode(t: TikTok, videoId: string, o: { width: number; height: number; durationMs: number; fileKey: string; timeout?: number; interval?: number }): Promise<Json> {
  const deadline = rand.now() + (o.timeout ?? 90) * 1000
  for (;;) {
    const r = await videoTranscodeResult(t, videoId, o)
    if (Number(r.transcode_result?.[0]?.transcode_status ?? 0) === 3) return r
    if (rand.now() >= deadline) throw new CatbusError('UPSTREAM', 'TikTok 视频转码在限定时间内没有完成')
    await rand.sleep(Math.max(50, (o.interval ?? 1) * 1000))
  }
}

export function mediaOpenId(t: TikTok, referer = UPLOAD_REFERER): Promise<Json> {
  return t.requestJson({ method: 'GET', path: '/api/v1/media/get/openid/', params: new Params([['aid', '1988']]), referer, signed: false, accept: AXIOS_ACCEPT })
}

/** 发布前的空项目（真实 POST，空 body，不签名）。 */
export async function projectCreate(t: TikTok, creation: string, referer = UPLOAD_REFERER): Promise<Json> {
  const h = t.headers('GET', { referer, origin: ORIGIN, contentLength: '0', secFetchSite: 'same-origin' })
  h.set('accept', AXIOS_ACCEPT)
  const p = new Params([
    ['creation_id', creation],
    ['type', '1'],
    ['aid', '1988'],
  ])
  const res = await t.send({ method: 'POST', url: `${ORIGIN}/api/v1/web/project/create/?${p.toQuery()}`, headers: h.pairs() })
  return t.json(res, { path: '/api/v1/web/project/create/' })
}

// ================================================================ 项目 body（字段与键序照抄浏览器）

const FONTS: [string, string][] = [
  ['Noto-KR', '3379517775'],
  ['Noto-JP', '3379518023'],
  ['Noto-TC', '3379517439'],
  ['Noto-SC', '3382263014'],
  ['Noto-Arabic', '3380773560'],
  ['Noto-Myanmar', '3380773555'],
  ['Noto-Khmer', '3380773556'],
  ['Noto-Devanagari', '3380773557'],
  ['Noto-Bengali', '3380773558'],
  ['Noto-Thai', '3380773559'],
]

const M = (entries: [string, unknown][]) => new Map<string, unknown>(entries)

export interface VideoProject {
  creationId: string
  videoId: string
  text: string
  coverUri: string
  playUrl: string
  filename: string
  width: number
  height: number
  durationMs: number
  fps?: number
  visibilityType?: number
  allowComment?: number
  allowDuet?: number
  allowStitch?: number
  allowContentReuse?: number
  allowAiRemix?: number
  textExtra?: unknown[]
}

/** 视频项目的 body（上游 build_creator_project_body）。 */
export function buildVideoProjectBody(o: VideoProject): string {
  const missing = Object.entries({ creation_id: o.creationId, video_id: o.videoId, cover_uri: o.coverUri, play_url: o.playUrl, filename: o.filename })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw new CatbusError('ERROR', `Creator project body 缺少字段：${missing.join(', ')}`)
  const { width, height, durationMs } = o
  const fps = o.fps ?? 24
  if (Math.min(width, height, durationMs, fps) <= 0) throw new CatbusError('USAGE', '视频尺寸、时长和帧率必须为正数')
  const now = rand.now()
  const iso = new Date(now).toISOString()
  const updatedMs = String(now)
  const coverBlob = `blob:https://www.tiktok.com/${rand.uuid4()}`
  const frameBlob = `blob:https://www.tiktok.com/${rand.uuid4()}`
  const coverAssetId = rand.uuid4()
  const videoAssetId = rand.uuid4()
  const fontAssets = FONTS.map(([name, family]) =>
    M([
      ['id', rand.uuid4()],
      ['name', name],
      ['type', 'font'],
      ['url', M([['loki', `loki://${family}`]])],
      ['metaInfo', M([['family', family], ['format', ''], ['role', 'FALLBACK']])],
    ]),
  )
  const coverProject = M([
    [
      'project',
      M([
        ['id', rand.uuid4()],
        ['sdkVersion', '0.6.0-alpha.4'],
        ['name', 'New Project'],
        ['created', iso],
        ['updated', iso],
        ['description', ''],
        ['mediaInfo', M([['width', 1152], ['height', 648]])],
        [
          'tracks',
          [
            M([
              ['id', rand.uuid4()],
              ['type', 'image'],
              ['isMain', true],
              [
                'clips',
                [
                  M([
                    ['id', rand.uuid4()],
                    ['type', 'image'],
                    ['assetId', coverAssetId],
                    ['timing', M([['stepIn', 0], ['duration', 1000], ['start', 0], ['speed', 1]])],
                    ['effects', M([])],
                    [
                      'props',
                      M([
                        ['visual', M([['size', [width, height]], ['layout', M([['anchor', [0, 0]], ['offset', [0, 0]], ['position', [0, 0]], ['scale', [4 / 3, 4 / 3]]])]])],
                        ['crop', [0, 0, width, height]],
                      ]),
                    ],
                  ]),
                ],
              ],
            ]),
          ],
        ],
        ['scripts', []],
        [
          'assets',
          [
            M([
              ['id', coverAssetId],
              ['name', 'CoverImage'],
              ['type', 'image'],
              ['url', M([['blob', coverBlob]])],
              ['metaInfo', M([['width', width], ['height', height], ['format', '']])],
            ]),
          ],
        ],
      ]),
    ],
    [
      'sourceProject',
      M([
        ['id', rand.uuid4()],
        ['sdkVersion', '0.6.0-alpha.4'],
        ['name', 'add title for your video'],
        ['created', iso],
        ['updated', updatedMs],
        ['description', 'A sample project created with the builder pattern'],
        ['mediaInfo', M([['width', width], ['height', height], ['fps', fps]])],
        [
          'tracks',
          [
            M([
              ['id', rand.uuid4()],
              ['type', 'video'],
              ['isMain', true],
              [
                'clips',
                [
                  M([
                    ['id', rand.uuid4()],
                    ['type', 'video'],
                    ['assetId', videoAssetId],
                    ['timing', M([['stepIn', 0], ['duration', durationMs], ['start', 0], ['speed', 1]])],
                    ['effects', M([])],
                    [
                      'props',
                      M([
                        ['visual', M([['size', [width, height]], ['layout', M([['offset', [0, 0]], ['anchor', [0, 0]], ['position', [0, 0]]])]])],
                        ['crop', [0, 0, width, height]],
                      ]),
                    ],
                  ]),
                ],
              ],
              ['muted', false],
            ]),
          ],
        ],
        ['scripts', []],
        [
          'assets',
          [
            M([
              ['id', videoAssetId],
              ['name', o.filename],
              ['type', 'video'],
              ['url', M([['http', o.playUrl]])],
              ['metaInfo', M([['width', width], ['height', height], ['fps', 0], ['duration', durationMs], ['format', 'video/mp4']])],
            ]),
            ...fontAssets,
          ],
        ],
      ]),
    ],
    ['coverSourceType', 'frame'],
    ['sourceProjectTime', 0],
    ['sourceProjectLastSaveFrame', frameBlob],
  ])
  const body = M([
    ['post_common_info', M([['creation_id', o.creationId], ['enter_post_page_from', 2], ['post_type', 3]])],
    [
      'feature_common_info_list',
      [
        M([
          ['geofencing_regions', []],
          ['playlist_name', ''],
          ['playlist_id', ''],
          ['tcm_params', '{"commerce_toggle_info":{}}'],
          ['sound_exemption', 0],
          ['anchors', []],
          ['vedit_common_info', M([['draft', ''], ['video_id', o.videoId]])],
          [
            'privacy_setting_info',
            M([
              ['visibility_type', o.visibilityType ?? 1],
              ['allow_duet', o.allowDuet ?? 0],
              ['allow_stitch', o.allowStitch ?? 0],
              ['allow_comment', o.allowComment ?? 1],
              ['allow_content_reuse', o.allowContentReuse ?? 1],
              ['allow_ai_remix', o.allowAiRemix ?? 1],
            ]),
          ],
        ]),
      ],
    ],
    [
      'single_post_req_list',
      [
        M([
          ['batch_index', 0],
          ['video_id', o.videoId],
          ['is_long_video', 0],
          [
            'single_post_feature_info',
            M([
              ['text', o.text],
              ['text_extra', o.textExtra ?? []],
              ['markup_text', o.text],
              ['music_info', M([['origin_volume', '100']])],
              [
                'cover_info',
                M([
                  ['cover_type', 1],
                  ['cover_uri', o.coverUri],
                  ['cover_width', 486],
                  ['cover_height', 648],
                  ['blob_url', coverBlob],
                  ['frame_duration', 0],
                  ['isAutoCropFirstFrame', true],
                  ['coverProject', coverProject],
                  ['isProcessingInitialCover', false],
                  ['crop_type', 2],
                ]),
              ],
              ['poster_delay', 0],
              ['cloud_edit_video_height', height],
              ['cloud_edit_video_width', width],
              ['cloud_edit_is_use_video_canvas', false],
              ['has_original_audio', 1],
              ['is_upload_audio_track', false],
              ['video_track_time_range_list', [M([['start_time_in_ms', 0], ['end_time_in_ms', durationMs]])]],
              ['mature_theme_type', 0],
            ]),
          ],
        ]),
      ],
    ],
  ])
  return compactJson(body)
}

export interface PhotoRow {
  id: string
  uri: string
  width_px: number
  height_px: number
}

/** 图文项目的 body（上游 build_creator_photo_project_body）。 */
export function buildPhotoProjectBody(o: {
  creationId: string
  photos: PhotoRow[]
  text: string
  title?: string
  visibilityType?: number
  allowComment?: number
  allowDuet?: number
  allowStitch?: number
  allowContentReuse?: number
  allowAiRemix?: number
  textExtra?: unknown[]
}): string {
  if (!/^[A-Za-z0-9_-]{21}$/.test(o.creationId)) throw new CatbusError('ERROR', 'Photo Mode creation_id 必须是 21 位 URL-safe 字符串')
  if (!o.photos.length) throw new CatbusError('USAGE', '图文至少需要一张图片')
  const rows = o.photos.map((p) => M([['id', p.id], ['uri', p.uri], ['width_px', p.width_px], ['height_px', p.height_px]]))
  const body = M([
    [
      'feature_common_info_list',
      [
        M([
          ['aigc_info', M([['aigc_label_type', 0]])],
          ['org_game_post_use_store_region', false],
          [
            'privacy_setting_info',
            M([
              ['allow_comment', o.allowComment ?? 1],
              ['allow_duet', o.allowDuet ?? 1],
              ['allow_stitch', o.allowStitch ?? 1],
              ['allow_content_reuse', o.allowContentReuse ?? 1],
              ['allow_ai_remix', o.allowAiRemix ?? 1],
              ['visibility_type', o.visibilityType ?? 1],
            ]),
          ],
          ['draft_id', ''],
          ['tcm_params', '{"commerce_toggle_info":{}}'],
          ['anchors', []],
        ]),
      ],
    ],
    ['post_common_info', M([['creation_id', o.creationId], ['enter_post_page_from', 1], ['post_type', 4]])],
    [
      'single_post_req_list',
      [
        M([
          ['batch_index', 0],
          ['aweme_type', 150],
          ['image_post_content', M([['title', o.title ?? ''], ['images', rows], ['cover', new Map(rows[0])]])],
          ['single_post_feature_info', M([['text', o.text], ['text_extra', o.textExtra ?? []], ['markup_text', o.text]])],
        ]),
      ],
    ],
  ])
  return compactJson(body)
}

/** project/post：ticket-guard 现签，X-Bogus / X-Gnarly 用 client-data 里的时间戳（上游 post_project）。 */
export async function postProject(t: TikTok, body: string, referer = `${ORIGIN}/tiktokstudio/upload?from=webapp&lang=zh-Hans`): Promise<Json> {
  const guard = t.ticketGuard(PROJECT_POST_PATH)
  const params = new Params([
    ['app_name', 'tiktok_web'],
    ['channel', 'tiktok_web'],
    ['device_platform', 'web'],
    ['tz_name', 'Asia/Shanghai'],
    ['aid', '1988'],
  ])
  const h = t.headers('POST', { referer, origin: ORIGIN, contentLength: String(Buffer.byteLength(body)), secFetchSite: 'same-origin' })
  h.set('accept', AXIOS_ACCEPT)
  h.update(guard)
  h.reorder(
    [
      'tt-ticket-guard-client-data', 'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'tt-ticket-guard-web-version', 'tt-ticket-guard-version',
      'user-agent', 'accept', 'tt-ticket-guard-public-key', 'content-type', 'tt-ticket-guard-iteration-version', 'accept-encoding', 'accept-language',
      'content-length', 'cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
    ],
    true,
  )
  const { signRequest } = await import('./sign.js')
  const unsigned = `${params.toQuery()}&msToken=${t.msToken}`
  params.update(
    signRequest({
      url: `${ORIGIN}${PROJECT_POST_PATH}?${unsigned}`,
      method: 'POST',
      body,
      userAgent: t.ua,
      referer,
      metrics: t.metrics,
      signingTimestamp: ticketTimestamp(guard['tt-ticket-guard-client-data']!),
    }),
  )
  const res = await t.send({ method: 'POST', url: `${ORIGIN}${PROJECT_POST_PATH}?${params.toQuery()}`, headers: h.pairs(), body })
  const result = await t.json<Json>(res, { path: PROJECT_POST_PATH })
  for (const item of result.single_post_resp_list ?? []) {
    if (item?.status_code != null && String(item.status_code) !== '0') {
      throw new CatbusError('UPSTREAM', `发布失败：status_code=${item.status_code}`, { detail: { code: item.status_code, message: item.status_msg } })
    }
  }
  return result
}

// ================================================================ 本地媒体处理（替代 ffmpeg / Pillow）

export interface VideoMeta {
  width: number
  height: number
  durationMs: number
  fps: number
}

/** 读 MP4 / MOV 的 moov：视频轨的尺寸（tkhd）、时长（mdhd）、帧率（stts 的样本数 / 时长）。 */
export function mp4Meta(data: Uint8Array): VideoMeta {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const boxes = (start: number, end: number): { type: string; start: number; end: number }[] => {
    const out = []
    let p = start
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p)
      const type = buf.toString('latin1', p + 4, p + 8)
      let header = 8
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8))
        header = 16
      } else if (size === 0) size = end - p
      if (size < header || p + size > end) break
      out.push({ type, start: p + header, end: p + size })
      p += size
    }
    return out
  }
  const moov = boxes(0, buf.length).find((b) => b.type === 'moov')
  if (!moov) throw new CatbusError('USAGE', '只支持 MP4 / MOV 视频（找不到 moov）')
  for (const trak of boxes(moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const inner = boxes(trak.start, trak.end)
    const mdia = inner.find((b) => b.type === 'mdia')
    const tkhd = inner.find((b) => b.type === 'tkhd')
    if (!mdia || !tkhd) continue
    const mdiaBoxes = boxes(mdia.start, mdia.end)
    const hdlr = mdiaBoxes.find((b) => b.type === 'hdlr')
    if (!hdlr || buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) !== 'vide') continue
    const width = Math.round(buf.readUInt32BE(tkhd.end - 8) / 65536)
    const height = Math.round(buf.readUInt32BE(tkhd.end - 4) / 65536)
    const mdhd = mdiaBoxes.find((b) => b.type === 'mdhd')!
    const v1 = buf[mdhd.start] === 1
    const timescale = buf.readUInt32BE(mdhd.start + (v1 ? 20 : 12))
    const duration = v1 ? Number(buf.readBigUInt64BE(mdhd.start + 24)) : buf.readUInt32BE(mdhd.start + 16)
    let samples = 0
    const minf = mdiaBoxes.find((b) => b.type === 'minf')
    const stbl = minf && boxes(minf.start, minf.end).find((b) => b.type === 'stbl')
    const stts = stbl && boxes(stbl.start, stbl.end).find((b) => b.type === 'stts')
    if (stts) {
      const n = buf.readUInt32BE(stts.start + 4)
      for (let i = 0; i < n; i++) samples += buf.readUInt32BE(stts.start + 8 + i * 8)
    }
    const seconds = timescale ? duration / timescale : 0
    const fps = samples && seconds ? Math.max(1, Math.round(samples / seconds)) : 24
    if (!(width > 0 && height > 0 && seconds > 0)) break
    return { width, height, durationMs: Math.max(1, Math.round(seconds * 1000)), fps }
  }
  throw new CatbusError('USAGE', '视频里没有可识别的视频轨（尺寸 / 时长）')
}

/** 只含一个 deflate 文件的 ZIP（浏览器上传给 tiktok-ai-frame 的 0.jpeg 压缩包）。 */
export function zipOne(name: string, data: Uint8Array): Uint8Array {
  const nameBuf = Buffer.from(name, 'utf8')
  const packed = deflateRawSync(data)
  const crc = crc32(data) >>> 0
  const d = new Date(rand.now())
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt16LE(dosTime, 10)
  local.writeUInt16LE(dosDate, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(dosTime, 12)
  central.writeUInt16LE(dosDate, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(packed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42)
  const localSize = local.length + nameBuf.length + packed.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBuf.length, 12)
  end.writeUInt32LE(localSize, 16)
  return Uint8Array.from(Buffer.concat([local, nameBuf, packed, central, nameBuf, end]))
}

export interface Picture {
  width: number
  height: number
  png: Uint8Array
  jpeg: Uint8Array
}

/** 解图片：尺寸、PNG（视频封面）、JPEG q92（ai-frame）。 */
export async function picture(data: Uint8Array): Promise<Picture> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  let img
  try {
    img = await loadImage(Buffer.from(data))
  } catch {
    throw new CatbusError('USAGE', '无法解析图片')
  }
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0)
  return { width: img.width, height: img.height, png: await canvas.encode('png'), jpeg: await canvas.encode('jpeg', 92) }
}

export { randbelow }
