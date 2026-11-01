import { CatbusError } from '../../../core/errors.js'

/** 仅解析 MT 自己的链接，不访问用户传入的主机或跟随外部短链。 */
export function resolveItem(input: string): string {
  if (/^\d+$/.test(input)) return input
  try {
    const url = new URL(input)
    if (!['https:', 'http:'].includes(url.protocol) || !isMteamHost(url.hostname) || url.username || url.password) throw new Error()
    const id = /^\/detail\/(\d+)\/?$/.exec(url.pathname)?.[1]
      ?? /^#\/torrent\/(\d+)(?:[/?]|$)/.exec(url.hash)?.[1]
      ?? (/^\/details\.php$/.test(url.pathname) ? url.searchParams.get('id') : null)
    if (id && /^\d+$/.test(id)) return id
  } catch {}
  throw new CatbusError('USAGE', '无法识别 M-Team 种子资源', { hint: '传数字 ID 或 https://kp.m-team.cc/detail/<id>' })
}

export function isMteamHost(host: string): boolean {
  return ['m-team.cc', 'm-team.io'].some((domain) => host === domain || host.endsWith('.' + domain))
}

export function pageNumber(cursor: string | null): number {
  if (cursor == null) return 1
  if (!/^[1-9]\d{0,8}$/.test(cursor)) throw new CatbusError('USAGE', 'M-Team 分页游标无效', { hint: '使用上次结果里的 page.cursor' })
  return Number(cursor)
}
