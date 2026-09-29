import * as rand from '../../../core/rand.js'
import { generateB1 } from './js.js'
import { CREATOR_REFERENCE, PC_REFERENCE } from './profile.js'

/**
 * 签名要用的设备 / 会话状态（上游 xhs_pc/state.py 的 PcDeviceProfile、xhs_creator/state.py 的 CreatorDeviceProfile）。
 *
 * 会话状态（loadts、dsllt、MNS seq、tiga 时间、webSsk、tab 设备 ID……）对应浏览器的 localStorage / sessionStorage，
 * 持久部分存在凭证的 `device.pc` / `device.creator`；和上游 from_cookie 一样，MNS seq 每条命令从 0 开始。
 */

export const DS_REFRESH_MS = 15 * 60 * 1000

export type Storage = Record<string, string>

export interface Material {
  tier: string
  envConst: number
  envFpTail: number[]
  deviceTag?: string
}

const tail = (hex: string) => [...Buffer.from(hex, 'hex')]
const material = (v: any): Material => ({ tier: String(v.tier), envConst: Number(v.envConst), envFpTail: tail(v.envFpTailHex), deviceTag: v.deviceTag })

/** 浏览器写 ets 时避开末位是 1 的毫秒数。 */
export const normalizeEts = (t: number) => (t % 10 === 1 ? t + 1 : t)

/** 32 位随机数：上游 `secrets.randbits(32)`。 */
export const randbits32 = () => Math.floor(rand.random() * 2 ** 32)

/** JS 的数字转字符串（与 Python `str(float)` 在这些值上一致：整数不带 .0）。 */
const num = (v: number) => String(v)

// ================================================================ PC

const PC_STAGE_BY_TIER: Record<string, string> = { '0201': 'security', '0101': 'coldContent', '0301': 'steadyContent' }

/** b1 的 19 字段采集器状态（上游 B1RuntimeState）。 */
function pcB1State(startedAt: number, profileName = '') {
  const v = { ...PC_REFERENCE.b1Reference, ...(profileName ? PC_REFERENCE.b1Profiles[profileName] : {}) }
  const overrides: Record<string, string> = { ...(v.overrides ?? {}) }
  for (const k of ['x37', 'x38', 'x82']) if (k in v) overrides[k] = String(v[k])
  return {
    frameCount: Number(v.frameCount),
    x39: Number(v.x39),
    x50: String(v.x50),
    secCanvas: String(v.secCanvas),
    generatedAtOffsetMs: v.generatedAtOffsetMs != null ? Number(v.generatedAtOffsetMs) : null,
    selectedGlobalNames: [...v.selectedGlobalNames] as string[],
    timeOrigin: startedAt + Number(v.timeOriginOffsetMs ?? 0),
    telemetryProfile: String(v.telemetryProfile ?? 'active'),
    telemetryTemplate: String(v.telemetryTemplate ?? ''),
    mouse: { ...(v.mouse ?? {}) },
    keyboard: { ...(v.keyboard ?? {}) },
    page: { ...(v.page ?? {}) },
    state: { ...(v.state ?? {}) },
    features: { ...(v.features ?? {}) },
    overrides,
  }
}

function pcB1Options(s: ReturnType<typeof pcB1State>, now: number) {
  const overrides = { ...s.overrides, x36: String(s.frameCount) } as Record<string, string>
  if (s.telemetryTemplate) overrides.x84 = s.telemetryTemplate.replace('__TIME_ORIGIN__', num(s.timeOrigin))
  return {
    now,
    x39: s.x39,
    x50: s.x50,
    secCanvas: s.secCanvas,
    windowKeys: s.selectedGlobalNames,
    telemetry: { profile: s.telemetryProfile, timeOrigin: s.timeOrigin, mouse: s.mouse, keyboard: s.keyboard, page: s.page, state: s.state, features: s.features },
    overrides,
  }
}

export interface RwpToken {
  aLt: string
  rLt?: string
  expiredAt: number | null
  uid: string
}

export class PcState {
  cookies: Record<string, string> = {}
  loadts = 0
  dsllt = 0
  ets = 0
  seq = 0
  fingerprintReady = false
  lastTiga = 0
  p1 = 0
  sc = 0
  tabDeviceId = ''
  rwpFingerprint = ''
  rwpToken: RwpToken | null = null
  webSsk = ''
  webBuild: string
  release: Record<string, string>
  stages: Record<string, Material>
  b1: ReturnType<typeof pcB1State>
  private named = new Map<string, string>()

