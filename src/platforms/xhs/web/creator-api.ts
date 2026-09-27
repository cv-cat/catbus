import { CatbusError } from '../../../core/errors.js'
import * as rand from '../../../core/rand.js'
import { cspl, Creator } from './creator.js'
import { generateA1, generateWebId } from './login.js'
import { creatorProfileData, creatorRapFingerprint, generateWebsectiga, rapParam, uploadSignature, urlSign } from './js.js'
import { AS, CREATOR, CREATOR_ORDER, CREATOR_REFERENCE, CUSTOMER, EDITH, type Headers, LOGIN_LANG, navigationHeaders, orderedHeaders, ROS_UPLOAD, UA, WEB } from './profile.js'

/**
 * 上游 apis/xhs_creator_apis.py（XHS_Creator_Apis）与 apis/xhs_creator_login_apis.py（XHSCreatorLoginApi）。
 */

/** Python 的 float 写法：整数值带 `.0`。 */
const pyFloat = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x))

const NOTE_MANAGER = `${CREATOR}/new/note-manager`
const PUBLISH_REFERER = `${CREATOR}/publish/publish?source=official&from=tab_switch`
const GETDSS = /function\s+getdss\s*\(\s*\)\s*\{\s*return\s+'(\d+)'/
const SECURITY_LENGTHS: Record<string, number> = { websectiga: 64, sec_poison_id: 36, gid: 72 }

// ================================================================ 业务接口

/** get_user_info（笔记管理页的 user/info，带 cache-control / pragma）。 */
export function userInfo(c: Creator) {
  return c.request('/api/galaxy/user/info', '', 'GET', {
    referer: NOTE_MANAGER,
    site: 'same-origin',
    b1Profile: 'login',
    mnsProfile: 'publish_user_info',
    extra: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    order: CREATOR_ORDER.noteManagerUserInfo,
  })
}

/** get_posted_notes_page：page 从 0 开始，响应 data.page 是下一页游标，-1 表示结束。 */
export function postedNotes(c: Creator, page = 0, tab = 0, steady = false) {
  return c.request(cspl('/api/galaxy/v2/creator/note/user/posted', { tab: String(tab), page: String(page) }), '', 'GET', {
    referer: NOTE_MANAGER,
    site: 'same-origin',
    b1Profile: 'note_manager',
    mnsProfile: steady ? 'note_manager_steady' : 'note_manager',
    order: CREATOR_ORDER.noteManager,
    storeOrder: true,
  })
}

/** get_topic：话题搜索（edith 域）。 */
export function searchTopic(c: Creator, keyword: string) {
  return c.request('/web_api/sns/v1/search/topic', { keyword, suggest_topic_request: { title: '', desc: `#${keyword}` }, page: { page_size: 20, page: 1 } }, 'POST', { target: EDITH })
}

/** get_location_info：地点搜索（固定上海坐标，上游 get_loc_data）。 */
export function searchPoi(c: Creator, keyword: string) {
  return c.request(
    '/web_api/sns/v1/local/poi/creator/search',
    { latitude: 31.161327166987615, longitude: 121.45301809352632, keyword, page: 1, size: 50, source: 'WEB', type: 3 },
    'POST',
    { target: EDITH },
  )
}

/** get_fileIds：上传许可；406 / code=-1 时换新签名重发（最多 3 次）。 */
export async function uploadPermit(c: Creator, mediaType: 'image' | 'video'): Promise<{ permit: any; xt: string }> {
  const api = cspl('/api/media/v1/upload/creator/permit', { biz_name: 'spectrum', scene: mediaType, file_count: '1', version: '1', source: 'web' })
  let last: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await c.business(api, '', 'GET', {
      referer: PUBLISH_REFERER,
      site: 'same-origin',
      mnsProfile: mediaType === 'video' ? 'publish_permit_video' : 'publish_permit_image',
      b1Profile: 'login',
    })
    const xt = r.headers.find(([k]) => k === 'x-t')?.[1] ?? ''
    const res = await c.send({ url: r.url, headers: r.headers })
    const body = await res.json<any>().catch(() => ({}))
    last = body
    const permits = body?.data?.uploadTempPermits ?? []
    if ((body?.success || body?.data?.result?.success) && permits.length) return { permit: permits[0], xt }
    const code = body?.code ?? body?.data?.result?.code
    if ((res.status === 406 || code === -1) && attempt < 2) {
      c.ctx.log.warn(`上传许可被拒绝（HTTP ${res.status}, code=${code}），重发（${attempt + 1}/3）`)
      continue
    }
    break
  }
  throw new CatbusError('UPSTREAM', String(last?.msg ?? last?.message ?? '获取上传许可失败'), { detail: { code: last?.code } })
}

