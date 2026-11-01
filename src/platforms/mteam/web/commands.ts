import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { text as readStdin } from 'node:stream/consumers'
import { CatbusError } from '../../../core/errors.js'
import { writeFileAtomic } from '../../../core/fsutil.js'
import { finishLogin, freshCredential, interactive, loginContext, prompt } from '../../../core/login.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, File } from '../../../core/schemas.js'
import { isGuest, paged, scope } from '../../../core/toolkit.js'
import { Api } from './api.js'
import * as normalize from './normalize.js'
import { pageNumber, resolveItem } from './resolve.js'

export async function authLogin(ctx: HandlerContext) {
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

export async function authStatus(ctx: HandlerContext): Promise<AuthStatus> {
  const empty = { logged_in: false, user: null, method: null, expires_at: null } as const
  if (isGuest(ctx)) return empty
  try {
    return { logged_in: true, user: normalize.userRef(await new Api(ctx).profile()), method: 'apikey', expires_at: null }
  } catch (error) {
    if (error instanceof CatbusError && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(error.code)) return { ...empty, method: 'apikey' }
    throw error
  }
}

export async function userGet(ctx: HandlerContext) {
  if (ctx.args.user !== 'me') throw new CatbusError('UNSUPPORTED', 'M-Team 用户资料目前只支持 me', { hint: 'catbus mteam user get me' })
  return normalize.user(await new Api(ctx).profile())
}

async function search(ctx: HandlerContext, keyword: string) {
  const page = pageNumber(ctx.cursor)
  const value = await new Api(ctx).search(keyword)
  return paged(value.data.map(normalize.torrent), String(page + 1), page < Number(value.totalPages))
}

export const itemSearch = (ctx: HandlerContext) => search(ctx, ctx.args.keyword!)
export const feedList = (ctx: HandlerContext) => search(ctx, '')
export const itemGet = async (ctx: HandlerContext) => normalize.torrent(await new Api(ctx).detail(resolveItem(ctx.args.item!)))
export const itemCategories = async (ctx: HandlerContext) => (await new Api(ctx).categories()).map(normalize.category)

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

export async function itemDownload(ctx: HandlerContext): Promise<File[]> {
  const id = resolveItem(ctx.args.item!)
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
