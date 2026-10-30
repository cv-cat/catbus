import { type FileHandle, open } from 'node:fs/promises'
import { basename } from 'node:path'
import { getConfig } from '../../../core/config.js'
import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Cookie } from '../../../core/schemas.js'
import { authError } from '../../../core/toolkit.js'
import type { BgChallenge } from './botguard.js'
import { type AttestRequest, type BrowserSession, browser, findChrome } from './browser.js'
import { retryNetwork, STUDIO_ORIGIN, type YtClient, yt } from './client.js'
import * as norm from './normalize.js'
import { videoId } from './resolve.js'
import { dataUri, type MediaSource, type StudioConfig, studio, studioConfig, uploadVideo } from './studio.js'

/**
 * YouTube Studio 的写操作：建视频（item publish）与删视频（item delete）。
 *
 * Studio 的写请求要在 context.request 里带两样东西（AGENTS 5.7）：
 * - sessionInfo.token：att/get → BotGuard → att/esr 换来的会话令牌（必要时再走 reauth 与 grst）；
 * - attestationResponseData：建视频时，上传完成后对 UNBOUND 挑战再算一次 BotGuard。
 * 顺序：先开浏览器拿到会话令牌，再上传；上传期间浏览器保持打开，上传完成后用它算 UNBOUND 的校验。
 * BotGuard 只在无头 Chromium 的 Studio 页面里算（browser.ts）；其余请求全部由 Node 发出。
 *
 * 重试规则：会话请求（att/get、att/esr、reauth、ars/grst）和 interpreter 下载在网络出错时再试一次；
 * 上传分段按同一偏移重发（studio.ts 的 uploadVideo）。建视频、删除不重试：请求可能已经生效。
 * 视频建好之后的任何失败都报 UPSTREAM 并附上视频 ID，调用方不能据此重试整条发布。
 */

type Ctx = HandlerContext

/** 可见范围：Studio 的 privacy 取值。 */
const PRIVACY = { public: 'PUBLIC', private: 'PRIVATE' } as const

/**
 * interpreter 脚本允许的来源。att/get 返回的 URL 只有这些主机会被请求：实测出现过的是 www.google.com 的 /js/th/ 路径。
 * 其他主机一律拒绝，避免把 Studio 的会话挑战交给一个不相干的地址去执行。
 */
const INTERPRETER_HOSTS = new Set(['www.google.com'])

/** 定时发布：先建成私享，到点由 YouTube 转公开。返回 Unix 秒。 */
function scheduleSec(iso: string): number {
  const sec = Math.floor(Date.parse(iso) / 1000)
  if (!(sec * 1000 > rand.now())) throw new CatbusError('USAGE', `定时发布的时间已经过去：${iso}`, { hint: '给一个将来的时间，例如 2026-11-01T20:00:00+08:00' })
  return sec
}

/** 找浏览器：config.toml 的 youtube.browser、环境变量、Playwright 缓存。 */
async function locateChrome(): Promise<string> {
  const configured = await getConfig(['youtube', 'browser'])
  return findChrome({ configured: typeof configured === 'string' ? configured : null })
}

/**
 * 一次写操作：打开 Studio 页面（带上凭证里的全部 cookie），交给 fn 使用，结束时把浏览器里轮换过的 cookie 写回凭证。
 * 浏览器只负责 BotGuard；fn 里的请求由 Node 发出。
 */
