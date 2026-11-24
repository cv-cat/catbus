import type { IncomingMessage } from 'node:http'

/** 请求体超过上限（HTTP 413）。 */
export class BodyTooLargeError extends Error {
  readonly status = 413
}

/**
 * 读完整个请求体，按 UTF-8 解码成字符串。
 * 先收齐 Buffer 再统一解码：逐块 `raw += chunk` 会把跨块的多字节字符（中文标题）解成 U+FFFD。
 * 上限按字节算，超过时立即报错，不再继续读。
 */
export async function readText(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > limit) throw new BodyTooLargeError(`请求体过大（上限 ${Math.round(limit / 1024)} KB）`)
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 读 JSON 请求体；空请求体为 `{}`。JSON 不合法时抛 SyntaxError（调用方按 400 处理）。 */
export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const raw = await readText(req, limit)
  return raw ? JSON.parse(raw) : {}
}
