import { CatbusError } from '../../../core/errors.js'
import type { LocalMedia } from '../../../core/files.js'
import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { authError } from '../../../core/toolkit.js'
import * as api from './api.js'
import { type Douyin, type DyJson, riskJson } from './client.js'
import { crc32Hex, IMAGEX_HOST, sigv4, type Sts, VOD_HOST } from './crypto.js'
import { DTRAIT_BROKEN, DTRAIT_HINT } from './dtrait.js'
import { imageSize } from './image.js'
import { CREATOR, creatorPlatformParams, Headers, Params, PROFILE, WWW_ONLY } from './profile.js'
import { spliceUrl, svWebId } from './sign.js'
import { CREATOR_TOS, type TosNode, tosUpload, VOD_VERSION } from './tos.js'

/**
 * 创作者中心（上游 dy_apis/douyin_creator_api.py 与 DouyinAuth.bootstrap_creator_session / creator_cookie_str）：
 * 图文 / 视频发布走 ImageX / VOD 上传，再 POST create_v2。
 */

const HOST = 'creator.douyin.com'
const IMAGEX_SERVICE_ID = 'jm8ajry58r'
const IMAGEX_APP_ID = '2906'
const READ_AID = '2906'
const CSRF_PROBE = '/web/api/media/anchor/search'
export const POST_IMAGE_REFERER = `${CREATOR}/creator-micro/content/post/image?enter_from=publish_page&media_type=image&type=new`
export const POST_VIDEO_REFERER = `${CREATOR}/creator-micro/content/post/video?enter_from=publish_page`

// ---------------------------------------------------------------- 会话

const bootstrapped = new WeakSet<Douyin>()
const csrfTokens = new WeakMap<Douyin, string>()
const randomPools = new WeakMap<Douyin, string[]>()

/** 进入创作者中心页面时的 cookie 初始化与 csrf token（上游 bootstrap_creator_session）。 */
export async function bootstrap(d: Douyin): Promise<void> {
  if (bootstrapped.has(d)) return
  d.creatorJar.splice(0)
  const referer = `${CREATOR}/creator-micro/content/upload`
  const page = await d.request({
    url: referer,
    headers: [
      ['sec-ch-ua-platform', PROFILE.secChUaPlatform],
      ['upgrade-insecure-requests', '1'],
      ['user-agent', PROFILE.ua],
      ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
      ['sec-ch-ua', PROFILE.secChUa],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-fetch-site', 'none'],
      ['sec-fetch-mode', 'navigate'],
      ['sec-fetch-user', '?1'],
      ['sec-fetch-dest', 'document'],
      ['accept-language', PROFILE.acceptLanguage],
      ['priority', 'u=0, i'],
    ],
  })
  if (page.status >= 400) throw new CatbusError('UPSTREAM', `打开创作者中心失败（HTTP ${page.status}）`, { detail: { status: page.status } })
  try {
    await d.request({
      url: `${CREATOR}/aweme/v1/web/oversea/judgment/`,
      headers: [
        ['origin', CREATOR],
        ['accept', '*/*'],
        ['sec-fetch-site', 'same-origin'],
        ['sec-fetch-mode', 'cors'],
        ['sec-fetch-dest', 'empty'],
        ['referer', referer],
        ['user-agent', PROFILE.ua],
        ['accept-language', PROFILE.acceptLanguage],
      ],
      timeout: 20,
    })
  } catch {}
  const jar = d.creatorJar
  const put = (name: string, value: string, domain: string) => {
    const i = jar.findIndex((c) => c.name === name && c.domain === domain)
    if (i >= 0) jar.splice(i, 1)
    jar.push({ name, value, domain, path: '/', expires: null })
  }
  for (let i = jar.length - 1; i >= 0; i--) if (jar[i]!.name === 'x-web-secsdk-uid' && jar[i]!.domain === '.creator.douyin.com') jar.splice(i, 1)
  put('x-web-secsdk-uid', rand.uuid4(), HOST)
  if (!jar.some((c) => c.name === 'gfkadpd') && !d.cookie('gfkadpd')) put('gfkadpd', '2906,33638', '.creator.douyin.com')
  if (!jar.some((c) => c.name === '_tea_utm_cache_2906') && !d.cookie('_tea_utm_cache_2906')) put('_tea_utm_cache_2906', 'undefined', '.creator.douyin.com')
  const csrf = await d.request({
    method: 'HEAD',
    url: CREATOR + CSRF_PROBE,
    headers: [
      ['x-secsdk-csrf-request', '1'],
      ['referer', referer],
      ['user-agent', PROFILE.ua],
      ['x-secsdk-csrf-version', '1.2.22'],
      ['accept', '*/*'],
      ['accept-language', PROFILE.acceptLanguage],
    ],
  })
  const parts = (csrf.headers.get('x-ware-csrf-token') ?? '').split(',')
  csrfTokens.set(d, parts.length > 1 ? parts[1]! : '')
  put('s_v_web_id', svWebId(), HOST)
  bootstrapped.add(d)
}

