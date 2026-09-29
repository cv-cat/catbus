import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { models } from '@cv-cat/catbus-assets-jd'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'
import type { Jd } from './client.js'
import { PROFILE } from './profile.js'

/**
 * 无浏览器的 JCAP 图形验证码（上游 utils/jcap_solver.py）：官方 JCAP JS/WASM 在 static/jd/jcap/env/run.js 的
 * 补环境里运行。run.js 依赖进程级状态（读 stdin、改写全局、process.exit），按 AGENTS 7.4 用 node 子进程跑；
 * 它原本用 Python 起的两个子进程（网络桥 http_bridge.py、图像求解 captcha_solver.py）由预加载的 jcap/host.js
 * 换成 catbus 自己的 jcap/helper.js（wreq-js 网络、TS 移植的求解器）。
 */

const RESULT_PREFIX = '__JCAP_RESULT__'
const LINES = /\r?\n/

export interface CaptchaOptions {
  sessionId: string
  account: string
  pageUrl: string
  attempts?: number
  timeout?: number
}

/** 从 run.js 的输出里取最后一次各阶段的诊断信息（不含票据）。 */
function diagnostics(output: string): string {
  const latest: Record<string, unknown> = {}
  for (const line of output.split(LINES)) {
    const m = /^\[(captcha\.[a-z.-]+|env\.summary)\]\s*(\{.*\})\s*$/.exec(line)
    if (!m) continue
    try {
      const v = JSON.parse(m[2]!)
      if (m[1] === 'captcha.check') latest.check = { code: v.code, sCode: v.sCode, tp: v.tp, message: v.message }
      else if (m[1] === 'captcha.solve') latest.solve = { tp: v.tp, solver: v.solver, attempt: v.attempt, retry: v.retry, reason: v.reason }
      else if (m[1] === 'captcha.solver-process') latest.solver_process = { status: v.status, error: v.error }
      else if (m[1] === 'captcha.challenge') latest.challenge = { code: v.code, tp: v.tp }
    } catch {}
  }
  return JSON.stringify(latest)
}

/** 完成 JCAP 会话，返回服务端验证票据 vt（solve_graphic_captcha）。 */
export async function solveCaptcha(jd: Jd, o: CaptchaOptions): Promise<string> {
  if (!o.sessionId) throw new CatbusError('ERROR', '纯程序图形验证码缺少 sessionId')
  const host = fileURLToPath(new URL('./jcap/host.js', import.meta.url))
  const helper = fileURLToPath(new URL('./jcap/helper.js', import.meta.url))
  if (!existsSync(host) || !existsSync(helper)) throw new CatbusError('ERROR', 'JCAP 运行时缺失（需要编译后的 catbus）')
  for (const file of Object.values(models)) {
    if (!existsSync(file)) throw new CatbusError('ERROR', `JCAP 模型缺失：${file}`, { hint: '重新安装 catbus-cli（@cv-cat/catbus-assets-jd）' })
  }
  const timeout = Math.max(30, o.timeout ?? 180)
  const runJs = staticFile('jd', 'jcap/env/run.js')
  const input = {
    sessionId: o.sessionId,
    account: o.account ?? '',
    cookie: jd.cookieStr,
    liveNetwork: true,
    autoSolve: true,
    returnResult: true,
    maxSolveAttempts: Math.max(1, Math.min(30, o.attempts ?? 20)),
    runTimeoutMs: Math.max(30_000, timeout * 1000 - 5_000),
    // run.js 用它起网络桥与求解器子进程：预加载的 host.js 把它们换成 helper.js
    pythonExecutable: process.execPath,
    solverModel: models.u2netp,
    orientationModel: models.orientation,
    userAgent: PROFILE.ua,
    secChUa: PROFILE.secChUa,
    secChUaMobile: PROFILE.secChUaMobile,
    secChUaPlatform: PROFILE.secChUaPlatform,
    localStorage: jd.localStorageFor(o.pageUrl),
    pageUrl: o.pageUrl,
  }
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', new URL('./jcap/host.js', import.meta.url).href, runJs], {
      cwd: dirname(runJs),
      env: {
        ...process.env,
        CATBUS_JD_HELPER: helper,
        CATBUS_JD_PROXY: jd.ctx.config.proxy ?? '',
        CATBUS_JD_TIMEOUT: String(jd.ctx.config.timeout),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    // 上游的求解器只认 tp=2/3/26/30；遇到别的类型会点"刷新"，界面里没有刷新按钮时就一直等到超时。
    // 这里在"不支持的类型"之后 15 秒内没有新题就提前结束（上游要等满整个超时）。
    let stalled: NodeJS.Timeout | undefined
    const watch = (chunk: string) => {
      out += chunk
      if (/\[captcha\.(challenge|check)\]/.test(chunk)) clearTimeout(stalled)
      const m = /\[captcha\.solve\] (\{.*"unsupported-refresh".*\})/.exec(chunk)
      if (m) {
        clearTimeout(stalled)
        let tp: unknown = null
        try {
          tp = JSON.parse(m[1]!).tp
        } catch {}
        stalled = setTimeout(() => {
          child.kill()
          reject(new CatbusError('RISK_CONTROL', `京东下发了纯程序还不能求解的验证码（tp=${tp}）`, { detail: { kind: 'captcha', tp } }))
        }, 15_000)
      }
    }
    child.stdout.setEncoding('utf8').on('data', watch)
    child.stderr.setEncoding('utf8').on('data', watch)
    const timer = setTimeout(() => {
      child.kill()
      reject(new CatbusError('RISK_CONTROL', `纯程序图形验证码求解超时：${diagnostics(out)}`, { detail: { kind: 'captcha', stage: 'timeout' } }))
    }, timeout * 1000)
    child.on('error', (err) => {
      clearTimeout(timer)
      clearTimeout(stalled)
      reject(new CatbusError('ERROR', `纯程序图形验证码进程启动失败：${err.message}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
      clearTimeout(stalled)
      resolve(out)
    })
    child.stdin.end(JSON.stringify(input))
  })
  for (const line of output.split(LINES)) if (line.trim() && !line.startsWith(RESULT_PREFIX)) jd.ctx.log.debug(`[jcap] ${line.slice(0, 300)}`)
  const marker = output
    .split(LINES)
    .reverse()
    .find((l) => l.startsWith(RESULT_PREFIX))
  if (!marker) throw new CatbusError('RISK_CONTROL', `纯程序图形验证码未返回验证结果：${diagnostics(output)}`, { detail: { kind: 'captcha' } })
  let payload: any
  try {
    payload = JSON.parse(marker.slice(RESULT_PREFIX.length))
  } catch {
    throw new CatbusError('ERROR', '纯程序图形验证码返回格式异常')
  }
  jd.absorbScript(o.pageUrl, payload)
  if (!payload.ok) {
    const stage = payload.error === 'timeout' ? '超时' : '失败'
    throw new CatbusError('RISK_CONTROL', `纯程序图形验证码求解${stage}：${diagnostics(output)}`, { detail: { kind: 'captcha', error: payload.error ?? null } })
  }
  const ticket = String(payload.vt ?? '')
  if (ticket.length < 32 || ticket.length > 4096 || /\s/.test(ticket)) throw new CatbusError('RISK_CONTROL', '纯程序图形验证码票据格式异常', { detail: { kind: 'captcha' } })
  return ticket
}
