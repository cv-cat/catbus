import { t } from '@/i18n'
import type { Account, Envelope } from './types'

export type LoginMethod = 'qrcode' | 'sms' | 'password' | 'cookie' | 'apikey'

export interface LoginInfo {
  methods: LoginMethod[]
  default: LoginMethod | null
  note: string | null
}

export interface QrSession {
  id: string
  state: 'running' | 'qrcode' | 'done' | 'error'
  qrcode: string | null
  message: string | null
  envelope: Envelope<Account> | null
}

/** 手机号下有多个用户时，短信验证后待选的一个用户 */
export interface SmsUser {
  id: string
  name: string | null
  avatar: string | null
}

/**
 * 短信 / 两步验证第一步成功时的 data；短信验证后一个手机号有多个用户时带 users（待选号）。
 * `verify`：mteam 为两步验证方式（字符串）；快手选号后为 true，表示这个账号还要语音验证码
 */
export interface SentStep {
  sent: true
  phone?: string
  verify?: string | boolean
  users?: SmsUser[]
}

export type LoginStep = 'start' | 'verify' | 'select'

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { ok?: boolean; error?: { message: string } }
  if (!res.ok) throw new Error(body.error?.message ?? t('login.api.requestFailed', { status: res.status }))
  return body
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const loginApi = {
  methods: (platform: string) => fetch(`/api/login/methods?platform=${encodeURIComponent(platform)}`).then((r) => json<LoginInfo>(r)),

  start: (req: { platform: string; method: LoginMethod; account?: string; step?: LoginStep; fields?: Record<string, string> }) =>
    post('/api/login/start', req).then((r) => json<QrSession | { envelope: Envelope<Account | SentStep> }>(r)),

  session: (id: string) => fetch(`/api/login/session/${id}`).then((r) => json<QrSession>(r)),

  /** 设为当前（默认）账号：catbus <p> auth use <account> */
  /** 删除账号：catbus <p> auth logout -a <account> */
  logout: (platform: string, account: string) => post('/api/login/logout', { platform, account }).then((r) => json<{ envelope: Envelope<Account> }>(r)),
  use: (platform: string, account: string) => post('/api/login/use', { platform, account }).then((r) => json<{ envelope: Envelope<Account> }>(r)),

  cancel: (id: string) => post(`/api/login/cancel/${id}`, null).catch(() => undefined),
}

/** 登录方式的名字：getter，在模板 / computed 里读才会随语言切换 */
export const METHOD_LABEL: Readonly<Record<LoginMethod, string>> = {
  get qrcode() {
    return t('login.method.qrcode')
  },
  get sms() {
    return t('login.method.sms')
  },
  get password() {
    return t('login.method.password')
  },
  cookie: 'Cookie',
  apikey: 'API Key',
}