  /** cookies 是上游 cookie_map（不含 host-only 的 acw_tc），local / session 是持久化的 storage。 */
  constructor(cookies: Record<string, string>, local: Storage = {}, session: Storage = {}) {
    this.cookies = { ...cookies }
    const started = Number(cookies.loadts || rand.now())
    this.loadts = started
    this.dsllt = Number(local.dsllt || started)
    this.ets = Number(cookies.ets || normalizeEts(started))
    this.fingerprintReady = Boolean(cookies.gid)
    this.lastTiga = Number(local.last_tiga_update_time || 0)
    this.p1 = Number(local.p1 || 0)
    this.sc = Number(local.sc || 0)
    this.tabDeviceId = session.XHS_TAB_DEVICE_ID || ''
    this.rwpFingerprint = session.XHS_RWP_FINGERPRINT || ''
    try {
      this.rwpToken = local.RWP_LOGIN_TOKEN ? JSON.parse(local.RWP_LOGIN_TOKEN) : null
    } catch {
      this.rwpToken = null
    }
    this.webSsk = local.webSsk || ''
    // 上游 ensure_tab_device_id：没有时消耗一次 uuid4
    this.tabDeviceId ||= rand.uuid4()
    this.rwpFingerprint ||= String(started)
    this.b1 = pcB1State(started)
    this.release = { ...PC_REFERENCE.release }
    this.webBuild = cookies.webBuild || this.release.webBuild!
    this.stages = Object.fromEntries(Object.entries(PC_REFERENCE.mnsStages).map(([k, v]) => [k, material(v)]))
  }

  /** 上游 update_cookies：跟进 loadts / ets / websectiga / gid 带来的状态变化。 */
  updateCookies(updates: Record<string, string>): void {
    const oldTiga = this.cookies.websectiga
    Object.assign(this.cookies, updates)
    if (updates.webBuild) this.webBuild = updates.webBuild
    if (updates.loadts) this.loadts = Number(updates.loadts)
    if (updates.ets) this.ets = Number(updates.ets)
    if (updates.websectiga && updates.websectiga !== oldTiga) this.lastTiga = rand.now()
    if (updates.gid) this.fingerprintReady = true
  }