/** upload_media：申请许可 → q-signature → PUT 到 ROS。返回 fileId（及视频的 video_id）。 */
export async function uploadMedia(c: Creator, data: Uint8Array, mediaType: 'image' | 'video'): Promise<{ fileId: string; videoId: string | null }> {
  const { permit, xt } = await uploadPermit(c, mediaType)
  const host = String(permit.uploadAddr || new URL(ROS_UPLOAD).host)
  const url = host.startsWith('http') ? host : `https://${host}`
  const fileId = String(permit.fileIds[0]).split('/').at(-1)!
  const message = `${xt.slice(0, 10)};${String(permit.expireTime).slice(0, 10)}`
  const signature = uploadSignature(message, fileId, data.length, host)
  const headers: [string, string][] = [
    ['accept', '*/*'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
    ['authorization', `q-sign-algorithm=sha1&q-ak=null&q-sign-time=${message}&q-key-time=${message}&q-header-list=content-length;host&q-url-param-list=&q-signature=${signature}`],
    ['cache-control', ''],
    ['content-type', ''],
    ['origin', CREATOR],
    ['referer', `${CREATOR}/`],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', host.includes('xhscdn.com') ? 'cross-site' : 'same-site'],
    ['user-agent', c.state.release.userAgent!],
    ['x-cos-security-token', String(permit.token)],
  ]
  // ROS 上传域收不到 creator 的登录 cookie
  const res = await c.send({ method: 'PUT', url: `${url}/spectrum/${fileId}`, headers, body: data })
  if (!res.ok) throw new CatbusError('UPSTREAM', `上传失败：HTTP ${res.status}`, { detail: { status: res.status } })
  const videoId = mediaType === 'video' ? res.headers.get('X-Ros-Video-Id') : null
  if (mediaType === 'video' && !videoId) throw new CatbusError('UPSTREAM', '上传响应缺少 X-Ros-Video-Id')
  return { fileId, videoId }
}

/** query_transcode（edith 域，沿用上传许可的签名档位）。 */
export function queryTranscode(c: Creator, videoId: string) {
  return c.request(cspl('/web_api/sns/capa/postgw/query_transcode', { video_id: videoId, need_transcode: 'false', resource_type: '0' }), '', 'GET', {
    target: EDITH,
    b1Profile: 'login',
    mnsProfile: 'publish_permit',
  })
}

/** encryption：图片文件加密（www 域）。 */
export function fileEncryption(c: Creator, fileId: string) {
  return c.request(cspl('/web_api/sns/v5/creator/file/encryption', { file_id: fileId, type: 'image', ts: String(rand.now()), sign: urlSign(fileId) }), '', 'GET', { target: WEB })
}

const BUSINESS_BINDS =
  '{"version":1,"noteId":0,"bizType":0,"noteOrderBind":{},"notePostTiming":{},"noteCollectionBind":{"id":""},"noteSketchCollectionBind":{"id":""},"coProduceBind":{"enable":true},"noteCopyBind":{"copyable":true},"interactionPermissionBind":{"commentPermission":0},"optionRelationList":[]}'
const scheduledBinds = (postTime: number) => `{"version":1,"noteId":0,"bizType":13,"noteOrderBind":{},"notePostTiming":{"postTime":"${postTime}"},"noteCollectionBind":{"id":""}}`
const SOURCE = '{"type":"web","ids":"","extraInfo":"{\\"subType\\":\\"official\\",\\"systemId\\":\\"web\\"}"}'
const CONTEXT_JSON = '{"recommend_title":{"recommend_title_id":"","is_use":3,"used_index":-1},"recommendTitle":[],"recommend_topics":{"used":[]}}'

export interface ImageInfo {
  fileId: string
  width: number
  height: number
  size: number
  mimeType: string
}

export interface VideoMeta {
  video: Record<string, unknown>
  audio: Record<string, unknown>
}

interface NoteCommon {
  title: string
  desc: string
  postTime: number | null
  postLoc: Record<string, unknown> | null
  privacy: number
}

function common(type: 'normal' | 'video', n: NoteCommon, withContext: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type,
    title: n.title,
    note_id: '',
    desc: n.desc,
    source: SOURCE,
    business_binds: n.postTime == null ? BUSINESS_BINDS : scheduledBinds(n.postTime),
    ats: [],
    hash_tag: [],
    post_loc: n.postLoc ?? {},
    privacy_info: { op_type: 1, type: n.privacy, user_ids: [] },
    goods_info: {},
    biz_relations: [],
    capa_trace_info: { contextJson: withContext },
  }
  // 浏览器实抓：未选地点时 common 里不带 post_loc
  if (!n.postLoc) delete out.post_loc
  return out
}

