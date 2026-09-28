import { basename, extname } from 'node:path'
import { GUEST } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { downloadMedia, type LocalMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential, showQrcode, smsLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Category, Credential, Gift, Item, Media, NoticeCount } from '../../../core/schemas.js'
import { openSocket, reconnecting } from '../../../core/stream.js'
import { paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { bootstrapDeviceFingerprint, credentialCookies, type Json, Ks } from './client.js'
import { decodeFrame, enterRoomFrame, feedEvents, heartbeatFrame, userExitFrame } from './live.js'
import * as norm from './normalize.js'
import { CP, LIVE, UA, WWW } from './profile.js'
import { resolveItem, resolveRoom, resolveUser, selfEid } from './resolve.js'
import { type Issued, mergeIssued } from './session.js'

type Ctx = HandlerContext

/** 建立会话（相当于上游 KuaishouAuth.initialize），命令结束前把状态写回凭证。 */
async function ks(ctx: Ctx, site: 'www' | 'live' | 'cp' = 'www'): Promise<Ks> {
  const k = new Ks(ctx)
  await k.init()
  if (site === 'live') k.s.useSite(LIVE)
  else if (site === 'cp') k.s.useSite(CP)
  return k
}

/** 跑完命令后保存凭证：设备 cookie、轮换过的票据、kwfcv1 计数器。 */
async function run<T>(ctx: Ctx, site: 'www' | 'live' | 'cp', fn: (k: Ks) => Promise<T>): Promise<T> {
  const k = await ks(ctx, site)
  try {
    return await fn(k)
  } finally {
    k.save()
  }
}

const NO_MORE = new Set(['', 'no_more', '-1', 'None', 'null', 'undefined'])
const more = (cursor: unknown) => cursor != null && !NO_MORE.has(String(cursor))

/** 搜索的翻页游标：pcursor 与首屏返回的 searchSessionId 一起。 */
function searchCursor(ctx: Ctx): [string, string] {
  if (!ctx.cursor) return ['', '']
  try {
    const [p, s] = JSON.parse(ctx.cursor) as [string, string]
    return [String(p ?? ''), String(s ?? '')]
  } catch {
    throw new CatbusError('USAGE', '无效的 --cursor')
  }
}

// ================================================================ auth

/** 登录后校验：userInfoQuery 给出 eid 与昵称。 */
async function completeLogin(ctx: Ctx, k: Ks, credential: Credential) {
  k.s.useSite(WWW)
  const info = await api.userInfo(k)
  const eid = info?.eid ?? info?.id
  if (!eid) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期')
  k.save(credential)
  return finishLogin(ctx, credential, norm.ref(eid, info.name)!)
}

/** 直播站子站点：passToken 换票 + userLogin，失败只提示（直播命令会再试一次）。 */
async function liveSubsite(k: Ks): Promise<void> {
  if (!k.s.cookies.get('passToken')) return
  try {
    k.s.useSite(LIVE)
    if (!(await api.refreshLiveSession(k))) k.log.warn('直播站换票没有成功，直播相关命令会在使用时重试')
  } catch (err) {
    k.log.warn(`直播站换票失败：${(err as Error).message}`)
  }
}

/**
 * login_browser_session / _finish_mobile_browser_session 的公共后半段：
 * CP STS + CP 文档 + 设备指纹上报 → 回到 www 再导航一次文档。
 */
async function finishBrowserSession(k: Ks, issued: Issued): Promise<Issued> {
  const cp = await api.stsLogin(k, api.SID_CP, CP)
  if (!cp.some(([key]) => key === `${api.SID_CP}_ph`)) {
    throw new CatbusError('AUTH_REQUIRED', '创作者中心 STS 换票没有下发 kuaishou.web.cp.api_ph', { detail: { stage: 'cp/sts', cookies: cp.map(([key]) => key) } })
  }
  mergeIssued(issued, cp)
  mergeIssued(issued, await api.bootstrapDocument(k, CP, '/article/publish/video?origin=www.kuaishou.com'))
  const fp = await bootstrapDeviceFingerprint(k)
  k.s.useSite(WWW)
  const doc = await api.bootstrapDocument(k, WWW, '/new-reco')
  mergeIssued(issued, [
    ['wid', fp.wid],
    ['didv', fp.didv],
  ])
  mergeIssued(issued, doc)
  return issued
}

/** 登录用的新会话（上游 prepare_auth("") + _ensure_browser_defaults）。 */
function loginKs(ctx: Ctx, credential: Credential): Ks {
  const k = new Ks({ ...ctx, account: GUEST, credential })
  k.s.prepare([])
  k.s.liveBootstrapEnabled = true
  k.s.ensureBrowserDefaults()
  return k
}

async function qrcodeLogin(ctx: Ctx) {
  const credential = freshCredential(ctx, 'qrcode')
  const k = loginKs(ctx, credential)
  const sid = api.SID_WWW
  const channel = api.channelFor(sid)
  const deadline = rand.now() + 600_000
  const state = { token: '', signature: '' }
  const issue = async () => {
    const start = await api.qrStart(k, sid, channel)
    if (start?.result !== 1) return false
    state.token = start.qrLoginToken
    state.signature = start.qrLoginSignature
    await showQrcode(ctx, String(start.qrUrl ?? ''), '请用快手 App 扫码并确认')
    return true
  }
  if (!(await issue())) throw new CatbusError('UPSTREAM', '申请二维码失败', { detail: { stage: 'qr/start' } })
  const poll = async (step: 'scan' | 'accept'): Promise<Json> => {
    while (rand.now() < deadline) {
      let data: Json
      try {
        data = step === 'scan' ? await api.qrScanResult(k, state.token, state.signature, channel) : await api.qrAcceptResult(k, state.token, state.signature, sid, channel)
      } catch (err) {
        if (err instanceof CatbusError && err.code === 'NETWORK' && (err.detail as any)?.kind === 'timeout') continue
        throw err
      }
      const result = data?.result
      if (result === 1) return data
      if (result === 707) {
        if (step === 'accept' || !(await issue())) throw new CatbusError('AUTH_REQUIRED', '二维码已过期', { hint: 'catbus kuaishou auth login' })
        continue
      }
      if (result === 711 || result === 712) throw new CatbusError('AUTH_REQUIRED', '已在手机上取消登录', { detail: { result } })
      await rand.sleep(1000)
    }
    throw new CatbusError('AUTH_REQUIRED', '登录超时', { hint: 'catbus kuaishou auth login' })
  }
  await poll('scan')
  ctx.log.info('已扫码，请在手机上确认')
  const accepted = await poll('accept')
  const qrToken = accepted.qrToken ?? accepted.qr_token
  if (!qrToken) throw new CatbusError('UPSTREAM', '确认登录后没有拿到 qrToken', { detail: { stage: 'acceptResult' } })
  const [data, issued] = await api.qrCallback(k, qrToken, sid, channel)
  if (!issued.length || data?.result !== 1) throw new CatbusError('AUTH_REQUIRED', `扫码登录失败（result=${data?.result}）`, { detail: { stage: 'callback' } })
  k.s.update(issued)
  mergeIssued(issued, await api.stsLogin(k, sid))
  mergeIssued(issued, await api.bootstrapDocument(k, WWW, '/new-reco'))
  await finishBrowserSession(k, issued)
  k.s.update(issued)
  k.s.ensureBrowserDefaults()
  await liveSubsite(k)
  return completeLogin(ctx, k, credential)
}

interface SmsState extends Record<string, unknown> {
  phone: string
  cookies: [string, string][]
  kwfcv1: string
}

async function smsFlow(ctx: Ctx) {
  const credential = freshCredential(ctx, 'sms')
  let k: Ks | null = null
  return smsLogin<SmsState>(ctx, {
    send: async (phone) => {
      k = loginKs(ctx, credential)
      await k.s.current()
      const r = await api.requestMobileCode(k, phone)
      if (r?.result !== 1) {
        throw new CatbusError('UPSTREAM', `短信验证码申请失败：${r?.error_msg ?? r?.result}`, { detail: { result: r?.result } })
      }
      return { phone, cookies: [...k.s.cookies].filter(([name]) => name !== 'kwscode' && name !== 'kwssectoken'), kwfcv1: k.s.kwfcv1 }
    },
    verify: async (state, code) => {
      if (!k) {
        k = new Ks({ ...ctx, account: GUEST, credential })
        k.s.prepare(state.cookies)
        k.s.restoreCounter(state.kwfcv1)
        k.s.liveBootstrapEnabled = true
        k.s.ensureBrowserDefaults()
      }
      const [data, issued] = await api.mobileCodeLogin(k, state.phone, code)
      if (data?.result !== 1 || !data?.passToken) {
        throw new CatbusError('AUTH_REQUIRED', `验证码登录失败：${data?.error_msg ?? data?.result}`, { detail: { stage: 'mobileCode', result: data?.result } })
      }
      k.s.update(issued)
      k.s.update(issued)
      mergeIssued(issued, await api.stsLogin(k, api.SID_WWW, WWW))
      mergeIssued(issued, await api.bootstrapDocument(k, WWW, '/new-reco'))
      await finishBrowserSession(k, issued)
      k.s.update(issued)
      k.s.ensureBrowserDefaults()
      await liveSubsite(k)
      return completeLogin(ctx, k, credential)
    },
  })
}

async function cookieLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, '.kuaishou.com')
  const k = new Ks({ ...ctx, account: 'login', credential })
  await k.init(credentialCookies(credential))
  // 用户 CK 里有 passToken 但缺创作者中心票据时，补一次 CP STS（catbus 补充，失败只提示）
  if (k.s.cookies.get('passToken') && !k.s.cookies.get('kuaishou.web.cp.api_ph')) {
    try {
      await api.stsLogin(k, api.SID_CP, CP)
    } catch (err) {
      ctx.log.warn(`创作者中心换票失败：${(err as Error).message}`)
    }
  }
  if (!k.s.cookies.get('kuaishou.live.web_st')) await liveSubsite(k)
  return completeLogin(ctx, k, credential)
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  if (method === 'cookie') return cookieLogin(ctx)
  if (method === 'sms') return smsFlow(ctx)
  if (method === 'qrcode') return qrcodeLogin(ctx)
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  return run(ctx, 'www', async (k) => {
    const info = await api.userInfo(k)
    const eid = info?.eid ?? info?.id
    return {
      logged_in: Boolean(eid),
      user: eid ? norm.ref(eid, info.name) : null,
      method: eid ? ctx.credential.method : null,
      expires_at: null,
    }
  })
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    if (ctx.args.user === 'me') {
      const p = k.check(await api.profile(k), 'profile/get')
      return norm.selfUser(p)
    }
    const eid = await resolveUser(k, ctx.args.user!)
    const r = await api.profileReduced(k, eid)
    if (r?.result !== 1 || !r.userProfile) throw new CatbusError('UPSTREAM', `用户不存在或不可见（result=${r?.result}）`, { detail: { result: r?.result, user: eid } })
    return norm.reducedUser(r)
  })
}

