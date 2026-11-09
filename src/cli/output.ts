import { CatbusError } from '../core/errors.js'
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
  /** `--fields`：只输出这些字段，null 为全部。 */
  fields: FieldTree | null = null
  meta: Meta = { platform: null, endpoint: null, resource: null, action: null, account: null }

  /** jsonl / 流式命令：立即写一条。 */
  item(value: unknown): void {
    process.stdout.write(JSON.stringify(this.shape(value) ?? null) + '\n')
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
      this.envelope(process.stdout, { ...this.base(error ?? null), data: this.shape(data) ?? null, page })
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

  /** 先 `--raw`，再 `--fields`。 */
  private shape(value: unknown): unknown {
    const v = this.unwrap(value)
    return this.fields ? project(v, this.fields) : v
  }

  /** `--raw` 时用平台原始对象代替归一化对象。 */
  private unwrap(value: unknown): unknown {
    if (!this.raw || value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v) => this.unwrap(v))
    return RAW in value ? (value as Record<symbol, unknown>)[RAW] : value
  }
}

/** `--fields` 解析成的字段树：`true` 表示整个字段。 */
export type FieldTree = Map<string, FieldTree | true>

/** 解析 `--fields id,author.name`。同时给出 `author` 和 `author.name` 时取整个 `author`。 */
export function parseFields(spec: string): FieldTree {
  const tree: FieldTree = new Map()
  for (const path of spec.split(',').map((s) => s.trim())) {
    const segments = path.split('.')
    if (segments.some((s) => s === '')) {
      throw new CatbusError('USAGE', `--fields 的字段路径不对：${path || '（空）'}`, { hint: '例如 --fields id,url,author.name' })
    }
    let node = tree
    for (const [i, s] of segments.entries()) {
      const child = node.get(s)
      if (child === true) break
      if (i === segments.length - 1) {
        node.set(s, true)
        break
      }
      if (child) node = child
      else {
        const next: FieldTree = new Map()
        node.set(s, next)
        node = next
      }
    }
  }
  return tree
}

/** 按字段树裁剪：数组作用到每个元素，不是对象的值原样返回，对象上没有的字段为 null。 */
export function project(value: unknown, tree: FieldTree): unknown {
  if (Array.isArray(value)) return value.map((v) => project(v, tree))
  if (value == null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, sub] of tree) {
    const v = (value as Record<string, unknown>)[key]
    out[key] = v === undefined ? null : sub === true ? v : project(v, sub)
  }
  return out
}