/** get_post_note_image_data。 */
export function imageNoteData(n: NoteCommon, images: ImageInfo[]): Record<string, any> {
  return {
    common: common('normal', n, CONTEXT_JSON),
    image_info: {
      images: images.map((i) => ({
        file_id: `spectrum/${i.fileId}`,
        width: i.width,
        height: i.height,
        metadata: { source: -1 },
        stickers: { version: 2, floating: [] },
        extra_info_json: `{"mimeType":${JSON.stringify(i.mimeType)},"image_metadata":{"bg_color":"","origin_size":${pyFloat(i.size / 1024)}}}`,
      })),
    },
    video_info: null,
  }
}

/** get_post_note_video_data。 */
export function videoNoteData(n: NoteCommon, videoFileId: string, cover: ImageInfo, meta: VideoMeta): Record<string, any> {
  const duration = Number(meta.video.duration ?? 0)
  const vid = `spectrum/${videoFileId}`
  const cid = `spectrum/${cover.fileId}`
  return {
    common: common('video', n, CONTEXT_JSON),
    image_info: null,
    video_info: {
      fileid: vid,
      file_id: vid,
      format_width: meta.video.width || 0,
      format_height: meta.video.height || 0,
      video_preview_type: '',
      composite_metadata: { video: meta.video, audio: meta.audio },
      timelines: [],
      cover: {
        fileid: cid,
        file_id: cid,
        height: cover.height || meta.video.height || 0,
        width: cover.width || meta.video.width || 0,
        frame: { ts: 0, is_user_select: false, is_upload: false },
        stickers: { version: 2, neptune: [] },
        fonts: [],
        extra_info_json: '{}',
      },
      chapters: [],
      chapter_sync_text: false,
      segments: {
        count: 1,
        need_slice: false,
        items: [{ mute: 0, speed: 1, start: 0, duration: Math.round((duration / 1000) * 1000) / 1000, transcoded: 0, media_source: 1, original_metadata: { video: meta.video, audio: meta.audio } }],
      },
      entrance: 'web',
    },
  }
}

/** post_note 的最后一步：签名（referer 是站点根）+ Creator rap 指纹 + 边缘拒绝（code=-1）重试。 */
export async function postNote(c: Creator, data: Record<string, unknown>): Promise<any> {
  const api = '/web_api/sns/v2/note'
  const r = await c.business(api, data, 'POST', { referer: `${CREATOR}/`, target: EDITH, order: null })
  const rap = rapParam(api, r.body, creatorRapFingerprint())
  const headers: [string, string][] = r.headers.filter(([k]) => k !== 'cookie')
  // 上游不排序：模板顺序 + x-rap-param，curl_cffi 再追加 cookie 与 accept-encoding
  headers.push(['x-rap-param', rap], ...r.headers.filter(([k]) => k === 'cookie'), ['accept-encoding', 'gzip, deflate, br, zstd'])
  let body: any
  for (let attempt = 0; attempt < 3; attempt++) {
    body = await c.json({ method: 'POST', url: r.url, headers, body: r.body })
    if (body?.success || body?.code !== -1) break
    c.ctx.log.warn(`发布被边缘拒绝（code=-1），重发（${attempt + 1}/3）`)
  }
  return body
}

