import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { text as readStdin } from 'node:stream/consumers'
import { endpointFlag } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { writeFileAtomic } from '../../../core/fsutil.js'
import { HttpClient } from '../../../core/http.js'
import { finishLogin, freshCredential, interactive, loginContext, prompt, readPassword, smsState } from '../../../core/login.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Account, AuthStatus, File } from '../../../core/schemas.js'
import { isGuest, paged, scope } from '../../../core/toolkit.js'
import { Api, BOXES } from './api.js'
import { Client, ensureVisitorId } from './client.js'
import * as normalize from './normalize.js'
import { pageNumber, resolveItem, resolveMessage } from './resolve.js'

// ---------------------------------------------------------------- 登录

export async function authLogin(ctx: HandlerContext) {
  const method = String(ctx.options.method ?? 'apikey')
  if (method === 'password') return passwordLogin(ctx)
  if (method !== 'apikey') throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
  let key: string
  if (ctx.options.apiKeyFile != null) {
    key = await readFile(String(ctx.options.apiKeyFile), 'utf8').catch(() => {
      throw new CatbusError('USAGE', '无法读取 API Key 文件，请检查文件路径和权限')
    })
  } else if (ctx.options.apiKeyStdin) key = await readStdin(process.stdin)
  else if (interactive()) key = await prompt('M-Team API Key：', { hidden: true })
  else throw new CatbusError('USAGE', '需要提供 M-Team API Key', { hint: 'catbus mteam auth login --api-key-file <文件>，或通过 --api-key-stdin 从管道读取' })
  key = key.trim()
  if (!key || key.length > 8192 || /[^\x21-\x7e]/.test(key)) throw new CatbusError('USAGE', 'API Key 为空或包含无效字符')
  const credential = freshCredential(ctx, 'apikey')
  scope(credential).tokens.api_key = key
  const api = new Api(loginContext(ctx, credential))
  return finishLogin(ctx, credential, normalize.userRef(await api.profile()))
}

type Verify = 'otp' | 'email' | 'tg'
const CODE_FIELD: Record<Verify, string> = { otp: 'otpCode', email: 'emailCode', tg: 'tgCode' }
const VERIFY_NAME: Record<Verify, string> = { otp: '两步验证（TOTP）', email: '邮箱验证码', tg: 'Telegram 验证码' }
/** 两步登录的中间态（非 TTY 分两次执行时用，10 分钟有效）：沿用同一个 visitorId，记住验证方式。不保存密码。 */
interface Pending extends Record<string, unknown> { visitor_id: string; verify: Verify; username: string }

/**
 * 账密登录（网页接口 /login）。新设备登录时站点要求两步验证（code 1001，data 是可选方式）：
 * - otp：TOTP 动态码，`--code` 直接给；
 * - email：先 `--email <绑定邮箱>` 让站点发码，再带 `--code` 登录。发码必须紧跟在一次返回 1001 的登录之后。
 * TTY 下一次完成；非 TTY 下分两次执行，两次都从 stdin 读密码。
 */
