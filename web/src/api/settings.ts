import type { CatbusError } from './types'
import { BridgeError } from './client'
import { t } from '@/i18n'

/** 服务端设置（AGENTS.md 7.9）：bridge 的 GET / PUT /api/settings，只认 proxy */
export interface ServerSettings {
  proxy: { value: string | null; platforms: Record<string, string> }
}

export type SettingsPatch = { proxy: string | null }

type Reply = { ok: true; data: ServerSettings } | { ok: false; error: CatbusError }

const bridge = (message: string) => new BridgeError({ code: 'BRIDGE', message, hint: null, detail: null })

async function parse(res: Response): Promise<ServerSettings> {
  let body: Reply
  try {
    body = (await res.json()) as Reply
  } catch {
    throw bridge(t('settings.server.notJson', { status: res.status }))
  }
  if (!body.ok) throw body.error ? new BridgeError(body.error) : bridge(t('settings.server.requestFailed', { status: res.status }))
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
