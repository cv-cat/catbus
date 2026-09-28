import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import { fakeResponse, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { deterministic } from '../src/core/rand.js'

/** scripts/golden/catbus_golden.py 写出的一个用例。 */
export interface GoldenCase {
  input: any
  seed: number
  now: number
  requests: GoldenRequest[]
  responses: { status: number; headers: Record<string, string | string[]>; body: unknown }[]
  result: any
  error: string | null
}

export interface GoldenRequest {
  method: string
  url: string
  headers: [string, string][]
  cookies: [string, string][]
  body: string | { base64: string } | null
  multipart: { name: string; filename: string | null; contentType: string | null; data: unknown }[] | null
}

export function loadCase(platform: string, name: string): GoldenCase {
  return JSON.parse(readFileSync(new URL(`./golden/${platform}/${name}.json`, import.meta.url), 'utf8'))
}

function encodeBody(body: string | Uint8Array | null): GoldenRequest['body'] {
  if (body == null || body.length === 0) return null
  if (typeof body === 'string') return body
  const text = Buffer.from(body).toString('utf8')
  return Buffer.from(text, 'utf8').equals(Buffer.from(body)) ? text : { base64: Buffer.from(body).toString('base64') }
}

export function normalize(p: PreparedRequest): GoldenRequest {
  return {
    method: p.method,
    url: p.url,
    headers: p.headers,
    cookies: p.cookies,
    body: encodeBody(p.body),
    multipart: p.multipart
      ? p.multipart.map((m) => ({
          name: m.name,
          filename: m.filename ?? null,
          contentType: m.contentType ?? null,
          data: encodeBody(m.data),
        }))
      : null,
  }
}

function toResponse(r: GoldenCase['responses'][number], url: string): HttpResponse {
  const headers: [string, string][] = []
  for (const [k, v] of Object.entries(r.headers)) for (const x of Array.isArray(v) ? v : [v]) headers.push([k, x])
  // 二进制响应在用例里记成 {"base64": ...}（catbus_golden.py 的 _respond）
  const b64 = r.body && typeof r.body === 'object' && Object.keys(r.body).join() === 'base64' ? (r.body as { base64: string }).base64 : null
  const body = typeof r.body === 'string' ? r.body : b64 != null ? new Uint8Array(Buffer.from(b64, 'base64')) : JSON.stringify(r.body)
  return fakeResponse(body, { status: r.status, headers, url })
}

/**
 * 在确定性的随机数与时钟下运行 TS 实现，按用例记录的响应依次回复请求，
 * 返回实际发出的请求。
 */
export async function replay<T>(c: GoldenCase, run: () => Promise<T>): Promise<{ requests: GoldenRequest[]; result?: T; error?: unknown }> {
  const requests: GoldenRequest[] = []
  const restoreRand = deterministic({ seed: c.seed, now: c.now })
  const restoreSender = mockSender((p) => {
    requests.push(normalize(p))
    const r = c.responses[requests.length - 1]
    if (!r) throw new Error(`TS 实现多发了请求：${p.method} ${p.url}`)
    return toResponse(r, p.url)
  })
  try {
    return { requests, result: await run() }
  } catch (error) {
    return { requests, error }
  } finally {
    restoreSender()
    restoreRand()
  }
}

/** 断言 TS 发出的请求序列与上游一致。 */
export function expectRequests(actual: GoldenRequest[], expected: GoldenRequest[]): void {
  expect(actual.map((r) => `${r.method} ${r.url}`)).toEqual(expected.map((r) => `${r.method} ${r.url}`))
  actual.forEach((r, i) => expect(r, `第 ${i + 1} 个请求：${r.method} ${r.url}`).toEqual(expected[i]))
}

// ---------------------------------------------------------------- 平台 handler 的上下文

import { newCredential } from '../src/core/auth-store.js'
import { parseCookieInput } from '../src/core/cookies.js'
import { createLogger } from '../src/core/log.js'
import type { HandlerContext } from '../src/core/registry.js'
import type { Credential } from '../src/core/schemas.js'
import { PLATFORMS } from '../src/platforms/index.js'

export interface CtxInit {
  platform: string
  account?: string | null
  cookies?: string
  cookieDomain?: string
  credential?: Credential
  args?: Record<string, string | undefined>
  options?: Record<string, unknown>
  cursor?: string | null
  extra?: Record<string, unknown>
}

/** 测试用的 HandlerContext。account 为 guest 时凭证是空的游客凭证。 */
export function makeCtx(init: CtxInit): HandlerContext {
  const platform = PLATFORMS.find((p) => p.id === init.platform)!
  const account = init.account === undefined ? 'default' : init.account
  const credential =
    init.credential ??
    newCredential({ platform: platform.id, endpoint: 'web', account: account ?? 'guest', method: account === 'guest' ? 'guest' : 'cookie' })
  if (init.cookies) credential.scopes.main!.cookies = parseCookieInput(init.cookies, init.cookieDomain ?? '')
  Object.assign(credential.extra, init.extra)
  return {
    platform,
    endpoint: 'web',
    resource: '',
    action: '',
    args: init.args ?? {},
    options: init.options ?? {},
    account,
    credential,
    cursor: init.cursor ?? null,
    raw: false,
    config: { proxy: null, timeout: 30 },
    log: createLogger({ quiet: true }),
    signal: new AbortController().signal,
    saveCredential: async () => {},
  }
}
