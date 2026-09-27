import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 包根目录：从本文件向上找 name 为 catbus-cli 的 package.json（src/、dist/ 或其他编译输出目录都适用）。 */
export const PACKAGE_ROOT = findRoot(dirname(fileURLToPath(import.meta.url)))

function findRoot(dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    try {
      if (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name === 'catbus-cli') return d
    } catch {}
    if (dirname(d) === d) return resolve(dir, '../..')
  }
}

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