export async function userSearch(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const [pcursor, session] = searchCursor(ctx)
    const r = k.check(await api.searchUser(k, ctx.args.keyword!, pcursor, session), '搜索')
    const list = (r.users ?? r.list ?? []).map(norm.listUser)
    const next = r.pcursor
    return paged(list, JSON.stringify([next, r.searchSessionId ?? session]), list.length > 0 && more(next))
  })
}

export async function userItems(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const eid = await resolveUser(k, ctx.args.user!)
    const r = k.check(await api.profileFeed(k, eid, ctx.cursor ?? ''), 'profile/feed')
    const list = (r.feeds ?? []).map((f: Json) => norm.feed(f))
    return paged(list, r.pcursor, list.length > 0 && more(r.pcursor))
  })
}

/** 快手只能看自己的点赞、关注、粉丝。 */
function onlyMe(ctx: Ctx, what: string): void {
  const u = ctx.args.user ?? 'me'
  if (u !== 'me') throw new CatbusError('UNSUPPORTED', `快手只能查看自己的${what}`, { hint: `catbus kuaishou ${ctx.resource} ${ctx.action}` })
}

export async function userLikes(ctx: Ctx) {
  onlyMe(ctx, '点赞')
  return run(ctx, 'www', async (k) => {
    const r = k.check(await api.likedList(k, ctx.cursor ?? ''), 'feed/liked')
    const list = (r.feeds ?? []).map((f: Json) => norm.feed(f))
    return paged(list, r.pcursor, list.length > 0 && more(r.pcursor))
  })
}

