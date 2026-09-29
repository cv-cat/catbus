import { readFileSync } from 'node:fs'
import { staticFile } from '../../../core/paths.js'
import { compactJson, jsonLoads } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { APP_VERSION, PROFILE } from './profile.js'
import { encodeStrData } from './sign.js'

/**
 * mssdk 上报体（上游 utils/strdata_pure.py、utils/mstoken.py）。设备常量来自上游抓的档案，
 * 原样复制在 static/douyin/ 下；每次只重算 uuid、采集耗时、时间戳与 nonce。
 */

const cache = new Map<string, any>()
function profile(name: string): any {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(staticFile('douyin', name), 'utf8')))
  return structuredClone(cache.get(name))
}

/** Python `json.dumps(float)`：整数值的浮点数带 `.0`。 */
function pyFloat(x: number): number | string {
  return Number.isInteger(x) ? `${x}.0` : x
}

/** 把 `"collectTime":"<n>.0"` 这类占位还原成数字字面量。 */
function withRawFloats(json: string, raw: Record<string, number | string>): string {
  let out = json
  for (const [key, v] of Object.entries(raw)) if (typeof v === 'string') out = out.replace(`"${key}":"${v}"`, `"${key}":${v}`)
  return out
}

/** /web/r/token 的上报体（上游 build_report_body）。 */
export function strDataReport(aid = 6383, pageId = 6241): string {
  const data = profile('mstoken_profile.json')
  const n = data.nWID
  const [, , , , availW, availH] = PROFILE.geo
  Object.assign(n.screen, { height: Number(PROFILE.screenHeight), width: Number(PROFILE.screenWidth), availHeight: availH, availWidth: availW, availTop: 0, availLeft: 0 })
  n.navigator.hardwareConcurrency = Number(PROFILE.cpuCoreNum)
  n.navigator.userAgent = PROFILE.ua
  n.webgl.renderer = PROFILE.webglRenderer
  n.webgl.vendor = PROFILE.webglVendor
  n.audio = n.audio ?? {}
  n.audio.audioContext = n.audio.audioContext ?? {}
  n.audio.audioContext.state = 'running'
  const msVersion = n.ms_version ?? '0.0.0.1'
  delete n.ms_version
  const uuid = rand.uuid4()
  const collectTime = pyFloat(Number(rand.uniform(40, 160).toFixed(10)))
  n.custom = withRawFloats(compactJson({ version: msVersion, fxgDid: '', uuid, collectTime, aid, pageId }), { collectTime })
  n.ms_version = msVersion
  const plaintext = compactJson({ nWID: n, wID: data.wID })
  const nonce = rand.randint(0, 255)
  const ts = rand.now()
  return compactJson({ magic: 538969122, version: 1, dataType: 8, strData: encodeStrData(plaintext, nonce), tspFromClient: ts, ulr: 0 })
}

/** /web/common 的完整 msgType=1 上报（上游 build_common_report_body）。 */
export function commonReport(aid = 6383, pageId = 6241, sms = false): string {
  const p = profile('mstoken_common_profile.json')
  const now = rand.now()
  if (sms) p.ubCode = 12
  const n = p.nWID ?? {}
  if (sms) n.ubCode = 12
  n.canvas = n.canvas ?? {}
  n.canvas.crc32 = 'A7996F6A'
  n.audio = n.audio ?? {}
  n.audio.audioContext = n.audio.audioContext ?? {}
  n.audio.audioContext.state = 'running'
  let custom: Record<string, any>
  try {
    custom = typeof n.custom === 'string' ? jsonLoads(n.custom) : { ...(n.custom ?? {}) }
  } catch {
    custom = {}
  }
  custom.version ??= n.ms_version ?? '0.0.0.1'
  custom.fxgDid ??= ''
  custom.uuid = rand.uuid4()
  custom.collectTime = sms ? 23.799999952316284 : rand.randint(10, 99)
  const msVersion = n.ms_version ?? '0.0.0.1'
  delete n.ms_version
  n.custom = compactJson(custom)
  n.ms_version = msVersion
  const wid = p.wID ?? {}
  Object.assign(wid, { msgType: 1, timestamp: String(now), aid, pageId, nap: '11311144242322244122' })
  const g = PROFILE.geo
  Object.assign((p.navigator ??= {}), { appVersion: APP_VERSION, deviceMemory: PROFILE.deviceMemory, hardwareConcurrency: Number(PROFILE.cpuCoreNum) })
  Object.assign((p.webgl ??= {}), { renderer: PROFILE.webglRenderer, vendor: PROFILE.webglVendor })
  Object.assign((n.navigator ??= {}), { userAgent: PROFILE.ua, hardwareConcurrency: Number(PROFILE.cpuCoreNum) })
  Object.assign((n.screen ??= {}), { height: Number(PROFILE.screenHeight), width: Number(PROFILE.screenWidth), availHeight: g[5], availWidth: g[4], availTop: 0, availLeft: 0 })
  Object.assign((n.webgl ??= {}), { renderer: PROFILE.webglRenderer, vendor: PROFILE.webglVendor })
  Object.assign((p.screen ??= {}), {
    innerWidth: g[0],
    innerHeight: g[1],
    outerWidth: g[2],
    outerHeight: g[3],
    screenX: PROFILE.screenX,
    screenY: PROFILE.screenY,
    availWidth: g[4],
    availHeight: g[5],
    sizeWidth: g[6],
    sizeHeight: g[7],
    clientWidth: g[0],
    clientHeight: g[1],
  })
  p.nWID = n
  p.wID = wid
  const nonce = rand.randint(0, 255)
  const strData = encodeStrData(compactJson(p), nonce)
  return compactJson({ magic: 538969122, version: 1, dataType: 8, strData, tspFromClient: sms ? now + 11 : now + 10, ulr: 0 })
}

/** 5 分钟一次的 msgType=2 行为心跳（上游 build_common_behavior_body）。 */
export function commonBehavior(): string {
  const now = rand.now()
  const g = PROFILE.geo
  const plaintext = compactJson({
    wID: { msgType: 2, privacyMode: 0, timestamp: String(now) },
    behavior: {
      beMove: [],
      beClick: [],
      beClickEnd: [],
      beKeyboard: [],
      windowState: [],
      gyro: [],
      focus: [],
      screen: {
        innerWidth: g[0],
        innerHeight: g[1],
        outerWidth: g[2],
        outerHeight: g[3],
        screenX: PROFILE.screenX,
        screenY: PROFILE.screenY,
        pageXOffset: 0,
        pageYOffset: 0,
        availWidth: g[4],
        availHeight: g[5],
        sizeWidth: g[6],
        sizeHeight: g[7],
        clientWidth: g[0],
        clientHeight: g[1],
        colorDepth: 24,
        pixelDepth: 24,
        orientaionType: 'landscape-primary',
        orientaionAngle: 0,
      },
    },
  })
  const nonce = rand.randint(0, 255)
  return compactJson({ magic: 538969122, version: 1, dataType: 8, strData: encodeStrData(plaintext, nonce), tspFromClient: now + 3, ulr: 0 })
}