async function withBrowser<T>(c: YtClient, cfg: StudioConfig, executable: string, fn: (a: Attestor) => Promise<T>): Promise<T> {
  const jar = c.jar
  const injected = new Map(jar.cookies.map((k) => [cookieKey(k), k.value]))
  const bw = await browser.open({
    executable,
    url: `${STUDIO_ORIGIN}/channel/${cfg.channelId}/videos/upload?d=ud`,
    proxy: c.ctx.config.proxy,
    ua: c.ua,
    cookies: [...jar.cookies],
    log: c.ctx.log,
  })
  try {
    if (/accounts\.google\./.test(bw.url)) throw authError(c.ctx, 'YouTube Studio 要求登录：登录态已失效')
    return await fn(new Attestor(c, cfg, bw))
  } finally {
    const fresh = await bw.cookies().catch((err: Error) => {
      c.ctx.log.warn(`读取浏览器 cookie 失败，本次轮换的 cookie 不会写回凭证：${err.message}`)
      return null
    })
    if (fresh) {
      const synced = syncCookies(c.jar.cookies, injected, fresh)
      if (synced) c.ctx.log.info(`已把浏览器轮换的 ${synced} 个 cookie 写回凭证`)
    }
    await bw.close()
  }
}

export function cookieKey(c: { name: string; domain: string; path: string }): string {
  return `${c.name}|${c.domain}|${c.path}`
}

/**
 * 把浏览器轮换过的 cookie 写回凭证。覆盖注入时的全部域（按名字加域匹配）。
 * 只有同时满足两条才覆盖：浏览器的值与注入时不同（浏览器确实轮换了），并且 Node 侧这一份在这期间没有被改过（仍等于注入时的值）。
 * 两边都改过时，取 expires 较新的那个；expires 相同或无法比较时，保留 Node 侧的值（它是最后经过 Set-Cookie 确认的）。
 * 返回写回的个数。
 */
export function syncCookies(jar: Cookie[], injected: Map<string, string>, fresh: Cookie[]): number {
  let written = 0
  const byKey = new Map(fresh.map((f) => [cookieKey(f), f]))
  for (const c of jar) {
    const key = cookieKey(c)
    const f = byKey.get(key)
    if (!f) continue
    const browserChanged = f.value !== injected.get(key)
    const nodeChanged = c.value !== injected.get(key)
    if (!browserChanged || f.value === c.value) continue
    if (nodeChanged && !newer(f, c)) continue
    c.value = f.value
    if (f.expires != null) c.expires = f.expires
    written++
  }
  return written
}

/** a 的过期时间比 b 晚。都没有过期时间（会话 cookie）时不算更新。 */
function newer(a: Cookie, b: Cookie): boolean {
  return a.expires != null && (b.expires == null || a.expires > b.expires)
}

/** 一个写操作内的 BotGuard 与会话。 */
class Attestor {
  private readonly interpreters = new Map<string, Promise<string>>()

  constructor(
    private readonly c: YtClient,
    private readonly cfg: StudioConfig,
    private readonly bw: BrowserSession,
  ) {}

  /**
   * 会话相关的 Studio 请求（att/get、att/esr、reauth、ars/grst）只换取校验与令牌，不改动账号数据，
   * 网络出错（代理偶发断开）时再试一次。建视频、删除、metadata_update 不走这里。
   */
  call<T = any>(path: string, body: Record<string, unknown>, requestExtra: Record<string, unknown> = {}): Promise<T> {
    return retryNetwork(this.c.ctx, () => studio<T>(this.c, this.cfg, path, body, requestExtra))
  }

  /** att/get：返回 challenge 与 bgChallenge。 */
  private async challenge(engagement: Record<string, unknown>): Promise<{ challenge: string; bg: BgChallenge }> {
    const j = await this.call<any>('att/get', engagement)
    const bg = j.bgChallenge ?? j.botguardData
    if (!j.challenge || !bg) {
      throw new CatbusError('UPSTREAM', 'YouTube Studio 没有返回 BotGuard 挑战（att/get）', { hint: '页面结构可能已变更', detail: { keys: Object.keys(j ?? {}) } })
    }
    return { challenge: j.challenge, bg }
  }

  /** 在浏览器里算一次 BotGuard，返回 webResponse。interpreter 由 Node 取回，每个 URL 只取一次。 */
  private async run(bg: BgChallenge, binding: unknown): Promise<string> {
    const interpreter = await this.interpreter(bg)
    const req: AttestRequest = { bg, binding, interpreter, fallbackGlobal: 'trayride' }
    return this.bw.attest(req)
  }

