/**
 * 基于 hash 的路由：#/p/xhs/item/search?a0=猫&run=1。用真实链接导航，保留浏览器的返回、复制、新标签页打开。
 */

/** 命令页链接里预填参数的键：位置参数为 a0、a1……，选项为 o.<选项名>。 */
export const ARG_PARAM = 'a'
export const OPTION_PARAM = 'o.'

export interface Route {
  path: string[]
  query: URLSearchParams
}

/**
 * 当前地址对应的路由。
 */
export function currentRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, '')
  const [path = '', search = ''] = raw.split('?', 2)
  return { path: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(search) }
}

/**
 * 生成页面内链接。
 */
export function href(path: string[], query: Record<string, string | null | undefined> = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value != null && value !== '') params.set(key, value)
  const search = params.toString()
  return `#/${path.map(encodeURIComponent).join('/')}${search ? `?${search}` : ''}`
}

/**
 * 跳转到页面内地址。
 */
export function navigate(target: string): void {
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = target
}
