import vm from 'node:vm'
import { staticFile } from '../../../core/paths.js'
import { loadScript } from '../../../core/vm.js'

/**
 * 上游 utils/taobao_utils.py：签名、mid / uuid / 设备号的生成、推送消息的解码，都在上游的
 * static/taobao_js_20260407.js 里（原样复制到 static/taobao/），这里用 vm 执行。
 *
 * 脚本里的函数是顶层 `const` 声明，不挂在 context 的全局对象上，所以按名字在 context 里求值取出。
 */

const SCRIPT = staticFile('taobao', 'taobao_js_20260407.js')

function call<T>(fn: string, ...args: unknown[]): T {
  const context = loadScript(SCRIPT)
  const f = vm.runInContext(fn, context) as (...a: unknown[]) => T
  return f(...args)
}

/** 帧的 mid：`<0~999 的随机数><毫秒时间戳> 0`。 */
export function generateMid(): string {
  return call('generate_mid')
}

/** 发消息时的客户端 uuid：`_s_<毫秒时间戳>_1`。 */
export function generateUuid(): string {
  return call('generate_uuid')
}

/** 设备号：32 位随机字符 + `-` + 毫秒时间戳（上游传入 unb，但脚本并不使用它）。 */
export function generateDeviceId(userId: string): string {
  return call('generate_device_id', userId)
}

/** mtop 签名：md5(`token&t&appKey&data`)。 */
export function generateSign(t: number, token: string, data: string): string {
  return call('generate_sign', t, token, data)
}

/** 解开推送里 base64 + MessagePack 编码的消息，返回 JSON 字符串（64 位整数写成字符串）。 */
export function decrypt(data: string): string {
  return call('decrypt', data)
}
