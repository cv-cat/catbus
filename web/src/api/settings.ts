import type { CatbusError } from './types'

/** 服务端设置（AGENTS.md 7.9）：bridge 的 GET / PUT /api/settings，只认 proxy */
export interface ServerSettings {
  proxy: { value: string | null; platforms: Record<string, string> }
}

export type SettingsPatch = { proxy: string | null }

type Reply = { ok: true; data: ServerSettings } | { ok: false; error: CatbusError }

async function parse(res: Response): Promise<ServerSettings> {
  let body: Reply
  try {
    body = (await res.json()) as Reply
  } catch {
    throw new Error(`bridge 没有返回 JSON（HTTP ${res.status}）`)
  }
  if (!body.ok) throw new Error(body.error?.message ?? `请求失败（HTTP ${res.status}）`)
  return body.data
}

export async function loadServerSettings(): Promise<ServerSettings> {
  return parse(await fetch('/api/settings'))
}

/** 改代理；不合法时 bridge 拒绝整个请求，什么都不改 */
export async function saveServerSettings(patch: SettingsPatch): Promise<ServerSettings> {
  return parse(
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  )
}