/** 创作者中心请求的 Cookie 头（上游 creator_cookie_str 的默认分支）。 */
export function cookieHeader(d: Douyin): string {
  type Entry = { name: string; value: string; domain: string }
  const all: Entry[] = [
    ...d.jar.filter((c) => !WWW_ONLY.has(c.name)).map((c) => ({ name: c.name, value: c.value, domain: '.douyin.com' })),
    ...d.creatorJar.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
  ]
  const used = new Set<number>()
  const out: Entry[] = []
  const take = (name: string, pred: (c: Entry) => boolean) => {
    const i = all.findIndex((c, k) => !used.has(k) && c.name === name && pred(c))
    if (i >= 0) {
      used.add(i)
      out.push(all[i]!)
    }
  }
  const hostOnly = (c: Entry) => c.domain === HOST
  const creatorDomain = (c: Entry) => c.domain.replace(/^\./, '') === HOST
  const shared = (c: Entry) => c.domain === '.douyin.com'
  take('gd_random', hostOnly)
  take('x-web-secsdk-uid', hostOnly)
  take('gfkadpd', creatorDomain)
  take('_tea_utm_cache_2906', creatorDomain)
  take('csrf_session_id', hostOnly)
  take('bd_ticket_guard_client_web_domain', shared)
  take('s_v_web_id', hostOnly)
  take('s_v_web_id', shared)
  take('bd_ticket_guard_client_data', shared)
  for (const [name] of d.cookies()) take(name, shared)
  all.forEach((c, k) => {
    if (!used.has(k)) out.push(c)
  })
  return out.map((c) => `${c.name}=${c.value}`).join('; ')
}

async function csrf(d: Douyin, referer: string): Promise<string> {
  const token = csrfTokens.get(d)
  if (token) return token
  return (await api.csrfToken(d, cookieHeader(d), CREATOR, CSRF_PROBE, referer)) ?? ''
}

/** creator 同源 XHR 的请求头（上游 _creator_xhr_headers）。 */
async function xhrHeaders(d: Douyin, referer: string, options: { contentType?: string; method?: string; first?: [string, string][]; bodyLength?: number } = {}): Promise<Headers> {
  const h = new Headers()
  for (const [k, v] of options.first ?? []) h.set(k, v)
  h.set('referer', referer).set('user-agent', PROFILE.ua).set('accept', 'application/json, text/plain, */*')
  const token = await csrf(d, referer)
  if (token) h.set('x-secsdk-csrf-token', token)
  if (options.contentType) h.set('content-type', options.contentType)
  h.set('accept-language', PROFILE.acceptLanguage)
  if (options.bodyLength != null) h.set('content-length', String(options.bodyLength))
  h.set('cookie', cookieHeader(d))
  if ((options.method ?? 'GET').toUpperCase() !== 'GET') h.set('origin', CREATOR)
  h.set('priority', 'u=1, i').set('sec-fetch-dest', 'empty').set('sec-fetch-mode', 'cors').set('sec-fetch-site', 'same-origin')
  return h
}