// ================================================================ 登录（XHSCreatorLoginApi）

type Kind = keyof typeof CREATOR_ORDER

async function jsonOf(res: Response | Awaited<ReturnType<Creator['send']>>): Promise<any> {
  try {
    return JSON.parse(await res.text())
  } catch {
    return {}
  }
}

/** 上游 _cookies_for_url：customer 域且安全 cookie 就绪时把 loadts 挪到最后。 */
function loginCookies(c: Creator, url: string): Record<string, string> {
  const cookies = c.wire(url)
  if (new URL(url).host === new URL(CUSTOMER).host && 'gid' in cookies && 'websectiga' in cookies && 'loadts' in cookies) {
    const loadts = cookies.loadts!
    delete cookies.loadts
    cookies.loadts = loadts
  }
  return cookies
}

async function signed(c: Creator, api: string, data: unknown, method: string, o: Parameters<Creator['sign']>[3]) {
  const s = await c.sign(api, data, method, { origin: CREATOR, referer: `${CREATOR}/`, site: 'same-site', trace: false, clientHints: false, ...o }, false)
  s.headers['accept-language'] = LOGIN_LANG
  return s
}

async function post(c: Creator, url: string, headers: Headers, kind: Kind, body: string, retry = false) {
  const pairs = orderedHeaders(headers, CREATOR_ORDER[kind], loginCookies(c, url))
  for (let attempt = 1; ; attempt++) {
    const res = await c.send({ method: 'POST', url, headers: pairs, body })
    if (!retry || res.status !== 406 || attempt >= 5) return res
  }
}

async function get(c: Creator, url: string, headers: Headers, kind: Kind, retry = false) {
  const pairs = orderedHeaders(headers, CREATOR_ORDER[kind], loginCookies(c, url))
  for (let attempt = 1; ; attempt++) {
    const res = await c.send({ url, headers: pairs })
    if (!retry || res.status !== 406 || attempt >= 5) return res
  }
}

const loadtsUndefined = (c: Creator) => `${c.state.loadts};undefined`

export class CreatorLogin {
  private pendingDsl = ''
  private pendingProgram = ''

  constructor(readonly c: Creator) {}

