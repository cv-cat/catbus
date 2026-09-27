import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包根目录：src/core 和 dist/core 都在它下面两级。 */
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export function packageJson(): { version: string; engines: { node: string } } {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
}

/** 数据目录：CATBUS_HOME 或 ~/.catbus。 */
export function catbusHome(): string {
  const env = process.env.CATBUS_HOME
  return env ? resolve(env) : join(homedir(), '.catbus')
}

export function configFile(): string {
  return join(catbusHome(), 'config.toml')
}

export function authDir(...parts: string[]): string {
  return join(catbusHome(), 'auth', ...parts)
}

export function cacheDir(platform: string): string {
  return join(catbusHome(), 'cache', platform)
}

/** 上游签名 JS 等静态资源：static/<p>/<file>。 */
export function staticFile(platform: string, file: string): string {
  return join(PACKAGE_ROOT, 'static', platform, file)
}
