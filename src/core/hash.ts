import { createHash, createHmac } from 'node:crypto'

/** 常用摘要，十六进制小写。字符串按 UTF-8 编码。 */

type Data = string | Uint8Array

export const md5Hex = (data: Data): string => createHash('md5').update(data).digest('hex')

export const sha256Hex = (data: Data): string => createHash('sha256').update(data).digest('hex')

export const hmacSha256Hex = (key: Data, data: Data): string => createHmac('sha256', key).update(data).digest('hex')
