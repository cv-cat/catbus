import type { CreateJobBody, JobEvent, JobSummary, PanelMeta, RunRequest, UploadResult } from '../shared/types.js'
import { type Envelope, parseEnvelope } from './json.js'

/**
 * 与面板服务端的接口（AGENTS 4.13）。地址都是相对路径，落在启动时的随机路径下。
 */

const CSRF_HEADER = 'X-Catbus-CSRF'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * 页面里由服务端写入的令牌，写请求要带上。
 */
function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="catbus-csrf"]')?.content ?? ''
}

/**
 * 读取错误响应里的说明。
 */
async function failure(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return new ApiError(res.status, body?.error ?? `请求失败（HTTP ${res.status}）`)
}

/**
 * GET 一个 JSON 接口。
 */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' })
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

/**
 * POST 到一个写接口，带上令牌。
 */
async function post<T>(path: string, body: BodyInit | null, type: string): Promise<T> {
  const res = await fetch(path, { method: 'POST', body, headers: { 'Content-Type': type, [CSRF_HEADER]: csrfToken() }, credentials: 'same-origin' })
  if (!res.ok) throw await failure(res)
  return (await res.json()) as T
}

export const api = {
  meta: () => getJson<PanelMeta>('api/meta'),
  jobs: () => getJson<JobSummary[]>('api/jobs'),
  job: (id: string) => getJson<JobSummary>(`api/jobs/${encodeURIComponent(id)}`),
  createJob: (body: CreateJobBody) => post<JobSummary>('api/jobs', JSON.stringify(body), 'application/json'),
  stopJob: (id: string) => post<JobSummary>(`api/jobs/${encodeURIComponent(id)}/stop`, '{}', 'application/json'),
  qrcodeUrl: (id: string, version: number) => `api/jobs/${encodeURIComponent(id)}/qrcode?v=${version}`,
  upload: (file: File) => post<UploadResult>(`api/uploads?name=${encodeURIComponent(file.name)}`, file, 'application/octet-stream'),
}

/**
 * 读取任务的事件流（NDJSON），每个事件回调一次，任务结束或 signal 中止时返回。
 */
export async function followJob(id: string, onEvent: (event: JobEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`api/jobs/${encodeURIComponent(id)}/events`, { signal, credentials: 'same-origin' })
  if (!res.ok || !res.body) throw await failure(res)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (rest + value).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as JobEvent)
  }
}

/**
 * 面板内部查询（账号列表、配置）的默认请求字段。
 */
function quietDefaults(): Omit<RunRequest, 'platform' | 'resource' | 'action'> {
  return { endpoint: 'web', args: [], options: {}, account: null, raw: false, verbose: false, proxy: null, yes: false }
}

/**
 * 执行一条不进「任务」列表的命令，等它结束并返回信封。
 */
export async function runQuiet(request: Partial<RunRequest> & Pick<RunRequest, 'platform' | 'resource' | 'action'>, stdin: string | null = null): Promise<Envelope> {
  const job = await api.createJob({ request: { ...quietDefaults(), ...request }, stdin, track: false })
  let envelope: Envelope | null = null
  await followJob(job.id, (event) => {
    if (event.type === 'end') envelope = parseEnvelope(event.envelope)
  })
  if (!envelope) throw new ApiError(0, '没有获得操作结果，请稍后重试')
  return envelope
}
