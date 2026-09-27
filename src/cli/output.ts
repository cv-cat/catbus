import type { CatbusError } from '../core/errors.js'
import type { Page } from '../core/registry.js'
import { RAW } from '../core/schemas.js'

export type Format = 'json' | 'jsonl'
export const FORMATS: Format[] = ['json', 'jsonl']

export interface Meta {
  platform: string | null
  endpoint: string | null
  resource: string | null
  action: string | null
  account: string | null
}

export interface Envelope extends Meta {
  ok: boolean
  data: unknown
  page: Page | null
  error: ReturnType<CatbusError['toJSON']> | null
}

/**
 * 信封输出（AGENTS 6.1）。json：stdout 恰好一个信封；jsonl：stdout 每行一个 data 条目，
 * 结束时在 stderr 写一行摘要信封（data 为 null）。
 */
export class Output {
  format: Format = 'json'
  raw = false
  meta: Meta = { platform: null, endpoint: null, resource: null, action: null, account: null }

  /** jsonl / 流式命令：立即写一条。 */
  item(value: unknown): void {
    process.stdout.write(JSON.stringify(this.unwrap(value) ?? null) + '\n')
  }

  /**
   * 写结果。`streamed` 为 true 表示条目已经用 {@link item} 写过，这里只写摘要。
   * doctor 这类命令失败时仍带 data，此时传入 error。
   */
  result(data: unknown, options: { page?: Page | null; streamed?: boolean; error?: CatbusError } = {}): void {
    const { page = null, streamed = false, error } = options
    if (this.format === 'jsonl') {
      if (!streamed) for (const v of Array.isArray(data) ? data : [data]) this.item(v)
      this.summary(error ?? null, page)
    } else {
      this.envelope(process.stdout, { ...this.base(error ?? null), data: this.unwrap(data) ?? null, page })
    }
  }

  fail(error: CatbusError): void {
    if (this.format === 'jsonl') this.summary(error, null)
    else this.envelope(process.stdout, { ...this.base(error), data: null, page: null })
  }

  private summary(error: CatbusError | null, page: Page | null): void {
    this.envelope(process.stderr, { ...this.base(error), data: null, page })
  }

  private base(error: CatbusError | null) {
    return { ok: error == null, ...this.meta, error: error?.toJSON() ?? null }
  }

  private envelope(stream: NodeJS.WriteStream, env: Envelope): void {
    const ordered = {
      ok: env.ok,
      platform: env.platform,
      endpoint: env.endpoint,
      resource: env.resource,
      action: env.action,
      account: env.account,
      data: env.data,
      page: env.page,
      error: env.error,
    }
    const pretty = stream === process.stdout && stream.isTTY
    stream.write(JSON.stringify(ordered, null, pretty ? 2 : undefined) + '\n')
  }

  /** `--raw` 时用平台原始对象代替归一化对象。 */
  private unwrap(value: unknown): unknown {
    if (!this.raw || value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v) => this.unwrap(v))
    return RAW in value ? (value as Record<symbol, unknown>)[RAW] : value
  }
}