export async function userCollects(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const eid = await resolveUser(k, ctx.args.user ?? 'me')
    const r = k.check(await api.collectList(k, eid, ctx.cursor ?? ''), 'collect/list')
    const list = (r.feeds ?? []).map((f: Json) => norm.feed(f))
    return paged(list, r.pcursor, list.length > 0 && more(r.pcursor))
  })
}

async function relation(ctx: Ctx, ftype: 1 | 2) {
  onlyMe(ctx, ftype === 1 ? '关注' : '粉丝')
  return run(ctx, 'www', async (k) => {
    await selfEid(k)
    const r = k.check(await api.relation(k, ftype, ctx.cursor ?? ''), 'relation/fol')
    const list = (r.authors ?? r.fols ?? r.users ?? []).map(norm.listUser)
    return paged(list, r.pcursor, list.length > 0 && more(r.pcursor))
  })
}
export const userFollowers = (ctx: Ctx) => relation(ctx, 2)
export const userFollowing = (ctx: Ctx) => relation(ctx, 1)

// ================================================================ item

async function detailOf(k: Ks, input: string): Promise<Json> {
  return api.videoDetail(k, await resolveItem(k, input))
}

export async function itemGet(ctx: Ctx) {
  return run(ctx, 'www', async (k) => norm.detail(await detailOf(k, ctx.args.item!)))
}

export async function itemSearch(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const [pcursor, session] = searchCursor(ctx)
    const r = k.check(await api.searchFeed(k, ctx.args.keyword!, pcursor, session), '搜索')
    const list = (r.feeds ?? r.list ?? []).map((f: Json) => norm.feed(f))
    return paged(list, JSON.stringify([r.pcursor, r.searchSessionId ?? session]), list.length > 0 && more(r.pcursor))
  })
}

export async function itemRelated(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const r = await api.shortVideoReco(k, await resolveItem(k, ctx.args.item!))
    return paged((r.feeds ?? []).map((f: Json) => norm.feed(f)), null, false)
  })
}

