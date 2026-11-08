import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * 本机 loopback 页面的公共部分（Web 面板，见 AGENTS 4.13）：只监听 127.0.0.1、校验 Host、安全响应头、打开系统浏览器。
 */

export const LOOPBACK_HOST = '127.0.0.1'

/**
 * 在 127.0.0.1 的随机端口上监听，返回 origin（`http://127.0.0.1:<port>`）。
 */
export async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((ready, fail) => {
    server.once('error', fail)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', fail)
      ready()
    })
  })
  return `http://${LOOPBACK_HOST}:${(server.address() as AddressInfo).port}`
}

/**
 * 关闭服务并断开所有连接（包括还在推送的流式响应）。
 */
export async function closeLoopback(server: Server): Promise<void> {
  const closed = new Promise<void>((done) => server.close(() => done()))
  server.closeAllConnections()
  await closed
}

/**
 * 请求的 Host 是否正是本服务的地址：防 DNS rebinding。
 */
export function isOwnHost(host: string | undefined, origin: string): boolean {
  return host === new URL(origin).host
}

/**
 * 页面与接口共用的安全响应头。
 */
export function securityHeaders(contentSecurityPolicy: string): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': contentSecurityPolicy,
  }
}

/**
 * 用系统默认浏览器打开地址。没有默认浏览器时静默失败：调用方已经把地址打到 stderr。
 */
export function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' })
  child.on('error', () => {})
  child.unref()
}
