import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { UploadResult } from './shared/types.js'

/**
 * 面板上选的本地文件（AGENTS 4.13「文件」）：存到本次面板的临时目录，再把路径交给 CLI；面板退出时整个删除。
 */

/** 文件名里保留的最大长度（保留扩展名，平台按扩展名判断类型）。 */
const MAX_NAME_LENGTH = 80

/**
 * 去掉路径和控制字符，只保留可以安全放进文件名的字符。
 */
function safeName(name: string): string {
  const base = basename(name.replaceAll('\\', '/')).replace(/[^\p{L}\p{N}._-]+/gu, '_')
  return (base || 'file').slice(-MAX_NAME_LENGTH)
}

export class UploadDir {
  private dir: Promise<string> | null = null

  /**
   * 保存一个上传的文件，返回它在本机的路径。
   */
  async save(name: string, body: Readable): Promise<UploadResult> {
    // 多文件会并发上传；先缓存创建中的 Promise，保证所有文件共用一个可清理的目录。
    const dir = await (this.dir ??= mkdtemp(join(tmpdir(), 'catbus-ui-')).catch((error: unknown) => {
      this.dir = null
      throw error
    }))
    const path = join(dir, `${randomBytes(6).toString('hex')}-${safeName(name)}`)
    await pipeline(body, createWriteStream(path, { mode: 0o600 }))
    return { path, name: safeName(name), size: (await stat(path)).size }
  }

  /**
   * 删除临时目录。
   */
  async remove(): Promise<void> {
    if (this.dir) await rm(await this.dir, { recursive: true, force: true })
    this.dir = null
  }
}