/** creator 的 query：初始参数 + 公共组 + msToken + a_bogus（上游 _creator_signed_params）。 */
async function signedParams(d: Douyin, initial: [string, unknown][] = [], options: { platform?: boolean; msToken?: boolean; sign?: boolean; body?: string } = {}): Promise<[string, string][]> {
  const { platform = true, msToken = true, sign = true, body = '' } = options
  const p = new Params().update(initial)
  if (platform) p.update(creatorPlatformParams())
  if (msToken) p.add('msToken', await d.msToken())
  if (sign) p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs()), body, HOST))
  return p.pairs()
}

interface CreatorRequest {
  initial?: [string, unknown][]
  platform?: boolean
  msToken?: boolean
  sign?: boolean
  body?: string
  contentType?: string
  first?: [string, string][]
  referer?: string
}

/** 上游 _creator_api_request。 */
async function creatorApi(d: Douyin, method: 'GET' | 'POST', path: string, o: CreatorRequest = {}): Promise<DyJson> {
  const query = await signedParams(d, o.initial, { platform: o.platform, msToken: o.msToken, sign: o.sign, body: o.body ?? '' })
  const bodyBytes = o.body == null ? undefined : Buffer.from(o.body, 'utf8')
  const h = await xhrHeaders(d, o.referer ?? POST_VIDEO_REFERER, { contentType: o.contentType, method, first: o.first, bodyLength: bodyBytes?.length })
  const res = await d.request({ method, url: CREATOR + path, headers: h.list(), query, body: bodyBytes })
  try {
    return JSON.parse(await res.text())
  } catch {
    throw new CatbusError('UPSTREAM', `creator 接口返回的不是 JSON：${path}（HTTP ${res.status}）`)
  }
}

function ok(body: DyJson, what: string): DyJson {
  if (body.status_code != null && body.status_code !== 0) throw new CatbusError('UPSTREAM', `${what} 失败：${body.status_msg ?? body.status_code}`, { detail: { status_code: body.status_code } })
  return body
}

/**
 * V8 的 `Math.random().toString(36).substr(2)`（上游 _browser_random_s 用 node 一次取 64 个）。
 * 确定性模式下是新起的一条 mulberry32(DEFAULT_SEED) 序列，与上游 node 子进程预加载的 Math.random 相同，不占用 rand 的主序列。
 */
function browserRandomS(d: Douyin): string {
  let pool = randomPools.get(d)
  if (!pool?.length) {
    const next = rand.isDeterministic() ? rand.mulberry32(rand.DEFAULT_SEED) : rand.random
    pool = Array.from({ length: 64 }, () => next().toString(36).substring(2))
    randomPools.set(d, pool)
  }
  return pool.shift()!
}

// ---------------------------------------------------------------- 上传

/** ImageX / VOD 的 STS（上游 get_image_upload_auth，接口 /web/api/media/upload/auth/v5/）。 */
export async function uploadAuth(d: Douyin, referer = POST_VIDEO_REFERER): Promise<Sts> {
  const h = await xhrHeaders(d, referer)
  const query = await signedParams(d)
  const body = JSON.parse(await (await d.request({ url: `${CREATOR}/web/api/media/upload/auth/v5/`, headers: h.list(), query })).text())
  let sts: Sts
  try {
    sts = JSON.parse(body.auth)
  } catch {
    throw new CatbusError('UPSTREAM', `获取上传凭证失败：${body.status_msg ?? body.status_code ?? ''}`)
  }
  if (!sts.AccessKeyID || !sts.SecretAccessKey || !sts.SessionToken) throw new CatbusError('UPSTREAM', '获取上传凭证失败：字段不完整')
  return sts
}

function gatewayHeaders(sign: Record<string, string>, contentType?: string): [string, string][] {
  const h: [string, string][] = []
  if (sign['x-amz-content-sha256']) h.push(['x-amz-content-sha256', sign['x-amz-content-sha256']])
  h.push(['x-amz-security-token', sign['x-amz-security-token']!], ['x-amz-date', sign['x-amz-date']!], ['referer', `${CREATOR}/`], ['authorization', sign.authorization!], ['user-agent', PROFILE.ua])
  if (contentType) h.push(['content-type', contentType])
  h.push(['accept', '*/*'], ['accept-language', PROFILE.acceptLanguage], ['origin', CREATOR], ['priority', 'u=1, i'], ['sec-fetch-dest', 'empty'], ['sec-fetch-mode', 'cors'], ['sec-fetch-site', 'cross-site'])
  return h
}

