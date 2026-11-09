import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'

/**
 * 大众点评 PC 扫码登录（account.dianping.com/pclogin）用的 H5guard 是 4.3.0 档，和 H5 页（1.2.0）不是一份：
 * 页面加载它之后调一次 `H5guard.init({})`（见 pclogin 页内联脚本），随后
 * `H5guard.getfp()` 出 h5_fingerprint、`H5guard.sign({url, headers, method, data})` 给每个请求出 mtgsig
 *（返回 promise，mtgsig 在 `headers` 里）。这份 H5guard.js 原样复制到 static/maoyan/H5guard-pclogin.js，
 * 来源是页面加载的 https://appsec-mobile.meituan.com/h5guard/H5guard.js。用 jsdom 开一个与页面同 url
 * 的窗口跑它；运行只依赖页面环境本身，不联网。
 */

/** pclogin 页的浏览器 UA（登录接口照抄页面）。与 H5 页（show.maoyan.com）的 UA 不同，这里走它自己的指纹。 */
export const PCLOGIN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.250 Safari/537.36'

interface H5guardApi {
  init(options?: Record<string, unknown>): unknown
  getfp(): string
  sign(request: { url: string; headers: Record<string, string>; method: string; data: string }): Promise<{ headers: Record<string, string> }>
}

export interface PcloginGuard {
  /** 页面在一次登录里缓存一份 h5_fingerprint：getQrCodeImg 和 check 用同一份，mtgsig 则绑定各自的完整 URL。 */
  readonly fingerprint: string
  /** 给扫码接口出 mtgsig；`url` 必须与实际请求的 URL 逐字一致（含全部 query）。 */
  sign(url: string): Promise<string>
  /** 释放 jsdom 窗口。 */
  stop(): void
}

function realGuard(): PcloginGuard {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://account.dianping.com/pclogin',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  try {
    dom.window.eval(readFileSync(staticFile('maoyan', 'H5guard-pclogin.js'), 'utf8'))
    dom.window.eval('H5guard.init({})')
    const H5guard = (dom.window as unknown as { H5guard: H5guardApi }).H5guard
    const fingerprint = H5guard.getfp()
    if (typeof fingerprint !== 'string' || !fingerprint.startsWith('H5dfp_')) throw new Error('返回值不是指纹')
    return {
      fingerprint,
      sign(url: string): Promise<string> {
        return H5guard.sign({ url, headers: { 'User-Agent': PCLOGIN_UA }, method: 'GET', data: '' }).then(
          (s) => s.headers.mtgsig,
        ).catch((e) => {
          throw new CatbusError('ERROR', `扫码接口 mtgsig 出签失败：${(e as Error).message}`, { hint: 'catbus doctor' })
        })
      },
      stop: () => dom.window.close(),
    }
  } catch (e) {
    dom.window.close()
    throw new CatbusError('ERROR', `H5guard (pclogin) 加载失败：${(e as Error).message}`, { hint: 'catbus doctor' })
  }
}

let start: () => PcloginGuard = realGuard

/** 替换 guard 工厂，返回恢复函数。只给测试用。 */
export function mockGuard(fn: () => PcloginGuard): () => void {
  const prev = start
  start = fn
  return () => {
    start = prev
  }
}

/** 每次扫码登录新建一个 guard（真实页面每次刷新都重新出指纹），用完调 stop()。 */
export function startGuard(): PcloginGuard {
  return start()
}