/** 作品管理页的作品列表（创作者中心），带审核状态。 */
/** 作品管理页的时间范围：服务端拒绝超过一年的范围（「时间范围不能大于1年」），取最近 365 天。 */
const WORKS_RANGE_MS = 365 * 86_400_000
const WORKS_PAGE = 20

export async function itemList(ctx: Ctx) {
  return run(ctx, 'cp', async (k) => {
    const now = rand.now()
    const cursor = ctx.cursor ? Number(ctx.cursor) : now
    const r = k.check(
      await api.videoPhotoList(k, { queryType: '0', cursor, startTime: now - WORKS_RANGE_MS, endTime: now, limit: WORKS_PAGE, timeRangeType: 5, keyword: '' }),
      '作品管理',
    )
    const rows: Json[] = r.data?.list ?? []
    const list = rows.map(norm.work)
    // nextCursor 是本页最后一条的时间减 1 毫秒；一页不满说明没有更早的作品了
    const next = r.data?.nextCursor
    return paged(list, next, rows.length >= WORKS_PAGE && more(next))
  })
}

export async function itemMedia(ctx: Ctx): Promise<Media[]> {
  return run(ctx, 'www', async (k) => norm.photoMedia((await detailOf(k, ctx.args.item!)).photo))
}

export async function itemDownload(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const d = await detailOf(k, ctx.args.item!)
    return downloadMedia(ctx, k.http, String(d.photo?.id), norm.photoMedia(d.photo), {
      headers: [
        ['user-agent', UA],
        ['referer', 'https://www.kuaishou.com/'],
      ],
    })
  })
}

// ---------------------------------------------------------------- 发布与上传（publish_api.py）

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 图文上传的 wire 合同是 image/png：非 PNG 先转成 PNG（上游用 Pillow，这里用 @napi-rs/canvas）。 */
async function toPng(file: LocalMedia): Promise<LocalMedia> {
  if (Buffer.from(file.data.subarray(0, 8)).equals(PNG_SIGNATURE)) return file
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  let image
  try {
    image = await loadImage(Buffer.from(file.data))
  } catch {
    throw new CatbusError('USAGE', `无法读取图片：${file.filename}`)
  }
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  const stem = basename(file.filename, extname(file.filename)) || 'image'
  return { data: new Uint8Array(await canvas.encode('png')), filename: `${stem}.png`, contentType: 'image/png' }
}

/** ksuploader：resume → 逐片 fragment → complete。服务端已有的分片跳过。 */
async function uploadBytes(k: Ks, token: string, endpoints: string[], data: Uint8Array, afterResume?: () => Promise<void>): Promise<void> {
  if (!endpoints.length) throw new CatbusError('UPSTREAM', 'upload/pre 没有下发上传地址')
  const base = api.uploadBase(endpoints[0]!)
  const info = await api.uploadResume(k, base, token)
  const d = info?.data ?? info ?? {}
  const done = new Set<number>((d.fragment_list ?? d.fragmentList ?? []).map((f: Json) => Number(f?.id)))
  const hint = Number(d.fragment_index ?? d.fragmentIndex ?? -1)
  if (!done.size && hint >= 0) for (let i = 0; i <= hint; i++) done.add(i)
  if (afterResume) await afterResume()
  const count = Math.max(1, Math.ceil(data.length / api.CHUNK_SIZE))
  if (!d.existed) {
    for (let i = 0; i < count; i++) {
      if (done.has(i)) continue
      const start = i * api.CHUNK_SIZE
      const chunk = data.subarray(start, Math.min(start + api.CHUNK_SIZE, data.length))
      k.log.info(`上传 ${i + 1}/${count}`)
      await api.uploadFragment(k, base, token, i, chunk, start, data.length)
    }
  }
  await api.uploadComplete(k, base, token, count)
}

interface AtlasUpload {
  fileId: Json
  atlasId: Json
  blobKeys: string[]
  urls: (string | null)[]
}