export interface ImageInfo {
  uri: string
  width: number
  height: number
}

/** 一张图：ApplyImageUpload → TOS → CommitImageUpload（上游 upload_one_image）。 */
export async function uploadImage(d: Douyin, sts: Sts, file: LocalMedia, userId = ''): Promise<ImageInfo> {
  const applyQuery: [string, string][] = [
    ['Action', 'ApplyImageUpload'],
    ['Version', '2018-08-01'],
    ['ServiceId', IMAGEX_SERVICE_ID],
    ['app_id', IMAGEX_APP_ID],
    ['user_id', userId],
    ['s', browserRandomS(d)],
  ]
  const apply = JSON.parse(await (await d.plain({ url: `https://${IMAGEX_HOST}/`, headers: gatewayHeaders(sigv4(sts, 'GET', applyQuery)), query: applyQuery })).text())
  const addr = apply.Result?.UploadAddress
  const store = addr?.StoreInfos?.[0]
  if (!store) throw new CatbusError('UPSTREAM', 'ApplyImageUpload 失败', { detail: { error: apply.ResponseMetadata?.Error ?? null } })
  const up = JSON.parse(
    await (
      await d.plain({
        method: 'POST',
        url: `https://${addr.UploadHosts[0]}/upload/v1/${store.StoreUri}`,
        headers: [
          ['authorization', store.Auth],
          ['referer', `${CREATOR}/`],
          ['user-agent', PROFILE.ua],
          ['x-storage-u', encodeURIComponent(userId)],
          ['content-crc32', crc32Hex(file.data)],
          ['content-type', 'application/octet-stream'],
          ['content-disposition', 'attachment; filename="undefined"'],
          ['accept', '*/*'],
          ['accept-language', PROFILE.acceptLanguage],
          ['origin', CREATOR],
          ['sec-fetch-dest', 'empty'],
          ['sec-fetch-mode', 'cors'],
          ['sec-fetch-site', 'cross-site'],
        ],
        body: file.data,
      })
    ).text(),
  )
  if (up.code !== 2000) throw new CatbusError('UPSTREAM', `图片上传失败：${up.message ?? up.code}`)
  const commitQuery: [string, string][] = [
    ['Action', 'CommitImageUpload'],
    ['Version', '2018-08-01'],
    ['ServiceId', IMAGEX_SERVICE_ID],
    ['app_id', IMAGEX_APP_ID],
    ['user_id', userId],
  ]
  const body = compactJson({ SessionKey: addr.SessionKey })
  const commit = JSON.parse(
    await (
      await d.plain({ method: 'POST', url: `https://${IMAGEX_HOST}/`, headers: gatewayHeaders(sigv4(sts, 'POST', commitQuery, body), 'application/json'), query: commitQuery, body })
    ).text(),
  )
  const info = commit.Result?.PluginResult?.[0]
  if (!info) throw new CatbusError('UPSTREAM', 'CommitImageUpload 失败', { detail: { error: commit.ResponseMetadata?.Error ?? null } })
  let width = Number(info.ImageWidth ?? 0) || 0
  let height = Number(info.ImageHeight ?? 0) || 0
  if (!width || !height) ({ width, height } = imageSize(file.data))
  return { uri: info.ImageUri, width, height }
}

export interface VideoInfo {
  vid: string
  poster_uri: string
  width: number
  height: number
  duration: number
  raw: any
}