  private interpreter(bg: BgChallenge): Promise<string> {
    const url = unwrap(bg.interpreterUrl, 'privateDoNotAccessOrElseTrustedResourceUrlWrappedValue') ?? unwrap(bg.interpreterSafeUrl, 'privateDoNotAccessOrElseTrustedResourceUrlWrappedValue')
    if (url) {
      const full = url.startsWith('//') ? `https:${url}` : url
      let p = this.interpreters.get(full)
      if (!p) {
        p = fetchInterpreter(this.c, full)
        this.interpreters.set(full, p)
      }
      return p
    }
    const inline = unwrap(bg.interpreterSafeScript, 'privateDoNotAccessOrElseSafeScriptWrappedValue') ?? (typeof bg.interpreterScript === 'string' ? bg.interpreterScript : null)
    if (inline) return Promise.resolve(inline)
    return Promise.reject(new CatbusError('UPSTREAM', 'BotGuard 挑战里没有 interpreter', { hint: '页面结构可能已变更' }))
  }

  /** 会话令牌：att/get（CREATOR_STUDIO_ACTION）→ BotGuard → att/esr；esr 要求 reauth 时再走 reauth 与 ars/grst。 */
  async sessionToken(): Promise<string> {
    const { challenge, bg } = await this.challenge({ engagementType: 'ENGAGEMENT_TYPE_CREATOR_STUDIO_ACTION', ids: [{ externalChannelId: this.cfg.channelId }] })
    const web = await this.run(bg, { atr_challenge: challenge })
    const esr = await this.call<any>('att/esr', { challenge, botguardResponse: web, xguardClientStatus: 0 })
    let token: string | undefined = esr.sessionToken ?? undefined
    if (esr.shouldFetchReauthSessionToken) {
      const rr = await this.call<any>('security/get_web_reauth_url', {
        continueUrl: `${STUDIO_ORIGIN}/reauth`,
        flow: 'REAUTH_FLOW_YT_STUDIO_COLD_LOAD',
        ivctx: esr.ctx,
        challenge,
        botguardResponse: web,
      })
      if (!rr.encodedReauthProofToken) {
        throw new CatbusError('RISK_CONTROL', 'YouTube 没有接受这次 BotGuard 校验（reauth 被拒绝）', {
          hint: '稍后重试，或换一个代理出口；仍然失败时到 https://studio.youtube.com 上传',
          detail: { kind: 'blocked', keys: Object.keys(rr ?? {}) },
        })
      }
      const granted = await this.call<any>('ars/grst', { ctx: rr.sessionRiskCtx }, { reauthRequestInfo: { encodedReauthProofToken: rr.encodedReauthProofToken } })
      token = granted.sessionToken
    }
    if (!token) {
      throw new CatbusError('RISK_CONTROL', 'YouTube Studio 没有发放会话令牌（sessionToken）', {
        hint: '稍后重试，或换一个代理出口',
        detail: { kind: 'blocked', keys: Object.keys(esr ?? {}) },
      })
    }
    return token
  }

  /** 建视频前的校验：上传完成后，对 UNBOUND 挑战加上 scottyResourceId 再算一次 BotGuard。 */
  async uploadAttestation(scottyResourceId: string): Promise<{ challenge: string; webResponse: string }> {
    const { challenge, bg } = await this.challenge({ engagementType: 'ENGAGEMENT_TYPE_UNBOUND' })
    const webResponse = await this.run(bg, { c: challenge, e: 'ENGAGEMENT_TYPE_VIDEO_UPLOAD', scottyResourceId })
    return { challenge, webResponse }
  }
}

/**
 * 取回 interpreter 脚本。只允许 https、白名单主机；每一跳都校验，不跟随跳转（跳转到别的主机直接拒绝）。
 * interpreter 是 Google 的静态脚本，不带 cookie，走没有 cookie 罐的客户端。
 */