/** upload_atlas_images：权限预检 → 图文编辑器预请求 → 逐图 pre / 上传 / single finish → 单图草稿快照。 */
async function uploadAtlas(k: Ks, inputs: LocalMedia[]): Promise<AtlasUpload> {
  if (!inputs.length || inputs.length > 31) throw new CatbusError('USAGE', '图文需要 1～31 张图片')
  const images: LocalMedia[] = []
  for (const input of inputs) {
    if (input.data.length >= MAX_IMAGE_BYTES) throw new CatbusError('USAGE', `${input.filename} 超过 15MB`)
    images.push(await toPng(input))
  }
  if (k.s.cookies.get('kwpsecproductname') !== 'onvideo-cp') k.s.useSite(CP)
  await api.requirePublishAuthority(k)
  for (const [label, r] of [
    ['realize/entrance', await api.atlasRealizeEntrance(k)],
    ['activity/list', await api.activityList(k, 'initial', 'atlas')],
    ['collection/canAddAtlas', await api.collectionCanAddAtlas(k)],
  ] as const) {
    if (r?.result !== 1) throw new CatbusError('UPSTREAM', `图文发布预检 ${label} 没有通过`, { detail: { result: r?.result, message: r?.message } })
  }
  let fileId: Json = null
  let atlasId: Json = null
  let resumed = false
  const blobKeys: string[] = []
  const urls: (string | null)[] = []
  for (const [i, image] of images.entries()) {
    const pre = await api.atlasUploadPre(k, image.contentType, atlasId, fileId)
    if (pre?.result !== 1) throw new CatbusError('UPSTREAM', `第 ${i + 1} 张图片 upload/pre 失败：${pre?.message ?? pre?.result}`, { detail: { result: pre?.result } })
    const data = pre.data ?? {}
    fileId = data.fileId ?? fileId
    atlasId = data.atlasId ?? atlasId
    const one = data.uploadInfo?.[0] ?? {}
    if (!one.token || !one.blobKey) throw new CatbusError('UPSTREAM', `第 ${i + 1} 张图片 upload/pre 没有下发上传票据`)
    await uploadBytes(k, one.token, one.endPoints ?? one.endpoints ?? [], image.data, async () => {
      if (resumed) return
      resumed = true
      for (const r of [await api.activityList(k, 'post_resume', 'atlas'), await api.activityTab(k, 'atlas'), await api.activityFilter(k, 'atlas')]) {
        if (r?.result !== 1) throw new CatbusError('UPSTREAM', '图文编辑器活动接口没有通过', { detail: { result: r?.result } })
      }
    })
    const done = await api.atlasUploadSingleFinish(k, fileId, atlasId, one.blobKey)
    if (done?.result !== 1) throw new CatbusError('UPSTREAM', `第 ${i + 1} 张图片 single/finish 失败`, { detail: { result: done?.result } })
    blobKeys.push(one.blobKey)
    urls.push(n.url(done.data?.url?.[0]?.url))
  }
  if (images.length === 1) {
    const snap = await api.atlasSnapshotSave(k, fileId, atlasId)
    if (snap?.result !== 1) throw new CatbusError('UPSTREAM', '图文草稿快照保存失败', { detail: { result: snap?.result } })
  }
  return { fileId, atlasId, blobKeys, urls }
}

/** upload_video_file：权限预检 → 视频上传上下文 → upload/pre → 分片上传 → upload/finish。 */
async function uploadVideo(k: Ks, file: LocalMedia): Promise<Json> {
  if (!file.data.length) throw new CatbusError('USAGE', '视频文件为空')
  await api.requirePublishAuthority(k)
  await k.s.useCpUpload()
  const pre = await api.videoUploadPre(k)
  if (pre?.result !== 1) throw new CatbusError('UPSTREAM', `upload/pre 失败：${pre?.message ?? pre?.result}`, { detail: { result: pre?.result } })
  const data = pre.data ?? {}
  await uploadBytes(k, data.token, data.endPoints ?? data.endpoints ?? [], file.data)
  const finish = await api.videoUploadFinish(k, data.token, file.filename, file.contentType.startsWith('video/') ? file.contentType : 'video/mp4', file.data.length)
  if (finish?.result !== 1) throw new CatbusError('UPSTREAM', `upload/finish 失败：${finish?.message ?? finish?.result}`, { detail: { result: finish?.result } })
  if (!(Number(finish.data?.videoDuration) > 0)) throw new CatbusError('UPSTREAM', '获取视频时长失败，请换一个视频')
  return finish.data
}

function caption(o: Record<string, any>): string {
  const tags = [...((o.tag as string[] | undefined) ?? []), ...((o.topic as string[] | undefined) ?? [])].map((t) => `#${t.replace(/^#/, '')}`)
  return [[o.title, o.text].filter(Boolean).join('\n'), tags.join(' ')].filter(Boolean).join(' ')
}