/** 一个视频：ApplyUploadInner → TOS（直传或分片）→ 重新取 STS → CommitUploadInner（上游 upload_one_video / upload_prepared_video）。 */
export async function uploadVideo(d: Douyin, sts: Sts, file: LocalMedia, userId: string): Promise<VideoInfo & { commitSts: Sts }> {
  const applyQuery: [string, string | number][] = [
    ['Action', 'ApplyUploadInner'],
    ['Version', VOD_VERSION],
    ['SpaceName', 'aweme'],
    ['FileType', 'video'],
    ['IsInner', 1],
    ['FileSize', file.data.length],
    ['app_id', IMAGEX_APP_ID],
    ['user_id', userId],
    ['s', browserRandomS(d)],
  ]
  const apply = JSON.parse(await (await d.plain({ url: `https://${VOD_HOST}/`, headers: gatewayHeaders(sigv4(sts, 'GET', applyQuery, '', 'vod')), query: applyQuery })).text())
  const n = apply.Result?.InnerUploadAddress?.UploadNodes?.[0]
  const store = n?.StoreInfos?.[0]
  if (!store) throw new CatbusError('UPSTREAM', 'ApplyUploadInner 失败', { detail: { error: apply.ResponseMetadata?.Error ?? null } })
  const node: TosNode = { store_uri: store.StoreUri, auth: store.Auth, upload_id: store.UploadID ?? '', upload_host: n.UploadHost, session_key: n.SessionKey, upload_header: n.UploadHeader ?? {} }
  await tosUpload(d, CREATOR_TOS, node, file.data, userId)
  const commitSts = await uploadAuth(d)
  const commitQuery: [string, string][] = [
    ['Action', 'CommitUploadInner'],
    ['Version', VOD_VERSION],
    ['SpaceName', 'aweme'],
    ['app_id', IMAGEX_APP_ID],
    ['user_id', userId],
  ]
  const body = compactJson({ SessionKey: node.session_key, Functions: [{ name: 'GetMeta' }, { name: 'Snapshot', input: { SnapshotTime: 0 } }] })
  const commit = JSON.parse(
    await (
      await d.plain({ method: 'POST', url: `https://${VOD_HOST}/`, headers: gatewayHeaders(sigv4(commitSts, 'POST', commitQuery, body, 'vod'), 'text/plain;charset=UTF-8'), query: commitQuery, body })
    ).text(),
  )
  const info = commit.Result?.Results?.[0]
  if (!info) throw new CatbusError('UPSTREAM', 'CommitUploadInner 失败', { detail: { error: commit.ResponseMetadata?.Error ?? null } })
  const meta = info.SourceInfo ?? info.VideoMeta ?? {}
  const vid = info.Vid ?? meta.Vid ?? ''
  if (!vid) throw new CatbusError('UPSTREAM', '提交后未拿到 vid')
  return { vid, poster_uri: info.PosterUri ?? '', width: Number(meta.Width ?? 0) || 0, height: Number(meta.Height ?? 0) || 0, duration: Number(meta.Duration ?? 0) || 0, raw: info, commitSts }
}

/** 素材的访问地址（上游 get_creator_media_url）。 */
export async function mediaUrl(d: Douyin, uri: string): Promise<string> {
  const body = ok(await creatorApi(d, 'GET', '/aweme/v1/creator/get/url/', { initial: [['uri', uri]] }), 'creator/get/url')
  const url = body.url?.url_list?.[0]
  if (!url) throw new CatbusError('UPSTREAM', 'creator/get/url 没有返回地址')
  return url
}

// ---------------------------------------------------------------- 作品管理

/**
 * 自己的作品列表（上游 get_preview_video_list，发布页的作品预览，接口 /janus/douyin/creator/pc/work_list）：
 * 实录不带 msToken / a_bogus。上游只取第一页（max_cursor=0），翻页时换成上一页返回的 max_cursor。
 */
export async function workList(d: Douyin, maxCursor: string | number = 0): Promise<DyJson> {
  return creatorApi(d, 'GET', '/janus/douyin/creator/pc/work_list', {
    initial: [
      ['scene', 'star_atlas'],
      ['device_platform', 'android'],
      ['status', 4],
      ['count', 18],
      ['max_cursor', maxCursor],
    ],
    msToken: false,
    sign: false,
  })
}

// ---------------------------------------------------------------- 发布