async function passwordLogin(ctx: HandlerContext): Promise<Account | { sent: true; verify: Verify }> {
  const username = (ctx.options.username as string | undefined)?.trim()
  const cmd = `catbus mteam auth login --method password --username ${username ?? '<用户名>'} --password-stdin${ctx.account ? ` -a ${ctx.account}` : ''}${endpointFlag(ctx.endpoint)}`
  if (!username) throw new CatbusError('USAGE', '账密登录需要 --username', { hint: cmd })
  const password = await readPassword(ctx)
  let code = (ctx.options.code as string | undefined)?.trim()
  const email = (ctx.options.email as string | undefined)?.trim()
  if (code != null && !/^\d{4,8}$/.test(code)) throw new CatbusError('USAGE', '验证码应为 4-8 位数字')

  const credential = freshCredential(ctx, 'password')
  const pending = code ? await smsState.load<Pending>(ctx) : null
  if (pending && pending.username === username) scope(credential).tokens.visitor_id = pending.visitor_id
  ensureVisitorId(credential)
  const loginCtx = loginContext(ctx, credential)
  const client = new Client(loginCtx, { anonymous: true })
  const attempt = (extra: Record<string, string> = {}) => client.login({ username, password, turnstile: '', ...extra })
  const verifyOf = (code: string, verify: Verify) => ({ [CODE_FIELD[verify]]: code })

  let verify: Verify | null = code ? (pending?.username === username ? pending.verify : 'otp') : null
  let result = await attempt(code && verify ? verifyOf(code, verify) : {})
  if (result.code === 1001 && !code) {
    const methods = (Array.isArray(result.data) ? result.data : []).map(String).filter((m): m is Verify => m in CODE_FIELD)
    const tty = interactive()
    verify = methods.includes('otp') && (tty || !email) ? 'otp' : methods.includes('email') ? 'email' : methods.includes('tg') ? 'tg' : null
    if (!verify) throw new CatbusError('RISK_CONTROL', `M-Team 要求两步验证，但验证方式不受支持：${methods.join(',') || '未知'}`, { detail: { kind: 'captcha' } })
    if (verify === 'email') {
      const target = email ?? (tty ? (await prompt('账号绑定的邮箱：')).trim() : '')
      if (!target) {
        throw new CatbusError('USAGE', 'M-Team 要求邮箱验证码，需要提供账号绑定的邮箱', { hint: `${cmd} --email <绑定邮箱>` })
      }
      await client.sendLoginEmailCode(username, target)
    } else if (verify === 'tg') {
      await client.call<unknown>('/member/sendLoginTelegramVerifyCode', { form: { username } }, { nullable: true })
    }
    if (!tty) {
      await smsState.save(ctx, { visitor_id: ensureVisitorId(credential), verify, username } satisfies Pending)
      if (verify === 'otp') {
        throw new CatbusError('USAGE', 'M-Team 要求两步验证（TOTP 动态码）', { hint: `${cmd} --code <动态码>` })
      }
      ctx.log.info(`${VERIFY_NAME[verify]}已发送。收到后执行：${cmd} --code <验证码>（10 分钟内有效）`)
      return { sent: true, verify }
    }
    code = (await prompt(`${VERIFY_NAME[verify]}：`)).trim()
    result = await attempt(verifyOf(code, verify))
  }
  if (result.code === 1001) {
    throw new CatbusError('USAGE', `M-Team 两步验证没有通过：${result.message || '验证码错误或已过期'}`, { hint: `重新执行 ${cmd}${verify === 'email' ? ' --email <绑定邮箱>' : ''}` })
  }
  if (result.code === 1002) {
    throw new CatbusError('RISK_CONTROL', 'M-Team 要求先验证账号邮箱，无法在命令行完成', {
      detail: { kind: 'captcha' }, hint: '在浏览器登录 M-Team 完成邮箱验证后重试',
    })
  }
  if (result.code !== 0) {
    throw new CatbusError('UPSTREAM', `M-Team 登录失败：${result.message || '未知错误'}`, { detail: { code: result.code } })
  }
  if (typeof scope(credential).tokens.auth !== 'string') throw new CatbusError('UPSTREAM', 'M-Team 登录成功但没有返回登录令牌')
  await smsState.clear(ctx)
  return finishLogin(ctx, credential, normalize.userRef(await new Api(loginCtx).profile()))
}

/** JWT 的 exp（秒）→ ISO 时间；解析不了时为 null。 */
function tokenExpiry(token: unknown): string | null {
  if (typeof token !== 'string') return null
  try {
    const payload = JSON.parse(Buffer.from(token.replace(/^Bearer\s+/i, '').split('.')[1] ?? '', 'base64url').toString('utf8'))
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null
  } catch { return null }
}

export async function authStatus(ctx: HandlerContext): Promise<AuthStatus> {
  const empty = { logged_in: false, user: null, method: null, expires_at: null } as const
  if (isGuest(ctx)) return empty
  const method = ctx.credential.method === 'password' ? 'password' : 'apikey'
  try {
    const user = normalize.userRef(await new Api(ctx).profile())
    return { logged_in: true, user, method, expires_at: method === 'password' ? tokenExpiry(scope(ctx.credential).tokens.auth) : null }
  } catch (error) {
    if (error instanceof CatbusError && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(error.code)) return { ...empty, method }
    throw error
  }
}

// ---------------------------------------------------------------- 用户

function onlyMe(ctx: HandlerContext, what: string) {
  if ((ctx.args.user ?? 'me') !== 'me') throw new CatbusError('UNSUPPORTED', `M-Team 的${what}目前只支持 me`, { hint: `catbus mteam ${ctx.resource} ${ctx.action} me` })
}

export async function userGet(ctx: HandlerContext) {
  onlyMe(ctx, '用户资料')
  return normalize.user(await new Api(ctx).profile())
}

/** 当前账号的用户 ID：登录时已保存，没有时查一次资料。 */
async function myId(ctx: HandlerContext, api: Api): Promise<string> {
  const saved = ctx.credential.user?.id
  return saved && /^\d+$/.test(saved) ? saved : String((await api.profile()).id)
}

// ---------------------------------------------------------------- 种子

async function search(ctx: HandlerContext, keyword: string, options: { onlyFav?: boolean } = {}) {
  const page = pageNumber(ctx.cursor)
  const value = await new Api(ctx).search(keyword, options)
  return paged(value.data.map(normalize.torrent), String(page + 1), page < Number(value.totalPages))
}