  /** 上游 generate_init_cookies（complete_security=False）：登录页导航 + 匿名 cookie + honeypot。 */
  async initCookies(): Promise<void> {
    const c = this.c
    c.jar.cookies.splice(0)
    c.resetState()
    await c.send({ url: `${CREATOR}/login`, headers: orderedHeaders(navigationHeaders(), CREATOR_ORDER.navigation, null, { optional: ['cookie'] }), redirect: 'manual' })
    const ts = rand.now()
    const a1 = generateA1()
    const webId = generateWebId(a1)
    for (const [k, v] of Object.entries({ ets: String(ts), webBuild: CREATOR_REFERENCE.release.webBuild, xsecappid: 'ugc', loadts: String(ts + rand.randint(50, 200)), a1, webId })) c.setCookie(k, v)
    c.sync()
    const h: Headers = { 'user-agent': UA, accept: 'application/json, text/plain, */*', 'accept-language': LOGIN_LANG, 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site', referer: `${CREATOR}/`, priority: 'u=1, i', origin: CREATOR, 'content-type': 'application/json' }
    await post(c, `${AS}/api/p/pj`, h, 'honeypot', '{"callFrom":"ugc"}')
  }

  /** 上游 _finish_security_bootstrap：redcaptcha → ds 程序 → sbtsource（都是 0201/nop），然后安装 DS。 */
  async bootstrap(): Promise<void> {
    const c = this.c
    const rc = await signed(c, '/api/redcaptcha/v2/getconfig', {}, 'POST', { trace: true, authorization: false, tier: '0201', b1Profile: 'login', dslPairValue: loadtsUndefined(c) })
    await post(c, `${EDITH}/api/redcaptcha/v2/getconfig`, rc.headers, 'redcaptcha', rc.body, true)

    const ds = await signed(c, '/api/sec/v1/scripting', { callFrom: 'creator-platform', callback: '', type: 'ds', appId: 'ugc' }, 'POST', { tier: '0201', b1Profile: 'login', dslPairValue: loadtsUndefined(c) })
    ds.headers['content-type'] = 'application/json'
    const body = await jsonOf(await post(c, `${AS}/api/sec/v1/scripting`, ds.headers, 'security', ds.body))
    let code = String(body?.data?.data ?? '')
    let dsl = GETDSS.exec(code)?.[1] ?? ''
    if (!dsl || !code) {
      const b = await c.dsBundle()
      dsl ||= b.dsl
      code ||= b.program
    }
    this.pendingDsl = dsl
    this.pendingProgram = code

    const sbt = await signed(c, '/api/sec/v1/sbtsource', { callFrom: 'creator-platform', appId: 'ugc' }, 'POST', { tier: '0201', b1Profile: 'login', dslPairValue: loadtsUndefined(c) })
    await post(c, `${AS}/api/sec/v1/sbtsource`, sbt.headers, 'security', sbt.body, true)
    c.state.activateSecurity(this.pendingDsl, this.pendingProgram)
  }

  /** 上游 _prepare_login_session 的后半：zones + service-ticket type=tgt 探测已有会话。 */
  async probeSession(): Promise<{ active: boolean }> {
    const c = this.c
    const zonesApi = cspl('/api/cas/customer/web/zones', { service: CREATOR })
    const z = await signed(c, zonesApi, '', 'GET', { includeOrigin: true, tier: '0101', mnsProfile: 'login_early', b1Profile: 'login' })
    z.headers['x-ratelimit-meta'] = `host=${new URL(CREATOR).host}`
    const zonesUrl = CUSTOMER + zonesApi
    const zonesPairs = orderedHeaders(z.headers, CREATOR_ORDER.casGet, loginCookies(c, zonesUrl))
    const t = await signed(c, '/api/cas/customer/web/service-ticket', { service: CREATOR, source: '', type: 'tgt' }, 'POST', { tier: '0101', mnsProfile: 'login_early', b1Profile: 'login' })
    t.headers['x-ratelimit-meta'] = `host=${new URL(CREATOR).host}`
    const ticketUrl = `${CUSTOMER}/api/cas/customer/web/service-ticket`
    const ticketPairs = orderedHeaders(t.headers, CREATOR_ORDER.casPost, loginCookies(c, ticketUrl))
    try {
      for (let i = 1; i <= 5; i++) if ((await c.send({ url: zonesUrl, headers: zonesPairs })).status !== 406) break
    } catch (err) {
      c.ctx.log.debug(`区号列表加载失败：${(err as Error).message}`)
    }
    let res
    for (let i = 1; i <= 5; i++) if ((res = await c.send({ method: 'POST', url: ticketUrl, headers: ticketPairs, body: t.body })).status !== 406) break
    const d = (await jsonOf(res!))?.data ?? {}
    return { active: Boolean(d.ticket || d.type === 'at') }
  }

  /** 上游 _complete_security：seccallback → websectiga，webprofile → gid。 */
  async completeSecurity(): Promise<void> {
    const c = this.c
    const s = await signed(c, '/api/sec/v1/scripting', { callFrom: 'creator-platform', callback: 'seccallback' }, 'POST', { tier: '0101', mnsProfile: 'login_callback', b1Profile: 'login' })
    s.headers['content-type'] = 'application/json'
    const body = await jsonOf(await post(c, `${AS}/api/sec/v1/scripting`, s.headers, 'security', s.body))
    const poison = body?.data?.secPoisonId ?? body?.data?.sec_poison_id
    const code = String(body?.data?.data ?? '')
    if (!poison || !code) throw new CatbusError('UPSTREAM', 'Creator seccallback 响应缺少 sec_poison_id 或安全程序')
    const tiga = await generateWebsectiga(code, { userAgent: UA, platform: 'Win32', pageUrl: `${CREATOR}/login` })
    c.setCookie('websectiga', tiga)
    c.setCookie('sec_poison_id', String(poison))
    c.sync()
    this.require(['websectiga', 'sec_poison_id'])
    if ((c.shared().gid ?? '').length !== SECURITY_LENGTHS.gid) {
      const data = { platform: 'Windows', sdkVersion: CREATOR_REFERENCE.release.webProfileSdkVersion, svn: '2', profileData: creatorProfileData(c.state.profileDataOptions(`${CREATOR}/login`, `${CREATOR}/login`)) }
      const w = await signed(c, '/api/sec/v1/shield/webprofile', data, 'POST', { tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
      w.headers['content-type'] = 'application/json'
      await post(c, `${AS}/api/sec/v1/shield/webprofile`, w.headers, 'security', w.body)
      if (c.shared().gid) c.state.p1 += 1
    }
    this.require()
  }

  require(names = Object.keys(SECURITY_LENGTHS)): void {
    const cur = this.c.shared()
    const bad = names.filter((n) => (cur[n] ?? '').length !== SECURITY_LENGTHS[n])
    if (bad.length) throw new CatbusError('RISK_CONTROL', `创作者中心安全初始化不完整：${bad.join(', ')}`, { detail: { kind: 'blocked' } })
  }

  async qrcode(): Promise<{ id: string; url: string } | null> {
    const c = this.c
    this.require()
    const s = await signed(c, '/api/cas/customer/web/qr-code', { service: CREATOR }, 'POST', { tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
    s.headers['content-type'] = 'application/json'
    const body = await jsonOf(await post(c, `${CUSTOMER}/api/cas/customer/web/qr-code`, s.headers, 'casPostNoRate', s.body))
    const d = body?.data ?? {}
    return body?.success && d.id && d.url ? { id: String(d.id), url: String(d.url) } : null
  }

  /** 1 成功、2 待扫码、3 待确认、4 过期、0 异常。 */
  async qrcodeStatus(qrId: string): Promise<number | null> {
    const c = this.c
    const api = cspl('/api/cas/customer/web/qr-code', { service: CREATOR, qr_code_id: qrId, source: '' })
    const s = await signed(c, api, '', 'GET', { includeOrigin: true, tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
    const body = await jsonOf(await get(c, CUSTOMER + api, s.headers, 'casGetNoRate'))
    const status = body?.data?.status
    return status == null ? null : Number(status)
  }

  async sendCode(phone: string, zone = '86'): Promise<{ ok: boolean; message: string }> {
    const c = this.c
    this.require()
    const s = await signed(c, '/api/cas/customer/web/verify-code', { service: CREATOR, phone, zone }, 'POST', { tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
    s.headers['content-type'] = 'application/json'
    s.headers['x-ratelimit-meta'] = `host=${new URL(CREATOR).host}`
    const body = await jsonOf(await post(c, `${CUSTOMER}/api/cas/customer/web/verify-code`, s.headers, 'casPost', s.body))
    return { ok: Boolean(body?.success), message: String(body?.msg ?? body?.message ?? '') }
  }

  async loginByCode(phone: string, code: string, zone = '86'): Promise<void> {
    const c = this.c
    this.require()
    const data = { zone, phone, verify_code: code, service: CREATOR, source: '', type: 'phoneVerifyCode' }
    const s = await signed(c, '/api/cas/customer/web/service-ticket', data, 'POST', { tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
    s.headers['content-type'] = 'application/json'
    s.headers['x-ratelimit-meta'] = `host=${new URL(CREATOR).host}`
    const body = await jsonOf(await post(c, `${CUSTOMER}/api/cas/customer/web/service-ticket`, s.headers, 'casPost', s.body))
    if (!body?.success) throw new CatbusError('AUTH_REQUIRED', String(body?.msg ?? body?.message ?? '手机号登录失败'))
  }

  /** 上游 XHSCreatorLoginApi.get_user_info：登录页的 user/info 验收。 */
  async userInfo(): Promise<any> {
    const c = this.c
    const s = await signed(c, '/api/galaxy/user/info', '', 'GET', { referer: `${CREATOR}/login`, site: 'same-origin', trace: true, includeOrigin: false, tier: '0101', mnsProfile: 'login_ready', b1Profile: 'login' })
    s.headers['content-type'] = 'application/json;charset=UTF-8'
    const body = await jsonOf(await get(c, `${CREATOR}/api/galaxy/user/info`, s.headers, 'loginUserInfo'))
    return body?.success ? (body.data ?? {}) : null
  }
}