/** 发布前必须齐备的安全素材（上游 _require_publish_security）。 */
export function requirePublishSecurity(d: Douyin): void {
  const missing = [
    ['ticket', d.tokens.ticket],
    ['ts_sign', d.tokens.ts_sign],
    ['private_key', d.privateKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) throw authError(d.ctx, `发布需要 bd-ticket-guard 凭证（缺少 ${missing.join('、')}），请用扫码登录`)
  if (!d.ticketMatchesSession()) throw authError(d.ctx, 'ticket / ts_sign 与 cookie 不属于同一次登录，请重新登录')
  if (!d.dtraitBlob()) throw new CatbusError('AUTH_REQUIRED', `发布需要可按 path 重算的 dtrait 设备素材（${DTRAIT_BROKEN}）`, { hint: DTRAIT_HINT })
}

const jsLength = (s: string) => s.length

/** 图文的 text 与 text_extra：标题段 type 7、分隔符 type 8（上游 _build_text_and_extra）。 */
function textAndExtra(title: string, desc: string): [string, unknown[]] {
  let text = ''
  const extra: unknown[] = []
  if (title) {
    text = title
    extra.push({ start: 0, end: jsLength(title), hashtag_id: 0, hashtag_name: '', type: 7 })
  }
  if (desc) {
    if (text) {
      const start = jsLength(text)
      text += '。'
      extra.push({ start, end: start + 1, hashtag_id: 0, hashtag_name: '', type: 8 })
    }
    text += desc
  }
  return [text, extra]
}

export interface PublishOptions {
  title?: string
  desc?: string
  /** 0 公开 / 1 仅自己可见 / 2 好友可见。 */
  visibility: number
  /** 定时发布的秒级时间戳。 */
  timing?: number
  /** 允许下载，默认 true。 */
  allowDownload?: boolean
  /** 图文：用第几张图作封面（默认 0）。 */
  coverIndex?: number
  /** 图文：显式封面 uri，优先于 coverIndex。 */
  coverUri?: string
  /** 地点：写进 common.poi_id / poi_name，整个对象放进 anchor.poi。 */
  poi?: { poi_id: string; poi_name: string }
  /** 合集 ID。 */
  mixId?: string
  /** 关联热点：common.hot_sentence 取它的 word。 */
  hotSpot?: { word: string }
}

/** mix_id / poi / hot_sentence 追加到 common 末尾（上游 build_*_create_item 的可选段）。 */
function withExtras(common: Record<string, unknown>, o: PublishOptions, hotSentence: boolean): void {
  if (o.mixId) common.mix_id = o.mixId
  if (o.poi) {
    common.poi_id = o.poi.poi_id ?? ''
    common.poi_name = o.poi.poi_name ?? ''
  }
  if (hotSentence && o.hotSpot) common.hot_sentence = o.hotSpot.word ?? ''
}

/** 图文的 create_v2 item（上游 build_image_create_item）。 */
export function imageItem(images: ImageInfo[], o: PublishOptions, creationId: string): unknown {
  const [text, extra] = textAndExtra(o.title ?? '', o.desc ?? '')
  const cover = o.coverUri || images[Math.max(0, Math.min(o.coverIndex ?? 0, images.length - 1))]!.uri
  const common: Record<string, unknown> = {
    text,
    text_extra: compactJson(extra),
    activity: '[]',
    challenges: '[]',
    hashtag_source: '',
    mentions: '[]',
    visibility_type: o.visibility,
    download: o.allowDownload === false ? 0 : 1,
    timing: o.timing ? Math.trunc(o.timing) : -1,
    media_type: 2,
    images: images.map((i) => ({ uri: i.uri, width: i.width, height: i.height })),
    creation_id: creationId,
  }
  withExtras(common, o, true)
  return { item: { common, cover: { poster: cover }, anchor: o.poi ? { poi: o.poi } : {} } }
}

/** 封面编辑器状态（上游 build_video_cover_tools_extend_info，没有推荐帧时的默认结构）。 */
export function coverToolsExtendInfo(posterUri: string): unknown {
  return {
    recommendServerInfo: { res: [], times: [] },
    recommendCoverList: [],
    recommendCoverInfo: { isFromRecommend: false, isDefaultSelect: false, isRecommendClickFrom: '', selectInfo: {}, editingInfo: {} },
    recommendCoverTime: 0,
    coverInfo: { firstFrameCoverUri: posterUri, videoName: '', uri: posterUri, url: '', posterDelay: 0 },
    coverUrl: '',
    coverHorizontalInfo: null,
    coverHorizontalUrl: '',
    pasterInfo: null,
    stateInfo: null,
    croppedCoverInfo: null,
    uploadBackgroundInfo: null,
    uploadPasterInfo: null,
    uploadCoverStateInfo: null,
    xiguaCoverInfo: { posterDelay: 0 },
    xiguaPasterInfo: null,
    xiguaStateInfo: null,
    xiguaUploadCoverStateInfo: null,
    xiguaUploadBackgroundInfo: null,
    xiguaUploadPasterInfo: null,
    editXigua: false,
    coverSource: '',
    previewVideoList: [],
  }
}

/** 视频的 create_v2 item（上游 build_video_create_item，封面编辑器状态用默认结构）。 */
export function videoItem(info: VideoInfo, posterUri: string, o: PublishOptions, creationId: string): unknown {
  const title = (o.title ?? '').trim()
  const desc = (o.desc ?? '').trim()
  const common: Record<string, unknown> = {
    text: title ? `${title} ${desc}` : desc,
    caption: desc,
    item_title: title,
    activity: '[]',
    text_extra: '[]',
    challenges: '[]',
    mentions: '[]',
    hashtag_source: '',
    hot_sentence: o.hotSpot?.word ?? '',
    interaction_stickers: '[]',
    visibility_type: o.visibility,
    download: o.allowDownload === false ? 0 : 1,
    timing: o.timing ? Math.trunc(o.timing) : 0,
    creation_id: creationId,
    media_type: 4,
    video_id: info.vid,
    music_source: 0,
    music_id: null,
  }
  withExtras(common, o, false)
  const chapter = {
    chapter_abstract: '',
    chapter_details: [],
    chapter_type: 1,
    chapter_tools_info: {
      chapter_recommend_detail: [],
      chapter_recommend_abstract: '',
      chapter_source: 2,
      chapter_recommend_type: -2,
      create_date: rand.nowSeconds(),
      is_pc: '1',
      is_pre_generated: '0',
      is_syn: '1',
    },
  }
  return {
    item: {
      common,
      cover: {
        cover_text_uri: null,
        cover_text: null,
        poster: posterUri,
        poster_delay: 0,
        cover_tools_extend_info: compactJson(coverToolsExtendInfo(posterUri)),
        cover_tools_info: '{}',
      },
      mix: {},
      selected_member: { is_selected_member_video: false },
      chapter: { chapter: compactJson(chapter) },
      anchor: o.poi ? { poi: o.poi } : {},
      sync: { should_sync: false, sync_to_toutiao: 0 },
      open_platform: {},
      assistant: { is_preview: 0, is_post_assistant: 1 },
    },
  }
}

/** POST create_v2（上游 _create_aweme）。 */
export async function createAweme(d: Douyin, item: unknown, referer = POST_IMAGE_REFERER): Promise<DyJson> {
  const path = '/web/api/media/aweme/create_v2/'
  requirePublishSecurity(d)
  const bd = new Headers()
  await d.withBd(bd, path, { aid: READ_AID, origin: CREATOR, requireDtrait: true })
  const body = compactJson(item)
  const bodyBytes = Buffer.from(body, 'utf8')
  const token = await csrf(d, referer)
  if (!token) throw new CatbusError('UPSTREAM', 'create_v2 缺少 x-secsdk-csrf-token，请求未发送')
  const g = (k: string) => bd.get(k)!
  const headers: [string, string][] = [
    ['content-length', String(bodyBytes.length)],
    ['x-tt-session-dtrait', g('x-tt-session-dtrait')],
    ['bd-ticket-guard-web-version', g('bd-ticket-guard-web-version')],
    ['bd-ticket-guard-client-data', g('bd-ticket-guard-client-data')],
    ['bd-ticket-guard-web-sign-type', g('bd-ticket-guard-web-sign-type')],
    ['user-agent', PROFILE.ua],
    ['accept', 'application/json, text/plain, */*'],
    ['x-secsdk-csrf-token', token],
    ['content-type', 'application/json'],
    ['bd-ticket-guard-ree-public-key', g('bd-ticket-guard-ree-public-key')],
    ['bd-ticket-guard-version', g('bd-ticket-guard-version')],
    ['origin', CREATOR],
    ['sec-fetch-site', 'same-origin'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-dest', 'empty'],
    ['referer', referer],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', PROFILE.acceptLanguage],
    ['cookie', cookieHeader(d)],
    ['priority', 'u=1, i'],
  ]
  const p = new Params().add('read_aid', READ_AID).update(creatorPlatformParams())
  p.add('msToken', await d.msToken())
  p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs()), body, HOST))
  const res = await d.request({ method: 'POST', url: CREATOR + path, headers, query: p.pairs(), body: bodyBytes })
  return riskJson(res)
}

