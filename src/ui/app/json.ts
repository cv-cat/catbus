import { h } from './dom.js'

/**
 * 子进程输出的 JSON：类型安全的读取、信封解析，以及保留原文数字的格式化展示。
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface Page {
  cursor: string | null
  has_more: boolean
}

export interface EnvelopeError {
  code: string
  message: string
  hint: string | null
  detail: Json
}

/** catbus 的信封（AGENTS 6.1）。 */
export interface Envelope {
  ok: boolean
  platform: string | null
  endpoint: string | null
  resource: string | null
  action: string | null
  account: string | null
  data: Json
  page: Page | null
  error: EnvelopeError | null
}

/**
 * 是否为 JSON 对象。
 */
export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 取对象字段（不存在时为 undefined）。
 */
export function field(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) ? value[key] : undefined
}

/**
 * 取字符串字段，数字转成字符串；其他情况为 null。
 */
export function str(value: Json | undefined, key: string): string | null {
  const v = field(value, key)
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
}

/**
 * 取数字字段，其他情况为 null。
 */
export function num(value: Json | undefined, key: string): number | null {
  const v = field(value, key)
  return typeof v === 'number' ? v : null
}

/**
 * 取数组字段，其他情况为空数组。
 */
export function list(value: Json | undefined, key: string): Json[] {
  const v = field(value, key)
  return Array.isArray(v) ? v : []
}

/**
 * 解析一行 JSON 原文，失败时为 null。
 */
export function parseJson(text: string): Json | null {
  try {
    return JSON.parse(text) as Json
  } catch {
    return null
  }
}

/**
 * 解析信封原文；不是信封时为 null。
 */
export function parseEnvelope(text: string | null): Envelope | null {
  if (text == null) return null
  const value = parseJson(text)
  if (!isObject(value) || typeof value.ok !== 'boolean') return null
  return value as unknown as Envelope
}

type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'space'

/**
 * JSON 原文的词法切分：字符串整体为一个词，数字保留原文（不经过 JSON.parse，不丢大整数精度）。
 */
function tokenize(text: string): { kind: TokenKind; text: string }[] {
  const tokens: { kind: TokenKind; text: string }[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const value = text.slice(i, j + 1)
      let k = j + 1
      while (/\s/.test(text[k] ?? '')) k += 1
      tokens.push({ kind: text[k] === ':' ? 'key' : 'string', text: value })
      i = j + 1
    } else if (/[{}[\],:]/.test(ch)) {
      tokens.push({ kind: 'punct', text: ch })
      i += 1
    } else if (/\s/.test(ch)) {
      i += 1
    } else {
      let j = i
      while (j < text.length && !/[\s{}[\],:"]/.test(text[j]!)) j += 1
      const word = text.slice(i, j)
      tokens.push({ kind: /^-?\d/.test(word) ? 'number' : 'literal', text: word })
      i = j
    }
  }
  return tokens
}

/** 缩进宽度（空格）。 */
const INDENT = 2

/**
 * 把 JSON 原文排成带缩进和语法着色的节点，空对象、空数组保持在一行。
 */
export function prettyJson(text: string): HTMLElement {
  const pre = h('pre', { class: 'json' })
  const tokens = tokenize(text)
  let depth = 0
  const newline = () => pre.append('\n' + ' '.repeat(depth * INDENT))
  tokens.forEach((token, index) => {
    const next = tokens[index + 1]
    if (token.kind !== 'punct') {
      pre.append(h('span', { class: `json-${token.kind}` }, token.text))
      return
    }
    if (token.text === '{' || token.text === '[') {
      pre.append(token.text)
      if (next && (next.text === '}' || next.text === ']')) return
      depth += 1
      newline()
    } else if (token.text === '}' || token.text === ']') {
      const prev = tokens[index - 1]
      if (prev && (prev.text === '{' || prev.text === '[')) return void pre.append(token.text)
      depth -= 1
      newline()
      pre.append(token.text)
    } else if (token.text === ',') {
      pre.append(',')
      newline()
    } else pre.append(': ')
  })
  return pre
}