export const itemSearch = (ctx: HandlerContext) => search(ctx, ctx.args.keyword!)
export const feedList = (ctx: HandlerContext) => search(ctx, '')
export async function userCollects(ctx: HandlerContext) {
  onlyMe(ctx, '收藏列表')
  return search(ctx, '', { onlyFav: true })
}
export const itemGet = async (ctx: HandlerContext) => normalize.torrent(await new Api(ctx).detail(resolveItem(ctx.args.item!)))
export const itemCategories = async (ctx: HandlerContext) => (await new Api(ctx).categories()).map(normalize.category)

async function setCollect(ctx: HandlerContext, make: boolean) {
  const id = resolveItem(ctx.args.item!)
  await new Api(ctx).collect(id, make)
  return { id }
}
export const itemCollect = (ctx: HandlerContext) => setCollect(ctx, true)
export const itemUncollect = (ctx: HandlerContext) => setCollect(ctx, false)

// ---------------------------------------------------------------- 做种列表、魔力值

const SEED_TYPES: Record<string, string> = { seeding: 'SEEDING', leeching: 'LEECHING', completed: 'COMPLETED', incomplete: 'INCOMPLETE', uploaded: 'UPLOADED' }

export async function seedList(ctx: HandlerContext) {
  const api = new Api(ctx)
  const page = pageNumber(ctx.cursor)
  const value = await api.userTorrents(await myId(ctx, api), SEED_TYPES[String(ctx.options.status ?? 'seeding')]!)
  return paged(value.data.map(normalize.userTorrent), String(page + 1), page < Number(value.totalPages))
}

export async function bonusHistory(ctx: HandlerContext) {
  const api = new Api(ctx)
  const page = pageNumber(ctx.cursor)
  const value = await api.creditLogs(await myId(ctx, api))
  return paged(value.data.map(normalize.bonusRecord), String(page + 1), page < Number(value.totalPages))
}

export async function examGet(ctx: HandlerContext) {
  return (await new Api(ctx).exams()).map(normalize.exam)
}

export async function bonusGet(ctx: HandlerContext) {
  return normalize.bonusRate(await new Api(ctx).bonusRate())
}

export async function seedStats(ctx: HandlerContext) {
  const value = await new Api(ctx).peerStatus()
  const count = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return { seeding: count(value.seeder), leeching: count(value.leecher) }
}

// ---------------------------------------------------------------- 站内信

export async function msgList(ctx: HandlerContext) {
  const box = BOXES[String(ctx.options.box ?? 'inbox') as keyof typeof BOXES]
  const page = pageNumber(ctx.cursor)
  const value = await new Api(ctx).messages(box)
  return paged(value.data.map((row) => normalize.conversation(row, box)), String(page + 1), page < Number(value.totalPages))
}

export async function msgHistory(ctx: HandlerContext) {
  return paged([normalize.message(await new Api(ctx).message(resolveMessage(ctx.args.conversation!)))], null, false)
}

// ---------------------------------------------------------------- 下载

/** 校验 bencode 的完整结构及顶层 info 字典，避免把登录页或 JSON 错误保存成 .torrent。 */
function isTorrent(bytes: Uint8Array): boolean {
  const data = Buffer.from(bytes)
  let p = 0
  let info = false
  const fail = () => { throw new Error('invalid bencode') }
  const string = (): Buffer => {
    const colon = data.indexOf(58, p)
    if (colon < p || colon - p > 10) return fail()
    const n = data.subarray(p, colon).toString('ascii')
    if (!/^(0|[1-9]\d*)$/.test(n)) return fail()
    const end = colon + 1 + Number(n)
    if (end > data.length) return fail()
    const value = data.subarray(colon + 1, end)
    p = end
    return value
  }
  const value = (depth: number): boolean => {
    if (depth > 64 || p >= data.length) return fail()
    const tag = data[p]
    if (tag === 100 || tag === 108) {
      p++
      while (data[p] !== 101) {
        const key = tag === 100 ? string().toString('utf8') : null
        const dict = value(depth + 1)
        if (depth === 0 && key === 'info' && dict) info = true
      }
      p++
      return tag === 100
    }
    if (tag === 105) {
      const end = data.indexOf(101, ++p)
      if (end < p || !/^(0|-?[1-9]\d*)$/.test(data.subarray(p, end).toString('ascii'))) return fail()
      p = end + 1
    } else string()
    return false
  }
  try { return data[0] === 100 && value(0) && info && p === data.length } catch { return false }
}

const QBIT_DEFAULT = 'http://127.0.0.1:25254'

