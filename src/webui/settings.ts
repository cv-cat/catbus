import { checkProxy, getConfig, listConfig, setConfig, unsetConfig } from '../core/config.js'
import { CatbusError } from '../core/errors.js'

/**
 * WebUI 的服务端设置（AGENTS.md 7.9「服务端设置」）：只认一个键 `proxy`。
 *
 * `proxy` 就是 config.toml 的全局 `proxy`（AGENTS.md 5.5），经 core 的 config 模块读写，与
 * `catbus config set proxy` 同一套校验；`null` / 空字符串清空。平台级 `<p>.proxy` 只读返回。
 * 下载交给浏览器保存，没有服务端下载目录；以前的 ~/.catbus/webui.json 不再读写。
 */

export class SettingsError extends Error {}

const KEYS = ['proxy'] as const
type Key = (typeof KEYS)[number]
const MAX_LEN = 1024

export interface ServerSettings {
  proxy: { value: string | null; platforms: Record<string, string> }
}

export async function getSettings(): Promise<ServerSettings> {
  const proxy = await getConfig(['proxy'])
  const platforms: Record<string, string> = {}
  for (const [k, v] of Object.entries(await listConfig())) {
    const m = /^([^.]+)\.proxy$/.exec(k)
    if (m && typeof v === 'string') platforms[m[1]!] = v
  }
  return { proxy: { value: typeof proxy === 'string' ? proxy : null, platforms } }
}

const empty = (v: unknown) => v === null || v === ''

/** 先校验全部键，再写入：任何一项不合法时什么都不改 */
export async function putSettings(body: unknown): Promise<ServerSettings> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SettingsError('请求体必须是对象')
  const entries = Object.entries(body as Record<string, unknown>)
  if (!entries.length) throw new SettingsError('没有要修改的设置')
  const unknown = entries.map(([k]) => k).filter((k) => !KEYS.includes(k as Key))
  if (unknown.length) throw new SettingsError(`不支持的设置项：${unknown.join('、')}（只认 proxy）`)
  const b = body as Partial<Record<Key, unknown>>

  let proxy: string | null
  if (empty(b.proxy)) proxy = null
  else if (typeof b.proxy !== 'string' || b.proxy.length > MAX_LEN || /[\0\r\n]/.test(b.proxy)) throw new SettingsError('代理地址不合法')
  else {
    try {
      proxy = checkProxy(b.proxy.trim())
    } catch (e) {
      throw new SettingsError(e instanceof CatbusError ? e.message : '代理地址不合法')
    }
  }

  // 清空时只在确实设置过时才写文件，不凭空生成 config.toml
  if (proxy === null) {
    if ((await getConfig(['proxy'])) != null) await unsetConfig(['proxy'])
  } else await setConfig(['proxy'], proxy)
  return getSettings()
}
