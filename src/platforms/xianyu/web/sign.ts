import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import vm from 'node:vm'
import { staticFile } from '../../../core/paths.js'
import { createContext, loadScript } from '../../../core/vm.js'

/**
 * 上游 JS（static/xianyu/，原样复制）：
 * - goofish_js_version_2.js：mtop 签名、mid / uuid / 设备 ID、推送解码（上游 utils/goofish_utils.py 经 PyExecJS 调用）；
 * - gen_tfstk.js + et_f.js：补环境跑阿里的 et_f，生成 cookie `tfstk`（上游 `node utils/gen_tfstk.js` 子进程）。
 */

const GOOFISH_JS = staticFile('xianyu', 'goofish_js_version_2.js')
const TFSTK_JS = staticFile('xianyu', 'gen_tfstk.js')

/** 脚本里的函数是顶层 `const`，不挂在 context 上（core 的 callScript 取不到），按名字在 context 里求值。 */
function call<T>(fn: string, ...args: unknown[]): T {
  const f = vm.runInContext(fn, loadScript(GOOFISH_JS)) as (...a: unknown[]) => T
  return f(...args)
}

/** md5(token&t&34839810&data)。 */
export const generateSign = (t: string, token: string, data: string) => call<string>('generate_sign', t, token, data)
export const generateMid = () => call<string>('generate_mid')
export const generateUuid = () => call<string>('generate_uuid')
export const generateDeviceId = (userId: string) => call<string>('generate_device_id', userId)
/** 推送里 base64 + MessagePack 的数据 → JSON 字符串。 */
export const decrypt = (data: string) => call<string>('decrypt', data)

/**
 * 跑 gen_tfstk.js，拿到 `tfstk`；失败返回空串（与上游 `_gen_tfstk` 一致）。
 *
 * 脚本是命令行写法：读 `__dirname` 下的 et_f.js、结果写到 stdout、失败时 `process.exit`，这里喂一个假的 process 收结果。
 * 它自己再开一层 vm 补浏览器环境，把 ArrayBuffer、Error、console 等宿主对象透传给 et_f；
 * 所以这些要用宿主 realm 的（console 还要是完整的 Console），否则 et_f 的环境检测不过，算出来是 undefined。
 */
export async function genTfstk(debug: (line: string) => void = () => {}): Promise<string> {
  const sink = new Writable({
    write(chunk, _enc, done) {
      for (const line of String(chunk).split('\n')) if (line.trim()) debug(`[gen_tfstk] ${line}`)
      done()
    },
  })
  return new Promise<string>((resolve) => {
    const proc = Object.create(process, {
      argv: { value: ['node', TFSTK_JS] },
      stdout: { value: { write: (s: unknown) => (resolve(String(s).trim()), true) } },
      exit: { value: () => resolve('') },
    })
    const context = createContext({
      process: proc,
      __dirname: dirname(TFSTK_JS),
      __filename: TFSTK_JS,
      console: new Console({ stdout: sink, stderr: sink }),
      Error,
      queueMicrotask,
      ArrayBuffer,
      SharedArrayBuffer,
      DataView,
      Uint8Array,
      Uint8ClampedArray,
      Uint16Array,
      Uint32Array,
      Int8Array,
      Int16Array,
      Int32Array,
      Float32Array,
      Float64Array,
      BigInt64Array,
      BigUint64Array,
    })
    try {
      vm.runInContext(readFileSync(TFSTK_JS, 'utf8'), context, { filename: TFSTK_JS })
    } catch (err) {
      debug(`[gen_tfstk] ${(err as Error).message}`)
      resolve('')
    }
  })
}