/** 推送到本机 qBittorrent Web UI：直连，不走 catbus 的代理设置。 */
async function pushToQbit(ctx: HandlerContext, name: string, bytes: Uint8Array): Promise<void> {
  const base = (process.env.CATBUS_MTEAM_QBIT_URL || QBIT_DEFAULT).replace(/\/+$/, '')
  const http = new HttpClient({ proxy: null, timeout: ctx.config.timeout })
  const headers = { referer: base, origin: base }
  const category = String(ctx.options.qbitCategory ?? 'mteam')
  const paused = ctx.options.qbitPaused ? 'true' : 'false'
  let res
  try {
    const cats = await http.request({ url: `${base}/api/v2/torrents/categories`, headers, cookies: false })
    if (cats.status === 403) throw new CatbusError('ERROR', 'qBittorrent Web UI 拒绝访问：需要对本机地址免认证（Bypass authentication for clients on localhost）')
    if (cats.ok && category && !(category in ((await cats.json()) as object))) {
      await http.request({ method: 'POST', url: `${base}/api/v2/torrents/createCategory`, headers, cookies: false, form: { category, savePath: '' } })
    }
    res = await http.request({
      method: 'POST', url: `${base}/api/v2/torrents/add`, headers, cookies: false,
      multipart: [
        { name: 'torrents', data: bytes, filename: name, contentType: 'application/x-bittorrent' },
        { name: 'category', data: category },
        { name: 'paused', data: paused },
        { name: 'stopped', data: paused },
      ],
    })
  } catch (error) {
    if (error instanceof CatbusError && error.code === 'ERROR') throw error
    throw new CatbusError('ERROR', `连不上 qBittorrent Web UI（${base}），种子文件已保存`, {
      hint: '确认 qBittorrent 已启动并开启 Web UI，或用 CATBUS_MTEAM_QBIT_URL 指定地址', cause: error,
    })
  }
  const body = (await res.text()).trim()
  if (res.ok && body === 'Ok.') {
    ctx.log.info(`已推送到 qBittorrent（分类 ${category}${ctx.options.qbitPaused ? '，暂停' : ''}）`)
    return
  }
  if (res.ok && body === 'Fails.') {
    ctx.log.warn('qBittorrent 没有添加这个种子（通常是已经在任务列表里）')
    return
  }
  throw new CatbusError('ERROR', `qBittorrent 添加种子失败：HTTP ${res.status} ${body.slice(0, 80)}`, { hint: '种子文件已保存，可以手动添加' })
}

export async function itemDownload(ctx: HandlerContext): Promise<File[]> {
  const id = resolveItem(ctx.args.item!)
  const files = await saveTorrent(ctx, id)
  // --qbit：已存在而跳过下载时，推送本地已有的种子文件
  if (ctx.options.qbit) await pushToQbit(ctx, `mteam_${id}.torrent`, await readFile(files[0]!.path))
  return files
}

async function saveTorrent(ctx: HandlerContext, id: string): Promise<File[]> {
  const path = join(resolve(String(ctx.options.dir ?? '.')), `mteam_${id}_1.torrent`)
  const existing = await stat(path).catch(() => null)
  if (existing && !existing.isFile()) throw new CatbusError('USAGE', '种子文件目标路径不是普通文件')
  if (existing && !ctx.options.overwrite) {
    ctx.log.info(`已存在，跳过：${path}`)
    return [{ path, type: 'torrent', url: null, size: existing.size }]
  }
  const api = new Api(ctx)
  const url = await api.downloadUrl(id)
  if (typeof url !== 'string') throw new CatbusError('UPSTREAM', 'M-Team 未返回种子下载地址')
  const res = await api.client.download(url)
  const reader = res.body?.getReader()
  if (!reader) throw new CatbusError('UPSTREAM', 'M-Team 未返回种子文件内容')
  const limit = 16 * 1024 * 1024
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(res.headers.get('content-length')) > limit) throw new CatbusError('UPSTREAM', 'M-Team 种子文件超过 16 MiB 限制')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new CatbusError('UPSTREAM', 'M-Team 种子文件超过 16 MiB 限制')
      chunks.push(value)
    }
  } catch (cause) {
    await reader.cancel().catch(() => {})
    if (cause instanceof CatbusError) throw cause
    throw new CatbusError('NETWORK', '读取 M-Team 种子文件失败', { cause })
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, size)
  if (!isTorrent(bytes)) throw new CatbusError('UPSTREAM', 'M-Team 返回的内容不是有效的种子文件')
  // 种子内可能带私人 Tracker passkey，使用 0600 原子写入，返回值不含下载授权 URL。
  try {
    await writeFileAtomic(path, bytes, { overwrite: Boolean(ctx.options.overwrite) })
  } catch (error) {
    if (ctx.options.overwrite || (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // 网络请求期间另一进程已发布了目标文件，沿用默认跳过的行为。
    const found = await stat(path)
    if (!found.isFile()) throw new CatbusError('USAGE', '种子文件目标路径不是普通文件')
    ctx.log.info(`已存在，跳过：${path}`)
    return [{ path, type: 'torrent', url: null, size: found.size }]
  }
  return [{ path, type: 'torrent', url: null, size: bytes.length }]
}