  /** 签名 JS 能看到的 document.cookie：去掉 HttpOnly 的登录态。 */
  get documentCookie(): string {
    const hidden = new Set(['acw_tc', 'web_session', 'secure_session', 'id_token', 'customer-sso-sid', 'access-token-creator.xiaohongshu.com', 'galaxy_creator_session_id'])
    return Object.entries(this.cookies)
      .filter(([k]) => !hidden.has(k))
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  resolveTier(api: string, explicit?: string): string {
    if (explicit) return explicit
    if (this.fingerprintReady) return '0301'
    if (api.includes('/api/sec/v1/') || api.includes('/api/redcaptcha/') || api.includes('sem_sdk')) return '0201'
    return '0101'
  }

  /** 上游 next_sign_context：MNS 档位、环境常量、seq 自增、随机 version。 */
  nextSignContext(api: string, options: { tier?: string; mnsProfile?: string } = {}): Record<string, any> {
    const tier = this.resolveTier(api, options.tier)
    const m = options.mnsProfile ? material(PC_REFERENCE.loginMnsProfiles[options.mnsProfile]) : this.stages[PC_STAGE_BY_TIER[tier]!]!
    const now = rand.now()
    const context: Record<string, any> = {
      tier,
      now,
      version: randbits32(),
      loadts: this.loadts,
      seq: ++this.seq,
      envConst: m.envConst,
      envFpTail: m.envFpTail,
      webBuild: this.webBuild,
      signVersion: this.release.signVersion,
      appId: this.release.appId,
      platform: this.release.platform,
      userAgent: this.release.userAgent,
      secChUa: this.release.secChUa,
    }
    if (this.webSsk) context.webSsk = this.webSsk
    return context
  }

  currentB1(now: number, profileName?: string): string {
    if (!profileName) return generateB1(pcB1Options(this.b1, now))
    const cached = this.named.get(profileName)
    if (cached) return cached
    const s = pcB1State(this.loadts, profileName)
    const at = s.generatedAtOffsetMs != null ? this.loadts + s.generatedAtOffsetMs : now
    const value = generateB1(pcB1Options(s, at))
    this.named.set(profileName, value)
    return value
  }

  dslPair(dsl: string, now: number): string {
    if (now - this.dsllt >= DS_REFRESH_MS) this.dsllt = now
    return `${this.dsllt};${dsl}`
  }

  profileDataOptions(now: number): Record<string, unknown> {
    return {
      fields: {},
      timestampMs: now,
      ets: this.ets,
      documentCookie: this.documentCookie,
      timeOrigin: this.loadts + Number(PC_REFERENCE.webProfile.timeOriginOffsetMs ?? 0),
    }
  }

  /** 持久化的 localStorage / sessionStorage。 */
  storage(): { local: Storage; session: Storage } {
    const local: Storage = { dsllt: String(this.dsllt), last_tiga_update_time: String(this.lastTiga), p1: String(this.p1), sc: String(this.sc) }
    if (this.webSsk) local.webSsk = this.webSsk
    if (this.rwpToken) local.RWP_LOGIN_TOKEN = JSON.stringify(this.rwpToken)
    return { local, session: { XHS_TAB_DEVICE_ID: this.tabDeviceId, XHS_RWP_FINGERPRINT: this.rwpFingerprint } }
  }
}

// ================================================================ Creator

/** Creator 页面的 b1 采集器（上游 CreatorB1RuntimeState；传了 started_at 的都不抖动）。 */
function creatorB1State(startedAt: number, profileName = 'login') {
  const v = { ...CREATOR_REFERENCE.b1Reference, ...(['', 'login', 'default'].includes(profileName) ? {} : CREATOR_REFERENCE.b1Profiles[profileName]) }
  return {
    frameCount: Number(v.frameCount),
    x39: Number(v.x39),
    x50: String(v.x50),
    x51: String(v.x51 ?? ''),
    generatedAtOffsetMs: v.generatedAtOffsetMs != null ? Number(v.generatedAtOffsetMs) : null,
    secCanvas: String(v.secCanvas),
    x37: String(v.x37),
    x38: String(v.x38),
    selectedGlobalNames: [...v.selectedGlobalNames] as string[],
    timeOrigin: startedAt + Number(v.timeOriginOffsetMs ?? 0),
    mouse: { ...(v.mouse ?? {}) } as Record<string, unknown>,
    keyboard: { ...(v.keyboard ?? {}) } as Record<string, unknown>,
    page: { ...(v.page ?? {}) } as Record<string, unknown>,
    state: { ...(v.state ?? {}) } as Record<string, unknown>,
    features: { ...(v.features ?? {}) } as Record<string, any>,
  }
}

const atom = (v: unknown) => (v == null ? 'null' : v === true ? 'true' : v === false ? 'false' : String(v))
const mapText = (v: Record<string, unknown>) => Object.entries(v).map(([k, x]) => `${k}:${atom(x)}`).join(',')

function creatorTelemetry(s: ReturnType<typeof creatorB1State>): string {
  const f: Record<string, any> = { ae: null, ak: null, cdr: null, bf: null, fi: null, ...s.features }
  const bf = f.bf == null ? 'null' : `{ar:${atom(f.bf.ar)},fr:${atom(f.bf.fr)}}`
  return (
    `{mt:{to:${num(s.timeOrigin)}},m:{${mapText(s.mouse)}},k:{${mapText(s.keyboard)}},p:{${mapText(s.page)}},st:{${mapText(s.state)}},` +
    `ft:{ae:${atom(f.ae)},ak:${atom(f.ak)},cdr:${atom(f.cdr)},bf:${bf},fi:${atom(f.fi)}}}`
  )
}

function creatorB1Options(s: ReturnType<typeof creatorB1State>, now: number) {
  return {
    now,
    x39: s.x39,
    x50: s.x50,
    x51: s.x51,
    secCanvas: s.secCanvas,
    overrides: { x36: String(s.frameCount), x37: s.x37, x38: s.x38, x82: s.selectedGlobalNames.join('|').slice(0, 300), x84: creatorTelemetry(s) },
  }
}

const DOCUMENT_COOKIE_ORDER = ['ets', 'a1', 'webId', 'gid', 'abRequestId', 'webBuild', 'xsecappid', 'websectiga', 'sec_poison_id', 'loadts']

export class CreatorState {
  cookies: Record<string, string>
  loadts: number
  dsllt: number
  ets: number
  seq: number
  securityReady: boolean
  p1: number
  sc: number
  b1b1: string
  dsl = ''
  dsProgram = ''
  release: Record<string, string>
  /** 构造时的页面加载时刻：默认 b1 采集器的 timeOrigin 以它为基准（上游 b1_state 在构造时创建）。 */
  private started: number
  private named = new Map<string, string>()