export async function itemPublish(ctx: Ctx) {
  const o = ctx.options as Record<string, any>
  for (const key of ['cover', 'poi', 'category', 'mention', 'price'] as const) {
    if (o[key] != null) throw new CatbusError('UNSUPPORTED', `快手发布暂不支持 --${key}`)
  }
  const images = (o.image as string[] | undefined) ?? []
  if (!images.length === !o.video) throw new CatbusError('USAGE', '快手发布需要 --image（1～31 张）或 --video，二选一', { hint: 'catbus kuaishou item publish --image a.jpg --text "正文"' })
  const photoStatus = api.PHOTO_STATUS[(o.visibility ?? 'public') as keyof typeof api.PHOTO_STATUS]
  const publishTime = o.schedule ? Date.parse(o.schedule) : 0
  return run(ctx, 'cp', async (k) => {
    const text = caption(o)
    if (images.length) {
      const files: LocalMedia[] = []
      for (const input of images) files.push(await readMedia(k.http, input))
      const up = await uploadAtlas(k, files)
      const checked = await api.atlasUploadFinish(k, up.fileId, up.atlasId, up.blobKeys)
      if (checked?.result !== 1) throw new CatbusError('UPSTREAM', `图文审核没有通过：${checked?.message ?? checked?.result}`, { detail: { result: checked?.result } })
      const r = k.check(await api.publishAtlas(k, { caption: text, fileId: up.fileId, atlasId: up.atlasId, photoStatus, publishTime }), '图文发布')
      return n.item(
        {
          id: n.id(up.atlasId ?? up.fileId),
          kind: 'image',
          text: text || null,
          media: up.urls.filter((u): u is string => Boolean(u)).map((url, i) => n.media({ id: up.blobKeys[i] ?? null, type: 'image', url })),
          status: o.visibility === 'private' ? 'private' : 'reviewing',
        },
        r,
      )
    }
    const file = await readMedia(k.http, o.video)
    const info = await uploadVideo(k, file)
    const r = k.check(
      await api.publishVideo(k, {
        fileId: Number(info.fileId),
        coverKey: String(info.coverKey ?? ''),
        mediaId: String(info.mediaId ?? ''),
        videoDuration: Number(info.videoDuration),
        caption: text,
        photoStatus,
        publishTime,
      }),
      '视频发布',
    )
    const fallback = n.item({ id: n.id(info.fileId), kind: 'video', text: text || null, status: o.visibility === 'private' ? 'private' : 'reviewing' }, r)
    const published = await afterVideoPublish(k, String(info.coverKey ?? '')).catch((err) => {
      k.log.warn(`发布已提交，但取发布状态失败：${(err as Error).message}`)
      return null
    })
    if (!published) return fallback
    return { ...published, text: published.text ?? fallback.text, status: o.visibility === 'private' ? 'private' : published.status }
  })
}

/**
 * 视频提交后浏览器跳到作品管理页（status=2&from=publish）：photo/list 拿到这次发布的 publishId，
 * 再 publish/refresh 取一次发布状态（上游 video_photo_list(post_publish) + video_publish_refresh）。
 * 这一行对不上本次上传（不是唯一一行、已有 workId、封面不是这次的）时不轮询，只用列表里的数据。
 */
async function afterVideoPublish(k: Ks, coverKey: string): Promise<Item | null> {
  const now = rand.now()
  const list = await api.videoPhotoList(k, { queryType: '2', cursor: now, startTime: now - WORKS_RANGE_MS, endTime: now, limit: WORKS_PAGE, timeRangeType: 5, keyword: '' }, { postPublish: true })
  if (list?.result !== 1) return null
  const rows: Json[] = list.data?.list ?? []
  const id = api.publishRefreshId(list, coverKey)
  if (id == null) return rows.length === 1 && rows[0]?.unPublishCoverKey === coverKey ? norm.work(rows[0]) : null
  const refresh = await api.videoPublishRefresh(k, [id])
  return norm.publishedWork(rows[0], refresh?.result === 1 ? refresh : null)
}

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  return run(ctx, 'cp', async (k) => {
    const file = await readMedia(k.http, ctx.args.file!)
    if (file.contentType.startsWith('video/')) {
      const info = await uploadVideo(k, file)
      return n.media({ id: n.id(info.fileId), type: 'video', url: `${CP}/rest/cp/works/v2/video/pc/upload/cover/view?coverKey=${encodeURIComponent(String(info.coverKey ?? ''))}` }, info)
    }
    const up = await uploadAtlas(k, [file])
    return n.media({ id: up.blobKeys[0] ?? null, type: 'image', url: up.urls[0] ?? '' }, up)
  })
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  if (ctx.options.product) throw new CatbusError('NOT_IMPLEMENTED', 'kuaishou 的 comment list --product 尚未实现', { detail: { upstream: 'none' } })
  return run(ctx, 'www', async (k) => {
    const photoId = await resolveItem(k, ctx.args.item!)
    const r = await api.commentListGql(k, photoId, ctx.cursor ?? '')
    const list = (r.rootCommentsV2 ?? r.rootComments ?? []).map((c: Json) => norm.comment(c, photoId))
    const next = r.pcursorV2 ?? r.pcursor
    return paged(list, next, list.length > 0 && more(next))
  })
}

export async function commentReplies(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const photoId = await resolveItem(k, ctx.args.item!)
    const root = ctx.args.comment!
    const r = await api.subCommentList(k, photoId, root, ctx.cursor ?? '')
    const list = (r.subCommentsV2 ?? r.subComments ?? []).map((c: Json) => norm.comment(c, photoId, root))
    const next = r.pcursorV2 ?? r.pcursor
    return paged(list, next, list.length > 0 && more(next))
  })
}

// ================================================================ feed

