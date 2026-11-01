import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'
import { isDeterministic } from '../../../core/rand.js'
import { createContext } from '../../../core/vm.js'

/**
 * mtgsig（美团 H5guard 1.2.0）。H5guard 和它的环境补丁放在 static/maoyan/，在同一个 vm context 里依次执行
 * env_core.js → env.js → H5guard.js；horn 配置与 package 板块离线应答，不联网。context 懒创建、复用。
 */

const read = (name: string) => readFileSync(staticFile('maoyan', name), 'utf8')

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

/** 设备指纹，即 mtgsig 的 a3。服务端校验它的合法性，随机伪造会 403，所以写死一个真实值。 */
export const WEBDFPID =
  'v772xv30578y5v41zu4z1110w00w004y8z80498uw01679586536v26v-1793587698495-1793501293530SOAKOIOfd79fef3d01d5e9aadc18ccd4d0c95071692'

/** H5guard 所在页面（show.maoyan.com）的 cookie：出签只需要设备指纹。 */
const PAGE_COOKIE = `WEBDFPID=${WEBDFPID}`

let signer: ((url: string, method: string, data: string) => Promise<string>) | undefined

function load(): NonNullable<typeof signer> {
  const context = createContext({
    require: undefined,
    module: { exports: {} },
    // env_core 在加载时注册 process.on('exit', report)，之后由 env.init 隐藏 process
    process: { on() {} },
    __catbus_maoyan: {
      ua: UA,
      cookie: PAGE_COOKIE,
      hornBaseSec: read('horn_BaseSec.json'),
      hornTrack: read('horn_Track.json'),
      packageJs: read('package-1.2.0.js'),
    },
  })
  vm.runInContext('globalThis.global = globalThis', context)
  for (const name of ['env_core.js', 'env.js', 'H5guard.js']) vm.runInContext(read(name), context, { filename: staticFile('maoyan', name) })
  return vm.runInContext('global.__catbus_mtgsig', context)
}

/** 给一个请求出 mtgsig。`url` 必须与实际请求的 URL 逐字一致（含全部 query）。 */
export async function mtgsig(url: string, method = 'GET', data = ''): Promise<string> {
  try {
    // 确定性模式（测试）下每次新建 context，与 core/vm 一致
    const sign = isDeterministic() ? load() : (signer ??= load())
    return await sign(url, method, data)
  } catch (e) {
    throw new CatbusError('ERROR', `mtgsig 出签失败：${(e as Error).message}`, { hint: 'catbus doctor' })
  }
}