/** 前端 creationId：8 位小写字母数字 + 毫秒时间戳。 */
export const creationId = () => rand.string(8, 'abcdefghijklmnopqrstuvwxyz0123456789') + String(rand.now())

/** 发布图文（上游 post_images）：每张图之前重新取一份 STS。 */
export async function postImages(d: Douyin, images: LocalMedia[], o: PublishOptions): Promise<DyJson> {
  requirePublishSecurity(d)
  if (!images.length) throw new CatbusError('USAGE', '图文至少需要一张 --image')
  await bootstrap(d)
  const infos: ImageInfo[] = []
  for (const [i, img] of images.entries()) {
    const sts = await uploadAuth(d, POST_IMAGE_REFERER)
    infos.push(await uploadImage(d, sts, img, ''))
    d.ctx.log.info(`图片上传成功 [${i + 1}/${images.length}]`)
  }
  return createAweme(d, imageItem(infos, o, creationId()))
}

/** 上传用的 uid（上游 _resolve_user_id 直接调 get_my_uid）。 */
async function creatorUid(d: Douyin): Promise<string> {
  try {
    return await api.myUid(d)
  } catch (err) {
    d.ctx.log.warn(`获取 uid 失败，X-Storage-U 置空：${(err as Error).message}`)
    return ''
  }
}

