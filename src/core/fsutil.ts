import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/** 目录 0700（Windows 依赖用户目录本身的 ACL）。 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

/** 原子写入：先写同目录的临时文件（0600），再 rename 覆盖。 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(dirname(file))
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  try {
    // Windows 上目标文件被其他进程短暂占用时 rename 会失败，重试几次。
    for (let i = 0; ; i++) {
      try {
        await rename(tmp, file)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
        await sleep(20 * (i + 1))
      }
    }
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

export async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** 带本地时区偏移的 ISO 8601，例如 2026-09-27T12:00:00+08:00。 */
export function isoNow(date = new Date()): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}