export async function fetchInterpreter(c: YtClient, url: string): Promise<string> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new CatbusError('UPSTREAM', `BotGuard interpreter 地址不合法：${url}`, { hint: '页面结构可能已变更' })
  }
  if (u.protocol !== 'https:' || !INTERPRETER_HOSTS.has(u.hostname)) {
    throw new CatbusError('UPSTREAM', `拒绝加载不在白名单里的 BotGuard interpreter：${u.protocol}//${u.hostname}`, {
      hint: '页面结构可能已变更；如果这是 Google 的新静态域，需要把它加进白名单（AGENTS 5.7）',
      detail: { host: u.hostname },
    })
  }
  const req = { url: u.toString(), headers: [['User-Agent', c.ua], ['Accept', '*/*']] as [string, string][], redirect: 'manual' as const }
  const res = await retryNetwork(c.ctx, () => c.bare.request(req))
  // 跳转不跟随：Location 指向的地址必须也过白名单，这里直接拒绝，避免被重定向到别处
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? '(无 Location)'
    throw new CatbusError('UPSTREAM', `BotGuard interpreter 返回跳转，拒绝跟随：${to}`, { hint: '页面结构可能已变更', detail: { status: res.status } })
  }
  await c.check(res, 'botguard')
  const final = new URL(res.url || u.toString())
  if (final.protocol !== 'https:' || !INTERPRETER_HOSTS.has(final.hostname)) {
    throw new CatbusError('UPSTREAM', `BotGuard interpreter 的最终地址不在白名单里：${final.hostname}`, { detail: { host: final.hostname } })
  }
  return res.text()
}

/** 从 trusted-types 包装对象里取出原始值。 */
function unwrap(v: unknown, key: string): string | null {
  const inner = (v as Record<string, unknown> | null | undefined)?.[key]
  return typeof inner === 'string' && inner ? inner : null
}

/** 发布视频：读取文件 → 开浏览器拿会话令牌 → 上传 → 建视频（标题、简介、可见范围、校验）→ 标签、封面、定时发布。 */
export async function itemPublish(ctx: Ctx) {
  const c = yt(ctx)
  if (!c.loggedIn) throw authError(ctx, '发布视频需要登录')
  const o = ctx.options as Record<string, any>
  if (!o.video) throw new CatbusError('USAGE', 'YouTube 发布需要 --video', { hint: 'catbus youtube item publish --video <文件> --title <标题>' })
  if (!o.title) throw new CatbusError('USAGE', 'YouTube 发布需要 --title')
  const schedule: number | null = o.schedule ? scheduleSec(o.schedule) : null
  const executable = await locateChrome()
  const cfg = await studioConfig(c)
  const cover = o.cover ? await readMedia(c.http, o.cover) : null
  const privacy = schedule != null ? 'PRIVATE' : PRIVACY[o.visibility as keyof typeof PRIVACY]
  const media = await localVideo(c, o.video)

  // 先拿会话令牌，再上传：浏览器启动失败或 reauth 被拒时，不会白传一遍视频
  // 本地文件的句柄在命令结束时关闭（浏览器启动失败、令牌被拒等提前返回的情况也要关，Node 26 起 GC 回收未关闭的句柄会报错）
  const id = await withBrowser(c, cfg, executable, async (a) => {
    const token = await a.sessionToken()
    const uploaded = await uploadVideo(c, media)
    const att = await a.uploadAttestation(uploaded.scottyResourceId)
    const created = await studio<any>(
      c,
      cfg,
      'upload/createvideo',
      {
        channelId: cfg.channelId,
        resourceId: { scottyResourceId: { id: uploaded.scottyResourceId } },
        frontendUploadId: uploaded.frontendUploadId,
        initialMetadata: {
          title: { newTitle: o.title },
          privacy: { newPrivacy: privacy },
          draftState: { isDraft: false },
          ...(o.text ? { description: { newDescription: o.text, shouldSegment: true } } : {}),
        },
        contentLevelProtection: { enableRequiresContentLevelProtection: false },
        presumedShort: false,
      },
      { attestationResponseData: { challenge: att.challenge, webResponse: att.webResponse }, sessionInfo: { token } },
    ).catch((err: unknown) => {
      throw ambiguous(err, '建视频', { scottyResourceId: uploaded.scottyResourceId })
    })
    const videoIdNew: string | undefined = created?.videoId
    if (!videoIdNew) throw createRejected(created, uploaded.scottyResourceId)

    const update: Record<string, unknown> = {}
    if (o.tag?.length) update.tags = { newTags: o.tag }
    if (cover) update.videoStill = { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: dataUri(cover.data, cover.contentType) } }
    if (schedule != null) update.scheduledPublishing = { set: { privacy: 'PUBLIC', timeSec: String(schedule) } }
    if (Object.keys(update).length) {
      // setMetadata 的任何失败都已带上视频 ID 并报 UPSTREAM（视频已存在，不能重试整条发布）
      await setMetadata(c, cfg, token, videoIdNew, update)
    }
    return videoIdNew
  }).finally(() => media.close?.())

  return n.item({
    id,
    kind: 'video',
    url: norm.videoUrl(id),
    title: o.title,
    text: o.text ?? null,
    author: norm.channelUser(cfg.channelId, null),
    status: privacy === 'PUBLIC' ? 'reviewing' : 'private',
  })
}