/**
 * 发布视频（上游 post_video）。给了封面就先传封面（`tos-` 开头的 uri 直接用）；没给封面时用 VOD Snapshot 抽的首帧，
 * 即上游传入 cover_tools_extend_info 时的分支——上游默认的 AI 封面链依赖 OpenCV / PyAV 抽帧，Node 下不做。
 */
export async function postVideo(d: Douyin, video: LocalMedia, cover: LocalMedia | string | null, o: PublishOptions): Promise<DyJson> {
  requirePublishSecurity(d)
  await bootstrap(d)
  const userId = await creatorUid(d)
  const cid = creationId()
  await workList(d)
  ok(await creatorApi(d, 'GET', '/aweme/v1/cover/gen/ref/', { initial: [['creation_id', cid]] }), 'cover/gen/ref')
  const feats = compactJson({ has_ai_metadata: false, is_xing_tu_submit: false, has_marketing_poi: false, item_type: 'video' })
  ok(
    await creatorApi(d, 'GET', '/aweme/v3/user_declaration/suggestion/', {
      initial: [
        ['scene', 'new_self_media_before_publish'],
        ['creation_id', cid],
        ['user_decl_judge_feats', feats],
        ['libra_token', 'douyin_pc'],
      ],
    }),
    'user_declaration/suggestion',
  )
  const sts = await uploadAuth(d)
  const info = await uploadVideo(d, sts, video, userId)
  d.ctx.log.info(`视频上传成功 ${info.width}x${info.height} ${info.duration.toFixed(1)}s`)
  const poster = typeof cover === 'string' ? cover : cover ? (await uploadImage(d, info.commitSts, cover, userId)).uri : info.poster_uri
  return createAweme(d, videoItem(info, poster, o, cid), POST_VIDEO_REFERER)
}