/** recommend 是 new-reco 的推荐流（get_feed_hot，上游 docstring：“获取推荐流（精彩推荐）”）；following 是关注页。 */
export async function feedList(ctx: Ctx) {
  const kind = (ctx.options.kind as string) ?? 'recommend'
  return run(ctx, 'www', async (k) => {
    if (kind === 'following') {
      const r = await api.likeData(k)
      if (r?.result != null && r.result !== 1) k.check(r, '关注流')
      return paged((r.feeds ?? []).map((f: Json) => norm.feed(f)), null, false)
    }
    const r = k.check(await api.feedHot(k, ctx.cursor ?? ''), 'feed/hot')
    const list = (r.feeds ?? []).map((f: Json) => norm.feed(f))
    return paged(list, r.pcursor, list.length > 0 && more(r.pcursor))
  })
}

// ================================================================ live

const ROOM_CACHE_TTL = 6 * 3600_000
const ROOM_CACHE_MAX = 200

/** 首页列表里的直播间快照（上游 find_live_room 把它交给 LiveDanmakuClient，避免首页轮换后找不到）。 */
function rememberRooms(ctx: Ctx, items: Json[]): void {
  const cache = { ...((ctx.credential.extra.live_rooms as Record<string, Json>) ?? {}) }
  for (const item of items) {
    const eid = String(item?.author?.id ?? '')
    if (!item?.id || !eid) continue
    cache[eid] = { id: item.id, caption: item.caption, poster: item.poster, living: item.living, watchingCount: item.watchingCount, author: { id: eid, name: item.author?.name, living: item.author?.living }, at: rand.now() }
  }
  const entries = Object.entries(cache).sort((a, b) => Number(b[1].at) - Number(a[1].at)).slice(0, ROOM_CACHE_MAX)
  ctx.credential.extra.live_rooms = Object.fromEntries(entries)
}

function homeRooms(home: Json): Json[] {
  const out: Json[] = []
  for (const section of home?.list ?? []) for (const group of section?.gameLiveInfo ?? []) for (const item of group?.liveInfo ?? []) if (item?.id && item?.author?.id) out.push(item)
  return out
}

/** get_room_state：在直播首页 home/list 里找这个主播的直播间（拿 liveStreamId），找不到时用最近见过的快照。 */
async function roomState(k: Ks, eid: string): Promise<Json> {
  const rooms = homeRooms(k.checkLive(await api.homeList(k)))
  rememberRooms(k.ctx, rooms)
  const found = rooms.find((item) => String(item.author.id) === eid)
  if (found) return found
  const cached = (k.ctx.credential.extra.live_rooms as Record<string, Json> | undefined)?.[eid]
  if (cached && rand.now() - Number(cached.at) < ROOM_CACHE_TTL) return cached
  throw new CatbusError('UPSTREAM', `直播首页列表里没有这个直播间：${eid}`, { hint: 'catbus kuaishou live list 查看当前可访问的直播间', detail: { room: eid } })
}

export async function liveGet(ctx: Ctx) {
  return run(ctx, 'live', async (k) => norm.liveRoom(await roomState(k, await resolveRoom(k, ctx.args.room!))))
}

export async function liveList(ctx: Ctx) {
  return run(ctx, 'live', async (k) => {
    const items = homeRooms(k.checkLive(await api.homeList(k)))
    rememberRooms(ctx, items)
    const seen = new Set<string>()
    const rooms = []
    for (const item of items) {
      const eid = String(item.author.id)
      if (seen.has(eid)) continue
      seen.add(eid)
      rooms.push(norm.liveRoom(item))
    }
    rooms.sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live'))
    return paged(rooms, null, false)
  })
}

export async function liveCategories(ctx: Ctx): Promise<Category[]> {
  return run(ctx, 'live', async (k) => {
    const d = k.checkLive(await api.categoryClassify(k))
    const out: Category[] = []
    const parents = new Set<string>()
    for (const c of d.list ?? []) {
      const parent = n.idOrNull(c.categoryAbbr)
      if (parent && !parents.has(parent)) {
        parents.add(parent)
        out.push(n.category({ id: parent, name: String(c.categoryName ?? parent) }))
      }
      out.push(n.category({ id: n.id(c.id), name: String(c.name ?? ''), parent_id: parent }, c))
    }
    return out
  })
}

export async function liveGifts(ctx: Ctx): Promise<Gift[]> {
  return run(ctx, 'live', async (k) => {
    const eid = await resolveRoom(k, ctx.args.room!)
    const room = await roomState(k, eid)
    // 进房间时的首屏列表，再点开“更多礼物”（sortType=0）取全量
    const first: Json[] = k.checkLive(await api.giftList(k, String(room.id), eid)).gifts ?? []
    const all: Json[] = k.checkLive(await api.giftList(k, String(room.id), eid, 0)).gifts ?? []
    return (all.length ? all : first).map(norm.gift)
  })
}

export async function liveReplays(ctx: Ctx) {
  return run(ctx, 'www', async (k) => {
    const eid = await resolveUser(k, ctx.args.user!)
    const r = k.check(await api.playbackList(k, eid, ctx.cursor ?? ''), '直播回放')
    const rows: Json[] = r.list ?? r.playbackList ?? r.feeds ?? r.data?.list ?? []
    const list = rows.map((v) => norm.playback(v, eid))
    const next = r.pcursor ?? r.data?.pcursor
    return paged(list, next, list.length > 0 && more(next))
  })
}