  constructor(cookies: Record<string, string>, local: Storage = {}, dsl = '') {
    this.cookies = { ...cookies }
    const started = Number(cookies.loadts || rand.now())
    this.started = started
    this.loadts = started
    this.dsllt = Number(local.dsllt || started)
    this.ets = Number(cookies.ets || started)
    this.seq = Number(local.mns_seq || 0)
    this.dsl = dsl
    this.securityReady = Boolean(cookies.websectiga || cookies.gid || dsl)
    this.p1 = Number(local.p1 || 0)
    this.sc = Number(local.sc || 0)
    this.b1b1 = local.b1b1 || '1'
    this.release = { ...CREATOR_REFERENCE.release }
  }

  updateCookies(updates: Record<string, string>): void {
    Object.assign(this.cookies, updates)
    if (updates.loadts) this.loadts = Number(updates.loadts)
    if (updates.ets) this.ets = Number(updates.ets)
    if (updates.websectiga || updates.gid) this.securityReady = true
  }

  get documentCookie(): string {
    return DOCUMENT_COOKIE_ORDER.filter((k) => k in this.cookies).map((k) => `${k}=${this.cookies[k]}`).join('; ')
  }

  activateSecurity(dsl: string, program: string, at = rand.now()): void {
    this.dsl = dsl
    if (program) this.dsProgram = program
    this.dsllt = at
    this.securityReady = true
  }

  /** 上游 resolve_mns_material：档位与按路由区分的环境常量，不推进 seq。 */
  resolveMaterial(tier?: string, mnsProfile?: string): { tier: string; material: Material } {
    const resolved = tier ?? (this.securityReady ? '0101' : '0201')
    const stage = resolved === '0201' ? 'bootstrap' : 'ready'
    let m = material(CREATOR_REFERENCE.mnsStages[stage])
    if (mnsProfile) m = material(CREATOR_REFERENCE.mnsProfiles[mnsProfile])
    if (resolved === '0101' && !['login_early', 'login_callback'].includes(mnsProfile ?? '')) {
      const key = mnsProfile ?? ''
      let env: number
      if (key === 'publish_user_info') env = 1337
      else if (key === 'publish_mountable') env = 1341
      else if (['publish_permit', 'publish_permit_image', 'publish_permit_video'].includes(key)) env = 1349
      else if (['note_manager', 'note_manager_steady'].includes(key)) env = m.envConst
      else if (key === 'login_ready') env = 1350
      else env = 1351
      m = { ...m, envConst: env }
    }
    return { tier: resolved, material: m }
  }

  nextSignContext(tier?: string, mnsProfile?: string): Record<string, any> {
    const r = this.resolveMaterial(tier, mnsProfile)
    return {
      tier: r.tier,
      now: rand.now(),
      version: randbits32(),
      loadts: this.loadts,
      seq: ++this.seq,
      envConst: r.material.envConst,
      envFpTail: r.material.envFpTail,
      deviceTag: r.material.deviceTag,
      b1b1: this.b1b1,
      signCount: this.sc,
      webBuild: this.release.webBuild,
      signVersion: this.release.signVersion,
      appId: this.release.appId,
      platform: this.release.platform,
      userAgent: this.release.userAgent,
      secChUa: this.release.secChUa,
      dsProgram: this.dsProgram,
    }
  }

  currentB1(now: number, profileName?: string): string {
    if (!profileName) return generateB1(creatorB1Options(creatorB1State(this.started), now))
    const cached = this.named.get(profileName)
    if (cached) return cached
    const s = creatorB1State(this.loadts, profileName)
    const at = s.generatedAtOffsetMs != null ? this.loadts + s.generatedAtOffsetMs : now
    const value = generateB1(creatorB1Options(s, at))
    this.named.set(profileName, value)
    return value
  }

  dslPair(now: number): string {
    if (now - this.dsllt >= DS_REFRESH_MS) this.dsllt = now
    return `${this.dsllt};${this.dsl || 'undefined'}`
  }

  profileDataOptions(location: string, referer: string): Record<string, unknown> {
    return {
      timestampMs: rand.now(),
      timeOrigin: creatorB1State(this.started).timeOrigin,
      documentCookie: this.documentCookie,
      location,
      referer,
      fields: {},
    }
  }

  storage(): Storage {
    return { dsllt: String(this.dsllt), p1: String(this.p1), sc: String(this.sc), b1b1: this.b1b1 }
  }
}