/**
 * 写请求（建视频、删除）的网络错误：请求可能已经到达 YouTube 并生效，不能当作失败后重试。
 * 报 UPSTREAM，hint 说明可能已生效；其他错误原样返回。
 */
function ambiguous(err: unknown, what: string, detail: Record<string, unknown>): unknown {
  if (!(err instanceof CatbusError && err.code === 'NETWORK')) return err
  return new CatbusError('UPSTREAM', `${what}的请求没有确定结果（网络中断）：${err.message}`, {
    hint: '可能已经生效，先到 Studio 或用 item list 确认，不要直接重试',
    detail: { kind: 'ambiguous', ...detail },
  })
}

/**
 * 视频文件按段读取：本地路径从磁盘读（不整个读进内存）；URL 形式先用 readMedia 下载到内存（只有这种情况会整个读进内存）。
 */
async function localVideo(c: YtClient, input: string): Promise<MediaSource> {
  if (/^https?:\/\//i.test(input)) {
    const m = await readMedia(c.http, input)
    return {
      filename: m.filename,
      size: m.data.length,
      read: async (offset, length) => m.data.subarray(offset, offset + length),
    }
  }
  let handle: FileHandle
  try {
    handle = await open(input, 'r')
  } catch {
    throw new CatbusError('USAGE', `读取文件失败：${input}`)
  }
  const size = (await handle.stat()).size
  return {
    filename: basename(input),
    size,
    close: () => handle.close(),
    read: async (offset, length) => {
      const buf = new Uint8Array(length)
      let got = 0
      while (got < length) {
        const { bytesRead } = await handle.read(buf, got, length - got, offset + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      return buf.subarray(0, got)
    },
  }
}

/**
 * 视频已经建好之后设置标签、封面、定时发布（metadata_update）。同样的元数据设置两次结果不变，网络出错时再试一次。
 * 任何失败都带上视频 ID，并报 UPSTREAM：此时视频已经存在，用户需要知道去哪里补设置或清理。
 */
async function setMetadata(c: YtClient, cfg: StudioConfig, token: string, id: string, update: Record<string, unknown>): Promise<void> {
  const send = () => studio<any>(c, cfg, 'video_manager/metadata_update', { encryptedVideoId: id, ...update }, { sessionInfo: { token } })
  const hint = `到 https://studio.youtube.com/video/${id}/edit 手动设置`
  let res: any
  try {
    res = await retryNetwork(c.ctx, send)
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    throw new CatbusError('UPSTREAM', `视频 ${id} 已建好，但标签 / 封面 / 定时发布没有设置成功：${why}`, { hint, detail: { id } })
  }
  const result: string | undefined = res?.overallResult?.resultCode
  if (result && result !== 'UPDATE_SUCCESS') {
    // 每个字段单独返回 success（实测：tags、videoStill、scheduledPublishing 各一个），失败的字段列出来
    const failed = Object.entries(FIELD_NAMES).filter(([k]) => res?.[k]?.success === false).map(([, v]) => v)
    const what = failed.length ? failed.join('、') : '标签 / 封面 / 定时发布'
    throw new CatbusError('UPSTREAM', `视频 ${id} 已建好，但${what}没有设置成功（YouTube 返回 ${result}）`, {
      hint: failed.includes('封面') ? `${hint}。自定义封面未验证，可能需要已验证的账号` : hint,
      detail: { id, failed, result: res.overallResult },
    })
  }
}

/** metadata_update 返回里的字段名 → 中文。 */
const FIELD_NAMES: Record<string, string> = { tags: '标签', videoStill: '封面', scheduledPublishing: '定时发布' }

/** 文本的 runs 拼成一串字。 */
const runsText = (t: any): string => (Array.isArray(t?.runs) ? t.runs.map((r: any) => r?.text ?? '').join('') : '')

/**
 * Studio 没有建成视频时的原因。上传被拒时（如当天上传数超限），返回里有 contents.uploadFeedbackItemRenderer，
 * 其中 uploadStatus 为 REJECTED；这种情况不是页面结构变了，要把 YouTube 给的原因报出来。
 */
function createRejected(created: any, scottyResourceId: string): CatbusError {
  for (const item of created?.contents?.uploadFeedbackItemRenderer?.contents ?? []) {
    const st = item?.uploadStatus
    if (st?.uploadStatus !== 'REJECTED') continue
    const reason = typeof st.uploadStatusReason === 'string' ? st.uploadStatusReason : null
    const text = [runsText(st.message), runsText(st.detailedMessage)].filter(Boolean).join('：')
    if (reason === 'UPLOAD_STATUS_REASON_RATE_LIMIT_EXCEEDED') {
      return new CatbusError('RISK_CONTROL', `YouTube 拒绝了这次上传：${text || reason}`, {
        hint: '这个账号的每日上传数已用完（未验证的账号限制更多）。到 YouTube 完成手机验证，或明天再试',
        detail: { kind: 'rate_limit', reason, scottyResourceId },
      })
    }
    return new CatbusError('UPSTREAM', `YouTube 拒绝了这次上传：${text || reason || '原因未知'}`, {
      hint: '到 https://studio.youtube.com 手动上传，看页面上的提示',
      detail: { reason, scottyResourceId },
    })
  }
  return new CatbusError('UPSTREAM', '视频文件已上传，但 YouTube Studio 没有建成视频', {
    hint: '到 https://studio.youtube.com 检查有没有新草稿，确认后再决定是否重新发布',
    detail: { keys: Object.keys(created ?? {}), scottyResourceId },
  })
}

/**
 * 删除自己的视频。删除请求的网络错误可能已经生效，报 UPSTREAM 并提示先确认，不要直接重试。
 */
export async function itemDelete(ctx: Ctx) {
  const c = yt(ctx)
  if (!c.loggedIn) throw authError(ctx, '删除视频需要登录')
  const id = videoId(ctx.args.item!)
  const executable = await locateChrome()
  const cfg = await studioConfig(c)
  await withBrowser(c, cfg, executable, async (a) => {
    const token = await a.sessionToken()
    const res = await studio<any>(c, cfg, 'video/delete', { videoId: id }, { sessionInfo: { token } }).catch((err: unknown) => {
      throw ambiguous(err, `删除视频 ${id} `, { id })
    })
    if (res?.success !== true) {
      throw new CatbusError('UPSTREAM', `删除视频 ${id} 没有成功`, {
        hint: `到 https://studio.youtube.com/video/${id}/edit 确认是否还在`,
        detail: { keys: Object.keys(res ?? {}), message: res?.error?.message ?? null },
      })
    }
  })
  return { id }
}