/** 直播弹幕长连（上游 ks_apis/live_ws.py 的 LiveDanmakuClient）。 */
export function liveListen(ctx: Ctx) {
  return (async function* () {
    const k = await ks(ctx, 'live')
    try {
      const eid = await resolveRoom(k, ctx.args.room!)
      const referer = api.roomReferer(eid)
      if (!k.s.cookies.get('kuaishou.live.web_st') || !k.s.cookies.get('kuaishou.live.web_ph')) {
        if (!k.s.cookies.get('passToken') || !(await api.refreshLiveSession(k, referer))) {
          throw new CatbusError('AUTH_REQUIRED', '快手直播弹幕需要登录（缺少直播站票据）', { hint: 'catbus kuaishou auth login' })
        }
      }
      const room = await roomState(k, eid)
      const liveStreamId = String(room.id)
      if (!(room.living || room.author?.living)) ctx.log.warn(`主播当前可能不在播：${eid}`)
      let info = (await api.websocketInfo(k, liveStreamId, eid))?.data ?? {}
      if (!info.token) {
        ctx.log.info('websocketinfo 没有给 token，重建直播会话后重试')
        if (await api.refreshLiveSession(k)) info = (await api.websocketInfo(k, liveStreamId, eid))?.data ?? {}
      }
      if (info.result === 400002 || (info.result === 2 && !info.token)) {
        throw new CatbusError('RISK_CONTROL', '快手直播风控拦截：需要先在浏览器里过一次滑块验证', { detail: { kind: info.result === 400002 ? 'captcha' : 'blocked', result: info.result } })
      }
      const token = String(info.token ?? '')
      const urls: string[] = info.websocketUrls ?? []
      if (!token || !urls.length) throw new CatbusError('UPSTREAM', 'websocketinfo 没有给 token 或接入地址', { detail: { result: info.result } })
      // 礼物名：首屏礼物列表 + 房间的完整礼物字典（allgifts，含不在面板上的礼物）
      const gifts = new Map<string, string>()
      for (const [label, load] of [
        ['礼物列表', () => api.giftList(k, liveStreamId, eid)],
        ['礼物字典', () => api.emojiAllGifts(k, eid)],
      ] as const) {
        try {
          for (const [id, name] of norm.giftNames(k.checkLive(await load()))) gifts.set(id, name)
        } catch (err) {
          ctx.log.debug(`${label}获取失败：${(err as Error).message}`)
        }
      }
      k.save()
      yield* reconnecting(ctx, async function* (attempt) {
        const url = urls[attempt % urls.length]!
        const socket = await openSocket(url, { headers: { Origin: LIVE, 'User-Agent': UA }, signal: ctx.signal })
        let beat: ReturnType<typeof setInterval> | null = null
        try {
          await socket.send(enterRoomFrame(token, liveStreamId, attempt))
          for await (const raw of socket.messages) {
            if (typeof raw === 'string') continue
            const frame = decodeFrame(raw)
            ctx.log.debug(`ws ${frame.type}`)
            if (frame.type === 'SC_ENTER_ROOM_ACK' && !beat) {
              const interval = Math.max(1000, Number(frame.payload?.heartbeatIntervalMs ?? 20000))
              beat = setInterval(() => void socket.send(heartbeatFrame(rand.now())).catch(() => {}), interval).unref()
            } else if (frame.type === 'SC_FEED_PUSH') {
              yield* feedEvents(frame.payload, (id) => gifts.get(id) ?? null)
            } else if (frame.type === 'SC_ERROR') {
              ctx.log.warn(`直播服务端报错：${JSON.stringify(frame.payload)}`)
            }
          }
        } finally {
          if (beat) clearInterval(beat)
          await socket.send(userExitFrame(rand.now())).catch(() => {})
          socket.close()
        }
      })
    } finally {
      k.save()
    }
  })()
}

// ================================================================ notice

/** 创作者中心未读通知数。 */
export async function noticeCount(ctx: Ctx): Promise<NoticeCount> {
  return run(ctx, 'cp', async (k) => {
    const r = k.check(await api.notificationUnreadCount(k), '通知')
    const d = r.data ?? {}
    const num = (...keys: string[]) => {
      for (const key of keys) if (typeof d[key] === 'number') return d[key] as number
      return null
    }
    const total = num('total', 'totalCount', 'unReadCount', 'unreadCount', 'count')
    return n.noticeCount(
      {
        total: total ?? undefined,
        comment: num('comment', 'commentCount'),
        mention: num('at', 'atCount', 'mention', 'mentionCount'),
        like: num('like', 'likeCount'),
        follow: num('follow', 'followCount', 'fans', 'fansCount'),
        system: num('system', 'systemCount', 'notice', 'noticeCount'),
      },
      r,
    )
  })
}

