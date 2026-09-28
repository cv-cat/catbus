import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { ensureDir, writeFileAtomic } from '../../core/fsutil.js'
import { catbusHome, packageJson } from '../../core/paths.js'
import { createContext } from '../../core/vm.js'

export interface Check {
  name: string
  ok: boolean
  message: string
}

const require = createRequire(import.meta.url)

/** onnx 冒烟用的最小模型：c = a + b，float32[2]。 */
const ADD_MODEL =
  'CAg6SAoOCgFhCgFiEgFjIgNBZGQSA2FkZFoPCgFhEgoKCAgBEgQKAggCWg8KAWISCgoICAESBAoCCAJiDwoBYxIKCggIARIECgIIAkIECgAQDQ=='

async function check(name: string, run: () => string | Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, message: await run() }
  } catch (err) {
    return { name, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** 已安装依赖的版本：从入口文件向上找它的 package.json（有的包不导出 ./package.json）。 */
function installedVersion(name: string): string {
  let dir = dirname(require.resolve(name))
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === name) return pkg.version
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) return '?'
    dir = parent
  }
}

/** 只支持 engines 里用到的写法：`^x.y.z`、`>=x.y.z`，用 `||` 连接。 */
export function satisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number)
  return range.split('||').some((part) => {
    const m = /^\s*(\^|>=)(\d+)\.(\d+)\.(\d+)\s*$/.exec(part)
    if (!m) return false
    const min = [Number(m[2]), Number(m[3]), Number(m[4])]
    const i = v.findIndex((n, j) => n !== min[j])
    const atLeast = i === -1 || v[i]! > min[i]!
    return atLeast && (m[1] === '>=' || v[0] === min[0])
  })
}

export async function doctor(): Promise<Check[]> {
  const engines = packageJson().engines.node
  return [
    await check('node', () => {
      const v = process.versions.node
      if (!satisfies(v, engines)) throw new Error(`Node ${v} 不满足要求 ${engines}`)
      return `Node ${v}（要求 ${engines}）`
    }),

    await check('home', async () => {
      const home = catbusHome()
      await ensureDir(home)
      const probe = join(home, '.doctor')
      await writeFileAtomic(probe, 'ok')
      await rm(probe, { force: true })
      if (process.platform !== 'win32') {
        const mode = (await stat(home)).mode & 0o777
        if (mode & 0o077) {
          throw new Error(`${home} 的权限是 ${mode.toString(8).padStart(4, '0')}，其他用户可以访问；执行 chmod 700 ${home}`)
        }
      }
      return `${home} 可写`
    }),

    await check('vm', () => {
      const expected = createHash('md5').update('catbus').digest('hex')
      const got = vm.runInContext(`require('node:crypto').createHash('md5').update('catbus').digest('hex')`, createContext())
      if (got !== expected) throw new Error(`签名 vm 的结果不对：${got}`)
      return 'node:vm + require 正常'
    }),

    await check('http', async () => {
      const { createSession } = await import('wreq-js')
      const session = await createSession()
      await session.close()
      return `wreq-js ${installedVersion('wreq-js')}`
    }),

    await check('canvas', async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(4, 4)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f5c2e7'
      ctx.fillRect(0, 0, 4, 4)
      const png = canvas.toBuffer('image/png')
      if (png.subarray(1, 4).toString() !== 'PNG') throw new Error('PNG 编码结果不对')
      return `@napi-rs/canvas ${installedVersion('@napi-rs/canvas')}`
    }),

    await check('onnx', async () => {
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      const session = await ort.InferenceSession.create(Buffer.from(ADD_MODEL, 'base64'))
      const input = (v: number[]) => new ort.Tensor('float32', Float32Array.from(v), [2])
      const { c } = await session.run({ a: input([1, 2]), b: input([3, 4]) })
      await session.release()
      const got = Array.from(c!.data as Float32Array).join()
      if (got !== '4,6') throw new Error(`推理结果不对：${got}`)
      return `onnxruntime-web ${installedVersion('onnxruntime-web')}（wasm）`
    }),

    await check('assets-jd', async () => {
      const name = '@cv-cat/catbus-assets-jd'
      const { models } = await import('@cv-cat/catbus-assets-jd').catch(() => {
        throw new Error(`没有安装 ${name}，请重新安装 catbus-cli`)
      })
      for (const file of Object.values(models)) {
        const s = await stat(file).catch(() => null)
        if (!s?.size) throw new Error(`模型文件缺失：${file}`)
      }
      return `${name} ${installedVersion(name)}`
    }),

    await check('assets-ocr', async () => {
      const name = '@cv-cat/catbus-assets-ocr'
      const { models } = await import('@cv-cat/catbus-assets-ocr').catch(() => {
        throw new Error(`没有安装 ${name}，请重新安装 catbus-cli`)
      })
      for (const file of Object.values(models)) {
        const s = await stat(file).catch(() => null)
        if (!s?.size) throw new Error(`模型文件缺失：${file}`)
      }
      return `${name} ${installedVersion(name)}`
    }),
  ]
}
